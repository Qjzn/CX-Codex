[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\CX-Codex",
  [string]$StateDir = "$env:USERPROFILE\.cx-codex",
  [string]$LauncherPath = "$env:USERPROFILE\.local\bin\cx-codex-start.cmd",
  [string]$ManagedBinDir = "$env:USERPROFILE\.local\bin",
  [int]$Port = 7420,
  [string]$TaskName = "",
  [string]$WatchdogTaskName = "",
  [string]$FirewallRuleName = "",
  [switch]$RemoveUserData,
  [switch]$RemoveCloudflared,
  [switch]$JsonOutput
)

$ErrorActionPreference = "Stop"
$script:UninstallStage = "initialize"
$script:RemovedItems = New-Object 'System.Collections.Generic.List[string]'
$script:PreservedItems = New-Object 'System.Collections.Generic.List[string]'
$script:UninstallWarnings = New-Object 'System.Collections.Generic.List[object]'

trap {
  $message = if ($_.Exception -and $_.Exception.Message) {
    [string]$_.Exception.Message
  } else {
    [string]$_
  }

  if ($JsonOutput) {
    $payload = [ordered]@{
      schemaVersion = 1
      operation = "uninstall"
      ok = $false
      error = [ordered]@{
        code = "UNINSTALL_FAILED"
        stage = $script:UninstallStage
        message = $message
      }
    } | ConvertTo-Json -Depth 5 -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Error.WriteLine("error[UNINSTALL_FAILED][$($script:UninstallStage)]: $message")
  }
  break
}

function Write-UninstallMessage {
  param([string]$Message)

  if ($JsonOutput) {
    [Console]::Error.WriteLine($Message)
  } else {
    Write-Host $Message
  }
}

function Write-UninstallWarning {
  param(
    [string]$Code,
    [object]$Message
  )

  $text = [string]$Message
  $script:UninstallWarnings.Add([ordered]@{
    code = $Code
    message = $text
  }) | Out-Null
  if ($JsonOutput) {
    [Console]::Error.WriteLine("warning[$Code]: $text")
  } else {
    Write-Warning $text
  }
}

function Get-FullPath {
  param(
    [string]$Path,
    [string]$Label
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "$Label must not be empty."
  }
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Get-InternetShortcutUrl {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return ""
  }
  try {
    $match = [regex]::Match(
      (Get-Content -LiteralPath $Path -Raw),
      '(?im)^URL=(?<url>[^\r\n]+)'
    )
    if ($match.Success) {
      return $match.Groups["url"].Value.Trim()
    }
  } catch {}
  return ""
}

function Assert-SafeManagedDirectory {
  param(
    [string]$Path,
    [string]$Label
  )

  $fullPath = Get-FullPath -Path $Path -Label $Label
  $driveRoot = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
  $blocked = @(
    $driveRoot,
    (Get-FullPath -Path $env:USERPROFILE -Label "USERPROFILE"),
    (Get-FullPath -Path $env:LOCALAPPDATA -Label "LOCALAPPDATA")
  )
  if ($blocked -contains $fullPath) {
    throw "Unsafe $Label directory: $fullPath"
  }
  return $fullPath
}

function Remove-ManagedItem {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  if (-not $PSCmdlet.ShouldProcess($Path, "Remove $Label")) {
    return
  }

  $item = Get-Item -LiteralPath $Path
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      if ($item.PSIsContainer) {
        Remove-Item -LiteralPath $Path -Recurse -Force
      } else {
        Remove-Item -LiteralPath $Path -Force
      }
      break
    } catch {
      if ($attempt -eq 5) {
        throw
      }
      Start-Sleep -Milliseconds 250
    }
  }
  $script:RemovedItems.Add($Path) | Out-Null
  Write-UninstallMessage "Removed $Label`: $Path"
}

