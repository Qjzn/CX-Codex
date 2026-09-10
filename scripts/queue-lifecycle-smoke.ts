import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeStore } from '../src/server/runtimeStore.js'
import { RuntimeMessageQueue } from '../src/server/runtimeMessageQueue.js'
import {
  createNativeThreadQueueMarker,
  ensureNativeThreadQueueSubmission,
} from '../src/server/appServerNativeThreadQueue.js'
import { restoreQueuedMessageAtIndex, transferQueuedMessageWithRecovery } from '../src/composables/queuedMessageTransfer.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.ok(predicate(), 'fixture state did not converge within its bounded loop')
}

function harness(options: {
  rpc?: (method: string, params: unknown) => Promise<unknown>
  failStart?: boolean
  paused?: boolean
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cx-queue-lifecycle-'))
  const dbPath = join(directory, 'runtime.sqlite')
  const store = new RuntimeStore(dbPath)
  let storeClosed = false
  const closeStore = () => {
    if (storeClosed) return
    store.close()
    storeClosed = true
  }
  const started: string[] = []
  const notifications: unknown[] = []
  const calls: { method: string; params: unknown }[] = []
  const threadId = 'thread-queue-lifecycle'
  if (options.paused) store.createRequest({ requestId: 'owner', threadId, status: 'running' })
  const queue = new RuntimeMessageQueue({
    store,
    rpc: async (method, params) => {
      calls.push({ method, params })
      return options.rpc ? options.rpc(method, params) : { config: { service_tier: null } }
    },
    startRuntimeTurn: async (payload) => {
      const clientMessageId = String((payload as { clientMessageId: string }).clientMessageId)
      if (options.failStart) throw new Error('fixture start rejected')
      started.push(clientMessageId)
      const request = store.getLatestRequestByClientMessageId(clientMessageId)!
      store.updateRequest(request.requestId, { status: 'running', turnId: `turn-${clientMessageId}` })
      return { status: 'running' }
    },
    publishNotification: (notification) => notifications.push(notification),
    getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
  })
  return {
    store, queue, started, notifications, calls, threadId, dbPath,
    enqueue: (name: string) => queue.enqueue({
      requestId: `request-${name}`, clientMessageId: `client-${name}`, threadId,
      input: [{ type: 'text', text: `Fixture ${name}` }],
    }),
    complete: (requestId: string) => {
      store.updateRequest(requestId, { status: 'completed' })
      queue.handleRuntimeEvent('turn/completed', threadId)
    },
    stopStorage: async () => {
      queue.dispose()
      await tick()
      closeStore()
    },
    close: async () => {
      queue.dispose()
      await tick()
      closeStore()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const failures: string[] = []
let count = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  count += 1
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await check('durable FIFO, active-owner wait, repeated enqueue and terminal event idempotency', async () => {
  const h = harness({ paused: true })
  try {
    const a = h.enqueue('a')
    const b = h.enqueue('b')
    assert.equal(h.enqueue('a').requestId, a.requestId)
    await tick()
    assert.equal(h.started.length, 0)
    assert.equal(h.queue.list(h.threadId).length, 2)
    h.complete('owner')
    await until(() => h.started.length === 1)
    assert.deepEqual(h.started, ['client-a'])
    h.queue.handleRuntimeEvent('turn/completed', h.threadId)
    await tick()
    assert.equal(h.started.length, 1)
    h.complete(a.requestId)
    await until(() => h.started.length === 2)
    assert.deepEqual(h.started, ['client-a', 'client-b'])
    assert.equal(h.store.getRequest(b.requestId)?.status, 'running')
  } finally { await h.close() }
})

await check('FIFO remains insertion ordered when request timestamps are equal', async () => {
  const h = harness({ paused: true })
  const OriginalDate = Date
  try {
    const frozenMs = OriginalDate.now()
    globalThis.Date = class extends OriginalDate {
      constructor(value?: string | number) { super(value ?? frozenMs) }
      static now() { return frozenMs }
    } as DateConstructor
    const first = h.enqueue('z-first')
    const second = h.enqueue('a-second')
    globalThis.Date = OriginalDate
    assert.equal(first.createdAtIso, second.createdAtIso, 'the fixture must hit the timestamp collision')
    assert.deepEqual(h.queue.list(h.threadId).map((entry) => entry.requestId), [first.requestId, second.requestId])
    await h.stopStorage()
    const reopened = new RuntimeStore(h.dbPath)
    try {
      assert.deepEqual(reopened.listQueuedRequests(h.threadId).map((entry) => entry.requestId), [first.requestId, second.requestId])
    } finally { reopened.close() }
  } finally {
    globalThis.Date = OriginalDate
    await h.close()
  }
})

await check('failed first entry blocks following messages until explicitly deleted', async () => {
  const h = harness({ paused: true, failStart: true })
  try {
    const a = h.enqueue('a')
    const b = h.enqueue('b')
    h.complete('owner')
    await until(() => h.store.getRequest(a.requestId)?.status === 'queue_failed')
    const firstCalls = h.calls.length
    h.queue.handleRuntimeEvent('turn/completed', h.threadId)
    await tick()
    assert.equal(h.calls.length, firstCalls)
    assert.equal(h.store.getRequest(b.requestId)?.status, 'queued')
    await h.queue.cancel(a.requestId)
    await until(() => h.store.getRequest(b.requestId)?.status === 'queue_failed')
    assert.equal(h.store.getRequest(a.requestId)?.status, 'interrupted')
  } finally { await h.close() }
})

await check('delete during config preparation cannot be resurrected by late RPC failure', async () => {
  const config = deferred<unknown>()
  const h = harness({ rpc: async () => config.promise })
  try {
    const a = h.enqueue('a')
    await until(() => h.calls.length === 1)
    assert.equal(await h.queue.cancel(a.requestId), true)
    config.reject(new Error('fixture late config failure'))
    await tick()
    assert.equal(h.store.getRequest(a.requestId)?.status, 'interrupted', 'deleted queue entries must stay deleted')
    assert.equal(h.queue.list(h.threadId).length, 0)
    assert.equal(h.started.length, 0)
  } finally { await h.close() }
})

await check('accepted reorder during config preparation controls the next real start', async () => {
  const config = deferred<unknown>()
  let first = true
  const h = harness({ rpc: async () => {
    if (first) { first = false; return config.promise }
    return { config: { service_tier: null } }
  } })
  try {
    const a = h.enqueue('a')
    const b = h.enqueue('b')
    await until(() => h.calls.length === 1)
    assert.equal(await h.queue.reorder(h.threadId, [b.requestId, a.requestId]), true)
    config.resolve({ config: { service_tier: null } })
    await until(() => h.started.length > 0)
    assert.deepEqual(h.started, ['client-b'], 'the displayed accepted order must equal execution order')
  } finally { await h.close() }
})

await check('deleting a preparing head promptly starts the next entry after preparation settles', async () => {
  const config = deferred<unknown>()
  let first = true
  const h = harness({ rpc: async () => {
    if (first) { first = false; return config.promise }
    return { config: { service_tier: null } }
  } })
  try {
    const a = h.enqueue('a')
    h.enqueue('b')
    await until(() => h.calls.length === 1)
    assert.equal(await h.queue.cancel(a.requestId), true)
    config.resolve({ config: { service_tier: null } })
    await until(() => h.started.length > 0)
    assert.deepEqual(h.started, ['client-b'])
  } finally { await h.close() }
})

await check('invalid duplicate reorder is rejected before modifying the native writer queue', async () => {
  const rows = ['a', 'b', 'c'].map((id) => ({ id: `native-${id}`, clientUserMessageId: `client-${id}` }))
  const h = harness({ paused: true, rpc: async (method) => {
    if (method === 'thread/queue/list') return { data: rows, nextCursor: null }
    return {}
  } })
  try {
    const entries = ['a', 'b', 'c'].map(h.enqueue)
    entries.forEach((entry, index) => h.store.updateRequest(entry.requestId, {
      lastError: createNativeThreadQueueMarker(rows[index]!.id),
    }))
    assert.equal(await h.queue.reorder(h.threadId, [entries[1]!.requestId, entries[1]!.requestId, entries[2]!.requestId]), false)
    assert.equal(h.calls.some((call) => call.method === 'thread/queue/reorder'), false, 'invalid input must not mutate the native queue first')
  } finally { await h.close() }
})

await check('reorder cannot bypass an explicitly paused first failure', async () => {
  const h = harness({ paused: true })
  try {
    const a = h.enqueue('a')
    const b = h.enqueue('b')
    h.store.updateRequest(a.requestId, { status: 'queue_failed', lastError: 'fixture failure' })
    assert.equal(await h.queue.reorder(h.threadId, [b.requestId, a.requestId]), false)
    assert.deepEqual(h.queue.list(h.threadId).map((entry) => entry.requestId), [a.requestId, b.requestId])
  } finally { await h.close() }
})

await check('native list response cannot overwrite a completed cancellation', async () => {
  const list = deferred<unknown>()
  const h = harness({ rpc: async (method) => {
    if (method === 'thread/queue/list') return list.promise
    assert.equal(method, 'thread/queue/delete')
    return { deleted: true }
  } })
  try {
    const a = h.enqueue('a')
    h.store.updateRequest(a.requestId, { lastError: createNativeThreadQueueMarker('native-a') })
    await until(() => h.calls.some((call) => call.method === 'thread/queue/list'))
    assert.equal(await h.queue.cancel(a.requestId), true)
    list.resolve({ data: [], nextCursor: null })
    await tick()
    assert.equal(h.store.getRequest(a.requestId)?.status, 'interrupted')
    assert.equal(h.started.length, 0, 'native ownership must not cause a duplicate local start')
  } finally { await h.close() }
})

await check('native writer add-response loss reconciles by stable client identity', async () => {
  const rows: { id: string; clientUserMessageId: string }[] = []
  let added = 0
  const rpc = async (method: string): Promise<unknown> => {
    if (method === 'thread/queue/list') return { data: rows, nextCursor: null }
    assert.equal(method, 'thread/queue/add')
    added += 1
    rows.push({ id: 'native-a', clientUserMessageId: 'client-a' })
    throw new Error('fixture response lost after commit')
  }
  const args = { rpc, threadId: 'thread-native-fixture', clientUserMessageId: 'client-a', input: [{ type: 'text', text: 'Fixture' }] }
  assert.equal((await ensureNativeThreadQueueSubmission(args)).id, 'native-a')
  assert.equal((await ensureNativeThreadQueueSubmission(args)).id, 'native-a')
  assert.equal(added, 1)
})

await check('fresh SQLite connection recovers order and concurrent queue consumers start once', async () => {
  const h = harness({ paused: true })
  let peerStore: RuntimeStore | null = null
  let peerQueue: RuntimeMessageQueue | null = null
  const peerStarted: string[] = []
  try {
    const a = h.enqueue('a')
    const b = h.enqueue('b')
    await tick()
    peerStore = new RuntimeStore(h.dbPath)
    const peer = peerStore
    peerQueue = new RuntimeMessageQueue({
      store: peer,
      rpc: async () => ({ config: { service_tier: null } }),
      startRuntimeTurn: async (payload) => {
        const clientId = String((payload as { clientMessageId: string }).clientMessageId)
        peerStarted.push(clientId)
        const request = peer.getLatestRequestByClientMessageId(clientId)!
        peer.updateRequest(request.requestId, { status: 'running', turnId: 'peer-turn' })
        return { status: 'running' }
      },
      publishNotification: () => {},
      getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
    })
    assert.deepEqual(peerQueue.list(h.threadId).map((entry) => entry.requestId), [a.requestId, b.requestId])
    assert.equal(peerQueue.enqueue({
      requestId: 'peer-retry-a', clientMessageId: 'client-a', threadId: h.threadId,
      input: [{ type: 'text', text: 'Fixture a' }],
    }).requestId, a.requestId)
    h.complete('owner')
    peerQueue.handleRuntimeEvent('turn/completed', h.threadId)
    await until(() => h.started.length + peerStarted.length > 0)
    await tick()
    assert.equal(h.started.length + peerStarted.length, 1)
    assert.equal(peer.getRequest(a.requestId)?.status, 'running')
    assert.equal(peer.getRequest(b.requestId)?.status, 'queued')
  } finally {
    peerQueue?.dispose()
    await tick()
    peerStore?.close()
    await h.close()
  }
})

await check('failed steer restores original queue position exactly once', async () => {
  const snapshot = { index: 1, message: { id: 'b' } }
  let queue = [{ id: 'a' }, { id: 'c' }]
  assert.equal(await transferQueuedMessageWithRecovery({
    snapshot,
    deliver: async () => { throw new Error('fixture writer rejected steer') },
    restore: async (previous) => { queue = restoreQueuedMessageAtIndex(queue, previous); return true },
  }), 'restored')
  assert.deepEqual(restoreQueuedMessageAtIndex(queue, snapshot).map((row) => row.id), ['a', 'b', 'c'])
  assert.equal(await transferQueuedMessageWithRecovery({
    snapshot, deliver: async () => {}, restore: async () => { throw new Error('successful delivery must not restore') },
  }), 'delivered')
  assert.equal(await transferQueuedMessageWithRecovery({
    snapshot, deliver: async () => { throw new Error('fixture failure') }, restore: async () => false,
  }), 'failed')
})

console.log(`${count - failures.length}/${count} queue lifecycle checks passed`)
if (failures.length) process.exitCode = 1
