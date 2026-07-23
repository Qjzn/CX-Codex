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
$ThreadInitialMessageWindowSize = 10
$HomeWorkspaceProjectsReadyBudgetMs = 15000

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
  $functionMatch = [regex]::Match($source, "async\s+function\s+recoverPersistentMessageOutbox[\s\S]*?\n\s*async\s+function\s+startRuntimeTurnWithBoundedRecovery")
  Assert-True ($functionMatch.Success) "could not find recoverPersistentMessageOutbox source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "recovered\?\.status\s*===\s*'pending_start'\s*&&\s*!recoveredThreadId") "threadless pending_start requests must be recovered before removing the outbox entry"
  Assert-True ($functionSource -match "!recovered\s*&&\s*\(entry\.state\s*===\s*'sending'\s*\|\|\s*entry\.state\s*===\s*'waiting'\)") "unacknowledged transport sends must retry from the durable outbox after reconnect"
  Assert-True ($functionSource -match "if\s*\(recoveredThreadId\)[\s\S]*?restoreWaitingMessageOutboxEntry\(entry,\s*recoveredThreadId\)[\s\S]*?restoreWaitingNewThreadOutboxEntry\(entry\)[\s\S]*?await\s+startRuntimeThreadTurn") "outbox recovery must restore visible waiting feedback before the network resume finishes"
  Assert-True ($functionSource -match "startRuntimeThreadTurn\(\{[\s\S]*?clientMessageId:\s*entry\.clientMessageId") "threadless pending_start recovery must reuse the durable client message id"
  Assert-True ($functionSource -match "restoreWaitingMessageOutboxEntry[\s\S]*?restoreWaitingNewThreadOutboxEntry") "transport recovery must preserve a waiting bubble for both existing and new threads"
  Assert-True ($functionSource -match "isRuntimeRequestAwaitingDeliveryConfirmation\(recovered\.status\)[\s\S]*?restoreConfirmingMessageOutboxEntry") "unconfirmed runtime requests must keep a confirming outbox bubble"
  Assert-True ($source -match "function\s+markOptimisticUserMessageConfirming[\s\S]*?updateMessageOutboxEntry\(clientMessageId,\s*\{\s*state:\s*'confirming'\s*\}\)") "confirming delivery must remain durable in the message outbox"
  Assert-True ($source -match "runtimeResult\s*&&\s*isRuntimeRequestAwaitingDeliveryConfirmation\(runtimeResult\.status\)[\s\S]*?markOptimisticUserMessageConfirming") "direct sends must not present an unconfirmed request as sent"
  Assert-True ($source -match "hasUnconfirmedMessageOutboxEntryForThread\(threadId\)[\s\S]*?shouldSettleOptimisticDeliveryFromRuntimeSnapshot[\s\S]*?void\s+recoverPersistentMessageOutbox\(\)") "a failed runtime snapshot must reconcile an unconfirmed outbox entry instead of presenting it as sent"
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
  $gatewaySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\codexGateway.ts")
  $serverSnapshotSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\appServerThreadRuntimeSnapshot.ts")
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  Assert-True ($source -match "const\s+currentEventSeq\s*=\s*Math\.max\([\s\S]*?latestRuntimeEventSeqByThreadId\.get\(threadId\)[\s\S]*?shouldApplyRuntimeSnapshotVersion\(\{\s*lastEventSeq:\s*currentEventSeq\s*\},\s*snapshot\)") "runtime snapshots must be checked against the latest buffered event sequence"
  Assert-True ($source -match "eventSeq:\s*notification\.seq") "runtime notification state must retain the authoritative event sequence"
  Assert-True ($source -match "rememberLatestRuntimeEventSequence\(threadId,\s*notification\.seq\)[\s\S]*?method\.endsWith\('/delta'\)") "delta events must record their latest sequence before taking the non-reactive fast path"
  Assert-True ($source -match "method\.endsWith\('/delta'\)[\s\S]*?isRuntimeExecutionActiveState\(currentState\)[\s\S]*?markThreadLiveExecutionSignal\(threadId\)[\s\S]*?isRuntimeExecutionSettledState\(currentState\)\)\s*return") "high-frequency deltas must not rewrite reactive runtime state or revive a settled turn"
  Assert-True ($source -match "const\s+initialRuntimeSnapshotApplied\s*=\s*applyRuntimeSnapshotState\(threadId,\s*snapshot\)[\s\S]*?refreshSettledSnapshotMessagesFromRpc") "foreground recovery must apply the lightweight runtime snapshot before a heavy history refresh"
  Assert-True ($source -match "preferCachedMessages:\s*shouldShowLoading") "cold thread selection must request recoverable cached messages before a heavy history read"
  Assert-True ($source -match "preferCachedMessages:\s*shouldShowLoading\s*\|\|\s*options\.fullHistory\s*===\s*true\s*\|\|\s*Boolean\(options\.olderHistory\)") "explicit history paging must reuse the lightweight cached state before its authoritative RPC"
  Assert-True ($gatewaySource -match "preferCachedMessages\s*\?\s*'\?preferCachedMessages=1'") "the frontend gateway must opt into the cache-first thread-state route"
  Assert-True ($serverSnapshotSource -match "options\.preferCachedMessages\s*===\s*true[\s\S]*?readSessionLogThreadRead[\s\S]*?messageState\s*=\s*'cached'") "cache-first state must recover local session messages without presenting them as authoritative"
  Assert-True ($serverSnapshotSource -match "trimThreadTurnsInRpcResult\('thread/read',\s*recoveredThreadRead\)") "cache-first session recovery must retain the bounded initial message window"
  Assert-True ($source -match "shouldDeferCachedRpcRefresh[\s\S]*?scheduleSettledSnapshotMessagesRpcRefresh") "cache-first messages must trigger an immediate background authoritative refresh"
  Assert-True ($source -match "shouldDeferCachedRpcRefresh\s*=\s*options\.forceSettledRpcRefresh\s*!==\s*true") "the forced authoritative refresh must not defer itself again"
  Assert-True ($source -match "shouldForceCachedSnapshotRefresh\s*=\s*options\.force\s*===\s*true\s*&&\s*snapshot\.messageState\s*===\s*'cached'") "cached historical threads without a terminal event key must still receive an authoritative refresh"
  Assert-True ($source -match "!options\.olderHistory\s*&&\s*!shouldForceCachedSnapshotRefresh") "explicit older-history reads must not be blocked when a legacy thread has no terminal refresh key"
  Assert-True ($conversationSource -match "pendingRemoteOlderHistoryAnchor\s*=\s*anchorSnapshot[\s\S]*?emit\('loadOlderHistory'\)[\s\S]*?props\.messages\.length[\s\S]*?restoreScrollAnchorOverFrames\(anchorSnapshot,\s*6\)") "remote older-history insertion must restore the pre-request reading anchor after messages arrive"
  Assert-True ($source -match "else\s+if\s*\(!shouldDeferCachedRpcRefresh\)\s*\{\s*scheduleNonFreshThreadDetailRetry") "the slow non-fresh retry must not race the immediate cached-message refresh"
  Assert-True ($source -match "\(notificationStale\.value\s*\|\|\s*syncLagging\.value\)\s*&&\s*!recentlySynced") "startup notification health recovery must not duplicate a just-completed authoritative message refresh"
  Assert-True ($source -match "existingWasAuthoritative\s*=\s*authoritativeMessageLoadInFlightThreadIds\.has\(threadId\)[\s\S]*?existingWasAuthoritative\s*&&\s*options\.fullHistory\s*!==\s*true\s*&&\s*!options\.olderHistory") "concurrent snapshot recovery must reuse an in-flight authoritative message read"
  Assert-True ($source -match "const\s+refreshedRuntimeSnapshotApplied\s*=\s*snapshot\s*===\s*initialRuntimeSnapshot[\s\S]*?\?\s*false[\s\S]*?:\s*applyRuntimeSnapshotState") "the same settled snapshot must not be applied twice while queued work starts"
  Assert-True ($source -match "const\s+runtimeSnapshotApplied\s*=\s*initialRuntimeSnapshotApplied\s*\|\|\s*refreshedRuntimeSnapshotApplied") "message reconciliation must retain a runtime snapshot applied before history refresh"
  Assert-True ($source -match "settleOptimisticUserMessagesThrough\(threadId,\s*settledAtMs\)") "authoritative terminal snapshots must clear older optimistic running residue"
  Assert-True ($source -match "setTurnActivityForThread\(threadId,\s*\{\s*reset:\s*true") "a new local send must start a distinct activity timeline"
  Assert-True ($source -match "activityId:\s*activity\?\.activityId") "the live overlay must expose stable activity identity to the conversation renderer"
  Assert-True ($source -match "Math\.min\(previous\.startedAtMs,\s*authoritativeStartedAtMs\)") "foreground recovery must correct a provisional timer with the earlier authoritative start time"
  Assert-True ($source -match "readRuntimeActivityStartedAtMs\(runtimeSummary\)") "activity recovery must reject a start timestamp that belongs to an already completed turn"
  Assert-True ($source -match "const\s+unread\s*=\s*!isSelected\s*&&\s*!inProgress\s*&&\s*unreadByEvent") "thread timestamps alone must not mark every sidebar row unread"
  Assert-True ($source -match "const\s+UNREAD_STATE_STORAGE_KEY[\s\S]*?function\s+saveUnreadStateMap") "completion unread state must survive mobile process restarts"
  Assert-True ($source -match "function\s+applyReplayedRuntimeTerminalCleanup[\s\S]*?markThreadUnreadByEvent\(threadId\)") "replayed terminal events must restore unread completion feedback"
  Assert-True ($source -match "clearSettledRuntimeResidue\(threadId,\s*snapshot\.executionState\)[\s\S]*?processQueuedMessages\(threadId\)") "a settled runtime snapshot must release the previous turn and advance queued work"
  Assert-True ($source -match "if\s*\(queue\[0\]\?\.deliveryState\s*===\s*'failed'\)\s*return") "a failed queued follow-up must pause instead of retrying indefinitely"
  Assert-True ($source -match "catch\s*\(unknownError\)[\s\S]*?setQueuedMessageDeliveryState\([\s\S]*?threadId,[\s\S]*?next\.id,[\s\S]*?'failed'") "queued send failures must remain visible and retryable"
  Assert-True ($source -match "function\s+retryQueuedMessage[\s\S]*?setQueuedMessageDeliveryState\(threadId,\s*messageId,\s*'queued'\)[\s\S]*?processQueuedMessages\(threadId\)") "manual queue retry must resume the paused first item"
  Assert-True ($source -match "function\s+deleteQueuedMessage[\s\S]*?removeQueuedMessageByThreadId\(threadId,\s*messageId\)[\s\S]*?processQueuedMessages\(threadId\)") "deleting a failed queue item must release the following item"
  Assert-True ($source -match "clientMessageId:\s*next\.clientMessageId") "queued follow-ups must reuse a stable idempotency key across pages and retries"
  Assert-True ($source -match "event\.key\s*===\s*QUEUED_MESSAGES_STORAGE_KEY[\s\S]*?queuedMessagesByThreadId\.value\s*=\s*loadQueuedMessagesMap\(\)") "parallel 7420 pages must converge queued-message state without auto-running it"
  $strongSignalMatch = [regex]::Match($source, "function\s+hasStrongExecutionSignal[\s\S]*?\n\s*}")
  Assert-True ($strongSignalMatch.Success -and $strongSignalMatch.Value -notmatch "hasQueuedThreadWork") "queued follow-up work must not keep the completed turn marked as running"
  $messageRefreshMatch = [regex]::Match($source, "function\s+shouldRefreshMessagesFromNotification[\s\S]*?\n}")
  Assert-True ($messageRefreshMatch.Success) "could not find message refresh notification policy"
  Assert-True ($messageRefreshMatch.Value -match "turn/completed" -and $messageRefreshMatch.Value -match "thread/completed") "terminal notifications must still refresh authoritative messages"
  Assert-True ($messageRefreshMatch.Value -notmatch "item/completed" -and $messageRefreshMatch.Value -notmatch "startsWith\('thread/'\)") "item completion and generic thread metadata must not trigger repeated full-history reads"
  Assert-True ($source -match "ACTIVE_THREAD_DETAIL_FALLBACK_SYNC_INTERVAL_MS\s*=\s*60000") "healthy active turns must use the one-minute detail fallback instead of continuous heavy reads"
  Assert-True ($source -match "if\s*\(showRecoveryFeedback\)[\s\S]*?beginForegroundRecoveryFeedback\(selectedThreadId\.value\)[\s\S]*?ANDROID_RESUME_SYNC_DEBOUNCE_MS") "foreground recovery feedback must publish before Android resume sync debounce"
  Assert-True ($source -match "foregroundRecoveryThreadId\.value\s*===\s*threadId\)\s*return") "duplicate foreground lifecycle events must not restart recovery feedback"
  Assert-True ($source -match "finishForegroundRecoveryFeedback\(threadId\)[\s\S]*?shouldApplyRuntimeSnapshotVersion") "the first runtime snapshot must settle foreground recovery feedback"
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  $queueSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\QueuedMessages.vue")
  Assert-True ($queueSource -match "队列已暂停。重试、编辑或删除后继续") "the paused queue must explain the available recovery actions"
  Assert-True ($queueSource -match "retry:\s*\[messageId:\s*string\]") "the failed queue row must expose a retry action"
  Assert-True ($conversationSource -match "previousOverlay\.activityId\s*===\s*nextOverlay\.activityId") "elapsed time may only be retained for the same activity"
  Assert-True ($conversationSource -match "live-overlay-inline-recovering[\s\S]*?aria-busy") "foreground recovery must expose one accessible animated status surface"
}

