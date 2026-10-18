import assert from 'node:assert/strict'
import { watch } from 'vue'
import { useDesktopState } from '../src/composables/useDesktopState.js'

const threadId = 'thread-retention-fixture'
const threadRead = {
  thread: {
    id: threadId,
    turns: [{
      id: 'turn-completed', status: 'completed',
      startedAt: '2026-09-09T00:00:00Z', completedAt: '2026-09-09T00:00:01Z',
      items: [
        { id: 'user-message', type: 'userMessage', content: [{ type: 'text', text: 'fixture prompt' }] },
        { id: 'final-message', type: 'agentMessage', phase: 'final_answer', text: 'KEEP_COMPLETED_REPLY' },
      ],
    }],
  },
}
const snapshot = {
  threadId, threadRead, executionState: 'completed', messageState: 'fresh',
  inProgress: false, canStop: false, stale: false, lastEventSeq: 10,
  lastStartedAtIso: '2026-09-09T00:00:00Z', lastCompletedAtIso: '2026-09-09T00:00:01Z',
  updatedAtIso: '2026-09-09T00:00:01Z', pendingServerRequests: [],
}
let currentThreadRead: typeof threadRead = threadRead
// The running fixture gets its own thread id: the gateway keeps a module-level per-thread snapshot
// cache, so reusing the completed fixture id replays its obsolete transcript and active state.
const runningThreadId = 'thread-running-fixture'
// A genuinely running transcript: the completed turn (with its final text) followed by an
// inProgress turn, so an "active" fixture is grounded in real turn data instead of a wrapper flag.
const runningThreadRead = {
  thread: {
    id: runningThreadId,
    turns: [
      ...threadRead.thread.turns,
      {
        id: 'turn-running', status: 'inProgress',
        startedAt: '2026-09-09T00:00:02Z',
        items: [
          { id: 'running-user-message', type: 'userMessage', content: [{ type: 'text', text: 'follow-up prompt' }] },
        ],
      },
    ],
  },
}
const transcriptFor = (requestedId: string | undefined): unknown => {
  if (requestedId === threadId) return currentThreadRead
  if (requestedId === runningThreadId) return runningThreadRead
  return { thread: { id: requestedId ?? '', turns: [] } }
}
let currentThreadListData: Array<Record<string, unknown>> = []
const runtimeExecutionStateById: Record<string, string> = {}
const storage = new Map<string, string>()
let timerId = 0
Object.assign(globalThis, {
  window: {
    performance: globalThis.performance,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: () => ++timerId,
    clearTimeout: () => {},
    setInterval: () => ++timerId,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
  },
})
const requests: string[] = []
const unexpectedRequests: string[] = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  requests.push(url)
  const respond = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
  if (url.startsWith('/codex-api/state/thread/')) {
    const requestedId = decodeURIComponent(url.split('/').at(-1)!.split('?')[0]!)
    const executionState = runtimeExecutionStateById[requestedId] ?? snapshot.executionState
    return respond({ data: {
      ...snapshot,
      threadId: requestedId,
      executionState,
      inProgress: executionState === 'running',
      canStop: executionState === 'running',
      ...(executionState === 'running'
        ? { activeTurnId: 'turn-running', inProgress: true, canStop: true, stale: false, lastStartedAtIso: '2026-09-09T00:00:02Z', lastCompletedAtIso: null }
        : {}),
      threadRead: transcriptFor(requestedId),
    } })
  }
  if (url.endsWith('/reconcile')) return respond({ data: { snapshot } })
  if (url.startsWith('/codex-api/runtime/thread/')) {
    const requestedId = decodeURIComponent(url.split('/').at(-1)!.split('?')[0]!)
    const executionState = runtimeExecutionStateById[requestedId] ?? snapshot.executionState
    return respond({ data: {
      ...snapshot,
      threadId: requestedId,
      executionState,
      // The runtime payload must describe the same transcript as the requested id, not a stale one.
      threadRead: transcriptFor(requestedId),
      ...(executionState === 'running'
        ? { activeTurnId: 'turn-running', inProgress: true, canStop: true, stale: false, lastStartedAtIso: '2026-09-09T00:00:02Z', lastCompletedAtIso: null }
        : {}),
    } })
  }
  if (url === '/codex-api/rpc') {
    const { method, params } = JSON.parse(String(init?.body)) as { method?: string; params?: { threadId?: string } }
    if (method === 'thread/list') return respond({ result: { data: currentThreadListData, nextCursor: null } })
    if (method === 'thread/read') return respond({ result: transcriptFor(params?.threadId) })
    if (method === 'thread/goal/get') return respond({ result: { goal: null } })
    if (method === 'thread/rollback') {
      currentThreadRead = { thread: { id: threadId, turns: [] } }
      return respond({ result: currentThreadRead })
    }
    if (method === 'thread/archive') return respond({ result: {} })
    unexpectedRequests.push(`RPC ${method}`)
    throw new Error(`Unexpected RPC ${method}`)
  }
  if (url === '/codex-api/workspace-roots-state') {
    return respond({ data: { roots: [], activeRoots: [], labels: {} } })
  }
  if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
  if (url === '/codex-api/server-requests/pending') return respond({ data: [] })
  if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
  unexpectedRequests.push(url)
  throw new Error(`Unexpected fetch ${url}`)
}

