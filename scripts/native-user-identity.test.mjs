import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Exercise production normalization, projection, request parsing and the real
// runtime starter. Only the external App Server RPC boundary is simulated;
// SQLite is in-memory and no model, bridge, device or user database is touched.
const bundle = await build({
  stdin: {
    contents: `
      export { normalizeAcknowledgedUserMessagesV2 } from './src/api/normalizers/v2.ts'
      export { projectConversation } from './src/conversation-transcript/index.ts'
      export { filterVisibleOptimisticUserMessages, reconcileUserDisplayIdentities, userMessageSignature } from './src/composables/messageIdentity.ts'
      export { startRuntimeTurnWithAppServer, createAppServerRuntimeTurnStarter } from './src/server/appServerRuntimeStart.ts'
      export { RuntimeStore } from './src/server/runtimeStore.ts'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const {
  normalizeAcknowledgedUserMessagesV2, projectConversation, filterVisibleOptimisticUserMessages,
  reconcileUserDisplayIdentities, userMessageSignature, startRuntimeTurnWithAppServer,
  createAppServerRuntimeTurnStarter, RuntimeStore,
} = compiled.exports

const threadId = 'native-identity-thread'
const turnId = 'native-identity-turn'
const clientId = 'native-identity-client'
const bodyText = 'Fixture only: preserve this user message'
const local = {
  id: 'optimistic-user:native-user', clientMessageId: clientId,
  text: bodyText, createdAtMs: 100, deliveryState: 'sending',
}
function userItem(id = 'native-user-item', client = clientId) {
  return { id, type: 'userMessage', clientId: client, content: [{ type: 'text', text: bodyText }] }
}
function snapshot(items = [userItem()], id = turnId) {
  return { thread: { id: threadId, turns: [{ id, status: 'inProgress', items }] } }
}
function users(projection) {
  return projection.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user')
    .map((user) => ({ turn, user })))
}
function assertOneStableUser(before, after) {
  const initial = users(before)
  const current = users(after)
  assert.equal(initial.length, 1)
  assert.equal(current.length, 1, 'snapshot before ACK must not temporarily duplicate the local user')
  assert.equal(current[0].user.displayMessageId, initial[0].user.displayMessageId)
  assert.equal(current[0].turn.renderKey, initial[0].turn.renderKey)
  assert.equal(current[0].user.id, 'native-user-item', 'the real server item ID remains authoritative')
  assert.equal(current[0].turn.id, turnId)
}

test('native ThreadItem.clientId survives acknowledged-user normalization', () => {
  const result = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('native-user-item', ` ${clientId} `)]))
  assert.equal(result.length, 1)
  assert.equal(result[0].clientMessageId, clientId)
  assert.equal(result[0].id, 'native-user-item')
  assert.equal(result[0].turnId, turnId)
  assert.equal(result[0].text, bodyText)
})

test('a native snapshot before ACK preserves a single local display and turn key', () => {
  const before = projectConversation({ threadRead: { thread: { id: threadId, turns: [] } }, localUserMessages: [local] })
  const after = projectConversation({ threadRead: snapshot(), localUserMessages: [local] })
  assertOneStableUser(before, after)
  assert.equal(users(after)[0].user.clientMessageId, clientId)
})

test('runtime status alone does not add an empty authoritative shell beside an unbound pending user', () => {
  const pending = { ...local, deliveryState: 'confirmationPending' }
  const threadRead = { thread: { id: threadId, turns: [] } }
  const before = projectConversation({ threadRead, localUserMessages: [pending] })
  const after = projectConversation({ threadRead, localUserMessages: [pending],
    runtime: { activeTurnId: turnId, executionState: 'running', messageState: 'fresh' } })
  assert.equal(after.turns.length, 1, 'a status-only activeTurnId must not create a second empty turn')
  const initial = users(before)[0]
  const current = users(after)[0]
  assert.equal(users(after).length, 1)
  assert.equal(current.user.id, pending.id)
  assert.equal(current.user.clientMessageId, clientId)
  assert.equal(current.user.deliveryState, 'confirmationPending')
  assert.equal(current.user.displayMessageId, initial.user.displayMessageId)
  assert.equal(current.turn.id, initial.turn.id, 'runtime activity cannot bind the unconfirmed user to a turn')
  assert.equal(current.turn.renderKey, initial.turn.renderKey)
  assert.equal(current.turn.state, initial.turn.state)
  assert.notEqual(current.turn.state, 'running', 'do not disguise transport confirmation as model execution')
})

test('real turn and item notifications retain authoritative activity without consuming an unrelated pending user', () => {
  const pending = { ...local, deliveryState: 'confirmationPending' }
  const threadRead = { thread: { id: threadId, turns: [] } }
  const initial = users(projectConversation({ threadRead, localUserMessages: [pending] }))[0]
  const events = [
    { method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } } },
    { method: 'item/started', params: { threadId, turnId, item: {
      id: 'actual-command-item', type: 'commandExecution', command: 'fixture-command', status: 'inProgress',
    } } },
    { method: 'item/completed', params: { threadId, turnId, item: userItem('another-users-message', 'another-native-client') } },
  ]
  for (const event of events) {
    const after = projectConversation({ threadRead, localUserMessages: [pending],
      notifications: [{ ...event, seq: 1, atIso: '2026-09-10T00:00:00.000Z' }],
      runtime: { activeTurnId: turnId, executionState: 'running', messageState: 'fresh' } })
    assert.equal(after.turns.length, 2, `${event.method}: real evidence must keep the authoritative turn`)
    const authority = after.turns.find((turn) => turn.id === turnId)
    assert.ok(authority)
    assert.equal(authority.state, 'running')
    const remaining = users(after).find(({ user }) => user.id === pending.id)
    assert.ok(remaining, `${event.method}: unrelated activity cannot consume the pending local user`)
    assert.equal(remaining.user.deliveryState, 'confirmationPending')
    assert.equal(remaining.turn.id, initial.turn.id)
    assert.equal(remaining.turn.renderKey, initial.turn.renderKey)
    assert.equal(remaining.turn.state, initial.turn.state)
  }
})

test('native item notifications before ACK and duplicate replay preserve one display', () => {
  const before = projectConversation({ threadRead: { thread: { id: threadId, turns: [] } }, localUserMessages: [local] })
  const event = {
    method: 'item/completed', params: { threadId, turnId, item: userItem() },
    seq: 1, atIso: '2026-09-10T00:00:00.000Z',
  }
  const after = projectConversation({ threadRead: { thread: { id: threadId, turns: [] } },
    notifications: [event, event], localUserMessages: [local] })
  assertOneStableUser(before, after)
})

// Verified with the isolated 0.153.4 protocol fixture: item notifications use
// a UUID, while thread/read and resume use item-1 for the same native clientId.
// Keep the permanent fixture synthetic; do not depend on ignored output files.
const liveUserId = '019f0000-1234-7123-8123-0123456789ab'
function liveUserEvent(id = liveUserId, client = clientId, method = 'item/completed', idOfTurn = turnId) {
  return { method, params: { threadId, turnId: idOfTurn, item: userItem(id, client) },
    seq: method === 'item/started' ? 1 : 2, atIso: '2026-09-10T00:00:00.000Z' }
}

test('one native user keeps its display across live UUID, snapshot item-1, combined replay and local cleanup', () => {
  const live = [liveUserEvent(liveUserId, clientId, 'item/started'), liveUserEvent()]
  const read = snapshot([userItem('item-1')])
  const empty = { thread: { id: threadId, turns: [] } }
  const stages = [
    projectConversation({ threadRead: empty, localUserMessages: [local] }),
    projectConversation({ threadRead: empty, notifications: live, localUserMessages: [local] }),
    projectConversation({ threadRead: read, notifications: live, localUserMessages: [local] }),
    projectConversation({ threadRead: read, notifications: live, localUserMessages: [] }),
    projectConversation({ threadRead: read, localUserMessages: [] }),
  ]
  const initial = users(stages[0])[0]
  for (const [index, stage] of stages.entries()) {
    const rows = users(stage)
    assert.equal(rows.length, 1, `stage ${index}: native live/snapshot aliases must not duplicate one logical user`)
    assert.equal(rows[0].user.displayMessageId, initial.user.displayMessageId, `stage ${index}: user display changed`)
    assert.equal(rows[0].turn.renderKey, initial.turn.renderKey, `stage ${index}: turn render key changed`)
    assert.equal(rows[0].user.clientMessageId, clientId)
    if (index > 0) assert.ok([liveUserId, 'item-1'].includes(rows[0].user.id), 'keep one real protocol item ID')
  }
})

test('native live/snapshot aliases coalesce without mutating either source or requiring a local pending row', () => {
  const read = snapshot([userItem('item-1')])
  const notifications = [liveUserEvent(), liveUserEvent()]
  const before = structuredClone({ read, notifications })
  const rows = users(projectConversation({ threadRead: read, notifications }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.clientMessageId, clientId)
  assert.equal(rows[0].user.displayMessageId, `client:${clientId}`)
  assert.deepEqual({ read, notifications }, before)
})

test('same-item replay with clientId null cannot erase a snapshot client identity or duplicate its local user', () => {
  const read = snapshot([userItem('item-1')])
  const notification = liveUserEvent('item-1', null)
  const original = structuredClone({ read, notification })
  const rows = users(projectConversation({ threadRead: read, notifications: [notification],
    localUserMessages: [{ ...local, turnId }] }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.id, 'item-1')
  assert.equal(rows[0].user.clientMessageId, clientId)
  assert.equal(rows[0].user.displayMessageId, `client:${clientId}`)
  assert.deepEqual({ read, notification }, original)
})

test('exact cached live UUID display survives canonical snapshot item-1 alias reconciliation', () => {
  const identities = [{ itemId: liveUserId, turnId, clientMessageId: clientId, displayMessageId: 'original-logical-display' }]
  const notifications = [liveUserEvent()]
  const before = users(projectConversation({ threadRead: { thread: { id: threadId, turns: [] } },
    notifications, userMessageIdentities: identities }))[0]
  const rows = users(projectConversation({ threadRead: snapshot([userItem('item-1')]),
    notifications, userMessageIdentities: identities }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.id, 'item-1')
  assert.equal(rows[0].user.displayMessageId, 'original-logical-display')
  assert.equal(rows[0].turn.renderKey, before.turn.renderKey)
  assert.deepEqual(identities, [{ itemId: liveUserId, turnId, clientMessageId: clientId, displayMessageId: 'original-logical-display' }])
})

test('the same native client ID in different turns remains ambiguous across snapshot and live sources', () => {
  const rows = users(projectConversation({ threadRead: snapshot([userItem('item-1')]),
    notifications: [liveUserEvent(liveUserId, clientId, 'item/completed', 'another-turn')], localUserMessages: [local] }))
  assert.equal(rows.length, 3, 'cross-turn client duplication cannot confirm the local request or merge two turns')
  assert.ok(rows.some(({ user }) => user.id === local.id))
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 3)
  assert.equal(new Set(rows.map(({ turn }) => turn.id)).size, 3)
})

test('two distinct snapshot users claiming one native client ID remain a genuine same-source conflict', () => {
  const rows = users(projectConversation({
    threadRead: snapshot([userItem('item-1'), userItem('item-2')]), localUserMessages: [local],
  }))
  assert.equal(rows.length, 3, 'client identity alone must not collapse genuinely different snapshot items')
  assert.deepEqual(rows.map(({ user }) => user.id).sort(), ['item-1', 'item-2', local.id].sort())
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 3)
})

test('two distinct live users claiming one native client ID remain a genuine same-source conflict', () => {
  const otherLiveId = '019f0000-1234-7123-8123-abcdefabcdef'
  const rows = users(projectConversation({ threadRead: { thread: { id: threadId, turns: [] } },
    notifications: [liveUserEvent(), { ...liveUserEvent(otherLiveId), seq: 3 }], localUserMessages: [local] }))
  assert.equal(rows.length, 3, 'client identity alone must not collapse different live item IDs')
  assert.deepEqual(rows.map(({ user }) => user.id).sort(), [liveUserId, otherLiveId, local.id].sort())
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 3)
})

test('a snapshot cannot choose between two different live claims for the same native client identity', () => {
  const otherLiveId = '019f0000-1234-7123-8123-abcdefabcdef'
  const rows = users(projectConversation({ threadRead: snapshot([userItem('item-1')]),
    notifications: [liveUserEvent(), { ...liveUserEvent(otherLiveId), seq: 3 }], localUserMessages: [local] }))
  assert.equal(rows.length, 4, 'ambiguous cross-source aliases must retain the conflicting source items and local request')
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 4)
})

test('same text with independent native client IDs cannot consume the wrong local request', () => {
  const otherLocal = { ...local, id: 'optimistic-other-user', clientMessageId: 'native-other-client' }
  const rows = users(projectConversation({ threadRead: snapshot(), localUserMessages: [otherLocal, local] }))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ user }) => user.clientMessageId).sort(), [clientId, otherLocal.clientMessageId].sort())
  assert.equal(rows.find(({ user }) => user.clientMessageId === otherLocal.clientMessageId).user.id, otherLocal.id)
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 2)
})

test('native opener and same-turn steer IDs remain three independent user blocks', () => {
  const ids = [clientId, 'native-steer-b', 'native-steer-c']
  const rows = users(projectConversation({
    threadRead: snapshot(ids.map((id, index) => userItem(`native-user-${index}`, id))),
    localUserMessages: ids.map((id, index) => ({ ...local, id: `local-user-${index}`, clientMessageId: id, turnId })),
  }))
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(({ user }) => user.clientMessageId), ids)
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 3)
})

test('native normalization feeds exact reconciliation and local cleanup before ACK', () => {
  const optimistic = { id: local.id, role: 'user', text: bodyText, images: [], turnIndex: 0 }
  const meta = new Map([[local.id, {
    kind: 'optimisticUserMessage', baselineMatchCount: 0, baselineMessageCount: 0,
    baselineTailMessageId: '', createdAtMs: 100,
    clientMessageId: clientId, displayMessageId: 'explicit-native-display', signature: userMessageSignature(optimistic),
  }]])
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot())
  const cached = reconcileUserDisplayIdentities([], incoming, [optimistic], meta)
  assert.equal(cached.length, 1)
  assert.equal(cached[0].clientMessageId, clientId)
  assert.equal(cached[0].displayMessageId, 'explicit-native-display')
  assert.deepEqual(filterVisibleOptimisticUserMessages(cached, [optimistic], meta), [])
  const other = { ...optimistic, id: 'optimistic-user:other-native-user' }
  meta.set(other.id, { ...meta.get(local.id), clientMessageId: 'independent-native-client' })
  assert.deepEqual(filterVisibleOptimisticUserMessages(cached, [other, optimistic], meta), [other],
    'the acknowledged native identity cannot consume another same-text request')
})

function cachedNativeUser(id = liveUserId, idOfTurn = turnId, displayMessageId = 'remembered-custom-native-display') {
  return { id, turnId: idOfTurn, clientMessageId: clientId, displayMessageId,
    role: 'user', messageType: 'userMessage', text: bodyText }
}

test('cache preserves a custom display across live UUID to snapshot item-1 after optimistic cleanup', () => {
  const previous = [cachedNativeUser()]
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('item-1')]))
  const originals = structuredClone({ previous, incoming })
  const cached = reconcileUserDisplayIdentities(previous, incoming, [], new Map())
  assert.equal(cached.length, 1)
  assert.equal(cached[0].id, 'item-1', 'the fresh snapshot item ID remains authoritative')
  assert.equal(cached[0].turnId, turnId)
  assert.equal(cached[0].clientMessageId, clientId)
  assert.equal(cached[0].displayMessageId, previous[0].displayMessageId,
    'a unique native client identity in the same turn must preserve a custom display without a pending row')
  assert.deepEqual({ previous, incoming }, originals)
})

test('cache cannot transfer a native client display across different turns', () => {
  const previous = [cachedNativeUser()]
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('item-1')], 'other-turn'))
  const cached = reconcileUserDisplayIdentities(previous, incoming, [], new Map())
  assert.equal(cached[0].displayMessageId, undefined)
  assert.equal(cached[0].turnId, 'other-turn')
})

test('cache cannot choose between two previous item displays that claim one same-turn client', () => {
  const previous = [cachedNativeUser(), cachedNativeUser('different-cached-item', turnId, 'different-custom-display')]
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('item-1')]))
  const cached = reconcileUserDisplayIdentities(previous, incoming, [], new Map())
  assert.equal(cached[0].displayMessageId, undefined)
  assert.equal(cached[0].id, 'item-1')
})

test('cache cannot transfer one display to ambiguous same-source snapshot clients', () => {
  const previous = [cachedNativeUser()]
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('item-1'), userItem('item-2')]))
  const cached = reconcileUserDisplayIdentities(previous, incoming, [], new Map())
  assert.equal(cached.length, 2)
  assert.deepEqual(cached.map((message) => message.displayMessageId), [undefined, undefined])
  assert.deepEqual(cached.map((message) => message.id), ['item-1', 'item-2'])
})

test('null, blank or missing native client IDs never pair equal text with a local request', () => {
  for (const client of [null, '', '   ', undefined]) {
    const item = userItem('unknown-native-user', client)
    if (client === undefined) delete item.clientId
    const read = snapshot([item])
    assert.equal(normalizeAcknowledgedUserMessagesV2(read)[0].clientMessageId, undefined)
    assert.equal(users(projectConversation({ threadRead: read, localUserMessages: [local] })).length, 2)
  }
})

test('existing clientMessageId and clientUserMessageId compatibility remains intact', () => {
  for (const alias of ['clientMessageId', 'clientUserMessageId']) {
    const item = userItem()
    delete item.clientId
    item[alias] = clientId
    assert.equal(normalizeAcknowledgedUserMessagesV2(snapshot([item]))[0].clientMessageId, clientId)
    assert.equal(users(projectConversation({ threadRead: snapshot([item]), localUserMessages: [local] })).length, 1)
  }
})

test('native clientId wins over conflicting compatibility aliases in normalization and projection', () => {
  const item = { ...userItem(), clientMessageId: 'incorrect-compatibility-client', clientUserMessageId: 'other-compatibility-client' }
  assert.equal(normalizeAcknowledgedUserMessagesV2(snapshot([item]))[0].clientMessageId, clientId)
  const rows = users(projectConversation({ threadRead: snapshot([item]), localUserMessages: [local] }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.clientMessageId, clientId)
})

test('a matching compatibility alias cannot claim an item whose native clientId belongs to someone else', () => {
  const item = { ...userItem('other-native-item', 'other-native-client'), clientMessageId: clientId, clientUserMessageId: clientId }
  const rows = users(projectConversation({ threadRead: snapshot([item]), localUserMessages: [local] }))
  assert.equal(rows.length, 2)
  assert.equal(rows.find(({ user }) => user.id === 'other-native-item').user.clientMessageId, 'other-native-client')
  assert.equal(rows.find(({ user }) => user.id === local.id).user.clientMessageId, clientId)
})

test('turn/start-as-steer cannot claim an unidentified first user from a partial snapshot', () => {
  const item = userItem('earlier-user-from-another-request', null)
  item.content = [{ type: 'text', text: 'A different earlier instruction' }]
  // Simulate stale metadata from the previous candidate. Neither a returned
  // active turn nor its old opener alias proves which user item was accepted.
  const pending = { ...local, turnId, openerTurnId: turnId }
  const rows = users(projectConversation({ threadRead: snapshot([item]), localUserMessages: [pending] }))
  assert.equal(rows.length, 2, 'a partial turn/start/steer snapshot must keep the unconfirmed local request')
  assert.equal(rows.find(({ user }) => user.id === item.id).user.clientMessageId, null)
  assert.equal(rows.find(({ user }) => user.id === local.id).user.clientMessageId, clientId)
})

test('stale opener metadata cannot clear the outbox candidate or transfer identity to an unrelated partial user', () => {
  const optimistic = { id: local.id, role: 'user', text: bodyText, images: [] }
  const meta = new Map([[local.id, {
    kind: 'optimisticUserMessage', baselineMatchCount: 0, baselineMessageCount: 0,
    baselineTailMessageId: '', createdAtMs: 100, authoritativeTurnId: turnId, openerTurnId: turnId,
    clientMessageId: clientId, displayMessageId: 'local-steer-display', signature: userMessageSignature(optimistic),
  }]])
  const incoming = normalizeAcknowledgedUserMessagesV2(snapshot([userItem('unidentified-older-user', null)]))
  const cached = reconcileUserDisplayIdentities([], incoming, [optimistic], meta)
  assert.equal(cached[0].clientMessageId, undefined)
  assert.equal(cached[0].displayMessageId, undefined)
  assert.deepEqual(filterVisibleOptimisticUserMessages(cached, [optimistic], meta), [optimistic])
})

test('native identity processing leaves protocol input and local metadata untouched', () => {
  const input = { threadRead: snapshot(), localUserMessages: [{ ...local }] }
  const copy = structuredClone(input)
  normalizeAcknowledgedUserMessagesV2(input.threadRead)
  projectConversation(input)
  assert.deepEqual(input, copy)
})

function createHarness(t, override = {}) {
  const store = new RuntimeStore(':memory:')
  t.after(() => store.close())
  const payload = {
    requestId: 'native-request-id', clientMessageId: ` ${clientId} `, threadId,
    model: 'fixture-model', effort: 'high', collaborationMode: 'execute',
    input: [{ type: 'text', text: bodyText }, { type: 'localImage', path: 'C:/fixture/input.png' }],
    attachments: [{ name: 'fixture.txt', path: 'C:/fixture/fixture.txt' }],
    ...override,
  }
  const calls = []
  const dependencies = {
    createRequest: store.createRequest.bind(store), updateRequest: store.updateRequest.bind(store),
    getRequest: store.getRequest.bind(store), getLatestRequestByClientMessageId: store.getLatestRequestByClientMessageId.bind(store),
    rpc: async (method, params) => {
      calls.push({ method, params: structuredClone(params) })
      assert.equal(method, 'turn/start')
      return { turn: { id: turnId } }
    },
    clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {},
    markStartUncertain() {}, markFailed() {}, markPlanModeTurn() {},
    persistRuntimeSnapshot: () => ({ activeTurnId: turnId }),
    getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
  }
  return { store, payload, calls, dependencies }
}

for (const mode of ['execute', 'plan']) {
  test(`runtime ${mode} forwards parsed clientMessageId as native clientUserMessageId with unchanged arguments`, async (t) => {
    const harness = createHarness(t, { collaborationMode: mode, clientUserMessageId: 'must-not-override-parsed-identity' })
    const original = structuredClone(harness.payload)
    const result = await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
    assert.equal(result.status, 'running')
    assert.deepEqual(harness.calls.map(({ method }) => method), ['turn/start'])
    assert.deepEqual(harness.calls[0].params, {
      threadId, input: original.input, attachments: original.attachments, model: 'fixture-model', effort: 'high',
      clientUserMessageId: clientId,
      collaborationMode: { mode: mode === 'plan' ? 'plan' : 'default',
        settings: { model: 'fixture-model', reasoning_effort: 'high', developer_instructions: null } },
    })
    assert.equal(result.request.clientMessageId, clientId)
    assert.deepEqual(harness.payload, original)
  })
}

test('legacy sends forward the parser request-ID fallback, not an unrelated native alias', async (t) => {
  const harness = createHarness(t, { clientMessageId: '', clientUserMessageId: 'untrusted-alias' })
  const result = await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
  assert.equal(result.request.clientMessageId, 'native-request-id')
  assert.equal(harness.calls[0].params.clientUserMessageId, result.request.clientMessageId)
})

test('thread/resume retry reuses exactly the same native user identity and input', async (t) => {
  const harness = createHarness(t)
  harness.dependencies.rpc = async (method, params) => {
    harness.calls.push({ method, params: structuredClone(params) })
    if (harness.calls.length === 1) throw new Error('thread not found')
    return method === 'thread/resume' ? { thread: { id: threadId } } : { turn: { id: turnId } }
  }
  await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
  assert.deepEqual(harness.calls.map(({ method }) => method), ['turn/start', 'thread/resume', 'turn/start'])
  assert.equal(harness.calls[0].params.clientUserMessageId, clientId)
  assert.deepEqual(harness.calls[2].params, harness.calls[0].params)
})

test('definite plan-mode fallback keeps native identity while preserving the existing safe input wrapper', async (t) => {
  const harness = createHarness(t, { collaborationMode: 'plan' })
  const original = structuredClone(harness.payload)
  harness.dependencies.rpc = async (method, params) => {
    harness.calls.push({ method, params: structuredClone(params) })
    assert.equal(method, 'turn/start')
    if (harness.calls.length === 1) throw Object.assign(new Error('unknown field collaborationMode'), { code: -32602 })
    return { turn: { id: turnId } }
  }
  await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
  assert.equal(harness.calls.length, 2)
  for (const call of harness.calls) assert.equal(call.params.clientUserMessageId, clientId)
  const fallback = harness.calls[1].params
  assert.equal(Object.hasOwn(fallback, 'collaborationMode'), false)
  assert.ok(fallback.input[0].text.startsWith('# Codex Plan Mode'))
  assert.ok(fallback.input[0].text.endsWith(bodyText))
  assert.deepEqual(fallback.input.slice(1), original.input.slice(1))
  assert.deepEqual(fallback.attachments, original.attachments)
  assert.deepEqual(harness.payload, original)
})

test('idempotent native identity replay does not produce another model RPC', async (t) => {
  const harness = createHarness(t)
  await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
  await startRuntimeTurnWithAppServer(harness.payload, harness.dependencies)
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].params.clientUserMessageId, clientId)
})

test('a native snapshot emitted while turn/start is pending removes the duplicate before the RPC completes', async (t) => {
  const harness = createHarness(t)
  let finishRpc
  let sentParams
  const pending = new Promise((resolve) => { finishRpc = resolve })
  harness.dependencies.rpc = async (method, params) => {
    assert.equal(method, 'turn/start')
    sentParams = structuredClone(params)
    return await pending
  }
  const starter = createAppServerRuntimeTurnStarter(harness.dependencies)
  const accepted = await starter(harness.payload)
  assert.equal(accepted.status, 'starting')
  assert.equal(Object.hasOwn(accepted, 'openerTurnId'), false)
  assert.ok(sentParams, 'the actual runtime starter dispatched the pending RPC')
  const before = projectConversation({ threadRead: { thread: { id: threadId, turns: [] } }, localUserMessages: [local] })
  // Codex echoes the clientUserMessageId request field as ThreadItem.clientId.
  const emitted = snapshot([userItem('native-user-item', sentParams.clientUserMessageId ?? null)])
  try {
    const after = projectConversation({ threadRead: emitted, localUserMessages: [local] })
    assertOneStableUser(before, after)
    assert.equal(normalizeAcknowledgedUserMessagesV2(emitted)[0].clientMessageId, clientId)
  } finally {
    finishRpc({ turn: { id: turnId } })
    await new Promise(setImmediate)
  }
})
