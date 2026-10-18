import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope, watch } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'
import { loadMessageOutboxState } from '../src/composables/messageOutboxPersistence.js'

const threadId = 'delivery-contract-thread'
const turnId = 'delivery-contract-turn'
const prompt = 'Fixture only: verify one durable delivery'
const MODEL_REJECTED_MESSAGE = 'Fixture model is not supported when using Codex with a ChatGPT account'
const requestedModelId = 'fixture-provider-custom-model'
type State = ReturnType<typeof useDesktopState>
type Fault = 'html502' | 'truncated200' | 'empty200' | 'partialRunning200' | 'wrongSendClient200'
  | 'unavailable503' | 'missing404' | 'rejected400' | 'modelRejected' | 'accepted200' | 'pendingStart200' | 'offline'
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
// Real pending rows served by both the thread snapshot and the pending GET, so the production
// notify/seed path and the reconciliation path observe the same authority.
type PendingRow = { id: number; method: string; receivedAtIso: string; params: Record<string, unknown> }
const pendingRows: PendingRow[] = []
// Actual JSON bodies that reached the POST /codex-api/server-requests/respond boundary.
const replyCalls: Array<Record<string, unknown>> = []
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
    pendingServerRequests: [...pendingRows], updatedAtIso: '2026-09-10T00:00:01Z',
  }
}
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (url === '/codex-api/runtime/send') {
    sendCalls.push(JSON.parse(String(init?.body)))
    if (fault === 'pendingStart200') return respond({ data: { request: {
      ...requestRecord(), clientMessageId: sendCalls[0]?.clientMessageId,
      threadId: '', turnId: '', status: 'pending_start',
    }, threadId: '', turnId: '', status: 'pending_start' } })
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
    if (fault === 'modelRejected') return respond({ error: MODEL_REJECTED_MESSAGE }, 400)
    if (fault === 'accepted200') {
      const sentBody = JSON.parse(String(init?.body)) as { clientMessageId?: string; threadId?: string }
      const acceptedThreadId = sentBody.threadId || threadId
      const request = { ...requestRecord(), clientMessageId: sentBody.clientMessageId, threadId: acceptedThreadId }
      return respond({ data: { request, threadId: acceptedThreadId, turnId, status: 'running' } })
    }
    if (fault === 'offline') throw new TypeError('Failed to fetch')
    throw new Error(`Unconfigured fixture send fault: ${fault}`)
  }
  if (url.startsWith('/codex-api/runtime/request?')) {
    lookupIds.push(new URL(url, 'http://fixture.invalid').searchParams.get('clientMessageId') ?? '')
    if (fault === 'pendingStart200') return respond({ data: {
      ...requestRecord(), clientMessageId: sendCalls[0]?.clientMessageId,
      threadId: '', turnId: '', status: 'pending_start',
    } })
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
  if (url === '/codex-api/server-requests/respond') {
    // Actual fetch boundary: the first attempt really answers HTTP500 and keeps the pending row,
    // the second really answers HTTP200 and removes only the id that arrived on the wire.
    const body = JSON.parse(String(init?.body)) as { id: number }
    replyCalls.push(body)
    if (replyCalls.length === 1) return respond({ error: 'b3c-http-first-failure' }, 500)
    const index = pendingRows.findIndex((row) => row.id === body.id)
    if (index >= 0) pendingRows.splice(index, 1)
    return respond({ data: {} })
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
  if (url === '/codex-api/server-requests/pending') return respond({ data: [...pendingRows] })
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
  pendingRows.length = 0; replyCalls.length = 0
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
const otherChosenModelId = 'fixture-other-chosen-model'
type ModelSnapshot = { selected: string; catalog: string; storage: Array<[string, string]> }
function captureModelSnapshot(state: State, modelId: string): ModelSnapshot {
  return {
    selected: state.selectedModelId.value,
    catalog: JSON.stringify({ models: state.availableModels.value, ids: state.availableModelIds.value }),
    storage: [...storage].filter(([, value]) => value === modelId),
  }
}
function assertModelSnapshotUnchanged(state: State, before: ModelSnapshot): void {
  assert.equal(state.selectedModelId.value, before.selected, 'the selected model must not be swapped implicitly')
  assert.equal(
    JSON.stringify({ models: state.availableModels.value, ids: state.availableModelIds.value }),
    before.catalog,
    'the model catalog must not gain an implicit entry',
  )
  assert.deepEqual(
    [...storage].filter(([key]) => before.storage.some(([modelKey]) => modelKey === key)),
    before.storage,
    'persisted model selection must not be rewritten implicitly',
  )
}
function notify(notification: Record<string, unknown>): void {
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify(notification) })
}
type UserBlockSnapshot = { id: string; text: string; deliveryState: string | null | undefined }
function captureUserBlocks(state: State): UserBlockSnapshot[] {
  return userBlocks(state).map((block) => ({
    id: block.id,
    text: block.text,
    deliveryState: block.deliveryState,
  }))
}
// Identity/state/payload projection: mutable attempt/timestamp bookkeeping is excluded on purpose,
// because outbox recovery may legitimately refresh it after a notification.
function captureOutboxIdentity(): Array<Record<string, unknown>> {
  return loadMessageOutboxState().entries.map((entry) => ({
    clientMessageId: entry.clientMessageId,
    threadId: entry.threadId,
    state: entry.state,
    text: entry.text,
    modelId: entry.modelId,
    createdAtMs: entry.createdAtMs,
  }))
}
// One accepted running turn from a user-chosen model, with the runtime knowing the request id.
async function acceptModelTurn(state: State): Promise<void> {
  fault = 'accepted200'; status = 'running'
  state.setSelectedModelId(requestedModelId)
  const accepted = await settle(send(state, false))
  assert.equal(accepted.error, undefined, 'the accepted fixture turn must not fail')
  assert.equal(sendCalls.length, 1, 'an accepted turn must post exactly one runtime/send')
  lookupAvailable = true
  assert.equal(state.selectedThreadId.value, threadId)
  // Seed the authoritative running snapshot so the accepted turn really is the active execution.
  snapshotHasMessage = true
  fixtureNowMs += 60_000
  await state.refreshSelectedThreadContent()
  await flush()
  assert.equal(
    state.selectedThreadExecutionActive.value,
    true,
    'an accepted running turn must be active before a notification is injected',
  )
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

await check('new-thread accepted pending start stays confirming during notification recovery', true, async (state, history) => {
  fault = 'pendingStart200'
  await settle(send(state, true))
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify({ method: 'thread/started', params: { thread: { id: threadId } } }) })
  await flush()
  assert.ok(sendCalls.length >= 2, 'notification recovery must exercise the idempotent pending-start response')
  assertNeverFailed(history)
  assert.equal(state.pendingNewThreadPreview.value?.message.deliveryState, 'confirming')
  assert.equal(loadMessageOutboxState().entries[0]?.state, 'confirming')
  assertSameClientId()
})

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
  await check(`${mode} explicit model rejection keeps the requested model and never swaps it`, newThread, async (state, history) => {
    fault = 'modelRejected'; status = 'running'
    state.setSelectedModelId(requestedModelId)
    const modelStorageBefore = [...storage].filter(([, value]) => value === requestedModelId)
    assert.ok(modelStorageBefore.length > 0, 'selecting a custom model must persist it before the send')
    const catalogBefore = JSON.stringify({ models: state.availableModels.value, ids: state.availableModelIds.value })
    const result = await settle(send(state, newThread))
    assert.ok(result.error, 'an explicitly rejected model must reject the send')
    assert.match(
      result.error instanceof Error ? result.error.message : String(result.error),
      /model is not supported when using Codex with a ChatGPT account/i,
      'the original model rejection must stay the reported error',
    )
    assert.equal(state.error.value, MODEL_REJECTED_MESSAGE, 'the model rejection must remain visible to the user')
    assert.equal(sendCalls.length, 1, 'an explicitly rejected model must never be replayed implicitly')
    assert.equal(retryDelays.length, 0, 'an explicit rejection must not enter bounded transport recovery')
    assert.ok(
      sendCalls.every((call) => !String(call.model ?? '').includes('gpt-5.2-codex')),
      'no compatibility fallback model may be submitted',
    )
    assert.equal(state.selectedModelId.value, requestedModelId, 'the user-chosen model must not be overwritten')
    assert.deepEqual(
      [...storage].filter(([key]) => modelStorageBefore.some(([modelKey]) => modelKey === key)),
      modelStorageBefore,
      'persisted model selection must stay unchanged',
    )
    assert.equal(
      JSON.stringify({ models: state.availableModels.value, ids: state.availableModelIds.value }),
      catalogBefore,
      'the model catalog must not gain a fabricated entry',
    )
    assert.ok(
      !state.availableModelIds.value.some((id) => id.includes('gpt-5.2-codex')),
      'no compatibility fallback model may be injected into the catalog',
    )
    assert.equal(loadMessageOutboxState().entries.length, 1, 'a rejection must not leave a second outbox entry behind')
    assert.equal(loadMessageOutboxState().entries[0]?.state, 'failed')
    assert.ok(
      history.some((row) => row.deliveries.includes('failed') || row.preview === 'failed'),
      'the failed bubble or preview must be retained for user-initiated retry',
    )
    assert.equal(state.isSendingMessage.value, false)
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
await check('existing-thread completed failed turn is consumed without swapping models', false, async (state) => {
  await acceptModelTurn(state)
  const before = captureModelSnapshot(state, requestedModelId)
  notify({ method: 'turn/completed', params: {
    threadId, turn: { id: turnId, status: 'failed', error: { message: MODEL_REJECTED_MESSAGE } } } })
  await flush()
  assert.equal(state.error.value, MODEL_REJECTED_MESSAGE, 'the completed-turn error must be consumed, not dropped')
  assert.equal(sendCalls.length, 1, 'a matching completed failure must not be replayed on another model')
  assert.equal(retryDelays.length, 0, 'a completed failure must not enter bounded transport recovery')
  assert.deepEqual(unexpectedRequests, [], 'no config write or rollback dependency may appear')
  assertModelSnapshotUnchanged(state, before)
  assert.equal(
    state.selectedThreadExecutionActive.value,
    false,
    'a matching completed failure must settle the active execution instead of leaving it running',
  )
})
await check('existing-thread attributed non-retryable model error fails the matching task without revisiting the model', false, async (state) => {
  await acceptModelTurn(state)
  const before = captureModelSnapshot(state, requestedModelId)
  const blocksBefore = captureUserBlocks(state)
  const outboxBefore = captureOutboxIdentity()
  // Schema-shaped app-server error notification: explicit non-retryable task error for this thread and turn.
  notify({ method: 'error', params: {
    threadId,
    turnId,
    willRetry: false,
    error: { message: MODEL_REJECTED_MESSAGE, codexErrorInfo: null, additionalDetails: null },
  } })
  await flush()
  assert.equal(state.error.value, MODEL_REJECTED_MESSAGE, 'the attributed error must be consumed, not dropped')
  assert.equal(sendCalls.length, 1, 'an explicitly non-retryable error must not be replayed on another model')
  assert.equal(retryDelays.length, 0, 'an explicitly non-retryable error must not enter bounded transport recovery')
  assert.deepEqual(unexpectedRequests, [], 'no config write or rollback dependency may appear')
  assertModelSnapshotUnchanged(state, before)
  assert.deepEqual(captureUserBlocks(state), blocksBefore, 'the visible user message must not be duplicated or re-flagged')
  assert.deepEqual(captureOutboxIdentity(), outboxBefore, 'outbox identity/state/payload must stay intact')
  assert.equal(
    state.selectedThreadExecutionActive.value,
    false,
    'an attributed non-retryable task error must settle the matching execution',
  )
})
await check('existing-thread unattributable model error cannot settle, fail or duplicate effects', false, async (state) => {
  await acceptModelTurn(state)
  const before = captureModelSnapshot(state, requestedModelId)
  const blocksBefore = captureUserBlocks(state)
  assert.equal(blocksBefore.length, 1, 'the fixture must show exactly one visible user block before injection')
  assert.equal(blocksBefore[0]?.text, prompt)
  const outboxBefore = captureOutboxIdentity()
  const runningBefore = state.selectedThreadExecutionActive.value
  assert.equal(runningBefore, true, 'the fixture task must be running before the unattributed error')
  notify({ method: 'error', params: { message: MODEL_REJECTED_MESSAGE } })
  await flush()
  assert.equal(state.error.value, MODEL_REJECTED_MESSAGE, 'the unattributed error must be consumed')
  assert.equal(sendCalls.length, 1, 'an unattributable error must not trigger another send')
  assert.deepEqual(unexpectedRequests, [])
  assertModelSnapshotUnchanged(state, before)
  assert.deepEqual(captureUserBlocks(state), blocksBefore, 'an unattributable error must not fail the visible user message')
  assert.deepEqual(captureOutboxIdentity(), outboxBefore, 'outbox identity/state/payload must stay intact')
  assert.equal(
    state.selectedThreadExecutionActive.value,
    runningBefore,
    'an unattributable error must not stop the selected task',
  )
  notify({ method: 'error', params: { message: MODEL_REJECTED_MESSAGE } })
  await flush()
  assert.equal(state.error.value, MODEL_REJECTED_MESSAGE, 'the duplicate unattributed error must still be consumed')
  assert.equal(sendCalls.length, 1, 'a duplicate unattributable error must not trigger another send')
  assert.deepEqual(unexpectedRequests, [])
  assertModelSnapshotUnchanged(state, before)
  assert.deepEqual(captureUserBlocks(state), blocksBefore, 'a duplicate unattributable error must not fail the user message')
  assert.deepEqual(captureOutboxIdentity(), outboxBefore, 'a duplicate unattributable error must not touch the outbox')
  assert.equal(
    state.selectedThreadExecutionActive.value,
    runningBefore,
    'a duplicate unattributable error must not stop the selected task',
  )
})
await check('existing-thread manual retry reuses the stored request model instead of the new selection', false, async (state) => {
  fault = 'modelRejected'; status = 'running'
  state.setSelectedModelId(requestedModelId)
  const rejected = await settle(send(state, false))
  assert.ok(rejected.error, 'the rejected model must fail the first send')
  const failedBubbles = userBlocks(state).filter((block) => block.deliveryState === 'failed')
  assert.equal(failedBubbles.length, 1, 'the failed user bubble must stay available for an explicit retry')
  const failedBubble = failedBubbles[0]!
  lookupAvailable = false
  state.setSelectedModelId(otherChosenModelId)
  fault = 'accepted200'
  await state.retryFailedUserMessage(failedBubble.id)
  await flush()
  assert.equal(state.selectedModelId.value, otherChosenModelId, 'an explicit retry must not change the selection')
  assert.equal(sendCalls.length, 2, 'only the explicit retry may cause the second send')
  const retryBody = sendCalls[1]!
  assert.equal(retryBody.model, requestedModelId, 'the retry must reuse the stored request model')
  assert.equal(retryBody.threadId, threadId)
  const retryMetadata = (retryBody.queueMetadata ?? {}) as { text?: string; modelId?: string }
  assert.equal(retryMetadata.modelId, requestedModelId, 'the retried payload must keep the stored model')
  assert.equal(retryMetadata.text, prompt, 'the retried payload must keep the original text')
  assert.equal(userBlocks(state).length, 1, 'the retry must reuse the failed bubble instead of duplicating it')
})
await check('permissions approval keeps its pending row after a real HTTP failure and retries the same numeric id', false, async (state) => {
  const pendingRow = (id: number): PendingRow => ({
    id,
    method: 'item/permissions/requestApproval',
    receivedAtIso: '2026-09-10T00:00:01Z',
    params: {
      threadId, turnId, itemId: `b3c-http-fixture-item-${String(id)}`,
      environmentId: 'b3c-example-environment', startedAtMs: 1788998400000,
      cwd: './workspace', reason: `B3C retry synthetic scope ${String(id)}`,
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  })
  pendingRows.push(pendingRow(7314), pendingRow(7315))
  // Real production seed path: the same notification the runtime emits.
  for (const row of pendingRows) notify({ method: 'server/request', params: row })
  await flush()
  const pendingIds = (): number[] => state.selectedThreadServerRequests.value.map((request) => request.id)
  assert.deepEqual(pendingIds(), [7314, 7315], 'the production notify path must seed both synthetic pendings')
  const responseErrors: Array<{ id: number; message: string }> = []
  // Inferred reply variable: the UI-only callback must never become part of a declared wire type.
  const reply = {
    id: 7314,
    result: { permissions: {}, scope: 'turn' },
    onResponseError: (message: string) => responseErrors.push({ id: 7314, message }),
  }
  const wireReply = { id: 7314, result: { permissions: {}, scope: 'turn' } }
  await state.respondToPendingServerRequest(reply)
  await flush()
  assert.equal(replyCalls.length, 1, 'the production reply path must reach the POST boundary exactly once')
  assert.deepEqual(replyCalls, [wireReply], 'the wire body must carry the numeric id and result without the UI callback')
  assert.deepEqual(pendingIds(), [7314, 7315], 'a real HTTP failure must retain both pending requests')
  assert.equal(replyCalls.length, 1, 'a failed reply must not auto retry')
  assert.deepEqual(responseErrors, [{ id: 7314, message: 'b3c-http-first-failure' }],
    'the production catch must report the first HTTP failure through the original callback exactly once')
  // Second real user action: same numeric ID, same result, only the answered pending may disappear.
  await state.respondToPendingServerRequest(reply)
  await flush()
  assert.equal(replyCalls.length, 2, 'the retry must post exactly one further wire body')
  assert.deepEqual(pendingIds(), [7315], 'a successful retry must remove only the answered ID')
  assert.equal(responseErrors.length, 1, 'a successful retry must not report another failure')
  assert.deepEqual(replyCalls, [wireReply, wireReply], 'the retry must reuse the same numeric ID and result off the wire')
})
Object.assign(globalThis, { setTimeout: realSetTimeout, clearTimeout: realClearTimeout })
Date.now = realDateNow
console.log(`${checks - failures.length}/${checks} delivery-contract checks passed.`)
if (failures.length) process.exitCode = 1
