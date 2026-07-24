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
  [string]$ReleaseVersion = "latest",
  [switch]$UseBranchArchive,
  [switch]$RemoteQuick,
  [switch]$JsonOutput,
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
$MinimumNodeVersion = [Version]"22.13.0"
$MinimumNpmVersion = [Version]"9.0.0"

if ($RemoteQuick) {
  if ($NoPassword) {
    throw "RemoteQuick requires password protection. Remove -NoPassword and try again."
  }
  $BindHost = "127.0.0.1"
  $EnableCloudflareTunnel = $true
  $SkipCloudflaredInstall = $false
  $SkipFirewall = $true
  $SkipStartupTask = $true
  $SkipWatchdogTask = $true
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Green
}

function Get-ToolVersionObject {
  param(
    [object]$VersionOutput,
    [string]$ToolName
  )
  $text = (@($VersionOutput) | ForEach-Object { [string]$_ }) -join "`n"
  $match = [Regex]::Match($text, "(?m)^\s*v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\s*$")
  if (-not $match.Success) {
    throw "Could not parse $ToolName version output."
  }
  return [Version]$match.Groups[1].Value
}

function Get-NodeVersionObject {
  param([object]$VersionText)
  return Get-ToolVersionObject -VersionOutput $VersionText -ToolName "Node.js"
}

function Get-NpmVersionObject {
  param([object]$VersionText)
  return Get-ToolVersionObject -VersionOutput $VersionText -ToolName "npm"
}

function Get-PortableNodeRuntime {
  param([string]$TargetBaseDir)

  Write-Step "Installing portable Node.js"
  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -Headers @{ "User-Agent" = "cx-codex-bootstrap" }
  $release = $index |
    Where-Object {
      $_.lts -and
      ($_.files -contains "win-x64-zip") -and
      ((Get-NodeVersionObject -VersionText ([string]$_.version)) -ge $MinimumNodeVersion)
    } |
    Select-Object -First 1

  if (-not $release) {
    throw "Could not resolve a portable Windows Node.js LTS build."
  }

  $version = [string]$release.version
  $zipName = "node-$($version)-win-x64.zip"
  $downloadUrl = "https://nodejs.org/dist/$version/$zipName"
  $checksumsUrl = "https://nodejs.org/dist/$version/SHASUMS256.txt"
  $runtimeRoot = Join-Path $TargetBaseDir ".runtime"
  $extractRoot = Join-Path $runtimeRoot "extract"
  $zipPath = Join-Path $env:TEMP "$PID-$zipName"

  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

  $checksums = (Invoke-WebRequest -Uri $checksumsUrl -Headers @{ "User-Agent" = "cx-codex-bootstrap" }).Content
  $escapedZipName = [Regex]::Escape($zipName)
  $checksumMatch = [Regex]::Match($checksums, "(?m)^([a-fA-F0-9]{64})\s+\*?$escapedZipName$")
  if (-not $checksumMatch.Success) {
    throw "Could not resolve the official Node.js SHA-256 checksum for $zipName."
  }
  $expectedChecksum = $checksumMatch.Groups[1].Value.ToLowerInvariant()

  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
    $actualChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
    if ($actualChecksum -ne $expectedChecksum) {
      throw "Node.js SHA-256 verification failed for $zipName."
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  } finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  }

  $nodeRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1 -ExpandProperty FullName
  if (-not $nodeRoot) {
    throw "Portable Node.js extraction failed."
  }

  return @{
    Node = Join-Path $nodeRoot "node.exe"
    Npm = Join-Path $nodeRoot "npm.cmd"
    NpmCli = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
    Root = $nodeRoot
  }
}

function Ensure-NodeRuntime {
  try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $versionText = & $nodeCommand.Source --version
    $version = Get-NodeVersionObject -VersionText $versionText
    if ($version -ge $MinimumNodeVersion) {
      $nodeRoot = Split-Path -Parent $nodeCommand.Source
      $npmCli = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
      $npmExecutable = ""
      if (Test-Path -LiteralPath $npmCli) {
        $npmVersionText = & $nodeCommand.Source $npmCli --version
      } else {
        $npmCommand = Get-Command npm -ErrorAction Stop
        $npmExecutable = $npmCommand.Source
        $npmVersionText = & $npmExecutable --version
      }

      $npmVersion = Get-NpmVersionObject -VersionText $npmVersionText
      if ($npmVersion -ge $MinimumNpmVersion) {
        return @{
          Node = $nodeCommand.Source
          Npm = if ($npmExecutable) { $npmExecutable } else { Join-Path $nodeRoot "npm.cmd" }
          NpmCli = if (Test-Path -LiteralPath $npmCli) { $npmCli } else { "" }
          Root = $nodeRoot
        }
      }
    }
  } catch {}

  return Get-PortableNodeRuntime -TargetBaseDir $InstallDir
}

