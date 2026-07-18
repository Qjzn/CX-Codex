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
const runtimeSnapshotOrderingImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'runtimeSnapshotOrdering.ts')))
const messageOutboxMergeImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'messageOutboxMerge.ts')))
const boundedAsyncRecoveryImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'boundedAsyncRecovery.ts')))
const chatFeedbackMetricsImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'chatFeedbackMetrics.ts')))
const runtimeRequestDeliveryImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'composables', 'runtimeRequestDelivery.ts')))
const rpcClientImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'codexRpcClient.ts')))

try {
  writeFileSync(entryPath, `
import assert from 'node:assert/strict'
import { normalizeThreadGroupsV2, normalizeThreadMessagesV2 } from '${normalizerImport}'
import { createNotificationReplayCoordinator } from '${notificationReplayImport}'
import { shouldApplyRuntimeSnapshotVersion } from '${runtimeSnapshotOrderingImport}'
import { mergeMessageOutboxEntries, mergeMessageOutboxState } from '${messageOutboxMergeImport}'
import { runWithBoundedRecovery } from '${boundedAsyncRecoveryImport}'
import {
  beginChatFeedbackMetric,
  markChatFeedbackFirstAssistantData,
  markChatFeedbackFirstAssistantVisible,
  markChatFeedbackRendered,
  markChatFeedbackRequestDispatched,
  markChatFeedbackServerAcknowledged,
} from '${chatFeedbackMetricsImport}'
import { isRuntimeRequestAwaitingDeliveryConfirmation } from '${runtimeRequestDeliveryImport}'
import { subscribeRpcNotifications } from '${rpcClientImport}'

const originalWindow = globalThis.window
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('pending_start'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('start_uncertain'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('sync_degraded'), true)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('running'), false)
assert.equal(isRuntimeRequestAwaitingDeliveryConfirmation('completed'), false)

globalThis.window = globalThis
delete globalThis.__cxCodexChatFeedbackMetrics
const feedbackStartedAtMs = performance.now() - 8
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
assert.ok((feedbackMetric?.turnStartedLatencyMs ?? -1) >= 0)
assert.ok((feedbackMetric?.firstAssistantDataLatencyMs ?? -1) >= 0)
assert.equal(feedbackMetric?.firstAssistantMessageId, 'assistant-feedback')
assert.ok((feedbackMetric?.firstAssistantVisibleLatencyMs ?? -1) >= 0)
delete globalThis.__cxCodexChatFeedbackMetrics
if (originalWindow === undefined) delete globalThis.window
else globalThis.window = originalWindow

assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 41 }), false)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 42 }), true)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 43 }), true)
assert.equal(shouldApplyRuntimeSnapshotVersion({ lastEventSeq: 42 }, { lastEventSeq: 0 }), true)

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

assert.equal(messages.length, 3)
assert.equal(messages[0]?.messageType, 'agentMessage')
assert.equal(messages[1]?.role, 'system')
assert.equal(messages[1]?.messageType, 'unhandled.threadShellCommandOutput')
assert.equal(messages[1]?.text, 'Unhandled App Server item: threadShellCommandOutput')
assert.equal(messages[1]?.isUnhandled, true)
assert.equal(messages[1]?.turnIndex, 0)
assert.equal(messages[1]?.rawPayload?.includes('secret command'), true)
assert.equal(messages[2]?.messageType, 'unhandled.invalidItem')
assert.equal(messages[2]?.isUnhandled, true)
assert.equal(messages.some((message) => message.messageType === 'unhandled.fileChange'), false)
assert.equal(messages.some((message) => message.messageType === 'unhandled.webSearch'), false)
assert.equal(messages.some((message) => message.rawPayload?.includes('large internal patch details')), false)

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
assert.equal(recentTurnMessages[1]?.turnIndex, 2)
assert.equal(recentTurnMessages[2]?.turnIndex, 3)

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
assert.equal(groups[0]?.threads[0]?.sourceKind, 'cli')
assert.equal(groups[0]?.threads[1]?.sourceKind, 'subAgent.thread_spawn')
assert.equal(groups[0]?.threads[2]?.sourceKind, 'futureSource')

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
