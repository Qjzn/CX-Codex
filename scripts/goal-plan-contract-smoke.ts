import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { useDesktopState } from '../src/composables/useDesktopState.js'
import { normalizeThreadGoal } from '../src/composables/threadGoal.js'
import { PlanModeTurnStore } from '../src/server/planModeTurnStore.js'

const threadId = 'goal-contract-fixture'
const baseGoal = {
  threadId, objective: 'Fixture only: validate goal controls', status: 'active',
  tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 100, updatedAt: 100,
}
type Goal = typeof baseGoal | null
const threadRead = { thread: { id: threadId, turns: [{
  id: 'fixture-completed-turn', status: 'completed',
  items: [{ id: 'fixture-final', type: 'agentMessage', phase: 'final_answer', text: 'fixture complete' }],
}] } }
const snapshot = {
  threadId, threadRead, executionState: 'completed', messageState: 'fresh',
  inProgress: false, canStop: false, stale: false, lastEventSeq: 10,
  lastStartedAtIso: '2026-09-10T00:00:00Z', lastCompletedAtIso: '2026-09-10T00:00:01Z',
  updatedAtIso: '2026-09-10T00:00:01Z', pendingServerRequests: [],
}
const storage = new Map<string, string>()
const timers = new Map<number, { callback: () => void; delay: number }>()
let timerId = 0
class FixtureWebSocket {
  static current: FixtureWebSocket | null = null
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  constructor() { FixtureWebSocket.current = this }
  close() { this.readyState = 3 }
}
Object.assign(globalThis, {
  WebSocket: FixtureWebSocket,
  window: {
    performance: globalThis.performance,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: (callback: () => void, delay = 0) => {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++timerId, clearInterval: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    location: { protocol: 'http:', host: 'fixture.invalid', origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
  },
})
let authoritativeGoal: Goal = null
let heldMethod = ''
let failedMethod = ''
let releaseHeld: ((goal: Goal) => void) | null = null
const rpcCalls: Array<{ method: string; params: Record<string, unknown> }> = []
const unexpectedRequests: string[] = []
let pendingRequests: unknown[] = []
let runtimeQueue: unknown[] = []
let replayNotifications: unknown[] = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  const respond = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
  if (url.startsWith('/codex-api/state/thread/')) return respond({ data: snapshot })
  if (url.endsWith('/reconcile')) return respond({ data: { snapshot } })
  if (url.startsWith('/codex-api/runtime/thread/')) return respond({ data: snapshot })
  if (url.startsWith('/codex-api/runtime/queue')) return respond({ data: runtimeQueue })
  if (url.startsWith('/codex-api/events/replay')) return respond({ data: { notifications: replayNotifications, latestSeq: 3, oldestSeq: 2, streamId: '' } })
  if (url === '/codex-api/rpc') {
    const { method, params } = JSON.parse(String(init?.body))
    rpcCalls.push({ method, params })
    if (method === failedMethod) {
      failedMethod = ''
      return new Response(JSON.stringify({ error: 'Fixture goal request failed' }), { status: 500 })
    }
    if (method === heldMethod) {
      heldMethod = ''
      return new Promise<Response>((resolve) => {
        releaseHeld = (goal) => resolve(respond({ result: { goal } }))
      })
    }
    if (method === 'thread/goal/get') return respond({ result: { goal: authoritativeGoal } })
    if (method === 'thread/goal/set') {
      authoritativeGoal = { ...baseGoal, ...authoritativeGoal, ...params }
      return respond({ result: { goal: authoritativeGoal } })
    }
    if (method === 'thread/goal/clear') { authoritativeGoal = null; return respond({ result: {} }) }
    if (method === 'thread/list') return respond({ result: { data: [], nextCursor: null } })
    if (method === 'thread/read') return respond({ result: threadRead })
    unexpectedRequests.push(`RPC ${method}`)
    throw new Error(`Unexpected RPC ${method}`)
  }
  if (url === '/codex-api/workspace-roots-state') return respond({ data: { roots: [], activeRoots: [], labels: {} } })
  if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
  if (url === '/codex-api/server-requests/pending') return respond({ data: pendingRequests })
  if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
  unexpectedRequests.push(url)
  throw new Error(`Unexpected fetch ${url}`)
}
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await nextEventLoop()
}
function notifyGoal(goal: Goal): void {
  const socket = FixtureWebSocket.current
  assert.ok(socket?.onmessage, 'the production notification transport must be subscribed')
  authoritativeGoal = goal
  socket.onmessage({ data: JSON.stringify({
    method: goal ? 'thread/goal/updated' : 'thread/goal/cleared',
    params: goal ? { goal } : { threadId }, atIso: '2026-09-10T00:01:00Z',
  }) })
}
async function runContinuationTimers(): Promise<void> {
  for (const [id, timer] of [...timers]) {
    if (timer.delay !== 750) continue
    timers.delete(id)
    timer.callback()
  }
  await flush()
}
function finishHeld(goal: Goal): void {
  assert.ok(releaseHeld, 'the regression must actually hold an in-flight production HTTP request')
  const release = releaseHeld
  releaseHeld = null
  release(goal)
}
let checks = 0
const failures: string[] = []
async function check(name: string, run: (state: ReturnType<typeof useDesktopState>) => Promise<void>): Promise<void> {
  checks += 1
  storage.clear(); timers.clear(); rpcCalls.length = 0
  storage.set('codex-web-local.notification-seq.v1', '1')
  authoritativeGoal = null; heldMethod = ''; failedMethod = ''; releaseHeld = null; pendingRequests = []; runtimeQueue = []; replayNotifications = []
  const state = useDesktopState()
  state.setWorktreeGitAutomationEnabled(false)
  try {
    await state.selectThread(threadId)
    state.startPolling()
    await flush()
    assert.equal(state.error.value, '')
    await run(state)
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.stopPolling()
    if (releaseHeld) finishHeld(baseGoal)
    await flush()
  }
}