function Remove-ScheduledTaskIfPresent {
  param(
    [string]$Name,
    [string]$Label
  )

  $getScheduledTask = Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue
  $unregisterScheduledTask = Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue
  if (-not $getScheduledTask -or -not $unregisterScheduledTask) {
    Write-UninstallWarning -Code "TASK_COMMAND_UNAVAILABLE" -Message "Windows ScheduledTasks commands are unavailable; skipped task cleanup."
    return
  }

  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) {
    return
  }
  if (-not $PSCmdlet.ShouldProcess($Name, "Delete $Label")) {
    return
  }

  try {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
  } catch {
    Write-UninstallWarning -Code "TASK_REMOVE_FAILED" -Message $_
    return
  }
  $script:RemovedItems.Add("scheduled-task:$Name") | Out-Null
  Write-UninstallMessage "Removed $Label`: $Name"
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

$resolvedInstallDir = Assert-SafeManagedDirectory -Path $InstallDir -Label "install"
$resolvedStateDir = Assert-SafeManagedDirectory -Path $StateDir -Label "state"
$resolvedManagedBinDir = Assert-SafeManagedDirectory -Path $ManagedBinDir -Label "managed bin"
$resolvedLauncherPath = Get-FullPath -Path $LauncherPath -Label "launcher"
$resolvedCliShimPath = Join-Path $resolvedManagedBinDir "cx-codex.cmd"
$resolvedConfigPath = Join-Path $resolvedStateDir "config.json"
$resolvedTaskName = if ([string]::IsNullOrWhiteSpace($TaskName)) { "CodexUI-$Port" } else { $TaskName }
$resolvedWatchdogTaskName = if ([string]::IsNullOrWhiteSpace($WatchdogTaskName)) { "CodexUI-$Port-Watchdog" } else { $WatchdogTaskName }
$resolvedFirewallRuleName = if ([string]::IsNullOrWhiteSpace($FirewallRuleName)) { "cx-codex-$Port" } else { $FirewallRuleName }
$resolvedServerPidPath = Join-Path $resolvedStateDir "cx-codex-$Port.pid"
$shortcutTestRoot = [string]$env:CX_CODEX_MANAGEMENT_SHORTCUT_ROOT
$managementShortcutDirectories = if ([string]::IsNullOrWhiteSpace($shortcutTestRoot)) {
  @(
    [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory),
    [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
  )
} else {
  @(
    (Join-Path $shortcutTestRoot "Desktop"),
    (Join-Path $shortcutTestRoot "Programs")
  )
}
$managementShortcutBaseName = "CX-Codex $([char]0x7BA1)$([char]0x7406)$([char]0x4E2D)$([char]0x5FC3)"
$managementShortcutUrl = "http://127.0.0.1:$Port/local-setup"
$managementShortcutPaths = @($managementShortcutDirectories) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -Unique |
  ForEach-Object {
    Join-Path $_ "$managementShortcutBaseName.url"
    Join-Path $_ "$managementShortcutBaseName ($Port).url"
  } |
  Select-Object -Unique

$configuredCloudflaredPath = ""
if (Test-Path -LiteralPath $resolvedConfigPath) {
  try {
    $config = Get-Content -LiteralPath $resolvedConfigPath -Raw | ConvertFrom-Json
    if ($config.cloudflaredCommand) {
      $configuredCloudflaredPath = Get-FullPath -Path ([string]$config.cloudflaredCommand) -Label "configured cloudflared"
    }
  } catch {
    Write-UninstallWarning -Code "CONFIG_READ_FAILED" -Message "Could not read the managed config; continuing with exact path cleanup."
  }
}

$script:UninstallStage = "stop_processes"
$managedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
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
      -ManagedPaths @($resolvedInstallDir, $resolvedConfigPath, $resolvedLauncherPath)
    $isManagedQuickTunnel =
      $commandLine -like "*cloudflared*" -and
      $commandLine -like "*127.0.0.1`:$Port*" -and (
        $commandLine -like "*$resolvedManagedBinDir*" -or
        (-not [string]::IsNullOrWhiteSpace($configuredCloudflaredPath) -and $commandLine -like "*$configuredCloudflaredPath*")
      )

    if ($isManagedServer -or $isManagedQuickTunnel) {
      $managedProcessIds.Add($processId) | Out-Null
    }
  }
} catch {
  Write-UninstallWarning -Code "PROCESS_SCAN_FAILED" -Message "Could not scan running processes; file cleanup will continue."
}

