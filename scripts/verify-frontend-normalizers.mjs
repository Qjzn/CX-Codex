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

try {
  writeFileSync(entryPath, `
import assert from 'node:assert/strict'
import { normalizeThreadGroupsV2, normalizeThreadMessagesV2 } from '${normalizerImport}'
import { createNotificationReplayCoordinator } from '${notificationReplayImport}'

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