await check('goal set/get/pause/edit/resume/clear retain authoritative values and user collaboration mode', async (state) => {
  state.setSelectedCollaborationMode('plan')
  await state.saveSelectedThreadGoal('  Fixture objective  ')
  assert.equal(state.selectedThreadGoal.value?.objective, 'Fixture objective')
  await state.refreshSelectedThreadGoal()
  assert.equal(state.selectedThreadGoal.value?.status, 'active')
  await state.updateSelectedThreadGoalStatus('paused')
  await state.saveSelectedThreadGoal('Edited while paused')
  assert.equal(state.selectedThreadGoal.value?.status, 'paused')
  await state.updateSelectedThreadGoalStatus('active')
  assert.equal(state.selectedThreadGoal.value?.status, 'active')
  await state.clearSelectedThreadGoal()
  assert.equal(state.selectedThreadGoal.value, null)
  assert.equal(state.selectedCollaborationMode.value, 'plan', 'goal controls do not change plan/execute mode')
})

await check('clear notification invalidates an in-flight get even when local goal was already null', async (state) => {
  heldMethod = 'thread/goal/get'
  const request = state.refreshSelectedThreadGoal()
  await flush(); notifyGoal(null); finishHeld(baseGoal); await request
  assert.equal(state.selectedThreadGoal.value, null, 'a stale GET must not resurrect a cleared goal')
})

await check('updated notification wins over an older get response', async (state) => {
  heldMethod = 'thread/goal/get'
  const request = state.refreshSelectedThreadGoal()
  await flush(); notifyGoal({ ...baseGoal, status: 'paused', updatedAt: 200 }); finishHeld(baseGoal); await request
  assert.equal(state.selectedThreadGoal.value?.status, 'paused')
})

await check('clear notification wins over an older set response', async (state) => {
  heldMethod = 'thread/goal/set'
  const request = state.saveSelectedThreadGoal(baseGoal.objective)
  await flush(); notifyGoal(null); finishHeld(baseGoal); await request
  assert.equal(state.selectedThreadGoal.value, null, 'a late SET must not resurrect a cleared goal')
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count, 'discarded SET responses must not schedule another activation')
})

await check('new goal notification wins over an older clear response', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/clear'
  const request = state.clearSelectedThreadGoal()
  const nextGoal = { ...baseGoal, objective: 'Newer goal', updatedAt: 200 }
  await flush(); notifyGoal(nextGoal); finishHeld(null); await request
  assert.equal(state.selectedThreadGoal.value?.objective, 'Newer goal')
})

await check('a response from a replaced goal cannot win by updatedAt alone', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/set'
  const request = state.saveSelectedThreadGoal('Edit the old goal')
  await flush()
  notifyGoal({ ...baseGoal, objective: 'Replacement goal', createdAt: 500, updatedAt: 500 })
  finishHeld({ ...baseGoal, objective: 'Old goal response', updatedAt: 1_000 }); await request
  assert.equal(state.selectedThreadGoal.value?.objective, 'Replacement goal')
})