$recordedServerProcessId = 0
if (Test-Path -LiteralPath $resolvedServerPidPath) {
  $recordedPidText = [string](Get-Content -LiteralPath $resolvedServerPidPath -Raw -ErrorAction SilentlyContinue)
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
      $managedProcessIds.Add($recordedServerProcessId) | Out-Null
    }
  } catch {
    Write-UninstallWarning -Code "PID_MARKER_CHECK_FAILED" -Message "Could not verify the recorded managed process for port $Port."
  }
}

$visitedProcessIds = New-Object 'System.Collections.Generic.HashSet[int]'
$orderedProcessIds = New-Object 'System.Collections.Generic.List[int]'
foreach ($managedProcessId in $managedProcessIds) {
  Add-ProcessTreePostOrder `
    -RootProcessId $managedProcessId `
    -Processes $processes `
    -VisitedProcessIds $visitedProcessIds `
    -OrderedProcessIds $orderedProcessIds
}

$processIdsToStop = New-Object 'System.Collections.Generic.List[int]'
foreach ($managedProcessId in $orderedProcessIds) {
  if (-not $PSCmdlet.ShouldProcess("PID $managedProcessId", "Stop managed CX-Codex process")) {
    continue
  }
  Stop-Process -Id $managedProcessId -Force -ErrorAction SilentlyContinue
  $processIdsToStop.Add($managedProcessId) | Out-Null
}

