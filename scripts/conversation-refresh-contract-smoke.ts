import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope, watch } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'

// Agreed public seam: user selection/refresh -> the real HTTP gateway -> the
// real conversation projection. Only the browser environment and HTTP server
// boundary are fixtures; no production composable or projector is replaced.
type State = ReturnType<typeof useDesktopState>
type Timer = { callback: () => void; delay: number }
const windowTimers = new Map<number, Timer>()
const globalTimers = new Map<number, Timer>()
const storage = new Map<string, string>()
let timerId = 0
const baseMs = Date.parse('2026-09-10T12:00:00.000Z')
const caseName = process.argv[2] ?? 'inflight-selection'
const automaticCase = ['automatic-connected-refresh', 'cancelled-followup-valid-refresh', 'notification-during-automatic-read'].includes(caseName)
if (automaticCase) {
  // A returning client has a real persisted cursor. Starting at cursor zero
  // intentionally takes snapshot recovery instead of the automatic sync seam.
  storage.set('codex-web-local.notification-cursor.v2', JSON.stringify({ cursor: 1, streamId: 'fixture-refresh-stream' }))
}
const threadId = `refresh-contract-${caseName}-thread`
const turnId = `refresh-contract-${caseName}-turn`
const clientId = `refresh-contract-${caseName}-client`
const finalText = 'The new authoritative terminal response is visible.'
const oldFinalText = 'The earlier completed reply remains readable.'
const newestFinalText = 'The later invalidation requires its own newer reply.'
type Version = 'running-A' | 'completed-old' | 'completed-new' | 'completed-latest'
type MessageState = 'fresh' | 'cached' | 'unavailable'
let fixtureNowMs = baseMs + 30_000
const priorGlobals = new Map(['fetch', 'window', 'setTimeout', 'clearTimeout', 'WebSocket']
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const realDateNow = Date.now

function addTimer(target: Map<number, Timer>, callback: () => void, delay = 0): number {
  const id = ++timerId
  target.set(id, { callback, delay })
  return id
}
Date.now = () => fixtureNowMs
class FixtureWebSocket {
  static current: FixtureWebSocket | null = null
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor() { FixtureWebSocket.current = this }
  close() { this.readyState = 3 }
}
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
})
function runtime(version: Version) {
  const completed = version !== 'running-A'
  const sequence = version === 'running-A' ? 5 : version === 'completed-old' ? 10 : version === 'completed-new' ? 20 : 25
  return {
    threadId, executionState: completed ? 'completed' : 'running',
    inProgress: !completed, canStop: !completed, activeTurnId: completed ? '' : turnId,
    activeItemId: '', stale: false, stopRequested: false, pendingServerRequests: [],
    // Log content may change before its sidebar metadata version. Keep those
    // independent in the notification contract instead of relying on a sidebar
    // version mismatch to accidentally rescue a discarded dirty notification.
    updatedAtIso: new Date(baseMs + (caseName === 'notification-during-automatic-read' ? 10 : sequence) * 1_000).toISOString(),
    lastStartedAtIso: new Date(baseMs).toISOString(),
    lastCompletedAtIso: completed ? new Date(baseMs + sequence * 1_000).toISOString() : null,
    lastEventSeq: caseName === 'same-sequence-completion-time' ? 0 : sequence,
  }
}
function threadRead(version: Version) {
  const completed = version !== 'running-A'
  return { thread: { id: threadId, turns: [{
    id: turnId, status: completed ? 'completed' : 'inProgress',
    startedAt: new Date(baseMs).toISOString(),
    ...(completed ? { completedAt: runtime(version).lastCompletedAtIso } : {}),
    items: [
      { id: 'refresh-contract-user', type: 'userMessage', clientId,
        content: [{ type: 'text', text: 'Fixture: check the latest result.' }] },
      { id: 'refresh-contract-commentary', type: 'agentMessage', phase: 'commentary', text: 'Public progress before completion.' },
      ...(completed ? [{ id: 'refresh-contract-final', type: 'agentMessage', phase: 'final_answer',
        text: version === 'completed-latest' ? newestFinalText : version === 'completed-new' ? finalText : oldFinalText }] : []),
    ],
  }] } }
}
function snapshot(version: Version, messageState: MessageState) {
  return { ...runtime(version), threadRead: messageState === 'unavailable' ? null : threadRead(version), messageState }
}