await check('completed notification wins over an older pause response', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/set'
  const request = state.updateSelectedThreadGoalStatus('paused')
  await flush(); notifyGoal({ ...baseGoal, status: 'complete', updatedAt: 200 })
  finishHeld({ ...baseGoal, status: 'paused' }); await request
  assert.equal(state.selectedThreadGoal.value?.status, 'complete')
})

await check('a newer authoritative pause response still applies after an intermediate usage update', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/set'
  const request = state.updateSelectedThreadGoalStatus('paused')
  await flush(); notifyGoal({ ...baseGoal, tokensUsed: 20, updatedAt: 200 })
  finishHeld({ ...baseGoal, status: 'paused', tokensUsed: 20, updatedAt: 300 }); await request
  assert.equal(state.selectedThreadGoal.value?.status, 'paused', 'generation guards must not discard a provably newer response for the same goal')
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count, 'pause must not schedule a replacement activation')
})

await check('same-second pause response reconciles through a fresh authoritative get', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/set'
  const request = state.updateSelectedThreadGoalStatus('paused')
  await flush()
  notifyGoal({ ...baseGoal, tokensUsed: 20 })
  authoritativeGoal = { ...baseGoal, status: 'paused', tokensUsed: 20 }
  finishHeld(authoritativeGoal); await request
  assert.equal(state.selectedThreadGoal.value?.status, 'paused', 'second-resolution timestamps cannot settle ordering without an authoritative reread')
  assert.equal(rpcCalls.filter((call) => call.method === 'thread/goal/get').length, 1, 'ambiguous mutation completion performs one authoritative reread')
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count)
})

await check('same-second reconciliation does not reuse a get that predates the mutation', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/get'
  const oldRead = state.refreshSelectedThreadGoal()
  await flush()
  assert.ok(releaseHeld)
  const releaseOldRead = releaseHeld
  releaseHeld = null
  heldMethod = 'thread/goal/set'
  const request = state.updateSelectedThreadGoalStatus('paused')
  await flush()
  notifyGoal({ ...baseGoal, tokensUsed: 20 })
  authoritativeGoal = { ...baseGoal, status: 'paused', tokensUsed: 20 }
  finishHeld(authoritativeGoal)
  await flush()
  releaseOldRead(baseGoal)
  await oldRead; await request
  assert.equal(state.selectedThreadGoal.value?.status, 'paused')
  assert.equal(rpcCalls.filter((call) => call.method === 'thread/goal/get').length, 2, 'the pre-mutation get must finish before the fresh read')
})

for (const operation of ['save', 'pause', 'clear'] as const) {
  await check(`${operation} reconciliation stays guarded across old and fresh reads during terminal notifications`, async (state) => {
    notifyGoal(baseGoal)
    heldMethod = 'thread/goal/get'
    const oldRead = state.refreshSelectedThreadGoal()
    await flush()
    assert.ok(releaseHeld)
    const releaseOldRead = releaseHeld
    releaseHeld = null
    heldMethod = operation === 'clear' ? 'thread/goal/clear' : 'thread/goal/set'
    const request = operation === 'save' ? state.saveSelectedThreadGoal('Changed objective')
      : operation === 'clear' ? state.clearSelectedThreadGoal() : state.updateSelectedThreadGoalStatus('paused')
    await flush()
    notifyGoal({ ...baseGoal, tokensUsed: 20 })
    const settledGoal = operation === 'clear' ? null
      : operation === 'pause' ? { ...baseGoal, status: 'paused', tokensUsed: 20 }
        : { ...baseGoal, objective: 'Changed objective', tokensUsed: 20 }
    authoritativeGoal = settledGoal
    finishHeld(settledGoal)
    await flush()
    const updatingWhileOldReadPending = state.isSelectedThreadGoalUpdating.value
    const activeCallCount = () => rpcCalls.filter((call) => call.method === 'thread/goal/set' && call.params.status === 'active').length
    const beforeActiveCalls = activeCallCount()
    const terminalNotification = () => FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify({
      method: 'turn/completed', atIso: '2026-09-10T00:01:00Z',
      params: { threadId, turn: { id: 'fixture-completed-turn', status: 'completed', completedAt: '2026-09-10T00:01:00Z' } },
    }) })
    terminalNotification()
    const publicRefresh = state.refreshSelectedThreadGoal()
    await runContinuationTimers()
    heldMethod = 'thread/goal/get'
    releaseOldRead(baseGoal)
    await oldRead; await publicRefresh; await flush()
    assert.ok(releaseHeld, 'reconciliation must reach a new authoritative GET')
    const updatingWhileFreshReadPending = state.isSelectedThreadGoalUpdating.value
    terminalNotification()
    await runContinuationTimers()
    const afterActiveCalls = activeCallCount()
    finishHeld(settledGoal)
    await request
    assert.equal(afterActiveCalls, beforeActiveCalls, 'terminal notifications must not activate the old cached goal while its mutation is reconciling')
    assert.equal(updatingWhileOldReadPending, true, 'updating guard remains set while waiting for the older GET')
    assert.equal(updatingWhileFreshReadPending, true, 'updating guard remains set through the private authoritative reread')
    assert.equal(state.isSelectedThreadGoalUpdating.value, false, 'guard releases only after reconciliation completes')
    assert.equal(state.selectedThreadGoal.value?.status ?? null, settledGoal?.status ?? null)
  })
}

