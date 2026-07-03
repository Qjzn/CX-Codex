import assert from 'node:assert/strict'
import { AppServerRpcCache, getShareableRpcKey, shouldInvalidateThreadListCacheForRpc } from '../src/server/appServerRpcCache.js'
import { AppServerRpcDiagnostics } from '../src/server/appServerRpcDiagnostics.js'
import { AppServerRpcQueue, getAppServerRpcQueuePriority } from '../src/server/appServerRpcQueue.js'
import { PendingServerRequestStore } from '../src/server/pendingServerRequests.js'
import {
  isRuntimeActiveState,
  RuntimeStateStore,
  toPersistableRuntimeSnapshot,
} from '../src/server/runtimeState.js'

const originalNow = Date.now

try {
  smokePendingServerRequests()
  await smokeAppServerRpcCache()
  smokeAppServerRpcDiagnostics()
  await smokeAppServerRpcQueue()
  smokeRuntimeStateStore()
  console.log('server module smoke ok')
} finally {
  Date.now = originalNow
}

function smokePendingServerRequests(): void {
  const store = new PendingServerRequestStore()
  const first = store.record(7, 'item/commandExecution/requestApproval', { threadId: 'thread-a' })
  const second = store.record(8, 'item/fileChange/requestApproval', { thread: { id: 'thread-b' } })

  assert.equal(store.count, 2)
  assert.equal(first.id, 7)
  assert.equal(second.method, 'item/fileChange/requestApproval')
  assert.deepEqual(store.listForThread('thread-a', readThreadIdFromPayload).map((row) => row.id), [7])
  assert.equal(store.consume(7)?.method, 'item/commandExecution/requestApproval')
  assert.equal(store.consume(7), null)
  assert.equal(store.count, 1)
  store.clear()
  assert.equal(store.count, 0)
}

async function smokeAppServerRpcCache(): Promise<void> {
  assert.equal(getShareableRpcKey('thread/start', {}), null)
  assert.equal(getShareableRpcKey('thread/list', { limit: 1 }), 'thread/list:{"limit":1}')
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/name/set'), true)
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/read'), false)

  let now = 1_000
  Date.now = () => now
  const cache = new AppServerRpcCache()
  const key = getShareableRpcKey('thread/list', {}) ?? ''

  cache.writeThreadList(key, { rows: ['fresh'] })
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['fresh'] }, stale: false })

  now += 4 * 60_000
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['fresh'] }, stale: true })

  let refreshCalls = 0
  cache.refreshThreadListInBackground(key, {}, async () => {
    refreshCalls += 1
    return { rows: ['refreshed'] }
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(refreshCalls, 1)
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['refreshed'] }, stale: false })

  now += 21 * 60_000
  assert.equal(cache.readThreadList(key, false), null)
}

function smokeAppServerRpcDiagnostics(): void {
  let now = 5_000
  Date.now = () => now
  const diagnostics = new AppServerRpcDiagnostics(
    {
      isHeavyThreadRead: (method, params) => method === 'thread/read' && readIncludeTurns(params) === true,
    },
    {
      slowWarnMs: 100,
      queueWarnSize: 2,
      queueWarnIntervalMs: 1_000,
      timeoutRestartWindowMs: 10_000,
      timeoutRestartThreshold: 2,
    },
  )

  diagnostics.incrementActive()
  diagnostics.recordQueueDepth(2, now)
  diagnostics.maybeWarnQueueBacklog('thread/read', { includeTurns: true }, 2, now)
  diagnostics.logSlowRpc('thread/read', now - 150, { includeTurns: true }, { outcome: 'success' })
  diagnostics.recordTimeout('thread/read', { includeTurns: true }, 30_000, now)

  const threadReadTimeout = diagnostics.noteRestartableTimeout('thread/read', now)
  assert.equal(threadReadTimeout.shouldRestart, false)

  const firstTimeout = diagnostics.noteRestartableTimeout('thread/start', now)
  assert.equal(firstTimeout.shouldRestart, false)
  const secondTimeout = diagnostics.noteRestartableTimeout('thread/start', now + 1)
  assert.equal(secondTimeout.shouldRestart, true)
  assert.equal(secondTimeout.timeoutCount, 2)

  diagnostics.decrementActive()
  const snapshot = diagnostics.snapshot(1, 2)
  assert.equal(snapshot.activeRpcCalls, 0)
  assert.equal(snapshot.pendingRpcCount, 1)
  assert.equal(snapshot.queuedRpcCount, 2)
  assert.equal(snapshot.queuePeakCount, 2)
  assert.equal(snapshot.recentSlowRpc[0]?.includeTurns, true)
  assert.equal(snapshot.recentTimeouts[0]?.outcome, 'timeout')

  diagnostics.resetTimeoutWindow()
  assert.equal(diagnostics.noteRestartableTimeout('thread/start', now + 20_000).shouldRestart, false)
}

