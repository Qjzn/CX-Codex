[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "stop", "restart", "status", "enable", "disable")]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$Port,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ConfigPath,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$LauncherPath,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$TaskName,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$WatchdogTaskName,
  [ValidateSet("Human", "Json")]
  [string]$OutputFormat = "Human",
  [ValidateRange(1, 300)]
  [int]$HealthTimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
$script:ExitCodes = @{
  OK = 0
  INTERNAL_ERROR = 1
  INVALID_ARGUMENT = 2
  UNSUPPORTED_PLATFORM = 3
  MISSING_INSTALL_RESOURCE = 4
  UNMANAGED_PORT_CONFLICT = 5
  PROCESS_CONTROL_FAILED = 6
  HEALTH_TIMEOUT = 7
  SYSTEM_INSPECTION_FAILED = 8
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CxCodexWindowsCommandLine
{
    [DllImport("shell32.dll", SetLastError = true)]
    public static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string commandLine, out int argumentCount);

    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr memory);
}
"@

function New-ServiceFailure {
  param(
    [string]$Code,
    [string]$Message
  )
  $exception = [System.InvalidOperationException]::new($Message)
  $exception.Data["ServiceCode"] = $Code
  return $exception
}

function Get-NormalizedPath {
  param(
    [string]$Path,
    [string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw (New-ServiceFailure -Code "INVALID_ARGUMENT" -Message "$Label must not be empty.")
  }
  try {
    return [System.IO.Path]::GetFullPath($Path)
  } catch {
    throw (New-ServiceFailure -Code "INVALID_ARGUMENT" -Message "$Label is not a valid path.")
  }
}

function Split-WindowsCommandLine {
  param([string]$CommandLine)
  $argumentCount = 0
  $argumentPointer = [CxCodexWindowsCommandLine]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
  if ($argumentPointer -eq [IntPtr]::Zero) {
    throw (New-ServiceFailure -Code "SYSTEM_INSPECTION_FAILED" -Message "Could not parse a Windows process command line.")
  }
  try {
    $arguments = New-Object 'System.Collections.Generic.List[string]'
    for ($index = 0; $index -lt $argumentCount; $index += 1) {
      $itemPointer = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($argumentPointer, $index * [IntPtr]::Size)
      $arguments.Add([System.Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer)) | Out-Null
    }
    return @($arguments)
  } finally {
    [CxCodexWindowsCommandLine]::LocalFree($argumentPointer) | Out-Null
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
  $arguments = @(Split-WindowsCommandLine -CommandLine $CommandLine)
  $entryIndex = -1
  for ($index = 0; $index -lt $arguments.Count; $index += 1) {
    $normalizedArgument = ([string]$arguments[$index]).Replace('\', '/')
    if ($normalizedArgument.EndsWith("/dist-cli/index.js", [System.StringComparison]::OrdinalIgnoreCase)) {
      $entryIndex = $index
      break
    }
  }
  if ($entryIndex -lt 0) {
    return $false
  }
  if (
    $entryIndex + 1 -lt $arguments.Count -and
    ([string]$arguments[$entryIndex + 1]).Equals("service", [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    return $false
  }
  foreach ($managedPath in $ManagedPaths) {
    $normalizedManagedPath = [System.IO.Path]::GetFullPath($managedPath).TrimEnd('\')
    foreach ($argument in $arguments) {
      try {
        $normalizedArgumentPath = [System.IO.Path]::GetFullPath([string]$argument).TrimEnd('\')
        if ($normalizedArgumentPath.Equals($normalizedManagedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
          return $true
        }
      } catch {
        continue
      }
    }
  }
  return $false
}

function Get-ExactScheduledTask {
  param([string]$Name)
  try {
    $tasks = @(
      Get-ScheduledTask -ErrorAction Stop |
        Where-Object { ([string]$_.TaskName).Equals($Name, [System.StringComparison]::OrdinalIgnoreCase) }
    )
  } catch {
    throw (New-ServiceFailure -Code "SYSTEM_INSPECTION_FAILED" -Message "Could not inspect scheduled task '$Name'.")
  }
  if ($tasks.Count -gt 1) {
    throw (New-ServiceFailure -Code "SYSTEM_INSPECTION_FAILED" -Message "Scheduled task name '$Name' is ambiguous across task paths.")
  }
  return $tasks | Select-Object -First 1
}

function Get-TaskFact {
  param([string]$Name)
  $task = Get-ExactScheduledTask -Name $Name
  if (-not $task) {
    return [pscustomobject][ordered]@{
      name = $Name
      exists = $false
      enabled = $false
      state = "Missing"
    }
  }
  return [pscustomobject][ordered]@{
    name = $Name
    exists = $true
    enabled = [bool]$task.Settings.Enabled
    state = [string]$task.State
  }
}

function Get-HealthFact {
  param([int]$ServicePort)
  $url = "http://127.0.0.1:$ServicePort/health"
  $ready = $false
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 -ErrorAction Stop
    $ready = [int]$response.StatusCode -eq 200
  } catch {
    $ready = $false
  }
  return [pscustomobject][ordered]@{
    ready = $ready
    url = $url
  }
}

function Add-ProcessTreePreOrder {
  param(
    [int]$RootProcessId,
    [object[]]$Processes,
    [System.Collections.Generic.HashSet[int]]$Visited,
    [System.Collections.Generic.List[int]]$Ordered
  )
  if ($RootProcessId -le 0 -or $RootProcessId -eq $PID -or -not $Visited.Add($RootProcessId)) {
    return
  }
  $Ordered.Add($RootProcessId) | Out-Null
  foreach ($child in @($Processes | Where-Object { [int]$_.ParentProcessId -eq $RootProcessId })) {
    Add-ProcessTreePreOrder -RootProcessId ([int]$child.ProcessId) -Processes $Processes -Visited $Visited -Ordered $Ordered
  }
}

function Add-ProcessTreePostOrder {
  param(
    [int]$RootProcessId,
    [object[]]$Processes,
    [System.Collections.Generic.HashSet[int]]$Visited,
    [System.Collections.Generic.List[int]]$Ordered
  )
  if ($RootProcessId -le 0 -or $RootProcessId -eq $PID -or -not $Visited.Add($RootProcessId)) {
    return
  }
  foreach ($child in @($Processes | Where-Object { [int]$_.ParentProcessId -eq $RootProcessId })) {
    Add-ProcessTreePostOrder -RootProcessId ([int]$child.ProcessId) -Processes $Processes -Visited $Visited -Ordered $Ordered
  }
  $Ordered.Add($RootProcessId) | Out-Null
}

function Get-ServiceSnapshot {
  try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  } catch {
    throw (New-ServiceFailure -Code "SYSTEM_INSPECTION_FAILED" -Message "Could not inspect Windows processes.")
  }
  try {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    throw (New-ServiceFailure -Code "SYSTEM_INSPECTION_FAILED" -Message "Could not inspect TCP listeners for port $Port.")
  }

  $managedRoots = New-Object 'System.Collections.Generic.List[int]'
  foreach ($processInfo in $processes) {
    $processId = [int]$processInfo.ProcessId
    if ($processId -le 0 -or $processId -eq $PID) {
      continue
    }
    if (Test-ManagedServerCommandLine -CommandLine ([string]$processInfo.CommandLine) -ManagedPaths $script:ManagedIdentityPaths) {
      $managedRoots.Add($processId) | Out-Null
    }
  }

  $managedVisited = New-Object 'System.Collections.Generic.HashSet[int]'
  $managedOrdered = New-Object 'System.Collections.Generic.List[int]'
  foreach ($managedRoot in $managedRoots) {
    Add-ProcessTreePreOrder -RootProcessId $managedRoot -Processes $processes -Visited $managedVisited -Ordered $managedOrdered
  }

  $listenerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  $unmanagedListenerPids = @($listenerPids | Where-Object { -not $managedVisited.Contains([int]$_) })
  $recordedPid = $null
  $recordedPidStale = $false
  if (Test-Path -LiteralPath $script:PidMarkerPath) {
    try {
      $recordedText = Get-Content -LiteralPath $script:PidMarkerPath -Raw -Encoding UTF8
      $parsedRecordedPid = 0
      if ([int]::TryParse($recordedText.Trim(), [ref]$parsedRecordedPid) -and $parsedRecordedPid -gt 0) {
        $recordedPid = $parsedRecordedPid
        $recordedPidStale = -not $managedVisited.Contains($parsedRecordedPid)
      } else {
        $recordedPidStale = $true
      }
    } catch {
      $recordedPidStale = $true
    }
  }

  return [pscustomobject][ordered]@{
    health = Get-HealthFact -ServicePort $Port
    process = [pscustomobject][ordered]@{
      pidMarkerPath = $script:PidMarkerPath
      recordedPid = $recordedPid
      recordedPidStale = $recordedPidStale
      managedPids = @($managedOrdered | Sort-Object -Unique)
      listenerPids = @($listenerPids)
      unmanagedListenerPids = @($unmanagedListenerPids)
    }
    launcher = [pscustomobject][ordered]@{
      path = $script:ResolvedLauncherPath
      exists = Test-Path -LiteralPath $script:ResolvedLauncherPath -PathType Leaf
    }
    config = [pscustomobject][ordered]@{
      path = $script:ResolvedConfigPath
      exists = Test-Path -LiteralPath $script:ResolvedConfigPath -PathType Leaf
    }
    startupTask = Get-TaskFact -Name $TaskName
    watchdogTask = Get-TaskFact -Name $WatchdogTaskName
    processes = $processes
  }
}

function Assert-NoUnmanagedListener {
  param([object]$Snapshot)
  $conflicts = @($Snapshot.process.unmanagedListenerPids)
  if ($conflicts.Count -gt 0) {
    throw (New-ServiceFailure -Code "UNMANAGED_PORT_CONFLICT" -Message "Port $Port is owned by unmanaged process PID(s): $($conflicts -join ', ').")
  }
}

function Assert-RecoveryTasksExist {
  param([object]$Snapshot)
  $missing = @(
    @($Snapshot.startupTask, $Snapshot.watchdogTask) |
      Where-Object { -not $_.exists } |
      ForEach-Object { $_.name }
  )
  if ($missing.Count -gt 0) {
    throw (New-ServiceFailure -Code "MISSING_INSTALL_RESOURCE" -Message "Scheduled task(s) not found: $($missing -join ', ').")
  }
}

function Set-TaskEnabledState {
  param(
    [object]$Task,
    [bool]$Enabled
  )
  if ([bool]$Task.enabled -eq $Enabled) {
    return
  }
  try {
    $scheduledTask = Get-ExactScheduledTask -Name $Task.name
    if (-not $scheduledTask) {
      throw (New-ServiceFailure -Code "MISSING_INSTALL_RESOURCE" -Message "Scheduled task '$($Task.name)' no longer exists.")
    }
    if ($Enabled) {
      Enable-ScheduledTask -InputObject $scheduledTask -ErrorAction Stop | Out-Null
    } else {
      Disable-ScheduledTask -InputObject $scheduledTask -ErrorAction Stop | Out-Null
    }
  } catch {
    $serviceCode = [string]$_.Exception.Data["ServiceCode"]
    if (-not [string]::IsNullOrWhiteSpace($serviceCode)) {
      throw
    }
    throw (New-ServiceFailure -Code "PROCESS_CONTROL_FAILED" -Message "Could not set scheduled task '$($Task.name)' enabled=$Enabled.")
  }
}

function Stop-ManagedProcessTree {
  param([object]$Snapshot)
  $visited = New-Object 'System.Collections.Generic.HashSet[int]'
  $ordered = New-Object 'System.Collections.Generic.List[int]'
  foreach ($managedPid in @($Snapshot.process.managedPids)) {
    Add-ProcessTreePostOrder -RootProcessId ([int]$managedPid) -Processes $Snapshot.processes -Visited $visited -Ordered $ordered
  }
  foreach ($managedPid in $ordered) {
    try {
      Stop-Process -Id $managedPid -Force -ErrorAction SilentlyContinue
    } catch {
      throw (New-ServiceFailure -Code "PROCESS_CONTROL_FAILED" -Message "Could not stop managed process PID $managedPid.")
    }
  }
  if ($ordered.Count -eq 0) {
    return
  }
  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remaining = @($ordered | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  throw (New-ServiceFailure -Code "PROCESS_CONTROL_FAILED" -Message "Managed process PID(s) did not exit: $($remaining -join ', ').")
}

function Start-ManagedLauncher {
  $launcherArgument = '"{0}"' -f $script:ResolvedLauncherPath.Replace('"', '""')
  try {
    Start-Process `
      -FilePath "cmd.exe" `
      -ArgumentList @("/d", "/s", "/c", $launcherArgument) `
      -WorkingDirectory (Split-Path -Parent $script:ResolvedLauncherPath) `
      -WindowStyle Hidden | Out-Null
  } catch {
    throw (New-ServiceFailure -Code "PROCESS_CONTROL_FAILED" -Message "Could not start the managed launcher.")
  }
}

function Wait-ServiceHealth {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  do {
    $health = Get-HealthFact -ServicePort $Port
    if ($health.ready) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw (New-ServiceFailure -Code "HEALTH_TIMEOUT" -Message "Service health did not become ready within $HealthTimeoutSeconds second(s).")
}

function New-ServiceResult {
  param(
    [bool]$Ok,
    [string]$Code,
    [string]$Message,
    [object]$Snapshot
  )
  return [pscustomobject][ordered]@{
    ok = $Ok
    action = $Action
    code = $Code
    message = $Message
    port = $Port
    health = $Snapshot.health
    process = $Snapshot.process
    launcher = $Snapshot.launcher
    config = $Snapshot.config
    startupTask = $Snapshot.startupTask
    watchdogTask = $Snapshot.watchdogTask
  }
}

function Write-ServiceResult {
  param([object]$Result)
  if ($OutputFormat -eq "Json") {
    $Result | ConvertTo-Json -Depth 8 -Compress | Write-Output
    return
  }
  $managedPids = if (@($Result.process.managedPids).Count -gt 0) { @($Result.process.managedPids) -join ", " } else { "none" }
  $listenerPids = if (@($Result.process.listenerPids).Count -gt 0) { @($Result.process.listenerPids) -join ", " } else { "none" }
  Write-Host "$($Result.action): $($Result.message)"
  Write-Host "Health: $($Result.health.ready) ($($Result.health.url))"
  Write-Host "Managed PIDs: $managedPids"
  Write-Host "Listener PIDs: $listenerPids"
  Write-Host "Config: exists=$($Result.config.exists) path=$($Result.config.path)"
  Write-Host "Launcher: exists=$($Result.launcher.exists) path=$($Result.launcher.path)"
  Write-Host "Startup task: exists=$($Result.startupTask.exists) enabled=$($Result.startupTask.enabled) state=$($Result.startupTask.state)"
  Write-Host "Watchdog task: exists=$($Result.watchdogTask.exists) enabled=$($Result.watchdogTask.enabled) state=$($Result.watchdogTask.state)"
  if (-not $Result.ok) {
    Write-Host "Error code: $($Result.code)" -ForegroundColor Red
    if (@($Result.process.unmanagedListenerPids).Count -gt 0) {
      Write-Host "Unmanaged listener PIDs: $(@($Result.process.unmanagedListenerPids) -join ', ')" -ForegroundColor Red
    }
  }
}

function New-FallbackSnapshot {
  return [pscustomobject][ordered]@{
    health = Get-HealthFact -ServicePort $Port
    process = [pscustomobject][ordered]@{
      pidMarkerPath = $script:PidMarkerPath
      recordedPid = $null
      recordedPidStale = $false
      managedPids = @()
      listenerPids = @()
      unmanagedListenerPids = @()
    }
    launcher = [pscustomobject][ordered]@{
      path = $script:ResolvedLauncherPath
      exists = Test-Path -LiteralPath $script:ResolvedLauncherPath -PathType Leaf
    }
    config = [pscustomobject][ordered]@{
      path = $script:ResolvedConfigPath
      exists = Test-Path -LiteralPath $script:ResolvedConfigPath -PathType Leaf
    }
    startupTask = [pscustomobject][ordered]@{ name = $TaskName; exists = $false; enabled = $false; state = "Unknown" }
    watchdogTask = [pscustomobject][ordered]@{ name = $WatchdogTaskName; exists = $false; enabled = $false; state = "Unknown" }
  }
}

$script:ResolvedConfigPath = Get-NormalizedPath -Path $ConfigPath -Label "Config path"
$script:ResolvedLauncherPath = Get-NormalizedPath -Path $LauncherPath -Label "Launcher path"
$configDirectory = Split-Path -Parent $script:ResolvedConfigPath
$script:PidMarkerPath = Join-Path $configDirectory "cx-codex-$Port.pid"
$script:ManagedIdentityPaths = @($script:ResolvedConfigPath, $script:ResolvedLauncherPath)

$requiredCommands = @("Get-CimInstance", "Get-NetTCPConnection", "Get-ScheduledTask")
foreach ($requiredCommand in $requiredCommands) {
  if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
    $snapshot = New-FallbackSnapshot
    $result = New-ServiceResult `
      -Ok $false `
      -Code "SYSTEM_INSPECTION_FAILED" `
      -Message "Required Windows command '$requiredCommand' is unavailable." `
      -Snapshot $snapshot
    Write-ServiceResult -Result $result
    exit $script:ExitCodes.SYSTEM_INSPECTION_FAILED
  }
}

$lastSnapshot = $null
try {
  $lastSnapshot = Get-ServiceSnapshot
  if ($Action -eq "status") {
    Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Service status collected." -Snapshot $lastSnapshot)
    exit 0
  }

  if ($Action -eq "disable") {
    Assert-RecoveryTasksExist -Snapshot $lastSnapshot
    Set-TaskEnabledState -Task $lastSnapshot.watchdogTask -Enabled $false
    Set-TaskEnabledState -Task $lastSnapshot.startupTask -Enabled $false
    $lastSnapshot = Get-ServiceSnapshot
    Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Startup recovery disabled." -Snapshot $lastSnapshot)
    exit 0
  }

  if ($Action -eq "enable") {
    Assert-RecoveryTasksExist -Snapshot $lastSnapshot
    Set-TaskEnabledState -Task $lastSnapshot.startupTask -Enabled $true
    Set-TaskEnabledState -Task $lastSnapshot.watchdogTask -Enabled $true
    $lastSnapshot = Get-ServiceSnapshot
    Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Startup recovery enabled." -Snapshot $lastSnapshot)
    exit 0
  }

  Assert-NoUnmanagedListener -Snapshot $lastSnapshot
  if ($Action -eq "stop") {
    Stop-ManagedProcessTree -Snapshot $lastSnapshot
    $lastSnapshot = Get-ServiceSnapshot
    Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Managed service process stopped." -Snapshot $lastSnapshot)
    exit 0
  }

  if (-not $lastSnapshot.config.exists) {
    throw (New-ServiceFailure -Code "MISSING_INSTALL_RESOURCE" -Message "Managed config is missing.")
  }
  if (-not $lastSnapshot.launcher.exists) {
    throw (New-ServiceFailure -Code "MISSING_INSTALL_RESOURCE" -Message "Managed launcher is missing.")
  }

  if ($Action -eq "start") {
    if (-not $lastSnapshot.health.ready) {
      Start-ManagedLauncher
      Wait-ServiceHealth
    }
    $lastSnapshot = Get-ServiceSnapshot
    Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Managed service process started." -Snapshot $lastSnapshot)
    exit 0
  }

  Stop-ManagedProcessTree -Snapshot $lastSnapshot
  Start-ManagedLauncher
  Wait-ServiceHealth
  $lastSnapshot = Get-ServiceSnapshot
  Write-ServiceResult -Result (New-ServiceResult -Ok $true -Code "OK" -Message "Managed service process restarted." -Snapshot $lastSnapshot)
  exit 0
} catch {
  $failure = $_
  $code = [string]$failure.Exception.Data["ServiceCode"]
  if ([string]::IsNullOrWhiteSpace($code) -or -not $script:ExitCodes.ContainsKey($code)) {
    $code = "INTERNAL_ERROR"
  }
  $message = [string]$failure.Exception.Message
  try {
    $lastSnapshot = Get-ServiceSnapshot
  } catch {
    if (-not $lastSnapshot) {
      $lastSnapshot = New-FallbackSnapshot
    }
  }
  Write-ServiceResult -Result (New-ServiceResult -Ok $false -Code $code -Message $message -Snapshot $lastSnapshot)
  exit $script:ExitCodes[$code]
}
