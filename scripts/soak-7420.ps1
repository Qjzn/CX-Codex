param(
  [int]$DurationSeconds = 7200,
  [int]$IntervalSeconds = 15,
  [string]$LocalBaseUrl = "http://127.0.0.1:7420",
  [string]$PublicBaseUrl = "",
  [string]$OutputDir = "output\soak-7420",
  [int]$MaxQueuedRpc = 0,
  [int]$MaxPendingRpc = 0,
  [int]$MaxPendingServerRequests = 0,
  [int]$MaxRuntimeUncertainRequests = 0,
  [int]$MaxActivePlanModeTurns = 0,
  [int]$MaxConsecutiveFailures = 0,
  [switch]$SkipPublic
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 1) {
  throw "DurationSeconds must be greater than 0"
}
if ($IntervalSeconds -lt 1) {
  throw "IntervalSeconds must be greater than 0"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$startedAt = Get-Date
$startedAtIso = $startedAt.ToUniversalTime().ToString("o")
$deadline = $startedAt.AddSeconds($DurationSeconds)
$samples = New-Object System.Collections.Generic.List[object]
$failures = New-Object System.Collections.Generic.List[string]
$consecutiveLocalFailures = 0
$consecutiveApiFailures = 0
$consecutivePublicFailures = 0
$consecutiveReplayFailures = 0
$consecutivePublicAuthFailures = 0
$maxQueuedObserved = 0
$maxPendingObserved = 0
$maxPendingServerRequestsObserved = 0
$maxRuntimeUncertainRequestsObserved = 0
$maxActivePlanModeTurnsObserved = 0
$newTimeoutCount = 0
$slowThreadListCount = 0
$replayFailureCount = 0
$publicAuthFailureCount = 0
$eventSeqRegressionCount = 0
$appServerPidChangeCount = 0
$runtimeStreamChangeCount = 0
$runtimeReplayStreamMismatchCount = 0
$lastEventSeq = $null
$initialAppServerPid = $null
$lastAppServerPid = $null
$initialRuntimeStreamId = $null
$lastRuntimeStreamId = $null

function Invoke-JsonHealth {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 12
  )

  try {
    $value = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSeconds
    return [pscustomobject]@{
      ok = $true
      value = $value
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      value = $null
      error = $_.Exception.Message
    }
  }
}

function Read-DateOrNull {
  param([object]$Value)
  if ($null -eq $Value) {
    return $null
  }
  try {
    return [DateTime]::Parse([string]$Value).ToUniversalTime()
  } catch {
    return $null
  }
}

function Invoke-EventReplayHealth {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 8
  )

  try {
    $value = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSeconds
    if ($null -eq $value.data -or $null -eq $value.data.notifications) {
      throw "response is missing data.notifications"
    }
    if ($null -eq $value.data.latestSeq -or $null -eq $value.data.oldestSeq) {
      throw "response is missing sequence bounds"
    }
    if ([string]::IsNullOrWhiteSpace([string]$value.data.streamId)) {
      throw "response is missing data.streamId"
    }

    $latestSeq = [long]$value.data.latestSeq
    $oldestSeq = [long]$value.data.oldestSeq
    if ($latestSeq -lt 0 -or $oldestSeq -lt 0 -or $oldestSeq -gt $latestSeq) {
      throw "invalid sequence bounds oldest=$oldestSeq latest=$latestSeq"
    }

    return [pscustomobject]@{
      ok = $true
      streamId = [string]$value.data.streamId
      latestSeq = $latestSeq
      oldestSeq = $oldestSeq
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      streamId = $null
      latestSeq = $null
      oldestSeq = $null
      error = $_.Exception.Message
    }
  }
}

function Invoke-ExpectedHttpStatus {
  param(
    [string]$Url,
    [int]$ExpectedStatus,
    [int]$TimeoutSeconds = 12
  )

  $statusCode = $null
  $requestError = $null
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
    $statusCode = [int]$response.StatusCode
  } catch {
    $requestError = $_.Exception.Message
    if ($null -ne $_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
  }

  $ok = $null -ne $statusCode -and $statusCode -eq $ExpectedStatus
  return [pscustomobject]@{
    ok = $ok
    statusCode = $statusCode
    error = if ($ok) { $null } elseif ($null -ne $statusCode) {
      "expected HTTP $ExpectedStatus, got HTTP $statusCode"
    } else {
      $requestError
    }
  }
}