function Assert-MobileLatestReplyRecoverySource {
  $routeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeStateRoutes.ts")
  $runtimeStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeState.ts")
  $middlewareStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexBridgeMiddlewareState.ts")
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $latestReplySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\utils\latestReply.ts")
  $singleSnapshotMatch = [regex]::Match($routeSource, "url\.pathname\s*===\s*'/codex-api/runtime/snapshot'[\s\S]*?setJson\(res,\s*200")
  $batchSnapshotMatch = [regex]::Match($routeSource, "url\.pathname\s*===\s*'/codex-api/runtime/snapshots'[\s\S]*?return\s+true")
  Assert-True ($singleSnapshotMatch.Success -and $singleSnapshotMatch.Value -match 'readLocalRuntimeSnapshot\(threadId\)') "single runtime snapshots must recover persisted latest replies after a server restart"
  Assert-True ($batchSnapshotMatch.Success -and $batchSnapshotMatch.Value.Contains('threadIds.map((threadId) => dependencies.readLocalRuntimeSnapshot(threadId))')) "Android batch snapshots must recover persisted latest replies instead of reading an empty process-local map"
  Assert-True ($middlewareStateSource -match 'loadPersistedSnapshot:[\s\S]*?runtimeStore\.getSnapshot\(threadId\)\?\.snapshot') "the first post-restart runtime mutation must resume from the persisted reply accumulator"
  Assert-True ($runtimeStateSource -match 'Keep one trailing separator while streaming' -and $runtimeStateSource -match 'normalized\.slice\(normalized\.length\s*-\s*LATEST_REPLY_CACHE_LIMIT\)') "stream chunks must preserve word boundaries and completed long replies must retain their newest tail"
  Assert-True ($runtimeStateSource -match 'latestReplyItemId' -and $runtimeStateSource -match 'itemId\s*&&\s*state\.latestReplyItemId\s*&&\s*itemId\s*!==\s*state\.latestReplyItemId[\s\S]*?appendLatestReply\('''',\s*delta\)') "a new assistant item must replace the previous item on its first delta instead of concatenating both messages"
  Assert-True ($runtimeStateSource -match 'latestReplyEventSeq' -and $runtimeStateSource -match 'latestReply:\s*nextLatestReply[\s\S]*?latestReplyEventSeq:\s*Math\.max\(0,\s*Math\.trunc\(event\.seq\)\)' -and $runtimeStateSource -match 'latestReply:\s*completedReply[\s\S]*?latestReplyEventSeq:\s*Math\.max\(0,\s*Math\.trunc\(event\.seq\)\)') "latest reply text must carry its own event version instead of borrowing the generic task cursor"
  Assert-True ($desktopStateSource -match 'function\s+latestTaskPetReply[\s\S]*?compactLatestReplyTail\(value,\s*260\)' -and $latestReplySource -match 'normalized\.slice\(normalized\.length\s*-\s*limit\)') "the renderer-to-native task-pet snapshot must carry the newest reply tail instead of a frozen prefix"
  Assert-True ($desktopStateSource -match 'runtimeReplyMatchesActiveTurn[\s\S]*?runtimeLatestReply[\s\S]*?latestReplyEventSeq:\s*runtimeLatestReply\s*\?\s*runtimeSummary\?\.latestReplyEventSeq\s*\?\?\s*0\s*:\s*0') "frontend fallback replies must remain unversioned and prior-turn Runtime replies must not be paired with a new activity"
}

function Assert-BoundedRuntimeSendRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $serverSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\appServerRuntimeStart.ts")
  $runtimeActionSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeActionRoutes.ts")
  $runtimeStoreSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeStore.ts")
  $codexBridgeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexAppServerBridge.ts")
  $codexBridgeDisposeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexBridgeMiddlewareDispose.ts")
  $androidTaskPetSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetOverlayService.java")
  $androidTaskPetPolicySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetRuntimePolicy.java")
  $androidNoProgressReviewSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetNoProgressReviewReceiver.java")
  $androidPushServiceSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetFirebaseMessagingService.java")
  $androidPushRegistrationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobilePushRegistration.java")
  $androidMainActivitySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MainActivity.java")
  $androidPluginSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobileShellPlugin.java")
  $androidConfigSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobileShellConfig.java")
  $androidManifestSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\AndroidManifest.xml")
  $androidBackgroundVerifierSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-android-background.ps1")
  $mobilePushReadinessSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-mobile-push-readiness.mjs")
  $mobilePushReadinessTestSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-mobile-push-readiness.test.mjs")
  $serverMobilePushSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\mobilePush.ts")
  $serverMobilePushRoutesSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\mobilePushRoutes.ts")
  $chatFeedbackSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\chatFeedbackMetrics.ts")
  $diagnosticsPanelSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\DiagnosticsPanel.vue")
  $taskPetPreviewSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\mobile\TaskPetPreview.vue")
  Assert-True ($source -match "const\s+RUNTIME_SEND_RETRY_DELAYS_MS\s*=\s*\[700,\s*2000,\s*5000,\s*10000\]") "runtime send retries must use the bounded mobile weak-network schedule"
  $functionMatch = [regex]::Match($source, "async\s+function\s+startRuntimeTurnWithBoundedRecovery[\s\S]*?\n\s*function\s+hydrateCachedMessagesForThread")
  Assert-True ($functionMatch.Success) "could not find startRuntimeTurnWithBoundedRecovery source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "runWithBoundedRecovery\(\{") "production runtime sends must use the tested bounded recovery coordinator"
  Assert-True ($functionSource -match "getRuntimeRequestByClientMessageId\(args\.clientMessageId\)") "transport failures must reconcile the same client message id before retrying"
  Assert-True ($functionSource -match "markOptimisticUserMessageRetrying") "bounded recovery must publish visible retry progress"
  $existingThreadSendMatch = [regex]::Match($source, "async\s+function\s+sendMessageToSelectedThread[\s\S]*?\n\s*async\s+function\s+sendMessageToNewThread")
  Assert-True ($existingThreadSendMatch.Success) "could not find existing-thread send source"
  $immediateSendMatch = [regex]::Match($existingThreadSendMatch.Value, "const\s+reusedOptimisticMessageId[\s\S]*$")
  Assert-True ($immediateSendMatch.Success) "could not find existing-thread immediate-send path"
  Assert-True ($immediateSendMatch.Value -notmatch "runSendPreflightWithBoundedRecovery|await\s+recoverThreadExecutionState") "an active-thread send must reach durable runtime/send without a separate snapshot preflight"
  Assert-True ($immediateSendMatch.Value -match "const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit") "send failure cleanup must preserve the activity that existed at submit time without delaying dispatch"
  $startTurnMatch = [regex]::Match($source, "async\s+function\s+startTurnForThread[\s\S]*?\n\s*async\s+function\s+processQueuedMessages")
  Assert-True ($startTurnMatch.Success) "could not find startTurnForThread source"
  Assert-True ($startTurnMatch.Value -notmatch "ensureThreadResumed") "durable runtime/send must not be blocked by a frontend thread-resume preflight"
  Assert-True ($serverSource -match "startRuntimeTurnRpcWithResume[\s\S]*?thread/resume[\s\S]*?turn/start") "the durable runtime endpoint must resume a missing thread once before retrying turn/start"
  Assert-True ($source -match "const\s+runtimeStateBeforeSubmit\s*=\s*runtimeExecutionStateByThreadId\.value\[threadId\]") "send failure cleanup must capture the authoritative runtime state before optimistic feedback"
  Assert-True ($source -match "const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit") "an active-thread send must preserve its prior activity without a pre-dispatch network read"
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
  Assert-True ($chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_STORAGE_KEY\s*=\s*'codex-web-local\.chat-feedback-metrics\.v1'") "mobile feedback metrics must use a versioned durable storage key"
  Assert-True ($chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_LIMIT\s*=\s*50" -and $chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_TTL_MS\s*=\s*7\s*\*\s*24") "mobile feedback review must remain bounded to fifty samples and seven days"
  Assert-True ($chatFeedbackSource -match "performance\.timeOrigin[\s\S]*?performance\.now\(\)") "mobile feedback timestamps must remain comparable across a WebView reload"
  Assert-True ($chatFeedbackSource -match "p50Ms[\s\S]*?p95Ms[\s\S]*?assistantRenderOverhead") "mobile feedback review must expose P50/P95 stage and render-overhead summaries"
  Assert-True ($chatFeedbackSource -notmatch "\b(prompt|attachments|messageText)\b") "mobile feedback diagnostics must not retain prompt or attachment content"
  Assert-True ($diagnosticsPanelSource -match "MESSAGE_FEEDBACK_MIN_SAMPLE_COUNT\s*=\s*5") "mobile feedback review must not classify a trend before five stage samples"
  Assert-True ($diagnosticsPanelSource -match "stateCommit[\s\S]*?bubbleVisible[\s\S]*?requestDispatched[\s\S]*?serverAcknowledged[\s\S]*?firstAssistantData[\s\S]*?assistantRenderOverhead") "diagnostics must keep the complete local-to-visible response review path"
  Assert-True ($diagnosticsPanelSource -match "消息响应复盘[\s\S]*?P50[\s\S]*?P95[\s\S]*?复盘线") "diagnostics must expose the mobile response review in a user-visible compact surface"
  Assert-True ($source -match "pendingNewThreadPreview\.value\s*=\s*\{[\s\S]*?message:\s*\{[\s\S]*?id:\s*optimisticMessageId") "new-thread sends must publish an immediate in-memory conversation preview"
  Assert-True ($source -match "addOptimisticUserMessage\(threadId,[\s\S]*?messageId:\s*optimisticMessageId") "the real thread must adopt the provisional bubble id instead of creating a duplicate"
  $newThreadSendMatch = [regex]::Match($source, "async\s+function\s+sendMessageToNewThread[\s\S]*?\n\s*function\s+clearPendingNewThreadPreview")
  Assert-True ($newThreadSendMatch.Success) "could not find new-thread send source"
  Assert-True ($newThreadSendMatch.Value -notmatch "\bstartThread\(") "new-thread delivery must enter durable runtime/send before any fallible thread/start preflight"
  Assert-True ($newThreadSendMatch.Value -match "putMessageOutboxEntry[\s\S]*?startRuntimeTurnWithBoundedRecovery") "new-thread delivery must persist the outbox before dispatching durable runtime/send"
  Assert-True ($newThreadSendMatch.Value -match "putMessageOutboxEntry[\s\S]*?notifyPendingRequestCreated\(internalOptions\.onPendingRequestCreated,\s*clientMessageId\)[\s\S]*?startRuntimeTurnWithBoundedRecovery") "new-thread delivery must register its stable client id with the native monitor before runtime/send can be suspended"
  Assert-True ($appSource -match "onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)") "the Android shell must force provisional task sync at submit time"
  Assert-True ($source -match "function\s+latestTaskPetClientMessageId[\s\S]*?outboxClientIdByOptimisticMessageId[\s\S]*?clientMessageId:\s*clientMessageId\s*\|\|\s*undefined") "existing-thread task handoff must carry the current durable client message id"
  Assert-True ($existingThreadSendMatch.Value -match "beginChatFeedbackMetric\([\s\S]*?notifyPendingRequestCreated\(internalOptions\.onPendingRequestCreated,\s*clientMessageId\)[\s\S]*?const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit[\s\S]*?startTurnForThread") "existing-thread native handoff must happen before immediate durable runtime dispatch"
  Assert-True ($appSource -match "onDeliveryPersisted:[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:") "existing-thread sends must force native monitoring without delaying runtime dispatch"
  Assert-True ($appSource -match '@quote="onQuoteQueuedMessage"') "queued-message immediate execution must use the Android-aware submit wrapper"
  Assert-True ($source -match "async\s+function\s+quoteQueuedMessage\([\s\S]*?internalOptions[\s\S]*?sendMessageToSelectedThread\([\s\S]*?internalOptions") "queued-message immediate execution must forward submit timing and native handoff callbacks"
  $quoteQueuedMessageMatch = [regex]::Match($source, "async\s+function\s+quoteQueuedMessage[\s\S]*?\n\s*return\s+\{")
  Assert-True ($quoteQueuedMessageMatch.Success) "could not find queued-message immediate execution source"
  Assert-True ($quoteQueuedMessageMatch.Value -match "if\s*\(!msg\s*\|\|\s*isUpdatingSpeedMode\.value\)\s*return[\s\S]*?removeQueuedMessageByThreadId") "queued-message ownership transfer must not remove the row when speed-mode switching would reject the send"
  Assert-True ($quoteQueuedMessageMatch.Value -match "removeQueuedMessageByThreadId\(threadId,\s*messageId\)[\s\S]*?await\s+sendMessageToSelectedThread") "queued-message immediate execution must transfer ownership to the durable outbox before the network await"
  Assert-True ($quoteQueuedMessageMatch.Value -notmatch "Keep the queued message") "a failed immediate execution must not retain a second queue owner beside its recovery bubble"
  Assert-True ($appSource -match "function\s+onQuoteQueuedMessage\([\s\S]*?feedbackStartedAtMs:\s*chatFeedbackNow\(\)[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)") "queued-message immediate execution must hand native monitoring ownership over before requesting notification permission"
  Assert-True ($source -match "export\s+function\s+useDesktopState\(submitCallbacks") "all internal send entry points must share one submit-time native handoff contract"
  Assert-True ($source -match "function\s+notifyPendingRequestCreated[\s\S]*?override\s*\?\?\s*submitCallbacks\.onPendingRequestCreated[\s\S]*?function\s+requestDispatchedCallback[\s\S]*?override\s*\?\?\s*submitCallbacks\.onRequestDispatched") "internal retries and rollback resend must inherit the App-level native handoff callbacks when they do not supply an override"
  Assert-True ($appSource -match "useDesktopState\(\{[\s\S]*?onDeliveryPersisted:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)") "the App must install native monitoring callbacks for retries, rollback resend, and automatic queue execution"
  $processQueuedMessagesMatch = [regex]::Match($source, "async\s+function\s+processQueuedMessages[\s\S]*?\n\s*async\s+function\s+interruptSelectedThreadTurn")
  Assert-True ($processQueuedMessagesMatch.Success) "could not find automatic queued-message execution source"
  Assert-True ($processQueuedMessagesMatch.Value -match "notifyPendingRequestCreated\(undefined,\s*next\.clientMessageId\)[\s\S]*?await\s+startTurnForThread") "automatic queued-message execution must hand the stable client id to Android before the network await"
  Assert-True ($processQueuedMessagesMatch.Value -match "clientMessageId:\s*next\.clientMessageId[\s\S]*?onRequestDispatched:\s*submitCallbacks\.onRequestDispatched") "automatic queued-message execution must preserve request-dispatched notification ownership"
  Assert-True ($source -match "function\s+latestTaskPetClientMessageId[\s\S]*?queueProcessingByThreadId\.value\[threadId\][\s\S]*?queuedMessagesByThreadId\.value\[threadId\][\s\S]*?clientMessageId") "native task sync must expose the stable id of an automatically promoted queue row"
  Assert-True ($appSource -match "const\s+ownsSyncSlot\s*=\s*!mobileShellTaskPetSyncInFlight[\s\S]*?if\s*\(!ownsSyncSlot\s*&&\s*!force\)") "an immediate send handoff must bypass an older renderer sync already awaiting its bridge response"
  Assert-True ($source -match "setQueuedMessagesForThread\(threadId,\s*nextQueue\)[\s\S]*?notifyDeliveryPersisted\(internalOptions\.onDeliveryPersisted\)[\s\S]*?await\s+recoverThreadExecutionState") "queued delivery must be persisted before contextual notification permission work begins"
  Assert-True ($functionMatch.Value -match "const\s+runtimeRequest\s*=\s*startRuntimeThreadTurn\(args\)[\s\S]*?onRequestDispatched\?\.\(\)[\s\S]*?await\s+runtimeRequest") "contextual permission work must begin only after runtime/send has been dispatched"
  Assert-True ($appSource -match "onDeliveryPersisted:[\s\S]*?ensureMobileShellTaskNotificationPermission[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission") "existing-thread queue and immediate sends must use their respective durable or dispatched permission boundaries"
  Assert-True ($appSource -match "onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission") "new-thread sends must register provisional native tracking before requesting permission after runtime/send dispatch"
  Assert-True ($androidPluginSource -match '@Permission\(alias\s*=\s*"notifications",\s*strings\s*=\s*\{\s*Manifest\.permission\.POST_NOTIFICATIONS\s*\}\)') "Android notification permission must use a Capacitor permission alias"
  Assert-True ($androidPluginSource -match 'requestPermissionForAlias\("notifications",\s*call,\s*"notificationPermissionAfterRequest"\)[\s\S]*?@PermissionCallback[\s\S]*?notificationPermissionAfterRequest[\s\S]*?buildNotificationPermissionResult\(true\)') "the native permission Promise must resolve from the Android result callback"
  Assert-True ($androidConfigSource -match 'PREF_NOTIFICATION_AUTO_REQUESTED') "the one-time contextual notification prompt marker must live in native app storage"
  Assert-True ($androidPluginSource -match 'getBoolean\(MobileShellConfig\.PREF_NOTIFICATION_AUTO_REQUESTED,\s*false\)[\s\S]*?putBoolean\(MobileShellConfig\.PREF_NOTIFICATION_AUTO_REQUESTED,\s*true\)') "automatic notification permission requests must be attempted only once per app install"
  Assert-True ($androidPluginSource -match 'permissionState\s*!=\s*PermissionState\.DENIED[\s\S]*?openTaskNotificationSettings\(\)') "manual recovery must open Android settings after a permanent denial, system-level disable, or completion-channel block"
  Assert-True ($androidPluginSource -match 'ACTION_APP_NOTIFICATION_SETTINGS[\s\S]*?EXTRA_APP_PACKAGE') "manual notification recovery must target this app's notification settings"
  Assert-True ($androidPluginSource -match 'completionChannelEnabled[\s\S]*?isCompletionNotificationChannelEnabled') "the Android bridge must report the task-completion channel separately from app-level permission"
  Assert-True ($androidTaskPetSource -match 'getNotificationChannel\(COMPLETION_CHANNEL_ID\)[\s\S]*?IMPORTANCE_NONE') "native completion delivery must detect a user-blocked Android channel"
  Assert-True ($androidPluginSource -match 'ACTION_CHANNEL_NOTIFICATION_SETTINGS[\s\S]*?EXTRA_CHANNEL_ID[\s\S]*?COMPLETION_CHANNEL_ID') "manual recovery must target the exact disabled task-completion channel"
  Assert-True ($appSource -match '任务完成通道已关闭[\s\S]*?completionChannelEnabled\s*===\s*false') "mobile settings must expose and make a disabled completion channel recoverable"
  Assert-True ($appSource -match 'function\s+onWindowFocusRefreshAccountState[\s\S]*?refreshMobileShellNotificationPermission\(\)') "returning from Android notification settings must refresh the visible permission state"
  Assert-True ($androidManifestSource -match 'android\.permission\.WAKE_LOCK') "screen-off task monitoring must declare the Android wake-lock permission"
  Assert-True ($androidManifestSource -match 'android:foregroundServiceType="specialUse"[\s\S]*?PROPERTY_SPECIAL_USE_FGS_SUBTYPE[\s\S]*?user-initiated AI task progress monitoring') "long-running task monitoring must use an accurately described special-use foreground service"
  Assert-True ($androidManifestSource -match 'TaskPetOverlayService[\s\S]*?android:stopWithTask="false"') "removing the Android recent task must not stop the native task monitor"
  Assert-True ($androidManifestSource -notmatch 'android:foregroundServiceType="dataSync"') "task monitoring must not regress onto the Android 15 six-hour data-sync foreground-service quota"
  Assert-True ($androidManifestSource -match 'TaskPetFirebaseMessagingService[\s\S]*?com\.google\.firebase\.MESSAGING_EVENT') "Android deep-Doze wake must register the Firebase messaging service"
  $mainActivityCreateMatch = [regex]::Match($androidMainActivitySource, 'protected\s+void\s+onCreate[\s\S]*?\n\s*@Override\s*\n\s*protected\s+void\s+onNewIntent')
  Assert-True ($mainActivityCreateMatch.Success -and $mainActivityCreateMatch.Value -match 'captureTaskPetThreadFromIntent\(getIntent\(\)\)[\s\S]*?if\s*\(MobileShellConfig\.getStoredServerUrl\(this\)\.isEmpty\(\)\)') "a cold notification launch must persist its exact thread before an unconfigured server setup can replace the Activity intent"
  $captureTaskPetThreadMatch = [regex]::Match($androidMainActivitySource, 'private\s+void\s+captureTaskPetThreadFromIntent[\s\S]*?\n\s*private\s+void\s+openPendingTaskPetThread')
  Assert-True ($captureTaskPetThreadMatch.Success -and $captureTaskPetThreadMatch.Value -match 'putString\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID[\s\S]*?\.commit\(\)[\s\S]*?if\s*\(saved\)\s*intent\.removeExtra') "notification navigation must be committed before its one-shot intent extra is consumed"
  $openPendingTaskPetThreadMatch = [regex]::Match($androidMainActivitySource, 'private\s+void\s+openPendingTaskPetThread[\s\S]*?\n\s*private\s+void\s+configureWebViewDownloadListener')
  Assert-True ($openPendingTaskPetThreadMatch.Success -and $openPendingTaskPetThreadMatch.Value -match 'getString\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID[\s\S]*?buildAppHashUrl[\s\S]*?getWebView\(\)\.loadUrl\(targetUrl\)' -and $openPendingTaskPetThreadMatch.Value -notmatch 'remove\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID') "WebView dispatch must retain the pending exact-thread navigation until the rendered route acknowledges it"
  $markTaskPetThreadReadMatch = [regex]::Match($androidPluginSource, 'public\s+void\s+markTaskPetThreadRead[\s\S]*?\n\s*private\s+JSObject\s+buildTaskPetStatus')
  Assert-True ($markTaskPetThreadReadMatch.Success -and $markTaskPetThreadReadMatch.Value -match 'shouldAcknowledgePendingTaskPetThreadOpen[\s\S]*?remove\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID\)[\s\S]*?\.commit\(\)') "only the exact thread confirmed visible by the WebView may clear pending notification navigation"
  $visibleThreadAcknowledgementMatch = [regex]::Match($appSource, 'watch\(\s*\(\)\s*=>\s*\[\s*routeThreadId\.value,[\s\S]*?markMobileShellTaskPetThreadRead\(normalizedRouteId\)')
  Assert-True ($visibleThreadAcknowledgementMatch.Success -and $visibleThreadAcknowledgementMatch.Value -match 'displayedThreadMessages\.value\.length' -and $visibleThreadAcknowledgementMatch.Value -match 'isThreadContentSwitching\.value' -and $visibleThreadAcknowledgementMatch.Value -match 'shouldAcknowledgeMobileShellTaskPetThreadOpen\(viewState\)[\s\S]*?acknowledgeMobileShellTaskPetThreadOpen\(normalizedRouteId\)[\s\S]*?shouldMarkMobileShellTaskPetThreadRead\(\{\s*\.\.\.viewState,\s*inProgress\s*\}\)[\s\S]*?markMobileShellTaskPetThreadRead\(normalizedRouteId\)') "visible thread content must acknowledge navigation before terminal read cleanup, while empty or switching routes remain unacknowledged"
  $nativeReadCleanupMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+clearCompletedThread[\s\S]*?\n\s*private\s+int\s+expandedPanelOffset')
  Assert-True ($nativeReadCleanupMatch.Success -and $nativeReadCleanupMatch.Value -match 'isActiveTaskState\(task\.state\)[\s\S]*?task\.readAcknowledged\s*=\s*true[\s\S]*?persistTasksSynchronously\(\)' -and $androidTaskPetSource -match 'put\("readAcknowledged",\s*task\.readAcknowledged\)' -and $androidTaskPetSource -match 'sameGeneration[\s\S]*?previous\.readAcknowledged') "a visible-thread read acknowledgement must survive the short frontend/native terminal race for the same task generation"
  Assert-True ($androidTaskPetPolicySource -match 'shouldRetainUnreadSettledTask[\s\S]*?return\s+!readAcknowledged' -and $androidTaskPetSource -match 'shouldRetainUnreadSettledTask\([\s\S]*?task\.readAcknowledged[\s\S]*?if\s*\(retainUnreadCompletion\)[\s\S]*?notifyTaskSettled[\s\S]*?else\s*\{[\s\S]*?tasksToRemove\.add\(task\)[\s\S]*?suppressed_read') "only unread terminal tasks may remain in the pet and post a completion notification"
  Assert-True ($androidPushServiceSource -match 'getPriority\(\)\s*==\s*RemoteMessage\.PRIORITY_HIGH[\s\S]*?isTrackedActiveThread[\s\S]*?shouldWakeForMobilePush') "FCM may cold-wake the monitor only for a delivered high-priority push that matches a tracked task"
  Assert-True ($androidPushServiceSource -match 'claimPushEvent\(this,\s*threadId,\s*eventSeq\)' -and $androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_EVENT_SEQS_JSON[\s\S]*?sha256\(normalizedThreadId\)[\s\S]*?readActiveThreadIds') "FCM dedupe must remain per-thread so one completed task cannot suppress another task's older terminal event"
  Assert-True ($androidPushServiceSource -match 'isPushEventClaimed\(this,\s*threadId,\s*eventSeq\)[\s\S]*?wakeFromMobilePush\(this,\s*threadId,\s*eventSeq,\s*highPriority\)[\s\S]*?if\s*\(!started\)[\s\S]*?"wake_failed"[\s\S]*?return;[\s\S]*?claimPushEvent\(this,\s*threadId,\s*eventSeq\)') "FCM event dedupe must commit only after the native foreground monitor starts successfully"
  Assert-True ($androidPushServiceSource -match 'hasPendingPushAcknowledgement[\s\S]*?retryPendingAcknowledgementAsync[\s\S]*?"ack_retry"' -and $androidPushServiceSource -match 'shouldRestartClaimedMobilePush\(claimed,\s*serviceRunning\)[\s\S]*?wakeFromMobilePush') "a locally reconciled terminal push must retry only its acknowledgement, while a claimed pre-snapshot wake may restart a dead monitor"
  Assert-True ($androidTaskPetSource -match 'notifyTaskSettled\(task,[\s\S]*?MobilePushRegistration\.acknowledgeTerminalAsync\([\s\S]*?task\.lastEventSeq') "Android must acknowledge a terminal push only after authoritative terminal reconciliation and its completion-notification attempt"
  Assert-True ($androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_PENDING_ACKS_JSON[\s\S]*?/codex-api/mobile-push/ack' -and $androidPushRegistrationSource -match 'persistAcknowledgedEventSeq\(context,\s*threadId,\s*eventSeq\)[\s\S]*?clearPendingAcknowledgements\(context,\s*threadId,\s*eventSeq\)') "device acknowledgements must survive process loss and clear locally only after authenticated 7420 acceptance"
  $terminalAcknowledgementMatch = [regex]::Match($androidPushRegistrationSource, 'static\s+void\s+acknowledgeTerminalAsync[\s\S]*?\n\s*static\s+void\s+retryPendingAcknowledgementAsync')
  Assert-True ($terminalAcknowledgementMatch.Success -and $terminalAcknowledgementMatch.Value -match 'shouldPersistMobilePushAcknowledgement[\s\S]*?persistPendingAcknowledgement[\s\S]*?submitPendingAcknowledgementAsync') "a claimed terminal push must persist its acknowledgement even if the cached FCM token is temporarily missing"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPersistMobilePushAcknowledgement[\s\S]*?hasStoredToken\s*\|\|\s*pushEventClaimed\s*\|\|\s*acknowledgementPending') "ordinary completions without push readiness must not accumulate orphan acknowledgement work"
  Assert-True ($appSource -match "wake_restarted[\s\S]*?最近已恢复同步[\s\S]*?ack_retry[\s\S]*?回执重试中") "mobile settings must distinguish recovered monitor wake from a locally complete acknowledgement retry"
  Assert-True ($androidPushRegistrationSource -match '/codex-api/mobile-push/register[\s\S]*?threadIds[\s\S]*?PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE') "Android push registration must stay scoped to active thread subscriptions and dedupe unchanged registrations"
  Assert-True ($androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_LAST_ATTEMPT_SIGNATURE[\s\S]*?shouldThrottleMobilePushRegistration[\s\S]*?shouldSkipFreshMobilePushRegistration' -and $androidTaskPetPolicySource -match 'sameAttemptSignature[\s\S]*?elapsedSinceAttemptMs\s*<\s*retryThrottleMs') "a changed active-thread subscription must bypass the repeated-registration retry throttle"
  Assert-True ($androidConfigSource -match 'PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS' -and $androidPushRegistrationSource -match 'TOKEN_RETRY_THROTTLE_MS\s*=\s*30_000L[\s\S]*?TOKEN_REFRESH_IN_FLIGHT[\s\S]*?shouldThrottleMobilePushTokenRefresh') "Firebase token acquisition failures must use persistent bounded retry and in-flight deduplication"
  Assert-True ($androidPushRegistrationSource -match 'ensureTokenAndSyncAsync[\s\S]*?FirebaseApp\.getApps[\s\S]*?refreshToken\(appContext\)[\s\S]*?syncStoredTokenAsync\(appContext\)' -and ([regex]::Matches($androidTaskPetSource, 'MobilePushRegistration\.ensureTokenAndSyncAsync\(this\)').Count -ge 2)) "the active native monitor must recover a missing FCM token at startup and after authoritative snapshots"
  Assert-True ($serverMobilePushSource -match "isMobilePushTerminalEvent[\s\S]*?turn/completed[\s\S]*?listMobilePushRegistrationsForThread") "the server must send push only from terminal events to registrations subscribed to that thread"
  $latePushRegistrationMatch = [regex]::Match($serverMobilePushSource, 'register\(payload:[\s\S]*?\n\s*unregister\(payload:')
  Assert-True ($latePushRegistrationMatch.Success -and $latePushRegistrationMatch.Value -match 'upsertMobilePushRegistration[\s\S]*?getSnapshot[\s\S]*?isMobilePushTerminalSnapshot[\s\S]*?listEventsAfter[\s\S]*?enqueueTerminalDelivery') "a late active-thread registration must recover the current persisted terminal event"
  $terminalSnapshotMatch = [regex]::Match($serverMobilePushSource, 'function\s+isMobilePushTerminalSnapshot[\s\S]*?\n\}')
  Assert-True ($terminalSnapshotMatch.Success -and $terminalSnapshotMatch.Value -notmatch "running|starting|waiting_permission") "late registration catch-up must reject an older terminal event when the current thread snapshot is active"
  Assert-True ($serverMobilePushSource -match "kind:\s*'task_terminal'[\s\S]*?threadId:[\s\S]*?eventSeq:[\s\S]*?android:[\s\S]*?priority:\s*'high'" -and $serverMobilePushSource -notmatch "createFcmTerminalMessage[\s\S]{0,900}(latestReply|prompt|cookie|serverUrl)") "FCM terminal payload must be high priority and content-free"
  Assert-True ($runtimeStoreSource -match 'CREATE TABLE IF NOT EXISTS mobile_push_outbox[\s\S]*?token_hash[\s\S]*?delivery_key[\s\S]*?next_attempt_at_iso' -and $runtimeStoreSource -notmatch 'CREATE TABLE IF NOT EXISTS mobile_push_outbox[\s\S]{0,900}(params_json|prompt|latest_reply|server_url|authorization)') "terminal push work must be durable without persisting conversation content or credentials"
  Assert-True ($serverMobilePushSource -match 'MOBILE_PUSH_RETRY_DELAYS_MS\s*=\s*\[1_000,\s*5_000,\s*15_000,\s*60_000,\s*5\s*\*\s*60_000,\s*15\s*\*\s*60_000\]' -and $serverMobilePushSource -match 'enqueueMobilePushDelivery[\s\S]*?retryPendingDeliveries[\s\S]*?rescheduleMobilePushDelivery') "transient terminal push failures must enter the durable bounded-backoff worker"
  Assert-True ($serverMobilePushSource -match 'sendTerminalEvent[\s\S]*?markMobilePushProviderAccepted' -and $serverMobilePushSource -notmatch 'sendTerminalEvent[\s\S]{0,900}markMobilePushDelivery') "FCM HTTP acceptance must retain the outbox until the device confirms authoritative terminal processing"
  Assert-True ($serverMobilePushRoutesSource -match '/codex-api/mobile-push/ack[\s\S]*?mobilePushCoordinator\.acknowledge' -and $runtimeStoreSource -match 'acknowledgeMobilePushDeliveries[\s\S]*?app_instance_id[\s\S]*?event_seq\s*<=\s*@eventSeq[\s\S]*?DELETE FROM mobile_push_outbox') "the authenticated device acknowledgement must atomically settle only that app instance's observed thread events"
  Assert-True ($runtimeStoreSource -match 'CREATE TABLE IF NOT EXISTS mobile_push_device_acknowledgements[\s\S]*?PRIMARY KEY \(app_instance_id, thread_id\)' -and $runtimeStoreSource -match 'enqueueMobilePushDelivery[\s\S]*?mobile_push_device_acknowledgements[\s\S]*?acknowledgement\.event_seq\s*>=\s*@eventSeq') "a device acknowledgement that wins the terminal-event enqueue race must durably suppress that stale wake"
  Assert-True ($runtimeStoreSource -match "last_error='awaiting_device_ack'" -and $serverMobilePushSource -match 'awaitingDeviceAckCount') "push diagnostics must distinguish provider-accepted work still waiting for device processing"
  Assert-True ($androidBackgroundVerifierSource -match 'RequireDeviceAcknowledgement[\s\S]*?terminalToAcknowledgementMs[\s\S]*?deviceAcknowledgementSucceeded') "physical Doze verification must enforce and time the device acknowledgement boundary"
  Assert-True ($androidTaskPetSource -match 'replyEventCount[\s\S]*?replySnapshotApplyCount[\s\S]*?replyRenderCount[\s\S]*?lastReplyRenderedAtMs' -and $androidBackgroundVerifierSource -match 'RequireLiveReplyUpdate[\s\S]*?replyEventToRenderMs[\s\S]*?MaxReplyRenderLatencyMs') "physical mobile verification must prove reply event, authoritative snapshot application, and visible overlay rendering without storing reply content"
  Assert-True ($codexBridgeSource -match 'mobilePushCoordinator\.start\(\)' -and $codexBridgeDisposeSource -match 'mobilePushCoordinator\.dispose\(\)[\s\S]*?runtimeStore\.close\(\)') "7420 restart recovery must start the push worker and stop it before closing Runtime Store"
  Assert-True ($appSource -match '深度休眠通知[\s\S]*?mobileShellDeepSleepPushLabel') "mobile settings must expose whether deep-Doze terminal wake is ready"
  Assert-True (
    ($mobilePushReadinessSource -match 'android[\\/]+app[\\/]+google-services\.json') -and
    ($mobilePushReadinessSource -match 'GOOGLE_APPLICATION_CREDENTIALS') -and
    ($mobilePushReadinessSource -match 'firebaseProjectMatch') -and
    ($mobilePushReadinessSource -match '/codex-api/mobile-push/status') -and
    ($mobilePushReadinessSource -match 'registrationCount[\s\S]*?subscribedRegistrationCount')
  ) "deep-Doze readiness must verify both Firebase configurations, project identity, live server state, device registration, and active subscription"
  Assert-True (
    ($mobilePushReadinessSource -match 'requireConfiguration[\s\S]*?requireReady') -and
    ($mobilePushReadinessTestSource -match "serialized\.includes\('PRIVATE KEY'\),\s*false") -and
    ($mobilePushReadinessTestSource -match "serialized\.includes\('fixture@'\),\s*false") -and
    ($mobilePushReadinessTestSource -match 'serialized\.includes\(projectId\),\s*false')
  ) "mobile push readiness gates must stay strict without exposing private keys, service-account email, or Firebase project identity"
  Assert-True ($androidTaskPetSource -match 'PowerManager\.PARTIAL_WAKE_LOCK[\s\S]*?taskWakeLock\.acquire\(remainingMs\)') "active native task monitoring must use a timeout-bounded partial wake lock"
  Assert-True ($androidTaskPetSource -match 'shouldHoldWakeLock\(activeTaskCount\(\)\)[\s\S]*?releaseTaskWakeLock\(\)') "the task wake lock must be released when no active task remains"
  Assert-True ($androidNoProgressReviewSource -match 'INITIAL_REMINDER_MS\s*=\s*10\s*\*\s*60_000L') "native long-task review must begin after ten minutes without progress"
  Assert-True ($androidNoProgressReviewSource -match 'REVIEW_INTERVAL_MS\s*=\s*20\s*\*\s*60_000L') "native long-task review must repeat at a bounded twenty-minute cadence"
  Assert-True ($androidTaskPetSource -match 'lastNoProgressReminderAtMs[\s\S]*?put\("lastNoProgressReminderAtMs"') "no-progress reminder deduplication must survive service restarts"
  Assert-True ($androidTaskPetSource -match 'notifyTaskNoProgress\(task,\s*notificationKey,\s*now\)[\s\S]*?lastNoProgressReminderAtMs\s*=\s*now') "native long-task review must persist the actual reminder time for periodic review"
  Assert-True ($androidNoProgressReviewSource -match 'CHANNEL_ID[\s\S]*?NotificationManager\.IMPORTANCE_DEFAULT') "no-progress attention must use a separate default-importance notification channel"
  Assert-True ($androidTaskPetSource -match 'notifyTaskSettled[\s\S]*?TaskPetNoProgressReviewReceiver\.cancelNotification') "completion must supersede a stale no-progress reminder"
  Assert-True ($androidManifestSource -match 'TaskPetNoProgressReviewReceiver[\s\S]*?android:exported="false"') "the idle review alarm receiver must be explicit and unavailable to other apps"
  Assert-True ($androidNoProgressReviewSource -match 'setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP' -and $androidManifestSource -notmatch 'SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM') "screen-off reviews must use an inexact idle-safe alarm without exact-alarm access"
  Assert-True ($androidNoProgressReviewSource -match 'PREF_TASK_PET_TASKS_JSON[\s\S]*?shouldNotifyNoProgress[\s\S]*?lastNoProgressReminderAtMs[\s\S]*?\.commit\(\)[\s\S]*?scheduleNext') "process-death review must deduplicate from the persisted task snapshot before scheduling again"
  $persistedReviewMatch = [regex]::Match($androidNoProgressReviewSource, 'private\s+static\s+void\s+reviewPersistedTasks[\s\S]*?\n\s*private\s+static\s+long\s+findEarliestReviewAtMs')
  Assert-True ($persistedReviewMatch.Success -and $persistedReviewMatch.Value -match '\.commit\(\);[\s\S]*?notifyNoProgress\(') "process-death review must commit its reminder watermark before alerting"
  Assert-True ($androidTaskPetSource -match 'persistTasks[\s\S]*?TaskPetNoProgressReviewReceiver\.scheduleNext') "every authoritative native task snapshot must reconcile the next idle review"
  Assert-True ($androidNoProgressReviewSource -notmatch 'HttpURLConnection|/codex-api|startForegroundService|ContextCompat\.startForegroundService') "the idle review receiver must not access the network or start a killed foreground service"
  Assert-True ($appSource -match '连续 10 分钟无新进展时首次提醒，之后约每 20 分钟复盘一次，有进展后重新计时。省电模式可能延后提醒') "mobile settings must explain the approximate long-task reminder cadence"
  Assert-True ($androidPluginSource -match 'ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS[\s\S]*?isIgnoringBatteryOptimizations\(getContext\(\)\.getPackageName\(\)\)') "Android runtime info and its manual recovery action must expose the Doze allowlist boundary"
  Assert-True ($appSource -match '后台运行[\s\S]*?mobileShellBackgroundRuntimeLabel[\s\S]*?调整后台运行') "mobile settings must make the background execution restriction visible and actionable"
  Assert-True ($appSource -match 'function\s+onWindowFocusRefreshAccountState[\s\S]*?refreshMobileShellRuntimeInfo\(\)') "returning from Android background settings must refresh the visible runtime state"
  Assert-True ($androidTaskPetSource -match "/codex-api/runtime/request\?clientMessageId=") "the native monitor must look up a provisional client id"
  Assert-True ($androidTaskPetPolicySource -match 'shouldConfirmRuntimeRequest[\s\S]*?!requestAccepted') "every new renderer request must remain confirmation-pending until native acceptance"
  Assert-True ($androidTaskPetSource -match 'shouldConfirmRuntimeRequest\(task\.clientMessageId,\s*task\.requestAccepted\)[\s\S]*?readRuntimeRequest\(task\.clientMessageId\)[\s\S]*?task\.requestAccepted\s*=\s*true') "existing-thread monitoring must confirm the new request before reading a potentially terminal previous-turn snapshot"
  Assert-True ($androidTaskPetSource -match 'put\("requestAccepted",\s*task\.requestAccepted\)') "request acceptance must survive foreground-service recreation"
  Assert-True ($androidTaskPetSource -match 'restoreReplyAttempt\(\)[\s\S]*?ensurePersistedReplyAttemptTask\(\)') "a persisted task-pet reply must be restored into native monitoring after service recreation"
  Assert-True ($androidTaskPetSource -match 'readRuntimeRequest\(replyAttemptClientMessageId\)') "a transport-uncertain native reply must reconcile its original id before any retry"
  Assert-True ($androidTaskPetSource -match 'new ReplyResult\(true,\s*"start_uncertain"') "a lost native send response must remain confirmation-pending instead of becoming a definite failure"
  Assert-True ($androidTaskPetSource -match 'REPLY_CONFIRMATION_MISSING_LIMIT\s*=\s*3[\s\S]*?shouldRequireManualReplyRetry') "a missing native reply request must cross a bounded authoritative confirmation window before manual retry"
  Assert-True ($androidTaskPetSource -match 'task\.state\s*=\s*"retry"[\s\S]*?prepareReplyAttemptForFreshRetry\(\)[\s\S]*?notifyReplyNeedsRetry') "an unconfirmed native reply must stop background monitoring, retain a fresh manual retry, and notify the user"
  Assert-True ($androidTaskPetPolicySource -match 'isActiveTaskState[\s\S]*?"running"\.equals\(state\)[\s\S]*?"waiting"\.equals\(state\)') "manual-retry reply rows must not hold the wake lock or continue polling forever"
  Assert-True ($androidTaskPetSource -match "task\.threadId\s*=\s*request\.threadId") "the native monitor must adopt the authoritative thread returned for a provisional task"
  Assert-True ($androidTaskPetSource -match "threadId\.isEmpty\(\)\s*&&\s*previous\s*!=\s*null[\s\S]*?previous\.threadId") "a stale provisional renderer snapshot must not erase a thread id already resolved by the native monitor"
  Assert-True ($androidTaskPetSource -match "/codex-api/runtime/snapshots\?threadIds=") "the native monitor must continue with batch thread snapshot polling after resolution"
  Assert-True ($androidPluginSource -match 'previousActiveTasksJson[\s\S]*?PREF_TASK_PET_ACTIVE_TASKS_JSON[\s\S]*?countTrackedActiveTasks\(tasksJson,\s*previousActiveTasksJson\)') "the active-to-empty frontend transition must preserve the immediately preceding task snapshot while the native service starts"
  Assert-True ($androidPluginSource -match 'countTrackedActiveTasks[\s\S]*?PREF_TASK_PET_TASKS_JSON[\s\S]*?countActiveTaskRows') "an empty frontend snapshot must not stop a native-owned active task before authoritative reconciliation"
  Assert-True ($androidTaskPetPolicySource -match 'shouldRetainOmittedTask[\s\S]*?"running"\.equals\(state\)[\s\S]*?"waiting"\.equals\(state\)[\s\S]*?"completed"\.equals\(state\)') "frontend omission must retain active and unread-completed native task records"
  Assert-True ($androidTaskPetSource -match 'OMITTED_PROVISIONAL_MISSING_LIMIT\s*=\s*3[\s\S]*?"not_found"\.equals\(result\.executionState\)[\s\S]*?shouldDropOmittedProvisional') "an omitted threadless request must require repeated authoritative not-found results before cleanup"
  Assert-True ($androidTaskPetSource -match 'removeTaskFromFrontendActiveSnapshot\(task\)[\s\S]*?notifyTaskSettled') "native terminal settlement must remove the stale frontend-active preference before emitting completion attention"
  Assert-True ($source -match 'activeTaskPetItems[\s\S]*?activityId:\s*activity\?\.activityId[\s\S]*?startedAtMs:[\s\S]*?lastEventSeq:') "task-pet snapshots must carry the renderer activity generation and authoritative event sequence"
  Assert-True ($appSource -match 'activityId:\s*item\.activityId[\s\S]*?startedAtMs:\s*item\.startedAtMs[\s\S]*?lastEventSeq:\s*item\.lastEventSeq') "the Android bridge payload must preserve task generation metadata"
  $differentTaskGenerationPolicyMatch = [regex]::Match($androidTaskPetPolicySource, 'static\s+boolean\s+shouldAcceptDifferentTaskGeneration[\s\S]*?\n\s*static\s+boolean\s+shouldWakeForRuntimeEvent')
  Assert-True ($differentTaskGenerationPolicyMatch.Success -and $differentTaskGenerationPolicyMatch.Value -match 'currentStartedAtMs\s*>\s*0L\s*&&\s*incomingStartedAtMs\s*>\s*0L[\s\S]*?incomingStartedAtMs\s*!=\s*currentStartedAtMs[\s\S]*?incomingStartedAtMs\s*>\s*currentStartedAtMs[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>\s*currentEventSeq' -and $differentTaskGenerationPolicyMatch.Value -match 'if\s*\(currentStartedAtMs\s*>\s*0L\)\s*return\s+false;[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>\s*currentEventSeq') "different task generations with known start times must be ordered by start time before event sequence, preventing an old activity from borrowing a newer runtime cursor"
  Assert-True ($androidTaskPetSource -match 'requestedGeneration[\s\S]*?isSameTaskGeneration\([\s\S]*?task\.activityId[\s\S]*?requestedGeneration\.activityId') "a delayed native poll result must be rejected after the same thread advances to a newer activity generation"
  Assert-True ($androidTaskPetSource -match 'eventStreamExecutor\s*=\s*Executors\.newSingleThreadExecutor\(\)[\s\S]*?/codex-api/events[\s\S]*?text/event-stream') "active Android tasks must keep a dedicated native SSE event wake channel"
  Assert-True ($androidTaskPetPolicySource -match 'VISIBLE_REPLY_PROGRESS_THROTTLE_MS\s*=\s*250L[\s\S]*?BACKGROUND_REPLY_PROGRESS_THROTTLE_MS\s*=\s*750L[\s\S]*?eventStreamProgressThrottleMs\(boolean overlayExpanded\)') "expanded reply progress must refresh faster while background monitoring stays bounded"
  Assert-True ($androidTaskPetSource -match 'requestImmediateSnapshotPoll\(boolean urgent\)[\s\S]*?eventDrivenPollPending\s*=\s*true[\s\S]*?eventStreamProgressThrottleMs\(expanded\)[\s\S]*?schedulePoll\(delayMs\)') "event-driven snapshot refreshes must use the visibility-aware throttle and preserve an in-flight follow-up poll"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPreferReplyCandidate[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>=\s*currentEventSeq[\s\S]*?compareTaskRecency[\s\S]*?Long\.compare\(rightUpdatedAtMs,\s*leftUpdatedAtMs\)') "native reply ordering must prefer the newest authoritative event and newest visible task activity"
  Assert-True ($androidTaskPetSource -match 'next\.sort\(\(left,\s*right\)\s*->[\s\S]*?compareTaskRecency[\s\S]*?tasks\.addAll\(next\)') "frontend task snapshots must preserve newest-progress-first native ordering"
  Assert-True ($androidTaskPetSource -match 'latestReplyCandidate[\s\S]*?shouldPreferReplyCandidate[\s\S]*?pendingReplyRenderTaskKey\s*=\s*taskNotificationKey\(latestReplyCandidate\)[\s\S]*?tasks\.remove\(latestReplyCandidate\)[\s\S]*?tasks\.add\(0,\s*latestReplyCandidate\)') "the task with the newest assistant reply must enter the visible overlay rows before render evidence is committed"
  Assert-True ($androidTaskPetPolicySource -match 'shouldCommitReplyRender[\s\S]*?overlayExpanded[\s\S]*?panelShown[\s\S]*?panelAlpha\s*>\s*0f[\s\S]*?renderedTaskMatchesPendingReply') "reply-render evidence must require an expanded and actually shown overlay panel"
  Assert-True ($androidTaskPetSource -match 'commitPendingReplyRender\(String renderedReplyTaskKey\)[\s\S]*?taskPanel\.isShown\(\)[\s\S]*?taskPanel\.getAlpha\(\)[\s\S]*?replyRenderCount\s*\+=\s*1L' -and $androidTaskPetSource -match 'withEndAction\(\(\)\s*->\s*commitPendingReplyRender\(renderedReplyTaskKey\)\)') "opening a collapsed panel must commit reply-render evidence only after its visible animation completes"
  Assert-True ($taskPetPreviewSource -match 'task-pet-preview-compact[\s\S]*?primaryItem[\s\S]*?\$emit\(''open'',\s*primaryItem\.threadId\)') "the collapsed web task-pet surface must show one latest-reply preview that opens its exact conversation"
  Assert-True ($androidTaskPetSource -match 'buildCompactPreview[\s\S]*?renderCompactPreview[\s\S]*?compactPreviewReply\.setText\(replyPreview\)[\s\S]*?openThread\(task\.threadId\)' -and $androidTaskPetPolicySource -match 'shouldCommitCompactReplyRender[\s\S]*?!overlayExpanded[\s\S]*?!overlayMinimized[\s\S]*?previewShown[\s\S]*?previewAlpha\s*>\s*0f') "the collapsed native task pet must render the newest reply, open its exact thread, and record visibility only while the compact preview is shown"
  Assert-True ($androidTaskPetSource -match 'restorePendingReplyRender\(\)[\s\S]*?PREF_TASK_PET_PENDING_REPLY_RENDER_KEY[\s\S]*?PREF_TASK_PET_PENDING_REPLY_RENDER_EVENT_SEQ' -and $androidTaskPetSource -match 'pendingReplyRenderTaskKey\s*=\s*taskNotificationKey\(latestReplyCandidate\)[\s\S]*?persistPendingReplyRender\(\)' -and $androidTaskPetSource -match 'replyRenderCount\s*\+=\s*1L[\s\S]*?persistPendingReplyRender\(\)') "a collapsed latest-reply render boundary must survive service recreation and clear only after visible render"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPreserveKnownLatestReply[\s\S]*?frontendSnapshot[\s\S]*?sameTaskGeneration[\s\S]*?!currentReply\.isEmpty\(\)[\s\S]*?incomingReplyEventSeq\s*<=\s*0L\s*\|\|\s*incomingReplyEventSeq\s*<=\s*currentReplyEventSeq' -and $androidTaskPetSource -match 'incomingLatestReplyEventSeq[\s\S]*?preserveKnownLatestReply[\s\S]*?resolvedLatestReplyEventSeq[\s\S]*?previous\.latestReplyEventSeq') "an unversioned, equal-version, or older recovering frontend reply must not overwrite a same-generation reply already persisted by the native monitor"
  $nativeSettledStatePolicyMatch = [regex]::Match($androidTaskPetPolicySource, 'static\s+boolean\s+shouldPreserveNativeSettledState[\s\S]*?\n\s*\}')
  Assert-True ($nativeSettledStatePolicyMatch.Success -and $nativeSettledStatePolicyMatch.Value -match 'currentSettled\s*=\s*"completed"\.equals\(currentState\)\s*\|\|\s*"retry"\.equals\(currentState\)[\s\S]*?isActiveTaskState\(incomingState\)' -and $nativeSettledStatePolicyMatch.Value -notmatch 'EventSeq' -and $androidTaskPetSource -match 'shouldPreserveNativeSettledState[\s\S]*?removeTaskFromFrontendActiveSnapshot\(previous\)[\s\S]*?next\.add\(previous\)[\s\S]*?continue;') "a same-generation frontend snapshot must never revive a native completed or manual-retry task, even after later metadata advances the event sequence"
  Assert-True ($androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?replyRenderCount\s*=\s*Math\.max\(0L,\s*previous\.optLong\("replyRenderCount"' -and $androidTaskPetSource -match 'lastCompletionNotificationAttemptAtMs\s*=\s*Math\.max') "reply and terminal verification counters must remain monotonic across service recreation"
  Assert-True ($androidTaskPetSource -match 'removeTaskFromFrontendActiveSnapshot\(task\)[\s\S]*?persistTasksSynchronously\(\)[\s\S]*?notifyTaskSettled\(task') "each terminal task must commit its completed native snapshot before completion attention is posted"
  $removeFrontendActiveSnapshotMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+removeTaskFromFrontendActiveSnapshot[\s\S]*?\n\s*private\s+void\s+markPollUnavailable')
  Assert-True ($removeFrontendActiveSnapshotMatch.Success -and $removeFrontendActiveSnapshotMatch.Value -match 'PREF_TASK_PET_ACTIVE_TASKS_JSON[\s\S]*?\.commit\(\)') "terminal settlement must durably remove its stale frontend-active generation before notification delivery"
  Assert-True ($androidTaskPetSource -match 'completionNotificationAttemptCount\s*\+=\s*1L[\s\S]*?notificationManager\.notify[\s\S]*?completionNotificationPostedCount\s*\+=\s*1L' -and $androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?completionNotificationAttemptCount\s*=\s*Math\.max[\s\S]*?completionNotificationPostedCount\s*=\s*Math\.max') "multi-task completion verification must keep monotonic attempted and posted notification counts across service recreation"
  Assert-True ($androidBackgroundVerifierSource -match 'MinimumTerminalNotificationAttempts[\s\S]*?notificationAttemptDelta[\s\S]*?notificationPostedDelta[\s\S]*?notificationPostedDelta\s*-lt\s*\$MinimumTerminalNotificationAttempts') "physical multi-task completion verification must require every expected notification attempt to be posted"
  Assert-True ($androidTaskPetPolicySource -match 'nextEventDrivenPollDelayMs[\s\S]*?throttleMs\s*-\s*\(nowMs\s*-\s*lastPollAtMs\)' -and $androidTaskPetSource -match 'eventDrivenPollScheduled\s*=\s*true[\s\S]*?schedulePoll\(delayMs\)' -and $androidTaskPetSource -match 'if\s*\(eventDrivenPollScheduled\)[\s\S]*?lastEventDrivenPollAtMs\s*=\s*System\.currentTimeMillis\(\)') "reply events inside the 750 ms throttle window must retain one trailing authoritative snapshot instead of falling through to the 3-second poll"
  Assert-True ($androidTaskPetPolicySource -match 'shouldWakeForRuntimeEvent[\s\S]*?startsWith\("turn/"\)[\s\S]*?startsWith\("thread/"\)[\s\S]*?startsWith\("server/request"\)[\s\S]*?item/agentMessage/delta') "native SSE wake filtering must include assistant progress without treating every server event as task activity"
  Assert-True ($androidTaskPetSource -match 'catch\s*\(Exception ignored\)[\s\S]*?regular bounded poll remains authoritative[\s\S]*?EVENT_STREAM_RETRY_MS') "SSE failure must reconnect with a bounded delay while regular polling remains authoritative"
  Assert-True ($androidManifestSource -match 'android\.permission\.ACCESS_NETWORK_STATE') "native task recovery must declare Android network-state access"
  Assert-True ($androidTaskPetSource -match 'currentDefaultNetwork\s*=\s*connectivityManager\.getActiveNetwork\(\)[\s\S]*?defaultNetworkKnown\s*=\s*true') "native task recovery must establish the initial default network before observing changes"
  Assert-True ($androidTaskPetSource -match 'new\s+ConnectivityManager\.NetworkCallback\(\)[\s\S]*?onAvailable\(Network network\)[\s\S]*?handleDefaultNetworkAvailable\(network\)[\s\S]*?registerDefaultNetworkCallback\(defaultNetworkCallback\)') "native task recovery must observe later default-network availability"
  Assert-True ($androidTaskPetPolicySource -match 'shouldWakeForDefaultNetworkChange[\s\S]*?networkStateKnown\s*&&\s*!sameNetwork\s*&&\s*activeTaskCount\s*>\s*0') "network availability must wake only a known changed network with active tasks"
  Assert-True ($androidTaskPetSource -match 'handleDefaultNetworkAvailable[\s\S]*?requestImmediateSnapshotPoll\(true\)[\s\S]*?restartEventStreamAfterNetworkRecovery') "network recovery must immediately wake the authoritative snapshot and rebuild SSE"
  Assert-True (($androidTaskPetSource -match 'requestImmediateSnapshotPoll[\s\S]*?if\s*\(pollInFlight\)[\s\S]*?eventDrivenPollPending\s*=\s*true') -and ($androidTaskPetSource -match 'if\s*\(eventDrivenPollPending\)[\s\S]*?eventDrivenPollScheduled\s*=\s*true[\s\S]*?nextDelayMs\s*=\s*0L')) "network recovery must coalesce behind an in-flight authoritative snapshot"
  Assert-True ($androidTaskPetSource -match 'onDestroy\(\)[\s\S]*?unregisterDefaultNetworkCallback[\s\S]*?unregisterNetworkCallback') "the default-network callback must be released with the foreground service"
  Assert-True ($androidConfigSource -match 'PREF_TASK_PET_MONITOR_DIAGNOSTICS_JSON') "native task monitoring diagnostics must survive a service/process restart"
  Assert-True ($androidTaskPetSource -match 'persistMonitorDiagnostics[\s\S]*?lastRelevantEventAtMs[\s\S]*?lastEventDrivenPollAtMs[\s\S]*?lastSnapshotSuccessAtMs[\s\S]*?lastTerminalAtMs[\s\S]*?lastCompletionNotificationResult[\s\S]*?lastCompletionNotificationBodySource[\s\S]*?networkRecoveryCount[\s\S]*?lastDefaultNetworkAvailableAtMs') "native task monitoring must retain stream, event, authoritative snapshot, terminal, notification body source, and network-recovery evidence"
  Assert-True ($androidTaskPetSource -match 'boolean\s+hasLatestReply\s*=\s*!task\.latestReply\.isEmpty\(\)[\s\S]*?lastCompletionNotificationBodySource\s*=\s*hasLatestReply\s*\?\s*"latest_reply"\s*:\s*"detail"[\s\S]*?notificationManager\.notify') "completion diagnostics must prove whether the posted notification used the authoritative latest reply without persisting its content"
  $monitorDiagnosticsMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+persistMonitorDiagnostics[\s\S]*?\n\s*private\s+boolean\s+reconcileNoProgressNotifications')
  Assert-True ($monitorDiagnosticsMatch.Success) "could not find native task monitor diagnostics persistence"
  Assert-True ($monitorDiagnosticsMatch.Value -notmatch 'threadId|clientMessageId|latestReply|serverUrl') "native task monitor diagnostics must not persist conversation content, identity, or server addresses"
  Assert-True ($androidPluginSource -match 'monitorRunning[\s\S]*?PREF_TASK_PET_MONITOR_DIAGNOSTICS_JSON[\s\S]*?monitorDiagnostics') "the Android bridge must expose sanitized background-monitor evidence for real-device review"
  $monitorDumpMatch = [regex]::Match($androidTaskPetSource, 'protected\s+void\s+dump[\s\S]*?\n\s*@Override\s*\n\s*public\s+void\s+onDestroy')
  Assert-True ($monitorDumpMatch.Success -and $monitorDumpMatch.Value -match 'CX_CODEX_TASK_PET_DIAGNOSTICS') "adb dumpsys must expose sanitized native monitor evidence without waking the WebView"
  Assert-True ($monitorDumpMatch.Value -notmatch 'threadId|clientMessageId|latestReply|serverUrl') "adb monitor evidence must not expose conversation content, identity, or server addresses"
  Assert-True ($androidBackgroundVerifierSource -match 'ValidateSet\("Snapshot",\s*"Observe",\s*"ScreenOff",\s*"Doze"\)[\s\S]*?\[string\]\$Mode\s*=\s*"Snapshot"') "the Android background verifier must stay read-only unless a disruptive mode is explicit"
  Assert-True ($androidBackgroundVerifierSource -match 'finally\s*\{[\s\S]*?deviceidle",\s*"unforce"[\s\S]*?battery",\s*"reset"[\s\S]*?KEYCODE_WAKEUP') "the Android background verifier must restore forced-idle, battery, and screen state"
  Assert-True ($androidBackgroundVerifierSource -match '\[switch\]\$RequireActiveTask[\s\S]*?\[switch\]\$RequireTerminalNotification[\s\S]*?MaxTerminalNotificationLatencyMs') "the Android background verifier must support explicit active-task and terminal-notification gates"
  Assert-True (
    ($androidBackgroundVerifierSource -match 'noProgressReviewScheduledAtMs[\s\S]*?summary\.json') -and
    ($androidBackgroundVerifierSource -match 'lastCompletionNotificationBodySource[\s\S]*?terminalToNotificationMs[\s\S]*?summary\.json') -and
    ($androidBackgroundVerifierSource -match 'dumpsys",\s*"alarm"[\s\S]*?noProgressReviewAlarm')
  ) "the Android background verifier must summarize scheduled review, alarm registration, content-free notification source, and terminal latency evidence"
  Assert-True ($androidBackgroundVerifierSource -match 'notificationResult\s*-ne\s*"posted"[\s\S]*?notificationBodySource\s*-notin\s*@\("latest_reply",\s*"detail"\)') "strict Android completion verification must reject blocked or retry notifications"
  Assert-True ($androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?START_STICKY' -and $androidTaskPetSource -match 'onTaskRemoved\(Intent\s+rootIntent\)[\s\S]*?taskRemovedCount\s*\+=\s*1L[\s\S]*?persistMonitorDiagnostics\(true\)') "native monitoring must preserve sticky restart and recent-task removal evidence"
  Assert-True ($androidBackgroundVerifierSource -match 'serviceRecreated[\s\S]*?stickyRestartAdvanced[\s\S]*?taskRemovedAdvanced[\s\S]*?RequireTaskRemoval[\s\S]*?RequireStickyRestart') "Android lifecycle verification must summarize and gate task removal and sticky recreation"
  Assert-True ($source -match "internalOptions\.onThreadCreated\?\.\(threadId\)") "new-thread sends must announce the authoritative thread returned by runtime/send"
  Assert-True ($appSource -match "routeToCreatedThreadPromise\s*=\s*navigateToCreatedThread\(threadId\)") "the app must enter a newly created thread while its first turn continues in the background"
  Assert-True ($serverSource -match "const\s+promise\s*=\s*startParsedRuntimeTurnWithAppServer[\s\S]*?getLatestRequestByClientMessageId\(clientMessageId\)[\s\S]*?return\s+runtimeStartResultFromRequest\(accepted\)") "runtime/send must return the durable accepted record without awaiting slow thread/start"
  Assert-True ($serverSource -match "void\s+promise\.then\([\s\S]*?clearInFlightRuntimeStart") "accepted runtime starts must remain owned and deduplicated after the HTTP response"
  Assert-True ($serverSource -match "platform\s*===\s*'win32'[\s\S]*?'features\.shell_snapshot':\s*false") "Windows runtime threads must skip the unsupported shell snapshot startup timeout"
  Assert-True ($runtimeActionSource -match "setJson\(res,\s*isRuntimeStartPending\(result\.status\)\s*\?\s*202" -and $runtimeActionSource -match "status\s*===\s*'pending_start'[\s\S]*?status\s*===\s*'starting'") "accepted pending runtime starts must use HTTP 202"
  Assert-True ($source -match "isRuntimeRequestAwaitingDeliveryConfirmation\(runtimeResult\.status\)[\s\S]*?markPendingNewThreadPreviewConfirming[\s\S]*?reconcileAcceptedNewThreadInBackground\(\)[\s\S]*?return\s+''") "a threadless 202 must keep the provisional bubble confirming while background binding continues"
  Assert-True ($source -match "NEW_THREAD_ACCEPTED_RECONCILE_DELAYS_MS[\s\S]*?getRuntimeRequestByClientMessageId\(clientMessageId\)[\s\S]*?recoverRuntimeRequestByClientMessage\(\)") "foreground new-thread binding must use a bounded request lookup schedule"
  Assert-True ($source -match "notification\.method\s*===\s*'turn/started'[\s\S]*?notification\.method\s*===\s*'thread/started'[\s\S]*?recoverPersistentMessageOutbox\(\)") "thread/started must immediately reconcile the durable provisional outbox"
  Assert-True ($appSource -match "if\s*\(!threadId\)\s*\{[\s\S]*?if\s*\(!pendingNewThreadPreview\.value\)[\s\S]*?restoreHomeThreadComposerDraft") "an accepted provisional first message must not be duplicated back into the composer"
  Assert-True ($source -match "markPendingNewThreadPreviewWaiting\(clientMessageId,\s*optimisticMessageId\)[\s\S]*?markPendingNewThreadPreviewFailed\(clientMessageId,\s*optimisticMessageId\)") "threadless transport failures must wait for reconnect while definitive failures remain actionable"
  Assert-True ($source -match "async\s+function\s+retryFailedNewThreadMessage[\s\S]*?reuseOptimisticMessageId:\s*messageId") "threadless manual retry must reuse the same visual message id"
  Assert-True ($source -match "function\s+takeFailedNewThreadMessageForEditing[\s\S]*?removeMessageOutboxEntry\(entry\.clientMessageId\)[\s\S]*?pendingNewThreadPreview\.value\s*=\s*null") "editing a failed threadless message must atomically leave preview mode and clear its outbox attempt"
  Assert-True ($source -match "if\s*\(newestDraftEntry\)\s*\{\s*restoreFailedNewThreadOutboxEntry\(newestDraftEntry\)") "restart recovery must restore a failed new-thread bubble instead of silently moving it back to the composer"
  Assert-True ($appSource -match 'data-testid="pending-new-thread-preview"[\s\S]*?:messages="\[pendingNewThreadPreview\.message\]"') "the home route must render the provisional first turn as a conversation"
  Assert-True ($appSource -match ':is-turn-in-progress="pendingNewThreadPreview\.liveOverlay\s*!==\s*null"') "a waiting new-thread preview must not retain a stale running overlay"
  Assert-True ($functionSource -match "markChatFeedbackRequestDispatched\(args\.clientMessageId\)") "runtime sends must mark the first request dispatch"
  Assert-True ($functionSource -match "markChatFeedbackServerAcknowledged\(\{[\s\S]*?clientMessageId:\s*args\.clientMessageId,[\s\S]*?threadId:\s*result\.threadId\s*\|\|\s*feedback\.threadId\s*\|\|\s*PENDING_NEW_THREAD_ID") "a successful threadless 202 response must record durable server acknowledgement before turn identity is available"
  Assert-True ($functionSource -match "if\s*\(recovered\)[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?threadId:\s*recovered\.threadId\s*\|\|\s*feedback\.threadId\s*\|\|\s*PENDING_NEW_THREAD_ID") "runtime-request recovery must record durable server acknowledgement even before a new thread is bound"
  Assert-True ($source -match "recoverRuntimeRequestByClientMessage[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?clientMessageId,[\s\S]*?threadId:\s*recovered\.threadId[\s\S]*?turnStarted:\s*Boolean\(recovered\.turnId\s*&&\s*!awaitingDeliveryConfirmation\)") "new-thread recovery must restore authoritative acknowledgement and turn-start timing after a lost response"
  Assert-True ($source -match "const\s+startedTurn\s*=\s*readTurnStartedInfo\(notification\)[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?turnStarted:\s*true") "turn/started must mark authoritative server acceptance"
  Assert-True ($source -match "function\s+applyRuntimeSnapshotState[\s\S]*?parseIsoTimestamp\(snapshot\.lastStartedAtIso[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?turnStartedAtMs:\s*authoritativeTurnStartedAtMs") "runtime snapshot recovery must restore turn-start timing when the live notification was missed"
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
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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
  const summary = window.__cxCodexChatFeedbackSummary ?? null;
  const storedRaw = window.localStorage.getItem('codex-web-local.chat-feedback-metrics.v1') || '';
  let storedMetricCount = 0;
  try {
    const stored = JSON.parse(storedRaw || '{}');
    storedMetricCount = Array.isArray(stored.metrics) ? stored.metrics.length : 0;
  } catch {}
  const preview = document.querySelector('[data-testid="pending-new-thread-preview"]');
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return {
    metric,
    summary,
    storedMetricCount,
    storageContainsPrompt: storedRaw.includes('$escapedProbe'),
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
    Assert-True ([int]$metrics.storedMetricCount -eq 1) "new-thread feedback metric was not persisted"
    Assert-True ([int]$metrics.summary.sampleCount -eq 1) "new-thread feedback summary did not include the isolated sample"
    Assert-True ([int]$metrics.summary.stages.stateCommit.p50Ms -eq [int]$metrics.metric.stateCommitLatencyMs) "new-thread feedback state-commit P50 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.stateCommit.p95Ms -eq [int]$metrics.metric.stateCommitLatencyMs) "new-thread feedback state-commit P95 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.bubbleVisible.p50Ms -eq [int]$metrics.metric.bubbleVisibleLatencyMs) "new-thread feedback bubble P50 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.bubbleVisible.p95Ms -eq [int]$metrics.metric.bubbleVisibleLatencyMs) "new-thread feedback bubble P95 did not match the isolated sample"
    Assert-True ($metrics.storageContainsPrompt -eq $false) "new-thread feedback diagnostics persisted prompt content"
    Write-Step ("new-thread feedback timing -> " + (@{
      stateCommitMs = [int]$metrics.metric.stateCommitLatencyMs
      bubbleVisibleMs = [int]$metrics.metric.bubbleVisibleLatencyMs
      runningVisibleMs = [int]$metrics.metric.runningVisibleLatencyMs
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-feedback-budget-phone' | Out-Null

    $waitingState = $null
    $waitingScript = @"
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
    for ($attempt = 1; $attempt -le 60; $attempt++) {
      $waitingState = Invoke-BrowserEvalJson -Session $Session -Script $waitingScript
      if (
        [string]$waitingState.deliveryState -eq 'waiting' -and
        [string]$waitingState.outboxState -eq 'waiting'
      ) { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
    }
    Assert-True ([string]$waitingState.deliveryState -eq 'waiting') "threadless transport loss did not keep the original bubble waiting for recovery"
    Assert-True ([string]$waitingState.outboxState -eq 'waiting') "threadless transport loss was removed from the durable outbox"
    Assert-True ([int]$waitingState.retryButtonCount -eq 0) "retryable transport loss was incorrectly presented as a definitive retry action"
    Assert-True ([int]$waitingState.editButtonCount -eq 0) "retryable transport loss was incorrectly presented as a definitive edit action"
    Assert-True ([int]$waitingState.runningCount -eq 0) "threadless waiting state left a false running indicator"
    Assert-True ([int]$waitingState.promptCount -eq 1) "threadless waiting state duplicated or removed the original bubble"
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-offline-waiting-phone' | Out-Null

    $metricClientMessageId = [string]$metrics.metric.clientMessageId
    $safeReloadScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  return { clearedOutbox: true };
})())
'@
    Invoke-BrowserEvalJson -Session $Session -Script $safeReloadScript | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null

    $restoredMetrics = $null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
      $restoredScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.find((row) => row.clientMessageId === '$metricClientMessageId') ?? null;
  const summary = window.__cxCodexChatFeedbackSummary ?? null;
  const storedRaw = window.localStorage.getItem('codex-web-local.chat-feedback-metrics.v1') || '';
  return {
    metric,
    summary,
    storageContainsPrompt: storedRaw.includes('$escapedProbe')
  };
})())
"@
      $restoredMetrics = Invoke-BrowserEvalJson -Session $Session -Script $restoredScript
      if ($null -ne $restoredMetrics.metric -and [int]$restoredMetrics.summary.sampleCount -eq 1) { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
    }
    Assert-True ($null -ne $restoredMetrics.metric) "chat feedback metric did not survive a full page reload"
    Assert-True ([int]$restoredMetrics.summary.sampleCount -eq 1) "chat feedback summary did not rehydrate after a full page reload"
    Assert-True ([int]$restoredMetrics.summary.stages.runningVisible.p95Ms -eq [int]$metrics.metric.runningVisibleLatencyMs) "rehydrated running-feedback P95 changed after reload"
    Assert-True ($restoredMetrics.storageContainsPrompt -eq $false) "rehydrated diagnostics persisted prompt content"
    Write-Step ("new-thread waiting + persisted feedback summary -> " + (@{
      deliveryState = [string]$waitingState.deliveryState
      sampleCount = [int]$restoredMetrics.summary.sampleCount
      bubbleP50Ms = [int]$restoredMetrics.summary.stages.bubbleVisible.p50Ms
      bubbleP95Ms = [int]$restoredMetrics.summary.stages.bubbleVisible.p95Ms
    } | ConvertTo-Json -Compress))
  } finally {
    try { Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null } catch {}
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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

  $probeText = "请只回复：7420-new-thread-handoff-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  const originalFetch = window.fetch.bind(window);
  window.__cxCodexHandoffStartedAt = performance.now();
  window.__cxCodexHandoffServerAccepted = false;
  window.__cxCodexHandoffAcceptedLatencyMs = 0;
  window.__cxCodexHandoffAcceptedHttpStatus = 0;
  window.__cxCodexHandoffSawConfirmingPreview = false;
  delete window.__cxCodexHandoffRouteLatencyMs;
  window.fetch = (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
    if (url.includes('/codex-api/runtime/send')) {
      return originalFetch(input, init).then((response) => {
        window.__cxCodexHandoffServerAccepted = response.ok;
        window.__cxCodexHandoffAcceptedLatencyMs = Math.round(performance.now() - window.__cxCodexHandoffStartedAt);
        window.__cxCodexHandoffAcceptedHttpStatus = response.status;
        return new Promise((_, reject) => {
          window.setTimeout(() => reject(new TypeError('simulated lost runtime response')), 1200);
        });
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
  const metricRows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = metricRows.length > 0 ? metricRows[metricRows.length - 1] : null;
  const currentRouteLatencyMs = Math.round(performance.now() - (window.__cxCodexHandoffStartedAt || performance.now()));
  if (threadId && !Number.isFinite(window.__cxCodexHandoffRouteLatencyMs)) {
    window.__cxCodexHandoffRouteLatencyMs = currentRouteLatencyMs;
  }
  const previewCount = document.querySelectorAll('[data-testid="pending-new-thread-preview"]').length;
  const deliveryState = delivery?.getAttribute('data-state') || '';
  if (!threadId && previewCount === 1 && deliveryState === 'confirming') {
    window.__cxCodexHandoffSawConfirmingPreview = true;
  }
  return {
    threadId,
    routeLatencyMs: Number.isFinite(window.__cxCodexHandoffRouteLatencyMs)
      ? window.__cxCodexHandoffRouteLatencyMs
      : currentRouteLatencyMs,
    promptCount: items.length,
    deliveryState,
    runningCount: document.querySelectorAll('.live-overlay-inline').length,
    previewCount,
    serverAccepted: window.__cxCodexHandoffServerAccepted === true,
    acceptedLatencyMs: window.__cxCodexHandoffAcceptedLatencyMs || 0,
    acceptedHttpStatus: window.__cxCodexHandoffAcceptedHttpStatus || 0,
    sawConfirmingPreview: window.__cxCodexHandoffSawConfirmingPreview === true,
    metric
  };
})())
"@
    $handoff = Invoke-BrowserEvalJson -Session $Session -Script $readScript
    if (
      -not [string]::IsNullOrWhiteSpace([string]$handoff.threadId) -and
      [int]$handoff.promptCount -eq 1 -and
      [string]$handoff.deliveryState -in @('sending', 'retrying', 'confirming', 'sent') -and
      [int]$handoff.metric.serverAcknowledgedLatencyMs -gt 0 -and
      [int]$handoff.metric.turnStartedLatencyMs -gt 0
    ) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }

  $threadId = [string]$handoff.threadId
  try {
    Assert-True (-not [string]::IsNullOrWhiteSpace($threadId)) "new-thread handoff did not enter the authoritative thread"
    Assert-True ($handoff.serverAccepted -eq $true) "new-thread handoff did not simulate a lost response after server acceptance"
    Assert-True ([int]$handoff.acceptedHttpStatus -eq 202) "new-thread handoff was not durably accepted with HTTP 202"
    Assert-True ([int]$handoff.acceptedLatencyMs -gt 0 -and [int]$handoff.acceptedLatencyMs -le 750) "new-thread durable acceptance exceeded the 750 ms browser budget"
    Assert-True ($handoff.sawConfirmingPreview -eq $true) "new-thread handoff did not show a confirming provisional bubble before thread binding"
    Assert-True ([int]$handoff.promptCount -eq 1) "new-thread handoff did not preserve exactly one message bubble"
    Assert-True ([string]$handoff.deliveryState -in @('sending', 'retrying', 'confirming', 'sent')) "new-thread handoff treated a lost accepted response as a definitive failure"
    Assert-True ([int]$handoff.runningCount -ge 1) "new-thread handoff lost the running timeline"
    Assert-True ([int]$handoff.previewCount -eq 0) "new-thread handoff left the provisional home surface mounted"
    Assert-True ([string]$handoff.metric.threadId -eq $threadId) "new-thread handoff metric was not rebound to the authoritative thread"
    Assert-True ([int]$handoff.metric.serverAcknowledgedLatencyMs -gt 0) "new-thread handoff did not retain product-side server acknowledgement timing"
    Assert-True ([int]$handoff.metric.turnStartedLatencyMs -gt 0) "new-thread handoff did not retain product-side turn-start timing"
    Write-Step ("new-thread authoritative handoff -> " + (@{
      threadId = $threadId
      acceptedLatencyMs = [int]$handoff.acceptedLatencyMs
      acceptedHttpStatus = [int]$handoff.acceptedHttpStatus
      routeLatencyMs = [int]$handoff.routeLatencyMs
      serverAcknowledgedLatencyMs = [int]$handoff.metric.serverAcknowledgedLatencyMs
      turnStartedLatencyMs = [int]$handoff.metric.turnStartedLatencyMs
      deliveryState = [string]$handoff.deliveryState
      sawConfirmingPreview = $true
      recoveredAfterLostResponse = $true
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-authoritative-handoff-phone' | Out-Null
  } finally {
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
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
      state: 'failed',
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

  $parts = @($normalized -split '[\\/]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
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

function Get-WorkspaceRootSample {
  param([object]$RootsState)

  $workspaceRoots = @()
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds) + @($RootsState.data.projectOrder) + @($RootsState.data.order)) {
    $normalizedRootPath = [string]$rootPath
    if ([string]::IsNullOrWhiteSpace($normalizedRootPath)) {
      continue
    }
    if ($workspaceRoots -notcontains $normalizedRootPath) {
      $workspaceRoots += $normalizedRootPath
    }
  }
  return @($workspaceRoots | Select-Object -First ([Math]::Min(3, $workspaceRoots.Count)))
}

function Wait-HomeWorkspaceProjectMetrics {
  param(
    [string]$Session,
    [object]$RootsState,
    [long]$NavigationStartedAtMs,
    [int]$TimeoutMs = $HomeWorkspaceProjectsReadyBudgetMs
  )

  $expectedGroupCount = @(Get-WorkspaceRootSample -RootsState $RootsState).Count
  $metrics = $null
  do {
    $metrics = Read-HomeWorkspaceProjectMetrics -Session $Session
    $elapsedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $NavigationStartedAtMs
    if ([int]$metrics.groupCount -ge $expectedGroupCount -or $elapsedMs -ge $TimeoutMs) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ($true)

  $readyMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $NavigationStartedAtMs
  $metrics | Add-Member -NotePropertyName "workspaceProjectsReadyMs" -NotePropertyValue $readyMs -Force
  $metrics | Add-Member -NotePropertyName "workspaceProjectsReadyBudgetMs" -NotePropertyValue $TimeoutMs -Force
  $metrics | Add-Member -NotePropertyName "workspaceProjectsReadyWithinBudget" -NotePropertyValue ($readyMs -le $TimeoutMs) -Force
  Write-Step "home workspace projects ready in $readyMs ms ($($metrics.groupCount)/$expectedGroupCount groups)"
  return $metrics
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

  $pinnedRootSet = @{}
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds)) {
    $normalizedPinnedRootPath = [string]$rootPath
    if (-not [string]::IsNullOrWhiteSpace($normalizedPinnedRootPath)) {
      $pinnedRootSet[$normalizedPinnedRootPath] = $true
    }
  }

  $expectedRoots = @(Get-WorkspaceRootSample -RootsState $RootsState)
  if ($expectedRoots.Count -eq 0) {
    return
  }

  $labelsByRoot = @{}
  foreach ($property in @($RootsState.data.labels.PSObject.Properties)) {
    $labelsByRoot[[string]$property.Name] = [string]$property.Value
  }

  Assert-True ($Metrics.workspaceProjectsReadyWithinBudget -eq $true) "home sidebar workspace projects exceeded the $($Metrics.workspaceProjectsReadyBudgetMs) ms home-navigation budget: $($Metrics.workspaceProjectsReadyMs) ms"
  Assert-True ($Metrics.groupCount -ge $expectedRoots.Count) "home sidebar project group count is below workspace root count sample after $($Metrics.workspaceProjectsReadyMs) ms"

  for ($index = 0; $index -lt $expectedRoots.Count; $index++) {
    $rootPath = [string]$expectedRoots[$index]
    $expectedProjectName = Get-WorkspaceProjectName -Path $rootPath
    $expectedLabel = if ($labelsByRoot.ContainsKey($rootPath)) { $labelsByRoot[$rootPath] } else { $expectedProjectName }
    $group = @($Metrics.groups | Where-Object { [string]$_.projectName -eq $expectedProjectName } | Select-Object -First 1)

    Assert-True ($group.Count -eq 1) "home sidebar is missing workspace project $expectedProjectName from root $rootPath"
    $group = $group[0]
    Assert-True ([string]$group.text -like "*$expectedLabel*") "home sidebar project label drifted for $rootPath; expected label $expectedLabel"
    if ($pinnedRootSet.ContainsKey($rootPath)) {
      Assert-True ($group.pinnedProject -eq $true) "home sidebar pinned project $expectedProjectName is missing pinned marker"
    }
    Assert-True ([int]$group.newThreadButtonCount -eq 1) "home sidebar project $expectedProjectName is missing project-level new-thread action"
    if ([int]$group.threadRowCount -eq 0) {
      Assert-True ([string]$group.text -like "*暂无会话*") "home sidebar empty workspace project $expectedProjectName is missing empty-state text"
    }
  }

  $expectedPinnedProjectNames = @($RootsState.data.pinnedProjectIds | ForEach-Object { Get-WorkspaceProjectName -Path ([string]$_) })
  for ($index = 0; $index -lt $expectedPinnedProjectNames.Count; $index++) {
    Assert-True ([string]$Metrics.groups[$index].projectName -eq [string]$expectedPinnedProjectNames[$index]) "home sidebar pinned project order drifted at index $index"
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
  const notificationRecovery = document.querySelector('.fixture-notification-recovery');
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
    hasCompletionNotificationRecovery: !!notificationRecovery
      && notificationRecovery.textContent.includes('任务完成通道已关闭')
      && notificationRecovery.textContent.includes('开启任务通知'),
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
    waitingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="waiting"]').length,
    confirmingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="confirming"]').length,
    sentDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="sent"]').length,
    failedDeliveryRetryCount: document.querySelectorAll('.message-delivery-retry').length,
    hasBoundedReconnectText: textContent.includes('正在重连 1/4'),
    hasWaitingDeliveryText: textContent.includes('等待网络'),
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

function Assert-ConversationNewActivityTimerFixture {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "500") | Out-Null
  $script = @'
JSON.stringify((() => {
  const text = document.querySelector('.live-overlay-inline')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const match = text.match(/正在处理\s*·\s*(?:(\d+)\s*分\s*)?(\d+)\s*秒/);
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline').length,
    elapsedSeconds: text.includes('正在处理 · <1 秒')
      ? 0
      : match ? (Number(match[1] || '0') * 60 + Number(match[2] || '0')) : -1,
    text
  };
})())
'@
  $metrics = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$metrics.overlayCount -eq 1) "new activity fixture must keep one active surface"
  Assert-True ([int]$metrics.elapsedSeconds -ge 0) "new activity fixture did not expose elapsed time"
  Assert-True ([int]$metrics.elapsedSeconds -lt 30) "a later activity inherited the previous five-minute timer: $($metrics.text)"
}

function Assert-ConversationResumeRecoveryFixture {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const overlay = document.querySelector('.live-overlay-inline-recovering');
  const ring = overlay?.querySelector('.live-overlay-indicator-ring');
  const text = overlay?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline-recovering').length,
    ariaBusy: overlay?.getAttribute('aria-busy') || '',
    hasRecoveryLabel: text.includes('正在恢复任务'),
    hasRecoveryHint: text.includes('正在同步最新进度'),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ringAnimationName: ring ? getComputedStyle(ring).animationName : '',
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  };
})())
'@
  $metrics = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$metrics.overlayCount -eq 1) "resume recovery fixture must render exactly one recovery surface"
  Assert-True ($metrics.ariaBusy -eq 'true') "resume recovery fixture must expose aria-busy"
  Assert-True ($metrics.hasRecoveryLabel -eq $true) "resume recovery fixture is missing the recovery label"
  Assert-True ($metrics.hasRecoveryHint -eq $true) "resume recovery fixture is missing the automatic-sync hint"
  if ($metrics.reducedMotion -eq $true) {
    Assert-True ($metrics.ringAnimationName -eq 'none') "resume recovery fixture must disable indicator animation when reduced motion is enabled"
  } else {
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$metrics.ringAnimationName) -and $metrics.ringAnimationName -ne 'none') "resume recovery fixture is missing the lightweight indicator animation"
  }
  Assert-True ([int]$metrics.scrollWidth -le [int]$metrics.width + 2) "resume recovery fixture introduced horizontal overflow"
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
  Assert-True ([int]$Metrics.waitingDeliveryStateCount -eq 1) "conversation fixture is missing the waiting-for-network delivery state"
  Assert-True ([int]$Metrics.confirmingDeliveryStateCount -eq 1) "conversation fixture is missing the confirming delivery state"
  Assert-True ([int]$Metrics.sentDeliveryStateCount -eq 1) "conversation fixture is missing the sent delivery state"
  Assert-True ([int]$Metrics.failedDeliveryRetryCount -eq 1) "conversation fixture is missing the failed-message retry action"
  Assert-True ($Metrics.hasBoundedReconnectText -eq $true) "conversation fixture is missing bounded reconnect progress"
  Assert-True ($Metrics.hasWaitingDeliveryText -eq $true) "conversation fixture is missing waiting-for-network feedback"
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

function Assert-ConversationViewportControls {
  param([string]$Session)

  $prepareScript = @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { ready: false };
  window.__cxConversationViewportStyle = {
    flex: list.style.flex,
    height: list.style.height,
    minHeight: list.style.minHeight,
    maxHeight: list.style.maxHeight
  };
  let maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  if (maxScrollTop <= 180) {
    const probeHeight = Math.max(Math.min(list.scrollHeight - 240, 360), 160);
    list.style.flex = `0 0 ${probeHeight}px`;
    list.style.height = `${probeHeight}px`;
    list.style.minHeight = `${probeHeight}px`;
    list.style.maxHeight = `${probeHeight}px`;
    maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  }
  list.scrollTop = Math.max(maxScrollTop - 180, 0);
  list.dispatchEvent(new Event('scroll'));
  return {
    ready: true,
    maxScrollTop,
    overflowAnchor: getComputedStyle(list).overflowAnchor,
    tabIndex: list.tabIndex
  };
})())
'@
  $prepared = Invoke-BrowserEvalJson -Session $Session -Script $prepareScript
  Assert-True ($prepared.ready -eq $true) "conversation viewport control probe could not find the message list"
  Assert-True ([int]$prepared.maxScrollTop -gt 180) "conversation viewport fixture is not tall enough to verify away-from-bottom behavior"
  Assert-True ([string]$prepared.overflowAnchor -eq 'none') "conversation viewport did not disable browser-native scroll anchoring"
  Assert-True ([int]$prepared.tabIndex -eq 0) "conversation viewport is not keyboard focusable"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  $awayMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const button = document.querySelector('.conversation-jump-to-latest');
  const distance = list instanceof HTMLElement
    ? Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0)
    : -1;
  const rect = button?.getBoundingClientRect();
  return {
    distance,
    hasButton: button instanceof HTMLButtonElement,
    buttonVisible: !!rect && rect.width > 0 && rect.height > 0,
    ariaLabel: button?.getAttribute('aria-label') || ''
  };
})())
'@
  Assert-True ([int]$awayMetrics.distance -gt 24) "conversation viewport probe did not leave the bottom threshold"
  Assert-True ($awayMetrics.hasButton -eq $true -and $awayMetrics.buttonVisible -eq $true) "conversation viewport hid the return-to-bottom action without new output"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$awayMetrics.ariaLabel)) "conversation return-to-bottom action is missing an accessible label"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-jump-to-latest');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  $returnedMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { distance: -1, hasButton: true };
  const result = {
    distance: Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0),
    hasButton: !!document.querySelector('.conversation-jump-to-latest')
  };
  const originalStyle = window.__cxConversationViewportStyle;
  if (originalStyle) {
    list.style.flex = originalStyle.flex;
    list.style.height = originalStyle.height;
    list.style.minHeight = originalStyle.minHeight;
    list.style.maxHeight = originalStyle.maxHeight;
    delete window.__cxConversationViewportStyle;
  }
  return result;
})())
'@
  Assert-True ([int]$returnedMetrics.distance -le 24) "conversation return-to-bottom action did not restore the bottom anchor"
  Assert-True ($returnedMetrics.hasButton -eq $false) "conversation return-to-bottom action remained visible after bottom recovery"
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

function Reveal-ConversationFixtureLocalHistory {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $result = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ($result.clicked -eq $true) "conversation fixture could not reveal local history before structured-block checks"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
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
  Assert-True ([string]$Metrics.projectOrder[0] -eq "E:/javaword/CXCodex/codexui") "sidebar fixture pinned project is no longer first"
  Assert-True ([string]$Metrics.projectOrder[1] -eq "E:/javaword/CXCodex/playground") "sidebar fixture recent project did not move ahead of the empty workspace"
  Assert-True ([string]$Metrics.projectOrder[2] -eq "empty-root") "sidebar fixture empty workspace should remain after projects with recent conversations"
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

function Assert-SidebarFixtureStaleSearchMerge {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const projectRows = Array.from(document.querySelectorAll('.project-group .thread-row'));
  return {
    threadIds: projectRows.map((node) => node.getAttribute('data-thread-id') || ''),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  };
})())
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True (@($state.threadIds) -contains "fixture-thread-six") "sidebar stale server search result suppressed a current local title match"
  Assert-True (@($state.threadIds) -contains "fixture-thread-unread") "sidebar stale-search fixture lost the server-index match"
  Assert-True ($state.hasHorizontalOverflow -eq $false) "sidebar stale-search fixture has horizontal overflow"
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
  const composerInput = document.querySelector('.thread-composer-input');
  const composerSubmit = document.querySelector('.thread-composer-submit');
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
    routeMatchesThread: location.hash === `#/thread/${encodeURIComponent(threadId)}`,
    composerReady: composerInput instanceof HTMLTextAreaElement && !composerInput.disabled && composerSubmit instanceof HTMLButtonElement,
    emptyStateVisible: !!document.querySelector('.conversation-empty-state'),
    loadingIndicatorCount: document.querySelectorAll('.conversation-loading,[aria-busy="true"]').length,
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
    [string]$ThreadId,
    [switch]$AllowAuthoritativeEmptyThread
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
  if (-not $AllowAuthoritativeEmptyThread) {
    Assert-True ([int]$Metrics.visibleUserMessageCount -ge 1) "thread page first visible window has no user context for $ThreadId"
    Assert-True ([int]$Metrics.visibleAssistantMessageCount -ge 1) "thread page first visible window has no assistant response for $ThreadId"
  }
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
    [string]$ThreadId,
    [switch]$AllowMissingEmptyEntry
  )

  if (-not ($AllowMissingEmptyEntry -and [int]$Metrics.messageCount -eq 0)) {
    Assert-True ($Metrics.hasEntry -eq $true) "thread message cache has no entry for $ThreadId"
  }
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
    [int]$TimeoutMs = 12000,
    [switch]$AllowAuthoritativeEmptyThread
  )

  $lastMetrics = $null
  while ($Stopwatch.ElapsedMilliseconds -le $TimeoutMs) {
    $lastMetrics = Read-ThreadPageLoadMetrics -Session $Session -ThreadId $ThreadId
    $hasConversation = [int]$lastMetrics.visibleUserMessageCount -ge 1 -and [int]$lastMetrics.visibleAssistantMessageCount -ge 1
    $hasLoadedEmptyThread = $AllowAuthoritativeEmptyThread `
      -and $lastMetrics.routeMatchesThread -eq $true `
      -and $lastMetrics.composerReady -eq $true `
      -and $lastMetrics.emptyStateVisible -eq $true `
      -and [int]$lastMetrics.loadingIndicatorCount -eq 0 `
      -and [int]$lastMetrics.visibleConversationItemCount -eq 0
    if ($hasConversation -or $hasLoadedEmptyThread) {
      $firstScreenReadyMs = if ($null -ne $lastMetrics.firstScreenReadyMs -and [int]$lastMetrics.firstScreenReadyMs -gt 0) {
        [int]$lastMetrics.firstScreenReadyMs
      } else {
        [int]$Stopwatch.ElapsedMilliseconds
      }
      $lastMetrics | Add-Member -NotePropertyName "firstUsableMs" -NotePropertyValue $firstScreenReadyMs -Force
      $lastMetrics | Add-Member -NotePropertyName "browserObservedUsableMs" -NotePropertyValue ([int]$Stopwatch.ElapsedMilliseconds) -Force
      $lastMetrics | Add-Member -NotePropertyName "authoritativeEmptyThread" -NotePropertyValue $hasLoadedEmptyThread -Force
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
  const earliestTurnIndexAttribute = list?.getAttribute('data-earliest-turn-index') || '';
  const earliestTurnIndexValue = Number(earliestTurnIndexAttribute);
  return {
    hasLoadMore: !!loadButton,
    loadText,
    hiddenRemaining: remainingMatch ? Number(remainingMatch[1]) : null,
    messageCount: Number(list?.getAttribute('data-message-count') || '0'),
    earliestTurnIndex: earliestTurnIndexAttribute && Number.isFinite(earliestTurnIndexValue) ? earliestTurnIndexValue : null,
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
    [int]$Iterations = 2,
    [switch]$AllowUnavailable
  )

  $totalItemDelta = 0
  for ($step = 1; $step -le $Iterations; $step++) {
    $before = Read-ThreadWindowMetrics -Session $Session
    if ($before.hasLoadMore -ne $true) {
      if ($step -eq 1 -and $AllowUnavailable) {
        Write-Step "thread load-more -> skipped for short thread $ThreadId (no older history)"
        return
      }
      Assert-True ($step -gt 1 -and $totalItemDelta -ge 1) "thread page has no load-more affordance before step $step for $ThreadId"
      break
    }
    $clickResult = Click-ThreadLoadMore -Session $Session
    Assert-True ($clickResult.clicked -eq $true) "thread page load-more click did not execute at step $step for $ThreadId"
    $after = $null
    for ($waitAttempt = 0; $waitAttempt -lt 40; $waitAttempt++) {
      Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
      $after = Read-ThreadWindowMetrics -Session $Session
      $itemProgress = [int]$after.itemCount - [int]$before.itemCount
      $remainingProgress = 0
      if ($null -ne $before.hiddenRemaining) {
        $afterHiddenRemaining = if ($null -ne $after.hiddenRemaining) { [int]$after.hiddenRemaining } else { 0 }
        $remainingProgress = [int]$before.hiddenRemaining - $afterHiddenRemaining
      }
      $turnProgress = 0
      if ($null -ne $before.earliestTurnIndex -and $null -ne $after.earliestTurnIndex) {
        $turnProgress = [int]$before.earliestTurnIndex - [int]$after.earliestTurnIndex
      }
      if ([Math]::Max([Math]::Max($itemProgress, $remainingProgress), $turnProgress) -ge 1) {
        break
      }
    }
    Assert-True ($null -ne $after) "thread page load-more produced no readable state at step $step for $ThreadId"

    $itemDelta = [int]$after.itemCount - [int]$before.itemCount
    $remainingDelta = 0
    if ($null -ne $before.hiddenRemaining) {
      $afterHiddenRemaining = if ($null -ne $after.hiddenRemaining) { [int]$after.hiddenRemaining } else { 0 }
      $remainingDelta = [int]$before.hiddenRemaining - $afterHiddenRemaining
    }
    $turnDelta = 0
    if ($null -ne $before.earliestTurnIndex -and $null -ne $after.earliestTurnIndex) {
      $turnDelta = [int]$before.earliestTurnIndex - [int]$after.earliestTurnIndex
    }
    $progressDelta = [Math]::Max([Math]::Max($itemDelta, $remainingDelta), $turnDelta)
    $heightDelta = [int]$after.scrollHeight - [int]$before.scrollHeight
    $scrollDelta = [int]$after.scrollTop - [int]$before.scrollTop
    $anchorDrift = [Math]::Abs($scrollDelta - $heightDelta)
    $totalItemDelta += $progressDelta

    Assert-True ($after.hasInternalCodexContext -ne $true) "thread page exposed internal codex context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.userCount -ge 1) "thread page has no user context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.assistantCount -ge 1) "thread page has no assistant response after load-more step $step for $ThreadId"
    Assert-True ($progressDelta -ge 1) "thread page load-more step $step did not advance visible history for $ThreadId; beforeItems=$($before.itemCount), afterItems=$($after.itemCount), beforeTurn=$($before.earliestTurnIndex), afterTurn=$($after.earliestTurnIndex), beforeRpc=$($before.rpcCount), afterRpc=$($after.rpcCount), beforeLoad='$($before.loadText)', afterLoad='$($after.loadText)'"
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
  Assert-MobileLatestReplyRecoverySource
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
  $homeWorkspaceNavigationStartedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  $homeWorkspaceProjectMetrics = Wait-HomeWorkspaceProjectMetrics `
    -Session $session `
    -RootsState $workspaceRootsState `
    -NavigationStartedAtMs $homeWorkspaceNavigationStartedAtMs
  Assert-WorkspaceRootProjectParity -RootsState $workspaceRootsState -Metrics $homeWorkspaceProjectMetrics
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

  $sidebarStaleSearchFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend&staleSearch=1"
  $sidebarStaleSearchFixture = Open-And-ReadPage -Session $session -Url $sidebarStaleSearchFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarStaleSearchFixture -Name "sidebar stale-search fixture phone"
  Assert-SidebarFixtureStaleSearchMerge -Session $session
  Add-RegressionResult -Name "sidebar-stale-search-fixture-phone" -Page $sidebarStaleSearchFixture

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
  Reveal-ConversationFixtureLocalHistory -Session $session
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "desktop"
  Assert-ConversationOlderHistoryAffordance -Session $session
  Assert-ConversationViewportControls -Session $session
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

  $fixturePhone = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $fixturePhone -Name "conversation blocks fixture phone"
  Reveal-ConversationFixtureLocalHistory -Session $session
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

  $nextActivityFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&tailNextActivity=1"
  $nextActivityFixture = Open-And-ReadPage -Session $session -Url $nextActivityFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $nextActivityFixture -Name "conversation new activity timer fixture phone"
  Assert-ConversationNewActivityTimerFixture -Session $session
  Add-RegressionResult -Name "conversation-new-activity-timer-fixture-phone" -Page $nextActivityFixture

  $resumeRecoveryFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&resumeRecovery=1"
  $resumeRecoveryFixture = Open-And-ReadPage -Session $session -Url $resumeRecoveryFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $resumeRecoveryFixture -Name "conversation resume recovery fixture phone"
  Assert-ConversationResumeRecoveryFixture -Session $session
  Add-RegressionResult -Name "conversation-resume-recovery-fixture-phone" -Page $resumeRecoveryFixture

  $fixtureFoldable = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $fixtureFoldable -Name "conversation blocks fixture foldable"
  Reveal-ConversationFixtureLocalHistory -Session $session
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "conversation-blocks-fixture-foldable" -Page $fixtureFoldable

  $notificationRecoveryFixtureUrl = $BaseUrl + "/#/__regression/task-pet?regression=frontend&channelBlocked=1"
  $notificationRecoveryFixture = Open-And-ReadPage -Session $session -Url $notificationRecoveryFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $notificationRecoveryFixture -Name "completion notification recovery fixture phone"
  Assert-True ($notificationRecoveryFixture.hasCompletionNotificationRecovery -eq $true) "completion notification recovery fixture phone is missing the blocked-channel state or recovery action"
  Add-RegressionResult -Name "completion-notification-recovery-phone" -Page $notificationRecoveryFixture

  $latestReplyFixtureUrl = $BaseUrl + "/#/__regression/task-pet?regression=frontend&latestReplyBurst=1"
  $latestReplyFixture = Open-And-ReadPage -Session $session -Url $latestReplyFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $latestReplyFixture -Name "latest reply promoted fixture phone"
  $latestReplyFixtureMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.task-pet-preview-row'));
  return {
    visibleRowCount: rows.length,
    firstRowText: rows[0]?.textContent?.replace(/\s+/g, ' ').trim() || '',
    allRowsText: rows.map((row) => row.textContent || '').join(' '),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  };
})())
'@
  Assert-True ([int]$latestReplyFixtureMetrics.visibleRowCount -eq 3) "task-pet latest-reply fixture must keep exactly three visible rows"
  Assert-True ([string]$latestReplyFixtureMetrics.firstRowText -match '最新回复已提升到浮窗可见首行') "the newest reply task is not the first visible overlay row"
  Assert-True ([string]$latestReplyFixtureMetrics.allRowsText -notmatch '这条较早回复应留在前三条之外') "the fourth older task leaked into the visible overlay rows"
  Assert-True ([int]$latestReplyFixtureMetrics.documentWidth -eq [int]$latestReplyFixtureMetrics.viewportWidth) "latest-reply task-pet fixture has horizontal overflow"
  $collapseLatestReplyPreview = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const mascot = document.querySelector('.task-pet-preview-mascot');
  mascot?.click();
  return { collapsed: Boolean(mascot) };
})())
'@
  Assert-True ($collapseLatestReplyPreview.collapsed -eq $true) "task-pet latest-reply fixture could not collapse into the compact preview"
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "250") | Out-Null
  $compactLatestReplyBefore = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const compact = document.querySelector('.task-pet-preview-compact');
  return {
    compactCount: document.querySelectorAll('.task-pet-preview-compact').length,
    text: compact?.textContent?.replace(/\s+/g, ' ').trim() || '',
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  };
})())
'@
  Assert-True ([int]$compactLatestReplyBefore.compactCount -eq 1) "collapsed task pet must show exactly one latest-reply preview"
  Assert-True ([string]$compactLatestReplyBefore.text -match '最新回复已提升到浮窗可见首行') "collapsed task pet did not retain the newest visible reply"
  Assert-True ([int]$compactLatestReplyBefore.documentWidth -eq [int]$compactLatestReplyBefore.viewportWidth) "collapsed latest-reply preview has horizontal overflow"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="simulate-latest-reply"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  $compactLatestReplyAfter = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const compact = document.querySelector('.task-pet-preview-compact');
  return {
    compactCount: document.querySelectorAll('.task-pet-preview-compact').length,
    text: compact?.textContent?.replace(/\s+/g, ' ').trim() || ''
  };
})())
'@
  Assert-True ([int]$compactLatestReplyAfter.compactCount -eq 1) "task-pet fixture lost its compact preview after a simulated realtime reply"
  Assert-True ([string]$compactLatestReplyAfter.text -match '浮窗已实时同步最新回复') "compact task pet did not update its visible reply in realtime"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".task-pet-preview-compact") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "100") | Out-Null
  $compactLatestReplyAction = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify({
  action: document.querySelector('[data-testid="task-pet-action"]')?.textContent || ''
})
'@
  Assert-True ([string]$compactLatestReplyAction.action -match '打开会话：fixture-latest-reply') "compact latest-reply click did not preserve the exact conversation id"
  Add-RegressionResult -Name "latest-reply-promoted-phone" -Page $latestReplyFixture

  if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
    $threadLoadStopwatch = [Diagnostics.Stopwatch]::StartNew()
    $thread = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/thread/$ThreadId" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $thread -Name "thread phone" -RequireComposer
    $threadUsableMetrics = Wait-ThreadUsableMetrics -Session $session -ThreadId $ThreadId -Stopwatch $threadLoadStopwatch -AllowAuthoritativeEmptyThread:$MeasureResponseFeedback
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
    Assert-ThreadPageLoadMetrics -Metrics $threadPageLoadMetrics -ThreadId $ThreadId -AllowAuthoritativeEmptyThread:($threadUsableMetrics.authoritativeEmptyThread -eq $true)
    $threadMessageCacheMetrics = Read-ThreadMessageCacheMetrics -Session $session -ThreadId $ThreadId
    Assert-ThreadMessageCacheMetrics -Metrics $threadMessageCacheMetrics -ThreadId $ThreadId -AllowMissingEmptyEntry:($threadUsableMetrics.authoritativeEmptyThread -eq $true)
    $allowUnavailableLoadMore = [int]$threadMessageCacheMetrics.messageCount -le $ThreadInitialMessageWindowSize
    Assert-ThreadLoadMoreWindow -Session $session -ThreadId $ThreadId -AllowUnavailable:$allowUnavailableLoadMore
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
