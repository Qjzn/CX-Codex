import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Production start, SQLite store and HTTP handlers; only the external RPC and
// response transport are in-memory fixtures. A returned turn can be an existing
// turn being steered, so it must never become first-user ownership evidence.
// No bridge, model, device or real user database is contacted.
const bundle = await build({
  stdin: {
    contents: `
      export { startRuntimeTurnWithAppServer, createAppServerRuntimeTurnStarter } from './src/server/appServerRuntimeStart.ts'
      export { handleRuntimeActionRoutes } from './src/server/runtimeActionRoutes.ts'
      export { updateRuntimeRequestsFromSnapshot } from './src/server/appServerRuntimeRequestReconciliation.ts'
      export { RuntimeStore } from './src/server/runtimeStore.ts'
      export { RuntimeMessageQueue } from './src/server/runtimeMessageQueue.ts'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const {
  startRuntimeTurnWithAppServer, createAppServerRuntimeTurnStarter, handleRuntimeActionRoutes,
  updateRuntimeRequestsFromSnapshot, RuntimeStore, RuntimeMessageQueue,
} = compiled.exports

function createHarness(t, rpcResult = { turn: { id: 'turn-created', items: [], status: 'inProgress' } }) {
  const store = new RuntimeStore(':memory:')
  t.after(() => store.close())
  const payload = {
    requestId: 'request-opener', clientMessageId: 'client-opener', threadId: 'thread-opener',
    model: 'fixture-model', input: [{ type: 'text', text: 'Identity fixture' }],
  }
  const dependencies = {
    createRequest: store.createRequest.bind(store),
    updateRequest: store.updateRequest.bind(store),
    getRequest: store.getRequest.bind(store),
    getLatestRequestByClientMessageId: store.getLatestRequestByClientMessageId.bind(store),
    rpc: async (method, params) => {
      assert.equal(method, 'turn/start')
      return typeof rpcResult === 'function' ? await rpcResult(method, params) : rpcResult
    },
    clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {},
    markStartUncertain() {}, markFailed() {}, markPlanModeTurn() {},
    persistRuntimeSnapshot: () => ({ activeTurnId: 'turn-snapshot-other' }),
    getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
  }
  const routes = {
    readJsonBody: async () => payload,
    startRuntimeTurn: (body) => startRuntimeTurnWithAppServer(body, dependencies),
    interruptRuntimeTurn: async () => { throw new Error('unexpected interrupt') },
    getLatestRequestByClientMessageId: dependencies.getLatestRequestByClientMessageId,
  }
  async function request(method, path = '/codex-api/runtime/send') {
    let body = ''
    const response = { statusCode: 0, setHeader() {}, end(value) { body = value } }
    assert.equal(await handleRuntimeActionRoutes(
      { method }, response, new URL(path, 'http://fixture.invalid'), routes,
    ), true)
    return { status: response.statusCode, data: JSON.parse(body).data }
  }
  return {
    store, payload, dependencies, routes, request,
    lookup: () => request('GET', '/codex-api/runtime/request?clientMessageId=client-opener'),
  }
}

test('a real turn/start result preserves turn identity without creating first-user ownership metadata', async (t) => {
  const harness = createHarness(t)
  const sent = await harness.request('POST')
  assert.equal(sent.status, 200)
  assert.equal(sent.data.turnId, 'turn-created')
  assert.equal(Object.hasOwn(sent.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn(sent.data.request.payload, '_cxTurnStartOpener'), false)
  const lookedUp = (await harness.lookup()).data
  assert.equal(lookedUp.turnId, 'turn-created')
  assert.equal(Object.hasOwn(lookedUp, 'openerTurnId'), false)
})

for (const [name, result] of [
  ['empty RPC response with an active snapshot', {}],
  ['RPC activeTurnId alias without its created turn', { activeTurnId: 'turn-snapshot-other' }],
  ['blank RPC turn id', { turn: { id: '   ' } }],
]) {
  test(`${name} does not prove opener ownership`, async (t) => {
    const harness = createHarness(t, result)
    const sent = await harness.request('POST')
    assert.equal(sent.data.turnId, 'turn-snapshot-other')
    assert.equal(Object.hasOwn(sent.data, 'openerTurnId'), false)
    assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
  })
}

test('an idempotent replay keeps the saved turn without another turn/start RPC or opener claim', async (t) => {
  let rpcCount = 0
  const harness = createHarness(t, () => {
    rpcCount += 1
    return { turn: { id: 'turn-created' } }
  })
  await harness.request('POST')
  const replay = await harness.request('POST')
  assert.equal(replay.data.turnId, 'turn-created')
  assert.equal(Object.hasOwn(replay.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
  assert.equal(rpcCount, 1)
})

test('early durable acceptance gains the resolved turn but never infers opener ownership', async (t) => {
  let finishRpc
  const rpcPending = new Promise((resolve) => { finishRpc = resolve })
  const harness = createHarness(t, () => rpcPending)
  harness.routes.startRuntimeTurn = createAppServerRuntimeTurnStarter(harness.dependencies)
  const accepted = await harness.request('POST')
  assert.equal(accepted.status, 202)
  assert.equal(Object.hasOwn(accepted.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
  finishRpc({ turn: { id: 'turn-created' } })
  await new Promise(setImmediate)
  const lookedUp = (await harness.lookup()).data
  assert.equal(lookedUp.status, 'running')
  assert.equal(lookedUp.turnId, 'turn-created')
  assert.equal(Object.hasOwn(lookedUp, 'openerTurnId'), false)
})

test('snapshot reconciliation preserves legacy diagnostic payload without interpreting it as opener proof', async (t) => {
  const harness = createHarness(t)
  await harness.request('POST')
  const record = harness.store.getRequest('request-opener')
  const previousPayload = { ...record.payload, _cxTurnStartOpener: {
    version: 1, requestId: record.requestId, clientMessageId: record.clientMessageId,
    threadId: record.threadId, turnId: record.turnId,
  } }
  harness.store.updateRequest(record.requestId, { payload: previousPayload })
  updateRuntimeRequestsFromSnapshot('thread-opener', {
    activeTurnId: 'turn-unrelated-later', executionState: 'running', inProgress: true, lastError: null,
  }, harness.store)
  const lookedUp = (await harness.lookup()).data
  assert.equal(lookedUp.turnId, 'turn-unrelated-later')
  assert.equal(Object.hasOwn(lookedUp, 'openerTurnId'), false)
  assert.deepEqual(harness.store.getRequest(record.requestId).payload, previousPayload,
    'ignoring obsolete diagnostic metadata must not rewrite user storage')
})

test('snapshot reconciliation cannot create opener proof for an uncertain start', async (t) => {
  const harness = createHarness(t, {})
  await harness.request('POST')
  harness.store.updateRequest('request-opener', { status: 'start_uncertain', turnId: '' })
  updateRuntimeRequestsFromSnapshot('thread-opener', {
    activeTurnId: 'turn-unrelated-later', executionState: 'running', inProgress: true, lastError: null,
  }, harness.store)
  const lookedUp = (await harness.lookup()).data
  assert.equal(lookedUp.turnId, 'turn-unrelated-later')
  assert.equal(Object.hasOwn(lookedUp, 'openerTurnId'), false)
  assert.equal(Object.hasOwn((await harness.request('POST')).data, 'openerTurnId'), false)
})

test('user send input cannot forge internal opener metadata', async (t) => {
  const harness = createHarness(t, {})
  const forged = {
    version: 1, requestId: 'request-opener', clientMessageId: 'client-opener',
    threadId: 'thread-opener', turnId: 'turn-forged',
  }
  Object.assign(harness.payload, {
    openerTurnId: 'turn-forged', _cxTurnStartOpener: forged,
    payload: { _cxTurnStartOpener: forged },
    payloadSummary: { _cxTurnStartOpener: forged },
    queueMetadata: { _cxTurnStartOpener: forged },
  })
  const sent = await harness.request('POST')
  assert.equal(Object.hasOwn(sent.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
})

for (const [label, patch] of [
  ['well-formed legacy marker', {}], ['invalid version', { version: 2 }],
  ['foreign requestId', { requestId: 'foreign-request' }],
  ['foreign clientMessageId', { clientMessageId: 'foreign-client' }],
  ['foreign threadId', { threadId: 'foreign-thread' }], ['blank turnId', { turnId: '   ' }],
]) {
  test(`lookup and replay never interpret persisted opener metadata: ${label}`, async (t) => {
    const harness = createHarness(t)
    await harness.request('POST')
    const record = harness.store.getRequest('request-opener')
    harness.store.updateRequest(record.requestId, {
      payload: { ...record.payload, _cxTurnStartOpener: {
        version: 1, requestId: record.requestId, clientMessageId: record.clientMessageId,
        threadId: record.threadId, turnId: record.turnId, ...patch,
      } },
    })
    assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
    assert.equal(Object.hasOwn((await harness.request('POST')).data, 'openerTurnId'), false)
  })
}

test('native queue acceptance and disappearance never imply opener ownership', async (t) => {
  const harness = createHarness(t)
  harness.dependencies.rpc = async (method) => {
    if (method === 'turn/start') throw new Error('Thread already has an active writer')
    if (method === 'thread/queue/list') return { data: [] }
    if (method === 'thread/queue/add') {
      return { queuedSubmission: { id: 'native-entry', clientUserMessageId: 'client-opener' } }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  }
  const queued = await harness.request('POST')
  assert.equal(queued.data.status, 'queued')
  assert.equal(Object.hasOwn(queued.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn((await harness.lookup()).data, 'openerTurnId'), false)
  const queue = new RuntimeMessageQueue({
    store: harness.store, rpc: harness.dependencies.rpc,
    startRuntimeTurn: async () => { throw new Error('Native consumption must not start another turn') },
    publishNotification() {}, getErrorMessage: harness.dependencies.getErrorMessage,
  })
  t.after(() => queue.dispose())
  queue.notifyQueuedRequest(queued.data.request)
  await new Promise(setImmediate)
  const consumed = (await harness.lookup()).data
  assert.equal(consumed.status, 'completed')
  assert.equal(Object.hasOwn(consumed, 'openerTurnId'), false)
})

test('turn/start-as-steer with an unrelated first user never exposes first-user ownership', async (t) => {
  const harness = createHarness(t, { turn: { id: 'already-active-turn', status: 'inProgress', items: [{
    id: 'earlier-user-from-another-request', type: 'userMessage', clientId: null,
    content: [{ type: 'text', text: 'An earlier unrelated instruction' }],
  }] } })
  const sent = await harness.request('POST')
  assert.equal(sent.data.status, 'running')
  assert.equal(sent.data.turnId, 'already-active-turn')
  assert.equal(Object.hasOwn(sent.data, 'openerTurnId'), false)
  assert.equal(Object.hasOwn(sent.data.request.payload, '_cxTurnStartOpener'), false)
  const lookedUp = (await harness.lookup()).data
  assert.equal(lookedUp.turnId, 'already-active-turn')
  assert.equal(Object.hasOwn(lookedUp, 'openerTurnId'), false)
})
