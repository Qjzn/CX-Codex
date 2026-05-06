[CmdletBinding()]
param(
  [string]$ProjectPath = "",
  [switch]$CreateProjectPath,
  [int]$Port = 7420,
  [string]$BindHost = "0.0.0.0",
  [string]$Password = "",
  [switch]$NoPassword,
  [switch]$Tunnel,
  [switch]$OpenBrowser,
  [string]$ConfigPath = "$env:USERPROFILE\.cx-codex\config.json",
  [string]$LauncherPath = "$env:USERPROFILE\.local\bin\cx-codex-start.cmd",
  [string]$CodexCommand = "",
  [string]$RipgrepCommand = "",
  [string]$CloudflaredCommand = "",
  [switch]$OpenFirewall,
  [string]$FirewallRuleName = "",
  [switch]$SkipNpmInstall,
  [switch]$SkipBuild,
  [switch]$EnsureCodexLogin,
  [switch]$CreateStartupTask,
  [switch]$CreateWatchdogTask,
  [switch]$InstallCloudflared,
  [string]$TaskName = "",
  [string]$WatchdogTaskName = "",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function New-StablePassword {
  $alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $chars = for ($i = 0; $i -lt 16; $i++) {
    $alphabet[(Get-Random -Minimum 0 -Maximum $alphabet.Length)]
  }
  -join $chars
}

function Resolve-OptionalPath {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }
  if (Test-Path -LiteralPath $Value) {
    return (Resolve-Path -LiteralPath $Value).Path
  }
  return $Value
}

function Resolve-NpmExecutable {
  param([System.Management.Automation.CommandInfo]$CommandInfo)

  $source = $CommandInfo.Source
  if ($source -like "*.ps1") {
    $cmdCandidate = [System.IO.Path]::ChangeExtension($source, ".cmd")
    if (Test-Path -LiteralPath $cmdCandidate) {
      return $cmdCandidate
    }
  }
  return $source
}

function Ensure-ProjectDirectory {
  param(
    [string]$TargetPath,
    [bool]$CreateIfMissing
  )

  if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    return $null
  }

  $resolved = Resolve-OptionalPath -Value $TargetPath
  if (Test-Path -LiteralPath $resolved) {
    $item = Get-Item -LiteralPath $resolved
    if (-not $item.PSIsContainer) {
      throw "Path exists but is not a directory: $resolved"
    }
    return $item.FullName
  }

  if (-not $CreateIfMissing) {
    throw "Directory does not exist: $resolved"
  }

  New-Item -ItemType Directory -Path $resolved -Force | Out-Null
  return (Resolve-Path -LiteralPath $resolved).Path
}

function Get-AccessibleUrls {
  param(
    [string]$BindHostValue,
    [int]$TargetPort
  )

  $urls = New-Object 'System.Collections.Generic.List[string]'
  if ([string]::IsNullOrWhiteSpace($BindHostValue) -or $BindHostValue -eq "0.0.0.0" -or $BindHostValue -eq "::") {
    $urls.Add("http://localhost:$TargetPort/")
    try {
      $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object {
          $_.IPAddress -ne "127.0.0.1" -and
          $_.IPAddress -notlike "169.254*" -and
          $_.PrefixOrigin -ne "WellKnown"
        } |
        Select-Object -ExpandProperty IPAddress -Unique
      foreach ($address in $addresses) {
        $urls.Add("http://$address`:$TargetPort/")
      }
    } catch {}
  } elseif ($BindHostValue -eq "localhost" -or $BindHostValue -eq "127.0.0.1") {
    $urls.Add("http://localhost:$TargetPort/")
  } else {
    $urls.Add("http://$BindHostValue`:$TargetPort/")
  }
  $urls | Select-Object -Unique
}

function Get-CodexAuthPath {
  Join-Path $env:USERPROFILE ".codex\auth.json"
}

function Ensure-CodexLogin {
  param(
    [string]$NodePath,
    [string]$RepoRoot
  )

  $authPath = Get-CodexAuthPath
  if (Test-Path -LiteralPath $authPath) {
    Write-Host "Codex auth already present: $authPath"
    return
  }

  Write-Step "Codex login required"
  Write-Host "No Codex auth was found, so login will open once in this console."
  & $NodePath "$RepoRoot\dist-cli\index.js" login
  if ($LASTEXITCODE -ne 0) {
    throw "Codex login failed with exit code $LASTEXITCODE"
  }
}

