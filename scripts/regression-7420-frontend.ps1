[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$ThreadId = "",
  [int]$DesktopWidth = 1440,
  [int]$DesktopHeight = 900,
  [int]$PhoneWidth = 393,
  [int]$PhoneHeight = 852,
  [int]$FoldableWidth = 884,
  [int]$FoldableHeight = 1104,
  [switch]$CaptureScreenshots,
  [string]$ScreenshotTaskName = "frontend-ui-regression",
  [string]$ScreenshotOutputDir = "",
  [string]$RequireThreadTitle = "",
  [int]$AgentBrowserTimeoutSec = 25,
  [switch]$MeasureSendFeedback,
  [switch]$MeasureNewThreadFeedback,
  [switch]$MeasureResponseFeedback
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[7420-frontend] $Message"
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Convert-ToSafeFileName {
  param([string]$Name)

  $safe = $Name -replace '[^A-Za-z0-9_.-]+', '-'
  $safe = $safe.Trim('-')
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "screenshot"
  }
  return $safe
}

function Assert-AndroidResumeThreadListRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $functionMatch = [regex]::Match($source, "function\s+shouldRefreshThreadListForResume[\s\S]*?\n\s*}")
  Assert-True ($functionMatch.Success) "could not find shouldRefreshThreadListForResume source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -notmatch "if\s*\(\s*androidShellAvailable\s*\)\s*return\s+false") "Android resume thread-list recovery is disabled"
  Assert-True ($source -match "const\s+ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS\s*=\s*120000") "Android resume thread-list recovery interval must remain 120 seconds"
  Assert-True ($functionSource -match "return\s+isFirstAttempt\s*&&\s*now\s*-\s*lastThreadListSyncAtMs\s*>=\s*ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS") "Android resume must refresh a stale thread list on the first resume attempt"
}

function Assert-CrossClientThreadStartedRefreshSource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $functionMatch = [regex]::Match($source, "function\s+shouldRefreshThreadListFromNotification[\s\S]*?\n\s*}")
  Assert-True ($functionMatch.Success) "could not find shouldRefreshThreadListFromNotification source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "method\s*===\s*'thread/started'") "thread/started must invalidate the thread list for other 7420 clients"
  Assert-True ($functionSource -match "method\s*===\s*THREAD_TOKEN_USAGE_UPDATED_METHOD\)\s*return\s+false") "token usage updates must not trigger thread-list refreshes"
}

function Assert-PendingStartOutboxRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $functionMatch = [regex]::Match($source, "async\s+function\s+recoverPersistentMessageOutbox[\s\S]*?\n\s*async\s+function\s+runSendPreflightWithBoundedRecovery")
  Assert-True ($functionMatch.Success) "could not find recoverPersistentMessageOutbox source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "recovered\?\.status\s*===\s*'pending_start'\s*&&\s*!recoveredThreadId") "threadless pending_start requests must be recovered before removing the outbox entry"
  Assert-True ($functionSource -match "startRuntimeThreadTurn\(\{[\s\S]*?clientMessageId:\s*entry\.clientMessageId") "threadless pending_start recovery must reuse the durable client message id"
  Assert-True ($functionSource -match "isRuntimeRequestAwaitingDeliveryConfirmation\(recovered\.status\)[\s\S]*?restoreConfirmingMessageOutboxEntry") "unconfirmed runtime requests must keep a confirming outbox bubble"
  Assert-True ($source -match "function\s+markOptimisticUserMessageConfirming[\s\S]*?updateMessageOutboxEntry\(clientMessageId,\s*\{\s*state:\s*'confirming'\s*\}\)") "confirming delivery must remain durable in the message outbox"
  Assert-True ($source -match "runtimeResult\s*&&\s*isRuntimeRequestAwaitingDeliveryConfirmation\(runtimeResult\.status\)[\s\S]*?markOptimisticUserMessageConfirming") "direct sends must not present an unconfirmed request as sent"
  Assert-True ($source -match "messageOutboxRemovalByClientId[\s\S]*?mergeMessageOutboxState") "cross-page outbox recovery must retain deletion markers"
  Assert-True ($source -match "removeMessageOutboxEntry[\s\S]*?messageOutboxRemovalByClientId\.set\(clientMessageId,\s*removedAtMs\)") "confirmed outbox deletion must prevent stale-page resurrection"
  Assert-True ($source -match "function\s+convergeMessageOutboxFromStorage[\s\S]*?mergeMessageOutboxFromStorage\(\)[\s\S]*?persistMessageOutbox\(\)") "concurrent storage writes must merge and converge instead of replacing local state"
  Assert-True ($source -match "function\s+reconcilePendingNewThreadPreviewWithOutbox[\s\S]*?pendingNewThreadPreview\.value\s*=\s*null") "cross-page outbox removal must clear a stale new-thread preview"
  Assert-True ($functionSource -match "await\s+getRuntimeRequestByClientMessageId\(entry\.clientMessageId\)[\s\S]*?messageOutboxByClientId\.get\(entry\.clientMessageId\)[\s\S]*?if\s*\(!currentEntry\)\s*continue") "outbox recovery must discard stale lookup results after another page removes the entry"
  Assert-True ($source -match "isFirstAttempt\)[\s\S]*?mergeMessageOutboxFromStorage\(\)[\s\S]*?recoverPersistentMessageOutbox\(\)") "foreground resume must reconcile the durable message outbox on its first attempt"
  Assert-True ($source -match "addEventListener\('storage',\s*onStorage\)") "parallel 7420 pages must observe message outbox storage changes"
}

function Assert-RuntimeSnapshotOrderingSource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  Assert-True ($source -match "shouldApplyRuntimeSnapshotVersion\(runtimeStatusSummaryByThreadId\.value\[threadId\],\s*snapshot\)") "runtime snapshots must be checked against the latest applied event sequence"
  Assert-True ($source -match "eventSeq:\s*notification\.seq") "runtime notification state must retain the authoritative event sequence"
  Assert-True ($source -match "const\s+runtimeSnapshotApplied\s*=\s*applyRuntimeSnapshotState") "message reconciliation must know when an outdated runtime snapshot was rejected"
}

function Assert-BoundedRuntimeSendRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  Assert-True ($source -match "const\s+RUNTIME_SEND_RETRY_DELAYS_MS\s*=\s*\[650,\s*1800\]") "runtime send retries must remain bounded to two delays"
  $functionMatch = [regex]::Match($source, "async\s+function\s+startRuntimeTurnWithBoundedRecovery[\s\S]*?\n\s*function\s+hydrateCachedMessagesForThread")
  Assert-True ($functionMatch.Success) "could not find startRuntimeTurnWithBoundedRecovery source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "runWithBoundedRecovery\(\{") "production runtime sends must use the tested bounded recovery coordinator"
  Assert-True ($functionSource -match "getRuntimeRequestByClientMessageId\(args\.clientMessageId\)") "transport failures must reconcile the same client message id before retrying"
  Assert-True ($functionSource -match "markOptimisticUserMessageRetrying") "bounded recovery must publish visible retry progress"
  $preflightMatch = [regex]::Match($source, "async\s+function\s+runSendPreflightWithBoundedRecovery[\s\S]*?\n\s*async\s+function\s+startRuntimeTurnWithBoundedRecovery")
  Assert-True ($preflightMatch.Success) "could not find bounded send preflight recovery source"
  Assert-True ($preflightMatch.Value -match "runWithBoundedRecovery\(\{") "send preflight must use the tested bounded recovery coordinator"
  Assert-True ($source -match "runSendPreflightWithBoundedRecovery\([\s\S]*?recoverThreadExecutionState") "thread-state preflight failures must receive bounded reconnect feedback"
  Assert-True ($source -match "if\s*\(wasThreadInProgressBeforeSubmit\)\s*\{[\s\S]*?recoverThreadExecutionState") "idle sends must not recover the optimistic state they just created"
  Assert-True ($source -match "runSendPreflightWithBoundedRecovery\([\s\S]*?ensureThreadResumed") "thread-resume preflight failures must receive bounded reconnect feedback"
  Assert-True ($source -match "const\s+runtimeStateBeforeSubmit\s*=\s*runtimeExecutionStateByThreadId\.value\[threadId\]") "send failure cleanup must capture the authoritative runtime state before optimistic feedback"
  Assert-True ($source -match "const\s+isInProgress\s*=\s*runtimeStateAfterRecovery\s*!==\s*undefined[\s\S]*?isRuntimeExecutionActiveState\(runtimeStateAfterRecovery\)[\s\S]*?wasThreadInProgressBeforeSubmit") "authoritative runtime state must win over a stale thread-list in-progress marker"
  Assert-True ($source -match "markOptimisticUserMessageFailed\(threadId,\s*optimisticMessageId,\s*failedMessageRequest\)[\s\S]*?setTurnErrorForThread\(threadId,\s*null\)") "local send failure must stay on the message bubble instead of creating a false turn-error overlay"
  $manualRetryMatch = [regex]::Match($source, "async\s+function\s+retryFailedUserMessage[\s\S]*?\n\s*function\s+restoreFailedMessageOutboxEntry")
  Assert-True ($manualRetryMatch.Success) "could not find failed-message retry source"
  Assert-True ($manualRetryMatch.Value -notmatch "removeOptimisticUserMessage") "manual retry must update the failed bubble in place instead of replacing it"
  Assert-True ($manualRetryMatch.Value -match "reuseOptimisticMessageId:\s*messageId") "manual retry must pass the original optimistic message id into the send path"
  Assert-True ($manualRetryMatch.Value -match "targetThreadId:\s*request\.threadId") "manual retry must target the failed message thread instead of depending on transient global selection"
  Assert-True ($manualRetryMatch.Value -notmatch "selectedThreadId\.value\s*!==\s*request\.threadId") "manual retry must not silently stop during route-selection convergence"
  Assert-True ($manualRetryMatch.Value -match "durableEntry\?\.state\s*===\s*'failed'\s*\?\s*failedUserMessageRequestFromOutbox") "manual retry must recover its request from the durable outbox when volatile state was lost"
  Assert-True ($source -match "messageId:\s*reusedOptimisticMessageId\s*\|\|\s*undefined[\s\S]*?deliveryState:\s*'sending'") "the send path must reset a reused failed bubble to sending"
  Assert-True ($source -match "function\s+restoreFailedMessageOutboxEntry[\s\S]*?findOptimisticMessageIdForOutbox\(entry\.clientMessageId,\s*normalizedThreadId\)\s*\|\|\s*addOptimisticUserMessage") "failed outbox recovery must reuse the current optimistic bubble before creating one after reload"
  Assert-True ($appSource -match "function\s+onSubmitThreadMessage[\s\S]*?const\s+feedbackStartedAtMs\s*=\s*isHomeRoute\.value\s*\|\|\s*payload\.mode\s*===\s*'steer'\s*\?\s*chatFeedbackNow\(\)") "message feedback timing must start at the composer submit handler"
  Assert-True ($source -match "const\s+feedbackStartedAtMs\s*=\s*internalOptions\.feedbackStartedAtMs\s*\?\?\s*chatFeedbackNow\(\)") "non-composer sends must retain a local feedback timing fallback"
  Assert-True ($source -match "beginChatFeedbackMetric\(\{[\s\S]*?clientMessageId,[\s\S]*?optimisticMessageId,[\s\S]*?submitStartedAtMs:\s*feedbackStartedAtMs") "message feedback timing must bind the send id to its optimistic bubble"
  Assert-True ($source -match "pendingNewThreadPreview\.value\s*=\s*\{[\s\S]*?message:\s*\{[\s\S]*?id:\s*optimisticMessageId") "new-thread sends must publish an immediate in-memory conversation preview"
  Assert-True ($source -match "addOptimisticUserMessage\(threadId,[\s\S]*?messageId:\s*optimisticMessageId") "the real thread must adopt the provisional bubble id instead of creating a duplicate"
  Assert-True ($source -match "internalOptions\.onThreadCreated\?\.\(threadId\)") "new-thread sends must announce the authoritative thread before waiting for the first turn"
  Assert-True ($appSource -match "routeToCreatedThreadPromise\s*=\s*navigateToCreatedThread\(threadId\)") "the app must enter a newly created thread while its first turn continues in the background"
  Assert-True ($source -match "else\s*\{\s*markPendingNewThreadPreviewFailed\(clientMessageId,\s*optimisticMessageId\)") "threadless send failure must retain the outbox-backed preview bubble"
  Assert-True ($source -match "async\s+function\s+retryFailedNewThreadMessage[\s\S]*?reuseOptimisticMessageId:\s*messageId") "threadless manual retry must reuse the same visual message id"
  Assert-True ($source -match "function\s+takeFailedNewThreadMessageForEditing[\s\S]*?removeMessageOutboxEntry\(entry\.clientMessageId\)[\s\S]*?pendingNewThreadPreview\.value\s*=\s*null") "editing a failed threadless message must atomically leave preview mode and clear its outbox attempt"
  Assert-True ($source -match "if\s*\(newestDraftEntry\)\s*\{\s*restoreFailedNewThreadOutboxEntry\(newestDraftEntry\)") "restart recovery must restore a failed new-thread bubble instead of silently moving it back to the composer"
  Assert-True ($appSource -match 'data-testid="pending-new-thread-preview"[\s\S]*?:messages="\[pendingNewThreadPreview\.message\]"') "the home route must render the provisional first turn as a conversation"
  Assert-True ($functionSource -match "markChatFeedbackRequestDispatched\(args\.clientMessageId\)") "runtime sends must mark the first request dispatch"
  Assert-True ($functionSource -match "markChatFeedbackServerAcknowledged\(\{[\s\S]*?clientMessageId:\s*args\.clientMessageId") "runtime send acknowledgement must remain bound to its client message id"
  Assert-True ($source -match "const\s+startedTurn\s*=\s*readTurnStartedInfo\(notification\)[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?turnStarted:\s*true") "turn/started must mark authoritative server acceptance"
  Assert-True ($source -match "const\s+liveAgentMessageDelta\s*=\s*readAgentMessageDelta\(notification\)[\s\S]*?markChatFeedbackFirstAssistantData") "the first assistant delta must mark data receipt before rendering"
}

function Invoke-AgentBrowser {
  param([string[]]$Arguments)

  $command = Get-Command agent-browser -ErrorAction Stop
  $stdoutPath = [IO.Path]::GetTempFileName()
  $stderrPath = [IO.Path]::GetTempFileName()
  $process = $null
  try {
    if ($command.CommandType -eq "ExternalScript") {
      $fileName = "powershell"
      $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $command.Source) + $Arguments
    } else {
      $fileName = $command.Source
      $argumentList = $Arguments
    }

    $process = Start-Process `
      -FilePath $fileName `
      -ArgumentList $argumentList `
      -NoNewWindow `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru

    if (-not $process.WaitForExit($AgentBrowserTimeoutSec * 1000)) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      } catch {}
      throw "agent-browser $($Arguments -join ' ') timed out after $AgentBrowserTimeoutSec seconds"
    }

    $output = @()
    if (Test-Path -LiteralPath $stdoutPath) {
      $output += Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrPath) {
      $output += Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
    }
    $exitCode = if ($null -eq $process.ExitCode) { 0 } else { [int]$process.ExitCode }
    if ($exitCode -ne 0) {
      throw "agent-browser $($Arguments -join ' ') failed with exit code $exitCode`n$($output -join "`n")"
    }
    return @($output)
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Initialize-ScreenshotOutputDir {
  if (-not $CaptureScreenshots) {
    return $null
  }

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $outputRoot = if ([string]::IsNullOrWhiteSpace($ScreenshotOutputDir)) {
    Join-Path $repoRoot (Join-Path "output" (Join-Path "regression-7420" (Convert-ToSafeFileName -Name $ScreenshotTaskName)))
  } else {
    $ScreenshotOutputDir
  }
  $resolvedParent = Split-Path -Parent $outputRoot
  if (-not [string]::IsNullOrWhiteSpace($resolvedParent)) {
    New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null
  }
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  return (Resolve-Path -LiteralPath $outputRoot).Path
}

function Save-RegressionScreenshot {
  param(
    [string]$Session,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($script:screenshotOutputDir)) {
    return $null
  }

  $fileName = (Convert-ToSafeFileName -Name $Name) + ".png"
  $path = Join-Path $script:screenshotOutputDir $fileName
  Invoke-AgentBrowser -Arguments @("--session", $Session, "screenshot", $path) | Out-Null
  $resolved = (Resolve-Path -LiteralPath $path).Path
  Write-Step "screenshot saved -> $resolved"
  return $resolved
}

function Invoke-BrowserEvalJson {
  param(
    [string]$Session,
    [string]$Script
  )

  $bytes = [Text.Encoding]::UTF8.GetBytes($Script)
  $base64 = [Convert]::ToBase64String($bytes)
  $output = Invoke-AgentBrowser -Arguments @("--session", $Session, "eval", "-b", $base64)
  $jsonLines = $output |
    ForEach-Object { [string]$_ } |
    Where-Object {
      $line = $_.Trim()
      $line.StartsWith("{") -or $line.StartsWith('"')
    }
  $jsonLine = (($jsonLines | ForEach-Object { $_.Trim() }) -join "")

  if (-not $jsonLine) {
    throw "agent-browser eval did not return JSON. Output:`n$($output -join "`n")"
  }
  $parsed = $jsonLine | ConvertFrom-Json
  if ($parsed -is [string]) {
    return ($parsed | ConvertFrom-Json)
  }
  return $parsed
}