async function smokeAppServerRpcQueue(): Promise<void> {
  assert.equal(getAppServerRpcQueuePriority('turn/start', {}), 0)
  assert.equal(getAppServerRpcQueuePriority('thread/read', {}), 1)
  assert.equal(getAppServerRpcQueuePriority('thread/list', {}), 4)
  assert.equal(getAppServerRpcQueuePriority('model/list', {}), 5)

  let now = 9_000
  Date.now = () => now++
  const diagnostics = new AppServerRpcDiagnostics(
    {
      isHeavyThreadRead: (method, params) => method === 'thread/read' && readIncludeTurns(params) === true,
    },
    {
      slowWarnMs: 100,
      queueWarnSize: 10,
      queueWarnIntervalMs: 1_000,
      timeoutRestartWindowMs: 10_000,
      timeoutRestartThreshold: 2,
    },
  )

  const startedMethods: string[] = []
  const releaseCurrent: Array<() => void> = []
  const queue = new AppServerRpcQueue({
    maxSize: 3,
    maxInFlight: 1,
    diagnostics,
    execute: async (method) => {
      startedMethods.push(method)
      await new Promise<void>((resolve) => {
        releaseCurrent.push(resolve)
      })
      return `${method}:done`
    },
  })

  const first = queue.enqueue('thread/read', { includeTurns: false })
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read'])

  const lowPriority = queue.enqueue('model/list', {})
  const highPriority = queue.enqueue('thread/read', { includeTurns: false })
  assert.equal(queue.count, 2)

  releaseCurrent.shift()?.()
  assert.equal(await first, 'thread/read:done')
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read', 'thread/read'])

  releaseCurrent.shift()?.()
  assert.equal(await highPriority, 'thread/read:done')
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read', 'thread/read', 'model/list'])

  releaseCurrent.shift()?.()
  assert.equal(await lowPriority, 'model/list:done')
  assert.equal(queue.count, 0)

  const stalledQueue = new AppServerRpcQueue({
    maxSize: 1,
    maxInFlight: 0,
    diagnostics,
    execute: async () => 'unreachable',
  })
  const pending = stalledQueue.enqueue('thread/read', {})
  await assert.rejects(
    stalledQueue.enqueue('thread/read', {}),
    /codex app-server RPC queue is full \(1\)/,
  )
  stalledQueue.rejectAll(new Error('queue stopped'))
  await assert.rejects(pending, /queue stopped/)
}

function smokeRuntimeStateStore(): void {
  const store = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload: (payload) => readBooleanProperty(payload, 'inProgress'),
    getErrorMessage: (_payload, fallback) => fallback,
  }, { staleMs: 100 })

  store.markQueued('thread-a')
  assert.equal(isRuntimeActiveState(store.snapshot('thread-a').executionState), true)

  store.observeEvent({
    method: 'turn/started',
    params: { threadId: 'thread-a', turnId: 'turn-1', itemId: 'item-1' },
    atIso: new Date(1).toISOString(),
    seq: 1,
  })
  const running = store.snapshot('thread-a', { pendingServerRequests: [] })
  assert.equal(running.executionState, 'sync_degraded')
  assert.equal(running.stale, true)

  store.observeThreadRead('thread-a', false, '', new Date().toISOString(), 'thread-read')
  const completed = store.snapshot('thread-a', { tokenUsage: { total: 1 }, pendingServerRequests: [] })
  assert.equal(completed.executionState, 'completed')
  const persistable = toPersistableRuntimeSnapshot(completed)
  assert.equal(persistable.threadRead, null)
  assert.deepEqual(persistable.pendingServerRequests, [])
  assert.equal(persistable.tokenUsage, null)
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function readThreadIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  const direct = readString(root, 'threadId')
  if (direct) return direct
  return readString(asRecord(root?.thread), 'id')
}

function readTurnIdFromPayload(payload: unknown): string {
  return readString(asRecord(payload), 'turnId')
}

function readItemIdFromPayload(payload: unknown): string {
  return readString(asRecord(payload), 'itemId')
}

function readIncludeTurns(payload: unknown): boolean | undefined {
  const value = asRecord(payload)?.includeTurns
  return typeof value === 'boolean' ? value : undefined
}

function readBooleanProperty(payload: unknown, key: string): boolean {
  return asRecord(payload)?.[key] === true
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