type RequestRecord = { phase: 'request' | 'response' | 'failure'; id: number; url: string; version?: Version; messageState?: MessageState; error?: string }
const requestLog: RequestRecord[] = []
const unexpectedRequests: string[] = []
const heldRequests: Array<{ id: number; url: string; version: Version; source: MessageState; result: ReturnType<typeof deferred<Response>>; signal?: AbortSignal | null }> = []
let stateReads = 0
let requestId = 0
const pendingSelectionCase = [
  'inflight-selection', 'coalesced-refreshes', 'old-request-rejected', 'old-request-aborted',
  'shared-followup-rejected', 'new-invalidation-after-followup-start',
].includes(caseName)
let versionOnServer: Version = pendingSelectionCase ? 'running-A' : 'completed-old'
let sourceOnServer: MessageState = caseName === 'cached-source' || caseName === 'cached-to-fresh-after-runtime' ? 'cached' : 'fresh'
let holdNextState = pendingSelectionCase
let detailUnavailable = false
function releaseHeldState(): void {
  const held = heldRequests.shift()
  if (!held) return
  requestLog.push({ phase: 'response', id: held.id, url: held.url, version: held.version, messageState: held.source })
  held.result.resolve(respond({ data: snapshot(held.version, held.source) }))
}
function failHeldState(): void {
  const held = heldRequests.shift()
  assert.ok(held, 'the HTTP request being failed must actually be pending')
  requestLog.push({ phase: 'failure', id: held.id, url: held.url, version: held.version, error: 'HTTP 503' })
  held.result.resolve(respond({ error: 'Fixture temporary state read failure.' }, 503))
}
globalThis.fetch = async (input, init) => {
  const url = String(input)
  const id = ++requestId
  requestLog.push({ phase: 'request', id, url })
  if (url.startsWith(`/codex-api/state/thread/${threadId}`)) {
    stateReads += 1
    const version = versionOnServer
    const source = sourceOnServer
    if (holdNextState) {
      holdNextState = false
      const result = deferred<Response>()
      heldRequests.push({ id, url, version, source, result, signal: init?.signal })
      if (caseName === 'old-request-aborted' || caseName === 'cancelled-followup-valid-refresh') {
        init?.signal?.addEventListener('abort', () => {
          requestLog.push({ phase: 'failure', id, url, version, error: 'AbortSignal' })
          result.reject(new DOMException('Fixture caller cancelled its old read.', 'AbortError'))
        }, { once: true })
      }
      return result.promise
    }
    requestLog.push({ phase: 'response', id, url, version, messageState: source })
    return respond({ data: snapshot(version, source) })
  }
  if (url === `/codex-api/runtime/thread/${threadId}/reconcile`) {
    // This endpoint carries runtime facts only, never threadRead or UI messages.
    requestLog.push({ phase: 'response', id, url, version: versionOnServer })
    return respond({ data: { snapshot: runtime(versionOnServer) } })
  }
  if (url === `/codex-api/runtime/thread/${threadId}`) {
    requestLog.push({ phase: 'response', id, url, version: versionOnServer })
    return respond({ data: runtime(versionOnServer) })
  }
  if (url.startsWith('/codex-api/events/replay')) {
    return respond({ data: { notifications: [], latestSeq: automaticCase ? 1 : 0, oldestSeq: automaticCase ? 1 : 0,
      streamId: automaticCase ? 'fixture-refresh-stream' : '' } })
  }
  if (url === '/codex-api/rpc') {
    const { method } = JSON.parse(String(init?.body))
    if (method === 'thread/list') return respond({ result: { data: [{
      id: threadId, cwd: 'C:/fixture/workspace', preview: 'Refresh contract', createdAt: 100,
      updatedAt: caseName === 'notification-during-automatic-read' ? (baseMs + 10_000) / 1_000 : 100,
    }], nextCursor: null } })
    if (method === 'thread/read') {
      requestLog.push({ phase: 'response', id, url: 'RPC thread/read', version: versionOnServer,
        messageState: detailUnavailable ? 'unavailable' : 'fresh' })
      return detailUnavailable
        ? respond({ error: 'Fixture content is temporarily unavailable.' }, 503)
        : respond({ result: threadRead(versionOnServer) })
    }
    if (method === 'thread/goal/get') return respond({ result: { goal: null } })
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

async function flush(): Promise<void> {
  // Drain response parsing and Vue batches; never fire a clock or retry timer.
  for (let index = 0; index < 8; index += 1) await nextEventLoop()
}
function observePromise(promise: Promise<unknown>) {
  let outcome: { error?: unknown } | undefined
  void promise.then(() => { outcome = {} }, (error: unknown) => { outcome = { error } })
  return () => outcome
}
function visibleFinal(state: State): string | undefined {
  return state.selectedConversationProjection.value.turns.find((turn) => turn.id === turnId)?.final?.text
}
async function requireSettled(outcome: ReturnType<typeof observePromise>, label: string): Promise<void> {
  await flush()
  assert.ok(outcome(), `${label} must settle without timer retries or wall-clock sleeps`)
  assert.equal(outcome()?.error, undefined, `${label} must not reject`)
}
function assertNewFinal(state: State, expectedText = finalText, expectedVersion: Version = 'completed-new'): void {
  assert.equal(visibleFinal(state), expectedText,
    'an explicit refresh must obtain the newer terminal content, not silently reuse old work or a recent cache')
  assert.equal(state.selectedConversationProjection.value.turns.find((turn) => turn.id === turnId)?.state, 'completed')
  assert.ok(requestLog.some((entry) => entry.phase === 'response' && entry.version === expectedVersion
    && entry.messageState === 'fresh'), 'the final reply must come from an actually released fresh content response')
}

const scope = effectScope()
const state = scope.run(() => useDesktopState())!
const renderedFinals: Array<string | undefined> = []
state.setWorktreeGitAutomationEnabled(false)
scope.run(() => watch(() => visibleFinal(state), (value) => renderedFinals.push(value), { flush: 'post', immediate: true }))
try {
  if (automaticCase) {
    await requireSettled(observePromise(state.refreshAll({ loadMessages: false, loadSkills: false, refreshModelPreferences: false })), 'initial task list')
  }
  const selection = observePromise(state.selectThread(threadId))
  await flush()
  assert.equal(stateReads, 1, 'selection must reach the real state gateway')
  if (pendingSelectionCase) {
    assert.equal(selection(), undefined, 'HTTP request A remains pending until explicitly released')
    versionOnServer = 'completed-new'
    const refreshes = Array.from({ length: caseName === 'coalesced-refreshes' ? 3 : caseName === 'shared-followup-rejected' ? 2 : 1 },
      () => observePromise(state.refreshSelectedThreadContent()))
    await flush()
    assert.ok(requestLog.some((request) => request.url.endsWith('/reconcile')), 'refresh B must reach the runtime-only public endpoint')
    if (stateReads === 1) {
      assert.equal(visibleFinal(state), undefined, 'runtime-only terminal facts must not manufacture final reply content')
    }
    // Release exactly the version captured when A began, not the current server
    // version. Keep accepting late bytes even if a future implementation aborts A.
    if (caseName === 'old-request-rejected') {
      failHeldState()
    } else if (caseName === 'old-request-aborted') {
      const oldSignal = heldRequests[0]?.signal
      assert.ok(oldSignal && !oldSignal.aborted)
      const reselection = observePromise(state.selectThread(threadId))
      assert.equal(oldSignal.aborted, true, 'the real public reselection must abort the previous selection signal')
      await requireSettled(reselection, 'replacement selection')
    } else {
      releaseHeldState()
    }
    if (caseName === 'shared-followup-rejected' || caseName === 'new-invalidation-after-followup-start') {
      // The first request was synchronously released above; freeze its successor
      // before the async reader resumes so R2's body cannot see later updates.
      holdNextState = true
      await flush()
      assert.equal(stateReads, 2, 'R2 must have really started before testing its boundary')
      assert.equal(heldRequests[0]?.version, 'completed-new')
      if (caseName === 'shared-followup-rejected') {
        failHeldState()
        await flush()
        assert.ok(refreshes.every((refresh) => refresh()), 'all refresh callers must settle after the shared failure and replacement')
        assert.equal(refreshes.filter((refresh) => refresh()?.error).length, 1, 'only the owner of failed R2 reports its read failure')
        assertNewFinal(state)
        assert.equal(stateReads, 3, 'another valid waiter must issue one recovery read after R2 failed')
      } else {
        versionOnServer = 'completed-latest'
        const laterRefresh = observePromise(state.refreshSelectedThreadContent())
        await flush()
        assert.equal(visibleFinal(state), undefined, 'new runtime facts alone cannot manufacture the version requested after R2 began')
        releaseHeldState()
        for (const refresh of refreshes) await requireSettled(refresh, 'refresh B')
        await requireSettled(laterRefresh, 'later refresh D')
        assertNewFinal(state, newestFinalText, 'completed-latest')
        assert.equal(stateReads, 3, 'D arrived after R2 captured its version and therefore needs R3')
        const released = requestLog.filter((entry) => entry.phase === 'response' && entry.url.includes('/state/thread/'))
        assert.deepEqual(released.map((entry) => entry.version), ['running-A', 'completed-new', 'completed-latest'])
      }
    } else {
      for (const refresh of refreshes) await requireSettled(refresh, 'refresh B')
      assertNewFinal(state)
    }
    await requireSettled(selection, 'selection A')
    if (caseName === 'coalesced-refreshes') {
      assert.equal(stateReads, 2, 'three concurrent explicit refreshes must share one newer follow-up content read')
    }
    const expectedFinal = caseName === 'new-invalidation-after-followup-start' ? newestFinalText : finalText
    const firstFinal = renderedFinals.indexOf(expectedFinal)
    assert.ok(firstFinal >= 0, 'the actual Vue render observer must see the new terminal reply')
    assert.ok(renderedFinals.slice(firstFinal).every((value) => value === expectedFinal), 'late old state must not erase the rendered terminal reply')
  } else {
    await requireSettled(selection, 'initial selection')
    assert.equal(visibleFinal(state), oldFinalText, 'the initial completed snapshot must actually render before refresh')
    if (caseName === 'cached-source') {
      assert.equal(state.selectedConversationProjection.value.sourceState, 'cached', 'a cached state body cannot be called fresh')
      assert.equal(stateReads, 1, 'background retry timers are not executed by this fixture')
    } else if (caseName === 'runtime-source-preserved' || caseName === 'cached-to-fresh-after-runtime' || caseName === 'same-sequence-completion-time') {
      const originalSource = caseName === 'cached-to-fresh-after-runtime' ? 'cached' : 'fresh'
      assert.equal(state.selectedConversationProjection.value.sourceState, originalSource)
      if (caseName === 'cached-to-fresh-after-runtime' || caseName === 'same-sequence-completion-time') {
        versionOnServer = 'completed-new'
        sourceOnServer = 'fresh'
      }
      holdNextState = true
      const refresh = observePromise(state.refreshSelectedThreadContent())
      await flush()
      assert.ok(requestLog.some((request) => request.url.endsWith('/reconcile')))
      assert.equal(state.selectedConversationProjection.value.sourceState, caseName === 'same-sequence-completion-time' ? 'cached' : originalSource,
        'runtime-only reconcile cannot downgrade the provenance of the already loaded fresh body while content refresh is pending')
      assert.equal(visibleFinal(state), oldFinalText, 'runtime-only status cannot erase the already loaded body')
      releaseHeldState()
      await requireSettled(refresh, 'same-version refresh')
      assert.equal(state.selectedConversationProjection.value.sourceState, 'fresh')
      if (caseName === 'cached-to-fresh-after-runtime' || caseName === 'same-sequence-completion-time') assertNewFinal(state)
    } else if (automaticCase) {
      fixtureNowMs += 6_000
      versionOnServer = 'completed-new'
      if (caseName === 'cancelled-followup-valid-refresh' || caseName === 'notification-during-automatic-read') holdNextState = true
      state.markThreadAsUnread(threadId)
      state.startPolling()
      await flush()
      assert.ok(FixtureWebSocket.current?.onopen, 'the real public polling interface must subscribe the notification transport')
      FixtureWebSocket.current.onopen()
      await flush()
      if (caseName === 'notification-during-automatic-read') {
        assert.equal(stateReads, 2, 'automatic R2 must be pending when the new body invalidation arrives')
        assert.equal(heldRequests[0]?.version, 'completed-new')
        const beforeNotificationTimers = new Set(windowTimers.keys())
        versionOnServer = 'completed-latest'
        FixtureWebSocket.current.onmessage?.({ data: JSON.stringify({
          method: 'cx/session-files/changed', seq: 2, atIso: new Date(fixtureNowMs).toISOString(),
          params: { threadId, source: 'session-log' },
        }) })
        await flush()
        const notificationDebounces = [...windowTimers].filter(([id, timer]) => !beforeNotificationTimers.has(id) && timer.delay === 350)
        assert.equal(notificationDebounces.length, 1, 'the actual body notification must schedule one identifiable debounce')
        releaseHeldState()
        await flush()
        assert.equal(visibleFinal(state), finalText, 'R2 returns only its captured version, not the later body')
        const pendingEventCallbacks = [...windowTimers].filter(([id, timer]) => !beforeNotificationTimers.has(id) && (timer.delay === 350 || timer.delay === 0))
        assert.equal(pendingEventCallbacks.length, 1, 'only the notification debounce or its immediate successor is executed')
        const [id, timer] = pendingEventCallbacks[0]!
        windowTimers.delete(id)
        fixtureNowMs += timer.delay
        timer.callback()
        await flush()
        assertNewFinal(state, newestFinalText, 'completed-latest')
        assert.equal(stateReads, 3, 'an invalidation received during R2 must survive until one newer body read')
      }
      if (caseName === 'cancelled-followup-valid-refresh') {
        assert.equal(stateReads, 2, 'the automatic R2 must begin before valid caller C cancels it')
        assert.equal(heldRequests[0]?.version, 'completed-new')
        const cancelledSignal = heldRequests[0]?.signal
        assert.ok(cancelledSignal && !cancelledSignal.aborted)
        const refresh = observePromise(state.refreshSelectedThreadContent())
        assert.equal(cancelledSignal.aborted, true, 'manual C must cancel the actual sync controller, not a fabricated abort error')
        await requireSettled(refresh, 'valid manual refresh C')
        assert.equal(stateReads, 3, 'cancelled R2 cannot satisfy a live C; C must obtain R3')
        assert.ok(requestLog.some((entry) => entry.phase === 'failure' && entry.error === 'AbortSignal'))
      }
      if (caseName !== 'notification-during-automatic-read') assertNewFinal(state)
      assert.ok(requestLog.some((entry) => entry.url === `/codex-api/runtime/thread/${threadId}`),
        'automatic connected recovery must traverse syncThreadStatus and its runtime-only status read')
      if (caseName !== 'cancelled-followup-valid-refresh') {
        assert.ok(!requestLog.some((entry) => entry.url.endsWith('/reconcile')), 'automatic recovery does not call manual refresh')
      }
    } else if (caseName === 'state-unavailable') {
      // Expire both old gates so this control proves real content provenance,
      // independently of the new explicit-refresh bypass being implemented.
      fixtureNowMs += 15_000
      versionOnServer = 'completed-new'
      sourceOnServer = 'unavailable'
      detailUnavailable = true
      await requireSettled(observePromise(state.refreshSelectedThreadContent()), 'unavailable content refresh')
      assert.ok(requestLog.some((entry) => entry.phase === 'response' && entry.url.includes('/state/thread/')
        && entry.messageState === 'unavailable'), 'the real state gateway must receive the unavailable body result')
      assert.equal(state.selectedConversationProjection.value.sourceState, 'unavailable',
        'an actually unavailable state-body read must stay unavailable, unlike runtime-only status')
      assert.equal(visibleFinal(state), oldFinalText, 'previous readable content remains without inventing a new reply')
    } else {
      assert.ok(caseName === 'settled-six-seconds' || caseName === 'same-millisecond')
      if (caseName === 'settled-six-seconds') fixtureNowMs += 6_000
      versionOnServer = 'completed-new'
      await requireSettled(observePromise(state.refreshSelectedThreadContent()), 'manual refresh')
      assertNewFinal(state)
      assert.equal(state.selectedConversationProjection.value.sourceState, 'fresh')
      assert.equal(stateReads, 2, 'explicit refresh must reach the state endpoint despite recent detail or gateway caches')
    }
  }
  assert.deepEqual(unexpectedRequests, [], 'all external HTTP dependencies must be declared')
  console.log(`PASS ${caseName}`)
  console.log(JSON.stringify({ caseName, stateReads, versions: requestLog.filter((entry) => entry.version) }))
} catch (error) {
  console.error(`FAIL ${caseName}: ${error instanceof Error ? error.message : String(error)}`)
  console.error(JSON.stringify({ caseName, stateReads, requests: requestLog, projection: state.selectedConversationProjection.value }))
  process.exitCode = 1
} finally {
  while (heldRequests.length) releaseHeldState()
  state.stopPolling()
  scope.stop()
  await flush()
  Date.now = realDateNow
  for (const [key, descriptor] of priorGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}