function Measure-ThreadSendFeedbackBudget {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $probeText = "7420-send-feedback-budget-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'on') | Out-Null

  try {
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
    $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
    Assert-True ($clickState.clicked -eq $true) "send feedback probe could not click the composer submit button"

    $metrics = $null
    $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
    for ($attempt = 1; $attempt -le 10; $attempt++) {
      $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return { metric, promptCount };
})())
"@
      $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
      if (
        $null -ne $metrics.metric -and
        $null -ne $metrics.metric.bubbleVisibleLatencyMs -and
        $null -ne $metrics.metric.runningVisibleLatencyMs
      ) {
        break
      }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '50') | Out-Null
    }

    Assert-True ($null -ne $metrics.metric) "send feedback page metric was not recorded"
    Assert-True ([int]$metrics.promptCount -eq 1) "send feedback probe did not render exactly one optimistic bubble"
    Assert-True ([int]$metrics.metric.stateCommitLatencyMs -le 50) "send feedback state commit exceeded 50 ms"
    Assert-True ([int]$metrics.metric.bubbleVisibleLatencyMs -le 200) "send feedback bubble exceeded 200 ms"
    Assert-True ([int]$metrics.metric.runningVisibleLatencyMs -le 200) "send feedback running indicator exceeded 200 ms"
    Write-Step ("send feedback timing -> " + (@{
      threadId = $ThreadId
      stateCommitMs = [int]$metrics.metric.stateCommitLatencyMs
      bubbleVisibleMs = [int]$metrics.metric.bubbleVisibleLatencyMs
      runningVisibleMs = [int]$metrics.metric.runningVisibleLatencyMs
    } | ConvertTo-Json -Compress))
    $focusScript = @"
JSON.stringify((() => {
  const item = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .find((row) => row.textContent?.includes('$escapedProbe'));
  item?.scrollIntoView({ block: 'center' });
  return { focused: Boolean(item) };
})())
"@
    $focusState = Invoke-BrowserEvalJson -Session $Session -Script $focusScript
    Assert-True ($focusState.focused -eq $true) "send feedback probe could not be focused for screenshot evidence"
    Save-RegressionScreenshot -Session $Session -Name 'send-feedback-budget-phone' | Out-Null
  } finally {
    try { Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null } catch {}
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLTextAreaElement) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null
    } catch {}
  }
}

