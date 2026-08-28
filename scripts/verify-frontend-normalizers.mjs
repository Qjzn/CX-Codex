import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputBase = join(repoRoot, 'output', 'frontend-normalizer-smoke')
mkdirSync(outputBase, { recursive: true })

const outputRoot = mkdtempSync(join(outputBase, 'run-'))
const entryPath = join(outputRoot, 'entry.ts')
const bundledPath = join(outputRoot, 'entry.mjs')
const normalizerImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'normalizers', 'v2.ts')))
const notificationReplayImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'notificationReplayCoordinator.ts')))
const connectionManagerImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'connectionManager.ts')))
const conversationViewportImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'conversationViewport.ts')))
const conversationRenderPolicyImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'conversationRenderPolicy.ts')))
const runtimeSnapshotOrderingImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'runtimeSnapshotOrdering.ts')))
const runtimeExecutionRecoveryImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'runtimeExecutionRecovery.ts')))
const messageOutboxMergeImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'messageOutboxMerge.ts')))
const messageIdentityImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'messageIdentity.ts')))
const composerTurnOptionsImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'composerTurnOptions.ts')))
const messageOutboxPersistenceImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'messageOutboxPersistence.ts')))
const conversationProjectionImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'conversationProjection.ts')))
const boundedAsyncRecoveryImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'boundedAsyncRecovery.ts')))
const chatFeedbackMetricsImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'chatFeedbackMetrics.ts')))
const runtimeRequestDeliveryImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'runtimeRequestDelivery.ts')))
const rpcClientImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'codexRpcClient.ts')))
const projectGroupOrderingImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'utils', 'projectGroupOrdering.ts')))
const activityTimerImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'activityTimer.ts')))
const latestReplyImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'utils', 'latestReply.ts')))
const taskPetReadPolicyImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'mobile', 'taskPetReadPolicy.ts')))
const sessionFileChangeImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'sessionFileChange.ts')))
const composerEnterBehaviorImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'composerEnterBehavior.ts')))
const threadGoalImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'threadGoal.ts')))
const codexFileCitationImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'utils', 'codexFileCitation.ts')))
const runtimeMessageQueueImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'runtimeMessageQueue.ts')))
const foregroundRecoveryPolicyImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'foregroundRecoveryPolicy.ts')))
const threadFirstScreenMetricsImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'threadFirstScreenMetrics.ts')))
const foregroundRecoveryMetricsImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'foregroundRecoveryMetrics.ts')))
const codexGatewayImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'codexGateway.ts')))
const queuedMessageTransferImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'queuedMessageTransfer.ts')))

