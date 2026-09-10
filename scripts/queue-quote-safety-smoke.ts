import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope, watch } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'
import { loadMessageOutboxState, MESSAGE_OUTBOX_STORAGE_KEY } from '../src/composables/messageOutboxPersistence.js'
import type { RuntimeQueuedMessage } from '../src/api/runtimeMessageQueue.js'

// Exercise the public state boundary only. All network responses are fixtures;
// this proves that quote does not dispatch, not that server cancellation is safe.
const threadId = 'queue-quote-safety-thread'
const turnId = 'queue-quote-existing-turn'
const queueStorageKey = 'codex-web-local.queued-messages.v1'
type CancelResponse = 'accepted200' | 'missing404' | 'rejected409' | 'lostAck'
type Shape = 'native' | 'external' | 'serverFailed' | 'localQueued' | 'localFailed'
type Timer = { callback: () => void; delay: number }
const storage = new Map<string, string>()
const timers = new Map<number, Timer>()
const mutations: string[] = []
const unexpectedRequests: string[] = []
const createdOutboxIds = new Set<string>()
let timerId = 0
let observingQuote = false
let cancelResponse: CancelResponse = 'accepted200'
let activeRow: RuntimeQueuedMessage
let fixtureNowMs = Date.now()
const realDateNow = Date.now
const realFetch = globalThis.fetch
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
function addTimer(callback: () => void, delay = 0): number {
  const id = ++timerId
  timers.set(id, { callback, delay })
  return id
}
class FixtureWebSocket {
  readyState = 1
  close() { this.readyState = 3 }
}
Date.now = () => fixtureNowMs
Object.assign(globalThis, {
  WebSocket: FixtureWebSocket,
  setTimeout: addTimer,
  clearTimeout: (id: number) => timers.delete(id),
  window: {
    performance: globalThis.performance,
    localStorage: {
      get length() { return storage.size },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
        if (observingQuote && key.startsWith(MESSAGE_OUTBOX_STORAGE_KEY)) {
          for (const entry of loadMessageOutboxState().entries) createdOutboxIds.add(entry.clientMessageId)
        }
      },
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: addTimer,
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++timerId,
    clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    location: { protocol: 'http:', host: 'fixture.invalid', origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
  },
})

function row(shape: Shape): RuntimeQueuedMessage {
  const server = shape === 'native' || shape === 'external' || shape === 'serverFailed'
  return {
    id: server ? 'original-server-request' : 'original-local-row',
    ...(server ? { serverRequestId: 'original-server-request' } : {}),
    backgroundPersisted: server,
    clientMessageId: 'original-client-message',
    deliveryState: shape === 'serverFailed' || shape === 'localFailed' ? 'failed' : 'queued',
    text: 'Fixture queue draft: preserve the original intent',
    imageUrls: ['https://fixture.invalid/original.png'],
    skills: [{ name: 'fixture-skill', path: 'C:/fixture/skill/SKILL.md' }],
    fileAttachments: [{ label: 'original.txt', path: 'C:/fixture/original.txt', fsPath: 'C:/fixture/original.txt' }],
    modelId: '', reasoningEffort: '', speedMode: 'standard', collaborationMode: 'execute',
    ...(shape === 'native' ? { waitReason: 'native_writer' as const } : {}),
    ...(shape === 'external' ? { waitReason: 'external_writer' as const } : {}),
  }
}
function serverRow() {
  return {
    requestId: activeRow.serverRequestId,
    threadId,
    clientMessageId: activeRow.clientMessageId,
    status: activeRow.deliveryState === 'failed' ? 'queue_failed' : 'queued',
    payload: { queueMetadata: activeRow },
    waitReason: activeRow.waitReason,
    createdAtIso: new Date(fixtureNowMs).toISOString(),
    lastError: null,
  }
}
function threadRead() {
  return { thread: { id: threadId, turns: [{ id: turnId, status: 'inProgress', items: [] }] } }
}
function snapshot() {
  return {
    threadId, threadRead: threadRead(), executionState: 'running', messageState: 'fresh',
    inProgress: true, canStop: true, stale: false, lastEventSeq: 0, activeTurnId: turnId,
    pendingServerRequests: [], updatedAtIso: new Date(fixtureNowMs).toISOString(),
  }
}
const respond = (value: unknown, status = 200) => Response.json(value, { status })
globalThis.fetch = async (input, init) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url.startsWith('/codex-api/runtime/queue/') && method === 'DELETE') {
    if (observingQuote) mutations.push(`DELETE ${url}`)
    if (cancelResponse === 'lostAck') throw new TypeError('Failed to fetch: cancellation acknowledgement lost')
    if (cancelResponse === 'missing404') return respond({ error: 'Queue record not found; execution ownership is unknown' }, 404)
    if (cancelResponse === 'rejected409') return respond({ error: 'Queue item already claimed' }, 409)
    return respond({ ok: true })
  }
  if (url.startsWith('/codex-api/runtime/queue/') && method === 'POST') {
    if (observingQuote) mutations.push(`POST ${url}`)
    return respond({ ok: true })
  }
  if (url === '/codex-api/runtime/queue' && method === 'POST') {
    if (observingQuote) mutations.push(`POST ${url}`)
    // Loading a no-ID row cannot prove its previous enqueue never dispatched.
    throw new TypeError('Failed to fetch: original queue acknowledgement unavailable')
  }
  if (url.startsWith('/codex-api/runtime/queue') && method === 'GET') {
    return respond({ data: activeRow.serverRequestId ? [serverRow()] : [] })
  }
  if (url === '/codex-api/runtime/send') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (observingQuote) mutations.push(`POST ${url} clientMessageId=${String(body.clientMessageId)}`)
    return respond({ data: { requestId: 'unwanted-second-request', clientMessageId: body.clientMessageId,
      threadId, turnId: 'unwanted-second-turn', status: 'running' } })
  }
  if (url.startsWith('/codex-api/runtime/request?')) return respond({ data: null }, 404)
  if (url.startsWith('/codex-api/state/thread/')) return respond({ data: snapshot() })
  if (url.endsWith('/reconcile')) return respond({ data: { snapshot: snapshot() } })
  if (url.startsWith('/codex-api/runtime/thread/')) return respond({ data: snapshot() })
  if (url.startsWith('/codex-api/events/replay')) return respond({ data: { notifications: [], latestSeq: 0, oldestSeq: 0, streamId: '' } })
  if (url === '/codex-api/rpc') {
    const body = JSON.parse(String(init?.body)) as { method: string }
    if (body.method === 'thread/list') return respond({ result: { data: [{ id: threadId, cwd: 'C:/fixture/workspace',
      preview: 'Existing fixture task', createdAt: 100, updatedAt: 100 }], nextCursor: null } })
    if (body.method === 'thread/read') return respond({ result: threadRead() })
    if (body.method === 'thread/goal/get') return respond({ result: { goal: null } })
    if (body.method === 'generate-thread-title') return respond({ result: { title: '' } })
    if (observingQuote) mutations.push(`RPC ${body.method}`)
    unexpectedRequests.push(`RPC ${body.method}`)
    throw new Error(`Unexpected RPC ${body.method}`)
  }
  if (url === '/codex-api/workspace-roots-state') return respond({ data: { roots: [], activeRoots: [], labels: {} } })
  if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
  if (url === '/codex-api/server-requests/pending') return respond({ data: [] })
  if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
  unexpectedRequests.push(`${method} ${url}`)
  throw new Error(`Unexpected fetch ${method} ${url}`)
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await nextEventLoop()
}
const failures: string[] = []
let checks = 0
async function check(shape: Shape, response: CancelResponse): Promise<void> {
  const name = `${shape}: quote must not transfer under ${response}`
  checks += 1
  observingQuote = false
  fixtureNowMs += 60_000
  storage.clear(); timers.clear(); mutations.length = 0; unexpectedRequests.length = 0; createdOutboxIds.clear()
  activeRow = row(shape)
  cancelResponse = response
  storage.set(queueStorageKey, JSON.stringify({ [threadId]: [activeRow] }))
  const scope = effectScope()
  const state = scope.run(() => useDesktopState())!
  state.setWorktreeGitAutomationEnabled(false)
  const pendingRequestIds: string[] = []
  const queueSnapshots: string[] = []
  let dispatchCount = 0
  try {
    await state.selectThread(threadId)
    state.startPolling()
    await flush()
    assert.equal(state.selectedThreadId.value, threadId)
    assert.equal(state.selectedThreadQueueProcessing.value, false, 'fixture setup must finish before quoting')
    assert.equal(state.selectedThreadQueuedMessages.value.length, 1, 'load the queue through actual public state restoration')
    const originalQueue = JSON.stringify(state.selectedThreadQueuedMessages.value)
    assert.equal(state.selectedThreadQueuedMessages.value[0]?.clientMessageId, activeRow.clientMessageId)
    assert.equal(loadMessageOutboxState().entries.length, 0)
    assert.deepEqual(unexpectedRequests, [], 'setup must use only explicit fixture dependencies')
    scope.run(() => watch(() => JSON.stringify(state.selectedThreadQueuedMessages.value), (value) => {
      if (observingQuote) queueSnapshots.push(value)
    }, { flush: 'sync' }))
    observingQuote = true
    await state.quoteQueuedMessage(activeRow.id, {
      onPendingRequestCreated: (id) => pendingRequestIds.push(id),
      onRequestDispatched: () => { dispatchCount += 1 },
    })
    await flush()
    assert.deepEqual(mutations, [], 'quoting must not cancel, restore, enqueue, send or steer another request')
    assert.deepEqual(pendingRequestIds, [], 'quoting must not create a second execution identity')
    assert.equal(dispatchCount, 0)
    assert.equal(createdOutboxIds.size, 0, 'no transient second outbox is allowed even if rollback later removes it')
    assert.equal(loadMessageOutboxState().entries.length, 0)
    assert.equal(JSON.stringify(state.selectedThreadQueuedMessages.value), originalQueue, 'preserve the original draft and queue identity')
    assert.ok(queueSnapshots.every((value) => value === originalQueue), 'the original row must never temporarily disappear')
    assert.deepEqual(unexpectedRequests, [])
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}; mutations=${JSON.stringify(mutations)}; newIds=${pendingRequestIds.length}; outboxes=${createdOutboxIds.size}`)
  } finally {
    observingQuote = false
    state.stopPolling()
    scope.stop()
    await flush()
  }
}

try {
  for (const shape of ['native', 'external', 'serverFailed'] as const) {
    for (const response of ['accepted200', 'missing404', 'rejected409', 'lostAck'] as const) {
      await check(shape, response)
    }
  }
  await check('localQueued', 'lostAck')
  await check('localFailed', 'lostAck')
} finally {
  Object.assign(globalThis, { fetch: realFetch, setTimeout: realSetTimeout, clearTimeout: realClearTimeout })
  Date.now = realDateNow
}
console.log(`${checks - failures.length}/${checks} queue quote safety checks passed (mocked client boundary only).`)
if (failures.length) process.exitCode = 1