$remainingProcessIds = @()
if ($processIdsToStop.Count -gt 0) {
  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remainingProcessIds = @(
      $processIdsToStop |
        Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    )
    if ($remainingProcessIds.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
}

foreach ($managedProcessId in $processIdsToStop) {
  if ($remainingProcessIds -contains $managedProcessId) {
    Write-UninstallWarning -Code "PROCESS_STOP_TIMEOUT" -Message "Managed process $managedProcessId did not exit within 10 seconds; file cleanup may need a retry."
  }
  $script:RemovedItems.Add("process:$managedProcessId") | Out-Null
  Write-UninstallMessage "Stopped managed process: $managedProcessId"
}

$script:UninstallStage = "remove_system_entries"
Remove-ScheduledTaskIfPresent -Name $resolvedTaskName -Label "startup task"
Remove-ScheduledTaskIfPresent -Name $resolvedWatchdogTaskName -Label "watchdog task"

$firewallCommand = Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue
if ($firewallCommand) {
  try {
    $firewallRule = Get-NetFirewallRule -DisplayName $resolvedFirewallRuleName -ErrorAction SilentlyContinue
    if ($firewallRule -and $PSCmdlet.ShouldProcess($resolvedFirewallRuleName, "Remove firewall rule")) {
      Remove-NetFirewallRule -DisplayName $resolvedFirewallRuleName -ErrorAction Stop | Out-Null
      $script:RemovedItems.Add("firewall-rule:$resolvedFirewallRuleName") | Out-Null
      Write-UninstallMessage "Removed firewall rule: $resolvedFirewallRuleName"
    }
  } catch {
    Write-UninstallWarning -Code "FIREWALL_REMOVE_FAILED" -Message "Could not remove firewall rule $resolvedFirewallRuleName."
  }
}

$script:UninstallStage = "remove_program_files"
Remove-ManagedItem -Path $resolvedServerPidPath -Label "server PID marker"
Remove-ManagedItem -Path $resolvedLauncherPath -Label "launcher"
if (Test-Path -LiteralPath $resolvedCliShimPath) {
  $shimText = Get-Content -Raw -Encoding ASCII -LiteralPath $resolvedCliShimPath
  $managedIndexPath = Join-Path $resolvedInstallDir "dist-cli\index.js"
  if ($shimText -like "*$managedIndexPath*") {
    Remove-ManagedItem -Path $resolvedCliShimPath -Label "CLI shim"
  } else {
    $script:PreservedItems.Add("cli-shim:$resolvedCliShimPath") | Out-Null
    Write-UninstallWarning -Code "CLI_SHIM_PRESERVED" -Message "Preserved CLI shim because it does not target the managed CX-Codex installation."
  }
}
foreach ($managementShortcutPath in $managementShortcutPaths) {
  if (
    (Test-Path -LiteralPath $managementShortcutPath) -and
    (Get-InternetShortcutUrl -Path $managementShortcutPath) -ne $managementShortcutUrl
  ) {
    $script:PreservedItems.Add("management-shortcut:$managementShortcutPath") | Out-Null
    continue
  }
  Remove-ManagedItem -Path $managementShortcutPath -Label "management shortcut"
}
Remove-ManagedItem -Path $resolvedInstallDir -Label "installation"
Remove-ManagedItem -Path "$resolvedInstallDir.previous" -Label "previous installation"

$installParent = Split-Path -Parent $resolvedInstallDir
$installLeaf = Split-Path -Leaf $resolvedInstallDir
if (Test-Path -LiteralPath $installParent) {
  $failedInstallations = Get-ChildItem -LiteralPath $installParent -Directory -Filter "$installLeaf.failed-*" -ErrorAction SilentlyContinue
  foreach ($failedInstallation in $failedInstallations) {
    if ($failedInstallation.FullName.StartsWith("${resolvedInstallDir}.failed-", [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-ManagedItem -Path $failedInstallation.FullName -Label "failed installation"
    }
  }
}

if ($RemoveCloudflared -and (Test-Path -LiteralPath $resolvedManagedBinDir)) {
  $managedCloudflaredFiles = @(
    Get-ChildItem -LiteralPath $resolvedManagedBinDir -File -Filter "cloudflared*.exe" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match "^cloudflared-[a-f0-9]{12,64}\.exe$" -or
        (-not [string]::IsNullOrWhiteSpace($configuredCloudflaredPath) -and $_.FullName -eq $configuredCloudflaredPath)
      }
  )
  foreach ($managedCloudflaredFile in $managedCloudflaredFiles) {
    Remove-ManagedItem -Path $managedCloudflaredFile.FullName -Label "managed cloudflared"
  }
} elseif (Test-Path -LiteralPath $resolvedManagedBinDir) {
  $script:PreservedItems.Add("managed-cloudflared:$resolvedManagedBinDir") | Out-Null
}

$script:UninstallStage = "user_data"
if ($RemoveUserData) {
  Remove-ManagedItem -Path $resolvedStateDir -Label "CX-Codex user data"
} elseif (Test-Path -LiteralPath $resolvedStateDir) {
  $script:PreservedItems.Add("cx-codex-user-data:$resolvedStateDir") | Out-Null
}

$script:PreservedItems.Add("codex-login:$env:USERPROFILE\.codex") | Out-Null
$script:PreservedItems.Add("workspaces:not-managed") | Out-Null
$script:PreservedItems.Add("android-signing:not-managed") | Out-Null
$script:UninstallStage = "complete"

$result = [ordered]@{
  schemaVersion = 1
  operation = "uninstall"
  ok = $true
  removed = @($script:RemovedItems | ForEach-Object { $_ })
  preserved = @($script:PreservedItems | ForEach-Object { $_ })
  warnings = @($script:UninstallWarnings | ForEach-Object { $_ })
}

if ($JsonOutput) {
  $result | ConvertTo-Json -Depth 6 -Compress | Write-Output
} else {
  Write-UninstallMessage ""
  Write-UninstallMessage "CX-Codex uninstall complete."
  if (-not $RemoveUserData) {
    Write-UninstallMessage "User data was preserved. Re-run with -RemoveUserData only if you want to remove CX-Codex config, logs, and runtime data."
  }
  if (-not $RemoveCloudflared) {
    Write-UninstallMessage "Managed cloudflared files were preserved. Re-run with -RemoveCloudflared to remove only CX-Codex-managed copies."
  }
  Write-UninstallMessage "Codex login, user workspaces, and Android signing files were not removed."
}
