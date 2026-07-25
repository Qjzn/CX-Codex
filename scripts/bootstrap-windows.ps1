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
$script:BootstrapStage = "initialize"

trap {
  $message = if ($_.Exception -and $_.Exception.Message) {
    [string]$_.Exception.Message
  } else {
    [string]$_
  }

  if ($JsonOutput) {
    $payload = [ordered]@{
      schemaVersion = 1
      operation = "install"
      ok = $false
      error = [ordered]@{
        code = "BOOTSTRAP_FAILED"
        stage = $script:BootstrapStage
        message = $message
      }
    } | ConvertTo-Json -Depth 5 -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Error.WriteLine("error[BOOTSTRAP_FAILED][$($script:BootstrapStage)]: $message")
  }
  break
}

function Write-BootstrapMessage {
  param(
    [string]$Message,
    [ConsoleColor]$ForegroundColor = [ConsoleColor]::Gray
  )

  if ($JsonOutput) {
    [Console]::Error.WriteLine($Message)
  } else {
    Write-Host $Message -ForegroundColor $ForegroundColor
  }
}

function Write-BootstrapWarning {
  param([string]$Message)

  if ($JsonOutput) {
    [Console]::Error.WriteLine("warning: $Message")
  } else {
    Write-Warning $Message
  }
}