function Stop-ExistingCodexUiProcesses {
  param(
    [int]$TargetPort,
    [string]$RepoRoot,
    [string]$TargetLauncherPath,
    [string]$TargetConfigPath
  )

  $managedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
  $launcherLeaf = if ([string]::IsNullOrWhiteSpace($TargetLauncherPath)) { "" } else { Split-Path -Leaf $TargetLauncherPath }

  try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop
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
        $commandLine -like "*dist-cli\index.js*" -and (
          $commandLine -like "*$RepoRoot*" -or
          $commandLine -like "*$TargetConfigPath*" -or
          (-not [string]::IsNullOrWhiteSpace($TargetLauncherPath) -and $commandLine -like "*$TargetLauncherPath*") -or
          (-not [string]::IsNullOrWhiteSpace($launcherLeaf) -and $commandLine -like "*$launcherLeaf*")
        )

      if ($isManagedCodexUi) {
        $managedProcessIds.Add($processId) | Out-Null
      }
    }
  } catch {}

  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $TargetPort -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    $listeners = @()
  }

  foreach ($processId in $listeners) {
    if (-not $processId -or $processId -eq $PID) {
      continue
    }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $processInfo) {
      continue
    }

    if (-not $managedProcessIds.Contains([int]$processId)) {
      Write-Warning "Port $TargetPort is already occupied by PID $processId ($($processInfo.Name)). Not stopping it automatically."
      return $false
    }
  }

  foreach ($managedProcessId in $managedProcessIds) {
    Write-Host "Stopping previous CX-Codex process (PID $managedProcessId)..."
    Stop-Process -Id $managedProcessId -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds 1
  return $true
}

function Create-LauncherFile {
  param(
    [string]$TargetLauncherPath,
    [string]$NodePath,
    [string]$RepoRoot,
    [string]$TargetConfigPath
  )

  $launcherDir = Split-Path -Parent $TargetLauncherPath
  if (-not [string]::IsNullOrWhiteSpace($launcherDir)) {
    New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null
  }

  $launcherContent = @"
@echo off
setlocal
set "CX_CODEX_LOG_DIR=%USERPROFILE%\.cx-codex\logs"
if not exist "%CX_CODEX_LOG_DIR%" mkdir "%CX_CODEX_LOG_DIR%"
cd /d "$RepoRoot"
"$NodePath" "$RepoRoot\dist-cli\index.js" --config "$TargetConfigPath" >>"%CX_CODEX_LOG_DIR%\cx-codex.out.log" 2>>"%CX_CODEX_LOG_DIR%\cx-codex.err.log"
"@

  Set-Content -LiteralPath $TargetLauncherPath -Value $launcherContent -Encoding ASCII
}

function Register-StartupTask {
  param(
    [string]$ResolvedTaskName,
    [string]$TargetLauncherPath
  )

  $taskRun = "cmd.exe /c `"$TargetLauncherPath`""
  $output = & schtasks.exe /Create /F /SC ONLOGON /RL HIGHEST /TN $ResolvedTaskName /TR $taskRun 2>&1
  if ($LASTEXITCODE -ne 0) {
    $details = ($output | Out-String).Trim()
    throw "Failed to create scheduled task $ResolvedTaskName. $details"
  }
}

function Register-WatchdogTask {
  param(
    [string]$ResolvedTaskName,
    [string]$RepoRoot,
    [int]$TargetPort,
    [string]$TargetConfigPath,
    [string]$NodePath
  )

  $watchdogScript = Join-Path $RepoRoot "scripts\watchdog-7420.ps1"
  if (-not (Test-Path -LiteralPath $watchdogScript)) {
    throw "Watchdog script not found: $watchdogScript"
  }

  $taskRun = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`" -Port $TargetPort -ConfigPath `"$TargetConfigPath`" -NodePath `"$NodePath`" -RepoRoot `"$RepoRoot`""
  $output = & schtasks.exe /Create /F /SC MINUTE /MO 1 /TN $ResolvedTaskName /TR $taskRun 2>&1
  if ($LASTEXITCODE -ne 0) {
    $details = ($output | Out-String).Trim()
    throw "Failed to create scheduled task $ResolvedTaskName. $details"
  }
}

function Test-HealthEndpoint {
  param([int]$TargetPort)
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/health" -UseBasicParsing -TimeoutSec 5
    return $response.Content
  } catch {
    return $null
  }
}

function Wait-ForHealthEndpoint {
  param(
    [int]$TargetPort,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $content = Test-HealthEndpoint -TargetPort $TargetPort
    if ($content) {
      return $content
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  return $null
}

function Resolve-CloudflaredCommand {
  param([string]$PreferredCommand = "")

  if (-not [string]::IsNullOrWhiteSpace($PreferredCommand)) {
    $preferred = Resolve-OptionalPath -Value $PreferredCommand
    $version = & $preferred --version 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($version)) {
      return $preferred
    }
  }

  try {
    $command = Get-Command cloudflared -ErrorAction Stop
    $version = & $command.Source --version 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($version)) {
      return $command.Source
    }
  } catch {}

  $localCandidate = Join-Path $env:USERPROFILE ".local\bin\cloudflared.exe"
  if (Test-Path -LiteralPath $localCandidate) {
    $version = & $localCandidate --version 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($version)) {
      return $localCandidate
    }
  }

  return $null
}