await check('failed authoritative reconciliation never automatically continues an uncertain goal', async (state) => {
  notifyGoal(baseGoal)
  heldMethod = 'thread/goal/set'
  const request = state.saveSelectedThreadGoal('Changed objective')
  await flush()
  notifyGoal({ ...baseGoal, tokensUsed: 20 })
  failedMethod = 'thread/goal/get'
  finishHeld({ ...baseGoal, objective: 'Changed objective', tokensUsed: 20 }); await request
  assert.match(state.selectedThreadGoalError.value, /Fixture goal request failed/u)
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count, 'an unresolved goal mutation must not trigger a competing automatic activation')
})

for (const operation of ['get', 'save', 'resume', 'clear'] as const) {
  await check(`failed goal ${operation} preserves the previous goal and exposes a retryable error`, async (state) => {
    notifyGoal({ ...baseGoal, status: 'paused' })
    failedMethod = operation === 'get' ? 'thread/goal/get' : operation === 'clear' ? 'thread/goal/clear' : 'thread/goal/set'
    const run = () => operation === 'get' ? state.refreshSelectedThreadGoal()
      : operation === 'save' ? state.saveSelectedThreadGoal('Changed objective')
        : operation === 'clear' ? state.clearSelectedThreadGoal() : state.updateSelectedThreadGoalStatus('active')
    if (operation === 'get') await run()
    else await assert.rejects(run)
    assert.equal(state.selectedThreadGoal.value?.objective, baseGoal.objective)
    assert.equal(state.selectedThreadGoal.value?.status, 'paused')
    assert.match(state.selectedThreadGoalError.value, /Fixture goal request failed/u)
    assert.equal(state.isSelectedThreadGoalLoading.value, false)
    assert.equal(state.isSelectedThreadGoalUpdating.value, false)
    const count = rpcCalls.length
    await runContinuationTimers()
    assert.equal(rpcCalls.length, count, 'failed goal operations must not dispatch automatic activation')
  })
}

await check('pause in flight suppresses automatic continuation after a refresh', async (state) => {
  notifyGoal(baseGoal); authoritativeGoal = baseGoal
  heldMethod = 'thread/goal/set'
  const request = state.updateSelectedThreadGoalStatus('paused')
  await flush(); await state.refreshSelectedThreadGoal()
  const activeCalls = () => rpcCalls.filter((call) => call.method === 'thread/goal/set' && call.params.status === 'active').length
  const count = activeCalls()
  await runContinuationTimers()
  const afterTimers = activeCalls()
  finishHeld({ ...baseGoal, status: 'paused' }); await request
  assert.equal(afterTimers, count, 'pending pause/clear/edit must not dispatch a competing activation')
})

await check('paused, budget-limited, usage-limited, blocked and complete goals do not auto-continue', async (state) => {
  for (const status of ['paused', 'budgetLimited', 'usageLimited', 'blocked', 'complete']) {
    authoritativeGoal = { ...baseGoal, status }
    await state.refreshSelectedThreadGoal()
    const count = rpcCalls.length
    await runContinuationTimers()
    assert.equal(rpcCalls.length, count, `${status} must not activate a goal`)
  }
})

await check('idle active goal continues once and an in-flight continuation cannot undo pause', async (state) => {
  authoritativeGoal = baseGoal
  await state.refreshSelectedThreadGoal()
  heldMethod = 'thread/goal/set'
  await runContinuationTimers()
  assert.ok(releaseHeld, 'an idle active goal must dispatch continuation')
  assert.equal(rpcCalls.filter((call) => call.method === 'thread/goal/set').length, 1)
  await state.updateSelectedThreadGoalStatus('paused')
  finishHeld(baseGoal); await flush()
  assert.equal(state.selectedThreadGoal.value?.status, 'paused', 'a late automatic activation response cannot undo user pause')
})