function Get-RepoArchiveUrl {
  return "https://github.com/$RepoOwner/$RepoName/archive/refs/heads/$Branch.zip"
}

function Get-Sha256Hex {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Assert-SafeInstallDirectory {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
  $driveRoot = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
  $blocked = @(
    $driveRoot,
    [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
  )
  if ($blocked -contains $fullPath) {
    throw "Unsafe install directory: $fullPath"
  }
  return $fullPath
}

function Get-VerifiedReleaseArchive {
  param([string]$TargetZipPath)

  $headers = @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "CX-Codex-bootstrap"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $releaseApi = if ($ReleaseVersion -eq "latest") {
    "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
  } else {
    $tag = if ($ReleaseVersion.StartsWith("v")) { $ReleaseVersion } else { "v$ReleaseVersion" }
    "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$tag"
  }

  Write-Step "Resolving verified CX-Codex release"
  $release = Invoke-RestMethod -Uri $releaseApi -Headers $headers
  if ($release.draft -or $release.prerelease) {
    throw "Refusing draft or prerelease build: $($release.tag_name)"
  }

  $zipAsset = $release.assets |
    Where-Object { $_.name -like "CX-Codex-*.zip" } |
    Select-Object -First 1
  $checksumAsset = $release.assets |
    Where-Object { $_.name -eq "$([System.IO.Path]::GetFileNameWithoutExtension([string]$zipAsset.name)).sha256" } |
    Select-Object -First 1
  if (-not $zipAsset -or -not $checksumAsset) {
    throw "Release $($release.tag_name) does not contain a CX-Codex zip and matching SHA-256 file."
  }

  $checksumPath = "$TargetZipPath.sha256"
  Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $TargetZipPath
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath
  $checksumText = Get-Content -LiteralPath $checksumPath -Raw
  if ($checksumText -notmatch "(?i)\b([a-f0-9]{64})\b") {
    throw "Release checksum file is invalid: $($checksumAsset.name)"
  }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = Get-Sha256Hex -Path $TargetZipPath
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $TargetZipPath -Force -ErrorAction SilentlyContinue
    throw "Release SHA-256 verification failed: $($zipAsset.name)"
  }

  return @{
    Tag = [string]$release.tag_name
    Asset = [string]$zipAsset.name
    Sha256 = $actual
  }
}

function Install-RepositoryAtomically {
  param(
    [string]$ExpandedRepo,
    [string]$TargetInstallDir
  )

  $safeInstallDir = Assert-SafeInstallDirectory -Path $TargetInstallDir
  $parentDir = Split-Path -Parent $safeInstallDir
  $stagingDir = "$safeInstallDir.staging-$PID"
  $backupDir = "$safeInstallDir.previous"

  if (-not $stagingDir.StartsWith("$parentDir\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid staging directory: $stagingDir"
  }
  if (-not $backupDir.StartsWith("$parentDir\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid backup directory: $backupDir"
  }

  if (Test-Path -LiteralPath $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }
  Move-Item -LiteralPath $ExpandedRepo -Destination $stagingDir

  if (Test-Path -LiteralPath $backupDir) {
    Remove-Item -LiteralPath $backupDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $safeInstallDir) {
    Move-Item -LiteralPath $safeInstallDir -Destination $backupDir
  }

  try {
    Move-Item -LiteralPath $stagingDir -Destination $safeInstallDir
  } catch {
    if (Test-Path -LiteralPath $backupDir) {
      Move-Item -LiteralPath $backupDir -Destination $safeInstallDir
    }
    throw
  }
  return (Resolve-Path -LiteralPath $safeInstallDir).Path
}

function Acquire-Repository {
  if (-not [string]::IsNullOrWhiteSpace($SourceRepoRoot)) {
    return (Resolve-Path -LiteralPath $SourceRepoRoot).Path
  }

  $safeInstallDir = Assert-SafeInstallDirectory -Path $InstallDir
  $parentDir = Split-Path -Parent $safeInstallDir
  if (-not [string]::IsNullOrWhiteSpace($parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }

  $sourceLabel = if ($UseBranchArchive) { $Branch } else { $ReleaseVersion }
  $zipPath = Join-Path $env:TEMP "$RepoName-$sourceLabel-$PID.zip"
  $extractRoot = Join-Path $env:TEMP "$RepoName-$sourceLabel-$PID-extract"
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

  if ($UseBranchArchive) {
    Write-Warning "Using an unverified branch archive. Prefer the default verified GitHub Release flow."
    Invoke-WebRequest -Uri (Get-RepoArchiveUrl) -OutFile $zipPath
  } else {
    $releaseInfo = Get-VerifiedReleaseArchive -TargetZipPath $zipPath
    Write-Host "Verified release: $($releaseInfo.Tag) ($($releaseInfo.Sha256))"
  }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

  $expandedRepo = if (Test-Path -LiteralPath (Join-Path $extractRoot "package.json")) {
    $extractRoot
  } else {
    Get-ChildItem -LiteralPath $extractRoot -Directory |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "package.json") } |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $expandedRepo) {
    throw "Could not locate extracted repository contents."
  }

  return Install-RepositoryAtomically -ExpandedRepo $expandedRepo -TargetInstallDir $safeInstallDir
}

$repoRoot = Acquire-Repository
$runtime = Ensure-NodeRuntime
$env:PATH = "$($runtime.Root);$env:PATH"

Write-Host "Using node: $($runtime.Node)"
Write-Host "Using npm:  $($runtime.Npm)"

$installScript = Join-Path $repoRoot "scripts\install-windows-server.ps1"
if (-not (Test-Path -LiteralPath $installScript)) {
  throw "Install script not found: $installScript"
}

$invokeArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $installScript,
  "-ProjectPath", $WorkspacePath,
  "-CreateProjectPath",
  "-Port", "$Port",
  "-BindHost", $BindHost,
  "-ConfigPath", "$env:USERPROFILE\.cx-codex\config.json",
  "-LauncherPath", "$env:USERPROFILE\.local\bin\cx-codex-start.cmd",
  "-NodeCommand", $runtime.Node,
  "-NpmCommand", $runtime.Npm
)
if (-not [string]::IsNullOrWhiteSpace($runtime.NpmCli)) {
  $invokeArgs += @("-NpmCliPath", $runtime.NpmCli)
}

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
if ($JsonOutput) {
  $invokeArgs += "-JsonOutput"
}

Write-Step "Running installer"
& powershell.exe @invokeArgs
$installerExitCode = $LASTEXITCODE
if ($installerExitCode -ne 0) {
  if ([string]::IsNullOrWhiteSpace($SourceRepoRoot)) {
    $safeInstallDir = Assert-SafeInstallDirectory -Path $InstallDir
    $backupDir = "$safeInstallDir.previous"
    $failedDir = "$safeInstallDir.failed-$PID"
    if (Test-Path -LiteralPath $backupDir) {
      if (Test-Path -LiteralPath $safeInstallDir) {
        Move-Item -LiteralPath $safeInstallDir -Destination $failedDir
      }
      Move-Item -LiteralPath $backupDir -Destination $safeInstallDir
      Write-Warning "Installation failed; restored the previous CX-Codex version. Failed files remain at $failedDir"
    } elseif (Test-Path -LiteralPath $safeInstallDir) {
      Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
      Write-Warning "Installation failed; removed the incomplete new installation."
    }
  }
  throw "Installer failed with exit code $installerExitCode"
}

if (-not $JsonOutput) {
  Write-Host ""
  Write-Host "Bootstrap complete." -ForegroundColor Green
  Write-Host "Install dir: $repoRoot"
  Write-Host "Launcher:    $env:USERPROFILE\.local\bin\cx-codex-start.cmd"
  Write-Host "Logs:        $env:USERPROFILE\.cx-codex\logs"
  if ($EnableCloudflareTunnel) {
    Write-Host "Tunnel:      enabled; open the trycloudflare.com URL printed above or in cx-codex.out.log"
  }
}
