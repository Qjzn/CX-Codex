param(
  [int]$DurationSeconds = 7200,
  [int]$IntervalSeconds = 15,
  [string]$LocalBaseUrl = "http://127.0.0.1:7420",
  [string]$PublicBaseUrl = "",
  [string]$OutputDir = "output\soak-7420",
  [int]$MaxQueuedRpc = 3,
  [int]$MaxPendingRpc = 3,
  [int]$MaxConsecutiveFailures = 2,
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
$newTimeoutCount = 0
$slowThreadListCount = 0
$replayFailureCount = 0
$publicAuthFailureCount = 0
$eventSeqRegressionCount = 0
$lastEventSeq = $null

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

    $latestSeq = [long]$value.data.latestSeq
    $oldestSeq = [long]$value.data.oldestSeq
    if ($latestSeq -lt 0 -or $oldestSeq -lt 0 -or $oldestSeq -gt $latestSeq) {
      throw "invalid sequence bounds oldest=$oldestSeq latest=$latestSeq"
    }

    return [pscustomobject]@{
      ok = $true
      latestSeq = $latestSeq
      oldestSeq = $oldestSeq
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
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

  if ($local.ok) { $consecutiveLocalFailures = 0 } else { $consecutiveLocalFailures += 1 }
  if ($api.ok) { $consecutiveApiFailures = 0 } else { $consecutiveApiFailures += 1 }
  if ($public.ok) { $consecutivePublicFailures = 0 } else { $consecutivePublicFailures += 1 }
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
  $diagnostics = $appServer.rpcDiagnostics
  $queuedRpcCount = if ($null -ne $appServer.queuedRpcCount) { [int]$appServer.queuedRpcCount } else { 0 }
  $pendingRpcCount = if ($null -ne $appServer.pendingRpcCount) { [int]$appServer.pendingRpcCount } else { 0 }
  $maxQueuedObserved = [Math]::Max($maxQueuedObserved, $queuedRpcCount)
  $maxPendingObserved = [Math]::Max($maxPendingObserved, $pendingRpcCount)

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
    localOk = [bool]$local.ok
    apiOk = [bool]$api.ok
    eventReplayOk = [bool]$replay.ok
    latestEventSeq = $replay.latestSeq
    eventSeqRegressed = $eventSeqRegressed
    publicOk = [bool]$public.ok
    publicAuthOk = [bool]$publicAuth.ok
    publicAuthStatusCode = $publicAuth.statusCode
    appServerRunning = [bool]$appServer.running
    appServerInitialized = [bool]$appServer.initialized
    pendingRpcCount = $pendingRpcCount
    queuedRpcCount = $queuedRpcCount
    activeRpcCalls = if ($null -ne $diagnostics.activeRpcCalls) { [int]$diagnostics.activeRpcCalls } else { 0 }
    queuePeakCount = if ($null -ne $diagnostics.queuePeakCount) { [int]$diagnostics.queuePeakCount } else { 0 }
    newTimeoutCount = $newTimeouts.Count
    slowThreadListCount = $slowThreadLists.Count
    localError = $local.error
    apiError = $api.error
    eventReplayError = $replay.error
    publicError = $public.error
    publicAuthError = $publicAuth.error
  }
  $samples.Add($sample) | Out-Null

  Write-Host ("[7420-soak] {0} local={1} api={2} replay={3}/{4} public={5} auth401={6} pending={7} queued={8} timeouts={9} slowThreadList={10}" -f `
    $sample.atIso, $sample.localOk, $sample.apiOk, $sample.eventReplayOk, $sample.latestEventSeq, $sample.publicOk, $sample.publicAuthOk, $sample.pendingRpcCount, $sample.queuedRpcCount, $sample.newTimeoutCount, $sample.slowThreadListCount)

  if ($consecutiveLocalFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("local health failed $consecutiveLocalFailures times in a row") | Out-Null
  }
  if ($consecutiveApiFailures -gt $MaxConsecutiveFailures) {
    $failures.Add("codex-api health failed $consecutiveApiFailures times in a row") | Out-Null
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
  if ($newTimeouts.Count -gt 0) {
    $failures.Add("new RPC timeout detected") | Out-Null
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
  newTimeoutCount = $newTimeoutCount
  slowThreadListCount = $slowThreadListCount
  replayFailureCount = $replayFailureCount
  publicAuthFailureCount = $publicAuthFailureCount
  eventSeqRegressionCount = $eventSeqRegressionCount
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
  Write-Host "[7420-soak] passed samples=$($samples.Count) maxPending=$maxPendingObserved maxQueued=$maxQueuedObserved timeouts=$newTimeoutCount slowThreadList=$slowThreadListCount replayFailures=$replayFailureCount authFailures=$publicAuthFailureCount seqRegressions=$eventSeqRegressionCount latestSeq=$lastEventSeq"
  exit 0
}

Write-Host "[7420-soak] failed: $($failures -join '; ')"
exit 1