$ManagedStateDir = [System.IO.Path]::GetFullPath("$env:USERPROFILE\.cx-codex").TrimEnd('\')
$ManagedLauncherPath = [System.IO.Path]::GetFullPath("$env:USERPROFILE\.local\bin\cx-codex-start.cmd")
$ManagedCloudflaredDir = [System.IO.Path]::GetFullPath("$env:USERPROFILE\.local\bin").TrimEnd('\')
$StateDirExistedBeforeInstall = Test-Path -LiteralPath $ManagedStateDir
$LauncherExistedBeforeInstall = Test-Path -LiteralPath $ManagedLauncherPath
$CloudflaredPathsBeforeInstall = @(
  Get-ChildItem -LiteralPath $ManagedCloudflaredDir -Filter "cloudflared*.exe" -File -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
)

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
  Write-BootstrapMessage ""
  Write-BootstrapMessage "==> $Message" -ForegroundColor Green
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

function Test-ManagedServerCommandLine {
  param(
    [string]$CommandLine,
    [string[]]$ManagedPaths
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }

  $normalizedCommandLine = $CommandLine.Replace('\', '/')
  if ($normalizedCommandLine.IndexOf("dist-cli/index.js", [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $false
  }

  foreach ($managedPath in $ManagedPaths) {
    if ([string]::IsNullOrWhiteSpace($managedPath)) {
      continue
    }
    $normalizedManagedPath = $managedPath.Replace('\', '/')
    if ($normalizedCommandLine.IndexOf($normalizedManagedPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return $true
    }
  }
  return $false
}

function Test-CommandLineContainsPath {
  param(
    [string]$CommandLine,
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine) -or [string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }
  return $CommandLine.Replace('\', '/').IndexOf(
    $Path.Replace('\', '/'),
    [System.StringComparison]::OrdinalIgnoreCase
  ) -ge 0
}

function Stop-ManagedInstallationProcesses {
  param([string]$TargetInstallDir)

  $safeInstallDir = Assert-SafeInstallDirectory -Path $TargetInstallDir
  if (-not (Test-Path -LiteralPath $safeInstallDir)) {
    return
  }

  $configPath = Join-Path $ManagedStateDir "config.json"
  $serverPidPath = Join-Path $ManagedStateDir "cx-codex-$Port.pid"
  $configuredCloudflaredPath = ""
  if (Test-Path -LiteralPath $configPath) {
    try {
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      if ($config.cloudflaredCommand) {
        $configuredCloudflaredPath = [System.IO.Path]::GetFullPath([string]$config.cloudflaredCommand)
      }
    } catch {
      Write-BootstrapWarning "Could not read the existing CX-Codex config while preparing the upgrade."
    }
  }

  $managedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
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
      $isManagedServer = Test-ManagedServerCommandLine `
        -CommandLine $commandLine `
        -ManagedPaths @($safeInstallDir, $configPath, $ManagedLauncherPath)
      $isManagedQuickTunnel =
        $commandLine.IndexOf("cloudflared", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $commandLine.IndexOf("127.0.0.1`:$Port", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and (
          (Test-CommandLineContainsPath -CommandLine $commandLine -Path $ManagedCloudflaredDir) -or
          (Test-CommandLineContainsPath -CommandLine $commandLine -Path $configuredCloudflaredPath)
        )

      if ($isManagedServer -or $isManagedQuickTunnel) {
        $managedProcessIds.Add($processId) | Out-Null
      }
    }
  } catch {
    Write-BootstrapWarning "Could not scan existing CX-Codex processes before the upgrade."
  }

  if ($managedProcessIds.Count -eq 0) {
    return
  }

  Write-Step "Stopping existing CX-Codex service"
  foreach ($managedProcessId in $managedProcessIds) {
    Stop-Process -Id $managedProcessId -Force -ErrorAction SilentlyContinue
  }

  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remainingProcessIds = @(
      $managedProcessIds |
        Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    )
    if ($remainingProcessIds.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  if ($remainingProcessIds.Count -gt 0) {
    throw "Could not stop the existing CX-Codex service before replacing $safeInstallDir."
  }

  Remove-Item -LiteralPath $serverPidPath -Force -ErrorAction SilentlyContinue
  Write-BootstrapMessage "Stopped existing CX-Codex processes: $($managedProcessIds.Count)"
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

function Assert-RepositoryCapabilities {
  param([string]$RepoRoot)

  if (-not $RemoteQuick -and -not $JsonOutput) {
    return
  }

  $manifestPath = Join-Path $RepoRoot "release-capabilities.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Selected CX-Codex source does not declare installer capabilities. Use -UseBranchArchive for the current preview, or install a newer formal Release."
  }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "Installer capability manifest is invalid: $manifestPath"
  }
  if ([int]$manifest.schemaVersion -ne 1 -or [int]$manifest.installerContractVersion -lt 1) {
    throw "Installer capability manifest is unsupported: $manifestPath"
  }
  if ($RemoteQuick -and -not [bool]$manifest.features.remoteQuick) {
    throw "Selected CX-Codex source does not support RemoteQuick."
  }
  if ($JsonOutput -and -not [bool]$manifest.features.jsonOutput) {
    throw "Selected CX-Codex source does not support JsonOutput."
  }
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
    Stop-ManagedInstallationProcesses -TargetInstallDir $safeInstallDir
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
    Write-BootstrapWarning "Using an unverified branch archive. Prefer the default verified GitHub Release flow."
    Invoke-WebRequest -Uri (Get-RepoArchiveUrl) -OutFile $zipPath
  } else {
    $releaseInfo = Get-VerifiedReleaseArchive -TargetZipPath $zipPath
    Write-BootstrapMessage "Verified release: $($releaseInfo.Tag) ($($releaseInfo.Sha256))"
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

$script:BootstrapStage = "acquire_repository"
$repoRoot = Acquire-Repository
$script:BootstrapStage = "validate_capabilities"
Assert-RepositoryCapabilities -RepoRoot $repoRoot
$script:BootstrapStage = "prepare_runtime"
$runtime = Ensure-NodeRuntime
$env:PATH = "$($runtime.Root);$env:PATH"

Write-BootstrapMessage "Using node: $($runtime.Node)"
Write-BootstrapMessage "Using npm:  $($runtime.Npm)"

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

$script:BootstrapStage = "run_installer"
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
      Write-BootstrapWarning "Installation failed; restored the previous CX-Codex version. Failed files remain at $failedDir"
    } elseif (Test-Path -LiteralPath $safeInstallDir) {
      Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
      if (-not $StateDirExistedBeforeInstall -and (Test-Path -LiteralPath $ManagedStateDir)) {
        Remove-Item -LiteralPath $ManagedStateDir -Recurse -Force
      }
      if (-not $LauncherExistedBeforeInstall -and (Test-Path -LiteralPath $ManagedLauncherPath)) {
        Remove-Item -LiteralPath $ManagedLauncherPath -Force
      }
      $newCloudflaredFiles = Get-ChildItem -LiteralPath $ManagedCloudflaredDir -Filter "cloudflared*.exe" -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Name -match "^cloudflared(?:-[a-f0-9]{12,64})?\.exe$" -and
          $CloudflaredPathsBeforeInstall -notcontains $_.FullName
        }
      foreach ($file in $newCloudflaredFiles) {
        Remove-Item -LiteralPath $file.FullName -Force
      }
      Write-BootstrapWarning "Installation failed; removed the incomplete new installation."
    }
  }
  throw "Installer failed with exit code $installerExitCode"
}

$script:BootstrapStage = "complete"
if (-not $JsonOutput) {
  Write-BootstrapMessage ""
  Write-BootstrapMessage "Bootstrap complete." -ForegroundColor Green
  Write-BootstrapMessage "Install dir: $repoRoot"
  Write-BootstrapMessage "Launcher:    $env:USERPROFILE\.local\bin\cx-codex-start.cmd"
  Write-BootstrapMessage "Logs:        $env:USERPROFILE\.cx-codex\logs"
  if ($EnableCloudflareTunnel) {
    Write-BootstrapMessage "Tunnel:      enabled; open the trycloudflare.com URL printed above or in cx-codex.out.log"
  }
}
