[CmdletBinding()]
param(
  [ValidateSet("Snapshot", "Observe", "ScreenOff", "Doze")]
  [string]$Mode = "Snapshot",
  [ValidateRange(1, 60)]
  [int]$ObservationSeconds = 15,
  [string]$Serial = "",
  [string]$AdbPath = "",
  [string]$PackageName = "com.cxcodex.bridge",
  [string]$OutputDirectory = "",
  [switch]$ListDevices,
  [switch]$RequireActiveTask,
  [switch]$RequireTaskRemoval,
  [switch]$RequireStickyRestart,
  [switch]$RequireTerminalNotification,
  [switch]$RequireDeviceAcknowledgement,
  [switch]$RequireLiveReplyUpdate,
  [ValidateRange(1, 8)]
  [int]$MinimumTerminalNotificationAttempts = 1,
  [ValidateRange(100, 120000)]
  [int]$MaxTerminalNotificationLatencyMs = 10000,
  [ValidateRange(100, 120000)]
  [int]$MaxTerminalAcknowledgementLatencyMs = 20000,
  [ValidateRange(100, 120000)]
  [int]$MaxReplyRenderLatencyMs = 2000
)

$ErrorActionPreference = "Stop"

function Resolve-AdbPath {
  param([string]$Preferred)

  if (-not [string]::IsNullOrWhiteSpace($Preferred)) {
    return (Resolve-Path -LiteralPath $Preferred -ErrorAction Stop).Path
  }

  $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($adbCommand) {
    return $adbCommand.Source
  }

  $candidates = @(
    $(if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe" }),
    $(if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe" })
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "未找到 adb。请安装 Android platform-tools，或通过 -AdbPath 指定 adb.exe。"
}

$script:ResolvedAdbPath = Resolve-AdbPath -Preferred $AdbPath
$script:ResolvedSerial = ""

function Invoke-Adb {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$AdbArguments,
    [switch]$AllowFailure
  )

  $fullArguments = @()
  if (-not [string]::IsNullOrWhiteSpace($script:ResolvedSerial)) {
    $fullArguments += @("-s", $script:ResolvedSerial)
  }
  $fullArguments += $AdbArguments
  $output = (& $script:ResolvedAdbPath @fullArguments 2>&1 | Out-String).Trim()
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "adb 执行失败（$exitCode）：adb $($fullArguments -join ' ')`n$output"
  }
  return $output
}

function Get-ConnectedDevices {
  $raw = Invoke-Adb -AdbArguments @("devices", "-l")
  $devices = @()
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^(\S+)\s+device(?:\s|$)') {
      $devices += [PSCustomObject]@{
        Serial = $Matches[1]
        Description = $line.Trim()
      }
    }
  }
  return $devices
}

function Select-Device {
  param(
    [object[]]$Devices,
    [string]$PreferredSerial
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredSerial)) {
    $selected = $Devices | Where-Object { $_.Serial -eq $PreferredSerial } | Select-Object -First 1
    if (-not $selected) {
      throw "设备 $PreferredSerial 未连接或未授权。请先确认 adb devices -l 显示 device。"
    }
    return $selected
  }
  if ($Devices.Count -eq 0) {
    throw "未检测到已授权 Android 设备。连接真机并确认 adb devices -l 显示 device 后重试。"
  }
  if ($Devices.Count -gt 1) {
    throw "检测到多台 Android 设备，请通过 -Serial 指定目标设备。"
  }
  return $Devices[0]
}