function Measure-NewThreadSendFeedbackBudget {
  param([string]$Session)

  $probeText = "7420-new-thread-feedback-budget-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'on') | Out-Null

  try {
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
    $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
    Assert-True ($clickState.clicked -eq $true) "new-thread feedback probe could not click the composer submit button"

    $metrics = $null
    $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
    for ($attempt = 1; $attempt -le 12; $attempt++) {
      $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const preview = document.querySelector('[data-testid="pending-new-thread-preview"]');
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return {
    metric,
    previewVisible: Boolean(preview),
    promptCount,
    composerDisabled: document.querySelector('.thread-composer-input')?.disabled === true
  };
})())
"@
      $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
      if (
        $null -ne $metrics.metric -and
        $null -ne $metrics.metric.bubbleVisibleLatencyMs -and
        $null -ne $metrics.metric.runningVisibleLatencyMs
      ) {
        break
      }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '50') | Out-Null
    }

    Assert-True ($null -ne $metrics.metric) "new-thread feedback page metric was not recorded"
    Assert-True ($metrics.previewVisible -eq $true) "new-thread feedback did not replace the empty home state"
    Assert-True ([int]$metrics.promptCount -eq 1) "new-thread feedback did not render exactly one provisional bubble"
    Assert-True ($metrics.composerDisabled -eq $true) "new-thread feedback did not guard against duplicate submit"
    Assert-True ([int]$metrics.metric.stateCommitLatencyMs -le 50) "new-thread feedback state commit exceeded 50 ms"
    Assert-True ([int]$metrics.metric.bubbleVisibleLatencyMs -le 200) "new-thread feedback bubble exceeded 200 ms"
    Assert-True ([int]$metrics.metric.runningVisibleLatencyMs -le 200) "new-thread feedback running indicator exceeded 200 ms"
    Write-Step ("new-thread feedback timing -> " + (@{
      stateCommitMs = [int]$metrics.metric.stateCommitLatencyMs
      bubbleVisibleMs = [int]$metrics.metric.bubbleVisibleLatencyMs
      runningVisibleMs = [int]$metrics.metric.runningVisibleLatencyMs
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-feedback-budget-phone' | Out-Null

    $failedState = $null
    for ($attempt = 1; $attempt -le 24; $attempt++) {
      $failedScript = @"
JSON.stringify((() => {
  const item = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .find((row) => row.textContent?.includes('$escapedProbe'));
  const delivery = item?.querySelector('.message-delivery-state');
  let outboxState = '';
  try {
    outboxState = JSON.parse(window.localStorage.getItem('codex-web-local.message-outbox.v1') || '{}')?.entries?.[0]?.state || '';
  } catch {}
  return {
    messageId: item?.getAttribute('data-message-id') || '',
    deliveryState: delivery?.getAttribute('data-state') || '',
    retryButtonCount: Array.from(item?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '重试').length,
    editButtonCount: Array.from(item?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '编辑').length,
    runningCount: document.querySelectorAll('.live-overlay-inline').length,
    outboxState,
    promptCount: Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
      .filter((row) => row.textContent?.includes('$escapedProbe')).length
  };
})())
"@
      $failedState = Invoke-BrowserEvalJson -Session $Session -Script $failedScript
      if ([string]$failedState.deliveryState -eq 'failed') { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
    }
    Assert-True ([string]$failedState.deliveryState -eq 'failed') "threadless send failure did not stay as a failed bubble"
    Assert-True ([int]$failedState.retryButtonCount -eq 1) "threadless send failure is missing its retry action"
    Assert-True ([int]$failedState.editButtonCount -eq 1) "threadless send failure is missing its edit action"
    Assert-True ([int]$failedState.runningCount -eq 0) "threadless send failure left a false running indicator"
    Assert-True ([string]$failedState.outboxState -eq 'failed') "threadless send failure was removed from the durable outbox"
    Assert-True ([int]$failedState.promptCount -eq 1) "threadless send failure duplicated or removed the original bubble"
    $failedMessageId = [string]$failedState.messageId
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-failed-retry-phone' | Out-Null

    $retryScript = @'
JSON.stringify((() => {
  const button = Array.from(document.querySelectorAll('[data-testid="pending-new-thread-preview"] .message-delivery-retry'))
    .find((candidate) => candidate.textContent?.trim() === '重试');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $retryState = Invoke-BrowserEvalJson -Session $Session -Script $retryScript
    Assert-True ($retryState.clicked -eq $true) "threadless failed message retry could not be clicked"
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

    $retryingScript = @"
JSON.stringify((() => {
  const item = document.querySelector('.conversation-item[data-message-id]');
  const delivery = item?.querySelector('.message-delivery-state');
  return {
    messageId: item?.getAttribute('data-message-id') || '',
    deliveryState: delivery?.getAttribute('data-state') || '',
    promptCount: document.querySelectorAll('.conversation-item[data-message-id]').length
  };
})())
"@
    $retryingState = Invoke-BrowserEvalJson -Session $Session -Script $retryingScript
    Assert-True ([string]$retryingState.messageId -eq $failedMessageId) "threadless retry replaced the original visual message"
    Assert-True ([string]$retryingState.deliveryState -in @('sending', 'retrying')) "threadless retry did not return the same bubble to an active delivery state"
    Assert-True ([int]$retryingState.promptCount -eq 1) "threadless retry appended a duplicate bubble"

    $retryFailedAgain = $null
    for ($attempt = 1; $attempt -le 24; $attempt++) {
      $retryFailedAgain = Invoke-BrowserEvalJson -Session $Session -Script $failedScript
      if ([string]$retryFailedAgain.deliveryState -eq 'failed') { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
    }
    Assert-True ([string]$retryFailedAgain.deliveryState -eq 'failed') "threadless retry did not return to an actionable failed state after bounded exhaustion"
    Assert-True ([string]$retryFailedAgain.messageId -eq $failedMessageId) "threadless retry changed the visual message id after failure"
    Assert-True ([int]$retryFailedAgain.promptCount -eq 1) "threadless retry left duplicate bubbles after bounded exhaustion"

    $editScript = @'
JSON.stringify((() => {
  const button = Array.from(document.querySelectorAll('[data-testid="pending-new-thread-preview"] .message-delivery-retry'))
    .find((candidate) => candidate.textContent?.trim() === '编辑');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $editState = Invoke-BrowserEvalJson -Session $Session -Script $editScript
    Assert-True ($editState.clicked -eq $true) "threadless failed message could not return to editing"
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
    $editedScript = @"
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  let outbox = {};
  try { outbox = JSON.parse(window.localStorage.getItem('codex-web-local.message-outbox.v1') || '{}'); } catch {}
  return {
    inputValue: input instanceof HTMLTextAreaElement ? input.value : '',
    previewCount: document.querySelectorAll('[data-testid="pending-new-thread-preview"]').length,
    outboxEntryCount: Array.isArray(outbox.entries) ? outbox.entries.length : 0,
    outboxRemovalCount: Array.isArray(outbox.removals) ? outbox.removals.length : 0
  };
})())
"@
    $editedState = Invoke-BrowserEvalJson -Session $Session -Script $editedScript
    Assert-True ([string]$editedState.inputValue -eq $probeText) "threadless failed message edit lost the original content"
    Assert-True ([int]$editedState.previewCount -eq 0) "threadless failed message edit left preview mode mounted"
    Assert-True ([int]$editedState.outboxEntryCount -eq 0) "threadless failed message edit retained the known-failed outbox attempt"
    Assert-True ([int]$editedState.outboxRemovalCount -ge 1) "threadless failed message edit did not retain its cross-page deletion marker"
  } finally {
    try { Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null } catch {}
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  delete window.__cxCodexChatFeedbackMetrics;
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null
    } catch {}
  }
}

function Measure-NewThreadAuthoritativeHandoff {
  param(
    [string]$Session,
    [string]$BaseUrl
  )

  $probeText = "7420-new-thread-handoff-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  const originalFetch = window.fetch.bind(window);
  window.__cxCodexHandoffStartedAt = performance.now();
  window.fetch = (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
    if (url.includes('/codex-api/runtime/send')) {
      return new Promise((_, reject) => {
        window.setTimeout(() => reject(new TypeError('simulated delayed runtime transport')), 1200);
      });
    }
    return originalFetch(input, init);
  };
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  window.__cxCodexHandoffStartedAt = performance.now();
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "new-thread handoff probe could not click submit"

  $handoff = $null
  $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
  for ($attempt = 1; $attempt -le 100; $attempt++) {
    $readScript = @"
JSON.stringify((() => {
  const match = window.location.hash.match(/\/thread\/([^/?#]+)/);
  const threadId = match?.[1] ? decodeURIComponent(match[1]) : '';
  const items = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'));
  const delivery = items[0]?.querySelector('.message-delivery-state');
  return {
    threadId,
    routeLatencyMs: Math.round(performance.now() - (window.__cxCodexHandoffStartedAt || performance.now())),
    promptCount: items.length,
    deliveryState: delivery?.getAttribute('data-state') || '',
    runningCount: document.querySelectorAll('.live-overlay-inline').length,
    previewCount: document.querySelectorAll('[data-testid="pending-new-thread-preview"]').length
  };
})())
"@
    $handoff = Invoke-BrowserEvalJson -Session $Session -Script $readScript
    if (
      -not [string]::IsNullOrWhiteSpace([string]$handoff.threadId) -and
      [int]$handoff.promptCount -eq 1 -and
      [string]$handoff.deliveryState -in @('sending', 'retrying')
    ) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }

  $threadId = [string]$handoff.threadId
  try {
    Assert-True (-not [string]::IsNullOrWhiteSpace($threadId)) "new-thread handoff did not enter the authoritative thread"
    Assert-True ([int]$handoff.promptCount -eq 1) "new-thread handoff did not preserve exactly one message bubble"
    Assert-True ([string]$handoff.deliveryState -in @('sending', 'retrying')) "new-thread handoff waited for runtime completion before entering the thread"
    Assert-True ([int]$handoff.runningCount -ge 1) "new-thread handoff lost the running timeline"
    Assert-True ([int]$handoff.previewCount -eq 0) "new-thread handoff left the provisional home surface mounted"
    Write-Step ("new-thread authoritative handoff -> " + (@{
      threadId = $threadId
      routeLatencyMs = [int]$handoff.routeLatencyMs
      deliveryState = [string]$handoff.deliveryState
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-authoritative-handoff-phone' | Out-Null

    $settled = $null
    for ($attempt = 1; $attempt -le 40; $attempt++) {
      $settled = Invoke-BrowserEvalJson -Session $Session -Script $readScript
      if ([string]$settled.deliveryState -eq 'failed') { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
    }
    Assert-True ([string]$settled.deliveryState -eq 'failed') "new-thread handoff probe did not settle after bounded simulated transport failure"
  } finally {
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
    } catch {}
    if (-not [string]::IsNullOrWhiteSpace($threadId)) {
      try {
        Invoke-PostJson -Name 'archive new-thread handoff probe' -Url "$($BaseUrl)/codex-api/rpc" -Payload @{
          method = 'thread/archive'
          params = @{ threadId = $threadId }
        } | Out-Null
      } catch {}
    }
    try {
      Open-And-ReadPage -Session $Session -Url "$($BaseUrl)/#/" -Width 393 -Height 852 | Out-Null
    } catch {}
  }
}

function Measure-ThreadResponseFeedbackBudget {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $probeText = "请只回复：7420-ACK-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
  $prepareScript = @'
JSON.stringify((() => {
  delete window.__cxCodexChatFeedbackMetrics;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "response feedback probe could not click the composer submit button"

  $metrics = $null
  for ($attempt = 1; $attempt -le 240; $attempt++) {
    $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return { metric, promptCount };
})())
"@
    $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
    if ($null -ne $metrics.metric.firstAssistantVisibleLatencyMs) {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
  }

  Assert-True ($null -ne $metrics.metric) "response feedback page metric was not recorded"
  Assert-True ([int]$metrics.promptCount -eq 1) "response feedback probe did not render exactly one user bubble"
  Assert-True ($null -ne $metrics.metric.serverAcknowledgedLatencyMs) "server acknowledgement was not observed"
  Assert-True ($null -ne $metrics.metric.firstAssistantDataLatencyMs) "first assistant data was not observed"
  Assert-True ($null -ne $metrics.metric.firstAssistantVisibleLatencyMs) "first assistant response was not visibly rendered"
  $renderOverheadMs = [int]$metrics.metric.firstAssistantVisibleLatencyMs - [int]$metrics.metric.firstAssistantDataLatencyMs
  Write-Step ("response feedback timing -> " + (@{
    threadId = $ThreadId
    requestDispatchedMs = [int]$metrics.metric.requestDispatchedLatencyMs
    serverAcknowledgedMs = [int]$metrics.metric.serverAcknowledgedLatencyMs
    turnStartedMs = [int]$metrics.metric.turnStartedLatencyMs
    firstAssistantDataMs = [int]$metrics.metric.firstAssistantDataLatencyMs
    firstAssistantVisibleMs = [int]$metrics.metric.firstAssistantVisibleLatencyMs
    renderOverheadMs = $renderOverheadMs
  } | ConvertTo-Json -Compress))
  Assert-True ([int]$metrics.metric.requestDispatchedLatencyMs -le 500) "runtime request dispatch exceeded 500 ms"
  Assert-True ([int]$metrics.metric.serverAcknowledgedLatencyMs -le 5000) "server acknowledgement exceeded 5000 ms"
  Assert-True ([int]$metrics.metric.firstAssistantDataLatencyMs -le 45000) "first assistant data exceeded 45000 ms"
  Assert-True ($renderOverheadMs -le 250) "first assistant render overhead exceeded 250 ms"
  Save-RegressionScreenshot -Session $Session -Name 'response-feedback-budget-phone' | Out-Null
}

function Reset-AppShellLayoutPreferences {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  window.localStorage.setItem('codex-web-local.sidebar-collapsed.v1', '0');
  window.localStorage.removeItem('codex-web-local.sidebar-width.v1');
  window.localStorage.removeItem('codex-web-local.collapsed-projects.v1');
  window.localStorage.setItem('codex-web-local.thread-view-mode.v1', 'project');
  return { reset: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Set-SidebarCollapsedPreference {
  param(
    [string]$Session,
    [bool]$Collapsed
  )

  $collapsedValue = if ($Collapsed) { "1" } else { "0" }
  $script = @"
JSON.stringify((() => {
  window.localStorage.setItem('codex-web-local.sidebar-collapsed.v1', '$collapsedValue');
  return { collapsed: '$collapsedValue' };
})())
"@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Seed-PersistentOutboxDraftRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const now = Date.now();
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.setItem('codex-web-local.message-outbox.v1', JSON.stringify({
    version: 1,
    entries: [{
      clientMessageId: `regression-outbox-${now}`,
      threadId: '',
      cwd: 'E:/regression-outbox-project',
      text: '刷新后仍然保留的待发送消息',
      imageUrls: [],
      skills: [],
      fileAttachments: [],
      modelId: '',
      reasoningEffort: 'medium',
      collaborationMode: 'execute',
      state: 'sending',
      createdAtMs: now,
      updatedAtMs: now
    }]
  }));
  return { seeded: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Read-PersistentOutboxDraftRecoveryMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  const persistedDraftRaw = window.localStorage.getItem('codex-web-local.thread-draft.v1.__new-thread__');
  let persistedDraftText = '';
  try {
    persistedDraftText = JSON.parse(persistedDraftRaw || '{}')?.text || '';
  } catch {}
  let outboxState = '';
  try {
    outboxState = JSON.parse(window.localStorage.getItem('codex-web-local.message-outbox.v1') || '{}')?.entries?.[0]?.state || '';
  } catch {}
  const preview = document.querySelector('[data-testid="pending-new-thread-preview"]');
  const failedMessage = preview?.querySelector('.message-delivery-state[data-state="failed"]');
  return {
    inputValue: input instanceof HTMLTextAreaElement ? input.value : '',
    outboxPresent: window.localStorage.getItem('codex-web-local.message-outbox.v1') !== null,
    outboxState,
    persistedDraftText,
    previewVisible: Boolean(preview),
    failedMessageCount: failedMessage ? 1 : 0,
    retryButtonCount: Array.from(preview?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '重试').length,
    editButtonCount: Array.from(preview?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '编辑').length,
    previewText: preview?.textContent || ''
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-PersistentOutboxDraftRecovery {
  param([string]$Session)

  $metrics = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $metrics = Read-PersistentOutboxDraftRecoveryMetrics -Session $Session
    if ($metrics.previewVisible -eq $true -and [int]$metrics.failedMessageCount -eq 1) {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null
  }
  Assert-True ($metrics.previewVisible -eq $true) "persistent outbox did not restore the new-thread conversation preview"
  Assert-True ([string]$metrics.previewText -like '*刷新后仍然保留的待发送消息*') "persistent outbox preview lost the original message"
  Assert-True ([int]$metrics.failedMessageCount -eq 1) "persistent outbox did not restore an actionable failed delivery state"
  Assert-True ([int]$metrics.retryButtonCount -eq 1) "persistent outbox did not restore the retry action"
  Assert-True ([int]$metrics.editButtonCount -eq 1) "persistent outbox did not restore the edit action"
  Assert-True ([bool]$metrics.outboxPresent) "persistent outbox was removed before the user retried or discarded the message"
  Assert-True ([string]$metrics.outboxState -eq 'failed') "persistent outbox did not converge to failed state"
  Assert-True ([string]$metrics.inputValue -eq '') "persistent outbox duplicated the failed message into the composer"
}

function Clear-PersistentOutboxDraftRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  return { cleared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Dispatch-MobileResumeOutboxRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLTextAreaElement) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const now = Date.now();
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.setItem('codex-web-local.message-outbox.v1', JSON.stringify({
    version: 1,
    entries: [{
      clientMessageId: `regression-mobile-resume-${now}`,
      threadId: '',
      cwd: 'E:/regression-mobile-resume-project',
      text: '回到前台自动恢复的待发送消息',
      imageUrls: [],
      skills: [],
      fileAttachments: [],
      modelId: '',
      reasoningEffort: 'medium',
      collaborationMode: 'execute',
      state: 'confirming',
      createdAtMs: now,
      updatedAtMs: now
    }]
  }));
  window.dispatchEvent(new Event('codex-mobile-resume'));
  return { dispatched: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Assert-MobileResumeOutboxRecovery {
  param([string]$Session)

  $metrics = $null
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $metrics = Read-PersistentOutboxDraftRecoveryMetrics -Session $Session
    if ($metrics.previewVisible -eq $true -and [string]$metrics.previewText -like '*回到前台自动恢复的待发送消息*') {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '300') | Out-Null
  }
  Assert-True ($metrics.previewVisible -eq $true) "mobile resume did not restore the durable message bubble"
  Assert-True ([string]$metrics.previewText -like '*回到前台自动恢复的待发送消息*') "mobile resume lost the durable message content"
  Assert-True ([int]$metrics.failedMessageCount -eq 1) "mobile resume did not make the unresolved message retryable"
  Assert-True ([int]$metrics.retryButtonCount -eq 1) "mobile resume did not restore the retry control"
  Assert-True ([int]$metrics.editButtonCount -eq 1) "mobile resume did not restore the edit control"
  Assert-True ([bool]$metrics.outboxPresent) "mobile resume removed the durable message before user action"
  Assert-True ([string]$metrics.outboxState -eq 'failed') "mobile resume outbox did not converge to failed state"
}

function Close-SettingsPanelIfOpen {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  if (!panel) return { hadPanel: false, closed: false };
  const button = document.querySelector('.sidebar-settings-button');
  if (button instanceof HTMLElement) {
    button.click();
    return { hadPanel: true, closed: true };
  }
  return { hadPanel: true, closed: false };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Test-HttpJson {
  param(
    [string]$Name,
    [string]$Url
  )

  Write-Step "checking $Name -> $Url"
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 25
      Assert-True ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) "$Name returned HTTP $($response.StatusCode)"
      return ($response.Content | ConvertFrom-Json)
    } catch {
      $lastError = $_
      Write-Step "$Name request failed (attempt $attempt/3): $($_.Exception.Message)"
      Start-Sleep -Milliseconds 900
    }
  }
  throw $lastError
}

function Invoke-PostJson {
  param(
    [string]$Name,
    [string]$Url,
    [object]$Payload
  )

  Write-Step "posting $Name -> $Url"
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $response = Invoke-WebRequest `
        -Uri $Url `
        -UseBasicParsing `
        -Method Post `
        -ContentType "application/json" `
        -Body ($Payload | ConvertTo-Json -Depth 12 -Compress) `
        -TimeoutSec 35
      Assert-True ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) "$Name returned HTTP $($response.StatusCode)"
      return ($response.Content | ConvertFrom-Json)
    } catch {
      $lastError = $_
      Write-Step "$Name request failed (attempt $attempt/3): $($_.Exception.Message)"
      Start-Sleep -Milliseconds 900
    }
  }
  throw $lastError
}

function Get-WorkspaceProjectName {
  param([string]$Path)

  $normalized = ([string]$Path).Trim().TrimEnd("\", "/")
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return ""
  }

  $parts = $normalized -split '[\\/]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($parts.Count -eq 0) {
    return $normalized
  }
  return [string]$parts[$parts.Count - 1]
}

function Get-ThreadDisplayTitle {
  param([object]$Thread)

  foreach ($propertyName in @("title", "name", "thread_name")) {
    $value = [string]$Thread.$propertyName
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }
  return ""
}

function Resolve-RequiredSidebarThread {
  param(
    [string]$BaseUrl,
    [string]$Title
  )

  if ([string]::IsNullOrWhiteSpace($Title)) {
    return $null
  }

  $search = Invoke-PostJson `
    -Name "required thread search '$Title'" `
    -Url "$($BaseUrl)/codex-api/thread-search" `
    -Payload @{ query = $Title; limit = 20 }
  $threadIds = @($search.data.threadIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  Assert-True ($threadIds.Count -gt 0) "required thread title was not found in Desktop/session search index: $Title"

  foreach ($threadId in $threadIds) {
    try {
      $read = Invoke-PostJson `
        -Name "thread/read $threadId" `
        -Url "$($BaseUrl)/codex-api/rpc" `
        -Payload @{ method = "thread/read"; params = @{ threadId = [string]$threadId; includeTurns = $false } }
      $thread = $read.result.thread
      if ($null -eq $thread) {
        continue
      }
      $threadTitle = Get-ThreadDisplayTitle -Thread $thread
      if ($threadTitle -eq $Title -or $threadTitle.Contains($Title)) {
        return [pscustomobject]@{
          id = [string]$thread.id
          title = $threadTitle
          cwd = [string]$thread.cwd
          projectName = Get-WorkspaceProjectName -Path ([string]$thread.cwd)
        }
      }
    } catch {
      Write-Step "candidate required thread $threadId was not readable: $($_.Exception.Message)"
    }
  }

  throw "required thread title was found by search but no readable matching thread was returned: $Title"
}

function Read-HomeWorkspaceProjectMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const groups = Array.from(document.querySelectorAll('.project-group')).map((node) => ({
    projectName: node.getAttribute('data-project-name') || '',
    pinnedProject: node.getAttribute('data-pinned-project') === 'true',
    text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
    threadRowCount: node.querySelectorAll('.thread-row').length,
    newThreadButtonCount: node.querySelectorAll('.thread-start-button').length
  }));
  return { groupCount: groups.length, groups };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Read-RequiredSidebarThreadMetrics {
  param(
    [string]$Session,
    [object]$Thread,
    [string]$RootSelector = ""
  )

  $payload = @{
    threadId = [string]$Thread.id
    projectName = [string]$Thread.projectName
    rootSelector = [string]$RootSelector
  } | ConvertTo-Json -Depth 5 -Compress
  $script = @"
JSON.stringify((() => {
  const target = $payload;
  const root = target.rootSelector ? document.querySelector(target.rootSelector) : document;
  if (!root) return { hasRoot: false, rowCount: 0, groupCount: 0, hasThreadId: false, hasProjectGroup: false, targetRowText: '', targetGroupText: '' };
  const rows = Array.from(root.querySelectorAll('.thread-row'));
  const groups = Array.from(root.querySelectorAll('.project-group'));
  const targetRow = rows.find((row) => row.getAttribute('data-thread-id') === target.threadId) || null;
  const targetGroup = groups.find((group) => group.getAttribute('data-project-name') === target.projectName) || null;
  return {
    hasRoot: true,
    rowCount: rows.length,
    groupCount: groups.length,
    hasThreadId: !!targetRow,
    hasProjectGroup: !!targetGroup,
    targetRowText: (targetRow?.textContent || '').replace(/\s+/g, ' ').trim(),
    targetGroupText: (targetGroup?.textContent || '').replace(/\s+/g, ' ').trim()
  };
})())
"@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-RequiredSidebarThreadDom {
  param(
    [object]$Thread,
    [object]$Metrics,
    [string]$Context
  )

  if ($null -eq $Thread) {
    return
  }

  Assert-True ($Metrics.hasRoot -eq $true) "$Context sidebar root was not found while checking required thread"
  Assert-True ($Metrics.hasProjectGroup -eq $true) "$Context sidebar is missing required thread project group: $($Thread.projectName)"
  Assert-True ($Metrics.hasThreadId -eq $true) "$Context sidebar is missing Desktop/session thread '$($Thread.title)' ($($Thread.id))"
  Assert-True ([string]$Metrics.targetRowText -like "*$($Thread.title)*") "$Context sidebar row text does not include required thread title: $($Thread.title)"
}

function Assert-WorkspaceRootProjectParity {
  param(
    [object]$RootsState,
    [object]$Metrics
  )

  $workspaceRoots = @()
  $pinnedRootSet = @{}
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds)) {
    $normalizedPinnedRootPath = [string]$rootPath
    if (-not [string]::IsNullOrWhiteSpace($normalizedPinnedRootPath)) {
      $pinnedRootSet[$normalizedPinnedRootPath] = $true
    }
  }

  foreach ($rootPath in @($RootsState.data.pinnedProjectIds) + @($RootsState.data.projectOrder) + @($RootsState.data.order)) {
    $normalizedRootPath = [string]$rootPath
    if ([string]::IsNullOrWhiteSpace($normalizedRootPath)) {
      continue
    }
    if ($workspaceRoots -notcontains $normalizedRootPath) {
      $workspaceRoots += $normalizedRootPath
    }
  }
  if ($workspaceRoots.Count -eq 0) {
    return
  }

  $labelsByRoot = @{}
  foreach ($property in @($RootsState.data.labels.PSObject.Properties)) {
    $labelsByRoot[[string]$property.Name] = [string]$property.Value
  }

  $expectedRoots = @($workspaceRoots | Select-Object -First ([Math]::Min(3, $workspaceRoots.Count)))
  Assert-True ($Metrics.groupCount -ge $expectedRoots.Count) "home sidebar project group count is below workspace root count sample"

  for ($index = 0; $index -lt $expectedRoots.Count; $index++) {
    $rootPath = [string]$expectedRoots[$index]
    $expectedProjectName = Get-WorkspaceProjectName -Path $rootPath
    $expectedLabel = if ($labelsByRoot.ContainsKey($rootPath)) { $labelsByRoot[$rootPath] } else { $expectedProjectName }
    $group = $Metrics.groups[$index]

    Assert-True ([string]$group.projectName -eq $expectedProjectName) "home sidebar project order drifted at index $index; expected $expectedProjectName from workspace root $rootPath, got $($group.projectName)"
    Assert-True ([string]$group.text -like "*$expectedLabel*") "home sidebar project label drifted for $rootPath; expected label $expectedLabel"
    if ($pinnedRootSet.ContainsKey($rootPath)) {
      Assert-True ($group.pinnedProject -eq $true) "home sidebar pinned project $expectedProjectName is missing pinned marker"
    }
    Assert-True ([int]$group.newThreadButtonCount -eq 1) "home sidebar project $expectedProjectName is missing project-level new-thread action"
    if ([int]$group.threadRowCount -eq 0) {
      Assert-True ([string]$group.text -like "*暂无会话*") "home sidebar empty workspace project $expectedProjectName is missing empty-state text"
    }
  }
}

function Wait-CodexHealthIdle {
  param([string]$Url)

  $lastHealth = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $lastHealth = Test-HttpJson -Name "codex health" -Url $Url
    $statusQueueOnly = Test-CodexHealthStatusQueueOnly -Health $lastHealth
    if (
      $lastHealth.status -eq "ok" `
      -and $lastHealth.data.appServer.pendingRpcCount -le 2 `
      -and ($lastHealth.data.appServer.queuedRpcCount -eq 0 -or $statusQueueOnly) `
      -and $lastHealth.data.appServer.pendingServerRequestCount -eq 0 `
      -and $lastHealth.data.appServer.activePlanModeTurnCount -eq 0 `
      -and $lastHealth.data.runtimeStore.uncertainRequestCount -eq 0
    ) {
      return $lastHealth
    }

    Write-Step "codex health not idle yet (attempt $attempt/8): pending=$($lastHealth.data.appServer.pendingRpcCount), queued=$($lastHealth.data.appServer.queuedRpcCount), serverRequests=$($lastHealth.data.appServer.pendingServerRequestCount), planTurns=$($lastHealth.data.appServer.activePlanModeTurnCount), uncertain=$($lastHealth.data.runtimeStore.uncertainRequestCount)"
    Start-Sleep -Milliseconds 900
  }

  return $lastHealth
}

function Test-CodexHealthStatusQueueOnly {
  param([object]$Health)

  $queued = [int]$Health.data.appServer.queuedRpcCount
  if ($queued -le 0) {
    return $true
  }
  if ($queued -gt 50) {
    return $false
  }
  if ([int]$Health.data.appServer.pendingServerRequestCount -ne 0) {
    return $false
  }
  if ([int]$Health.data.appServer.activePlanModeTurnCount -ne 0) {
    return $false
  }
  if ([int]$Health.data.runtimeStore.uncertainRequestCount -ne 0) {
    return $false
  }

  $recentSlowRpc = @($Health.data.appServer.rpcDiagnostics.recentSlowRpc)
  if ($recentSlowRpc.Count -lt 3) {
    return $false
  }

  $statusReadMethods = @("mcpServerStatus/list", "account/rateLimits/read")
  $nonStatusRecent = @($recentSlowRpc | Select-Object -First 6 | Where-Object { $statusReadMethods -notcontains $_.method })
  return $nonStatusRecent.Count -eq 0
}

function Assert-CodexHealthReadyForFrontendRegression {
  param([object]$Health)

  $statusQueueOnly = Test-CodexHealthStatusQueueOnly -Health $Health
  Assert-True ($Health.status -eq "ok") "codex health status is not ok"
  Assert-True (($Health.data.appServer.queuedRpcCount -eq 0) -or $statusQueueOnly) "queuedRpcCount is not zero and does not look like status polling backlog"
  Assert-True ($Health.data.appServer.pendingRpcCount -le 2) "pendingRpcCount is above the tolerated background status calls: $($Health.data.appServer.pendingRpcCount)"
  Assert-True ($Health.data.appServer.pendingServerRequestCount -eq 0) "pendingServerRequestCount is not zero"
  Assert-True ($Health.data.appServer.activePlanModeTurnCount -eq 0) "activePlanModeTurnCount is not zero"
  Assert-True ($Health.data.runtimeStore.uncertainRequestCount -eq 0) "uncertainRequestCount is not zero"
}

function Open-And-ReadPage {
  param(
    [string]$Session,
    [string]$Url,
    [int]$Width,
    [int]$Height
  )

  Write-Step "opening $Url at ${Width}x${Height}"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "set", "viewport", "$Width", "$Height") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", "about:blank") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", $Url) | Out-Null
  return Wait-And-ReadPage -Session $Session
}

function Wait-And-ReadPage {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim();
  const hasComposer = !!document.querySelector('textarea,[contenteditable=true],input[type=text],.thread-composer');
  const hasSkillsHub = !!document.querySelector('.skills-hub');
  const hasTrendingHub = !!document.querySelector('.trending-hub');
  const hasRuntimeBar = !!document.querySelector('.runtime-status-bar');
  const hasDiagnosticsPanel = !!document.querySelector('.diagnostics-panel');
  const hasMarkdownBody = !!document.querySelector('.markdown-body');
  return {
    url: location.href,
    text: text.includes('Runtime Store') ? 'Runtime Store' : '',
    textLength: text.length,
    hasInternalCodexContext: /<codex_internal_context\s+source=/i.test(text),
    hasInternalThreadReadError: /thread-store internal error|failed to read thread\s+[A-Za-z]:\\/i.test(text),
    hasBlankBody: text.length < 5 && !hasComposer && !hasSkillsHub && !hasTrendingHub && !hasRuntimeBar && !hasDiagnosticsPanel && !hasMarkdownBody,
    hasComposer,
    hasSkillsHub,
    hasTrendingHub,
    hasRuntimeBar,
    hasDiagnosticsPanel,
    hasMarkdownBody,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})())
'@
  $page = $null
  for ($attempt = 1; $attempt -le 7; $attempt++) {
    Start-Sleep -Milliseconds 700
    $page = Invoke-BrowserEvalJson -Session $Session -Script $script
    if ($page.hasBlankBody -ne $true) {
      return $page
    }
    Write-Step "page body still blank after navigation (attempt $attempt/7)"
  }
  return $page
}

function Assert-Page {
  param(
    [object]$Page,
    [string]$Name,
    [string[]]$RequiredText = @(),
    [switch]$RequireComposer,
    [switch]$RequireSkillsHub,
    [switch]$RequireTrendingHub,
    [switch]$RequireRuntimeBar,
    [switch]$RequireDiagnostics,
    [switch]$RequireMarkdown
  )

  Assert-True (-not $Page.hasBlankBody) "$Name rendered a blank body"
  Assert-True (-not $Page.hasHorizontalOverflow) "$Name has horizontal overflow: $($Page.scrollWidth) > $($Page.clientWidth)"
  Assert-True (-not $Page.hasInternalCodexContext) "$Name exposed internal codex context"
  Assert-True (-not $Page.hasInternalThreadReadError) "$Name exposed an internal thread-store read error"
  if ($RequireComposer) {
    Assert-True ($Page.hasComposer -eq $true) "$Name is missing composer controls"
  }
  if ($RequireSkillsHub) {
    Assert-True ($Page.hasSkillsHub -eq $true) "$Name is missing skills hub"
  }
  if ($RequireTrendingHub) {
    Assert-True ($Page.hasTrendingHub -eq $true) "$Name is missing GitHub trending hub"
  }
  if ($RequireRuntimeBar) {
    Assert-True ($Page.hasRuntimeBar -eq $true) "$Name is missing runtime status bar"
  }
  if ($RequireDiagnostics) {
    Assert-True ($Page.hasDiagnosticsPanel -eq $true) "$Name is missing diagnostics panel"
  }
  if ($RequireMarkdown) {
    Assert-True ($Page.hasMarkdownBody -eq $true) "$Name is missing markdown preview"
  }
  foreach ($text in $RequiredText) {
    Assert-True ([string]$Page.text -like "*$text*") "$Name is missing required text: $text"
  }
}

function Read-SettingsPanelMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  const brandCard = document.querySelector('.sidebar-settings-brand-card');
  const closeButton = document.querySelector('.sidebar-settings-panel-close');
  const inputs = Array.from(document.querySelectorAll('.sidebar-settings-input, .sidebar-settings-code, .sidebar-settings-copy-button, .sidebar-settings-language-dropdown .composer-dropdown-trigger'));
  const panelRect = panel?.getBoundingClientRect();
  const panelStyle = panel ? window.getComputedStyle(panel) : null;
  const brandStyle = brandCard ? window.getComputedStyle(brandCard) : null;
  const warmColors = new Set([
    'rgb(255, 253, 248)',
    'rgb(255, 250, 243)',
    'rgb(247, 243, 234)',
    'rgb(241, 235, 222)',
    'rgb(251, 248, 242)'
  ]);
  const sampledStyles = [panel, brandCard, ...inputs].filter(Boolean).map((node) => {
    const style = window.getComputedStyle(node);
    return {
      className: node.className || node.tagName,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidth: Number.parseFloat(style.borderTopWidth || '0'),
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const viewportWidth = document.documentElement.clientWidth;
  const fitFailure = panelRect ? (panelRect.left < -2 || panelRect.right > viewportWidth + 2) : true;
  return {
    hasPanel: !!panel,
    hasBrandCard: !!brandCard,
    hasCloseButton: !!closeButton,
    panelBackground: panelStyle?.backgroundColor || '',
    panelRadius: panelStyle ? Number.parseFloat(panelStyle.borderTopLeftRadius || '0') : 0,
    panelBorderWidth: panelStyle ? Number.parseFloat(panelStyle.borderTopWidth || '0') : 0,
    brandRadius: brandStyle ? Number.parseFloat(brandStyle.borderTopLeftRadius || '0') : 0,
    sampledWarmBackgroundCount: sampledStyles.filter((item) => warmColors.has(item.backgroundColor)).length,
    maxSampleRadius: sampledStyles.length ? Math.max(...sampledStyles.map((item) => item.radius)) : 0,
    fitFailure,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-SettingsPanel {
  param([object]$Metrics)

  Assert-True ($Metrics.hasPanel -eq $true) "settings panel did not open"
  Assert-True ($Metrics.hasBrandCard -eq $true) "settings panel is missing about/brand block"
  Assert-True ($Metrics.hasCloseButton -eq $true) "settings panel is missing compact close button"
  Assert-True ($Metrics.panelRadius -le 22) "settings panel radius is too large: $($Metrics.panelRadius)"
  Assert-True ($Metrics.panelBorderWidth -le 1) "settings panel border is too heavy: $($Metrics.panelBorderWidth)"
  Assert-True ($Metrics.brandRadius -le 8) "settings brand block radius is too large: $($Metrics.brandRadius)"
  Assert-True ($Metrics.sampledWarmBackgroundCount -eq 0) "settings panel still uses warm beige sampled backgrounds"
  Assert-True ($Metrics.maxSampleRadius -le 22) "settings sampled controls exceed radius ceiling: $($Metrics.maxSampleRadius)"
  Assert-True ($Metrics.fitFailure -eq $false) "settings panel overflows viewport horizontally"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "settings panel page has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Read-FoldableShellMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const layout = document.querySelector('.desktop-layout');
  const sidebar = document.querySelector('.desktop-sidebar');
  const main = document.querySelector('.desktop-main');
  const contentRoot = document.querySelector('.content-root');
  const contentGrid = document.querySelector('.content-grid');
  const composer = document.querySelector('.thread-composer-shell');
  const settingsPanel = document.querySelector('.sidebar-settings-panel');
  const actionGrid = document.querySelector('.sidebar-action-grid');
  const actionTiles = Array.from(document.querySelectorAll('.sidebar-action-tile'));
  const actionIcons = Array.from(document.querySelectorAll('.sidebar-action-icon'));
  const actionGridStyle = actionGrid ? window.getComputedStyle(actionGrid) : null;
  const actionTileStyles = actionTiles.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      radius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      height: node.getBoundingClientRect().height
    };
  });
  const actionGridRows = new Set(actionTiles.map((node) => Math.round(node.getBoundingClientRect().top))).size;
  const actionGridRect = actionGrid?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const layoutRect = layout?.getBoundingClientRect();
  const sidebarRect = sidebar?.getBoundingClientRect();
  const mainRect = main?.getBoundingClientRect();
  const contentGridRect = contentGrid?.getBoundingClientRect();
  const composerRect = composer?.getBoundingClientRect();
  const fitTargets = [layout, sidebar, main, contentRoot, contentGrid, composer].filter(Boolean);
  const fitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  return {
    hasLayout: !!layout,
    hasSidebar: !!sidebar,
    hasMain: !!main,
    hasContentGrid: !!contentGrid,
    hasComposer: !!composer,
    hasSettingsPanel: !!settingsPanel,
    hasActionGrid: !!actionGrid,
    actionGridDisplay: actionGridStyle?.display || '',
    actionGridTemplateColumns: actionGridStyle?.gridTemplateColumns || '',
    actionGridHeight: actionGridRect ? Math.round(actionGridRect.height) : 0,
    actionGridRowCount: actionGridRows,
    actionTileCount: actionTiles.length,
    actionIconCount: actionIcons.length,
    actionTileMaxRadius: actionTileStyles.length ? Math.max(...actionTileStyles.map((item) => item.radius)) : 0,
    actionTileMinHeight: actionTileStyles.length ? Math.min(...actionTileStyles.map((item) => item.height)) : 0,
    layoutWidth: layoutRect ? Math.round(layoutRect.width) : 0,
    sidebarWidth: sidebarRect ? Math.round(sidebarRect.width) : 0,
    mainWidth: mainRect ? Math.round(mainRect.width) : 0,
    contentGridWidth: contentGridRect ? Math.round(contentGridRect.width) : 0,
    composerWidth: composerRect ? Math.round(composerRect.width) : 0,
    sidebarRatio: sidebarRect && layoutRect && layoutRect.width > 0 ? sidebarRect.width / layoutRect.width : 0,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-FoldableShell {
  param([object]$Metrics)

  Assert-True ($Metrics.hasLayout -eq $true) "foldable shell is missing desktop layout"
  Assert-True ($Metrics.hasSidebar -eq $true) "foldable shell is missing sidebar"
  Assert-True ($Metrics.hasMain -eq $true) "foldable shell is missing main content"
  Assert-True ($Metrics.hasContentGrid -eq $true) "foldable shell is missing content grid"
  Assert-True ($Metrics.hasComposer -eq $true) "foldable shell is missing composer"
  Assert-True ($Metrics.hasSettingsPanel -eq $false) "foldable shell screenshot is polluted by an open settings panel"
  Assert-True ($Metrics.hasActionGrid -eq $true) "foldable shell is missing compact sidebar action grid"
  Assert-True ($Metrics.actionGridDisplay -eq "grid") "foldable sidebar action grid is not grid: $($Metrics.actionGridDisplay)"
  Assert-True (-not [string]::IsNullOrWhiteSpace($Metrics.actionGridTemplateColumns)) "foldable sidebar action grid is missing columns"
  Assert-True ($Metrics.actionGridRowCount -le 2) "foldable sidebar action grid uses too many rows: $($Metrics.actionGridRowCount)"
  Assert-True ($Metrics.actionGridHeight -le 96) "foldable sidebar action grid is too tall: $($Metrics.actionGridHeight)"
  Assert-True ($Metrics.actionTileCount -eq 4) "foldable sidebar action grid should keep four primary entries: $($Metrics.actionTileCount)"
  Assert-True ($Metrics.actionIconCount -ge $Metrics.actionTileCount) "foldable sidebar action grid is missing icons"
  Assert-True ($Metrics.actionTileMaxRadius -le 10) "foldable sidebar action tiles are too rounded: $($Metrics.actionTileMaxRadius)"
  Assert-True ($Metrics.actionTileMinHeight -ge 42) "foldable sidebar action tiles are too small for touch: $($Metrics.actionTileMinHeight)"
  Assert-True ($Metrics.sidebarWidth -ge 260) "foldable sidebar is too narrow: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarWidth -le 370) "foldable sidebar is too wide: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarRatio -le 0.42) "foldable sidebar takes too much width: $($Metrics.sidebarRatio)"
  Assert-True ($Metrics.mainWidth -ge 500) "foldable main content is too narrow: $($Metrics.mainWidth)"
  Assert-True ($Metrics.contentGridWidth -ge 430) "foldable content grid is too narrow: $($Metrics.contentGridWidth)"
  Assert-True ($Metrics.composerWidth -ge 430) "foldable composer is too narrow: $($Metrics.composerWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "foldable shell elements overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "foldable shell has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Read-MobileDrawerSidebarMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const actionGrid = drawer?.querySelector('.sidebar-action-grid') || null;
  const rows = Array.from(drawer?.querySelectorAll('.thread-row') || []);
  const groups = Array.from(drawer?.querySelectorAll('.project-group') || []);
  const actionTiles = Array.from(drawer?.querySelectorAll(
    '.sidebar-action-grid > .sidebar-action-tile, .sidebar-action-grid > .sidebar-tools-menu > .sidebar-action-tile'
  ) || []);
  const loading = drawer?.querySelector('.thread-tree-loading') || null;
  const emptyText = drawer?.querySelector('.thread-tree-empty-text') || null;
  const drawerRect = drawer?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fitFailures = [drawer, actionGrid].filter(Boolean)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  return {
    hasDrawer: !!drawer,
    hasActionGrid: !!actionGrid,
    rowCount: rows.length,
    groupCount: groups.length,
    isLoading: !!loading,
    hasEmptyText: !!emptyText,
    actionTileCount: actionTiles.filter((node) => window.getComputedStyle(node).display !== 'none').length,
    hasVisibleWorkbenchTile: actionTiles.some((node) => (
      window.getComputedStyle(node).display !== 'none' && (node.textContent || '').includes('工作台')
    )),
    drawerWidth: drawerRect ? Math.round(drawerRect.width) : 0,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-MobileDrawerSidebar {
  param([object]$Metrics)

  Assert-True ($Metrics.hasDrawer -eq $true) "mobile home did not open sidebar drawer"
  Assert-True ($Metrics.hasActionGrid -eq $true) "mobile drawer is missing compact action grid"
  Assert-True ($Metrics.isLoading -eq $false) "mobile drawer sidebar is still showing loading skeletons"
  Assert-True ([int]$Metrics.rowCount -gt 0) "mobile drawer sidebar did not render thread rows"
  Assert-True ([int]$Metrics.groupCount -gt 0) "mobile drawer sidebar did not render project groups"
  Assert-True ($Metrics.hasEmptyText -eq $false) "mobile drawer sidebar rendered empty/error text despite available threads"
  Assert-True ([int]$Metrics.actionTileCount -eq 3) "mobile drawer should keep three primary actions: $($Metrics.actionTileCount)"
  Assert-True ($Metrics.hasVisibleWorkbenchTile -eq $false) "mobile drawer should move Workbench into the Tools menu"
  Assert-True ($Metrics.drawerWidth -le $Metrics.clientWidth) "mobile drawer is wider than viewport: $($Metrics.drawerWidth) > $($Metrics.clientWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "mobile drawer elements overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "mobile drawer has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Open-MobileDrawerSidebar {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (document.querySelector('.mobile-drawer')) return { alreadyOpen: true, clicked: false };
  const buttons = Array.from(document.querySelectorAll('.sidebar-thread-controls-header-host .sidebar-thread-controls-button'));
  const visibleButtons = buttons.filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  const button = visibleButtons.find((node) => node.getAttribute('aria-label') === 'Expand sidebar')
    || visibleButtons.find((node) => (node.getAttribute('title') || '').toLowerCase().includes('sidebar'))
    || visibleButtons[0]
    || null;
  if (button instanceof HTMLElement) {
    button.click();
    return { alreadyOpen: false, clicked: true, label: button.getAttribute('aria-label') || '' };
  }
  return { alreadyOpen: false, clicked: false, label: '' };
})())
'@

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null
    $metrics = Read-MobileDrawerSidebarMetrics -Session $Session
    if ($metrics.hasDrawer -eq $true) {
      return $metrics
    }
  }

  return Read-MobileDrawerSidebarMetrics -Session $Session
}

function Read-ConversationFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const codeBlocks = Array.from(document.querySelectorAll('.message-code-block'));
  const copyButtons = Array.from(document.querySelectorAll('.message-code-copy'));
  const fileCards = Array.from(document.querySelectorAll('.message-file-card'));
  const rawCards = Array.from(document.querySelectorAll('.message-structured-card'));
  const commandRows = Array.from(document.querySelectorAll('.cmd-row'));
  const commandOutputWraps = Array.from(document.querySelectorAll('.cmd-output-wrap'));
  const requestCards = Array.from(document.querySelectorAll('.request-card'));
  const permissionPanels = Array.from(document.querySelectorAll('.request-permission-panel'));
  const toolPanels = Array.from(document.querySelectorAll('.request-tool-panel'));
  const requestButtons = Array.from(document.querySelectorAll('.request-button'));
  const tableScrolls = Array.from(document.querySelectorAll('.message-table-scroll'));
  const tableCardGroups = Array.from(document.querySelectorAll('.message-table-cards'));
  const tableCards = Array.from(document.querySelectorAll('.message-table-card'));
  const runtimeStatusBars = Array.from(document.querySelectorAll('.conversation-regression-fixture .runtime-status-bar'));
  const runtimeStatusHeights = runtimeStatusBars.map((node) => Math.round(node.getBoundingClientRect().height));
  const queuedPanels = Array.from(document.querySelectorAll('.conversation-regression-fixture .queued-messages-inner'));
  const queuedRows = Array.from(document.querySelectorAll('.conversation-regression-fixture .queued-row'));
  const chromeTargets = Array.from(document.querySelectorAll([
    '.conversation-regression-fixture .runtime-status-bar',
    '.conversation-regression-fixture .queued-messages-inner',
    '.conversation-regression-fixture .queued-row',
    '.conversation-regression-fixture .live-overlay-inline',
    '.conversation-regression-fixture .message-card',
    '.conversation-regression-fixture .message-table-scroll',
    '.conversation-regression-fixture .message-table-card',
    '.conversation-regression-fixture .message-structured-card',
    '.conversation-regression-fixture .message-structured-pre',
    '.conversation-regression-fixture .message-text-flow--long-collapsed',
    '.conversation-regression-fixture .guided-turn-toggle'
  ].join(',')));
  const warmBackgrounds = new Set([
    'rgb(255, 253, 248)',
    'rgb(255, 252, 247)',
    'rgb(255, 250, 243)',
    'rgb(255, 250, 242)',
    'rgb(255, 249, 238)',
    'rgb(255, 248, 223)',
    'rgb(247, 243, 234)',
    'rgb(247, 241, 229)',
    'rgb(248, 244, 236)',
    'rgb(241, 235, 222)'
  ]);
  const firstCopyButton = copyButtons[0];
  const firstCommandRow = commandRows[0];
  const firstRequestCard = requestCards[0];
  const firstPermissionPanel = permissionPanels[0];
  const firstToolPanel = toolPanels[0];
  const commandRowRadius = firstCommandRow ? Number.parseFloat(window.getComputedStyle(firstCommandRow).borderTopLeftRadius || '0') : 0;
  const requestCardRadius = firstRequestCard ? Number.parseFloat(window.getComputedStyle(firstRequestCard).borderTopLeftRadius || '0') : 0;
  const permissionPanelRadius = firstPermissionPanel ? Number.parseFloat(window.getComputedStyle(firstPermissionPanel).borderTopLeftRadius || '0') : 0;
  const toolPanelRadius = firstToolPanel ? Number.parseFloat(window.getComputedStyle(firstToolPanel).borderTopLeftRadius || '0') : 0;
  const chromeStyles = chromeTargets.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      className: node.className || node.tagName,
      backgroundColor: style.backgroundColor,
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const chromeWarmBackgrounds = chromeStyles.filter((style) => warmBackgrounds.has(style.backgroundColor));
  const chromeMaxRadius = chromeStyles.length ? Math.max(...chromeStyles.map((style) => style.radius)) : 0;
  const fitTargets = Array.from(document.querySelectorAll([
    '.request-card',
    '.request-permission-panel',
    '.request-tool-panel',
    '.message-file-card',
    '.message-code-block',
    '.message-structured-card',
    '.runtime-status-bar',
    '.queued-messages-inner',
    '.queued-row',
    '.message-table-scroll',
    '.message-table-card',
    '.live-overlay-inline',
    '.cmd-row',
    '.cmd-output-wrap'
  ].join(',')));
  const viewportWidth = document.documentElement.clientWidth;
  const viewportFitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const textContent = document.body.textContent || '';
  return {
    codeBlockCount: codeBlocks.length,
    diffBlockCount: codeBlocks.filter((node) => node.getAttribute('data-diff') === 'true').length,
    copyButtonCount: copyButtons.length,
    fileCardCount: fileCards.length,
    rawPayloadCardCount: rawCards.length,
    commandRowCount: commandRows.length,
    commandOutputWrapCount: commandOutputWraps.length,
    expandedCommandOutputCount: commandOutputWraps.filter((node) => node.classList.contains('cmd-output-visible')).length,
    commandRowRadius,
    requestCardCount: requestCards.length,
    permissionPanelCount: permissionPanels.length,
    toolPanelCount: toolPanels.length,
    requestButtonCount: requestButtons.length,
    tableScrollCount: tableScrolls.length,
    tableCardGroupCount: tableCardGroups.length,
    tableCardCount: tableCards.length,
    runtimeStatusBarCount: runtimeStatusBars.length,
    runtimeStatusMaxHeight: runtimeStatusHeights.length ? Math.max(...runtimeStatusHeights) : 0,
    viewportWidth,
    queuedPanelCount: queuedPanels.length,
    queuedRowCount: queuedRows.length,
    conversationChromeWarmBackgroundCount: chromeWarmBackgrounds.length,
    conversationChromeWarmBackgrounds: chromeWarmBackgrounds.slice(0, 5),
    conversationChromeMaxRadius: chromeMaxRadius,
    requestCardRadius,
    permissionPanelRadius,
    toolPanelRadius,
    hasAddLine: !!document.querySelector('.message-code-line[data-kind="add"]'),
    hasDeleteLine: !!document.querySelector('.message-code-line[data-kind="delete"]'),
    hasMetaLine: !!document.querySelector('.message-code-line[data-kind="meta"]'),
    hasLatestTurnPromptContext: textContent.includes('请审查这些文件，并说明代码块'),
    hasFixtureCodeText: textContent.includes('fixture-code-block'),
    hasFixtureRawText: textContent.includes('fixture-raw-payload'),
    hasOptimisticInternalText: textContent.includes('userMessage.optimistic') || textContent.includes('optimisticUserMessage'),
    sendingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="sending"]').length,
    failedDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="failed"]').length,
    retryingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="retrying"]').length,
    confirmingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="confirming"]').length,
    sentDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="sent"]').length,
    failedDeliveryRetryCount: document.querySelectorAll('.message-delivery-retry').length,
    hasBoundedReconnectText: textContent.includes('正在重连 1/2'),
    hasConfirmingDeliveryText: textContent.includes('确认中'),
    hasStableLiveElapsedTime: /已(?:等待|运行)\s+(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent) || /正在(?:运行|处理)(?:\s*·)?\s*(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent),
    interruptedTurnCardCount: document.querySelectorAll('.interrupted-turn-card').length,
    interruptedTurnEditCount: document.querySelectorAll('.interrupted-turn-edit').length,
    hasHiddenUnhandledNoise: textContent.includes('fixture-hidden-file-change-noise') || textContent.includes('Unhandled App Server item: fileChange') || textContent.includes('unhandled.fileChange') || textContent.includes('fixture-hidden-web-search-noise') || textContent.includes('Unhandled App Server item: webSearch') || textContent.includes('unhandled.webSearch') || textContent.includes('未适配的 App Server 内容'),
    hasFixtureCommandText: textContent.includes('fixture-command-output: ok'),
    hasFixtureCommandLabel: textContent.includes('npm.cmd run test:7420:frontend'),
    hasFixturePermissionText: textContent.includes('fixture-permission-workbench'),
    hasFixtureToolCallText: textContent.includes('fixture-tool-call-workbench') || textContent.includes('Browser tool call cannot be executed directly'),
    hasPermissionServerText: textContent.includes('GitHub'),
    hasPermissionToolText: textContent.includes('github_update_pull_request'),
    hasPermissionTargetText: textContent.includes('Qjzn/CX-Codex') && textContent.includes('关闭'),
    hasToolCallActionText: textContent.includes('让 Codex 改用文字继续'),
    hasPermissionActionText: textContent.includes('仅本次允许') && textContent.includes('本会话允许') && textContent.includes('始终允许此工具') && textContent.includes('拒绝'),
    loadMoreButtonText: document.querySelector('.conversation-load-more-button')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    loadMoreButtonDisabled: document.querySelector('.conversation-load-more-button')?.disabled === true,
    olderHistoryRequestCount: Number(document.querySelector('.conversation-regression-older-history-count')?.getAttribute('data-count') || '0'),
    firstCopyButtonText: firstCopyButton ? firstCopyButton.textContent.trim() : '',
    hasEmojiFileIcon: document.body.innerText.includes('📄'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    structuredViewportFitFailureCount: viewportFitFailures.length,
    structuredViewportFitFailures: viewportFitFailures.slice(0, 5),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ConversationTailStatusFixture {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const overlay = document.querySelector('.live-overlay-inline');
  const compact = document.querySelector('.live-overlay-inline-compact');
  const streamingMessage = document.querySelector('[data-message-id="fixture-streaming-assistant-tail"]');
  const textContent = document.body.textContent || '';
  const overlayRect = overlay?.getBoundingClientRect();
  const streamingRect = streamingMessage?.getBoundingClientRect();
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline').length,
    compactCount: document.querySelectorAll('.live-overlay-inline-compact').length,
    detailedSheetCount: document.querySelectorAll('.live-overlay-detail-sheet').length,
    visibleRunningCommandRowCount: Array.from(document.querySelectorAll('.conversation-item[data-message-type="commandExecution"] .cmd-row')).filter((node) => node.textContent?.includes('npm.cmd run verify:frontend-normalizers')).length,
    statusFollowsStreamingReply: Boolean(overlayRect && streamingRect && overlayRect.top >= streamingRect.bottom - 1),
    statusFollowsStreamingReplyInDom: Boolean(
      overlay && streamingMessage && (streamingMessage.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING)
    ),
    hasUnifiedStatusLabel: textContent.includes('正在处理 ·'),
    hasLatestExecutionHint: textContent.includes('正在执行最新操作'),
    hasStreamingReply: textContent.includes('回复仍在继续生成，不应让运行状态消失'),
    hasStableElapsedTime: /正在处理\s*·\s*(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent)
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ([int]$before.overlayCount -eq 1) "conversation tail status must render exactly one active surface"
  Assert-True ([int]$before.compactCount -eq 1) "conversation tail status is not collapsed by default"
  Assert-True ([int]$before.detailedSheetCount -eq 0) "conversation tail status opened details without user action"
  Assert-True ([int]$before.visibleRunningCommandRowCount -eq 0) "conversation tail status duplicated the current command in message history"
  Assert-True ($before.statusFollowsStreamingReply -eq $true) "conversation tail status is not visually placed after the streaming reply"
  Assert-True ($before.statusFollowsStreamingReplyInDom -eq $true) "conversation tail status is not placed after the streaming reply in DOM reading order"
  Assert-True ($before.hasUnifiedStatusLabel -eq $true) "conversation tail status is missing the unified processing label"
  Assert-True ($before.hasLatestExecutionHint -eq $true) "conversation tail status is missing the latest execution hint"
  Assert-True ($before.hasStreamingReply -eq $true) "conversation tail status fixture is missing streaming reply content"
  Assert-True ($before.hasStableElapsedTime -eq $true) "conversation tail status disappeared or reset elapsed time after a transient overlay gap"

  $openScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.live-overlay-compact-main');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $openResult = Invoke-BrowserEvalJson -Session $Session -Script $openScript
  Assert-True ($openResult.clicked -eq $true) "conversation tail status could not be opened"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null

  $afterScript = @'
JSON.stringify((() => {
  const sheet = document.querySelector('.live-overlay-detail-sheet');
  const textContent = sheet?.textContent || '';
  return {
    sheetCount: document.querySelectorAll('.live-overlay-detail-sheet').length,
    hasCurrentCommand: textContent.includes('npm.cmd run verify:frontend-normalizers'),
    hasCurrentOutput: textContent.includes('fixture-current-command: running'),
    hasHistoricalCommand: textContent.includes('npm.cmd run test:7420:frontend')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.sheetCount -eq 1) "conversation tail status did not open one detail sheet"
  Assert-True ($after.hasCurrentCommand -eq $true) "conversation tail detail is missing the current command"
  Assert-True ($after.hasCurrentOutput -eq $true) "conversation tail detail is missing current command output"
  Assert-True ($after.hasHistoricalCommand -eq $false) "conversation tail detail mixed historical execution into the current status"
}

function Assert-ConversationFixture {
  param(
    [object]$Metrics,
    [string]$ViewportName = ""
  )

  Assert-True ($Metrics.codeBlockCount -ge 2) "conversation fixture is missing code/diff blocks"
  Assert-True ($Metrics.diffBlockCount -ge 1) "conversation fixture is missing diff block"
  Assert-True ($Metrics.copyButtonCount -ge 2) "conversation fixture is missing code copy buttons"
  Assert-True ($Metrics.rawPayloadCardCount -ge 1) "conversation fixture is missing raw payload card"
  Assert-True ($Metrics.commandRowCount -ge 1) "conversation fixture is missing command row"
  Assert-True ($Metrics.commandOutputWrapCount -ge 1) "conversation fixture is missing command output wrapper"
  Assert-True ($Metrics.expandedCommandOutputCount -ge 1) "conversation fixture command output did not expand"
  Assert-True ($Metrics.commandRowRadius -le 10) "conversation fixture command row radius is too large: $($Metrics.commandRowRadius)"
  Assert-True ($Metrics.requestCardCount -ge 1) "conversation fixture is missing pending request card"
  Assert-True ($Metrics.permissionPanelCount -ge 1) "conversation fixture is missing MCP permission panel"
  Assert-True ($Metrics.toolPanelCount -ge 1) "conversation fixture is missing tool call panel"
  Assert-True ($Metrics.requestButtonCount -ge 3) "conversation fixture is missing permission action buttons"
  if ([int]$Metrics.viewportWidth -lt 768) {
    Assert-True ([int]$Metrics.tableScrollCount -eq 0) "conversation fixture phone viewport mounted desktop table DOM: $($Metrics.tableScrollCount)"
    Assert-True ([int]$Metrics.tableCardGroupCount -ge 1) "conversation fixture phone viewport is missing mobile table card group"
    Assert-True ([int]$Metrics.tableCardCount -ge 1) "conversation fixture phone viewport is missing mobile table cards"
  } else {
    Assert-True ([int]$Metrics.tableScrollCount -ge 1) "conversation fixture $ViewportName viewport is missing desktop table DOM"
    Assert-True ([int]$Metrics.tableCardGroupCount -eq 0) "conversation fixture $ViewportName viewport mounted mobile table DOM: $($Metrics.tableCardGroupCount)"
  }
  Assert-True ($Metrics.runtimeStatusBarCount -ge 1) "conversation fixture is missing runtime status bar"
  $runtimeStatusMaxHeight = if ([int]$Metrics.viewportWidth -lt 768) { 48 } else { 40 }
  Assert-True ($Metrics.runtimeStatusMaxHeight -le $runtimeStatusMaxHeight) "conversation fixture runtime status bar is too tall: $($Metrics.runtimeStatusMaxHeight)"
  Assert-True ($Metrics.queuedPanelCount -ge 1) "conversation fixture is missing queued message panel"
  Assert-True ($Metrics.queuedRowCount -ge 2) "conversation fixture is missing queued message rows"
  Assert-True ($Metrics.conversationChromeWarmBackgroundCount -eq 0) "conversation fixture still has warm chrome backgrounds: $($Metrics.conversationChromeWarmBackgrounds | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.conversationChromeMaxRadius -le 18) "conversation fixture chrome radius is too large: $($Metrics.conversationChromeMaxRadius)"
  Assert-True ($Metrics.requestCardRadius -le 10) "conversation fixture request card radius is too large: $($Metrics.requestCardRadius)"
  Assert-True ($Metrics.permissionPanelRadius -le 10) "conversation fixture permission panel radius is too large: $($Metrics.permissionPanelRadius)"
  Assert-True ($Metrics.toolPanelRadius -le 10) "conversation fixture tool call panel radius is too large: $($Metrics.toolPanelRadius)"
  Assert-True ($Metrics.hasAddLine -eq $true) "conversation fixture is missing diff add line styling"
  Assert-True ($Metrics.hasDeleteLine -eq $true) "conversation fixture is missing diff delete line styling"
  Assert-True ($Metrics.hasMetaLine -eq $true) "conversation fixture is missing diff metadata line styling"
  Assert-True ($Metrics.hasFixtureCodeText -eq $true) "conversation fixture is missing fixture code text"
  Assert-True ($Metrics.hasFixtureRawText -eq $true) "conversation fixture is missing raw payload marker"
  Assert-True ($Metrics.hasOptimisticInternalText -eq $false) "conversation fixture exposed optimistic-message internal metadata"
  Assert-True ([int]$Metrics.sendingDeliveryStateCount -eq 1) "conversation fixture is missing the sending delivery state"
  Assert-True ([int]$Metrics.failedDeliveryStateCount -eq 1) "conversation fixture is missing the failed delivery state"
  Assert-True ([int]$Metrics.retryingDeliveryStateCount -eq 1) "conversation fixture is missing the reconnecting delivery state"
  Assert-True ([int]$Metrics.confirmingDeliveryStateCount -eq 1) "conversation fixture is missing the confirming delivery state"
  Assert-True ([int]$Metrics.sentDeliveryStateCount -eq 1) "conversation fixture is missing the sent delivery state"
  Assert-True ([int]$Metrics.failedDeliveryRetryCount -eq 1) "conversation fixture is missing the failed-message retry action"
  Assert-True ($Metrics.hasBoundedReconnectText -eq $true) "conversation fixture is missing bounded reconnect progress"
  Assert-True ($Metrics.hasConfirmingDeliveryText -eq $true) "conversation fixture is missing unconfirmed-send feedback"
  Assert-True ($Metrics.hasStableLiveElapsedTime -eq $true) "conversation fixture reset or ignored the authoritative live-overlay start time"
  Assert-True ([int]$Metrics.interruptedTurnCardCount -eq 1) "conversation fixture is missing stopped-turn feedback"
  Assert-True ([int]$Metrics.interruptedTurnEditCount -eq 1) "conversation fixture is missing stopped-turn edit action"
  Assert-True ($Metrics.hasHiddenUnhandledNoise -eq $false) "conversation fixture rendered unhandled App Server system noise"
  Assert-True ($Metrics.hasFixtureCommandText -eq $true) "conversation fixture is missing command output marker"
  Assert-True ($Metrics.hasFixtureCommandLabel -eq $true) "conversation fixture is missing command label"
  Assert-True ($Metrics.hasFixturePermissionText -eq $true) "conversation fixture is missing permission workbench marker"
  Assert-True ($Metrics.hasFixtureToolCallText -eq $true) "conversation fixture is missing tool call workbench marker"
  Assert-True ($Metrics.hasPermissionServerText -eq $true) "conversation fixture is missing MCP server label"
  Assert-True ($Metrics.hasPermissionToolText -eq $true) "conversation fixture is missing MCP tool label"
  Assert-True ($Metrics.hasPermissionTargetText -eq $true) "conversation fixture is missing MCP permission target details"
  Assert-True ($Metrics.hasToolCallActionText -eq $true) "conversation fixture is missing tool call action label"
  Assert-True ($Metrics.hasPermissionActionText -eq $true) "conversation fixture is missing permission action labels"
  Assert-True ([string]$Metrics.loadMoreButtonText -like "*继续查看*") "conversation fixture local older-history affordance is missing unified load-more button"
  Assert-True ([string]$Metrics.firstCopyButtonText -like "*复制*") "conversation fixture first code block copy button is not visible"
  Assert-True ($Metrics.hasEmojiFileIcon -eq $false) "conversation fixture still renders emoji file icons"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "conversation fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
  Assert-True ($Metrics.structuredViewportFitFailureCount -eq 0) "conversation fixture structured blocks overflow viewport: $($Metrics.structuredViewportFitFailures | ConvertTo-Json -Compress)"
}

function Assert-ConversationOlderHistoryAffordance {
  param([string]$Session)

  $before = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ([int]$before.olderHistoryRequestCount -eq 0) "conversation fixture older-history request count should start at 0"
  $localClickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: 0 };
  button.click();
  return { clicked: 1 };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $localClickScript | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  $afterLocal = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ($afterLocal.fileCardCount -ge 2) "conversation fixture did not restore file cards after loading local older history"
  Assert-True ($afterLocal.hasLatestTurnPromptContext -eq $true) "conversation fixture did not restore the earlier user prompt context"
  Assert-True ([int]$afterLocal.olderHistoryRequestCount -eq 0) "conversation fixture requested remote older history while local messages were still available"

  $remoteClickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: 0 };
  button.click();
  button.click();
  return { clicked: 2 };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $remoteClickScript | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  $after = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ([int]$after.olderHistoryRequestCount -eq 1) "conversation fixture load-more button emitted duplicate remote older-history requests"
  Assert-True ($after.loadMoreButtonDisabled -eq $true) "conversation fixture load-more button did not stay disabled while remote older-history request was in flight"
}

function Expand-ConversationFixturePendingRequests {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (!document.querySelector('.request-card')) {
    document.querySelector('.conversation-process-toggle')?.click();
  }
  return { expanded: Boolean(document.querySelector('.request-card')) };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
}

function Expand-ConversationFixtureCommandOutput {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (!document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-output-wrap.cmd-output-visible')) {
    document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-row')?.click();
  }
  return { expanded: Boolean(document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-output-wrap.cmd-output-visible')) };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
}

function Assert-ConversationCommandOutputLazy {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const commandOutputs = Array.from(document.querySelectorAll('.conversation-regression-fixture .cmd-output-wrap .cmd-output'));
  const textContent = document.body.textContent || '';
  return {
    commandOutputCount: commandOutputs.length,
    hasFixtureCommandOutputText: textContent.includes('fixture-command-output: ok')
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ([int]$before.commandOutputCount -eq 0) "conversation fixture command output should be lazy before expand"
  Assert-True ($before.hasFixtureCommandOutputText -eq $false) "conversation fixture command output marker rendered before expand"

  Expand-ConversationFixtureCommandOutput -Session $Session

  $afterScript = @'
JSON.stringify((() => {
  const commandOutputs = Array.from(document.querySelectorAll('.conversation-regression-fixture .cmd-output-wrap .cmd-output'));
  const textContent = document.body.textContent || '';
  return {
    commandOutputCount: commandOutputs.length,
    hasFixtureCommandOutputText: textContent.includes('fixture-command-output: ok')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.commandOutputCount -ge 1) "conversation fixture command output did not render after expand"
  Assert-True ($after.hasFixtureCommandOutputText -eq $true) "conversation fixture command output marker missing after expand"
}

function Assert-ConversationRawPayloadLazy {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const rawCards = Array.from(document.querySelectorAll('.message-structured-card'));
  const rawPres = Array.from(document.querySelectorAll('.message-structured-pre'));
  const textContent = document.body.textContent || '';
  return {
    rawPayloadCardCount: rawCards.length,
    rawPayloadPreCount: rawPres.length,
    hasFixtureRawText: textContent.includes('fixture-raw-payload')
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ($before.rawPayloadCardCount -ge 1) "conversation fixture is missing raw payload card"
  Assert-True ([int]$before.rawPayloadPreCount -eq 0) "conversation fixture raw payload preview should be lazy before expand"
  Assert-True ($before.hasFixtureRawText -eq $false) "conversation fixture raw payload marker rendered before card expand"

  $expandScript = @'
JSON.stringify((() => {
  const summary = document.querySelector('.message-structured-summary');
  if (summary instanceof HTMLElement) {
    summary.click();
  }
  return { clicked: summary instanceof HTMLElement };
})())
'@
  $expanded = Invoke-BrowserEvalJson -Session $Session -Script $expandScript
  Assert-True ($expanded.clicked -eq $true) "conversation fixture raw payload summary could not be clicked"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $afterScript = @'
JSON.stringify((() => {
  const rawPres = Array.from(document.querySelectorAll('.message-structured-pre'));
  const textContent = document.body.textContent || '';
  return {
    rawPayloadPreCount: rawPres.length,
    hasFixtureRawText: textContent.includes('fixture-raw-payload')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.rawPayloadPreCount -ge 1) "conversation fixture raw payload preview did not render after expand"
  Assert-True ($after.hasFixtureRawText -eq $true) "conversation fixture raw payload marker missing after card expand"
}

function Assert-ConversationFixtureCopyInteraction {
  param([string]$Session)

  $stubScript = @'
JSON.stringify((() => {
  window.__cxCodexCopiedText = '';
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (handler, timeout, ...args) => originalSetTimeout(handler, timeout === 1600 ? 10000 : timeout, ...args);
  const existingClipboard = navigator.clipboard || {};
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      ...existingClipboard,
      writeText: async (text) => {
        window.__cxCodexCopiedText = String(text);
      },
    },
  });
  return { stubbed: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $stubScript | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.message-code-block[data-diff="false"] .message-code-copy');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "conversation fixture code copy button was not clickable"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $stateScript = @'
JSON.stringify({
  copiedText: window.__cxCodexCopiedText || '',
  copiedButtonCount: Array.from(document.querySelectorAll('.message-code-copy')).filter((button) => button.textContent.includes('已复制')).length
})
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $stateScript
  $copiedText = [string]$state.copiedText
  Assert-True ($copiedText -like '*fixture-code-block*') "conversation fixture copy did not capture the code block body"
  Assert-True ($copiedText -notlike '*```*') "conversation fixture copy included markdown fence markers"
  Assert-True ([int]$state.copiedButtonCount -ge 1) "conversation fixture copy button did not show copied feedback"
}

function Read-SidebarFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row'));
  const projectGroups = Array.from(document.querySelectorAll('.sidebar-regression-fixture .project-group'));
  const firstProjectRows = Array.from(projectGroups[0]?.querySelectorAll('.thread-row') || []);
  const firstProjectThreadIds = firstProjectRows.map((node) => node.getAttribute('data-thread-id') || '');
  const emptyProjectGroup = projectGroups.find((node) => node.getAttribute('data-project-name') === 'empty-root') || null;
  const pinnedProjectGroups = projectGroups.filter((node) => node.getAttribute('data-pinned-project') === 'true');
  const showMoreButtons = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-show-more-button'));
  const sections = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-section'));
  const getSectionThreadIds = (label) => {
    const section = sections.find((node) => (node.querySelector('.thread-section-label')?.textContent || '').trim() === label);
    return Array.from(section?.querySelectorAll('.thread-row') || []).map((node) => node.getAttribute('data-thread-id') || '');
  };
  const pinnedSectionThreadIds = getSectionThreadIds('置顶');
  const runningSectionThreadIds = getSectionThreadIds('正在运行');
  const sources = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row-source'));
  const indicators = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-status-indicator'));
  const countRowsByThreadId = (threadId) => rows.filter((node) => node.getAttribute('data-thread-id') === threadId).length;
  const countProjectRowsByThreadId = (threadId) => projectGroups.reduce((count, group) => (
    count + group.querySelectorAll(`.thread-row[data-thread-id="${threadId}"]`).length
  ), 0);
  const rowRects = rows.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      height: rect.height,
      left: rect.left,
      right: rect.right,
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const sourceStyles = sources.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: Number.parseFloat(style.borderTopWidth || '0'),
      borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      paddingLeft: Number.parseFloat(style.paddingLeft || '0'),
      paddingRight: Number.parseFloat(style.paddingRight || '0')
    };
  });
  const indicatorStyles = indicators.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      state: node.getAttribute('data-state') || '',
      animationName: style.animationName || 'none',
      width: Number.parseFloat(style.width || '0'),
      height: Number.parseFloat(style.height || '0')
    };
  });
  const viewportWidth = document.documentElement.clientWidth;
  const rowFitFailures = rowRects.filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const hasPillSourceStyle = sourceStyles.some((style) => (
    style.borderTopWidth > 0
    || style.borderRadius > 0
    || style.paddingLeft > 0
    || style.paddingRight > 0
    || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent')
  ));
  const workingIndicator = indicatorStyles.find((style) => style.state === 'working') || null;
  return {
    rowCount: rows.length,
    projectOrder: projectGroups.map((node) => node.getAttribute('data-project-name') || ''),
    pinnedProjectCount: pinnedProjectGroups.length,
    firstProjectPinned: projectGroups[0]?.getAttribute('data-pinned-project') === 'true',
    hasEmptyWorkspaceProject: !!emptyProjectGroup,
    emptyWorkspaceProjectText: emptyProjectGroup?.textContent?.trim() || '',
    emptyWorkspaceNewThreadButtonCount: emptyProjectGroup?.querySelectorAll('.thread-start-button').length || 0,
    emptyWorkspaceProjectMenuTriggerCount: emptyProjectGroup?.querySelectorAll('.project-menu-trigger').length || 0,
    firstProjectThreadRowCount: firstProjectRows.length,
    firstProjectThreadIds,
    showMoreButtonCount: showMoreButtons.length,
    firstShowMoreText: showMoreButtons[0]?.textContent?.trim() || '',
    pinnedSectionThreadIds,
    runningSectionThreadIds,
    runningThreadRowCount: countRowsByThreadId('fixture-thread-running'),
    runningThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-running'),
    pinnedThreadRowCount: countRowsByThreadId('fixture-thread-unread'),
    pinnedThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-unread'),
    sourceCount: sources.length,
    indicatorCount: indicators.length,
    maxRowHeight: rowRects.length ? Math.max(...rowRects.map((rect) => rect.height)) : 0,
    minRowHeight: rowRects.length ? Math.min(...rowRects.map((rect) => rect.height)) : 0,
    maxRowRadius: rowRects.length ? Math.max(...rowRects.map((rect) => rect.radius)) : 0,
    hasPillSourceStyle,
    workingIndicator,
    rowFitFailureCount: rowFitFailures.length,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-SidebarFixture {
  param([object]$Metrics)

  Assert-True ($Metrics.rowCount -ge 4) "sidebar fixture is missing thread rows"
  Assert-True ($Metrics.projectOrder.Count -ge 3) "sidebar fixture is missing project groups"
  Assert-True ([string]$Metrics.projectOrder[0] -eq "E:/javaword/CXCodex/codexui") "sidebar fixture project order no longer follows input/app-server order"
  Assert-True ([int]$Metrics.pinnedProjectCount -eq 1) "sidebar fixture pinned project marker count is unexpected: $($Metrics.pinnedProjectCount)"
  Assert-True ($Metrics.firstProjectPinned -eq $true) "sidebar fixture first project is missing pinned project marker"
  Assert-True ($Metrics.hasEmptyWorkspaceProject -eq $true) "sidebar fixture filtered out empty workspace-root project"
  Assert-True ([string]$Metrics.emptyWorkspaceProjectText -like "*暂无会话*") "sidebar fixture empty workspace-root project does not show empty state"
  Assert-True ([int]$Metrics.emptyWorkspaceNewThreadButtonCount -eq 0) "sidebar fixture desktop-parity mode should keep the project-level new-thread action in the project menu"
  Assert-True ([int]$Metrics.emptyWorkspaceProjectMenuTriggerCount -eq 1) "sidebar fixture empty workspace-root project is missing its project menu"
  Assert-True ([int]$Metrics.firstProjectThreadRowCount -eq 5) "sidebar fixture first expanded project should show exactly 5 threads by default, got $($Metrics.firstProjectThreadRowCount)"
  $expectedFirstProjectThreadIds = @(
    "fixture-thread-running",
    "fixture-thread-unread",
    "fixture-thread-idle",
    "fixture-thread-four",
    "fixture-thread-five"
  )
  for ($index = 0; $index -lt $expectedFirstProjectThreadIds.Count; $index++) {
    Assert-True ([string]$Metrics.firstProjectThreadIds[$index] -eq $expectedFirstProjectThreadIds[$index]) "sidebar fixture project thread order drifted at index $index; expected $($expectedFirstProjectThreadIds[$index]), got $($Metrics.firstProjectThreadIds[$index])"
  }
  Assert-True ([int]$Metrics.showMoreButtonCount -ge 1) "sidebar fixture is missing show more control for long project thread list"
  Assert-True ([string]$Metrics.firstShowMoreText -eq "显示更多 3 条") "sidebar fixture show more label is unexpected: $($Metrics.firstShowMoreText)"
  Assert-True ([int]$Metrics.pinnedSectionThreadIds.Count -eq 2) "sidebar fixture pinned section should show exactly 2 pinned threads, got $($Metrics.pinnedSectionThreadIds.Count)"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[0] -eq "fixture-thread-unread") "sidebar fixture pinned section order drifted at index 0"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[1] -eq "fixture-thread-running") "sidebar fixture pinned section order drifted at index 1"
  Assert-True ([int]$Metrics.runningSectionThreadIds.Count -eq 0) "sidebar fixture running section should not duplicate a pinned running thread"
  Assert-True ([int]$Metrics.runningThreadRowCount -eq 2) "sidebar fixture pinned running thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.runningThreadProjectRowCount -eq 1) "sidebar fixture running thread is not retained exactly once in project list"
  Assert-True ([int]$Metrics.pinnedThreadRowCount -eq 2) "sidebar fixture pinned thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.pinnedThreadProjectRowCount -eq 1) "sidebar fixture pinned thread is not retained exactly once in project list"
  Assert-True ([int]$Metrics.sourceCount -eq [int]$Metrics.runningThreadRowCount) "sidebar fixture should only keep text metadata for running threads"
  Assert-True ($Metrics.indicatorCount -ge 2) "sidebar fixture is missing unread/running indicators"
  Assert-True ($Metrics.minRowHeight -ge 40) "sidebar fixture row height is too small: $($Metrics.minRowHeight)"
  Assert-True ($Metrics.maxRowHeight -le 52) "sidebar fixture row height is too large: $($Metrics.maxRowHeight)"
  Assert-True ($Metrics.maxRowRadius -le 10) "sidebar fixture row radius is too large: $($Metrics.maxRowRadius)"
  Assert-True ($Metrics.hasPillSourceStyle -eq $false) "sidebar fixture still renders source/status as pill chips"
  Assert-True ($Metrics.workingIndicator.animationName -notlike "*spin*") "sidebar fixture running indicator still uses spinner animation"
  Assert-True ($Metrics.rowFitFailureCount -eq 0) "sidebar fixture rows overflow viewport"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "sidebar fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Assert-SidebarFixtureNewThreadMenu {
  param([string]$Session)

  $openScript = @'
JSON.stringify((() => {
  const trigger = document.querySelector('.project-group[data-project-name="empty-root"] .project-menu-trigger');
  trigger?.click();
  return { triggerFound: !!trigger };
})())
'@
  $openState = Invoke-BrowserEvalJson -Session $Session -Script $openScript
  Assert-True ($openState.triggerFound -eq $true) "sidebar fixture empty workspace-root project menu trigger is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
  $script = @'
JSON.stringify({
  newThreadActionCount: Array.from(document.querySelectorAll('.project-menu-panel .project-menu-item'))
    .filter((node) => (node.textContent || '').trim() === '新建任务')
    .length
})
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$state.newThreadActionCount -eq 1) "sidebar fixture empty workspace-root project menu is missing new-thread action"
}

