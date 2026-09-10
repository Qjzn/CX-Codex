import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope, watch } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'
import { loadMessageOutboxState } from '../src/composables/messageOutboxPersistence.js'

const threadId = 'delivery-contract-thread'
const turnId = 'delivery-contract-turn'
const prompt = 'Fixture only: verify one durable delivery'
type State = ReturnType<typeof useDesktopState>
type Fault = 'html502' | 'truncated200' | 'empty200' | 'partialRunning200' | 'wrongSendClient200'
  | 'unavailable503' | 'missing404' | 'rejected400' | 'offline'
type LookupFault = 'truncated' | 'empty' | 'wrongClient'
type Status = 'running' | 'completed'
type Timer = { callback: () => void; delay: number }
const storage = new Map<string, string>()
const windowTimers = new Map<number, Timer>()
const globalTimers = new Map<number, Timer>()
let timerId = 0
function addTimer(target: Map<number, Timer>, callback: () => void, delay = 0): number {
  const id = ++timerId
  target.set(id, { callback, delay })
  return id
}
class FixtureWebSocket {
  static current: FixtureWebSocket | null = null
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  constructor() { FixtureWebSocket.current = this }
  close() { this.readyState = 3 }
}
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realDateNow = Date.now
let fixtureNowMs = Date.now()
Date.now = () => fixtureNowMs
Object.assign(globalThis, {
  WebSocket: FixtureWebSocket,
  setTimeout: (callback: () => void, delay = 0) => addTimer(globalTimers, callback, delay),
  clearTimeout: (id: number) => globalTimers.delete(id),
  window: {
    performance: globalThis.performance,
    localStorage: {
      get length() { return storage.size },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: (callback: () => void, delay = 0) => addTimer(windowTimers, callback, delay),
    clearTimeout: (id: number) => windowTimers.delete(id),
    setInterval: () => ++timerId, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    location: { protocol: 'http:', host: 'fixture.invalid', origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
  },
})

let fault: Fault = 'html502'
let status: Status = 'running'
let snapshotHasMessage = false
let lookupAvailable = false
let lookupNeverFound = false
let lookupFault: LookupFault | null = null
const sendCalls: Array<Record<string, unknown>> = []
const lookupIds: string[] = []
const unexpectedRequests: string[] = []
const retryDelays: number[] = []
const respond = (value: unknown, statusCode = 200) => new Response(JSON.stringify(value), {
  status: statusCode, headers: { 'Content-Type': 'application/json' },
})
function requestRecord() {
  return {
    requestId: 'delivery-contract-request', clientMessageId: sendCalls[0]?.clientMessageId,
    threadId, turnId, status, lastError: null,
  }
}
function threadRead() {
  return { thread: { id: threadId, turns: snapshotHasMessage ? [{
    id: turnId, status: status === 'running' ? 'inProgress' : status,
    items: [{ id: 'delivery-contract-user', type: 'userMessage', clientMessageId: sendCalls[0]?.clientMessageId,
      content: [{ type: 'text', text: prompt }] },
    ...(status === 'completed' ? [{ id: 'delivery-contract-final', type: 'agentMessage', phase: 'final_answer', text: 'Fixture complete' }] : [])],
  }] : [] } }
}
function snapshot() {
  return {
    threadId, threadRead: threadRead(), executionState: snapshotHasMessage ? status : 'idle', messageState: 'fresh',
    inProgress: snapshotHasMessage && status === 'running', canStop: snapshotHasMessage && status === 'running', stale: false,
    lastEventSeq: 0, activeTurnId: snapshotHasMessage && status === 'running' ? turnId : '',
    pendingServerRequests: [], updatedAtIso: '2026-09-10T00:00:01Z',
  }
}
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (url === '/codex-api/runtime/send') {
    sendCalls.push(JSON.parse(String(init?.body)))
    if (fault === 'html502') return new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
    if (fault === 'truncated200') return new Response('{"data":{"requestId":', { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (fault === 'empty200') return respond({})
    if (fault === 'partialRunning200') return respond({ data: { requestId: 'partial-request', status: 'running' } })
    if (fault === 'wrongSendClient200') return respond({ data: {
      request: { requestId: 'foreign-request', clientMessageId: 'foreign-client', threadId: 'foreign-thread', turnId: 'foreign-turn', status: 'running' },
      threadId: 'foreign-thread', turnId: 'foreign-turn', status: 'running',
    } })
    if (fault === 'unavailable503') return respond({ error: 'Fixture temporarily unavailable' }, 503)
    if (fault === 'missing404') return respond({ error: 'Fixture runtime/send route temporarily unavailable' }, 404)
    if (fault === 'rejected400') return respond({ error: 'Fixture invalid input: Failed to fetch is quoted input, not a transport failure' }, 400)
    if (fault === 'offline') throw new TypeError('Failed to fetch')
    throw new Error(`Unconfigured fixture send fault: ${fault}`)
  }
  if (url.startsWith('/codex-api/runtime/request?')) {
    lookupIds.push(new URL(url, 'http://fixture.invalid').searchParams.get('clientMessageId') ?? '')
    if (fault === 'offline' && !lookupAvailable) throw new TypeError('Failed to fetch')
    if (fault === 'rejected400') return respond({ error: 'Not found' }, 404)
    if (!lookupAvailable && (lookupNeverFound || sendCalls.length < 2)) {
      if (lookupFault === 'truncated') return new Response('{"data":', { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (lookupFault === 'empty') return respond({ data: {} })
      if (lookupFault === 'wrongClient') return respond({ data: { ...requestRecord(), clientMessageId: 'unrelated-client', threadId: 'unrelated-thread' } })
      return respond({ error: 'Not found' }, 404)
    }
    return respond({ data: requestRecord() })
  }
  if (url.startsWith('/codex-api/state/thread/')) return respond({ data: snapshot() })
  if (url.endsWith('/reconcile')) return respond({ data: { snapshot: snapshot() } })
  if (url.startsWith('/codex-api/runtime/thread/')) return respond({ data: snapshot() })
  if (url.startsWith('/codex-api/runtime/queue')) return respond({ data: [] })
  if (url.startsWith('/codex-api/events/replay')) return respond({ data: { notifications: [], latestSeq: 0, oldestSeq: 0, streamId: '' } })
  if (url === '/codex-api/rpc') {
    const { method } = JSON.parse(String(init?.body))
    if (method === 'thread/list') return respond({ result: { data: [{ id: threadId, cwd: 'C:/fixture/workspace',
      preview: prompt, createdAt: 100, updatedAt: 100 }], nextCursor: null } })
    if (method === 'thread/read') return respond({ result: threadRead() })
    if (method === 'thread/goal/get') return respond({ result: { goal: null } })
    if (method === 'generate-thread-title') return respond({ result: { title: '' } })
    unexpectedRequests.push(`RPC ${method}`)
    throw new Error(`Unexpected RPC ${method}`)
  }
  if (url === '/codex-api/workspace-roots-state') return respond({ data: { roots: [], activeRoots: [], labels: {} } })
  if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
  if (url === '/codex-api/server-requests/pending') return respond({ data: [] })
  if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
  unexpectedRequests.push(url)
  throw new Error(`Unexpected fetch ${url}`)
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await nextEventLoop()
}
// Only bounded-send waits live in this global timer table after HTTP requests settle.
// Window timers include background sync, selection and reconciliation and are never drained.
async function settle(request: Promise<unknown>): Promise<{ error?: unknown }> {
  let outcome: { error?: unknown } | undefined
  void request.then(() => { outcome = {} }, (error: unknown) => { outcome = { error } })
  for (let index = 0; index < 8 && !outcome; index += 1) {
    await flush()
    if (outcome) break
    const waits = [...globalTimers].filter(([, timer]) => [700, 2000, 5000, 10000].includes(timer.delay))
    assert.equal(waits.length, 1, 'an unsettled send must have exactly one bounded recovery wait')
    const [id, timer] = waits[0]!
    globalTimers.delete(id)
    retryDelays.push(timer.delay)
    timer.callback()
  }
  await flush()
  assert.ok(outcome, 'bounded delivery must settle without real sleeps')
  return outcome
}
function userBlocks(state: State) {
  return state.selectedConversationProjection.value.turns.flatMap((turn) => turn.blocks)
    .filter((block) => block.kind === 'user' && block.text === prompt)
}
type HistoryRow = { deliveries: Array<string | null | undefined>; bubbles: number; preview: string | undefined; threadId: string; rendered?: true }
function assertNeverFailed(history: HistoryRow[]): void {
  assert.ok(history.length > 0, 'the synchronous observer must see actual production state transitions')
  const failed = history.filter((row) => row.deliveries.includes('failed') || row.preview === 'failed')
  assert.equal(failed.length, 0, `accepted/uncertain delivery must never flash failed: ${JSON.stringify(failed)}`)
  assert.ok(history.every((row) => !row.threadId || row.threadId === threadId),
    'invalid response identity must never switch the selected task')
  const rendered = history.filter((row) => row.rendered)
  assert.ok(rendered.length > 0, 'the observer must also sample Vue render batches')
  const duplicate = rendered.find((row) => row.bubbles > 1)
  assert.ok(!duplicate, `one rendered logical message must never duplicate: ${JSON.stringify(duplicate)}`)
}
function assertSameClientId(): void {
  const clientMessageId = sendCalls[0]?.clientMessageId
  assert.ok(typeof clientMessageId === 'string' && clientMessageId.length > 0)
  assert.ok(sendCalls.every((call) => call.clientMessageId === clientMessageId), 'idempotent replay must retain clientMessageId')
  for (const call of sendCalls) assert.deepEqual(call, sendCalls[0], 'idempotent replay must retain the original request body')
  assert.ok(lookupIds.every((id) => id === clientMessageId), 'lookup must use the original clientMessageId')
  assert.ok(loadMessageOutboxState().entries.every((entry) => entry.clientMessageId === clientMessageId))
}
let checks = 0
const failures: string[] = []
async function check(name: string, newThread: boolean, run: (state: State, history: HistoryRow[]) => Promise<void>): Promise<void> {
  checks += 1
  fixtureNowMs += 60_000
  storage.clear(); windowTimers.clear(); globalTimers.clear()
  sendCalls.length = 0; lookupIds.length = 0; retryDelays.length = 0; unexpectedRequests.length = 0
  snapshotHasMessage = false; lookupAvailable = false; lookupNeverFound = false; lookupFault = null
  const scope = effectScope()
  const state = scope.run(() => useDesktopState())!
  state.setWorktreeGitAutomationEnabled(false)
  const history: HistoryRow[] = []
  try {
    if (!newThread) await state.selectThread(threadId)
    state.startPolling()
    await flush()
    const observe = () => ({
      deliveries: userBlocks(state).map((block) => block.deliveryState),
      bubbles: userBlocks(state).length,
      preview: state.pendingNewThreadPreview.value?.message.deliveryState,
      threadId: state.selectedThreadId.value,
    })
    scope.run(() => {
      // Catch any erroneous failed transition, including one that later recovers.
      watch(observe, (row) => history.push(row), { flush: 'sync', immediate: true })
      // Snapshot and outbox mutations share a Vue batch; count bubbles when that batch renders.
      watch(observe, (row) => history.push({ ...row, rendered: true }), { flush: 'post', immediate: true })
    })
    await run(state, history)
    assert.deepEqual(unexpectedRequests, [], 'every HTTP dependency must be explicitly stubbed')
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}; sends=${sendCalls.length}, lookups=${lookupIds.length}, waits=${retryDelays.join(',')}`)
  } finally {
    state.stopPolling()
    scope.stop()
    await flush()
  }
}
function send(state: State, newThread: boolean) {
  return newThread ? state.sendMessageToNewThread(prompt, 'C:/fixture/workspace') : state.sendMessageToSelectedThread(prompt)
}
async function verifyAuthoritativeBubble(state: State): Promise<void> {
  snapshotHasMessage = true
  // Explicitly expire the gateway/detail caches without running background timers.
  fixtureNowMs += 60_000
  await state.refreshSelectedThreadContent()
  await flush()
  assert.equal(userBlocks(state).length, 1, `authoritative snapshot and local outbox must converge to one bubble: ${JSON.stringify(state.selectedConversationProjection.value)}`)
  const notification = { method: 'item/completed', params: { threadId, turnId,
    item: { id: 'delivery-contract-user', type: 'userMessage', clientMessageId: sendCalls[0]?.clientMessageId,
      content: [{ type: 'text', text: prompt }] } } }
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify(notification) })
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify(notification) })
  await flush()
  assert.equal(userBlocks(state).length, 1, 'duplicate authoritative item notifications must not add a bubble')
}

for (const newThread of [false, true]) {
  const mode = newThread ? 'new-thread' : 'existing-thread'
  for (const responseFault of ['html502', 'truncated200', 'empty200', 'partialRunning200', 'wrongSendClient200', 'unavailable503', 'missing404'] as const) {
    for (const recoveredStatus of ['running', 'completed'] as const) {
      await check(`${mode} accepted ${responseFault}, delayed lookup ${recoveredStatus}`, newThread, async (state, history) => {
        fault = responseFault; status = recoveredStatus
        const result = await settle(send(state, newThread))
        assertNeverFailed(history)
        assert.equal(result.error, undefined, 'an accepted request must recover after the first 404 lookup')
        assert.equal(sendCalls.length, 2, 'the first unavailable lookup must cause one idempotent replay')
        assert.equal(lookupIds.length, 2, 'the second lookup must settle the accepted request')
        assertSameClientId()
        assert.equal(state.selectedThreadId.value, threadId)
        await verifyAuthoritativeBubble(state)
        assertNeverFailed(history)
      })
    }
  }
  for (const invalidLookup of ['truncated', 'empty', 'wrongClient'] as const) {
    await check(`${mode} ignores ${invalidLookup} lookup before authoritative recovery`, newThread, async (state, history) => {
      fault = 'html502'; status = 'running'; lookupFault = invalidLookup
      const result = await settle(send(state, newThread))
      assertNeverFailed(history)
      assert.equal(result.error, undefined)
      assert.equal(sendCalls.length, 2, 'invalid lookup cannot falsely acknowledge this message')
      assert.equal(lookupIds.length, 2)
      assert.equal(state.selectedThreadId.value, threadId, 'an unrelated lookup identity must not select another task')
      assertSameClientId()
      await verifyAuthoritativeBubble(state)
      assertNeverFailed(history)
    })
  }
  await check(`${mode} explicit 400 rejection fails once without automatic resend`, newThread, async (state, history) => {
    fault = 'rejected400'; status = 'running'
    const result = await settle(send(state, newThread))
    assert.ok(result.error, 'explicit non-acceptance must reject the send')
    assert.equal(sendCalls.length, 1)
    assert.equal(retryDelays.length, 0)
    assert.ok(history.some((row) => row.deliveries.includes('failed') || row.preview === 'failed'))
    assert.equal(loadMessageOutboxState().entries[0]?.state, 'failed')
    state.stopPolling(); state.startPolling(); await flush()
    assert.equal(sendCalls.length, 1, 'reconnecting must not auto-submit explicitly rejected work')
    assertSameClientId()
  })
  for (const exhaustedFault of ['offline', 'html502', 'truncated200', 'empty200'] as const) {
    await check(`${mode} exhausted ${exhaustedFault} recovery stays durable and recovers on reconnect`, newThread, async (state, history) => {
      fault = exhaustedFault; status = 'running'; lookupNeverFound = true
      const result = await settle(send(state, newThread))
      assert.ok(result.error)
      assertNeverFailed(history)
      assert.deepEqual(retryDelays, [700, 2000, 5000, 10000])
      assert.equal(sendCalls.length, 5)
      assert.equal(loadMessageOutboxState().entries.length, 1)
      assert.equal(loadMessageOutboxState().entries[0]?.state, 'waiting')
      assertSameClientId()
      lookupAvailable = true
      state.stopPolling(); state.startPolling(); await flush()
      if (newThread) await state.selectThread(threadId)
      await verifyAuthoritativeBubble(state)
      assertNeverFailed(history)
      assert.equal(sendCalls.length, 5, 'authoritative reconnect recovery must not submit another turn')
      assertSameClientId()
    })
  }
}
Object.assign(globalThis, { setTimeout: realSetTimeout, clearTimeout: realClearTimeout })
Date.now = realDateNow
console.log(`${checks - failures.length}/${checks} delivery-contract checks passed.`)
if (failures.length) process.exitCode = 1