const failures: string[] = []
const checkNames: string[] = []
async function check(name: string, run: (state: ReturnType<typeof useDesktopState>) => Promise<void>): Promise<void> {
  await runCheck(name, null, run)
}

async function checkWithStorage(
  name: string,
  seed: (store: Map<string, string>) => void,
  run: (state: ReturnType<typeof useDesktopState>) => Promise<void>,
  options: { selectThread?: boolean } = {},
): Promise<void> {
  await runCheck(name, seed, run, options)
}

async function runCheck(
  name: string,
  seed: ((store: Map<string, string>) => void) | null,
  run: (state: ReturnType<typeof useDesktopState>) => Promise<void>,
  options: { selectThread?: boolean } = {},
): Promise<void> {
  checkNames.push(name)
  storage.clear()
  currentThreadRead = threadRead
  currentThreadListData = []
  for (const key of Object.keys(runtimeExecutionStateById)) delete runtimeExecutionStateById[key]
  seed?.(storage)
  const state = useDesktopState()
  state.setWorktreeGitAutomationEnabled(false)
  try {
    if (options.selectThread !== false) {
      await state.selectThread(threadId)
      assert.equal(state.error.value, '', `fixture setup failed: ${state.error.value}`)
      assert.equal(state.selectedConversationProjection.value.turns[0]?.final?.text, 'KEEP_COMPLETED_REPLY')
    }
    await run(state)
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.stopPolling()
  }
}

await check('completed reply survives repeated stale sidebar omission', async (state) => {
  const observedFinals: (string | undefined)[] = []
  const stopObserving = watch(state.selectedConversationProjection, (projection) => {
    observedFinals.push(projection.turns[0]?.final?.text)
  }, { flush: 'sync' })
  try {
    for (let index = 0; index < 3; index += 1) {
      await state.refreshSelectedThreadContent()
      assert.equal(state.selectedThreadId.value, threadId, 'the selected thread remains open after a stale list refresh')
      assert.equal(
        state.selectedConversationProjection.value.turns[0]?.final?.text,
        'KEEP_COMPLETED_REPLY',
        'a completed reply must remain visible when a sidebar list temporarily omits its owning thread',
      )
      assert.equal(state.isLoadingMessages.value, false, 'background refresh must not make the loaded thread cold again')
    }
    assert.ok(observedFinals.length > 0, 'the regression must observe intermediate reactive updates')
    assert.ok(observedFinals.every((text) => text === 'KEEP_COMPLETED_REPLY'), 'no intermediate update may clear the final')
  } finally {
    stopObserving()
  }
})

await check('authoritative rollback still removes the completed reply', async (state) => {
  await state.rollbackSelectedThread(0)
  assert.equal(state.error.value, '')
  assert.equal(state.selectedConversationProjection.value.turns.length, 0)
})