function Read-ComposerFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const fixture = document.querySelector('.composer-regression-fixture');
  const form = document.querySelector('.composer-regression-fixture .thread-composer');
  const shell = document.querySelector('.composer-regression-fixture .thread-composer-shell');
  const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
  const controls = document.querySelector('.composer-regression-fixture .thread-composer-controls');
  const attach = document.querySelector('.composer-regression-fixture .thread-composer-attach-trigger');
  const runtime = document.querySelector('.composer-regression-fixture .thread-composer-runtime-trigger');
  const mic = document.querySelector('.composer-regression-fixture .thread-composer-mic');
  const expand = document.querySelector('.composer-regression-fixture .thread-composer-expand');
  const submit = document.querySelector('.composer-regression-fixture .thread-composer-submit');
  const dictationStatusText = document.querySelector('.composer-regression-fixture .thread-composer-dictation-statusbar-text');
  const dictationProbe = document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert');
  const submitCount = document.querySelector('.composer-regression-fixture .composer-regression-submit-count');
  const shellRect = shell?.getBoundingClientRect();
  const formRect = form?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fitTargets = [form, shell, input, controls, attach, runtime, expand, mic, submit].filter(Boolean);
  const fitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const style = shell ? window.getComputedStyle(shell) : null;
  const bg = style?.backgroundColor || '';
  return {
    hasFixture: !!fixture,
    hasForm: !!form,
    hasShell: !!shell,
    hasInput: !!input,
    hasAttach: !!attach,
    hasRuntime: !!runtime,
    hasMic: !!mic,
    hasExpand: !!expand,
    hasSubmit: !!submit,
    hasDictationHelper: !!dictationStatusText,
    hasDictationProbe: !!dictationProbe,
    inputValue: input?.value || '',
    submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
    dictationHelperText: dictationStatusText?.textContent?.trim() || '',
    shellWidth: shellRect ? Math.round(shellRect.width) : 0,
    viewportWidth,
    formWidth: formRect ? Math.round(formRect.width) : 0,
    shellHeight: shellRect ? Math.round(shellRect.height) : 0,
    shellRadius: style ? Number.parseFloat(style.borderTopLeftRadius || '0') : 0,
    shellBorderWidth: style ? Number.parseFloat(style.borderTopWidth || '0') : 0,
    shellBackground: bg,
    shellShadow: style?.boxShadow || '',
    usesWarmShell: bg === 'rgb(255, 253, 248)' || bg === 'rgb(255, 250, 243)',
    attachSize: attach ? Math.round(attach.getBoundingClientRect().width) : 0,
    expandSize: expand ? Math.round(expand.getBoundingClientRect().width) : 0,
    micSize: mic ? Math.round(mic.getBoundingClientRect().width) : 0,
    submitSize: submit ? Math.round(submit.getBoundingClientRect().width) : 0,
    runtimeWidth: runtime ? Math.round(runtime.getBoundingClientRect().width) : 0,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ComposerFixture {
  param(
    [object]$Metrics,
    [string]$ViewportName
  )

  Assert-True ($Metrics.hasFixture -eq $true) "$ViewportName composer fixture is missing fixture root"
  Assert-True ($Metrics.hasForm -eq $true) "$ViewportName composer fixture is missing form"
  Assert-True ($Metrics.hasShell -eq $true) "$ViewportName composer fixture is missing shell"
  Assert-True ($Metrics.hasInput -eq $true) "$ViewportName composer fixture is missing input"
  Assert-True ($Metrics.hasAttach -eq $true) "$ViewportName composer fixture is missing attach trigger"
  Assert-True ($Metrics.hasRuntime -eq $true) "$ViewportName composer fixture is missing runtime trigger"
  Assert-True ($Metrics.hasMic -eq $true) "$ViewportName composer fixture is missing dictation button"
  Assert-True ($Metrics.hasExpand -eq $true) "$ViewportName composer fixture is missing long-input expand button"
  Assert-True ($Metrics.hasSubmit -eq $true) "$ViewportName composer fixture is missing submit button"
  Assert-True ($Metrics.hasDictationHelper -eq $false) "$ViewportName composer fixture shows idle dictation helper text"
  Assert-True ($Metrics.hasDictationProbe -eq $true) "$ViewportName composer fixture is missing dictation regression probe"
  Assert-True ($Metrics.shellHeight -ge 82) "$ViewportName composer shell is too short: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellHeight -le 112) "$ViewportName composer shell is too tall: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellRadius -le 22) "$ViewportName composer shell radius is too large: $($Metrics.shellRadius)"
  Assert-True ($Metrics.shellBorderWidth -le 1) "$ViewportName composer shell border is too heavy: $($Metrics.shellBorderWidth)"
  Assert-True ($Metrics.usesWarmShell -eq $false) "$ViewportName composer shell still uses warm beige background: $($Metrics.shellBackground)"
  $minimumControlSize = if ([int]$Metrics.viewportWidth -lt 768) { 44 } else { 34 }
  Assert-True ($Metrics.attachSize -ge $minimumControlSize) "$ViewportName composer attach button is too small: $($Metrics.attachSize)"
  Assert-True ($Metrics.expandSize -ge $minimumControlSize) "$ViewportName composer expand button is too small: $($Metrics.expandSize)"
  Assert-True ($Metrics.micSize -ge $minimumControlSize) "$ViewportName composer mic button is too small: $($Metrics.micSize)"
  Assert-True ($Metrics.submitSize -ge $minimumControlSize) "$ViewportName composer submit button is too small: $($Metrics.submitSize)"
  Assert-True ($Metrics.runtimeWidth -ge 112) "$ViewportName composer runtime trigger is too narrow: $($Metrics.runtimeWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "$ViewportName composer controls overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "$ViewportName composer fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Invoke-ComposerDictationProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert');
  if (button instanceof HTMLElement) {
    button.click();
    return { clicked: true };
  }
  return { clicked: false };
})())
'@
  $result = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ($result.clicked -eq $true) "composer dictation regression probe could not be clicked"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Assert-ComposerDictationDraft {
  param(
    [object]$Metrics,
    [string]$ViewportName
  )

  Assert-True ($Metrics.inputValue -like "*语音转文字回归测试*") "$ViewportName composer dictation text was not inserted into the input"
  Assert-True ([int]$Metrics.submitCount -eq 0) "$ViewportName composer dictation auto-submitted unexpectedly"
  Assert-True ($Metrics.dictationHelperText -eq "已转成文字，可编辑后发送。") "$ViewportName composer dictation success text drifted: $($Metrics.dictationHelperText)"
}

