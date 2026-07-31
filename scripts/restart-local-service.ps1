[CmdletBinding()]
param(
  [int]$Port = 7420,
  [string]$ConfigPath = "$env:USERPROFILE\.cx-codex\config.json",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$BindHealthHost = "127.0.0.1",
  [string]$ExpectedVersion = "",
  [ValidateRange(0, 86400)]
  [int]$DrainTimeoutSeconds = 300,
  [switch]$ForceActiveTaskRestart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distCliPath = Join-Path $repoRoot "dist-cli\index.js"
$packageJsonPath = Join-Path $repoRoot "package.json"
$logDir = Join-Path $env:USERPROFILE ".cx-codex\logs"
$defaultConfigPath = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".cx-codex\config.json"))
$legacyConfigPath = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".codexui\config.json"))

function Get-ManagedCodexUiProcessIds {
  param(
    [string]$RepoRoot,
    [string]$TargetConfigPath
  )

  $managedIds = New-Object 'System.Collections.Generic.HashSet[int]'
  $normalizedRepoRoot = [IO.Path]::GetFullPath($RepoRoot)
  $normalizedConfigPath = [IO.Path]::GetFullPath($TargetConfigPath)

  $processes = Get-CimInstance Win32_Process
  foreach ($processInfo in $processes) {
    $processId = [int]$processInfo.ProcessId
    if (-not $processId -or $processId -eq $PID) {
      continue
    }

    $commandLine = [string]$processInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
      continue
    }

    $isManagedCodexUi =
      ($commandLine -like "*dist-cli\index.js*" -or $commandLine -like "*dist-cli/index.js*") -and (
        $commandLine -like "*$normalizedRepoRoot*" -or
        $commandLine -like "*$normalizedConfigPath*"
      )

    if ($isManagedCodexUi) {
      $managedIds.Add($processId) | Out-Null
    }
  }

  $result = @()
  foreach ($managedId in $managedIds) {
    $result += [int]$managedId
  }
  return $result
}

function Test-Health {
  param(
    [string]$HealthHost,
    [int]$TargetPort
  )

  try {
    $response = Invoke-WebRequest -Uri "http://$HealthHost`:$TargetPort/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
      return $response.Content
    }
  } catch {}

  return $null
}

function Wait-ForRuntimeDrain {
  if ($ForceActiveTaskRestart) {
    return
  }

  $deadline = (Get-Date).AddSeconds($DrainTimeoutSeconds)
  $lastReadError = ""
  do {
    $health = $null
    $lastReadError = ""
    try {
      $health = Invoke-RestMethod `
        -Method Get `
        -Uri "http://$BindHealthHost`:$Port/codex-api/health" `
        -TimeoutSec 5
    } catch {
      $lastReadError = [string]$_.Exception.Message
    }

    if ($health -and $health.status -eq "ok" -and $health.data) {
      $runtimeRequestCount = [int]$health.data.runtimeStore.uncertainRequestCount
      $restartBlockingCount = if ($health.data.appServer.restartProtection) {
        [int]$health.data.appServer.restartProtection.blockingRequestCount
      } else {
        0
      }
      $pendingServerRequestCount = [int]$health.data.appServer.pendingServerRequestCount
      $activePlanModeTurnCount = [int]$health.data.appServer.activePlanModeTurnCount
      if (
        [Math]::Max($runtimeRequestCount, $restartBlockingCount) -eq 0 -and
        $pendingServerRequestCount -eq 0 -and
        $activePlanModeTurnCount -eq 0
      ) {
        return
      }
    }

    if ((Get-Date) -ge $deadline) {
      if (-not [string]::IsNullOrWhiteSpace($lastReadError)) {
        throw "Restart stopped because active-task safety could not read /codex-api/health: $lastReadError. Retry after CX-Codex becomes healthy, or explicitly use -ForceActiveTaskRestart."
      }
      throw "Restart is still blocked by active Codex work after $DrainTimeoutSeconds seconds. Wait for tasks to finish, or explicitly use -ForceActiveTaskRestart."
    }
    Start-Sleep -Seconds 2
  } while ($true)
}

if (-not (Test-Path -LiteralPath $distCliPath)) {
  throw "Missing CLI entry: $distCliPath"
}

if (-not $ExpectedVersion -and (Test-Path -LiteralPath $packageJsonPath)) {
  try {
    $packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
    $ExpectedVersion = [string]$packageJson.version
  } catch {}
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Missing Node runtime: $NodePath"
}

if ($ExpectedVersion) {
  $versionOutput = @(& $NodePath $distCliPath --version 2>$null)
  $versionExitCode = $LASTEXITCODE
  $actualVersion = if ($versionOutput.Count -gt 0) { [string]$versionOutput[0] } else { "" }
  $actualVersion = $actualVersion.Trim()
  if ($versionExitCode -ne 0 -or $actualVersion -ne $ExpectedVersion) {
    throw "CLI build has unexpected version '$actualVersion'; expected '$ExpectedVersion'. Rebuild before restarting the service."
  }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  $normalizedRequestedConfigPath = [IO.Path]::GetFullPath($ConfigPath)
  if ($normalizedRequestedConfigPath -ieq $defaultConfigPath -and (Test-Path -LiteralPath $legacyConfigPath)) {
    $ConfigPath = $legacyConfigPath
  }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Missing config file: $ConfigPath"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$managedProcessIds = Get-ManagedCodexUiProcessIds -RepoRoot $repoRoot -TargetConfigPath $ConfigPath
if ($managedProcessIds.Count -gt 0) {
  Wait-ForRuntimeDrain
}
foreach ($managedProcessId in $managedProcessIds) {
  try {
    Stop-Process -Id $managedProcessId -Force -ErrorAction Stop
  } catch {}
}

Start-Sleep -Milliseconds 800

$remainingListeners = @()
try {
  $remainingListeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {}

foreach ($listenerProcessId in $remainingListeners) {
  if (-not $listenerProcessId -or $managedProcessIds -contains [int]$listenerProcessId) {
    continue
  }

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" -ErrorAction SilentlyContinue
  $processName = if ($processInfo) { $processInfo.Name } else { "unknown" }
  throw "Port $Port is occupied by unrelated PID $listenerProcessId ($processName)."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outLog = Join-Path $logDir "cx-codex-$Port-$timestamp.out.log"
$errLog = Join-Path $logDir "cx-codex-$Port-$timestamp.err.log"
$quotedDistCliPath = '"' + $distCliPath + '"'
$quotedConfigPath = '"' + $ConfigPath + '"'

$process = Start-Process `
  -FilePath $NodePath `
  -ArgumentList @($quotedDistCliPath, "--config", $quotedConfigPath) `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

$healthPayload = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $healthPayload = Test-Health -HealthHost $BindHealthHost -TargetPort $Port
  if ($healthPayload) {
    break
  }
}

if (-not $healthPayload) {
  throw "Service started with PID $($process.Id), but /health did not become ready on port $Port."
}

[PSCustomObject]@{
  Port = $Port
  Pid = $process.Id
  Version = $ExpectedVersion
  Health = $healthPayload
  OutLog = $outLog
  ErrLog = $errLog
} | ConvertTo-Json -Depth 4
