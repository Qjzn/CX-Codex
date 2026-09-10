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
    return respond({ data: {
      ...snapshot,
      threadRead: requestedId === threadId ? currentThreadRead : { thread: { id: requestedId, turns: [] } },
    } })
  }
  if (url.endsWith('/reconcile')) return respond({ data: { snapshot } })
  if (url.startsWith('/codex-api/runtime/thread/')) return respond({ data: snapshot })
  if (url === '/codex-api/rpc') {
    const { method } = JSON.parse(String(init?.body))
    if (method === 'thread/list') return respond({ result: { data: [], nextCursor: null } })
    if (method === 'thread/read') return respond({ result: currentThreadRead })
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
async function check(name: string, run: (state: ReturnType<typeof useDesktopState>) => Promise<void>): Promise<void> {
  storage.clear()
  currentThreadRead = threadRead
  const state = useDesktopState()
  state.setWorktreeGitAutomationEnabled(false)
  try {
    await state.selectThread(threadId)
    assert.equal(state.error.value, '', `fixture setup failed: ${state.error.value}`)
    assert.equal(state.selectedConversationProjection.value.turns[0]?.final?.text, 'KEEP_COMPLETED_REPLY')
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

assert.deepEqual(unexpectedRequests, [], 'the fixture must not silently skip any real HTTP dependency')
console.log(`${4 - failures.length}/4 conversation retention checks passed (${requests.length} mocked HTTP requests)`)
if (failures.length) process.exitCode = 1
