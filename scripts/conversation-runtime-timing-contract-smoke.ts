import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'

// Agreed seam: public selection + notification transport -> real gateway,
// state and projection. Only HTTP, browser facilities and the clock are fixtures.
// No background timer runs, and no production timing/state helper is replaced.
const caseName = process.argv[2] ?? 'new-turn-before-snapshot'
const threadId = `runtime-timing-${caseName}`
const turnA = `${threadId}-A`
const turnB = `${threadId}-B`
const baseMs = Date.parse('2026-09-10T12:00:00.000Z')
let nowMs = baseMs + 37_130
const sameTurn = caseName === 'same-turn-keeps-start'
const fillStart = caseName === 'same-sequence-fills-start'
const syncDegraded = caseName === 'same-turn-recovers-from-sync-degraded'
const initiallyRunning = sameTurn || fillStart || syncDegraded
if (sameTurn || syncDegraded) nowMs = baseMs + 39_000
if (fillStart || caseName === 'native-start-before-envelope') nowMs = baseMs + 39_130
const pendingPrompt = 'Fixture B accepted before a turn start exists.'
const iso = (offset: number) => new Date(baseMs + offset).toISOString()
const unix = (offset: number) => (baseMs + offset) / 1_000
const storage = new Map<string, string>([
  ['codex-web-local.notification-cursor.v2', JSON.stringify({ cursor: 1, streamId: 'fixture-timing-stream' })],
])
const timers = new Map<number, () => void>()
let timerId = 0
const originalNow = Date.now
const originalGlobals = new Map(['window', 'WebSocket', 'fetch', 'setTimeout', 'clearTimeout']
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const addTimer = (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id }
class FixtureWebSocket {
  static current: FixtureWebSocket | null = null
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor() { FixtureWebSocket.current = this }
  close() { this.readyState = 3 }
}
Date.now = () => nowMs
Object.assign(globalThis, {
  WebSocket: FixtureWebSocket,
  setTimeout: addTimer, clearTimeout: (id: number) => timers.delete(id),
  window: {
    performance: globalThis.performance,
    localStorage: {
      get length() { return storage.size }, key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: addTimer, clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++timerId, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    location: { protocol: 'http:', host: 'fixture.invalid', origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
  },
})
const respond = (value: unknown) => Response.json(value)
const requestLog: string[] = []
const unexpectedRequests: string[] = []
const sentRequests: Array<Record<string, unknown>> = []
let holdNextStateRead = false
let releaseOldState: (() => void) | null = null
const responseLog: Array<{ kind: string; atMs: number; activeTurnId: string; lastEventSeq: number }> = []
function threadRead() {
  return { thread: { id: threadId, turns: [{
    id: turnA, status: 'completed', startedAt: unix(1_000), completedAt: unix(6_000),
    items: [
      { id: 'user-A', type: 'userMessage', clientId: 'client-A', content: [{ type: 'text', text: 'Fixture completed turn A.' }] },
      { id: 'final-A', type: 'agentMessage', phase: 'final_answer', text: 'Fixture A is complete.' },
    ],
  }, ...(initiallyRunning ? [{ id: turnB, status: 'inProgress', startedAt: fillStart ? null : unix(37_000), items: [
    { id: 'user-B', type: 'userMessage', clientId: 'client-B', content: [{ type: 'text', text: 'Fixture running turn B.' }] },
  ] }] : [])] } }
}
function runtime() {
  return {
    threadId, executionState: syncDegraded ? 'sync_degraded' : initiallyRunning ? 'running' : 'completed',
    inProgress: initiallyRunning, canStop: initiallyRunning, activeTurnId: initiallyRunning ? turnB : '',
    activeItemId: '', stale: false, stopRequested: false, pendingServerRequests: [],
    updatedAtIso: iso(initiallyRunning ? 37_000 : 6_000), lastEventSeq: fillStart ? 0 : 1,
    lastStartedAtIso: fillStart ? null : iso(initiallyRunning ? 37_000 : 1_000), lastCompletedAtIso: iso(6_000),
  }
}
globalThis.fetch = async (input, init) => {
  const url = String(input)
  requestLog.push(url)
  if (url === '/codex-api/runtime/send') {
    const sent = JSON.parse(String(init?.body))
    sentRequests.push(sent)
    return respond({ data: {
      request: { requestId: 'fixture-pending-request', clientMessageId: sent.clientMessageId,
        threadId, turnId: '', status: 'start_uncertain', lastError: null },
      threadId, turnId: '', status: 'start_uncertain',
    } })
  }
  if (url.startsWith(`/codex-api/state/thread/${threadId}`)) {
    // Freeze response data when the request starts. Releasing late A must not
    // accidentally obtain B facts just because a notification has since arrived.
    const snapshot = { ...runtime(), threadRead: threadRead(), messageState: 'fresh' }
    const response = () => {
      responseLog.push({ kind: 'state', atMs: nowMs, activeTurnId: snapshot.activeTurnId, lastEventSeq: snapshot.lastEventSeq })
      return respond({ data: snapshot })
    }
    if (holdNextStateRead) {
      holdNextStateRead = false
      return new Promise<Response>((resolve) => { releaseOldState = () => { releaseOldState = null; resolve(response()) } })
    }
    return response()
  }
  if (url === `/codex-api/runtime/thread/${threadId}/reconcile`) return respond({ data: { snapshot: runtime() } })
  if (url === `/codex-api/runtime/thread/${threadId}`) return respond({ data: runtime() })
  if (url.startsWith('/codex-api/events/replay')) {
    return respond({ data: { notifications: [], latestSeq: 1, oldestSeq: 1, streamId: 'fixture-timing-stream' } })
  }
  if (url === '/codex-api/rpc') {
    const { method } = JSON.parse(String(init?.body))
    if (method === 'thread/list') return respond({ result: { data: [{
      id: threadId, cwd: 'C:/fixture/workspace', preview: 'Timing contract', createdAt: 100, updatedAt: 100,
    }], nextCursor: null } })
    if (method === 'thread/read') return respond({ result: threadRead() })
    if (method === 'thread/goal/get') return respond({ result: { goal: null } })
    if (method === 'generate-thread-title') return respond({ result: { title: '' } })
    unexpectedRequests.push(`RPC ${method}`)
    throw new Error(`Unexpected RPC ${method}`)
  }
  if (url === '/codex-api/workspace-roots-state') return respond({ data: { roots: [], activeRoots: [], labels: {} } })
  if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
  if (url === '/codex-api/server-requests/pending') return respond({ data: [] })
  if (url.startsWith('/codex-api/runtime/queue')) return respond({ data: [] })
  if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
  unexpectedRequests.push(url)
  throw new Error(`Unexpected fetch ${url}`)
}
async function flush() {
  for (let index = 0; index < 8; index += 1) await nextEventLoop()
}
const scope = effectScope()
const state = scope.run(() => useDesktopState())!
state.setWorktreeGitAutomationEnabled(false)
function projected(id: string) {
  const turn = state.selectedConversationProjection.value.turns.find((value) => value.id === id)
  assert.ok(turn, `the real projection must contain ${id}`)
  return turn
}
let seq = 1
async function notify(method: string, params: Record<string, unknown>, atIso = new Date(nowMs).toISOString(), sequenced = true) {
  assert.ok(FixtureWebSocket.current?.onmessage, 'public polling must install the real transport callback')
  FixtureWebSocket.current.onmessage({ data: JSON.stringify({ method, params: { threadId, ...params },
    ...(sequenced ? { seq: ++seq } : {}), atIso }) })
  await flush()
}
try {
  await state.refreshAll({ loadMessages: false, loadSkills: false, refreshModelPreferences: false })
  await state.selectThread(threadId)
  await flush()
  assert.equal(projected(turnA).activeElapsedMs, 5_000, 'completed A has a real five-second duration')
  state.startPolling()
  await flush()
  assert.ok(FixtureWebSocket.current?.onopen)
  FixtureWebSocket.current.onopen()
  await flush()
  const readsBeforeNotice = requestLog.filter((url) => url.startsWith('/codex-api/state/thread/')).length
  if (caseName === 'accepted-without-start') {
    await state.sendMessageToSelectedThread(pendingPrompt)
    await flush()
    assert.equal(sentRequests.length, 1, 'the public send must actually receive one accepted request')
    const localTurn = state.selectedConversationProjection.value.turns.find((turn) => turn.blocks.some((block) =>
      block.kind === 'user' && block.text === pendingPrompt))
    assert.ok(localTurn, 'an accepted request remains readable without a turn start')
    assert.equal(localTurn.startedAtMs, null, 'no turn ID or start may borrow the last completed runtime start')
    assert.equal(localTurn.activeElapsedMs, null, 'delivery uncertainty does not manufacture an execution clock')
    assert.equal(state.selectedThreadRuntimeStatus.value.lastStartedAtIso, null,
      'an accepted new execution without a turn ID clears the previous thread-level start')
    assert.equal(state.selectedThreadRuntimeStatus.value.lastCompletedAtIso, null,
      'a new execution cannot pair its eventual start with the previous completion')
  } else if (syncDegraded) {
    assert.equal(state.selectedThreadRuntimeStatus.value.executionState, 'sync_degraded',
      'the degraded state must come from the real HTTP snapshot, not an unsupported status notification')
    assert.equal(state.selectedThreadRuntimeStatus.value.activeTurnId, turnB)
    assert.equal(state.selectedThreadRuntimeStatus.value.lastStartedAtIso, iso(37_000))
    nowMs = baseMs + 41_000
    await notify('server/request/resolved', { id: 'fixture-resolved-B', turnId: turnB })
    assert.equal(state.selectedThreadRuntimeStatus.value.executionState, 'running')
    assert.equal(state.selectedThreadRuntimeStatus.value.activeTurnId, turnB)
    assert.equal(state.selectedThreadRuntimeStatus.value.lastStartedAtIso, iso(37_000),
      'same-turn recovery from sync_degraded preserves its known start; it is not a new execution')
    assert.equal(projected(turnB).startedAtMs, baseMs + 37_000)
    assert.equal(projected(turnB).activeElapsedMs, 4_000)
  } else if (fillStart) {
    assert.equal(projected(turnB).startedAtMs, null, 'the initial B lifecycle explicitly has unknown start time')
    assert.equal(state.selectedThreadRuntimeStatus.value.lastEventSeq, 0)
    // Unsequenced legacy/native delivery is a real supported wire path. Sending
    // seq:0 would instead be discarded by replay ordering, testing another seam.
    await notify('turn/started', { turn: { id: turnB, status: 'inProgress', startedAt: unix(37_000), items: [] } }, iso(39_000), false)
    assert.equal(state.selectedThreadRuntimeStatus.value.lastEventSeq, 0)
    assert.equal(state.selectedThreadRuntimeStatus.value.lastStartedAtIso, iso(37_000),
      'same state, turn, canStop and sequence still accept a previously missing native start')
    assert.equal(projected(turnB).startedAtMs, baseMs + 37_000)
    assert.equal(projected(turnB).activeElapsedMs, 2_130)
  } else if (sameTurn) {
    assert.equal(projected(turnB).activeElapsedMs, 2_000)
    await notify('turn/started', { turn: { id: turnB, status: 'inProgress', items: [] } })
    assert.equal(projected(turnB).startedAtMs, baseMs + 37_000,
      'a repeat start without new timestamp cannot reset the same turn to notification arrival')
    assert.equal(projected(turnB).activeElapsedMs, 2_000)
    nowMs = baseMs + 41_000
    await notify('item/started', { turnId: turnB,
      item: { id: 'commentary-B', type: 'agentMessage', phase: 'commentary', text: 'Fixture public progress.' } })
    assert.equal(projected(turnB).startedAtMs, baseMs + 37_000,
      'ordinary progress metadata preserves the existing same-turn clock')
    assert.equal(projected(turnB).activeElapsedMs, 4_000)
  } else {
    let pendingRefresh: Promise<void> | undefined
    if (caseName === 'late-old-snapshot') {
      holdNextStateRead = true
      pendingRefresh = state.refreshSelectedThreadContent()
      await flush()
      assert.ok(releaseOldState, 'an actual HTTP state read of old A must be in flight before B starts')
    }
    // Turn fields use the actual v2 protocol's Unix seconds. This fixture's
    // notification envelope has the same known start, independently of arrival.
    await notify('turn/started', { turn: { id: turnB, status: 'inProgress', startedAt: unix(37_000), items: [] } },
      iso(caseName === 'native-start-before-envelope' ? 39_000 : 37_000))
    assert.equal(requestLog.filter((url) => url.startsWith('/codex-api/state/thread/')).length,
      readsBeforeNotice + (caseName === 'late-old-snapshot' ? 1 : 0),
      'the short notification window must not be rescued by a newer HTTP snapshot')
    assert.equal(projected(turnB).state, 'running')
    if (caseName !== 'completed-duration-preserved') {
      assert.equal(projected(turnB).startedAtMs, baseMs + 37_000,
        'new B must retain its own explicit start instead of borrowing completed A runtime timing')
      assert.equal(projected(turnB).activeElapsedMs, caseName === 'native-start-before-envelope' ? 2_130 : 130,
        'B uses its native start, not old A timing or a later notification arrival')
    }
    if (pendingRefresh) {
      assert.equal(state.selectedThreadRuntimeStatus.value.lastEventSeq, 2)
      const release = releaseOldState
      assert.ok(release)
      release()
      await pendingRefresh
      await flush()
      assert.equal(responseLog.at(-1)?.lastEventSeq, 1, 'the response really released an older runtime version')
      assert.equal(state.selectedThreadRuntimeStatus.value.activeTurnId, turnB)
      assert.equal(state.selectedThreadRuntimeStatus.value.lastEventSeq, 2)
      assert.equal(projected(turnB).state, 'running')
      assert.equal(projected(turnB).startedAtMs, baseMs + 37_000, 'late A cannot overwrite the newer bound B clock')
      assert.equal(projected(turnB).activeElapsedMs, 130)
    }
  }
  assert.equal(projected(turnA).state, 'completed')
  assert.equal(projected(turnA).startedAtMs, baseMs + 1_000)
  assert.equal(projected(turnA).completedAtMs, baseMs + 6_000)
  assert.equal(projected(turnA).activeElapsedMs, 5_000, 'starting B must not alter the completed A duration')
  assert.deepEqual(unexpectedRequests, [])
  console.log(`PASS ${caseName}`)
} catch (error) {
  console.error(`FAIL ${caseName}: ${error instanceof Error ? error.message : String(error)}`)
  console.error(JSON.stringify({ caseName, nowMs, requestLog, responseLog,
    turns: state.selectedConversationProjection.value.turns.map(({ id, state, startedAtMs, completedAtMs, activeElapsedMs }) =>
      ({ id, state, startedAtMs, completedAtMs, activeElapsedMs })) }))
  process.exitCode = 1
} finally {
  releaseOldState?.()
  state.stopPolling()
  scope.stop()
  await flush()
  Date.now = originalNow
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}
