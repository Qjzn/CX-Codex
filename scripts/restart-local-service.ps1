[CmdletBinding()]
param(
  [int]$Port = 7420,
  [string]$ConfigPath = "$env:USERPROFILE\.cx-codex\config.json",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$BindHealthHost = "127.0.0.1",
  [string]$ExpectedVersion = ""
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

$process = Start-Process `
  -FilePath $NodePath `
  -ArgumentList @($distCliPath, "--config", $ConfigPath) `
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

if ($ExpectedVersion) {
  $startupOutput = Get-Content -Raw -LiteralPath $outLog -ErrorAction SilentlyContinue
  $versionMatch = [regex]::Match([string]$startupOutput, "Version:\s+([^\r\n]+)")
  $actualVersion = if ($versionMatch.Success) { $versionMatch.Groups[1].Value.Trim() } else { "" }
  if ($actualVersion -ne $ExpectedVersion) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    } catch {}
    throw "Service started with unexpected version '$actualVersion'; expected '$ExpectedVersion'. OutLog: $outLog"
  }
}

[PSCustomObject]@{
  Port = $Port
  Pid = $process.Id
  Version = $ExpectedVersion
  Health = $healthPayload
  OutLog = $outLog
  ErrLog = $errLog
} | ConvertTo-Json -Depth 4