await check('explicit archive clears selection and does not retain archived conversation state', async (state) => {
  assert.equal(await state.archiveThreadById(threadId), true)
  assert.notEqual(state.selectedThreadId.value, threadId)
  state.selectedThreadId.value = threadId
  assert.equal(state.selectedConversationProjection.value.turns.length, 0)
  await state.refreshSelectedThreadContent()
  assert.equal(state.selectedConversationProjection.value.turns.length, 0, 'hidden threads must not be retained by a stale route')
})

await check('switching away permits omitted old conversation state to be pruned', async (state) => {
  await state.selectThread('thread-other-fixture')
  await state.refreshSelectedThreadContent()
  state.selectedThreadId.value = threadId
  assert.equal(state.selectedConversationProjection.value.turns.length, 0)
})

// Sidebar list-cache / active-local merge cases: these use the real composable with synthetic
// storage and fetch, so the assertions observe the public load/refresh entry points only.
const THREAD_GROUPS_CACHE_KEY = 'codex-web-local.thread-groups-cache.v1'
const cacheProjectName = 'retention-cache-project'
const cacheRow = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title: id,
  projectName: cacheProjectName,
  cwd: 'E:/retention-cache-project',
  sourceKind: 'cli',
  internalSource: false,
  ephemeral: false,
  sideConversation: false,
  hasWorktree: false,
  createdAtIso: '2026-09-09T00:00:00.000Z',
  updatedAtIso: '2026-09-09T00:00:01.000Z',
  preview: 'cache fixture preview',
  unread: false,
  inProgress: false,
  ...overrides,
})
const cachePayload = (version: number, threads: Array<Record<string, unknown>>): string => JSON.stringify({
  version,
  savedAtMs: Date.now(),
  groups: [{ projectName: cacheProjectName, threads }],
})
const visibleThreadIds = (groups: Array<{ threads: Array<{ id: string }> }>): string[] =>
  groups.flatMap((group) => group.threads.map((thread) => thread.id))

await checkWithStorage(
  'legacy v1 list cache cannot hydrate rows after the version bump',
  (store) => {
    currentThreadListData = [{
      id: 'cache-network-visible', cwd: 'E:/retention-cache-project', preview: 'network row',
      createdAt: 1, updatedAt: 2, source: 'cli',
    }]
    store.set(THREAD_GROUPS_CACHE_KEY, cachePayload(1, [
      cacheRow('cache-v1-normal'),
      cacheRow('cache-v1-internal', { sourceKind: 'subAgent.other', internalSource: true }),
    ]))
  },
  async (state) => {
    await state.refreshAll({
      loadMessages: false, loadSkills: false, refreshModelPreferences: false,
      deferThreadListNetworkIfCached: true,
    })
    assert.equal(state.error.value, '')
    const ids = visibleThreadIds(state.projectGroups.value)
    assert.ok(!ids.includes('cache-v1-normal'), 'a v1 list cache must not hydrate after the version bump')
    assert.ok(!ids.includes('cache-v1-internal'), 'a v1 list cache must not resurrect internal rows')
    assert.deepEqual(ids, ['cache-network-visible'], 'the ordinary network list still populates the sidebar')
  },
  { selectThread: false },
)

await checkWithStorage(
  'v2 list cache hydrates only visible rows and keeps unknown rows',
  (store) => {
    store.set(THREAD_GROUPS_CACHE_KEY, cachePayload(2, [
      cacheRow('cache-flag-ephemeral-true', { ephemeral: true }),
      cacheRow('cache-flag-side-true', { sideConversation: true }),
      cacheRow('cache-flag-ephemeral-string', { ephemeral: 'true' }),
      cacheRow('cache-flag-side-number', { sideConversation: 1 }),
      cacheRow('cache-unknown-source', { sourceKind: 'futureSource' }),
      cacheRow('cache-internal-guardian', { sourceKind: 'subAgent.other', internalSource: true }),
      cacheRow('cache-v2-normal'),
    ]))
  },
  async (state) => {
    await state.refreshAll({
      loadMessages: false, loadSkills: false, refreshModelPreferences: false,
      deferThreadListNetworkIfCached: true,
    })
    assert.equal(state.error.value, '')
    const ids = visibleThreadIds(state.projectGroups.value)
    assert.deepEqual(ids, [
      'cache-flag-ephemeral-string',
      'cache-flag-side-number',
      'cache-unknown-source',
      'cache-v2-normal',
    ], 'literal true flags drop, string/unknown values stay, internal rows stay hidden')
  },
  { selectThread: false },
)