function Install-CloudflaredWindows {
  param([string]$PreferredCommand = "")

  $existing = Resolve-CloudflaredCommand -PreferredCommand $PreferredCommand
  if ($existing) {
    Write-Host "cloudflared already available: $existing"
    return $existing
  }

  $archAsset = if ([Environment]::Is64BitOperatingSystem) { "cloudflared-windows-amd64.exe" } else { "cloudflared-windows-386.exe" }
  $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/$archAsset"
  $targetDir = Join-Path $env:USERPROFILE ".local\bin"
  $targetPath = Join-Path $targetDir "cloudflared.exe"

  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Write-Host "Downloading cloudflared: $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $targetPath

  $version = & $targetPath --version 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
    throw "cloudflared download completed but verification failed: $targetPath"
  }

  Write-Host "cloudflared installed: $targetPath"
  return $targetPath
}

function Ensure-CloudflaredForTunnel {
  param([string]$PreferredCommand = "")

  if (-not $Tunnel) {
    if ($InstallCloudflared) {
      return Install-CloudflaredWindows -PreferredCommand $PreferredCommand
    }
    return $null
  }

  $existing = Resolve-CloudflaredCommand -PreferredCommand $PreferredCommand
  if ($existing) {
    Write-Host "cloudflared available: $existing"
    return $existing
  }

  if ($InstallCloudflared) {
    return Install-CloudflaredWindows -PreferredCommand $PreferredCommand
  }

  Write-Warning "Tunnel is enabled but cloudflared was not found. Re-run with -InstallCloudflared, or install Cloudflare.cloudflared manually."
  return $null
}