await check('durable queued work takes precedence over automatic goal continuation', async (state) => {
  runtimeQueue = [{
    requestId: 'queued-fixture', clientMessageId: 'queued-client', threadId, status: 'queued',
    createdAtIso: '2026-09-10T00:00:00Z', payload: { queueMetadata: { text: 'Queued fixture', collaborationMode: 'plan' } },
  }]
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify({
    method: 'runtime/queue/updated', params: { threadId, requestId: 'queued-fixture', action: 'queued' },
  }) })
  await flush()
  assert.equal(state.selectedThreadQueuedMessages.value.length, 1)
  assert.equal(state.selectedThreadQueuedMessages.value[0]?.collaborationMode, 'plan')
  authoritativeGoal = baseGoal
  await state.refreshSelectedThreadGoal()
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count)
})

await check('replayed pause notification settles the same goal state as live notification', async (state) => {
  notifyGoal(baseGoal)
  replayNotifications = [
    { seq: 2, method: 'thread/goal/updated', params: { goal: { ...baseGoal, status: 'paused', updatedAt: 200 } } },
    { seq: 3, method: 'fixture/noop', params: {} },
  ]
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify(replayNotifications[1]) })
  await flush()
  assert.equal(state.selectedThreadGoal.value?.status, 'paused', 'goal notifications must not be discarded on the replay path')
})

await check('replayed clear cancels continuation and old duplicate updates cannot restore it', async (state) => {
  authoritativeGoal = baseGoal
  await state.refreshSelectedThreadGoal()
  replayNotifications = [
    { seq: 2, method: 'thread/goal/cleared', params: { threadId } },
    { seq: 3, method: 'fixture/noop', params: {} },
  ]
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify(replayNotifications[1]) })
  await flush()
  FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify({ seq: 2, method: 'thread/goal/updated', params: { goal: baseGoal } }) })
  assert.equal(state.selectedThreadGoal.value, null)
  const count = rpcCalls.length
  await runContinuationTimers()
  assert.equal(rpcCalls.length, count)
})

await check('duplicate active notifications never duplicate continuation requests', async (state) => {
  authoritativeGoal = baseGoal
  await state.refreshSelectedThreadGoal()
  const data = JSON.stringify({ seq: 2, method: 'thread/goal/updated', params: { goal: baseGoal } })
  FixtureWebSocket.current?.onmessage?.({ data })
  FixtureWebSocket.current?.onmessage?.({ data })
  await runContinuationTimers()
  await runContinuationTimers()
  assert.equal(rpcCalls.filter((call) => call.method === 'thread/goal/set').length, 1)
})

for (const requestThreadId of [threadId, '']) {
  await check(`${requestThreadId ? 'thread' : 'global'} pending input prevents automatic goal continuation`, async (state) => {
    const pending = {
      id: 99, method: 'item/tool/requestUserInput', receivedAtIso: '2026-09-10T00:00:00Z',
      params: { threadId: requestThreadId, turnId: 'fixture-completed-turn', itemId: 'input-1', questions: [{ id: 'choice', header: 'Choice', question: 'Fixture only?' }] },
    }
    FixtureWebSocket.current?.onmessage?.({ data: JSON.stringify({ method: 'server/request', params: pending }) })
    await flush()
    authoritativeGoal = baseGoal
    await state.refreshSelectedThreadGoal()
    assert.equal(state.selectedThreadServerRequests.value.length, 1)
    const count = rpcCalls.length
    await runContinuationTimers()
    assert.equal(rpcCalls.length, count)
  })
}

const planTurns = new PlanModeTurnStore({ now: () => 100 })
planTurns.mark('thread-a', 'turn-new')
planTurns.clear('thread-a', 'turn-old')
assert.equal(planTurns.isActiveRequest('thread-a', 'turn-new'), true, 'an old turn cannot clear a newer plan-mode request boundary')
assert.equal(planTurns.isActiveRequest('thread-a', 'turn-old'), false)
planTurns.clearByThreadOrTurn('', 'turn-new')
assert.equal(planTurns.count, 0)
for (const status of ['active', 'paused', 'budgetLimited', 'usageLimited', 'blocked', 'complete']) {
  assert.equal(normalizeThreadGoal({ ...baseGoal, status })?.status, status)
}
assert.equal(normalizeThreadGoal({ ...baseGoal, status: 'unknown' }), null)
assert.deepEqual(unexpectedRequests, [], 'the public-state fixture must not silently skip real HTTP dependencies')
console.log(`${checks - failures.length}/${checks} goal-state checks passed; plan-mode isolation and goal normalization passed.`)
if (failures.length) process.exitCode = 1