function Get-MatchingLines {
  param(
    [string]$Text,
    [string]$Pattern
  )

  return @(
    $Text -split "`r?`n" |
      Where-Object { $_ -match $Pattern } |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function Read-ServiceDiagnostics {
  $component = "$PackageName/.TaskPetOverlayService"
  $serviceDump = Invoke-Adb -AdbArguments @("shell", "dumpsys", "activity", "service", $component) -AllowFailure
  $match = [regex]::Match($serviceDump, 'CX_CODEX_TASK_PET_DIAGNOSTICS=(\{.*\})')
  if (-not $match.Success) {
    return $null
  }
  try {
    return $match.Groups[1].Value | ConvertFrom-Json
  } catch {
    return [PSCustomObject]@{
      parseError = $_.Exception.Message
    }
  }
}

function Get-MonitorDiagnostics {
  param([object]$Evidence)

  if (-not $Evidence -or -not $Evidence.Snapshot -or -not $Evidence.Snapshot.taskPetService) {
    return $null
  }
  return $Evidence.Snapshot.taskPetService.monitorDiagnostics
}

function Get-PushDiagnostics {
  param([object]$Evidence)

  if (-not $Evidence -or -not $Evidence.Snapshot -or -not $Evidence.Snapshot.taskPetService) {
    return $null
  }
  return $Evidence.Snapshot.taskPetService.pushDiagnostics
}

function Read-DiagnosticLong {
  param(
    [object]$Diagnostics,
    [string]$Name
  )

  if (-not $Diagnostics) { return [long]0 }
  $property = $Diagnostics.PSObject.Properties[$Name]
  if (-not $property -or $null -eq $property.Value) { return [long]0 }
  try {
    return [long]$property.Value
  } catch {
    return [long]0
  }
}

function Get-OrderedLatency {
  param(
    [long]$StartedAtMs,
    [long]$CompletedAtMs
  )

  if ($StartedAtMs -le 0 -or $CompletedAtMs -lt $StartedAtMs) { return $null }
  return $CompletedAtMs - $StartedAtMs
}

function Write-VerificationSummary {
  param(
    [object]$Before,
    [object]$During,
    [object]$Restored,
    [string]$TargetDirectory
  )

  $beforeDiagnostics = Get-MonitorDiagnostics -Evidence $Before
  $latestEvidence = @($Restored, $During, $Before) |
    Where-Object { $null -ne (Get-MonitorDiagnostics -Evidence $_) } |
    Select-Object -First 1
  $latestDiagnostics = Get-MonitorDiagnostics -Evidence $latestEvidence
  $beforePushDiagnostics = Get-PushDiagnostics -Evidence $Before
  $latestPushEvidence = @($Restored, $During, $Before) |
    Where-Object { $null -ne (Get-PushDiagnostics -Evidence $_) } |
    Select-Object -First 1
  $latestPushDiagnostics = Get-PushDiagnostics -Evidence $latestPushEvidence
  $latestServiceDiagnostics = if ($latestEvidence) { $latestEvidence.Snapshot.taskPetService } else { $null }

  $beforeActiveTaskCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "activeTaskCount"
  $latestActiveTaskCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "activeTaskCount"
  $beforeServiceCreateCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "serviceCreateCount"
  $latestServiceCreateCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "serviceCreateCount"
  $beforeStickyRestartCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "stickyRestartCount"
  $latestStickyRestartCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "stickyRestartCount"
  $beforeTaskRemovedCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "taskRemovedCount"
  $latestTaskRemovedCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "taskRemovedCount"
  $beforeRelevantEventAtMs = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "lastRelevantEventAtMs"
  $latestRelevantEventAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastRelevantEventAtMs"
  $beforeEventDrivenPollAtMs = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "lastEventDrivenPollAtMs"
  $latestEventDrivenPollAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastEventDrivenPollAtMs"
  $beforeSnapshotSuccessAtMs = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "lastSnapshotSuccessAtMs"
  $latestSnapshotSuccessAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastSnapshotSuccessAtMs"
  $beforeReplyEventCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "replyEventCount"
  $latestReplyEventCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "replyEventCount"
  $beforeReplyApplyCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "replySnapshotApplyCount"
  $latestReplyApplyCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "replySnapshotApplyCount"
  $beforeReplyRenderCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "replyRenderCount"
  $latestReplyRenderCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "replyRenderCount"
  $latestReplyEventAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyEventAtMs"
  $latestReplyEventSeq = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyEventSeq"
  $latestReplyAppliedAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyAppliedAtMs"
  $latestReplyAppliedEventSeq = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyAppliedEventSeq"
  $latestReplyRenderedAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyRenderedAtMs"
  $latestReplyRenderedEventSeq = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastReplyRenderedEventSeq"
  $beforeTerminalAtMs = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "lastTerminalAtMs"
  $latestTerminalAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastTerminalAtMs"
  $beforeNotificationAtMs = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "lastCompletionNotificationAttemptAtMs"
  $latestNotificationAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastCompletionNotificationAttemptAtMs"
  $beforeNotificationAttemptCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "completionNotificationAttemptCount"
  $latestNotificationAttemptCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "completionNotificationAttemptCount"
  $beforeNotificationPostedCount = Read-DiagnosticLong -Diagnostics $beforeDiagnostics -Name "completionNotificationPostedCount"
  $latestNotificationPostedCount = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "completionNotificationPostedCount"
  $beforeAcknowledgementAtMs = Read-DiagnosticLong -Diagnostics $beforePushDiagnostics -Name "lastAcknowledgementAtMs"
  $latestAcknowledgementAtMs = Read-DiagnosticLong -Diagnostics $latestPushDiagnostics -Name "lastAcknowledgementAtMs"

  $terminalAdvanced = $latestTerminalAtMs -gt $beforeTerminalAtMs
  $notificationAdvanced = $latestNotificationAtMs -gt $beforeNotificationAtMs
  $notificationAttemptDelta = [Math]::Max(0L, $latestNotificationAttemptCount - $beforeNotificationAttemptCount)
  $notificationPostedDelta = [Math]::Max(0L, $latestNotificationPostedCount - $beforeNotificationPostedCount)
  $notificationResult = if ($latestDiagnostics) { [string]$latestDiagnostics.lastCompletionNotificationResult } else { "none" }
  $notificationBodySource = if ($latestDiagnostics) { [string]$latestDiagnostics.lastCompletionNotificationBodySource } else { "none" }
  $acknowledgementAdvanced = $latestAcknowledgementAtMs -gt $beforeAcknowledgementAtMs
  $acknowledgementState = if ($latestPushDiagnostics) { [string]$latestPushDiagnostics.lastAcknowledgementState } else { "none" }
  $terminalToNotificationMs = if ($terminalAdvanced -and $notificationAdvanced) {
    Get-OrderedLatency -StartedAtMs $latestTerminalAtMs -CompletedAtMs $latestNotificationAtMs
  } else {
    $null
  }
  $terminalToAcknowledgementMs = if ($terminalAdvanced -and $acknowledgementAdvanced) {
    Get-OrderedLatency -StartedAtMs $latestTerminalAtMs -CompletedAtMs $latestAcknowledgementAtMs
  } else {
    $null
  }
  $replyEventAdvanced = $latestReplyEventCount -gt $beforeReplyEventCount
  $replyAppliedAdvanced = $latestReplyApplyCount -gt $beforeReplyApplyCount
  $replyRenderedAdvanced = $latestReplyRenderCount -gt $beforeReplyRenderCount
  $replyEventCovered = $latestReplyEventSeq -gt 0 `
    -and $latestReplyAppliedEventSeq -ge $latestReplyEventSeq `
    -and $latestReplyRenderedEventSeq -ge $latestReplyEventSeq
  $replyEventToAppliedMs = if ($replyEventAdvanced -and $replyAppliedAdvanced -and $replyEventCovered) {
    Get-OrderedLatency -StartedAtMs $latestReplyEventAtMs -CompletedAtMs $latestReplyAppliedAtMs
  } else {
    $null
  }
  $replyAppliedToRenderedMs = if ($replyAppliedAdvanced -and $replyRenderedAdvanced -and $replyEventCovered) {
    Get-OrderedLatency -StartedAtMs $latestReplyAppliedAtMs -CompletedAtMs $latestReplyRenderedAtMs
  } else {
    $null
  }
  $replyEventToRenderedMs = if ($replyEventAdvanced -and $replyRenderedAdvanced -and $replyEventCovered) {
    Get-OrderedLatency -StartedAtMs $latestReplyEventAtMs -CompletedAtMs $latestReplyRenderedAtMs
  } else {
    $null
  }

  $summary = [ordered]@{
    schemaVersion = 5
    generatedAt = (Get-Date).ToString("o")
    mode = $Mode
    observationSeconds = $ObservationSeconds
    beforeActiveTaskCount = $beforeActiveTaskCount
    latestActiveTaskCount = $latestActiveTaskCount
    serviceCreateCount = $latestServiceCreateCount
    serviceRecreated = $latestServiceCreateCount -gt $beforeServiceCreateCount
    stickyRestartAdvanced = $latestStickyRestartCount -gt $beforeStickyRestartCount
    taskRemovedAdvanced = $latestTaskRemovedCount -gt $beforeTaskRemovedCount
    lastStartReason = if ($latestDiagnostics) { [string]$latestDiagnostics.lastStartReason } else { "none" }
    lastTaskRemovedAtMs = Read-DiagnosticLong -Diagnostics $latestDiagnostics -Name "lastTaskRemovedAtMs"
    noProgressReviewScheduledAtMs = Read-DiagnosticLong -Diagnostics $latestServiceDiagnostics -Name "noProgressReviewScheduledAtMs"
    relevantEventAdvanced = $latestRelevantEventAtMs -gt $beforeRelevantEventAtMs
    eventDrivenPollAdvanced = $latestEventDrivenPollAtMs -gt $beforeEventDrivenPollAtMs
    snapshotSuccessAdvanced = $latestSnapshotSuccessAtMs -gt $beforeSnapshotSuccessAtMs
    replyEventAdvanced = $replyEventAdvanced
    replySnapshotApplied = $replyAppliedAdvanced
    replyRenderedInOverlay = $replyRenderedAdvanced
    replyEventCoveredByRender = $replyEventCovered
    terminalAdvanced = $terminalAdvanced
    completionNotificationAdvanced = $notificationAdvanced
    completionNotificationPosted = $notificationResult -eq "posted"
    completionNotificationAttemptDelta = $notificationAttemptDelta
    completionNotificationPostedDelta = $notificationPostedDelta
    deviceAcknowledgementAdvanced = $acknowledgementAdvanced
    deviceAcknowledgementSucceeded = $acknowledgementState -eq "acknowledged"
    eventToPollMs = Get-OrderedLatency -StartedAtMs $latestRelevantEventAtMs -CompletedAtMs $latestEventDrivenPollAtMs
    pollToSnapshotMs = Get-OrderedLatency -StartedAtMs $latestEventDrivenPollAtMs -CompletedAtMs $latestSnapshotSuccessAtMs
    replyEventToSnapshotApplyMs = $replyEventToAppliedMs
    replySnapshotApplyToRenderMs = $replyAppliedToRenderedMs
    replyEventToRenderMs = $replyEventToRenderedMs
    terminalToNotificationMs = $terminalToNotificationMs
    terminalToAcknowledgementMs = $terminalToAcknowledgementMs
    completionNotificationResult = $notificationResult
    completionNotificationBodySource = $notificationBodySource
    deviceAcknowledgementState = $acknowledgementState
    deviceAcknowledgementEventSeq = Read-DiagnosticLong -Diagnostics $latestPushDiagnostics -Name "lastAcknowledgementEventSeq"
    lastReplyEventSeq = $latestReplyEventSeq
    lastReplyAppliedEventSeq = $latestReplyAppliedEventSeq
    lastReplyRenderedEventSeq = $latestReplyRenderedEventSeq
  }
  $summaryPath = Join-Path $TargetDirectory "summary.json"
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  Write-Host ("[summary] " + ($summary | ConvertTo-Json -Compress) + " -> $summaryPath")

  if ($RequireActiveTask -and $beforeActiveTaskCount -lt 1) {
    throw "验证开始时没有原生监控中的活跃任务。请先发送任务并确认浮窗显示处理中，再重试。"
  }
  if ($RequireTaskRemoval -and $latestTaskRemovedCount -le $beforeTaskRemovedCount) {
    throw "观察窗口内没有检测到最近任务被移除。请在 Observe 窗口内从最近任务中划掉 CX-Codex。"
  }
  if ($RequireStickyRestart -and $latestStickyRestartCount -le $beforeStickyRestartCount) {
    throw "观察窗口内没有检测到 START_STICKY 服务重建。证据保留在 $summaryPath。"
  }
  if ($RequireLiveReplyUpdate) {
    if (-not $replyEventAdvanced) {
      throw "观察窗口内没有检测到新的助手回复事件。请保持一个会产生回复的任务处于运行中。"
    }
    if (-not $replyAppliedAdvanced) {
      throw "检测到助手回复事件，但权威 Runtime Store 快照没有应用新的回复。证据保留在 $summaryPath。"
    }
    if (-not $replyRenderedAdvanced) {
      throw "权威快照已应用新回复，但展开的任务浮窗没有刷新该回复。请保持浮窗任务面板展开。"
    }
    if (-not $replyEventCovered) {
      throw "浮窗渲染的事件序号落后于本次最新回复事件。证据保留在 $summaryPath。"
    }
    if ($null -eq $replyEventToRenderedMs) {
      throw "回复事件、权威快照与浮窗渲染的时间顺序无效。证据保留在 $summaryPath。"
    }
    if ([long]$replyEventToRenderedMs -gt $MaxReplyRenderLatencyMs) {
      throw "回复事件到浮窗渲染耗时 ${replyEventToRenderedMs}ms，超过 ${MaxReplyRenderLatencyMs}ms。"
    }
  }
  if ($notificationAdvanced -and ($notificationResult -eq "none" -or $notificationBodySource -eq "none")) {
    throw "检测到完成通知尝试，但通知结果或正文来源诊断缺失。证据保留在 $summaryPath。"
  }
  if ($RequireTerminalNotification) {
    if (-not $terminalAdvanced) {
      throw "观察窗口内没有检测到新的任务终态。增加 -ObservationSeconds，或确认任务会在窗口内完成。"
    }
    if (-not $notificationAdvanced) {
      throw "检测到任务终态，但没有检测到完成通知尝试。证据保留在 $summaryPath。"
    }
    if ($notificationAttemptDelta -lt $MinimumTerminalNotificationAttempts) {
      throw "观察窗口内只有 $notificationAttemptDelta 次完成通知尝试，少于要求的 $MinimumTerminalNotificationAttempts 次。"
    }
    if ($notificationPostedDelta -lt $MinimumTerminalNotificationAttempts) {
      throw "观察窗口内只有 $notificationPostedDelta 次完成通知成功投递，少于要求的 $MinimumTerminalNotificationAttempts 次。"
    }
    if ($notificationResult -ne "posted") {
      throw "检测到任务终态，但完成通知结果为 $notificationResult，而不是 posted。请检查通知权限和完成通知通道。"
    }
    if ($notificationBodySource -notin @("latest_reply", "detail")) {
      throw "完成通知正文来源为 $notificationBodySource；严格终态验收只接受 latest_reply 或 detail。"
    }
    if ($null -eq $terminalToNotificationMs) {
      throw "终态与完成通知时间顺序无效。证据保留在 $summaryPath。"
    }
    if ([long]$terminalToNotificationMs -gt $MaxTerminalNotificationLatencyMs) {
      throw "终态到通知耗时 ${terminalToNotificationMs}ms，超过 ${MaxTerminalNotificationLatencyMs}ms。"
    }
  }
  if ($RequireDeviceAcknowledgement) {
    if (-not $terminalAdvanced) {
      throw "观察窗口内没有检测到新的任务终态，无法验证设备处理回执。"
    }
    if (-not $acknowledgementAdvanced) {
      throw "检测到任务终态，但设备没有向 7420 提交处理回执。证据保留在 $summaryPath。"
    }
    if ($acknowledgementState -ne "acknowledged") {
      throw "设备处理回执状态为 $acknowledgementState，而不是 acknowledged。"
    }
    if ($null -eq $terminalToAcknowledgementMs) {
      throw "终态与设备处理回执时间顺序无效。证据保留在 $summaryPath。"
    }
    if ([long]$terminalToAcknowledgementMs -gt $MaxTerminalAcknowledgementLatencyMs) {
      throw "终态到设备处理回执耗时 ${terminalToAcknowledgementMs}ms，超过 ${MaxTerminalAcknowledgementLatencyMs}ms。"
    }
  }
}

function Write-EvidenceSnapshot {
  param(
    [string]$Phase,
    [string]$TargetDirectory
  )

  $powerDump = Invoke-Adb -AdbArguments @("shell", "dumpsys", "power") -AllowFailure
  $idleDump = Invoke-Adb -AdbArguments @("shell", "dumpsys", "deviceidle") -AllowFailure
  $overlayAppOp = Invoke-Adb -AdbArguments @("shell", "cmd", "appops", "get", $PackageName, "SYSTEM_ALERT_WINDOW") -AllowFailure
  $notificationAppOp = Invoke-Adb -AdbArguments @("shell", "cmd", "appops", "get", $PackageName, "POST_NOTIFICATION") -AllowFailure
  $packageDump = Invoke-Adb -AdbArguments @("shell", "dumpsys", "package", $PackageName) -AllowFailure
  $alarmDump = Invoke-Adb -AdbArguments @("shell", "dumpsys", "alarm") -AllowFailure
  $processId = Invoke-Adb -AdbArguments @("shell", "pidof", $PackageName) -AllowFailure
  $serviceDiagnostics = Read-ServiceDiagnostics
  $snapshot = [ordered]@{
    schemaVersion = 1
    phase = $Phase
    capturedAt = (Get-Date).ToString("o")
    mode = $Mode
    deviceSerial = $script:ResolvedSerial
    packageName = $PackageName
    processId = $processId
    power = Get-MatchingLines -Text $powerDump -Pattern 'mWakefulness=|mInteractive=|mDeviceIdleMode=|mLightDeviceIdleMode=|CX-Codex:TaskMonitor'
    deviceIdle = Get-MatchingLines -Text $idleDump -Pattern 'mState=|mLightState=|mForceIdle=|mScreenOn=|mCharging=|com\.cxcodex\.bridge'
    overlayAppOp = $overlayAppOp
    notificationAppOp = $notificationAppOp
    package = Get-MatchingLines -Text $packageDump -Pattern 'versionName=|versionCode=|POST_NOTIFICATIONS|WAKE_LOCK|FOREGROUND_SERVICE|SYSTEM_ALERT_WINDOW|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    noProgressReviewAlarm = Get-MatchingLines -Text $alarmDump -Pattern 'com\.cxcodex\.bridge|NO_PROGRESS_REVIEW|TaskPetNoProgressReviewReceiver'
    taskPetService = $serviceDiagnostics
  }
  $path = Join-Path $TargetDirectory "$Phase.json"
  $snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding UTF8

  $serviceState = if ($serviceDiagnostics) { "running=$($serviceDiagnostics.running) active=$($serviceDiagnostics.monitorDiagnostics.activeTaskCount)" } else { "service dump unavailable" }
  Write-Host "[$Phase] $serviceState -> $path"
  return [PSCustomObject]@{
    Snapshot = $snapshot
    PowerDump = $powerDump
  }
}

$devices = @(Get-ConnectedDevices)
if ($ListDevices) {
  if ($devices.Count -eq 0) {
    Write-Host "未检测到已授权 Android 设备。"
  } else {
    $devices | Format-Table -AutoSize
  }
  return
}

$selectedDevice = Select-Device -Devices $devices -PreferredSerial $Serial
$script:ResolvedSerial = $selectedDevice.Serial
$packagePath = Invoke-Adb -AdbArguments @("shell", "pm", "path", $PackageName) -AllowFailure
if ($packagePath -notmatch '^package:') {
  throw "设备 $($selectedDevice.Serial) 未安装 $PackageName。此脚本不会自动构建或安装 APK。"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $OutputDirectory = Join-Path $repoRoot "output\android-background\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$($Mode.ToLowerInvariant())"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path

$initial = Write-EvidenceSnapshot -Phase "before" -TargetDirectory $resolvedOutputDirectory
$during = $null
$restored = $null
$initiallyInteractive = $initial.PowerDump -match 'mWakefulness=Awake|mInteractive=true'
$screenWasTurnedOff = $false
$deviceIdleWasForced = $false
$batteryWasUnplugged = $false

try {
  if ($Mode -in @("Observe", "ScreenOff", "Doze")) {
    if ($initiallyInteractive) {
      if ($Mode -in @("ScreenOff", "Doze")) {
        Invoke-Adb -AdbArguments @("shell", "input", "keyevent", "KEYCODE_SLEEP") | Out-Null
        $screenWasTurnedOff = $true
      }
    }
    if ($Mode -eq "Doze") {
      Invoke-Adb -AdbArguments @("shell", "dumpsys", "battery", "unplug") | Out-Null
      $batteryWasUnplugged = $true
      Invoke-Adb -AdbArguments @("shell", "dumpsys", "deviceidle", "force-idle") | Out-Null
      $deviceIdleWasForced = $true
    }
    Start-Sleep -Seconds $ObservationSeconds
    $during = Write-EvidenceSnapshot -Phase "during-$($Mode.ToLowerInvariant())" -TargetDirectory $resolvedOutputDirectory
  }
} finally {
  if ($deviceIdleWasForced) {
    Invoke-Adb -AdbArguments @("shell", "dumpsys", "deviceidle", "unforce") -AllowFailure | Out-Null
  }
  if ($batteryWasUnplugged) {
    Invoke-Adb -AdbArguments @("shell", "dumpsys", "battery", "reset") -AllowFailure | Out-Null
  }
  if ($screenWasTurnedOff) {
    Invoke-Adb -AdbArguments @("shell", "input", "keyevent", "KEYCODE_WAKEUP") -AllowFailure | Out-Null
  }
  if ($Mode -in @("ScreenOff", "Doze")) {
    Start-Sleep -Milliseconds 500
    $restored = Write-EvidenceSnapshot -Phase "restored" -TargetDirectory $resolvedOutputDirectory
  }
}

Write-VerificationSummary -Before $initial -During $during -Restored $restored -TargetDirectory $resolvedOutputDirectory
Write-Host "Android 后台证据已写入：$resolvedOutputDirectory"