function Wait-ForTunnelUrlFromLog {
  param(
    [string]$LogPath,
    [int]$TimeoutSeconds = 45
  )

  if ([string]::IsNullOrWhiteSpace($LogPath)) {
    return $null
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $pattern = "https://[^\s]+\.trycloudflare\.com"
  do {
    if (Test-Path -LiteralPath $LogPath) {
      $content = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
      if ($content -match $pattern) {
        return $Matches[0]
      }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  return $null
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommandInfo = Get-Command npm -ErrorAction Stop
$npmExecutable = Resolve-NpmExecutable -CommandInfo $npmCommandInfo

Write-Host "Using repo root: $repoRoot"
Write-Host "Using node: $($nodeCommand.Source)"
Write-Host "Using npm:  $npmExecutable"

Push-Location $repoRoot
try {
  $env:npm_config_loglevel = "error"
  $env:npm_config_fund = "false"
  $env:npm_config_audit = "false"

  if (-not $SkipNpmInstall) {
    Write-Step "Installing npm dependencies"
    $installCommand = if (Test-Path -LiteralPath (Join-Path $repoRoot "package-lock.json")) { "ci" } else { "install" }
    & $npmExecutable $installCommand
    if ($LASTEXITCODE -ne 0) {
      throw "npm $installCommand failed with exit code $LASTEXITCODE"
    }
  }

  if (-not $SkipBuild) {
    Write-Step "Building CX-Codex"
    & $npmExecutable run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed with exit code $LASTEXITCODE"
    }
  }
} finally {
  Pop-Location
}

$resolvedProjectPath = Ensure-ProjectDirectory -TargetPath $ProjectPath -CreateIfMissing:$CreateProjectPath.IsPresent
$resolvedCodexCommand = Resolve-OptionalPath -Value $CodexCommand
$resolvedRipgrepCommand = Resolve-OptionalPath -Value $RipgrepCommand
$resolvedCloudflaredCommand = Resolve-OptionalPath -Value $CloudflaredCommand
$resolvedTaskName = if ([string]::IsNullOrWhiteSpace($TaskName)) { "CodexUI-$Port" } else { $TaskName }
$resolvedWatchdogTaskName = if ([string]::IsNullOrWhiteSpace($WatchdogTaskName)) { "CodexUI-$Port-Watchdog" } else { $WatchdogTaskName }

if ($NoPassword) {
  $passwordValue = $false
} elseif ([string]::IsNullOrWhiteSpace($Password)) {
  $passwordValue = New-StablePassword
} else {
  $passwordValue = $Password
}

if ($EnsureCodexLogin) {
  Ensure-CodexLogin -NodePath $nodeCommand.Source -RepoRoot $repoRoot
}

if ($Tunnel -or $InstallCloudflared) {
  Write-Step "Preparing cloudflared"
  $resolvedCloudflaredCommand = Ensure-CloudflaredForTunnel -PreferredCommand $resolvedCloudflaredCommand
}

$configDir = Split-Path -Parent $ConfigPath
if (-not [string]::IsNullOrWhiteSpace($configDir)) {
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$config = [ordered]@{
  host = $BindHost
  port = $Port
  password = $passwordValue
  tunnel = $Tunnel.IsPresent
  open = $OpenBrowser.IsPresent
}

if ($resolvedProjectPath) {
  $config.projectPath = $resolvedProjectPath
}
if ($resolvedCodexCommand) {
  $config.codexCommand = $resolvedCodexCommand
}
if ($resolvedRipgrepCommand) {
  $config.ripgrepCommand = $resolvedRipgrepCommand
}
if ($resolvedCloudflaredCommand) {
  $config.cloudflaredCommand = $resolvedCloudflaredCommand
}

$configJson = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  $ConfigPath,
  $configJson,
  (New-Object System.Text.UTF8Encoding($false))
)
Create-LauncherFile -TargetLauncherPath $LauncherPath -NodePath $nodeCommand.Source -RepoRoot $repoRoot -TargetConfigPath $ConfigPath

if ($CreateStartupTask) {
  Write-Step "Creating startup task"
  try {
    Register-StartupTask -ResolvedTaskName $resolvedTaskName -TargetLauncherPath $LauncherPath
    Write-Host "Scheduled task created: $resolvedTaskName"
  } catch {
    Write-Warning $_
  }
}

if ($CreateWatchdogTask) {
  Write-Step "Creating watchdog task"
  try {
    Register-WatchdogTask -ResolvedTaskName $resolvedWatchdogTaskName -RepoRoot $repoRoot -TargetPort $Port -TargetConfigPath $ConfigPath -NodePath $nodeCommand.Source
    Write-Host "Watchdog task created: $resolvedWatchdogTaskName"
  } catch {
    Write-Warning $_
  }
}

if ($OpenFirewall) {
  Write-Step "Opening firewall port"
  $ruleName = if ([string]::IsNullOrWhiteSpace($FirewallRuleName)) { "cx-codex-$Port" } else { $FirewallRuleName }
  try {
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existingRule) {
      Remove-NetFirewallRule -DisplayName $ruleName | Out-Null
    }
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    Write-Host "Firewall rule created: $ruleName"
  } catch {
    Write-Warning "Could not update firewall rule. Run PowerShell as Administrator if you want to open the port automatically."
  }
}

$healthPayload = $null
if ($StartNow) {
  Write-Step "Starting CX-Codex"
  $canStart = Stop-ExistingCodexUiProcesses -TargetPort $Port -RepoRoot $repoRoot -TargetLauncherPath $LauncherPath -TargetConfigPath $ConfigPath
  if ($canStart) {
    Start-Process -FilePath $LauncherPath | Out-Null
    $healthPayload = Wait-ForHealthEndpoint -TargetPort $Port
  } else {
    Write-Warning "Skipped auto-start because port $Port is already in use by another process."
  }
}

$logDir = "$env:USERPROFILE\.cx-codex\logs"
$outLogPath = Join-Path $logDir "cx-codex.out.log"
$accessUrls = Get-AccessibleUrls -BindHostValue $BindHost -TargetPort $Port
$tunnelUrl = if ($Tunnel -and $StartNow) { Wait-ForTunnelUrlFromLog -LogPath $outLogPath } else { $null }

Write-Host ""
Write-Host "Install complete."
Write-Host "Config:   $ConfigPath"
Write-Host "Launcher: $LauncherPath"
Write-Host "Logs:     $logDir"
if ($resolvedProjectPath) {
  Write-Host "Project:  $resolvedProjectPath"
}
foreach ($url in $accessUrls) {
  Write-Host "Browse:   $url"
}
Write-Host "Health:   http://127.0.0.1:$Port/health"
Write-Host "Bridge:   http://127.0.0.1:$Port/codex-api/health"
if ($Tunnel) {
  if ($tunnelUrl) {
    Write-Host "Tunnel:   $tunnelUrl"
  } else {
    Write-Host "Tunnel:   enabled; check $outLogPath for the trycloudflare.com URL"
  }
}
if ($resolvedCloudflaredCommand) {
  Write-Host "cloudflared: $resolvedCloudflaredCommand"
}
if ($passwordValue -is [string]) {
  Write-Host "Password: $passwordValue"
} elseif ($passwordValue -eq $false) {
  Write-Host "Password: disabled"
}
if ($CreateStartupTask) {
  Write-Host "Task:     $resolvedTaskName"
}
if ($CreateWatchdogTask) {
  Write-Host "Watchdog: $resolvedWatchdogTaskName"
}
if ($healthPayload) {
  Write-Host "Status:   health check passed"
} elseif ($StartNow) {
  Write-Warning "Health check did not succeed yet. If this is the first run, check the browser login flow or logs in $logDir."
}