await checkWithStorage(
  'a running ordinary cached row hydrates first and survives an empty refresh',
  (store) => {
    store.set(THREAD_GROUPS_CACHE_KEY, cachePayload(2, [
      cacheRow(runningThreadId, { title: 'Guardian review running fixture' }),
      cacheRow('cache-hydrate-internal', { sourceKind: 'subAgent.other', internalSource: true }),
    ]))
    runtimeExecutionStateById[runningThreadId] = 'running'
    runtimeExecutionStateById['cache-hydrate-internal'] = 'running'
  },
  async (state) => {
    // 1) The cache is hydrated before anything selects a thread, and the assertion proves the row
    //    reached the sidebar (not merely that an empty list is empty).
    await state.refreshAll({
      loadMessages: false, loadSkills: false, refreshModelPreferences: false,
      deferThreadListNetworkIfCached: true,
    })
    assert.equal(state.error.value, '')
    assert.deepEqual(
      visibleThreadIds(state.projectGroups.value),
      [runningThreadId],
      'the visible cached row hydrates while the internal row is filtered during hydrate',
    )
    // 2) Select the hydrated row; its own id and its own transcript make it genuinely active.
    await state.selectThread(runningThreadId)
    assert.equal(state.selectedThreadId.value, runningThreadId)
    assert.equal(
      state.selectedThreadExecutionActive.value,
      true,
      'fixture prerequisite before the empty refresh: the synthetic thread reports a running turn',
    )
    assert.equal(
      state.selectedConversationProjection.value.turns[0]?.final?.text,
      'KEEP_COMPLETED_REPLY',
      'the hydrated ordinary conversation is readable before the empty refresh',
    )
    await state.refreshAll({ loadMessages: false, loadSkills: false, refreshModelPreferences: false })
    assert.equal(state.error.value, '')
    assert.deepEqual(
      visibleThreadIds(state.projectGroups.value),
      [runningThreadId],
      'the running ordinary row is retained when the network list omits it',
    )
    assert.equal(
      state.selectedThreadExecutionActive.value,
      true,
      'the synthetic thread is still running after the empty refresh',
    )
    assert.equal(
      state.selectedConversationProjection.value.turns[0]?.final?.text,
      'KEEP_COMPLETED_REPLY',
      'its earlier completed turn text stays readable after the empty refresh',
    )
  },
  { selectThread: false },
)

await checkWithStorage(
  'an all-internal v2 cache is not left on disk after a refresh',
  (store) => {
    store.set(THREAD_GROUPS_CACHE_KEY, cachePayload(2, [
      cacheRow('cache-only-internal', { sourceKind: 'subAgent.other', internalSource: true }),
    ]))
  },
  async (state) => {
    await state.refreshAll({ loadMessages: false, loadSkills: false, refreshModelPreferences: false })
    assert.equal(state.error.value, '')
    assert.deepEqual(visibleThreadIds(state.projectGroups.value), [], 'nothing internal reaches the sidebar')
    const persisted = storage.get(THREAD_GROUPS_CACHE_KEY)
    const persistedGroups = persisted
      ? (JSON.parse(persisted) as { groups?: Array<{ threads?: unknown[] }> }).groups ?? []
      : []
    assert.deepEqual(
      persistedGroups,
      [],
      'an all-internal cache must not stay authoritative on disk once the visible list is empty',
    )
  },
  { selectThread: false },
)

assert.deepEqual(unexpectedRequests, [], 'the fixture must not silently skip any real HTTP dependency')
console.log(`${checkNames.length - failures.length}/${checkNames.length} conversation retention checks passed (${requests.length} mocked HTTP requests)`)
if (failures.length) process.exitCode = 1
