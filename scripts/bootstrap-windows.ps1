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
  [switch]$SkipOpenPairing,
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
$script:StoppedExistingServerForUpgrade = $false
$script:UpgradeRecoveryAttempted = $false

trap {
  $message = if ($_.Exception -and $_.Exception.Message) {
    [string]$_.Exception.Message
  } else {
    [string]$_
  }

  $recoveryCommand = Get-Command Restore-ManagedServiceAfterBootstrapFailure -CommandType Function -ErrorAction SilentlyContinue
  if ($recoveryCommand) {
    Restore-ManagedServiceAfterBootstrapFailure
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

function Invoke-InstallerWithProgress {
  param(
    [string]$InstallerPath,
    [string[]]$Arguments
  )

  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
  $captureRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $tempRoot "cx-codex-bootstrap-installer-$PID")
  ).TrimEnd('\')
  if (-not $captureRoot.StartsWith("$tempRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe installer capture directory: $captureRoot"
  }

  if (Test-Path -LiteralPath $captureRoot) {
    Remove-Item -LiteralPath $captureRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $captureRoot -Force | Out-Null

  $stdoutPath = Join-Path $captureRoot "stdout.log"
  $stderrPath = Join-Path $captureRoot "stderr.log"
  $rawArguments = @(
    "-NoProfile",
    "-OutputFormat", "Text",
    "-ExecutionPolicy", "Bypass",
    "-File", $InstallerPath
  ) + $Arguments
  $argumentList = @(
    $rawArguments | ForEach-Object {
      '"' + ([string]$_).Replace('"', '\"') + '"'
    }
  )
  $process = $null
  $publishedStderrCharacters = 0
  $startedAt = Get-Date
  $nextHeartbeatAt = $startedAt.AddSeconds(15)

  try {
    $process = Start-Process `
      -FilePath "powershell.exe" `
      -ArgumentList $argumentList `
      -WindowStyle Hidden `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    while (-not $process.HasExited) {
      Start-Sleep -Milliseconds 250
      $process.Refresh()

      $stderrText = if (Test-Path -LiteralPath $stderrPath) {
        [string](Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
      } else {
        ""
      }
      if ($stderrText.Length -gt $publishedStderrCharacters) {
        $pendingText = $stderrText.Substring($publishedStderrCharacters)
        $lastCompleteLine = $pendingText.LastIndexOf("`n")
        if ($lastCompleteLine -ge 0) {
          $completeText = $pendingText.Substring(0, $lastCompleteLine + 1)
          $completeText -split "\r?\n" |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { Write-BootstrapMessage ([string]$_) }
          $publishedStderrCharacters += $completeText.Length
        }
      }

      $now = Get-Date
      if ($now -ge $nextHeartbeatAt) {
        $elapsedSeconds = [Math]::Max(15, [int][Math]::Round(($now - $startedAt).TotalSeconds))
        Write-BootstrapMessage "CX-Codex is still installing ($elapsedSeconds seconds elapsed). First-time setup usually takes 2-5 minutes; keep this window open."
        $nextHeartbeatAt = $now.AddSeconds(15)
      }
    }

    $process.WaitForExit()
    $stderrText = if (Test-Path -LiteralPath $stderrPath) {
      [string](Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
    } else {
      ""
    }
    if ($stderrText.Length -gt $publishedStderrCharacters) {
      $stderrText.Substring($publishedStderrCharacters) -split "\r?\n" |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { Write-BootstrapMessage ([string]$_) }
    }

    return [ordered]@{
      ExitCode = [int]$process.ExitCode
      Stdout = if (Test-Path -LiteralPath $stdoutPath) {
        [string](Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue)
      } else {
        ""
      }
    }
  } finally {
    if ($process) {
      if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(2000) | Out-Null
      }
      $process.Dispose()
    }
    if (Test-Path -LiteralPath $captureRoot) {
      Remove-Item -LiteralPath $captureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Open-LocalPairingPage {
  param([int]$TargetPort)

  $pairingUrl = "http://127.0.0.1:$TargetPort/local-setup"
  try {
    $tunnelStatus = (
      Invoke-RestMethod `
        -Uri "http://127.0.0.1:$TargetPort/codex-api/tunnel-status" `
        -TimeoutSec 5
    ).data
    $verification = $tunnelStatus.verification
    $ready =
      [bool]$tunnelStatus.active -and
      [string]$tunnelStatus.phase -eq "ready" -and
      [bool]$verification.health -and
      [bool]$verification.auth -and
      [bool]$verification.websocketAuth
    if (-not $ready) {
      throw "The temporary public address is not ready."
    }

    $response = Invoke-WebRequest -UseBasicParsing -Uri $pairingUrl -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
      throw "The local pairing page returned HTTP $($response.StatusCode)."
    }
    Start-Process -FilePath $pairingUrl | Out-Null
    Write-BootstrapMessage "Opened the local CX-Codex management center. If no browser appeared, open $pairingUrl manually."
  } catch {
    Write-BootstrapWarning "CX-Codex is installed, but the local management center could not be opened automatically. Open $pairingUrl manually."
  }
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
    $actualChecksum = Get-Sha256Hex -Path $zipPath
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

  $fileHashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($null -ne $fileHashCommand) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha256.ComputeHash($stream)
      return ([BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
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

function Add-ProcessTreePostOrder {
  param(
    [int]$RootProcessId,
    [object[]]$Processes,
    [System.Collections.Generic.HashSet[int]]$VisitedProcessIds,
    [System.Collections.Generic.List[int]]$OrderedProcessIds
  )

  if ($RootProcessId -le 0 -or $RootProcessId -eq $PID -or -not $VisitedProcessIds.Add($RootProcessId)) {
    return
  }

  foreach ($childProcess in @($Processes | Where-Object { [int]$_.ParentProcessId -eq $RootProcessId })) {
    Add-ProcessTreePostOrder `
      -RootProcessId ([int]$childProcess.ProcessId) `
      -Processes $Processes `
      -VisitedProcessIds $VisitedProcessIds `
      -OrderedProcessIds $OrderedProcessIds
  }
  $OrderedProcessIds.Add($RootProcessId) | Out-Null
}

function Restore-ManagedServiceAfterBootstrapFailure {
  if (-not $script:StoppedExistingServerForUpgrade -or $script:UpgradeRecoveryAttempted) {
    return
  }
  $script:UpgradeRecoveryAttempted = $true

  $safeInstallDir = Assert-SafeInstallDirectory -Path $InstallDir
  if (-not (Test-Path -LiteralPath $safeInstallDir) -or -not (Test-Path -LiteralPath $ManagedLauncherPath)) {
    Write-BootstrapWarning "The previous CX-Codex service was stopped, but its installation or launcher is unavailable for automatic recovery."
    return
  }

  try {
    Start-Process `
      -FilePath $ManagedLauncherPath `
      -WorkingDirectory $safeInstallDir `
      -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    do {
      try {
        $healthResponse = Invoke-WebRequest `
          -UseBasicParsing `
          -Uri "http://127.0.0.1:$Port/health" `
          -TimeoutSec 2
        if ($healthResponse.StatusCode -eq 200) {
          Write-BootstrapWarning "Upgrade failed; restarted the previous CX-Codex service."
          return
        }
      } catch {}
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    Write-BootstrapWarning "Upgrade failed and the previous CX-Codex service did not become healthy after automatic restart."
  } catch {
    Write-BootstrapWarning "Upgrade failed and the previous CX-Codex service could not be restarted automatically: $($_.Exception.Message)"
  }
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

  $managedServerProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
  $managedTunnelProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
  $processes = @()
  try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
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

      if ($isManagedServer) {
        $managedServerProcessIds.Add($processId) | Out-Null
      }
      if ($isManagedQuickTunnel) {
        $managedTunnelProcessIds.Add($processId) | Out-Null
      }
    }
  } catch {
    Write-BootstrapWarning "Could not scan existing CX-Codex processes before the upgrade."
  }

  $recordedServerProcessId = 0
  if (Test-Path -LiteralPath $serverPidPath) {
    $recordedPidText = [string](Get-Content -LiteralPath $serverPidPath -Raw -ErrorAction SilentlyContinue)
    [int]::TryParse($recordedPidText.Trim(), [ref]$recordedServerProcessId) | Out-Null
  }
  if ($recordedServerProcessId -gt 0 -and $recordedServerProcessId -ne $PID) {
    try {
      $listenerOwners = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
          ForEach-Object { [int]$_.OwningProcess }
      )
      $recordedProcess = Get-Process -Id $recordedServerProcessId -ErrorAction SilentlyContinue
      if ($recordedProcess -and $listenerOwners -contains $recordedServerProcessId -and $recordedProcess.ProcessName -eq "node") {
        $managedServerProcessIds.Add($recordedServerProcessId) | Out-Null
      }
    } catch {
      Write-BootstrapWarning "Could not verify the recorded CX-Codex process for port $Port."
    }
  }

  if ($managedServerProcessIds.Count -eq 0 -and $managedTunnelProcessIds.Count -eq 0) {
    return
  }

  if ($managedServerProcessIds.Count -gt 0) {
    $script:StoppedExistingServerForUpgrade = $true
  }
  $visitedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
  $orderedProcessIds = New-Object 'System.Collections.Generic.List[int]'
  foreach ($managedServerProcessId in $managedServerProcessIds) {
    Add-ProcessTreePostOrder `
      -RootProcessId $managedServerProcessId `
      -Processes $processes `
      -VisitedProcessIds $visitedProcessIds `
      -OrderedProcessIds $orderedProcessIds
  }
  foreach ($managedTunnelProcessId in $managedTunnelProcessIds) {
    Add-ProcessTreePostOrder `
      -RootProcessId $managedTunnelProcessId `
      -Processes $processes `
      -VisitedProcessIds $visitedProcessIds `
      -OrderedProcessIds $orderedProcessIds
  }

  Write-Step "Stopping existing CX-Codex service"
  foreach ($managedProcessId in $orderedProcessIds) {
    Stop-Process -Id $managedProcessId -Force -ErrorAction SilentlyContinue
  }

  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remainingProcessIds = @(
      $orderedProcessIds |
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
  Write-BootstrapMessage "Stopped existing CX-Codex process tree: $($orderedProcessIds.Count)"
}

function Move-DirectoryWithRetry {
  param(
    [string]$Source,
    [string]$Destination,
    [int]$MaxAttempts = 20,
    [int]$DelayMilliseconds = 250
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Move-Item -LiteralPath $Source -Destination $Destination
      return
    } catch {
      if ($attempt -eq $MaxAttempts) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
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
  Move-DirectoryWithRetry -Source $ExpandedRepo -Destination $stagingDir

  if (Test-Path -LiteralPath $backupDir) {
    Remove-Item -LiteralPath $backupDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $safeInstallDir) {
    Stop-ManagedInstallationProcesses -TargetInstallDir $safeInstallDir
    Move-DirectoryWithRetry -Source $safeInstallDir -Destination $backupDir
  }

  try {
    Move-DirectoryWithRetry -Source $stagingDir -Destination $safeInstallDir
  } catch {
    if (Test-Path -LiteralPath $backupDir) {
      Move-DirectoryWithRetry -Source $backupDir -Destination $safeInstallDir
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
$installerResult = Invoke-InstallerWithProgress -InstallerPath $installScript -Arguments $invokeArgs
$installerExitCode = [int]$installerResult.ExitCode
if (-not [string]::IsNullOrWhiteSpace([string]$installerResult.Stdout)) {
  if ($JsonOutput) {
    $installerResult.Stdout -split "\r?\n" |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Write-Output
  } else {
    $installerResult.Stdout -split "\r?\n" |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { Write-BootstrapMessage ([string]$_) }
  }
}
if ($installerExitCode -ne 0) {
  if ([string]::IsNullOrWhiteSpace($SourceRepoRoot)) {
    $safeInstallDir = Assert-SafeInstallDirectory -Path $InstallDir
    $backupDir = "$safeInstallDir.previous"
    $failedDir = "$safeInstallDir.failed-$PID"
    if (Test-Path -LiteralPath $backupDir) {
      if (Test-Path -LiteralPath $safeInstallDir) {
        Move-DirectoryWithRetry -Source $safeInstallDir -Destination $failedDir
      }
      Move-DirectoryWithRetry -Source $backupDir -Destination $safeInstallDir
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

if ($RemoteQuick -and -not $SkipOpenPairing -and -not $NoStart) {
  Open-LocalPairingPage -TargetPort $Port
}

$script:BootstrapStage = "complete"
if (-not $JsonOutput) {
  Write-BootstrapMessage ""
  Write-BootstrapMessage "Bootstrap complete." -ForegroundColor Green
  Write-BootstrapMessage "Install dir: $repoRoot"
  Write-BootstrapMessage "Launcher:    $env:USERPROFILE\.local\bin\cx-codex-start.cmd"
  Write-BootstrapMessage "Logs:        $env:USERPROFILE\.cx-codex\logs"
  if ($EnableCloudflareTunnel) {
    Write-BootstrapMessage "Tunnel:      enabled; fixed Tailscale address is preferred, with a temporary Cloudflare fallback"
  }
}
