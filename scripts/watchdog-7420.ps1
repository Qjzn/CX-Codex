[CmdletBinding()]
param(
  [int]$Port = 7420,
  [string]$ConfigPath = "$env:USERPROFILE\.cx-codex\config.json",
  [string]$RepoRoot = "",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$BindHealthHost = "127.0.0.1",
  [int]$FailureThreshold = 2,
  [string]$PublicHealthUrl = "",
  [string]$StatePath = "$env:USERPROFILE\.cx-codex\cx-codex-7420-watchdog.state.json",
  [string]$LogPath = "$env:USERPROFILE\.cx-codex\cx-codex-7420-watchdog.log"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  param([string]$Value)
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    return (Resolve-Path -LiteralPath $Value).Path
  }
  return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function Resolve-NodePath {
  param([string]$Preferred)
  if (-not [string]::IsNullOrWhiteSpace($Preferred) -and (Test-Path -LiteralPath $Preferred)) {
    return (Resolve-Path -LiteralPath $Preferred).Path
  }
  $command = Get-Command node -ErrorAction Stop
  return $command.Source
}

function Write-WatchdogLog {
  param([string]$Message)
  $logDir = Split-Path -Parent $LogPath
  if (-not [string]::IsNullOrWhiteSpace($logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  }
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Read-WatchdogState {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return [PSCustomObject]@{
      localFailures = 0
      publicFailures = 0
      lastRestartAt = ""
      lastLocalOkAt = ""
      lastPublicOkAt = ""
    }
  }

  try {
    return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  } catch {
    return [PSCustomObject]@{
      localFailures = 0
      publicFailures = 0
      lastRestartAt = ""
      lastLocalOkAt = ""
      lastPublicOkAt = ""
    }
  }
}

function Write-WatchdogState {
  param([object]$State)
  $stateDir = Split-Path -Parent $StatePath
  if (-not [string]::IsNullOrWhiteSpace($stateDir)) {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  }
  $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Test-HealthUrl {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

$resolvedRepoRoot = Resolve-RepoRoot -Value $RepoRoot
$resolvedNodePath = Resolve-NodePath -Preferred $NodePath
$restartScript = Join-Path $resolvedRepoRoot "scripts\restart-local-service.ps1"
if (-not (Test-Path -LiteralPath $restartScript)) {
  throw "Missing restart script: $restartScript"
}

$state = Read-WatchdogState
$localHealthUrl = "http://$BindHealthHost`:$Port/health"
$localOk = Test-HealthUrl -Url $localHealthUrl

if ($localOk) {
  $state.localFailures = 0
  $state.lastLocalOkAt = (Get-Date).ToString("o")
} else {
  $state.localFailures = [int]$state.localFailures + 1
  Write-WatchdogLog "local health failed count=$($state.localFailures) url=$localHealthUrl"
}

if (-not $localOk -and [int]$state.localFailures -ge [Math]::Max(1, $FailureThreshold)) {
  Write-WatchdogLog "restarting local CX-Codex service port=$Port"
  try {
    & $restartScript -Port $Port -ConfigPath $ConfigPath -NodePath $resolvedNodePath -BindHealthHost $BindHealthHost | Out-String |
      ForEach-Object {
        $text = $_.Trim()
        if ($text) {
          Write-WatchdogLog "restart result: $text"
        }
      }
    $state.localFailures = 0
    $state.lastRestartAt = (Get-Date).ToString("o")
  } catch {
    Write-WatchdogLog "restart failed: $($_.Exception.Message)"
  }
}

if (-not [string]::IsNullOrWhiteSpace($PublicHealthUrl)) {
  $publicOk = Test-HealthUrl -Url $PublicHealthUrl
  if ($publicOk) {
    $state.publicFailures = 0
    $state.lastPublicOkAt = (Get-Date).ToString("o")
  } else {
    $state.publicFailures = [int]$state.publicFailures + 1
    if ([int]$state.publicFailures -eq 1 -or [int]$state.publicFailures % 10 -eq 0) {
      Write-WatchdogLog "public health failed count=$($state.publicFailures) url=$PublicHealthUrl"
    }
  }
}

Write-WatchdogState -State $state
