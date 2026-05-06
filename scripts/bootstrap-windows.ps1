[CmdletBinding()]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\CX-Codex",
  [string]$WorkspacePath = "$env:USERPROFILE\CodexWorkspace",
  [int]$Port = 7420,
  [string]$BindHost = "0.0.0.0",
  [string]$Password = "",
  [switch]$NoPassword,
  [string]$RepoOwner = "Qjzn",
  [string]$RepoName = "CX-Codex",
  [string]$Branch = "main",
  [switch]$SkipStartupTask,
  [switch]$SkipWatchdogTask,
  [switch]$SkipFirewall,
  [switch]$SkipLogin,
  [switch]$EnableCloudflareTunnel,
  [switch]$SkipCloudflaredInstall,
  [string]$CloudflaredCommand = "",
  [switch]$NoStart,
  [string]$SourceRepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Green
}

function Get-NodeVersionObject {
  param([string]$VersionText)
  $clean = $VersionText.Trim().TrimStart('v')
  return [Version]$clean
}

function Get-PortableNodeRuntime {
  param([string]$TargetBaseDir)

  Write-Step "Installing portable Node.js"
  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -Headers @{ "User-Agent" = "cx-codex-bootstrap" }
  $release = $index |
    Where-Object { $_.lts -and ($_.files -contains "win-x64-zip") } |
    Select-Object -First 1

  if (-not $release) {
    throw "Could not resolve a portable Windows Node.js LTS build."
  }

  $version = [string]$release.version
  $zipName = "node-$($version)-win-x64.zip"
  $downloadUrl = "https://nodejs.org/dist/$version/$zipName"
  $runtimeRoot = Join-Path $TargetBaseDir ".runtime"
  $extractRoot = Join-Path $runtimeRoot "extract"
  $zipPath = Join-Path $env:TEMP $zipName

  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

  $nodeRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1 -ExpandProperty FullName
  if (-not $nodeRoot) {
    throw "Portable Node.js extraction failed."
  }

  return @{
    Node = Join-Path $nodeRoot "node.exe"
    Npm = Join-Path $nodeRoot "npm.cmd"
    Root = $nodeRoot
  }
}

function Ensure-NodeRuntime {
  try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $versionText = & $nodeCommand.Source --version
    $version = Get-NodeVersionObject -VersionText $versionText
    if ($version.Major -ge 18) {
      $npmCommand = Get-Command npm -ErrorAction Stop
      return @{
        Node = $nodeCommand.Source
        Npm = $npmCommand.Source
        Root = Split-Path -Parent $nodeCommand.Source
      }
    }
  } catch {}

  return Get-PortableNodeRuntime -TargetBaseDir $InstallDir
}

function Get-RepoArchiveUrl {
  return "https://github.com/$RepoOwner/$RepoName/archive/refs/heads/$Branch.zip"
}

function Acquire-Repository {
  if (-not [string]::IsNullOrWhiteSpace($SourceRepoRoot)) {
    return (Resolve-Path -LiteralPath $SourceRepoRoot).Path
  }

  Write-Step "Downloading repository"
  $parentDir = Split-Path -Parent $InstallDir
  if (-not [string]::IsNullOrWhiteSpace($parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }

  $zipPath = Join-Path $env:TEMP "$RepoName-$Branch.zip"
  $extractRoot = Join-Path $env:TEMP "$RepoName-$Branch-extract"
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

  Invoke-WebRequest -Uri (Get-RepoArchiveUrl) -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

  $expandedRepo = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1 -ExpandProperty FullName
  if (-not $expandedRepo) {
    throw "Could not locate extracted repository contents."
  }

  if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  }

  Move-Item -LiteralPath $expandedRepo -Destination $InstallDir
  return (Resolve-Path -LiteralPath $InstallDir).Path
}

$runtime = Ensure-NodeRuntime
$env:PATH = "$($runtime.Root);$env:PATH"

Write-Host "Using node: $($runtime.Node)"
Write-Host "Using npm:  $($runtime.Npm)"

$repoRoot = Acquire-Repository
$installScript = Join-Path $repoRoot "scripts\install-windows-server.ps1"
if (-not (Test-Path -LiteralPath $installScript)) {
  throw "Install script not found: $installScript"
}

$invokeArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $installScript,
  "-ProjectPath", $WorkspacePath,
  "-CreateProjectPath",
  "-Port", "$Port",
  "-BindHost", $BindHost,
  "-ConfigPath", "$env:USERPROFILE\.cx-codex\config.json",
  "-LauncherPath", "$env:USERPROFILE\.local\bin\cx-codex-start.cmd"
)

if ($NoPassword) {
  $invokeArgs += "-NoPassword"
} elseif (-not [string]::IsNullOrWhiteSpace($Password)) {
  $invokeArgs += @("-Password", $Password)
}
if (-not $SkipFirewall) {
  $invokeArgs += "-OpenFirewall"
}
if (-not $SkipStartupTask) {
  $invokeArgs += "-CreateStartupTask"
}
if (-not $SkipWatchdogTask) {
  $invokeArgs += "-CreateWatchdogTask"
}
if (-not $SkipLogin) {
  $invokeArgs += "-EnsureCodexLogin"
}
if ($EnableCloudflareTunnel) {
  $invokeArgs += "-Tunnel"
  if (-not $SkipCloudflaredInstall) {
    $invokeArgs += "-InstallCloudflared"
  }
}
if (-not [string]::IsNullOrWhiteSpace($CloudflaredCommand)) {
  $invokeArgs += @("-CloudflaredCommand", $CloudflaredCommand)
}
if (-not $NoStart) {
  $invokeArgs += "-StartNow"
}

Write-Step "Running installer"
& powershell.exe @invokeArgs
if ($LASTEXITCODE -ne 0) {
  throw "Installer failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
Write-Host "Install dir: $repoRoot"
Write-Host "Launcher:    $env:USERPROFILE\.local\bin\cx-codex-start.cmd"
Write-Host "Logs:        $env:USERPROFILE\.cx-codex\logs"
if ($EnableCloudflareTunnel) {
  Write-Host "Tunnel:      enabled; open the trycloudflare.com URL printed above or in cx-codex.out.log"
}