function Read-ThreadPageLoadMetrics {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $script = @'
JSON.stringify((() => {
  const threadId = '__THREAD_ID__';
  const resources = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/codex-api/'))
    .map((entry) => ({
      name: entry.name.replace(location.origin, ''),
      duration: Math.round(entry.duration),
      startTime: Math.round(entry.startTime),
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
    }));
  const statePath = `/codex-api/state/thread/${encodeURIComponent(threadId)}`;
  const runtimePath = `/codex-api/runtime/thread/${encodeURIComponent(threadId)}`;
  const tokenPath = `/codex-api/thread-token-usage?threadId=${encodeURIComponent(threadId)}`;
  const countByPath = (path) => resources.filter((entry) => entry.name === path).length;
  const summarizePath = (predicate) => {
    const matches = resources.filter(predicate);
    return {
      count: matches.length,
      firstStartMs: matches.length ? Math.min(...matches.map((entry) => entry.startTime)) : null,
      maxDurationMs: matches.length ? Math.max(...matches.map((entry) => entry.duration)) : 0,
      totalDurationMs: matches.reduce((sum, entry) => sum + entry.duration, 0),
      transferSize: matches.reduce((sum, entry) => sum + entry.transferSize, 0),
    };
  };
  const earlyRpcRequestCount = resources
    .filter((entry) => entry.startTime <= 650 && entry.name === '/codex-api/rpc')
    .length;
  const firstScreenProjectRootSuggestionCounts = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name.startsWith('/codex-api/project-root-suggestion?'))
    .reduce((counts, entry) => {
      counts[entry.name] = (counts[entry.name] || 0) + 1;
      return counts;
    }, {});
  const firstScreenProjectRootSuggestionMaxDuplicateCount = Object.values(firstScreenProjectRootSuggestionCounts)
    .reduce((max, count) => Math.max(max, count), 0);
  const firstScreenWorkspaceRootsStateCount = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name === '/codex-api/workspace-roots-state')
    .length;
  const firstScreenDesktopAppStatusCount = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name === '/codex-api/desktop-app/status')
    .length;
  const visibleConversationItems = Array.from(document.querySelectorAll('.conversation-item[data-role]'));
  const conversationList = document.querySelector('.conversation-list');
  const messageCards = Array.from(document.querySelectorAll('.message-card'));
  const codeBlocks = Array.from(document.querySelectorAll('.message-code-block'));
  const codeLines = Array.from(document.querySelectorAll('.message-code-line'));
  const commandOutputWraps = Array.from(document.querySelectorAll('.cmd-output-wrap'));
  const mountedCommandOutputs = Array.from(document.querySelectorAll('.cmd-output-wrap .cmd-output'));
  const expandedRawPayloads = Array.from(document.querySelectorAll('.raw-payload-card[open], .message-raw-payload[open]'));
  const visibleUserMessageCount = visibleConversationItems
    .filter((node) => node.getAttribute('data-role') === 'user')
    .length;
  const visibleAssistantMessageCount = visibleConversationItems
    .filter((node) => node.getAttribute('data-role') === 'assistant')
    .length;
  const firstScreenReadyMetric = window.__cxCodexThreadFirstScreenReady?.[threadId] ?? null;
  return {
    apiCount: resources.length,
    earlyRpcRequestCount,
    stateThreadRequestCount: countByPath(statePath),
    runtimeThreadRequestCount: countByPath(runtimePath),
    tokenUsageRequestCount: countByPath(tokenPath),
    firstScreenProjectRootSuggestionMaxDuplicateCount,
    firstScreenWorkspaceRootsStateCount,
    firstScreenDesktopAppStatusCount,
    visibleConversationItemCount: visibleConversationItems.length,
    visibleUserMessageCount,
    visibleAssistantMessageCount,
    firstScreenReadyMs: firstScreenReadyMetric?.readyAtMs ?? null,
    firstScreenReadyItemCount: firstScreenReadyMetric?.itemCount ?? 0,
    firstScreenReadyUserCount: firstScreenReadyMetric?.userCount ?? 0,
    firstScreenReadyAssistantCount: firstScreenReadyMetric?.assistantCount ?? 0,
    messageCardCount: messageCards.length,
    codeBlockCount: codeBlocks.length,
    codeLineCount: codeLines.length,
    expandedCommandOutputCount: commandOutputWraps.filter((node) => node.classList.contains('cmd-output-visible')).length,
    mountedCommandOutputCount: mountedCommandOutputs.length,
    expandedRawPayloadCount: expandedRawPayloads.length,
    conversationDomNodeCount: conversationList ? conversationList.querySelectorAll('*').length : 0,
    bodyDomNodeCount: document.body.querySelectorAll('*').length,
    endpointTiming: {
      rpc: summarizePath((entry) => entry.name === '/codex-api/rpc'),
      stateThread: summarizePath((entry) => entry.name === statePath),
      runtimeThread: summarizePath((entry) => entry.name === runtimePath),
      tokenUsage: summarizePath((entry) => entry.name === tokenPath),
      workspaceRootsState: summarizePath((entry) => entry.name === '/codex-api/workspace-roots-state'),
      projectRootSuggestion: summarizePath((entry) => entry.name.startsWith('/codex-api/project-root-suggestion?')),
    },
    stateThreadEntries: resources
      .filter((entry) => entry.name === statePath)
      .map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
    totalTransferSize: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
    slowRequestCount: resources.filter((entry) => entry.duration >= 1500).length,
  };
})())
'@
  $script = $script.Replace('__THREAD_ID__', $ThreadId.Replace('\', '\\').Replace("'", "\'"))
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadPageLoadMetrics {
  param(
    [object]$Metrics,
    [string]$ThreadId
  )

  if ($null -ne $Metrics.firstUsableMs) {
    Assert-True ([int]$Metrics.firstUsableMs -le 12000) "thread page first usable content took $($Metrics.firstUsableMs)ms for $ThreadId; expected <= 12000ms"
  }
  Assert-True ([int]$Metrics.earlyRpcRequestCount -le 1) "thread page issued $($Metrics.earlyRpcRequestCount) early RPC requests for $ThreadId; expected cache-first first screen to avoid duplicate RPC within 650ms"
  Assert-True ([int]$Metrics.stateThreadRequestCount -le 1) "thread page loaded $($Metrics.stateThreadRequestCount) state snapshots for $ThreadId; expected short snapshot reuse to avoid duplicate full state reads during initial settle"
  Assert-True ([int]$Metrics.runtimeThreadRequestCount -le 8) "thread page loaded $($Metrics.runtimeThreadRequestCount) runtime snapshots for $ThreadId; expected no more than 8 during initial settle"
  Assert-True ([int]$Metrics.tokenUsageRequestCount -eq 0) "thread page loaded $($Metrics.tokenUsageRequestCount) token usage snapshots for $ThreadId during initial settle; expected non-core token usage reads to wait until after first-screen regression"
  Assert-True ([int]$Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount -le 1) "thread page repeated the same project-root-suggestion request $($Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenWorkspaceRootsStateCount -le 1) "thread page loaded workspace-roots-state $($Metrics.firstScreenWorkspaceRootsStateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenDesktopAppStatusCount -eq 0) "thread page loaded desktop-app/status during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.visibleUserMessageCount -ge 1) "thread page first visible window has no user context for $ThreadId"
  Assert-True ([int]$Metrics.visibleAssistantMessageCount -ge 1) "thread page first visible window has no assistant response for $ThreadId"
  Assert-True ([int]$Metrics.visibleConversationItemCount -le 80) "thread page mounted $($Metrics.visibleConversationItemCount) visible conversation items for $ThreadId; expected long threads to keep first-screen DOM window <= 80"
  Assert-True ([int]$Metrics.messageCardCount -le 90) "thread page mounted $($Metrics.messageCardCount) message cards for $ThreadId; expected compact first-screen render <= 90"
  Assert-True ([int]$Metrics.codeLineCount -le 1200) "thread page mounted $($Metrics.codeLineCount) code lines for $ThreadId; expected folded code preview <= 1200 lines"
  Assert-True ([int]$Metrics.mountedCommandOutputCount -le 4) "thread page mounted $($Metrics.mountedCommandOutputCount) command outputs for $ThreadId; expected command output to stay collapsed/lazy"
  Assert-True ([int]$Metrics.expandedCommandOutputCount -le 1) "thread page expanded $($Metrics.expandedCommandOutputCount) command outputs for $ThreadId; expected at most one visible output on first screen"
  Assert-True ([int]$Metrics.expandedRawPayloadCount -eq 0) "thread page expanded raw payload cards during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.conversationDomNodeCount -le 5000) "thread page mounted $($Metrics.conversationDomNodeCount) conversation DOM nodes for $ThreadId; expected <= 5000"
  Assert-True ($null -ne $Metrics.endpointTiming.rpc) "thread page metrics are missing rpc endpoint timing breakdown for $ThreadId"
}

function Read-AppServerRecentRpcMetrics {
  param([string]$BaseUrl)

  $health = Test-HttpJson -Name "post-thread health rpc diagnostics" -Url "$($BaseUrl)/codex-api/health"
  $recentRpc = @($health.data.appServer.rpcDiagnostics.recentRpc)
  $threadReads = @($recentRpc | Where-Object { $_.method -eq "thread/read" })
  $heavyThreadReads = @($threadReads | Where-Object { $_.includeTurns -eq $true })
  $lightThreadReads = @($threadReads | Where-Object { $_.includeTurns -ne $true })
  $maxDuration = 0
  foreach ($record in $recentRpc) {
    $maxDuration = [Math]::Max($maxDuration, [int]$record.durationMs)
  }
  return [pscustomobject]@{
    recentRpcCount = $recentRpc.Count
    threadReadCount = $threadReads.Count
    heavyThreadReadCount = $heavyThreadReads.Count
    lightThreadReadCount = $lightThreadReads.Count
    maxDurationMs = $maxDuration
    recentRpc = @($recentRpc | Select-Object -First 8 method, includeTurns, durationMs, outcome)
  }
}

function Read-ThreadMessageCacheMetrics {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $script = @'
JSON.stringify((() => {
  const threadId = '__THREAD_ID__';
  const raw = window.localStorage.getItem('codex-web-local.thread-message-cache.v1') || '';
  let entry = null;
  try {
    entry = JSON.parse(raw).threads?.[threadId] || null;
  } catch {}
  const messages = Array.isArray(entry?.messages) ? entry.messages : [];
  const maxTextLength = messages.reduce((max, row) => Math.max(max, String(row?.text || '').length), 0);
  const maxCommandOutputLength = messages.reduce((max, row) => Math.max(max, String(row?.commandExecution?.aggregatedOutput || '').length), 0);
  return {
    hasEntry: !!entry,
    messageCount: messages.length,
    entryJsonLength: entry ? JSON.stringify(entry).length : 0,
    maxTextLength,
    maxCommandOutputLength,
  };
})())
'@
  $script = $script.Replace('__THREAD_ID__', $ThreadId.Replace('\', '\\').Replace("'", "\'"))
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadMessageCacheMetrics {
  param(
    [object]$Metrics,
    [string]$ThreadId
  )

  Assert-True ($Metrics.hasEntry -eq $true) "thread message cache has no entry for $ThreadId"
  Assert-True ([int]$Metrics.messageCount -le 24) "thread message cache kept $($Metrics.messageCount) messages for $ThreadId; expected <= 24"
  Assert-True ([int]$Metrics.maxTextLength -le 6100) "thread message cache text is too large for $ThreadId; maxTextLength=$($Metrics.maxTextLength)"
  Assert-True ([int]$Metrics.maxCommandOutputLength -le 3100) "thread message cache command output is too large for $ThreadId; maxCommandOutputLength=$($Metrics.maxCommandOutputLength)"
  Assert-True ([int]$Metrics.entryJsonLength -le 280000) "thread message cache entry is too large for $ThreadId; entryJsonLength=$($Metrics.entryJsonLength)"
}

function Wait-ThreadUsableMetrics {
  param(
    [string]$Session,
    [string]$ThreadId,
    [Diagnostics.Stopwatch]$Stopwatch,
    [int]$TimeoutMs = 12000
  )

  $lastMetrics = $null
  while ($Stopwatch.ElapsedMilliseconds -le $TimeoutMs) {
    $lastMetrics = Read-ThreadPageLoadMetrics -Session $Session -ThreadId $ThreadId
    if ([int]$lastMetrics.visibleUserMessageCount -ge 1 -and [int]$lastMetrics.visibleAssistantMessageCount -ge 1) {
      $firstScreenReadyMs = if ($null -ne $lastMetrics.firstScreenReadyMs -and [int]$lastMetrics.firstScreenReadyMs -gt 0) {
        [int]$lastMetrics.firstScreenReadyMs
      } else {
        [int]$Stopwatch.ElapsedMilliseconds
      }
      $lastMetrics | Add-Member -NotePropertyName "firstUsableMs" -NotePropertyValue $firstScreenReadyMs -Force
      $lastMetrics | Add-Member -NotePropertyName "browserObservedUsableMs" -NotePropertyValue ([int]$Stopwatch.ElapsedMilliseconds) -Force
      return $lastMetrics
    }
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  }

  $lastUserCount = if ($null -ne $lastMetrics) { [int]$lastMetrics.visibleUserMessageCount } else { 0 }
  $lastAssistantCount = if ($null -ne $lastMetrics) { [int]$lastMetrics.visibleAssistantMessageCount } else { 0 }
  throw "thread page did not become usable within ${TimeoutMs}ms for $ThreadId; userCount=$lastUserCount assistantCount=$lastAssistantCount"
}

function Read-ThreadWindowMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const resources = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/codex-api/rpc'));
  const list = document.querySelector('.conversation-list');
  const items = Array.from(document.querySelectorAll('.conversation-item[data-role]'));
  const roleCount = (role) => items.filter((node) => node.getAttribute('data-role') === role).length;
  const loadButton = document.querySelector('.conversation-load-more-button');
  const loadText = loadButton?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const remainingMatch = loadText.match(/剩余\s+(\d+)\s+条/);
  return {
    hasLoadMore: !!loadButton,
    loadText,
    hiddenRemaining: remainingMatch ? Number(remainingMatch[1]) : null,
    itemCount: items.length,
    userCount: roleCount('user'),
    assistantCount: roleCount('assistant'),
    scrollTop: list?.scrollTop ?? 0,
    scrollHeight: list?.scrollHeight ?? 0,
    clientHeight: list?.clientHeight ?? 0,
    rpcCount: resources.length,
    hasInternalCodexContext: /<codex_internal_context\s+source=/i.test(document.body.innerText),
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Click-ThreadLoadMore {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!button || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadLoadMoreWindow {
  param(
    [string]$Session,
    [string]$ThreadId,
    [int]$Iterations = 2
  )

  $totalItemDelta = 0
  for ($step = 1; $step -le $Iterations; $step++) {
    $before = Read-ThreadWindowMetrics -Session $Session
    if ($before.hasLoadMore -ne $true) {
      Assert-True ($step -gt 1 -and $totalItemDelta -ge 1) "thread page has no load-more affordance before step $step for $ThreadId"
      break
    }
    $clickResult = Click-ThreadLoadMore -Session $Session
    Assert-True ($clickResult.clicked -eq $true) "thread page load-more click did not execute at step $step for $ThreadId"
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "1400") | Out-Null
    $after = Read-ThreadWindowMetrics -Session $Session

    $itemDelta = [int]$after.itemCount - [int]$before.itemCount
    $remainingDelta = 0
    if ($null -ne $before.hiddenRemaining -and $null -ne $after.hiddenRemaining) {
      $remainingDelta = [int]$before.hiddenRemaining - [int]$after.hiddenRemaining
    }
    $progressDelta = [Math]::Max($itemDelta, $remainingDelta)
    $heightDelta = [int]$after.scrollHeight - [int]$before.scrollHeight
    $scrollDelta = [int]$after.scrollTop - [int]$before.scrollTop
    $anchorDrift = [Math]::Abs($scrollDelta - $heightDelta)
    $totalItemDelta += $progressDelta

    Assert-True ($after.hasInternalCodexContext -ne $true) "thread page exposed internal codex context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.userCount -ge 1) "thread page has no user context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.assistantCount -ge 1) "thread page has no assistant response after load-more step $step for $ThreadId"
    Assert-True ($progressDelta -ge 1) "thread page load-more step $step did not advance visible history for $ThreadId; beforeItems=$($before.itemCount), afterItems=$($after.itemCount), beforeRpc=$($before.rpcCount), afterRpc=$($after.rpcCount), beforeLoad='$($before.loadText)', afterLoad='$($after.loadText)'"
    Assert-True ($progressDelta -le 16) "thread page load-more step $step advanced too much history for $ThreadId; delta=$progressDelta"
    Assert-True ($anchorDrift -le 180) "thread page load-more step $step shifted reading anchor too much for $ThreadId; drift=$anchorDrift"
  }
  Assert-True ($totalItemDelta -ge 1) "thread page load-more did not reveal any older history for $ThreadId"
  Assert-True ($totalItemDelta -le ($Iterations * 16)) "thread page repeated load-more revealed too many items for $ThreadId; totalDelta=$totalItemDelta"
}

function Add-RegressionResult {
  param(
    [string]$Name,
    [object]$Page
  )

  $screenshotPath = $null
  if ($script:captureScreenshots -and -not [string]::IsNullOrWhiteSpace($script:activeSession)) {
    $screenshotPath = Save-RegressionScreenshot -Session $script:activeSession -Name $Name
  }

  $script:results += [PSCustomObject]@{
    name = $Name
    url = [string]$Page.url
    overflow = [bool]$Page.hasHorizontalOverflow
    screenshot = $screenshotPath
  }
}

if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  throw "agent-browser is not available in PATH"
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$session = "cx-codex-frontend-regression"
$script:activeSession = $session
$script:captureScreenshots = [bool]$CaptureScreenshots
$script:screenshotOutputDir = Initialize-ScreenshotOutputDir
$results = @()

try {
  Assert-AndroidResumeThreadListRecoverySource
  Assert-CrossClientThreadStartedRefreshSource
  Assert-PendingStartOutboxRecoverySource
  Assert-RuntimeSnapshotOrderingSource
  Assert-BoundedRuntimeSendRecoverySource

  $health = Test-HttpJson -Name "health" -Url "$($BaseUrl)/health"
  Assert-True ($health.status -eq "ok") "health status is not ok"

  $codexHealth = Wait-CodexHealthIdle -Url "$($BaseUrl)/codex-api/health"
  Assert-CodexHealthReadyForFrontendRegression -Health $codexHealth

  $diagnostics = Test-HttpJson -Name "diagnostics api" -Url "$($BaseUrl)/codex-api/diagnostics"
  Assert-True ($diagnostics.status -eq "ok") "diagnostics status is not ok"
  Assert-True ($null -ne $diagnostics.data.runtimeStore) "diagnostics is missing runtimeStore"
  $workspaceRootsState = Test-HttpJson -Name "workspace roots state" -Url "$($BaseUrl)/codex-api/workspace-roots-state"
  $requiredSidebarThread = Resolve-RequiredSidebarThread -BaseUrl $BaseUrl -Title $RequireThreadTitle

  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Reset-AppShellLayoutPreferences -Session $session
  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  Assert-WorkspaceRootProjectParity -RootsState $workspaceRootsState -Metrics (Read-HomeWorkspaceProjectMetrics -Session $session)
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread) `
    -Context "home desktop"
  Add-RegressionResult -Name "home-desktop" -Page $homePage
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".sidebar-settings-button") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  Assert-SettingsPanel -Metrics (Read-SettingsPanelMetrics -Session $session)
  Close-SettingsPanelIfOpen -Session $session
  Reset-AppShellLayoutPreferences -Session $session

  $homeFoldable = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $homeFoldable -Name "home foldable" -RequireComposer
  Assert-FoldableShell -Metrics (Read-FoldableShellMetrics -Session $session)
  Add-RegressionResult -Name "home-foldable" -Page $homeFoldable

  Set-SidebarCollapsedPreference -Session $session -Collapsed $true
  $homePhone = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $homePhone -Name "home phone" -RequireComposer
  Assert-MobileDrawerSidebar -Metrics (Open-MobileDrawerSidebar -Session $session)
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread -RootSelector ".mobile-drawer") `
    -Context "home mobile drawer"
  Add-RegressionResult -Name "home-mobile-drawer" -Page $homePhone

  if ($MeasureNewThreadFeedback) {
    $newThreadFeedbackPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $newThreadFeedbackPage -Name "new thread feedback phone" -RequireComposer
    Measure-NewThreadSendFeedbackBudget -Session $session
    Measure-NewThreadAuthoritativeHandoff -Session $session -BaseUrl $BaseUrl
  }

  Seed-PersistentOutboxDraftRecoveryProbe -Session $session
  $outboxRecoveryPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $outboxRecoveryPage -Name "persistent outbox recovery phone" -RequireComposer
  Assert-PersistentOutboxDraftRecovery -Session $session
  Add-RegressionResult -Name "persistent-outbox-recovery-phone" -Page $outboxRecoveryPage
  Clear-PersistentOutboxDraftRecoveryProbe -Session $session
  Dispatch-MobileResumeOutboxRecoveryProbe -Session $session
  Assert-MobileResumeOutboxRecovery -Session $session
  Clear-PersistentOutboxDraftRecoveryProbe -Session $session

  $skills = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/skills?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $skills -Name "skills phone" -RequireSkillsHub
  Add-RegressionResult -Name "skills-phone" -Page $skills

  $trending = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/github-trending?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $trending -Name "github trending phone" -RequireTrendingHub
  Add-RegressionResult -Name "github-trending-phone" -Page $trending

  $diagnosticsPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/diagnostics?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $diagnosticsPage -Name "diagnostics phone" -RequiredText "Runtime Store" -RequireDiagnostics
  Add-RegressionResult -Name "diagnostics-phone" -Page $diagnosticsPage

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $readmePath = (Join-Path $repoRoot "README.md").Replace('\', '/')
  $encodedReadmePath = [System.Uri]::EscapeDataString($readmePath)
  $previewUrl = $BaseUrl + "/local-preview.html?path=" + $encodedReadmePath + '&regression=frontend'
  $preview = Open-And-ReadPage -Session $session -Url $previewUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $preview -Name "local preview phone" -RequireMarkdown
  Add-RegressionResult -Name "local-preview-phone" -Page $preview

  $sidebarFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend"
  $sidebarFixture = Open-And-ReadPage -Session $session -Url $sidebarFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarFixture -Name "sidebar rows fixture phone"
  Assert-SidebarFixture -Metrics (Read-SidebarFixtureMetrics -Session $session)
  Assert-SidebarFixtureNewThreadMenu -Session $session
  Add-RegressionResult -Name "sidebar-rows-fixture-phone" -Page $sidebarFixture

  $composerFixtureUrl = $BaseUrl + "/#/__regression/composer-shell?regression=frontend"
  $composerFixture = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $composerFixture -Name "composer shell fixture desktop" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "desktop"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "desktop"
  Add-RegressionResult -Name "composer-shell-fixture-desktop" -Page $composerFixture

  $composerFixturePhone = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $composerFixturePhone -Name "composer shell fixture phone" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "composer-shell-fixture-phone" -Page $composerFixturePhone

  $composerFixtureFoldable = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $composerFixtureFoldable -Name "composer shell fixture foldable" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "composer-shell-fixture-foldable" -Page $composerFixtureFoldable

  $fixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend"
  $fixture = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $fixture -Name "conversation blocks fixture desktop"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "desktop"
  Assert-ConversationOlderHistoryAffordance -Session $session
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

  $fixturePhone = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $fixturePhone -Name "conversation blocks fixture phone"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "conversation-blocks-fixture-phone" -Page $fixturePhone

  $tailStatusFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&tailGap=1"
  $tailStatusFixture = Open-And-ReadPage -Session $session -Url $tailStatusFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $tailStatusFixture -Name "conversation tail status fixture phone"
  Assert-ConversationTailStatusFixture -Session $session
  Add-RegressionResult -Name "conversation-tail-status-fixture-phone" -Page $tailStatusFixture

  $fixtureFoldable = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $fixtureFoldable -Name "conversation blocks fixture foldable"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "conversation-blocks-fixture-foldable" -Page $fixtureFoldable

  if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
    $threadLoadStopwatch = [Diagnostics.Stopwatch]::StartNew()
    $thread = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/thread/$ThreadId" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $thread -Name "thread phone" -RequireComposer
    $threadUsableMetrics = Wait-ThreadUsableMetrics -Session $session -ThreadId $ThreadId -Stopwatch $threadLoadStopwatch
    $remainingSettleMs = [Math]::Max(0, 9000 - [int]$threadLoadStopwatch.ElapsedMilliseconds)
    if ($remainingSettleMs -gt 0) {
      Invoke-AgentBrowser -Arguments @("--session", $session, "wait", ([string]$remainingSettleMs)) | Out-Null
    }
    $threadPageLoadMetrics = Read-ThreadPageLoadMetrics -Session $session -ThreadId $ThreadId
    $threadPageLoadMetrics | Add-Member -NotePropertyName "firstUsableMs" -NotePropertyValue ([int]$threadUsableMetrics.firstUsableMs) -Force
    $threadPageLoadMetrics | Add-Member -NotePropertyName "browserObservedUsableMs" -NotePropertyValue ([int]$threadUsableMetrics.browserObservedUsableMs) -Force
    Write-Step ("thread DOM pressure -> " + (@{
      firstUsableMs = [int]$threadPageLoadMetrics.firstUsableMs
      browserObservedUsableMs = [int]$threadPageLoadMetrics.browserObservedUsableMs
      items = [int]$threadPageLoadMetrics.visibleConversationItemCount
      cards = [int]$threadPageLoadMetrics.messageCardCount
      codeLines = [int]$threadPageLoadMetrics.codeLineCount
      commandOutputs = [int]$threadPageLoadMetrics.mountedCommandOutputCount
      conversationDomNodes = [int]$threadPageLoadMetrics.conversationDomNodeCount
    } | ConvertTo-Json -Compress))
    Write-Step ("thread endpoint timing -> " + ($threadPageLoadMetrics.endpointTiming | ConvertTo-Json -Compress))
    Write-Step ("thread state entries -> " + ($threadPageLoadMetrics.stateThreadEntries | ConvertTo-Json -Compress))
    Write-Step ("app-server recent rpc -> " + ((Read-AppServerRecentRpcMetrics -BaseUrl $BaseUrl) | ConvertTo-Json -Depth 4 -Compress))
    Assert-ThreadPageLoadMetrics -Metrics $threadPageLoadMetrics -ThreadId $ThreadId
    Assert-ThreadMessageCacheMetrics -Metrics (Read-ThreadMessageCacheMetrics -Session $session -ThreadId $ThreadId) -ThreadId $ThreadId
    Assert-ThreadLoadMoreWindow -Session $session -ThreadId $ThreadId
    if ($MeasureSendFeedback) {
      Measure-ThreadSendFeedbackBudget -Session $session -ThreadId $ThreadId
    }
    if ($MeasureResponseFeedback) {
      Measure-ThreadResponseFeedbackBudget -Session $session -ThreadId $ThreadId
    }
    Add-RegressionResult -Name "thread-phone" -Page $thread
  } else {
    if ($MeasureSendFeedback) {
      throw "-MeasureSendFeedback requires -ThreadId"
    }
    if ($MeasureResponseFeedback) {
      throw "-MeasureResponseFeedback requires -ThreadId"
    }
    Write-Step "thread page check skipped; pass -ThreadId to enable it"
  }

  $results | Format-Table -AutoSize
  Write-Step "all frontend checks passed"
} finally {
  try {
    Invoke-AgentBrowser -Arguments @("--session", $session, "close", "--all") | Out-Null
  } catch {}
}