try {
  writeFileSync(entryPath, `
import assert from 'node:assert/strict'
import { applyActiveTurnIdToMessages, normalizeThreadGroupsV2, normalizeThreadMessagesV2 } from '${normalizerImport}'
import { createNotificationReplayCoordinator } from '${notificationReplayImport}'
import {
  createConnectionManager,
  decideConnectedRecovery,
  shouldRestartNotificationStreamOnForeground,
} from '${connectionManagerImport}'
import {
  CONVERSATION_BOTTOM_THRESHOLD_PX,
  conversationDistanceFromBottom,
  isConversationViewportAtBottom,
} from '${conversationViewportImport}'
import { haveSameConversationMessageStructure } from '${conversationRenderPolicyImport}'
import {
  resetRuntimeSnapshotVersionMap,
  shouldApplyRuntimeSnapshotVersion,
  shouldApplyRuntimeTerminalTurn,
} from '${runtimeSnapshotOrderingImport}'
import { isOptimisticOnlyExecutionEvidence } from '${runtimeExecutionRecoveryImport}'
import { mergeMessageOutboxEntries, mergeMessageOutboxState } from '${messageOutboxMergeImport}'
import {
  createClientMessageId,
  filterVisibleOptimisticUserMessages,
  mergeVisibleOptimisticUserMessages,
  recoverOptimisticBaselineMatchCount,
  selectDetachedFailedOptimisticUserMessages,
  userMessageSignature,
} from '${messageIdentityImport}'
import {
  cloneComposerTurnOptions,
  normalizeComposerTurnOptions,
} from '${composerTurnOptionsImport}'
import {
  MESSAGE_OUTBOX_STORAGE_KEY,
  isMessageOutboxStorageKey,
  loadMessageOutboxStateFromStorage,
  parseMessageOutboxState,
  saveMessageOutboxStateToStorage,
  serializeMessageOutboxState,
} from '${messageOutboxPersistenceImport}'
import {
  areMessageFieldsEqual,
  hasPlanImplementationConfirmation,
  mergeMessages,
  PLAN_IMPLEMENTATION_CONFIRMATION,
  removeRedundantLiveAgentMessages,
  removeStaleHistoryNoticeAfterOlderMerge,
  sortMessagesByTurnIndex,
  upsertMessage,
} from '${conversationProjectionImport}'
import { runWithBoundedRecovery } from '${boundedAsyncRecoveryImport}'
import {
  beginChatFeedbackMetric,
  chatFeedbackNow,
  markChatFeedbackFirstAssistantData,
  markChatFeedbackFirstAssistantVisible,
  markChatFeedbackRendered,
  markChatFeedbackRequestDispatched,
  markChatFeedbackServerAcknowledged,
  readChatFeedbackMetricSummary,
} from '${chatFeedbackMetricsImport}'
import {
  isRuntimeRequestAwaitingDeliveryConfirmation,
  shouldSettleOptimisticDeliveryFromRuntimeSnapshot,
} from '${runtimeRequestDeliveryImport}'
import { subscribeRpcNotifications } from '${rpcClientImport}'
import {
  areUiThreadFieldsEqual,
  dedupeProjectThreadGroups,
  orderProjectGroupsByRecentActivity,
  preserveResolvedThreadProjectIdentity,
  upsertThreadIntoProjectGroups,
} from '${projectGroupOrderingImport}'
import { readRuntimeActivityStartedAtMs } from '${activityTimerImport}'
import { compactLatestReplyTail } from '${latestReplyImport}'
import {
  shouldAcknowledgeMobileShellTaskPetThreadOpen,
  shouldMarkMobileShellTaskPetThreadRead,
} from '${taskPetReadPolicyImport}'
import {
  CX_SESSION_FILES_CHANGED_METHOD,
  getCxSessionFileChangeSyncPolicy,
  getSessionLogAuthoritativeRefreshAction,
  hasSettledSessionLogMessageEvidence,
  isCxSessionFilesChangedMethod,
  readCxSessionFileChangeOrigin,
  readCxSessionFileChangeSource,
} from '${sessionFileChangeImport}'
import { resolveSendWithEnterPreference } from '${composerEnterBehaviorImport}'
import { normalizeThreadGoal } from '${threadGoalImport}'
import {
  readCodexFileCitationAt,
  splitCodexFileCitations,
} from '${codexFileCitationImport}'
import {
  mergePersistedRuntimeQueuedMessages,
  mergeRuntimeMessageQueueThreadState,
} from '${runtimeMessageQueueImport}'
import { shouldRefreshForegroundMessages } from '${foregroundRecoveryPolicyImport}'
import {
  beginThreadFirstScreenMetric,
  markThreadFirstScreenReady,
  setThreadFirstScreenSource,
} from '${threadFirstScreenMetricsImport}'
import {
  beginForegroundRecoveryMetric,
  cancelForegroundRecoveryMetric,
  readForegroundRecoveryMetricSummary,
  settleForegroundRecoveryMetric,
} from '${foregroundRecoveryMetricsImport}'
import { getThreadRuntimeSnapshot } from '${codexGatewayImport}'
import {
  restoreQueuedMessageAtIndex,
  transferQueuedMessageWithRecovery,
} from '${queuedMessageTransferImport}'

const runtimeSnapshotOriginalFetch = globalThis.fetch
const runtimeSnapshotOriginalDateNow = Date.now
let runtimeSnapshotFetchCount = 0
let runtimeSnapshotNow = 1_000
Date.now = () => runtimeSnapshotNow
globalThis.fetch = (async () => {
  runtimeSnapshotFetchCount += 1
  return new Response(JSON.stringify({
    data: {
      executionState: 'completed',
      inProgress: false,
      messageState: 'fresh',
      pendingServerRequests: [],
      stale: false,
      updatedAtIso: '2026-08-28T00:00:00.000Z',
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}) as typeof fetch
await getThreadRuntimeSnapshot('thread-session-log-quiet-window')
runtimeSnapshotNow += 1_800
await (getThreadRuntimeSnapshot as any)('thread-session-log-quiet-window', {
  cachedSnapshotMaxAgeMs: 2_500,
})
assert.equal(
  runtimeSnapshotFetchCount,
  1,
  'a delayed session-log convergence read should reuse the settled state snapshot',
)
runtimeSnapshotNow = 10_000
await getThreadRuntimeSnapshot('thread-default-cache-window')
runtimeSnapshotNow += 1_000
await getThreadRuntimeSnapshot('thread-default-cache-window')
assert.equal(
  runtimeSnapshotFetchCount,
  3,
  'ordinary state reads must retain the shorter default freshness window',
)
globalThis.fetch = runtimeSnapshotOriginalFetch
Date.now = runtimeSnapshotOriginalDateNow

const recoveryMetricHost: any = {}
let recoveryMetricStorageValue: string | null = null
const recoveryMetricStorage = {
  getItem: () => recoveryMetricStorageValue,
  setItem: (_key: string, value: string) => { recoveryMetricStorageValue = value },
  removeItem: () => { recoveryMetricStorageValue = null },
}
beginForegroundRecoveryMetric(' recovery-thread ', 1_000, recoveryMetricHost)
beginForegroundRecoveryMetric('recovery-thread', 1_100, recoveryMetricHost)
assert.deepEqual(settleForegroundRecoveryMetric(
  'recovery-thread',
  1_240,
  recoveryMetricHost,
  recoveryMetricStorage,
), {
  startedAtMs: 1_000,
  settledAtMs: 1_240,
  latencyMs: 240,
})
assert.deepEqual(readForegroundRecoveryMetricSummary(1_240, recoveryMetricStorage), {
  sampleCount: 1,
  p50Ms: 240,
  p95Ms: 240,
  maxMs: 240,
  latestMs: 240,
})
beginForegroundRecoveryMetric('cancelled-recovery', 1_300, recoveryMetricHost)
cancelForegroundRecoveryMetric('cancelled-recovery', recoveryMetricHost)
assert.equal(settleForegroundRecoveryMetric(
  'cancelled-recovery',
  1_500,
  recoveryMetricHost,
  recoveryMetricStorage,
), null)
for (let index = 0; index < 55; index += 1) {
  const startedAtMs = 2_000 + index * 10
  beginForegroundRecoveryMetric('bounded-recovery', startedAtMs, recoveryMetricHost)
  settleForegroundRecoveryMetric(
    'bounded-recovery',
    startedAtMs + index,
    recoveryMetricHost,
    recoveryMetricStorage,
  )
}
assert.equal(readForegroundRecoveryMetricSummary(3_000, recoveryMetricStorage).sampleCount, 50)

const firstScreenMetricHost: any = {}
beginThreadFirstScreenMetric(' thread-cache ', 100, firstScreenMetricHost)
setThreadFirstScreenSource('thread-cache', 'local-cache', firstScreenMetricHost)
const cachedFirstScreenMetric = markThreadFirstScreenReady({
  threadId: 'thread-cache',
  itemCount: 4,
  userCount: 2,
  assistantCount: 2,
}, 225, firstScreenMetricHost)
assert.deepEqual(cachedFirstScreenMetric, {
  readyAtMs: 225,
  selectionStartedAtMs: 100,
  selectionLatencyMs: 125,
  source: 'local-cache',
  itemCount: 4,
  userCount: 2,
  assistantCount: 2,
})
assert.equal(markThreadFirstScreenReady({
  threadId: 'thread-cache',
  itemCount: 8,
  userCount: 4,
  assistantCount: 4,
}, 275, firstScreenMetricHost), cachedFirstScreenMetric)
beginThreadFirstScreenMetric('thread-cache', 300, firstScreenMetricHost)
setThreadFirstScreenSource('thread-cache', 'memory', firstScreenMetricHost)
assert.equal(firstScreenMetricHost.__cxCodexThreadFirstScreenReady['thread-cache'], undefined)
assert.equal(markThreadFirstScreenReady({
  threadId: 'thread-cache',
  itemCount: 2,
  userCount: 1,
  assistantCount: 1,
}, 330, firstScreenMetricHost)?.selectionLatencyMs, 30)
for (let index = 0; index < 40; index += 1) {
  const threadId = 'bounded-first-screen-' + String(index)
  beginThreadFirstScreenMetric(threadId, 400 + index, firstScreenMetricHost)
  setThreadFirstScreenSource(threadId, 'memory', firstScreenMetricHost)
  markThreadFirstScreenReady({
    threadId,
    itemCount: 2,
    userCount: 1,
    assistantCount: 1,
  }, 450 + index, firstScreenMetricHost)
}
assert.equal(Object.keys(firstScreenMetricHost.__cxCodexThreadFirstScreenStart).length, 32)
assert.equal(Object.keys(firstScreenMetricHost.__cxCodexThreadFirstScreenReady).length, 32)

const queuedA = { id: 'local-a', clientMessageId: 'client-a', deliveryState: 'queued' } as any
const queuedB = { id: 'local-b', clientMessageId: 'client-b', deliveryState: 'queued' } as any
const queuedC = { id: 'local-c', clientMessageId: 'client-c', deliveryState: 'queued' } as any
const serverA = { ...queuedA, id: 'server-a', serverRequestId: 'server-a', backgroundPersisted: true }
const serverC = { ...queuedC, id: 'server-c', serverRequestId: 'server-c', backgroundPersisted: true }
assert.deepEqual(mergePersistedRuntimeQueuedMessages([queuedA, queuedB], [serverA]), {
  queue: [serverA, queuedB],
  orphanedServerRequestIds: [],
})
assert.deepEqual(mergePersistedRuntimeQueuedMessages([queuedB], [serverA]), {
  queue: [queuedB],
  orphanedServerRequestIds: ['server-a'],
})
assert.deepEqual(
  mergeRuntimeMessageQueueThreadState([serverA, queuedB, serverC], [serverC, serverA]),
  [serverA, queuedB, serverC],
)
assert.deepEqual(
  mergeRuntimeMessageQueueThreadState([serverA, queuedB, serverC], [serverC, serverA], false),
  [serverC, serverA, queuedB],
)
assert.deepEqual(mergeRuntimeMessageQueueThreadState([serverA], []), [])

const transferSnapshot = { index: 1, message: queuedB }
let restoredTransferSnapshot: typeof transferSnapshot | null = null
assert.equal(await transferQueuedMessageWithRecovery({
  snapshot: transferSnapshot,
  deliver: async () => { throw new Error('active writer rejected steer') },
  restore: async (snapshot) => {
    restoredTransferSnapshot = snapshot
    return true
  },
}), 'restored')
assert.equal(restoredTransferSnapshot, transferSnapshot)
assert.deepEqual(
  restoreQueuedMessageAtIndex([queuedA, queuedC], transferSnapshot).map((message) => message.id),
  ['local-a', 'local-b', 'local-c'],
)
assert.equal(
  restoreQueuedMessageAtIndex([queuedA, queuedB, queuedC], transferSnapshot).filter((message) => message.id === queuedB.id).length,
  1,
)

const activeResumeState = {
  hasThread: true,
  requestedForceRefresh: true,
  allowRoutineActiveRefresh: true,
  pendingMessageRefresh: false,
  unread: false,
  executionActive: true,
  executionStale: false,
  hasLoadedThreadDetail: true,
  hasPendingServerRequest: false,
  hasQueuedWork: false,
  connectionStale: false,
  recentlySynced: true,
  forceRefreshDue: false,
}
assert.equal(shouldRefreshForegroundMessages(activeResumeState), true)
assert.equal(shouldRefreshForegroundMessages({
  ...activeResumeState,
  allowRoutineActiveRefresh: false,
}), false)
assert.equal(shouldRefreshForegroundMessages({
  ...activeResumeState,
  allowRoutineActiveRefresh: false,
  pendingMessageRefresh: true,
}), true)
assert.equal(shouldRefreshForegroundMessages({
  ...activeResumeState,
  allowRoutineActiveRefresh: false,
  executionStale: true,
}), true)

const resumePdfCitation = ':codex-file-citation{path="E:/workspace/CXCodex/role_resumes/示例用户-产品与项目经理-优化投递版-2026-08-03.pdf" purpose="产品与项目经理通用投递简历"}'
assert.deepEqual(readCodexFileCitationAt(resumePdfCitation, 0), {
  raw: resumePdfCitation,
  start: 0,
  end: resumePdfCitation.length,
  path: 'E:/workspace/CXCodex/role_resumes/示例用户-产品与项目经理-优化投递版-2026-08-03.pdf',
  purpose: '产品与项目经理通用投递简历',
  attributes: {
    path: 'E:/workspace/CXCodex/role_resumes/示例用户-产品与项目经理-优化投递版-2026-08-03.pdf',
    purpose: '产品与项目经理通用投递简历',
  },
})
assert.deepEqual(
  splitCodexFileCitations('PDF：' + resumePdfCitation + '。'),
  [
    { kind: 'text', value: 'PDF：' },
    {
      kind: 'citation',
      citation: {
        raw: resumePdfCitation,
        start: 4,
        end: 4 + resumePdfCitation.length,
        path: 'E:/workspace/CXCodex/role_resumes/示例用户-产品与项目经理-优化投递版-2026-08-03.pdf',
        purpose: '产品与项目经理通用投递简历',
        attributes: {
          path: 'E:/workspace/CXCodex/role_resumes/示例用户-产品与项目经理-优化投递版-2026-08-03.pdf',
          purpose: '产品与项目经理通用投递简历',
        },
      },
    },
    { kind: 'text', value: '。' },
  ],
)
const windowsSeparator = String.fromCharCode(92)
const spacedDocxPath = ['E:', '投递材料', '产品 经理', '示例用户 简历.docx'].join(windowsSeparator)
const spacedDocxCitation = ':codex-file-citation{purpose="带 ' + windowsSeparator + '"引号' + windowsSeparator + '" 的定制简历" path="' + spacedDocxPath + '" artifact_kind="document" page_number="2"}'
assert.equal(readCodexFileCitationAt(spacedDocxCitation, 0)?.path, spacedDocxPath)
assert.equal(readCodexFileCitationAt(spacedDocxCitation, 0)?.purpose, '带 "引号" 的定制简历')
assert.equal(readCodexFileCitationAt(spacedDocxCitation, 0)?.attributes.page_number, '2')
const unquotedXlsxCitation = ':codex-file-citation{path=E:/reports/项目清单.xlsx artifact_kind=workbook range=Sheet1!A1:D20}'
assert.equal(readCodexFileCitationAt(unquotedXlsxCitation, 0)?.path, 'E:/reports/项目清单.xlsx')
assert.equal(readCodexFileCitationAt(unquotedXlsxCitation, 0)?.attributes.range, 'Sheet1!A1:D20')
assert.equal(splitCodexFileCitations(resumePdfCitation + unquotedXlsxCitation).filter((part) => part.kind === 'citation').length, 2)
assert.equal(readCodexFileCitationAt(':codex-file-citation{purpose="缺少路径"}', 0)?.path, '')
assert.deepEqual(splitCodexFileCitations('保留 :codex-file-citation{path="E:/unfinished.pdf"'), [
  { kind: 'text', value: '保留 :codex-file-citation{path="E:/unfinished.pdf"' },
])

assert.equal(CONVERSATION_BOTTOM_THRESHOLD_PX, 24)
assert.equal(haveSameConversationMessageStructure(
  [{ id: 'one' }, { id: 'live', text: 'partial' }],
  [{ id: 'one' }, { id: 'live', text: 'longer partial response' }],
), true)
assert.equal(haveSameConversationMessageStructure(
  [{ id: 'one' }, { id: 'live' }],
  [{ id: 'one' }, { id: 'tool' }, { id: 'live' }],
), false)
assert.equal(haveSameConversationMessageStructure(
  [{ id: 'one' }, { id: 'two' }],
  [{ id: 'two' }, { id: 'one' }],
), false)
assert.equal(CX_SESSION_FILES_CHANGED_METHOD, 'cx/session-files/changed')
assert.equal(isCxSessionFilesChangedMethod('cx/session-files/changed'), true)
assert.equal(isCxSessionFilesChangedMethod('turn/completed'), false)
assert.equal(readCxSessionFileChangeSource({ source: 'session-log' }), 'session-log')
assert.equal(readCxSessionFileChangeSource({ source: 'session-index' }), 'session-index')
assert.equal(readCxSessionFileChangeSource({ source: 'unknown' }), '')
assert.equal(readCxSessionFileChangeOrigin({ origin: 'live-app-server' }), 'live-app-server')
assert.equal(readCxSessionFileChangeOrigin({ origin: 'external' }), 'external')
assert.equal(readCxSessionFileChangeOrigin({ origin: 'unknown' }), '')
assert.deepEqual(
  getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, { source: 'session-log' }),
  { refreshMessages: true, refreshThreads: false, preferSessionLogMessages: true },
)
assert.deepEqual(
  getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, {
    source: 'session-log',
    origin: 'live-app-server',
  }),
  { refreshMessages: true, refreshThreads: false, preferSessionLogMessages: true },
)
assert.deepEqual(
  getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, { source: 'session-index' }),
  { refreshMessages: false, refreshThreads: true, preferSessionLogMessages: false },
)
assert.deepEqual(
  getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, {}),
  { refreshMessages: true, refreshThreads: true, preferSessionLogMessages: false },
)
assert.equal(getCxSessionFileChangeSyncPolicy('turn/completed', { source: 'session-log' }), null)
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: true,
  executionActive: true,
  hasPendingServerRequest: false,
  hasQueuedWork: false,
  hasTerminalEvidence: false,
}), 'defer')
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: true,
  executionActive: false,
  hasPendingServerRequest: true,
  hasQueuedWork: false,
  hasTerminalEvidence: true,
}), 'defer')
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: true,
  executionActive: false,
  hasPendingServerRequest: false,
  hasQueuedWork: true,
  hasTerminalEvidence: true,
}), 'defer')
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: true,
  executionActive: false,
  hasPendingServerRequest: false,
  hasQueuedWork: false,
  hasTerminalEvidence: false,
}), 'defer')
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: true,
  executionActive: false,
  hasPendingServerRequest: false,
  hasQueuedWork: false,
  hasTerminalEvidence: true,
}), 'refresh')
assert.equal(getSessionLogAuthoritativeRefreshAction({
  isSelected: false,
  executionActive: true,
  hasPendingServerRequest: true,
  hasQueuedWork: true,
  hasTerminalEvidence: false,
}), 'skip')
assert.equal(hasSettledSessionLogMessageEvidence([
  { role: 'assistant', messageType: 'agentMessage', phase: 'final' },
  { role: 'user', messageType: 'userMessage' },
  { role: 'assistant', messageType: 'agentMessage', phase: 'commentary' },
]), false)
assert.equal(hasSettledSessionLogMessageEvidence([
  { role: 'user', messageType: 'userMessage' },
  { role: 'assistant', messageType: 'agentMessage', phase: 'commentary' },
  { role: 'assistant', messageType: 'agentMessage', phase: 'final' },
]), true)
assert.equal(hasSettledSessionLogMessageEvidence([
  { role: 'user', messageType: 'userMessage' },
  { role: 'assistant', messageType: 'agentMessage', phase: 'final' },
  { role: 'assistant', messageType: 'agentMessage', phase: 'commentary' },
]), false)
assert.equal(isOptimisticOnlyExecutionEvidence({
  executionActive: true,
  sourceInProgress: false,
  runtimeFreshActive: true,
  hasRunningCommand: false,
  hasPendingServerRequest: false,
  hasFreshExecutionSignal: false,
  pendingTurnAgeMs: null,
  recoveryGraceMs: 2_500,
  hasActiveTurnId: true,
  queueProcessing: false,
}), false)
assert.equal(isOptimisticOnlyExecutionEvidence({
  executionActive: true,
  sourceInProgress: false,
  runtimeFreshActive: false,
  hasRunningCommand: false,
  hasPendingServerRequest: false,
  hasFreshExecutionSignal: false,
  pendingTurnAgeMs: null,
  recoveryGraceMs: 2_500,
  hasActiveTurnId: true,
  queueProcessing: false,
}), true)
assert.equal(resolveSendWithEnterPreference(null, false), true)
assert.equal(resolveSendWithEnterPreference(null, true), false)
assert.equal(resolveSendWithEnterPreference('1', true), true)
assert.equal(resolveSendWithEnterPreference('0', false), false)
assert.equal(resolveSendWithEnterPreference('invalid', true), false)
assert.deepEqual(normalizeThreadGoal({
  threadId: 'thread-goal',
  objective: 'Keep improving',
  status: 'active',
  tokenBudget: 1000,
  tokensUsed: 120,
  timeUsedSeconds: 30,
  createdAt: 1,
  updatedAt: 2,
}), {
  threadId: 'thread-goal',
  objective: 'Keep improving',
  status: 'active',
  tokenBudget: 1000,
  tokensUsed: 120,
  timeUsedSeconds: 30,
  createdAt: 1,
  updatedAt: 2,
})
assert.equal(normalizeThreadGoal({ threadId: 'thread-goal', objective: 'x', status: 'unknown' }), null)
assert.equal(normalizeThreadGoal({ threadId: '', objective: 'x', status: 'active' }), null)
assert.equal(conversationDistanceFromBottom({ scrollHeight: 1000, scrollTop: 676, clientHeight: 300 }), 24)
assert.equal(isConversationViewportAtBottom({ scrollHeight: 1000, scrollTop: 676, clientHeight: 300 }), true)
assert.equal(isConversationViewportAtBottom({ scrollHeight: 1000, scrollTop: 675, clientHeight: 300 }), false)
assert.equal(conversationDistanceFromBottom({ scrollHeight: 100, scrollTop: 0, clientHeight: 200 }), 0)

const managerSubscriptions = []
const managerStates = []
const managerNotifications = []
let managerTransportActivity = 0
let managerStopCount = 0
const connectionManager = createConnectionManager({
  subscribe: (onNotification, handlers) => {
    const subscription = { onNotification, handlers }
    managerSubscriptions.push(subscription)
    return () => {
      managerStopCount += 1
      handlers.onConnectionStateChange('disconnected')
    }
  },
  onNotification: (notification) => { managerNotifications.push(notification) },
  onTransportActivity: () => { managerTransportActivity += 1 },
  onConnectionStateChange: (state, previousState) => {
    managerStates.push([previousState, state])
  },
})
assert.equal(connectionManager.getState(), 'disconnected')
connectionManager.start()
assert.equal(connectionManager.isStarted(), true)
assert.equal(managerSubscriptions.length, 1)
managerSubscriptions[0].handlers.onConnectionStateChange('connected')
managerSubscriptions[0].handlers.onTransportActivity()
managerSubscriptions[0].onNotification('first')
assert.equal(connectionManager.getState(), 'connected')
assert.equal(managerTransportActivity, 1)
assert.deepEqual(managerNotifications, ['first'])
connectionManager.restart()
assert.equal(managerStopCount, 1)
assert.equal(managerSubscriptions.length, 2)
managerSubscriptions[0].handlers.onConnectionStateChange('disconnected')
managerSubscriptions[0].onNotification('stale')
managerSubscriptions[1].handlers.onConnectionStateChange('connected')
managerSubscriptions[1].onNotification('second')
assert.deepEqual(managerNotifications, ['first', 'second'])
connectionManager.stop()
assert.equal(managerStopCount, 2)
assert.equal(connectionManager.isStarted(), false)
assert.equal(connectionManager.getState(), 'disconnected')
assert.deepEqual(managerStates, [
  ['disconnected', 'connecting'],
  ['connecting', 'connected'],
  ['connected', 'connecting'],
  ['connecting', 'connected'],
  ['connected', 'disconnected'],
])

assert.equal(shouldRestartNotificationStreamOnForeground({
  connectionState: 'reconnecting',
  notificationStale: false,
  hasSyncDemand: false,
  hasSelectedThread: false,
}), true)
assert.equal(shouldRestartNotificationStreamOnForeground({
  connectionState: 'connected',
  notificationStale: true,
  hasSyncDemand: false,
  hasSelectedThread: true,
}), false)
assert.equal(shouldRestartNotificationStreamOnForeground({
  connectionState: 'connected',
  notificationStale: true,
  hasSyncDemand: true,
  hasSelectedThread: true,
}), true)
assert.equal(shouldRestartNotificationStreamOnForeground({
  connectionState: 'connected',
  notificationStale: true,
  hasSyncDemand: false,
  hasSelectedThread: false,
}), false)
assert.deepEqual(decideConnectedRecovery({
  previousState: 'reconnecting',
  nextState: 'connected',
  documentVisible: false,
  androidShellAvailable: false,
  hasSyncDemand: true,
  activeThreadId: 'thread-hidden',
  suppressActiveThreadRecovery: false,
  pendingThreadsRefresh: true,
  hasLoadedThreads: false,
}), { kind: 'none' })
assert.deepEqual(decideConnectedRecovery({
  previousState: 'connecting',
  nextState: 'connected',
  documentVisible: true,
  androidShellAvailable: false,
  hasSyncDemand: false,
  activeThreadId: '',
  suppressActiveThreadRecovery: false,
  pendingThreadsRefresh: false,
  hasLoadedThreads: true,
}), { kind: 'replay' })
assert.deepEqual(decideConnectedRecovery({
  previousState: 'reconnecting',
  nextState: 'connected',
  documentVisible: true,
  androidShellAvailable: false,
  hasSyncDemand: true,
  activeThreadId: '',
  suppressActiveThreadRecovery: false,
  pendingThreadsRefresh: false,
  hasLoadedThreads: false,
}), {
  kind: 'foreground',
  includeThreadList: true,
  forceMessageRefresh: true,
  urgent: true,
})
assert.deepEqual(decideConnectedRecovery({
  previousState: 'reconnecting',
  nextState: 'connected',
  documentVisible: true,
  androidShellAvailable: true,
  hasSyncDemand: true,
  activeThreadId: 'thread-recent',
  suppressActiveThreadRecovery: true,
  pendingThreadsRefresh: true,
  hasLoadedThreads: false,
}), { kind: 'replay' })
assert.deepEqual(decideConnectedRecovery({
  previousState: 'reconnecting',
  nextState: 'connected',
  documentVisible: true,
  androidShellAvailable: true,
  hasSyncDemand: false,
  activeThreadId: '',
  suppressActiveThreadRecovery: false,
  pendingThreadsRefresh: false,
  hasLoadedThreads: false,
}), {
  kind: 'foreground',
  includeThreadList: true,
  forceMessageRefresh: true,
  urgent: true,
})

const visibleTaskPetThread = {
  routeThreadId: ' thread-visible ',
  displayedThreadId: 'thread-visible',
  messageCount: 2,
  loading: false,
  switching: false,
}
assert.equal(shouldAcknowledgeMobileShellTaskPetThreadOpen(visibleTaskPetThread), true)
assert.equal(shouldMarkMobileShellTaskPetThreadRead({ ...visibleTaskPetThread, inProgress: true }), false)
assert.equal(shouldMarkMobileShellTaskPetThreadRead({ ...visibleTaskPetThread, inProgress: false }), true)
assert.equal(shouldAcknowledgeMobileShellTaskPetThreadOpen({ ...visibleTaskPetThread, messageCount: 0 }), false)
assert.equal(shouldAcknowledgeMobileShellTaskPetThreadOpen({ ...visibleTaskPetThread, loading: true }), false)
assert.equal(shouldAcknowledgeMobileShellTaskPetThreadOpen({ ...visibleTaskPetThread, switching: true }), false)
assert.equal(shouldAcknowledgeMobileShellTaskPetThreadOpen({ ...visibleTaskPetThread, displayedThreadId: 'thread-other' }), false)

assert.equal(compactLatestReplyTail('  实时\\n回复  ', 260), '实时 回复')
const longReply = 'HEAD_MARKER' + '内容'.repeat(150) + 'TERMINAL_MARKER'
const replyTail = compactLatestReplyTail(longReply, 260)
assert.equal(replyTail.length, 260)
assert.equal(replyTail.includes('HEAD_MARKER'), false)
assert.equal(replyTail.endsWith('TERMINAL_MARKER'), true)

const longRunningStartedAtIso = '2026-07-18T08:00:00.000Z'
assert.equal(readRuntimeActivityStartedAtMs({
  lastStartedAtIso: longRunningStartedAtIso,
  lastCompletedAtIso: '2026-07-18T07:00:00.000Z',
}), Date.parse(longRunningStartedAtIso))
assert.equal(readRuntimeActivityStartedAtMs({
  lastStartedAtIso: '2026-07-18T08:00:00.000Z',
  lastCompletedAtIso: '2026-07-18T09:00:00.000Z',
}), null)
assert.equal(readRuntimeActivityStartedAtMs({
  lastStartedAtIso: 'invalid',
  lastCompletedAtIso: null,
}), null)

const originalWindow = globalThis.window
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('pending_start'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('start_uncertain'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('sync_degraded'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('running'), false)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('completed'), false)
assert.equal(shouldSettleOptimisticDeliveryFromRuntimeSnapshot('completed', true), true)
assert.equal(shouldSettleOptimisticDeliveryFromRuntimeSnapshot('failed', false), true)
assert.equal(shouldSettleOptimisticDeliveryFromRuntimeSnapshot('failed', true), false)

globalThis.window = globalThis
delete globalThis.__cxCodexChatFeedbackMetrics
delete globalThis.__cxCodexChatFeedbackSummary
const feedbackStartedAtMs = chatFeedbackNow() - 8
beginChatFeedbackMetric({
  threadId: 'thread-feedback',
  clientMessageId: 'client-feedback',
  optimisticMessageId: 'optimistic-feedback',
  submitStartedAtMs: feedbackStartedAtMs,
})
markChatFeedbackRequestDispatched('client-feedback')
markChatFeedbackServerAcknowledged({
  clientMessageId: 'client-feedback',
  threadId: 'thread-feedback',
  turnId: 'turn-feedback',
})
markChatFeedbackServerAcknowledged({
  threadId: 'thread-feedback',
  turnId: 'turn-feedback',
  turnStarted: true,
  turnStartedAtMs: feedbackStartedAtMs + 4,
})
markChatFeedbackFirstAssistantData({
  threadId: 'thread-feedback',
  turnId: 'turn-feedback',
  messageId: 'assistant-feedback',
})
markChatFeedbackFirstAssistantVisible({
  threadId: 'thread-feedback',
  visibleMessageIds: new Set(['assistant-feedback']),
})
markChatFeedbackRendered({
  threadId: 'thread-feedback',
  optimisticMessageId: 'optimistic-feedback',
  runningVisible: false,
})
markChatFeedbackRendered({
  threadId: 'thread-feedback',
  optimisticMessageId: 'optimistic-feedback',
  runningVisible: true,
})
const feedbackMetric = globalThis.__cxCodexChatFeedbackMetrics?.[0]
assert.equal(feedbackMetric?.clientMessageId, 'client-feedback')
assert.ok((feedbackMetric?.stateCommitLatencyMs ?? -1) >= 0)
assert.ok((feedbackMetric?.bubbleVisibleLatencyMs ?? -1) >= 0)
assert.ok((feedbackMetric?.runningVisibleLatencyMs ?? -1) >= 0)
assert.ok((feedbackMetric?.requestDispatchedLatencyMs ?? -1) >= 0)
assert.ok((feedbackMetric?.serverAcknowledgedLatencyMs ?? -1) >= 0)
assert.equal(feedbackMetric?.turnId, 'turn-feedback')
assert.equal(feedbackMetric?.turnStartedLatencyMs, 4)
assert.ok((feedbackMetric?.firstAssistantDataLatencyMs ?? -1) >= 0)
assert.equal(feedbackMetric?.firstAssistantMessageId, 'assistant-feedback')
assert.ok((feedbackMetric?.firstAssistantVisibleLatencyMs ?? -1) >= 0)
const feedbackSummary = readChatFeedbackMetricSummary()
assert.equal(feedbackSummary?.sampleCount, 1)
assert.equal(feedbackSummary?.stages.stateCommit.p50Ms, feedbackMetric?.stateCommitLatencyMs)
assert.equal(feedbackSummary?.stages.firstAssistantVisible.p95Ms, feedbackMetric?.firstAssistantVisibleLatencyMs)
assert.equal(feedbackSummary?.stages.assistantRenderOverhead.count, 1)
delete globalThis.__cxCodexChatFeedbackMetrics
delete globalThis.__cxCodexChatFeedbackSummary
if (originalWindow === undefined) delete globalThis.window
else globalThis.window = originalWindow

assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 41 }), false)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 42 }), true)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 43 }), true)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 0 }), true)
const snapshotVersionMap = {
  'thread-a': { lastEventSeq: 42, latestReplyEventSeq: 41, executionState: 'running' },
  'thread-b': { lastEventSeq: 9, latestReplyEventSeq: 0, executionState: 'completed' },
}
const resetSnapshotVersionMap = resetRuntimeSnapshotVersionMap(snapshotVersionMap)
assert.deepEqual(resetSnapshotVersionMap, {
  'thread-a': { lastEventSeq: 0, latestReplyEventSeq: 0, executionState: 'running' },
  'thread-b': { lastEventSeq: 0, latestReplyEventSeq: 0, executionState: 'completed' },
})
assert.notStrictEqual(resetSnapshotVersionMap, snapshotVersionMap)
assert.equal(snapshotVersionMap['thread-a'].lastEventSeq, 42)
const emptySnapshotVersionMap = {}
assert.strictEqual(resetRuntimeSnapshotVersionMap(emptySnapshotVersionMap), emptySnapshotVersionMap)
assert.equal(shouldApplyRuntimeTerminalTurn('turn-current', 'turn-current'), true)
assert.equal(shouldApplyRuntimeTerminalTurn('turn-current', 'turn-old'), false)
assert.equal(shouldApplyRuntimeTerminalTurn('turn-current', ''), true)
assert.equal(shouldApplyRuntimeTerminalTurn('', 'turn-old'), true)

const mergedOutbox = mergeMessageOutboxEntries([
  { clientMessageId: 'client-a', createdAtMs: 1, updatedAtMs: 3, state: 'confirming' },
  { clientMessageId: 'client-b', createdAtMs: 2, updatedAtMs: 2, state: 'sending' },
], [
  { clientMessageId: 'client-a', createdAtMs: 1, updatedAtMs: 1, state: 'sending' },
  { clientMessageId: 'client-c', createdAtMs: 3, updatedAtMs: 3, state: 'sending' },
])
assert.deepEqual(mergedOutbox.map((entry) => [entry.clientMessageId, entry.state]), [
  ['client-a', 'confirming'],
  ['client-b', 'sending'],
  ['client-c', 'sending'],
])

const removedOutbox = mergeMessageOutboxState([
  { clientMessageId: 'client-stale', createdAtMs: 1, updatedAtMs: 5, state: 'confirming' },
  { clientMessageId: 'client-newer', createdAtMs: 2, updatedAtMs: 9, state: 'sending' },
], [], [], [
  { clientMessageId: 'client-stale', removedAtMs: 6 },
  { clientMessageId: 'client-newer', removedAtMs: 8 },
])
assert.deepEqual(removedOutbox.entries.map((entry) => entry.clientMessageId), ['client-newer'])
assert.deepEqual(removedOutbox.removals, [
  { clientMessageId: 'client-stale', removedAtMs: 6 },
  { clientMessageId: 'client-newer', removedAtMs: 8 },
])

const normalizedTurnOptions = normalizeComposerTurnOptions({
  plugins: [
    { id: ' app-id ', name: ' App ', source: 'app' },
    { id: 'plugin-id', name: 'Plugin', source: 'plugin', path: ' plugin://custom ' },
    { id: '', name: 'Dropped' },
  ],
  goal: { enabled: true, text: ' keep goal whitespace ' },
})
assert.deepEqual(normalizedTurnOptions, {
  plugins: [
    { id: 'app-id', name: 'App', path: 'app://app-id', source: 'app' },
    { id: 'plugin-id', name: 'Plugin', path: 'plugin://custom', source: 'plugin' },
  ],
  goal: { enabled: true, text: 'keep goal whitespace' },
})
assert.deepEqual(cloneComposerTurnOptions(normalizedTurnOptions), normalizedTurnOptions)
assert.notEqual(cloneComposerTurnOptions(normalizedTurnOptions), normalizedTurnOptions)

const outboxNowMs = Date.parse('2026-07-20T12:00:00.000Z')
const outboxEntry = (clientMessageId, createdAtMs, updatedAtMs = createdAtMs) => ({
  clientMessageId,
  threadId: ' thread-outbox ',
  cwd: ' E:/repo ',
  text: 'message',
  imageUrls: ['image'],
  skills: [{ name: 'skill', path: 'skill/path' }],
  fileAttachments: [{ label: 'file', path: 'file.txt', fsPath: 'E:/repo/file.txt' }],
  modelId: ' model ',
  reasoningEffort: 'high',
  speedMode: 'fast',
  collaborationMode: 'plan',
  turnOptions: normalizedTurnOptions,
  baselineMatchCount: 2,
  baselineMessageCount: 4,
  baselineTailMessageId: 'baseline-tail',
  state: 'confirming',
  createdAtMs,
  updatedAtMs,
})
const parsedOutbox = parseMessageOutboxState(JSON.stringify({
  version: 1,
  entries: [
    outboxEntry('client-expired', outboxNowMs - 8 * 24 * 60 * 60 * 1000),
    outboxEntry('client-removed', outboxNowMs - 2000, outboxNowMs - 1000),
    outboxEntry('client-valid', outboxNowMs - 500),
    { ...outboxEntry('client-normalized', outboxNowMs - 250), fileAttachments: [{ label: 'bad' }] },
  ],
  removals: [{ clientMessageId: 'client-removed', removedAtMs: outboxNowMs }],
}), outboxNowMs)
assert.deepEqual(parsedOutbox.entries.map((entry) => entry.clientMessageId), [
  'client-valid',
  'client-normalized',
])
assert.equal(parsedOutbox.entries[0]?.threadId, 'thread-outbox')
assert.equal(parsedOutbox.entries[0]?.cwd, 'E:/repo')
assert.equal(parsedOutbox.entries[0]?.modelId, 'model')
assert.equal(parsedOutbox.entries[0]?.speedMode, 'fast')
assert.equal(parsedOutbox.entries[0]?.baselineMatchCount, 2)
assert.equal(parsedOutbox.entries[0]?.baselineMessageCount, 4)
assert.equal(parsedOutbox.entries[0]?.baselineTailMessageId, 'baseline-tail')
assert.deepEqual(parsedOutbox.entries[1]?.fileAttachments, [])
assert.equal(parseMessageOutboxState(JSON.stringify({
  version: 1,
  entries: [{ ...outboxEntry('client-standard-speed', outboxNowMs - 100), speedMode: 'turbo' }],
}), outboxNowMs).entries[0]?.speedMode, 'standard')
assert.deepEqual(parseMessageOutboxState('{bad json', outboxNowMs), { entries: [], removals: [] })
assert.deepEqual(parseMessageOutboxState('{"version":2,"entries":[]}', outboxNowMs), { entries: [], removals: [] })

const serializedOutbox = serializeMessageOutboxState(
  Array.from({ length: 14 }, (_, index) => outboxEntry('client-bounded-' + index, outboxNowMs - 14 + index)),
  [{ clientMessageId: 'client-old-removal', removedAtMs: outboxNowMs - 8 * 24 * 60 * 60 * 1000 }],
  outboxNowMs,
)
assert.ok(serializedOutbox)
const serializedOutboxPayload = JSON.parse(serializedOutbox)
assert.equal(serializedOutboxPayload.entries.length, 12)
assert.equal(serializedOutboxPayload.entries[0]?.clientMessageId, 'client-bounded-2')
assert.deepEqual(serializedOutboxPayload.removals, [])
assert.equal(serializeMessageOutboxState([], [], outboxNowMs), null)

class MemoryOutboxStorage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}
const parallelOutboxStorage = new MemoryOutboxStorage()
const parallelEntryA = outboxEntry('client-parallel-a', outboxNowMs - 20, outboxNowMs - 20)
const parallelEntryB = outboxEntry('client-parallel-b', outboxNowMs - 10, outboxNowMs - 10)
saveMessageOutboxStateToStorage(parallelOutboxStorage, [parallelEntryA], [], outboxNowMs)
saveMessageOutboxStateToStorage(parallelOutboxStorage, [parallelEntryB], [], outboxNowMs)
assert.deepEqual(
  loadMessageOutboxStateFromStorage(parallelOutboxStorage, outboxNowMs).entries.map((entry) => entry.clientMessageId),
  ['client-parallel-a', 'client-parallel-b'],
)
const parallelRemovalA = { clientMessageId: 'client-parallel-a', removedAtMs: outboxNowMs + 10 }
saveMessageOutboxStateToStorage(parallelOutboxStorage, [parallelEntryB], [parallelRemovalA], outboxNowMs + 10)
saveMessageOutboxStateToStorage(parallelOutboxStorage, [parallelEntryA], [], outboxNowMs + 20)
assert.deepEqual(
  loadMessageOutboxStateFromStorage(parallelOutboxStorage, outboxNowMs + 20).entries.map((entry) => entry.clientMessageId),
  ['client-parallel-b'],
)
parallelOutboxStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY + '.entry.corrupt.1', '{bad json')
saveMessageOutboxStateToStorage(parallelOutboxStorage, [parallelEntryB], [parallelRemovalA], outboxNowMs + 30)
assert.equal(parallelOutboxStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY + '.entry.corrupt.1'), null)
const boundedJournalStorage = new MemoryOutboxStorage()
for (let index = 0; index < 20; index += 1) {
  saveMessageOutboxStateToStorage(
    boundedJournalStorage,
    [outboxEntry('client-journal-updated', outboxNowMs - 100, outboxNowMs + index)],
    [],
    outboxNowMs + index,
  )
}
assert.equal(
  [...boundedJournalStorage.values.keys()].filter((key) => key.startsWith(MESSAGE_OUTBOX_STORAGE_KEY + '.entry.')).length,
  1,
)
const boundedJournalEntries = Array.from({ length: 14 }, (_, index) => (
  outboxEntry('client-journal-bounded-' + index, outboxNowMs + 100 + index, outboxNowMs + 100 + index)
))
saveMessageOutboxStateToStorage(boundedJournalStorage, boundedJournalEntries, [], outboxNowMs + 200)
assert.equal(
  [...boundedJournalStorage.values.keys()].filter((key) => key.startsWith(MESSAGE_OUTBOX_STORAGE_KEY + '.entry.')).length,
  12,
)
assert.equal(isMessageOutboxStorageKey(MESSAGE_OUTBOX_STORAGE_KEY), true)
assert.equal(isMessageOutboxStorageKey(MESSAGE_OUTBOX_STORAGE_KEY + '.entry.client.1'), true)
assert.equal(isMessageOutboxStorageKey(MESSAGE_OUTBOX_STORAGE_KEY + '.removal.client.1'), true)
assert.equal(isMessageOutboxStorageKey('unrelated.storage.key'), false)

const generatedClientMessageId = createClientMessageId()
assert.match(generatedClientMessageId, /^cm-\\d+-.+/)

const persistedIdentityMessage = {
  id: 'persisted-identity-1',
  role: 'user',
  text: '  同一条\\n消息  ',
  images: [' image-a ', ''],
  fileAttachments: [{ label: 'file-a', path: ' C:/work/a.txt ' }],
}
const optimisticIdentityMessage = {
  ...persistedIdentityMessage,
  id: 'optimistic-user:identity-1',
  text: '同一条 消息',
  images: ['image-a'],
  fileAttachments: [{ label: 'file-a', path: 'C:/work/a.txt' }],
}
const identitySignature = userMessageSignature(optimisticIdentityMessage)
assert.equal(userMessageSignature(persistedIdentityMessage), identitySignature)
const rememberedIdentityMeta = new Map([[optimisticIdentityMessage.id, {
  kind: 'optimisticUserMessage',
  signature: identitySignature,
  baselineMatchCount: 1,
  baselineMessageCount: 2,
  baselineTailMessageId: 'baseline-assistant',
  createdAtMs: 1,
}]])
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [persistedIdentityMessage],
    [optimisticIdentityMessage],
    rememberedIdentityMeta,
  ),
  [optimisticIdentityMessage],
)
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [persistedIdentityMessage, { ...persistedIdentityMessage, id: 'persisted-identity-2' }],
    [optimisticIdentityMessage],
    rememberedIdentityMeta,
  ),
  [],
)
const recoveredLegacyBaselineMatchCount = recoverOptimisticBaselineMatchCount(
  [
    persistedIdentityMessage,
    { id: 'baseline-assistant', role: 'assistant', text: 'Previous answer' },
    { ...persistedIdentityMessage, id: 'persisted-identity-2' },
  ],
  identitySignature,
  undefined,
  2,
  'baseline-assistant',
)
assert.equal(recoveredLegacyBaselineMatchCount, 1)
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [persistedIdentityMessage, { ...persistedIdentityMessage, id: 'persisted-identity-2' }],
    [optimisticIdentityMessage],
    new Map([[optimisticIdentityMessage.id, {
      ...rememberedIdentityMeta.get(optimisticIdentityMessage.id),
      baselineMatchCount: recoveredLegacyBaselineMatchCount,
    }]]),
  ),
  [],
)
assert.deepEqual(
  mergeVisibleOptimisticUserMessages(
    [
      persistedIdentityMessage,
      { id: 'baseline-assistant', role: 'assistant', text: 'Previous answer' },
      { id: 'new-assistant', role: 'assistant', text: 'Reply arrived before history acknowledgement' },
    ],
    [optimisticIdentityMessage],
    rememberedIdentityMeta,
  ).map((message) => message.id),
  ['persisted-identity-1', 'baseline-assistant', 'optimistic-user:identity-1', 'new-assistant'],
)
const persistedWithoutVisibleOptimistic = [
  { id: 'persisted-stable', role: 'assistant', text: 'Authoritative history' },
]
const mergedWithoutVisibleOptimistic = mergeVisibleOptimisticUserMessages(
  persistedWithoutVisibleOptimistic,
  [],
)
assert.notStrictEqual(
  mergedWithoutVisibleOptimistic,
  persistedWithoutVisibleOptimistic,
  'conversation projection must not alias the persisted reactive message array',
)
mergedWithoutVisibleOptimistic.push({
  id: 'live-only',
  role: 'assistant',
  text: 'Streaming delta',
})
assert.deepEqual(
  persistedWithoutVisibleOptimistic.map((message) => message.id),
  ['persisted-stable'],
  'adding a live projection must not mutate persisted history',
)
const optimisticAfterFirst = { id: 'optimistic-user:after-first', role: 'user', text: 'First queued prompt' }
const optimisticAfterLast = { id: 'optimistic-user:after-last', role: 'user', text: 'Second queued prompt' }
assert.deepEqual(
  mergeVisibleOptimisticUserMessages(
    [
      { id: 'persisted-a', role: 'assistant', text: 'A' },
      { id: 'persisted-b', role: 'assistant', text: 'B' },
      { id: 'persisted-c', role: 'assistant', text: 'C' },
    ],
    [optimisticAfterFirst, optimisticAfterLast],
    new Map([
      [optimisticAfterFirst.id, {
        kind: 'optimisticUserMessage',
        signature: userMessageSignature(optimisticAfterFirst),
        baselineMatchCount: 0,
        baselineMessageCount: 1,
        baselineTailMessageId: 'persisted-a',
        createdAtMs: 2,
      }],
      [optimisticAfterLast.id, {
        kind: 'optimisticUserMessage',
        signature: userMessageSignature(optimisticAfterLast),
        baselineMatchCount: 0,
        baselineMessageCount: 3,
        baselineTailMessageId: 'persisted-c',
        createdAtMs: 3,
      }],
    ]),
  ).map((message) => message.id),
  ['persisted-a', 'optimistic-user:after-first', 'persisted-b', 'persisted-c', 'optimistic-user:after-last'],
)

const repeatedPrompt = { id: 'optimistic-user:repeated-current', role: 'user', text: '帮我进行下一步' }
const repeatedPromptMeta = new Map([[repeatedPrompt.id, {
  kind: 'optimisticUserMessage',
  signature: userMessageSignature(repeatedPrompt),
  baselineMatchCount: 1,
  baselineMessageCount: 120,
  baselineTailMessageId: 'history-anchor-outside-current-page',
  authoritativeTurnId: 'turn-current-repeat',
  createdAtMs: 4,
}]])
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [{
      id: 'persisted-current-repeat',
      role: 'user',
      text: '帮我进行下一步',
      turnId: 'turn-current-repeat',
      turnIndex: 48,
    }],
    [repeatedPrompt],
    repeatedPromptMeta,
  ),
  [],
  'turn identity must acknowledge a repeated prompt even when its older baseline match is outside the loaded page',
)
const laterRepeatedPrompt = { ...repeatedPrompt, id: 'optimistic-user:repeated-later' }
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [{
      id: 'persisted-current-repeat',
      role: 'user',
      text: '帮我进行下一步',
      turnId: 'turn-current-repeat',
      turnIndex: 48,
    }],
    [repeatedPrompt, laterRepeatedPrompt],
    new Map([
      ...repeatedPromptMeta,
      [laterRepeatedPrompt.id, {
        ...repeatedPromptMeta.get(repeatedPrompt.id),
        authoritativeTurnId: 'turn-later-repeat',
        createdAtMs: 5,
      }],
    ]),
  ).map((message) => message.id),
  ['optimistic-user:repeated-later'],
  'two intentional identical prompts must remain distinct until each own turn is authoritative',
)

const laterUnboundRepeatedPrompt = { ...repeatedPrompt, id: 'optimistic-user:repeated-later-unbound' }
assert.deepEqual(
  filterVisibleOptimisticUserMessages(
    [
      {
        id: 'persisted-first-repeat',
        role: 'user',
        text: '帮我进行下一步',
        turnId: 'turn-first-repeat',
        turnIndex: 48,
      },
      {
        id: 'persisted-later-repeat',
        role: 'user',
        text: '帮我进行下一步',
        turnId: 'turn-later-repeat',
        turnIndex: 49,
      },
    ],
    [repeatedPrompt, laterUnboundRepeatedPrompt],
    new Map([
      [repeatedPrompt.id, {
        ...repeatedPromptMeta.get(repeatedPrompt.id),
        baselineMatchCount: 0,
        baselineMessageCount: 0,
        baselineTailMessageId: '',
        authoritativeTurnId: 'turn-first-repeat',
      }],
      [laterUnboundRepeatedPrompt.id, {
        ...repeatedPromptMeta.get(repeatedPrompt.id),
        baselineMatchCount: 1,
        baselineMessageCount: 1,
        baselineTailMessageId: 'persisted-first-repeat',
        authoritativeTurnId: undefined,
        createdAtMs: 5,
      }],
    ]),
  ),
  [],
  'an authoritative earlier prompt must not consume the signature acknowledgement for a later baseline',
)

const detachedFailedMessage = {
  id: 'optimistic-user:failed-outside-page',
  role: 'user',
  text: '历史失败消息',
  deliveryState: 'failed',
}
const detachedFailedMeta = new Map([[detachedFailedMessage.id, {
  kind: 'optimisticUserMessage',
  signature: userMessageSignature(detachedFailedMessage),
  baselineMatchCount: 0,
  baselineMessageCount: 80,
  baselineTailMessageId: 'failed-message-anchor-outside-current-page',
  createdAtMs: 6,
}]])
const currentPageMessages = [
  { id: 'current-page-user', role: 'user', text: '最新问题', turnId: 'turn-latest', turnIndex: 90 },
  { id: 'current-page-assistant', role: 'assistant', text: '最新回复', turnId: 'turn-latest', turnIndex: 90 },
]
assert.deepEqual(
  selectDetachedFailedOptimisticUserMessages(
    currentPageMessages,
    [detachedFailedMessage],
    detachedFailedMeta,
  ).map((message) => message.id),
  ['optimistic-user:failed-outside-page'],
  'a recovered failed message whose anchor is outside the page must move to the recovery tray',
)
assert.deepEqual(
  mergeVisibleOptimisticUserMessages(
    currentPageMessages,
    [detachedFailedMessage],
    detachedFailedMeta,
  ).map((message) => message.id),
  ['current-page-user', 'current-page-assistant'],
  'a detached historical failure must not be appended below the newest reply',
)
const anchoredFailedMessages = [
  { id: 'loaded-failed-anchor', role: 'assistant', text: '原位置前的回复', turnId: 'turn-old', turnIndex: 12 },
  ...currentPageMessages,
]
const anchoredFailedMeta = new Map([[detachedFailedMessage.id, {
  ...detachedFailedMeta.get(detachedFailedMessage.id),
  baselineMessageCount: 1,
  baselineTailMessageId: 'loaded-failed-anchor',
}]])
assert.deepEqual(
  selectDetachedFailedOptimisticUserMessages(
    anchoredFailedMessages,
    [detachedFailedMessage],
    anchoredFailedMeta,
  ),
  [],
  'a failed message must stay in the transcript when its original anchor is loaded',
)
assert.deepEqual(
  mergeVisibleOptimisticUserMessages(
    anchoredFailedMessages,
    [detachedFailedMessage],
    anchoredFailedMeta,
  ).map((message) => message.id),
  ['loaded-failed-anchor', 'optimistic-user:failed-outside-page', 'current-page-user', 'current-page-assistant'],
)

const generatedImageMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-generated-image',
    cwd: 'E:\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [{
      id: 'turn-generated-image',
      status: 'completed',
      items: [{
        id: 'generated-image-1',
        type: 'imageGeneration',
        status: 'completed',
        savedPath: 'C:\\work\\generated.png',
        result: 'a'.repeat(512),
      }],
    }],
  },
})
assert.equal(generatedImageMessages.length, 1)
assert.equal(generatedImageMessages[0]?.messageType, 'imageGeneration')
assert.deepEqual(generatedImageMessages[0]?.images, ['C:\\work\\generated.png'])

const internalContextMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-internal-context',
    cwd: 'E:\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [{
      id: 'turn-internal-context',
      status: 'completed',
      items: [
        {
          id: 'internal-agents-context',
          type: 'userMessage',
          content: [{ type: 'text', text: '# AGENTS.md instructions for E:\\repo\\n<INSTRUCTIONS>internal only</INSTRUCTIONS>' }],
        },
        {
          id: 'internal-environment-context',
          type: 'userMessage',
          content: [{ type: 'text', text: '<environment_context>internal only</environment_context>' }],
        },
        {
          id: 'visible-user-message',
          type: 'userMessage',
          content: [{ type: 'text', text: 'Visible request' }],
        },
      ],
    }],
  },
})
assert.deepEqual(internalContextMessages.map((message) => message.text), ['Visible request'])

const historyNoticeMessage = {
  id: 'history-notice',
  role: 'system',
  text: 'Older history available',
  messageType: 'history.notice',
}
const projectedTurnTwo = {
  id: 'projected-turn-2',
  role: 'assistant',
  text: 'turn two',
  turnIndex: 2,
}
const projectedTurnZero = {
  id: 'projected-turn-0',
  role: 'user',
  text: 'turn zero',
  turnIndex: 0,
}
assert.equal(areMessageFieldsEqual(projectedTurnTwo, { ...projectedTurnTwo }), true)
assert.equal(areMessageFieldsEqual(projectedTurnTwo, { ...projectedTurnTwo, text: 'changed' }), false)
assert.equal(areMessageFieldsEqual(
  { ...projectedTurnTwo, messageType: 'agentMessage', phase: 'commentary' },
  { ...projectedTurnTwo, messageType: 'agentMessage', phase: 'final' },
), false)
assert.equal(areMessageFieldsEqual(projectedTurnTwo, {
  ...projectedTurnTwo,
  fileAttachments: [{ label: 'report', path: 'report.txt' }],
}), false)
const projectedCommand = {
  id: 'command-projection',
  role: 'assistant',
  text: '',
  commandExecution: {
    command: 'npm test',
    cwd: 'E:/repo',
    status: 'inProgress',
    aggregatedOutput: '',
    exitCode: null,
    durationMs: null,
    startedAtMs: 1,
  },
}
assert.equal(areMessageFieldsEqual(projectedCommand, {
  ...projectedCommand,
  commandExecution: { ...projectedCommand.commandExecution, command: 'npm run test' },
}), false)
const projectedPlan = {
  id: 'plan:turn-projection',
  role: 'system',
  text: '',
  messageType: 'plan',
  plan: {
    turnId: 'turn-projection',
    explanation: 'Plan safely',
    steps: [{ step: 'Inspect', status: 'pending' }],
    rawText: '',
    isStreaming: false,
  },
}
assert.equal(areMessageFieldsEqual(projectedPlan, { ...projectedPlan, plan: { ...projectedPlan.plan } }), true)
assert.equal(areMessageFieldsEqual(projectedPlan, {
  ...projectedPlan,
  plan: { ...projectedPlan.plan, steps: [{ step: 'Inspect', status: 'completed' }] },
}), false)
assert.equal(hasPlanImplementationConfirmation([
  projectedPlan,
  { id: 'plan-confirmation', role: 'user', text: PLAN_IMPLEMENTATION_CONFIRMATION },
], projectedPlan.id), true)
assert.equal(hasPlanImplementationConfirmation([
  projectedPlan,
  { id: 'ordinary-follow-up', role: 'user', text: '继续检查，但先不要执行' },
], projectedPlan.id), false)
assert.equal(hasPlanImplementationConfirmation([
  projectedPlan,
  { ...projectedPlan, id: 'plan:newer-turn' },
  { id: 'late-confirmation', role: 'user', text: PLAN_IMPLEMENTATION_CONFIRMATION },
], projectedPlan.id), false)
assert.equal(areMessageFieldsEqual(projectedCommand, {
  ...projectedCommand,
  commandExecution: { ...projectedCommand.commandExecution, cwd: 'E:/other' },
}), false)
const unchangedProjection = [projectedTurnTwo]
assert.equal(mergeMessages(unchangedProjection, [{ ...projectedTurnTwo }]), unchangedProjection)
assert.deepEqual(
  sortMessagesByTurnIndex([projectedTurnTwo, historyNoticeMessage, projectedTurnZero]).map((message) => message.id),
  ['history-notice', 'projected-turn-0', 'projected-turn-2'],
)
const mergedOlderHistory = mergeMessages(
  [historyNoticeMessage, projectedTurnTwo],
  [projectedTurnZero],
  true,
  true,
  true,
)
assert.deepEqual(mergedOlderHistory.map((message) => message.id), ['projected-turn-0', 'projected-turn-2'])
const authoritativeTurnReplacement = mergeMessages(
  [
    { id: 'cached-turn-1', role: 'assistant', text: 'same final answer', turnIndex: 1 },
    { id: 'fallback-turn-2', role: 'assistant', text: 'same final answer', turnIndex: 2 },
    { id: 'response-turn-2', role: 'assistant', text: 'same final answer', turnIndex: 2 },
  ],
  [{ id: 'item-turn-2', role: 'assistant', text: 'same final answer', turnIndex: 2 }],
  true,
  false,
  false,
  true,
)
assert.deepEqual(
  authoritativeTurnReplacement.map((message) => message.id),
  ['cached-turn-1', 'item-turn-2'],
)
const activeTurnUserReplacement = mergeMessages(
  [{
    id: 'msg_cached_user',
    role: 'user',
    text: 'same active prompt',
    messageType: 'userMessage',
    turnIndex: 9,
    turnId: 'turn-active',
  }],
  [{
    id: 'item_authoritative_user',
    role: 'user',
    text: 'same active prompt',
    messageType: 'userMessage',
    turnIndex: 100,
    turnId: 'turn-active',
  }],
  true,
)
assert.deepEqual(
  activeTurnUserReplacement.map((message) => message.id),
  ['item_authoritative_user'],
)
const cachedProjectionMustNotReplaceAuthoritativeOrder = mergeMessages(
  [
    { id: 'item-user-a', role: 'user', text: 'older prompt', messageType: 'userMessage', turnIndex: 100, turnId: 'turn-a' },
    { id: 'item-agent-a', role: 'assistant', text: 'older answer', messageType: 'agentMessage', phase: 'final', turnIndex: 100, turnId: 'turn-a' },
    { id: 'item-user-b', role: 'user', text: 'current prompt', messageType: 'userMessage', turnIndex: 101, turnId: 'turn-b' },
  ],
  [
    { id: 'msg-user-a', role: 'user', text: 'older prompt', messageType: 'userMessage', turnIndex: 8, turnId: 'turn-a' },
    { id: 'msg-agent-a', role: 'assistant', text: 'older answer', messageType: 'agentMessage', turnIndex: 8, turnId: 'turn-a' },
    { id: 'fallback-current-user', role: 'user', text: 'current prompt', messageType: 'userMessage', turnIndex: 9, turnId: 'fallback-turn-9' },
    { id: 'msg-current-agent', role: 'assistant', text: 'new progress', messageType: 'agentMessage', phase: 'commentary', turnIndex: 9, turnId: 'turn-b' },
  ],
  true,
  false,
  false,
  false,
  'lower',
)
assert.deepEqual(
  cachedProjectionMustNotReplaceAuthoritativeOrder.map((message) => message.id),
  ['item-user-a', 'item-agent-a', 'item-user-b', 'msg-current-agent'],
  'a lower-authority session projection must preserve authoritative order and append only unseen progress',
)
const freshAuthorityMustRestoreCanonicalOrder = mergeMessages(
  [
    { id: 'item-agent-first', role: 'assistant', text: 'first answer', messageType: 'agentMessage', phase: 'final', turnIndex: 0, turnId: 'turn-first' },
    { id: 'item-user-first', role: 'user', text: 'first prompt', messageType: 'userMessage', turnIndex: 0, turnId: 'turn-first' },
    { id: 'item-user-followup', role: 'user', text: 'follow-up prompt', messageType: 'userMessage', turnIndex: 1, turnId: 'turn-followup' },
  ],
  [
    { id: 'item-user-first', role: 'user', text: 'first prompt', messageType: 'userMessage', turnIndex: 0, turnId: 'turn-first' },
    { id: 'item-agent-first', role: 'assistant', text: 'first answer', messageType: 'agentMessage', phase: 'final', turnIndex: 0, turnId: 'turn-first' },
    { id: 'item-user-followup', role: 'user', text: 'follow-up prompt', messageType: 'userMessage', turnIndex: 1, turnId: 'turn-followup' },
    { id: 'item-agent-followup', role: 'assistant', text: 'follow-up answer', messageType: 'agentMessage', phase: 'final', turnIndex: 1, turnId: 'turn-followup' },
  ],
  true,
)
assert.deepEqual(
  freshAuthorityMustRestoreCanonicalOrder.map((message) => message.id),
  ['item-user-first', 'item-agent-first', 'item-user-followup', 'item-agent-followup'],
  'a fresh authoritative projection must restore App Server item order after a live merge',
)
assert.deepEqual(
  mergeMessages(
    [
      { id: 'item-overlap-user-a', role: 'user', text: 'unique overlap prompt', messageType: 'userMessage', turnId: 'turn-overlap-a' },
      { id: 'item-overlap-agent-a', role: 'assistant', text: 'unique overlap answer', messageType: 'agentMessage', turnId: 'turn-overlap-a' },
      { id: 'item-overlap-user-b', role: 'user', text: 'continue', messageType: 'userMessage', turnId: 'turn-overlap-b' },
    ],
    [
      { id: 'msg-stale-duplicate-anchor', role: 'user', text: 'continue', messageType: 'userMessage', turnId: 'turn-stale' },
      { id: 'msg-stale-answer', role: 'assistant', text: 'stale answer', messageType: 'agentMessage', turnId: 'turn-stale' },
      { id: 'msg-overlap-user-a', role: 'user', text: 'unique overlap prompt', messageType: 'userMessage', turnId: 'turn-overlap-a' },
      { id: 'msg-overlap-agent-a', role: 'assistant', text: 'unique overlap answer', messageType: 'agentMessage', turnId: 'turn-overlap-a' },
      { id: 'fallback-overlap-user-b', role: 'user', text: 'continue', messageType: 'userMessage', turnId: 'fallback-turn-22' },
      { id: 'msg-overlap-progress', role: 'assistant', text: 'latest progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-overlap-b' },
    ],
    true,
    false,
    false,
    false,
    'lower',
  ).map((message) => message.id),
  ['item-overlap-user-a', 'item-overlap-agent-a', 'item-overlap-user-b', 'msg-overlap-progress'],
  'a repeated short message must not anchor a lower-authority cache to stale history',
)
const authoritativeAssistantReplacement = mergeMessages(
  [{
    id: 'msg-cached-agent',
    role: 'assistant',
    text: 'same final answer',
    messageType: 'agentMessage',
    turnIndex: 9,
    turnId: 'turn-agent',
  }],
  [{
    id: 'item-authoritative-agent',
    role: 'assistant',
    text: 'same final answer',
    messageType: 'agentMessage',
    phase: 'final',
    turnIndex: 100,
    turnId: 'turn-agent',
  }],
  true,
)
assert.deepEqual(
  authoritativeAssistantReplacement.map((message) => message.id),
  ['item-authoritative-agent'],
  'a fresh App Server item must replace the matching cached assistant occurrence',
)
assert.deepEqual(
  mergeMessages(
    [
      { id: 'msg-agent-first', role: 'assistant', text: 'same progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-repeat' },
      { id: 'msg-agent-second', role: 'assistant', text: 'same progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-repeat' },
    ],
    [
      { id: 'item-agent-first', role: 'assistant', text: 'same progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-repeat' },
      { id: 'item-agent-second', role: 'assistant', text: 'same progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-repeat' },
    ],
    true,
  ).map((message) => message.id),
  ['item-agent-first', 'item-agent-second'],
  'occurrence-aware reconciliation must preserve two legitimate identical assistant messages in one turn',
)
assert.deepEqual(
  mergeMessages(
    [{ id: 'item-existing', role: 'assistant', text: 'existing answer', messageType: 'agentMessage', turnId: 'turn-existing' }],
    [
      { id: 'msg-unrelated-history', role: 'assistant', text: 'unrelated history', messageType: 'agentMessage', turnId: 'turn-old' },
      { id: 'fallback-new-user', role: 'user', text: 'brand new prompt', messageType: 'userMessage', turnId: 'fallback-turn-20' },
      { id: 'msg-new-progress', role: 'assistant', text: 'brand new progress', messageType: 'agentMessage', phase: 'commentary', turnId: 'turn-new' },
    ],
    true,
    false,
    false,
    false,
    'lower',
  ).map((message) => message.id),
  ['item-existing', 'fallback-new-user', 'msg-new-progress'],
  'a cache projection without overlap must add only its newest user-owned suffix',
)
assert.deepEqual(
  mergeMessages(
    [{ id: 'fallback-current-continue', role: 'user', text: 'continue', messageType: 'userMessage', turnIndex: 100, turnId: 'fallback-turn-current' }],
    [{ id: 'item-older-continue', role: 'user', text: 'continue', messageType: 'userMessage', turnIndex: 10, turnId: 'turn-older' }],
    true,
    true,
    true,
    false,
    'older',
  ).map((message) => message.id),
  ['item-older-continue', 'fallback-current-continue'],
  'loading an older page must not replace the current fallback message by equal text',
)
assert.deepEqual(
  mergeMessages(
    [{ id: 'same-user-turn-8', role: 'user', text: 'repeatable prompt', messageType: 'userMessage', turnIndex: 8, turnId: 'turn-8' }],
    [{ id: 'same-user-turn-9', role: 'user', text: 'repeatable prompt', messageType: 'userMessage', turnIndex: 9, turnId: 'turn-9' }],
    true,
  ).map((message) => message.id),
  ['same-user-turn-8', 'same-user-turn-9'],
)
assert.deepEqual(
  mergeMessages(
    [{ id: 'same-text-turn-1', role: 'assistant', text: 'repeatable answer', turnIndex: 1 }],
    [{ id: 'same-text-turn-2', role: 'assistant', text: 'repeatable answer', turnIndex: 2 }],
    true,
    false,
    false,
    true,
  ).map((message) => message.id),
  ['same-text-turn-1', 'same-text-turn-2'],
)
const laterHistoryMessages = [historyNoticeMessage, projectedTurnTwo]
assert.equal(removeStaleHistoryNoticeAfterOlderMerge(laterHistoryMessages), laterHistoryMessages)
assert.deepEqual(
  removeStaleHistoryNoticeAfterOlderMerge([historyNoticeMessage, projectedTurnZero]).map((message) => message.id),
  ['projected-turn-0'],
)
const liveAgentProjection = {
  id: 'live-agent-projection',
  role: 'assistant',
  text: 'same live text',
  messageType: 'agentMessage.live',
}
assert.deepEqual(
  removeRedundantLiveAgentMessages(
    [liveAgentProjection],
    [{ ...projectedTurnTwo, text: ' same\\n live text ' }],
  ),
  [],
)
assert.deepEqual(
  removeRedundantLiveAgentMessages(
    [liveAgentProjection],
    [
      { id: 'old-agent-same-text', role: 'assistant', text: 'same live text', messageType: 'agentMessage', turnId: 'old-turn' },
      { id: 'current-user', role: 'user', text: 'new request', messageType: 'userMessage', turnId: 'current-turn' },
    ],
  ).map((message) => message.id),
  ['live-agent-projection'],
  'an old equal assistant message must not suppress current live output',
)
assert.deepEqual(
  removeRedundantLiveAgentMessages(
    [liveAgentProjection],
    [
      { id: 'current-user', role: 'user', text: 'new request', messageType: 'userMessage', turnId: 'current-turn' },
      { id: 'current-agent-same-text', role: 'assistant', text: 'same live text', messageType: 'agentMessage', turnId: 'current-turn' },
    ],
  ),
  [],
  'the same assistant message persisted in the active tail must suppress its live copy',
)
assert.equal(upsertMessage(unchangedProjection, { ...projectedTurnTwo }), unchangedProjection)
assert.deepEqual(
  upsertMessage(unchangedProjection, projectedTurnZero).map((message) => message.id),
  ['projected-turn-2', 'projected-turn-0'],
)

const retryAttempts = []
const retryFeedback = []
const retryWaits = []
const recoveredAfterRetry = await runWithBoundedRecovery({
  retryDelaysMs: [650, 1800],
  run: async (attemptIndex) => {
    retryAttempts.push(attemptIndex)
    if (attemptIndex === 0) throw new TypeError('Failed to fetch')
    return 'running'
  },
  recover: async () => null,
  shouldRetry: (error) => error instanceof TypeError,
  onRetry: (retryNumber, maxRetries) => retryFeedback.push([retryNumber, maxRetries]),
  wait: async (delayMs) => { retryWaits.push(delayMs) },
})
assert.equal(recoveredAfterRetry, 'running')
assert.deepEqual(retryAttempts, [0, 1])
assert.deepEqual(retryFeedback, [[1, 2]])
assert.deepEqual(retryWaits, [650])

let lostResponseAttempts = 0
const recoveredLostResponse = await runWithBoundedRecovery({
  retryDelaysMs: [650, 1800],
  run: async () => {
    lostResponseAttempts += 1
    throw new Error('Runtime turn start request timed out')
  },
  recover: async () => 'start_uncertain',
  shouldRetry: () => true,
})
assert.equal(recoveredLostResponse, 'start_uncertain')
assert.equal(lostResponseAttempts, 1)

const exhaustedAttempts = []
const exhaustedWaits = []
await assert.rejects(() => runWithBoundedRecovery({
  retryDelaysMs: [650, 1800],
  run: async (attemptIndex) => {
    exhaustedAttempts.push(attemptIndex)
    throw new TypeError('Failed to fetch')
  },
  recover: async () => null,
  shouldRetry: () => true,
  wait: async (delayMs) => { exhaustedWaits.push(delayMs) },
}), /Failed to fetch/)
assert.deepEqual(exhaustedAttempts, [0, 1, 2])
assert.deepEqual(exhaustedWaits, [650, 1800])

let definiteFailureAttempts = 0
await assert.rejects(() => runWithBoundedRecovery({
  retryDelaysMs: [650, 1800],
  run: async () => {
    definiteFailureAttempts += 1
    throw new Error('Permission denied')
  },
  recover: async () => null,
  shouldRetry: () => false,
}), /Permission denied/)
assert.equal(definiteFailureAttempts, 1)

let rejectedRecoveryAttempts = 0
await assert.rejects(() => runWithBoundedRecovery({
  retryDelaysMs: [650, 1800],
  run: async () => {
    rejectedRecoveryAttempts += 1
    throw new TypeError('Failed to fetch')
  },
  recover: async () => { throw new Error('Server rejected the request') },
  shouldRetry: () => true,
}), /Server rejected the request/)
assert.equal(rejectedRecoveryAttempts, 1)

const messages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-a',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [
      {
        id: 'turn-a',
        status: 'completed',
        items: [
          { id: 'item-known', type: 'agentMessage', text: 'Known message' },
          { id: 'item-plan', type: 'plan', text: '1. Inspect\\n2. Implement' },
          {
            id: 'item-mcp',
            type: 'mcpToolCall',
            server: 'browser',
            tool: 'snapshot',
            status: 'completed',
            arguments: { page: 'mobile' },
            result: { text: 'internal details' },
            error: null,
            durationMs: 123,
          },
          {
            id: 'item-file-change',
            type: 'fileChange',
            changes: Array.from({ length: 4 }, (_, index) => ({
              path: \`src/generated-\${index}.ts\`,
              status: 'modified',
              diff: 'large internal patch details',
            })),
          },
          {
            id: 'item-web-search',
            type: 'webSearch',
            query: 'Codex desktop parity',
            action: { type: 'search', query: 'Codex desktop parity' },
          },
          {
            id: 'item-new',
            type: 'threadShellCommandOutput',
            command: 'secret command',
            output: 'secret output',
          },
          null,
        ],
      },
    ],
  },
})

assert.equal(messages.length, 4)
assert.equal(messages[0]?.messageType, 'agentMessage')
assert.equal(messages[0]?.turnId, 'turn-a')
assert.equal(messages[1]?.role, 'system')
assert.equal(messages[1]?.id, 'plan:turn-a')
assert.equal(messages[1]?.messageType, 'plan')
assert.equal(messages[1]?.plan?.turnId, 'turn-a')
assert.equal(messages[1]?.plan?.rawText, '1. Inspect\\n2. Implement')
assert.equal(messages[1]?.plan?.isStreaming, false)
assert.equal(messages[2]?.messageType, 'unhandled.threadShellCommandOutput')
assert.equal(messages[2]?.text, 'Unhandled App Server item: threadShellCommandOutput')
assert.equal(messages[2]?.isUnhandled, true)
assert.equal(messages[2]?.turnIndex, 0)
assert.equal(messages[2]?.rawPayload?.includes('secret command'), true)
assert.equal(messages[3]?.messageType, 'unhandled.invalidItem')
assert.equal(messages[3]?.isUnhandled, true)
assert.equal(messages.some((message) => message.messageType === 'unhandled.fileChange'), false)
assert.equal(messages.some((message) => message.messageType === 'unhandled.webSearch'), false)
assert.equal(messages.some((message) => message.rawPayload?.includes('large internal patch details')), false)

const phasedAgentMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-phased-agent',
    cwd: 'E:\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [{
      id: 'turn-phased-agent',
      status: 'completed',
      items: [
        { id: 'agent-commentary', type: 'agentMessage', text: 'Still working', phase: 'commentary' },
        { id: 'agent-final', type: 'agentMessage', text: 'Done', phase: 'final' },
      ],
    }],
  },
})
assert.equal(phasedAgentMessages[0]?.phase, 'commentary')
assert.equal(phasedAgentMessages[1]?.phase, 'final')

const unloadedTurnMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-items-view',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [
      {
        id: 'turn-summary',
        status: 'completed',
        itemsView: 'summary',
        items: [],
      },
    ],
  },
})

assert.equal(unloadedTurnMessages.length, 1)
assert.equal(unloadedTurnMessages[0]?.id, 'turn-summary')
assert.equal(unloadedTurnMessages[0]?.role, 'system')
assert.equal(unloadedTurnMessages[0]?.messageType, 'unhandled.turnItemsView.summary')
assert.equal(unloadedTurnMessages[0]?.text, 'App Server turn items not loaded: summary')
assert.equal(unloadedTurnMessages[0]?.isUnhandled, true)
assert.equal(unloadedTurnMessages[0]?.turnIndex, 0)
assert.equal(unloadedTurnMessages[0]?.rawPayload?.includes('"itemsView": "summary"'), true)

const recentTurnMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-recent-view',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turnsView: 'recent',
    originalTurnsCount: 4,
    turnsStartIndex: 2,
    turns: [
      {
        id: 'turn-3',
        status: 'completed',
        items: [{ id: 'agent-3', type: 'agentMessage', text: 'Recent answer 3' }],
      },
      {
        id: 'turn-4',
        status: 'completed',
        items: [{ id: 'agent-4', type: 'agentMessage', text: 'Recent answer 4' }],
      },
    ],
  },
})

assert.equal(recentTurnMessages.length, 3)
assert.equal(recentTurnMessages[0]?.role, 'system')
assert.equal(recentTurnMessages[0]?.messageType, 'history.notice')
assert.equal(recentTurnMessages[0]?.text, '已优先显示最近 2 轮，较早 2 轮已折叠以保持流畅。')
assert.equal(recentTurnMessages[0]?.isUnhandled, undefined)
assert.equal(recentTurnMessages[0]?.rawPayload, undefined)
assert.equal(recentTurnMessages[1]?.messageType, 'agentMessage')
assert.equal(recentTurnMessages[1]?.turnId, 'turn-3')
assert.equal(recentTurnMessages[1]?.turnIndex, 2)
assert.equal(recentTurnMessages[2]?.turnIndex, 3)

const activeCachedMessages = [
  { id: 'old-user', role: 'user', text: 'repeatable prompt', messageType: 'userMessage', turnId: 'turn-old', turnIndex: 98 },
  { id: 'old-agent', role: 'assistant', text: 'old answer', messageType: 'agentMessage', turnId: 'turn-old', turnIndex: 98 },
  { id: 'cached-user', role: 'user', text: 'repeatable prompt', messageType: 'userMessage', turnId: 'msg-fallback', turnIndex: 9 },
  { id: 'cached-agent', role: 'assistant', text: 'working', messageType: 'agentMessage', turnId: 'fallback-after-compaction', turnIndex: 18 },
]
const activeCachedMessagesWithStableTurn = applyActiveTurnIdToMessages(
  activeCachedMessages,
  'turn-active',
  true,
)
assert.deepEqual(
  activeCachedMessagesWithStableTurn.map((message) => message.turnId),
  ['turn-old', 'turn-old', 'turn-active', 'turn-active'],
)
assert.strictEqual(applyActiveTurnIdToMessages(activeCachedMessages, 'turn-active', false), activeCachedMessages)

const olderTurnMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-recent-view',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turnsView: 'older',
    originalTurnsCount: 8,
    turnsStartIndex: 2,
    turns: [
      {
        id: 'turn-3',
        status: 'completed',
        items: [{ id: 'agent-3-old', type: 'agentMessage', text: 'Older answer 3' }],
      },
      {
        id: 'turn-4',
        status: 'completed',
        items: [{ id: 'agent-4-old', type: 'agentMessage', text: 'Older answer 4' }],
      },
    ],
  },
})

assert.equal(olderTurnMessages[0]?.id, 'thread-recent-view:history-window-notice')
assert.equal(olderTurnMessages[0]?.messageType, 'history.notice')
assert.equal(olderTurnMessages[0]?.text, '已加载较早 2 轮，前面还有 2 轮可继续加载。')
assert.equal(olderTurnMessages[1]?.turnIndex, 2)
assert.equal(olderTurnMessages[2]?.turnIndex, 3)

const groups = normalizeThreadGroupsV2({
  data: [
    {
      id: 'thread-cli',
      cwd: 'E:\\\\repo',
      preview: 'CLI thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 3,
      path: null,
      source: 'cli',
      gitInfo: null,
      turns: [],
    },
    {
      id: 'thread-cli',
      cwd: 'E:\\\\repo',
      preview: 'Duplicate cursor-page thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 4,
      path: null,
      source: 'cli',
      gitInfo: null,
      turns: [],
    },
    {
      id: 'thread-sub-agent',
      cwd: 'E:\\\\repo',
      preview: 'Sub-agent thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 2,
      path: null,
      source: { subAgent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      gitInfo: null,
      turns: [],
    },
    {
      id: 'thread-future-source',
      cwd: 'E:\\\\repo',
      preview: 'Future source thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 1,
      path: null,
      source: { futureSource: { enabled: true } },
      gitInfo: null,
      turns: [],
    },
  ],
  nextCursor: null,
})

assert.equal(groups.length, 1)
assert.deepEqual(groups[0]?.threads.map((thread) => thread.id), ['thread-cli', 'thread-sub-agent', 'thread-future-source'])
assert.equal(groups[0]?.threads[0]?.preview, 'CLI thread')
assert.equal(groups[0]?.threads[0]?.sourceKind, 'cli')
assert.equal(groups[0]?.threads[1]?.sourceKind, 'subAgent.thread_spawn')
assert.equal(groups[0]?.threads[2]?.sourceKind, 'futureSource')

const recentProjectGroups = orderProjectGroupsByRecentActivity([
  {
    projectName: 'empty-project',
    threads: [],
  },
  {
    projectName: 'older-project',
    threads: [{ ...groups[0].threads[0], id: 'older-thread', updatedAtIso: '2026-01-01T00:00:00.000Z' }],
  },
  {
    projectName: 'newer-project',
    threads: [{ ...groups[0].threads[0], id: 'newer-thread', updatedAtIso: '2026-02-01T00:00:00.000Z' }],
  },
  {
    projectName: 'pinned-project',
    isPinnedProject: true,
    pinnedProjectRank: 0,
    threads: [{ ...groups[0].threads[0], id: 'pinned-thread', updatedAtIso: '2025-01-01T00:00:00.000Z' }],
  },
])

assert.deepEqual(recentProjectGroups.map((group) => group.projectName), [
  'newer-project',
  'older-project',
  'pinned-project',
  'empty-project',
])

const sharedThreadBase = {
  ...groups[0].threads[0],
  id: 'shared-thread',
  title: '帮我优化',
  createdAtIso: '2026-07-30T13:00:00.000Z',
  updatedAtIso: '2026-07-30T14:00:00.000Z',
}
assert.equal(areUiThreadFieldsEqual(sharedThreadBase, { ...sharedThreadBase }), true)
assert.equal(
  areUiThreadFieldsEqual(sharedThreadBase, { ...sharedThreadBase, hasWorktree: !sharedThreadBase.hasWorktree }),
  false,
)
const unresolvedSharedThread = {
  ...sharedThreadBase,
  projectName: 'unknown-project',
  cwd: '',
  preview: '帮我优化',
}
const resolvedSharedThread = {
  ...sharedThreadBase,
  projectName: 'CXCodex',
  cwd: 'E:\\\\javaword\\\\CXCodex',
  preview: 'Github 上帮我找个关于找工作有帮助的热门技能',
}

const dedupedProjectGroups = dedupeProjectThreadGroups([
  { projectName: 'unknown-project', threads: [unresolvedSharedThread] },
  { projectName: 'CXCodex', threads: [resolvedSharedThread] },
])
assert.equal(dedupedProjectGroups.flatMap((group) => group.threads).length, 1)
assert.equal(dedupedProjectGroups.length, 1)
assert.equal(dedupedProjectGroups[0].projectName, 'CXCodex')
assert.equal(dedupedProjectGroups[0].threads[0].cwd, 'E:\\\\javaword\\\\CXCodex')

const protectedResolvedProject = upsertThreadIntoProjectGroups(
  [{ projectName: 'CXCodex', threads: [resolvedSharedThread] }],
  unresolvedSharedThread,
)
assert.equal(protectedResolvedProject.length, 1)
assert.equal(protectedResolvedProject[0].projectName, 'CXCodex')
assert.equal(protectedResolvedProject[0].threads.length, 1)
assert.equal(protectedResolvedProject[0].threads[0].cwd, 'E:\\\\javaword\\\\CXCodex')

const stabilizedPartialProjectUpdate = preserveResolvedThreadProjectIdentity(
  [{ projectName: 'CXCodex', threads: [resolvedSharedThread] }],
  [{
    projectName: 'unknown-project',
    threads: [{
      ...unresolvedSharedThread,
      title: '继续测试同一会话',
      preview: '继续测试同一会话',
      inProgress: true,
    }],
  }],
)
assert.deepEqual(stabilizedPartialProjectUpdate.map((group) => group.projectName), ['CXCodex'])
assert.equal(stabilizedPartialProjectUpdate[0].threads[0].cwd, 'E:\\\\javaword\\\\CXCodex')
assert.equal(stabilizedPartialProjectUpdate[0].threads[0].title, '继续测试同一会话')
assert.equal(stabilizedPartialProjectUpdate[0].threads[0].inProgress, true)

const upgradedResolvedProject = upsertThreadIntoProjectGroups(
  [{ projectName: 'unknown-project', threads: [unresolvedSharedThread] }],
  resolvedSharedThread,
)
assert.equal(upgradedResolvedProject.length, 1)
assert.equal(upgradedResolvedProject[0].projectName, 'CXCodex')
assert.equal(upgradedResolvedProject[0].threads.length, 1)
assert.equal(upgradedResolvedProject[0].threads[0].preview, resolvedSharedThread.preview)

const makeReplayNotification = (seq: number) => ({
  method: 'turn/completed',
  params: { threadId: 'thread-replay', turnId: 'turn-' + seq },
  atIso: '2026-01-01T00:00:00.000Z',
  seq,
})

const replayRows = Array.from({ length: 450 }, (_, index) => makeReplayNotification(index + 11))
const replayPageCalls: number[] = []
const replayApplied: Array<{ seq: number | undefined; source: string }> = []
const replayPersisted: number[] = []
let replaySnapshotCount = 0
const replayCoordinator = createNotificationReplayCoordinator({
  initialCursor: 10,
  fetchPage: async (afterSeq, limit) => {
    replayPageCalls.push(afterSeq)
    return {
      notifications: replayRows.filter((row) => row.seq > afterSeq).slice(0, limit),
      latestSeq: 460,
      oldestSeq: 11,
    }
  },
  applyNotification: (notification, source) => {
    replayApplied.push({ seq: notification.seq, source })
  },
  recoverSnapshot: async () => { replaySnapshotCount += 1 },
  persistCursor: (cursor) => { replayPersisted.push(cursor) },
})
const replayResult = await replayCoordinator.recover()
assert.deepEqual(replayPageCalls, [10, 210, 410])
assert.deepEqual(replayApplied.map((row) => row.seq), replayRows.map((row) => row.seq))
assert.equal(replayApplied.every((row) => row.source === 'replay'), true)
assert.deepEqual(replayPersisted, [210, 410, 460])
assert.equal(replaySnapshotCount, 0)
assert.deepEqual(replayResult, {
  completed: true,
  cursor: 460,
  replayedCount: 450,
  snapshotRecovered: false,
})

const gapApplied: number[] = []
const gapPersisted: number[] = []
let gapSnapshotCount = 0
const gapCoordinator = createNotificationReplayCoordinator({
  initialCursor: 100,
  fetchPage: async () => ({
    notifications: Array.from({ length: 200 }, (_, index) => makeReplayNotification(index + 251)),
    latestSeq: 450,
    oldestSeq: 251,
  }),
  applyNotification: (notification) => { gapApplied.push(notification.seq ?? 0) },
  recoverSnapshot: async () => { gapSnapshotCount += 1 },
  persistCursor: (cursor) => { gapPersisted.push(cursor) },
})
const gapResult = await gapCoordinator.recover()
assert.deepEqual(gapApplied, [])
assert.deepEqual(gapPersisted, [450])
assert.equal(gapSnapshotCount, 1)
assert.equal(gapResult.snapshotRecovered, true)
assert.equal(gapResult.cursor, 450)

const bootstrapApplied: number[] = []
let bootstrapSnapshotCount = 0
const bootstrapCoordinator = createNotificationReplayCoordinator({
  initialCursor: 0,
  fetchPage: async () => ({
    notifications: [makeReplayNotification(1), makeReplayNotification(2), makeReplayNotification(3)],
    latestSeq: 3,
    oldestSeq: 1,
  }),
  applyNotification: (notification) => { bootstrapApplied.push(notification.seq ?? 0) },
  recoverSnapshot: async () => { bootstrapSnapshotCount += 1 },
  persistCursor: () => {},
})
const bootstrapResult = await bootstrapCoordinator.recover()
assert.deepEqual(bootstrapApplied, [])
assert.equal(bootstrapSnapshotCount, 1)
assert.equal(bootstrapResult.cursor, 3)
assert.equal(bootstrapResult.snapshotRecovered, true)

const resetPersisted: number[] = []
let resetSnapshotCount = 0
const resetCoordinator = createNotificationReplayCoordinator({
  initialCursor: 500,
  fetchPage: async () => ({ notifications: [], latestSeq: 20, oldestSeq: 1 }),
  applyNotification: () => { throw new Error('reset replay must not apply historical notifications') },
  recoverSnapshot: async () => { resetSnapshotCount += 1 },
  persistCursor: (cursor) => { resetPersisted.push(cursor) },
})
const resetResult = await resetCoordinator.recover()
assert.equal(resetSnapshotCount, 1)
assert.deepEqual(resetPersisted, [20])
assert.equal(resetResult.cursor, 20)

const streamResetApplied: number[] = []
const streamResetPersisted: Array<{ cursor: number; streamId: string }> = []
const streamResetObserved: string[] = []
let streamResetSnapshotCount = 0
const streamResetCoordinator = createNotificationReplayCoordinator({
  initialCursor: 100,
  initialStreamId: 'stream-before-database-reset',
  fetchPage: async () => ({
    notifications: Array.from({ length: 50 }, (_, index) => makeReplayNotification(index + 101)),
    streamId: 'stream-after-database-reset',
    latestSeq: 150,
    oldestSeq: 1,
  }),
  applyNotification: (notification) => { streamResetApplied.push(notification.seq ?? 0) },
  recoverSnapshot: async () => { streamResetSnapshotCount += 1 },
  persistCursor: (cursor, streamId) => { streamResetPersisted.push({ cursor, streamId }) },
  onStreamChanged: (streamId) => { streamResetObserved.push(streamId) },
})
const streamResetResult = await streamResetCoordinator.recover()
assert.deepEqual(streamResetApplied, [])
assert.equal(streamResetSnapshotCount, 1)
assert.deepEqual(streamResetObserved, ['stream-after-database-reset'])
assert.deepEqual(streamResetPersisted, [{ cursor: 150, streamId: 'stream-after-database-reset' }])
assert.equal(streamResetResult.cursor, 150)
assert.equal(streamResetResult.snapshotRecovered, true)

let releaseResetRacePage: ((page: { notifications: ReturnType<typeof makeReplayNotification>[]; latestSeq: number; oldestSeq: number }) => void) | null = null
const resetRaceApplied: Array<{ seq: number | undefined; source: string }> = []
const resetRacePersisted: number[] = []
const resetRaceCoordinator = createNotificationReplayCoordinator({
  initialCursor: 500,
  fetchPage: async () => await new Promise((resolve) => { releaseResetRacePage = resolve }),
  applyNotification: (notification, source) => { resetRaceApplied.push({ seq: notification.seq, source }) },
  recoverSnapshot: async () => {},
  persistCursor: (cursor) => { resetRacePersisted.push(cursor) },
})
const resetRaceRecovery = resetRaceCoordinator.recover()
resetRaceCoordinator.receiveLive(makeReplayNotification(21))
releaseResetRacePage?.({ notifications: [], latestSeq: 20, oldestSeq: 1 })
const resetRaceResult = await resetRaceRecovery
assert.deepEqual(resetRaceApplied, [{ seq: 21, source: 'live' }])
assert.deepEqual(resetRacePersisted, [20, 21])
assert.equal(resetRaceResult.cursor, 21)

let resetOldStreamPageCalls = 0
let resetOldStreamCoordinator: ReturnType<typeof createNotificationReplayCoordinator>
const resetOldStreamApplied: number[] = []
let noteResetOldStreamFollowUpStarted: (() => void) | null = null
const resetOldStreamFollowUpStarted = new Promise<void>((resolve) => {
  noteResetOldStreamFollowUpStarted = resolve
})
resetOldStreamCoordinator = createNotificationReplayCoordinator({
  initialCursor: 500,
  initialStreamId: 'stream-before-reset',
  fetchPage: async () => {
    resetOldStreamPageCalls += 1
    if (resetOldStreamPageCalls > 2) {
      throw new Error('an old-stream live event must not trigger repeated recovery')
    }
    if (resetOldStreamPageCalls === 2) noteResetOldStreamFollowUpStarted?.()
    return {
      notifications: [],
      streamId: 'stream-after-reset',
      latestSeq: 20,
      oldestSeq: 1,
    }
  },
  applyNotification: (notification) => { resetOldStreamApplied.push(notification.seq ?? 0) },
  recoverSnapshot: async () => {},
  persistCursor: () => {},
})
const resetOldStreamRecovery = resetOldStreamCoordinator.recover()
resetOldStreamCoordinator.receiveLive(makeReplayNotification(501))
const resetOldStreamResult = await resetOldStreamRecovery
await resetOldStreamFollowUpStarted
await Promise.resolve()
resetOldStreamCoordinator.stop()
assert.equal(resetOldStreamResult.snapshotRecovered, true)
assert.equal(resetOldStreamResult.cursor, 20)
assert.deepEqual(resetOldStreamApplied, [])
assert.equal(resetOldStreamPageCalls, 2)

let resetNewStreamPageCalls = 0
const resetNewStreamApplied: Array<{ seq: number | undefined; source: string }> = []
let noteResetNewStreamApplied: (() => void) | null = null
const resetNewStreamAppliedOnce = new Promise<void>((resolve) => {
  noteResetNewStreamApplied = resolve
})
const resetNewStreamCoordinator = createNotificationReplayCoordinator({
  initialCursor: 500,
  initialStreamId: 'stream-before-new-live',
  fetchPage: async () => {
    resetNewStreamPageCalls += 1
    return resetNewStreamPageCalls === 1
      ? {
          notifications: [],
          streamId: 'stream-after-new-live',
          latestSeq: 20,
          oldestSeq: 1,
        }
      : {
          notifications: [makeReplayNotification(21)],
          streamId: 'stream-after-new-live',
          latestSeq: 21,
          oldestSeq: 1,
        }
  },
  applyNotification: (notification, source) => {
    resetNewStreamApplied.push({ seq: notification.seq, source })
    noteResetNewStreamApplied?.()
  },
  recoverSnapshot: async () => {},
  persistCursor: () => {},
})
const resetNewStreamRecovery = resetNewStreamCoordinator.recover()
resetNewStreamCoordinator.receiveLive(makeReplayNotification(21))
await resetNewStreamRecovery
await resetNewStreamAppliedOnce
resetNewStreamCoordinator.stop()
assert.equal(resetNewStreamPageCalls, 2)
assert.deepEqual(resetNewStreamApplied, [{ seq: 21, source: 'replay' }])

const raceRows = Array.from({ length: 451 }, (_, index) => makeReplayNotification(index + 11))
const racePageCalls: number[] = []
const raceApplied: Array<{ seq: number | undefined; source: string }> = []
const racePersisted: number[] = []
let releaseRaceFirstPage: ((page: { notifications: typeof raceRows; latestSeq: number; oldestSeq: number }) => void) | null = null
let isRaceFirstPage = true
const raceCoordinator = createNotificationReplayCoordinator({
  initialCursor: 10,
  fetchPage: async (afterSeq, limit) => {
    racePageCalls.push(afterSeq)
    if (isRaceFirstPage) {
      isRaceFirstPage = false
      return await new Promise((resolve) => { releaseRaceFirstPage = resolve })
    }
    return {
      notifications: raceRows.filter((row) => row.seq > afterSeq).slice(0, limit),
      latestSeq: 461,
      oldestSeq: 11,
    }
  },
  applyNotification: (notification, source) => {
    raceApplied.push({ seq: notification.seq, source })
  },
  recoverSnapshot: async () => { throw new Error('race replay must not require snapshot recovery') },
  persistCursor: (cursor) => { racePersisted.push(cursor) },
})
const raceRecovery = raceCoordinator.recover()
raceCoordinator.receiveLive(makeReplayNotification(461))
releaseRaceFirstPage?.({
  notifications: raceRows.slice(0, 200),
  latestSeq: 460,
  oldestSeq: 11,
})
const raceResult = await raceRecovery
assert.deepEqual(racePageCalls, [10, 210, 410])
assert.deepEqual(raceApplied.map((row) => row.seq), raceRows.map((row) => row.seq))
assert.equal(raceApplied.slice(0, 450).every((row) => row.source === 'replay'), true)
assert.deepEqual(raceApplied.at(-1), { seq: 461, source: 'live' })
assert.deepEqual(racePersisted, [210, 410, 460, 461])
assert.equal(raceResult.cursor, 461)
assert.equal(raceResult.replayedCount, 450)

let releaseStoppedPage: ((page: { notifications: ReturnType<typeof makeReplayNotification>[]; latestSeq: number; oldestSeq: number }) => void) | null = null
const stoppedApplied: number[] = []
const stoppedPersisted: number[] = []
const stoppedCoordinator = createNotificationReplayCoordinator({
  initialCursor: 10,
  fetchPage: async () => await new Promise((resolve) => { releaseStoppedPage = resolve }),
  applyNotification: (notification) => { stoppedApplied.push(notification.seq ?? 0) },
  recoverSnapshot: async () => {},
  persistCursor: (cursor) => { stoppedPersisted.push(cursor) },
})
const stoppedRecovery = stoppedCoordinator.recover()
stoppedCoordinator.stop()
releaseStoppedPage?.({ notifications: [makeReplayNotification(11)], latestSeq: 11, oldestSeq: 11 })
const stoppedResult = await stoppedRecovery
assert.equal(stoppedResult.completed, false)
assert.deepEqual(stoppedApplied, [])
assert.deepEqual(stoppedPersisted, [])

let snapshotSignal: AbortSignal | null = null
let releaseStoppedSnapshot: (() => void) | null = null
const stoppedSnapshotPersisted: number[] = []
const stoppedSnapshotCoordinator = createNotificationReplayCoordinator({
  initialCursor: 0,
  fetchPage: async () => ({ notifications: [], latestSeq: 20, oldestSeq: 1 }),
  applyNotification: () => { throw new Error('stopped snapshot must not apply notifications') },
  recoverSnapshot: async (signal) => {
    snapshotSignal = signal
    await new Promise<void>((resolve) => { releaseStoppedSnapshot = resolve })
    if (signal.aborted) throw new DOMException('Snapshot recovery aborted', 'AbortError')
  },
  persistCursor: (cursor) => { stoppedSnapshotPersisted.push(cursor) },
})
const stoppedSnapshotRecovery = stoppedSnapshotCoordinator.recover()
await Promise.resolve()
stoppedSnapshotCoordinator.stop()
assert.equal(snapshotSignal?.aborted, true)
releaseStoppedSnapshot?.()
const stoppedSnapshotResult = await stoppedSnapshotRecovery
assert.equal(stoppedSnapshotResult.completed, false)
assert.deepEqual(stoppedSnapshotPersisted, [])

const transportTimeouts = new Map<number, () => void>()
const transportIntervals = new Map<number, () => void>()
let nextTransportTimerId = 1
const runTransportTimeout = (id: number) => {
  const callback = transportTimeouts.get(id)
  assert.equal(typeof callback, 'function')
  transportTimeouts.delete(id)
  callback?.()
}
class FakeNotificationWebSocket {
  static instances: FakeNotificationWebSocket[] = []
  readyState = 0
  closeCount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeNotificationWebSocket.instances.push(this)
  }

  close() {
    this.closeCount += 1
    this.readyState = 3
  }
}
class FakeNotificationEventSource {
  static CLOSED = 2
  static instances: FakeNotificationEventSource[] = []
  readyState = 0
  closeCount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyListener: (() => void) | null = null

  constructor(readonly url: string) {
    FakeNotificationEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: () => void) {
    if (name === 'ready') this.readyListener = listener
  }

  close() {
    this.closeCount += 1
    this.readyState = FakeNotificationEventSource.CLOSED
  }
}
const fakeWindow = {
  location: { protocol: 'http:', host: '127.0.0.1:7420' },
  setTimeout: (callback: () => void) => {
    const id = nextTransportTimerId++
    transportTimeouts.set(id, callback)
    return id
  },
  clearTimeout: (id: number) => { transportTimeouts.delete(id) },
  setInterval: (callback: () => void) => {
    const id = nextTransportTimerId++
    transportIntervals.set(id, callback)
    return id
  },
  clearInterval: (id: number) => { transportIntervals.delete(id) },
  addEventListener: () => {},
  removeEventListener: () => {},
}
const fakeDocument = {
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}
const globals = globalThis as Record<string, unknown>
globals.window = fakeWindow
globals.document = fakeDocument
globals.WebSocket = FakeNotificationWebSocket
globals.EventSource = FakeNotificationEventSource
const transportActivity: string[] = []
const transportNotifications: string[] = []
const transportStates: string[] = []
const stopTransport = subscribeRpcNotifications(
  (notification) => { transportNotifications.push(notification.method) },
  {
    onTransportActivity: () => { transportActivity.push('activity') },
    onConnectionStateChange: (state) => { transportStates.push(state) },
  },
)
assert.equal(FakeNotificationWebSocket.instances.length, 1)
assert.equal(transportActivity.length, 0)
assert.equal(transportIntervals.size, 1)
assert.equal(transportTimeouts.size, 1)
const transportSocket = FakeNotificationWebSocket.instances[0]
transportSocket.readyState = 1
transportSocket.onopen?.()
assert.equal(transportActivity.length, 1)
assert.deepEqual(transportStates, ['connected'])
assert.equal(transportIntervals.size, 1)
assert.equal(transportTimeouts.size, 0)
transportSocket.onmessage?.({
  data: JSON.stringify({ method: 'bridge/heartbeat', params: { ok: true }, atIso: '2026-01-01T00:00:00.000Z' }),
})
assert.equal(transportActivity.length, 2)
assert.deepEqual(transportNotifications, [])
transportSocket.onmessage?.({
  data: JSON.stringify({ method: 'turn/started', params: { threadId: 'thread-transport' }, atIso: '2026-01-01T00:00:01.000Z', seq: 1 }),
})
assert.equal(transportActivity.length, 3)
assert.deepEqual(transportNotifications, ['turn/started'])
stopTransport()
assert.deepEqual(transportStates, ['connected', 'disconnected'])
transportSocket.onmessage?.({
  data: JSON.stringify({ method: 'bridge/heartbeat', params: { ok: true }, atIso: '2026-01-01T00:00:02.000Z' }),
})
assert.equal(transportActivity.length, 3)
assert.equal(transportIntervals.size, 0)
assert.equal(transportTimeouts.size, 0)

FakeNotificationWebSocket.instances = []
FakeNotificationEventSource.instances = []
const staleAttemptActivity: string[] = []
const stopStaleAttempt = subscribeRpcNotifications(
  () => {},
  { onTransportActivity: () => { staleAttemptActivity.push('activity') } },
)
assert.equal(FakeNotificationWebSocket.instances.length, 1)
const staleSocket = FakeNotificationWebSocket.instances[0]
const fallbackTimerId = [...transportTimeouts.keys()][0]
runTransportTimeout(fallbackTimerId)
assert.equal(staleSocket.closeCount, 1)
assert.equal(FakeNotificationEventSource.instances.length, 1)
const activeEventSource = FakeNotificationEventSource.instances[0]
staleSocket.readyState = 1
staleSocket.onopen?.()
assert.equal(staleSocket.closeCount, 2)
assert.equal(activeEventSource.closeCount, 0)
assert.deepEqual(staleAttemptActivity, [])
stopStaleAttempt()
assert.equal(activeEventSource.closeCount, 1)
assert.equal(transportIntervals.size, 0)
assert.equal(transportTimeouts.size, 0)

FakeNotificationWebSocket.instances = []
FakeNotificationEventSource.instances = []
const originalDateNow = Date.now
let transportNow = 1_000
Date.now = () => transportNow
const watchdogActivity: string[] = []
const watchdogStates: string[] = []
const stopWatchdog = subscribeRpcNotifications(
  () => {},
  {
    onTransportActivity: () => { watchdogActivity.push('activity') },
    onConnectionStateChange: (state) => { watchdogStates.push(state) },
  },
)
assert.equal(FakeNotificationWebSocket.instances.length, 1)
assert.equal(transportIntervals.size, 1)
transportNow += 45_000
const watchdogTick = [...transportIntervals.values()][0]
watchdogTick?.()
assert.deepEqual(watchdogStates, ['reconnecting'])
assert.deepEqual(watchdogActivity, [])
assert.equal(transportIntervals.size, 0)
assert.equal(transportTimeouts.size, 1)
const reconnectTimerId = [...transportTimeouts.keys()][0]
runTransportTimeout(reconnectTimerId)
assert.equal(FakeNotificationWebSocket.instances.length, 2)
assert.equal(transportIntervals.size, 1)
assert.equal(transportTimeouts.size, 1)
const recoveredSocket = FakeNotificationWebSocket.instances[1]
recoveredSocket.readyState = 1
recoveredSocket.onopen?.()
assert.deepEqual(watchdogStates, ['reconnecting', 'connected'])
assert.deepEqual(watchdogActivity, ['activity'])
stopWatchdog()
Date.now = originalDateNow
assert.deepEqual(watchdogStates, ['reconnecting', 'connected', 'disconnected'])
assert.equal(transportIntervals.size, 0)
assert.equal(transportTimeouts.size, 0)

console.log('frontend normalizer smoke ok')
`, 'utf8')

  await esbuild.build({
    bundle: true,
    entryPoints: [entryPath],
    format: 'esm',
    logLevel: 'silent',
    outfile: bundledPath,
    platform: 'node',
    target: 'node22',
  })

  const result = spawnSync(process.execPath, [bundledPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`Run frontend normalizer smoke failed with exit code ${String(result.status)}${reason}`)
  }
} finally {
  if (process.env.CX_CODEX_KEEP_FRONTEND_NORMALIZER_SMOKE_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

function toImportPath(value) {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('.')) return normalized
  return `./${normalized}`
}