$effectiveSkipPublic = $SkipPublic -or [string]::IsNullOrWhiteSpace($PublicBaseUrl)

Write-Host "[7420-soak] start duration=${DurationSeconds}s interval=${IntervalSeconds}s local=$LocalBaseUrl public=$PublicBaseUrl"

while ((Get-Date) -lt $deadline) {
  $now = Get-Date
  $local = Invoke-JsonHealth -Url "$LocalBaseUrl/health" -TimeoutSeconds 8
  $api = Invoke-JsonHealth -Url "$LocalBaseUrl/codex-api/health" -TimeoutSeconds 20
  $replay = Invoke-EventReplayHealth -Url "$LocalBaseUrl/codex-api/events/replay?after=0&limit=1" -TimeoutSeconds 8
  $public = if ($effectiveSkipPublic) {
    [pscustomobject]@{ ok = $true; value = $null; error = $null }
  } else {
    Invoke-JsonHealth -Url "$PublicBaseUrl/health" -TimeoutSeconds 12
  }
  $publicAuth = if ($effectiveSkipPublic) {
    [pscustomobject]@{ ok = $true; statusCode = $null; error = $null }
  } else {
    Invoke-ExpectedHttpStatus -Url "$PublicBaseUrl/codex-api/health" -ExpectedStatus 401 -TimeoutSeconds 12
  }

  $localHealthy = $local.ok -and [string]$local.value.status -eq "ok"
  $apiHealthy = $api.ok -and [string]$api.value.status -eq "ok"
  $publicHealthy = $effectiveSkipPublic -or ($public.ok -and [string]$public.value.status -eq "ok")

  if ($localHealthy) { $consecutiveLocalFailures = 0 } else { $consecutiveLocalFailures += 1 }
  if ($apiHealthy) { $consecutiveApiFailures = 0 } else { $consecutiveApiFailures += 1 }
  if ($publicHealthy) { $consecutivePublicFailures = 0 } else { $consecutivePublicFailures += 1 }
  if ($replay.ok) { $consecutiveReplayFailures = 0 } else {
    $consecutiveReplayFailures += 1
    $replayFailureCount += 1
  }
  if ($publicAuth.ok) { $consecutivePublicAuthFailures = 0 } else {
    $consecutivePublicAuthFailures += 1
    $publicAuthFailureCount += 1
  }

  $eventSeqRegressed = $false
  if ($replay.ok) {
    if ($null -ne $lastEventSeq -and [long]$replay.latestSeq -lt [long]$lastEventSeq) {
      $eventSeqRegressed = $true
      $eventSeqRegressionCount += 1
    }
    $lastEventSeq = [long]$replay.latestSeq
  }

  $appServer = $api.value.data.appServer
  $runtimeStore = $api.value.data.runtimeStore
  $diagnostics = $appServer.rpcDiagnostics
  $queuedRpcCount = if ($null -ne $appServer.queuedRpcCount) { [int]$appServer.queuedRpcCount } else { 0 }
  $pendingRpcCount = if ($null -ne $appServer.pendingRpcCount) { [int]$appServer.pendingRpcCount } else { 0 }
  $pendingServerRequestCount = if ($null -ne $appServer.pendingServerRequestCount) { [int]$appServer.pendingServerRequestCount } else { 0 }
  $activePlanModeTurnCount = if ($null -ne $appServer.activePlanModeTurnCount) { [int]$appServer.activePlanModeTurnCount } else { 0 }
  $runtimeUncertainRequestCount = if ($null -ne $runtimeStore.uncertainRequestCount) { [int]$runtimeStore.uncertainRequestCount } else { 0 }
  $appServerPid = if ($null -ne $appServer.pid) { [int]$appServer.pid } else { 0 }
  $runtimeStreamId = [string]$runtimeStore.streamId
  $appServerReady = $apiHealthy -and [bool]$appServer.running -and [bool]$appServer.initialized -and -not [bool]$appServer.stopping -and $appServerPid -gt 0
  $appServerPidChanged = $false
  if ($appServerPid -gt 0) {
    if ($null -eq $initialAppServerPid) {
      $initialAppServerPid = $appServerPid
    } elseif ($appServerPid -ne $lastAppServerPid) {
      $appServerPidChanged = $true
      $appServerPidChangeCount += 1
    }
    $lastAppServerPid = $appServerPid
  }
  $runtimeStreamChanged = $false
  if (-not [string]::IsNullOrWhiteSpace($runtimeStreamId)) {
    if ($null -eq $initialRuntimeStreamId) {
      $initialRuntimeStreamId = $runtimeStreamId
    } elseif ($runtimeStreamId -ne $lastRuntimeStreamId) {
      $runtimeStreamChanged = $true
      $runtimeStreamChangeCount += 1
    }
    $lastRuntimeStreamId = $runtimeStreamId
  }
  $runtimeReplayStreamMismatch = (
    [string]::IsNullOrWhiteSpace($runtimeStreamId) -or
    -not $replay.ok -or
    $runtimeStreamId -ne [string]$replay.streamId
  )
  if ($runtimeReplayStreamMismatch) {
    $runtimeReplayStreamMismatchCount += 1
  }
  $maxQueuedObserved = [Math]::Max($maxQueuedObserved, $queuedRpcCount)
  $maxPendingObserved = [Math]::Max($maxPendingObserved, $pendingRpcCount)
  $maxPendingServerRequestsObserved = [Math]::Max($maxPendingServerRequestsObserved, $pendingServerRequestCount)
  $maxRuntimeUncertainRequestsObserved = [Math]::Max($maxRuntimeUncertainRequestsObserved, $runtimeUncertainRequestCount)
  $maxActivePlanModeTurnsObserved = [Math]::Max($maxActivePlanModeTurnsObserved, $activePlanModeTurnCount)

  $recentTimeouts = @()
  if ($null -ne $diagnostics -and $null -ne $diagnostics.recentTimeouts) {
    $recentTimeouts = @($diagnostics.recentTimeouts)
  }
  $newTimeouts = @($recentTimeouts | Where-Object {
    $timeoutAt = Read-DateOrNull $_.atIso
    $null -ne $timeoutAt -and $timeoutAt -ge $startedAt.ToUniversalTime()
  })
  $newTimeoutCount = [Math]::Max($newTimeoutCount, $newTimeouts.Count)

  $recentSlowRpc = @()
  if ($null -ne $diagnostics -and $null -ne $diagnostics.recentSlowRpc) {
    $recentSlowRpc = @($diagnostics.recentSlowRpc)
  }
  $slowThreadLists = @($recentSlowRpc | Where-Object {
    $slowAt = Read-DateOrNull $_.atIso
    $null -ne $slowAt -and $slowAt -ge $startedAt.ToUniversalTime() -and $_.method -eq "thread/list"
  })
  $slowThreadListCount = [Math]::Max($slowThreadListCount, $slowThreadLists.Count)

  $sample = [pscustomobject]@{
    atIso = $now.ToUniversalTime().ToString("o")
    localOk = [bool]$localHealthy
    localStatus = if ($local.ok) { [string]$local.value.status } else { $null }
    apiOk = [bool]$apiHealthy
    apiStatus = if ($api.ok) { [string]$api.value.status } else { $null }
    eventReplayOk = [bool]$replay.ok
    latestEventSeq = $replay.latestSeq
    eventSeqRegressed = $eventSeqRegressed
    publicHealthChecked = -not $effectiveSkipPublic
    publicOk = if ($effectiveSkipPublic) { $null } else { [bool]$publicHealthy }
    publicStatus = if ($effectiveSkipPublic) { $null } elseif ($public.ok) { [string]$public.value.status } else { $null }
    publicAuthChecked = -not $effectiveSkipPublic
    publicAuthOk = if ($effectiveSkipPublic) { $null } else { [bool]$publicAuth.ok }
    publicAuthStatusCode = $publicAuth.statusCode
    appServerRunning = [bool]$appServer.running
    appServerInitialized = [bool]$appServer.initialized
    appServerStopping = [bool]$appServer.stopping
    appServerReady = [bool]$appServerReady
    appServerPid = $appServerPid
    appServerPidChanged = $appServerPidChanged
    runtimeStreamId = if ([string]::IsNullOrWhiteSpace($runtimeStreamId)) { $null } else { $runtimeStreamId }
    replayStreamId = $replay.streamId
    runtimeStreamChanged = $runtimeStreamChanged
    runtimeReplayStreamMismatch = $runtimeReplayStreamMismatch
    pendingRpcCount = $pendingRpcCount
    queuedRpcCount = $queuedRpcCount
    pendingServerRequestCount = $pendingServerRequestCount
    activePlanModeTurnCount = $activePlanModeTurnCount
    runtimeUncertainRequestCount = $runtimeUncertainRequestCount
    activeRpcCalls = if ($null -ne $diagnostics.activeRpcCalls) { [int]$diagnostics.activeRpcCalls } else { 0 }
    queuePeakCount = if ($null -ne $diagnostics.queuePeakCount) { [int]$diagnostics.queuePeakCount } else { 0 }
    newTimeoutCount = $newTimeouts.Count
    slowThreadListCount = $slowThreadLists.Count
    localError = if ($local.ok -and -not $localHealthy) { "health status is '$([string]$local.value.status)'" } else { $local.error }
    apiError = if ($api.ok -and -not $apiHealthy) { "codex-api health status is '$([string]$api.value.status)'" } else { $api.error }
    eventReplayError = $replay.error
    publicError = $public.error
    publicAuthError = $publicAuth.error
  }
  $samples.Add($sample) | Out-Null

  $publicHealthLogValue = if ($sample.publicHealthChecked) { [string]$sample.publicOk } else { "skipped" }
  $publicAuthLogValue = if ($sample.publicAuthChecked) { [string]$sample.publicAuthOk } else { "skipped" }
  Write-Host ("[7420-soak] {0} local={1} api={2} appServer={3}/pid:{4}/stable:{5} replay={6}/{7}/stream:{8} public={9} auth401={10} pending={11} queued={12} serverPending={13} uncertain={14} timeouts={15} slowThreadList={16}" -f `
    $sample.atIso, $sample.localOk, $sample.apiOk, $sample.appServerReady, $sample.appServerPid, (-not $sample.appServerPidChanged), $sample.eventReplayOk, $sample.latestEventSeq, (-not $sample.runtimeStreamChanged -and -not $sample.runtimeReplayStreamMismatch), $publicHealthLogValue, $publicAuthLogValue, $sample.pendingRpcCount, $sample.queuedRpcCount, $sample.pendingServerRequestCount, $sample.runtimeUncertainRequestCount, $sample.newTimeoutCount, $sample.slowThreadListCount)

  if ($consecutiveLocalFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("local health failed $consecutiveLocalFailures times in a row") | Out-Null
  }
  if ($consecutiveApiFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("codex-api health failed $consecutiveApiFailures times in a row") | Out-Null
  }
  if (-not $appServerReady) {
    $failures.Add("App Server was not running, initialized, and non-stopping") | Out-Null
  }
  if ($appServerPidChanged) {
    $failures.Add("App Server PID changed during the soak") | Out-Null
  }
  if ($runtimeStreamChanged) {
    $failures.Add("Runtime event stream changed during the soak") | Out-Null
  }
  if ($runtimeReplayStreamMismatch) {
    $failures.Add("Runtime health and event replay stream IDs did not match") | Out-Null
  }
  if (-not $effectiveSkipPublic -and $consecutivePublicFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("public health failed $consecutivePublicFailures times in a row") | Out-Null
  }
  if ($consecutiveReplayFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("event replay failed $consecutiveReplayFailures times in a row") | Out-Null
  }
  if (-not $effectiveSkipPublic -and $consecutivePublicAuthFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("public auth boundary failed $consecutivePublicAuthFailures times in a row") | Out-Null
  }
  if ($eventSeqRegressed) {
    $failures.Add("event replay latestSeq regressed during the soak") | Out-Null
  }
  if ($queuedRpcCount -gt $MaxQueuedRpc) {
    $failures.Add("queuedRpcCount $queuedRpcCount exceeded $MaxQueuedRpc") | Out-Null
  }
  if ($pendingRpcCount -gt $MaxPendingRpc) {
    $failures.Add("pendingRpcCount $pendingRpcCount exceeded $MaxPendingRpc") | Out-Null
  }
  if ($pendingServerRequestCount -gt $MaxPendingServerRequests) {
    $failures.Add("pendingServerRequestCount $pendingServerRequestCount exceeded $MaxPendingServerRequests") | Out-Null
  }
  if ($runtimeUncertainRequestCount -gt $MaxRuntimeUncertainRequests) {
    $failures.Add("runtime uncertainRequestCount $runtimeUncertainRequestCount exceeded $MaxRuntimeUncertainRequests") | Out-Null
  }
  if ($activePlanModeTurnCount -gt $MaxActivePlanModeTurns) {
    $failures.Add("activePlanModeTurnCount $activePlanModeTurnCount exceeded $MaxActivePlanModeTurns") | Out-Null
  }
  if ($newTimeouts.Count -gt 0) {
    $failures.Add("new RPC timeout detected") | Out-Null
  }
  if ($slowThreadLists.Count -gt 0) {
    $failures.Add("new slow thread/list RPC detected") | Out-Null
  }

  if ($failures.Count -gt 0) {
    break
  }

  $remaining = [Math]::Max(0, [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
  if ($remaining -le 0) {
    break
  }
  Start-Sleep -Seconds ([Math]::Min($IntervalSeconds, $remaining))
}

$completedAt = Get-Date
$passed = $failures.Count -eq 0
$publicReportUrl = $PublicBaseUrl
if ($effectiveSkipPublic) {
  $publicReportUrl = $null
}
$summary = [pscustomobject]@{
  passed = $passed
  startedAtIso = $startedAtIso
  completedAtIso = $completedAt.ToUniversalTime().ToString("o")
  durationSeconds = [int][Math]::Round(($completedAt - $startedAt).TotalSeconds)
  sampleCount = $samples.Count
  maxQueuedRpcCount = $maxQueuedObserved
  maxPendingRpcCount = $maxPendingObserved
  maxPendingServerRequestCount = $maxPendingServerRequestsObserved
  maxRuntimeUncertainRequestCount = $maxRuntimeUncertainRequestsObserved
  maxActivePlanModeTurnCount = $maxActivePlanModeTurnsObserved
  newTimeoutCount = $newTimeoutCount
  slowThreadListCount = $slowThreadListCount
  replayFailureCount = $replayFailureCount
  publicHealthChecked = -not $effectiveSkipPublic
  publicAuthFailureCount = $publicAuthFailureCount
  publicAuthChecked = -not $effectiveSkipPublic
  eventSeqRegressionCount = $eventSeqRegressionCount
  appServerPidChangeCount = $appServerPidChangeCount
  runtimeStreamChangeCount = $runtimeStreamChangeCount
  runtimeReplayStreamMismatchCount = $runtimeReplayStreamMismatchCount
  initialAppServerPid = $initialAppServerPid
  finalAppServerPid = $lastAppServerPid
  initialRuntimeStreamId = $initialRuntimeStreamId
  finalRuntimeStreamId = $lastRuntimeStreamId
  latestEventSeq = $lastEventSeq
  failures = @($failures.ToArray())
  localBaseUrl = $LocalBaseUrl
  publicBaseUrl = $publicReportUrl
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $OutputDir "soak-$stamp.json"
[pscustomobject]@{
  summary = $summary
  samples = @($samples.ToArray())
} | ConvertTo-Json -Depth 12 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "[7420-soak] report: $reportPath"
if ($passed) {
  Write-Host "[7420-soak] passed samples=$($samples.Count) maxPending=$maxPendingObserved maxQueued=$maxQueuedObserved maxServerPending=$maxPendingServerRequestsObserved maxUncertain=$maxRuntimeUncertainRequestsObserved maxPlanMode=$maxActivePlanModeTurnsObserved timeouts=$newTimeoutCount slowThreadList=$slowThreadListCount replayFailures=$replayFailureCount appServerPidChanges=$appServerPidChangeCount streamChanges=$runtimeStreamChangeCount streamMismatches=$runtimeReplayStreamMismatchCount publicChecked=$(-not $effectiveSkipPublic) authChecked=$(-not $effectiveSkipPublic) authFailures=$publicAuthFailureCount seqRegressions=$eventSeqRegressionCount latestSeq=$lastEventSeq"
  exit 0
}

Write-Host "[7420-soak] failed: $($failures -join '; ')"
exit 1
