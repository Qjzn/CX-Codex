import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Real generated JSONL -> production fallback reader -> production projection.
// This tests the visible-message contract, not whether diagnostic raw records
// should be deleted. No real sessions, model, bridge or browser are accessed.
const bundle = await build({
  stdin: {
    contents: `
      export { readThreadReadFromSessionLog } from './src/server/appServerSessionLogThreadRead.ts'
      export { projectConversation } from './src/conversation-transcript/index.ts'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { readThreadReadFromSessionLog, projectConversation } = compiled.exports

const threadId = 'session-display-contract-thread'
const turnId = 'session-display-contract-turn'
const clientId = 'session-display-client-a'
const text = 'Fixture only: keep this message stable'
const at = '2026-09-10T10:59:41.318Z'
const liveItemId = '019f0000-1234-7123-8123-0123456789ab'
const local = { id: 'optimistic-user:session-display', clientMessageId: clientId,
  displayMessageId: 'custom-logical-display', text, createdAtMs: 100, deliveryState: 'confirmationPending' }
const emptyRead = { thread: { id: threadId, turns: [] } }
function lifecyclePrefix(idOfTurn = turnId) {
  return [
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started', turn_id: idOfTurn } },
    { timestamp: at, type: 'turn_context', payload: { turn_id: idOfTurn } },
  ]
}
function response(id = 'model-input-response-a', body = text, idOfTurn = turnId) {
  return { timestamp: at, type: 'response_item', payload: {
    type: 'message', id, role: 'user', content: [{ type: 'input_text', text: body }],
    internal_chat_message_metadata_passthrough: { turn_id: idOfTurn, content_item_kinds: ['user.text'] },
  } }
}
function event(client = clientId, body = text) {
  return { timestamp: at, type: 'event_msg', payload: {
    type: 'user_message', client_id: client, message: body, images: [], local_images: [],
    audio: [], local_audio: [], text_elements: [],
  } }
}
function nativeNotice(client = clientId, id = liveItemId) {
  return { method: 'item/completed', atIso: at, seq: 1, params: { threadId, turnId,
    item: { type: 'userMessage', id, clientId: client, content: [{ type: 'text', text }] } } }
}
function projectedUsers(projection) {
  return projection.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user')
    .map((user) => ({ turn, user })))
}
async function readFixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'cx-session-display-contract-'))
  const path = join(root, 'fixture.jsonl')
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
  t.after(async () => { await unlink(path); await rmdir(root) })
  const result = await readThreadReadFromSessionLog(path, { thread: { id: threadId, turns: [], path } }, { fromStart: true })
  assert.ok(result?.thread)
  return result
}
function rawUsers(read) {
  return read.thread.turns.flatMap((turn) => turn.items.filter((item) => item.type === 'userMessage')
    .map((item) => ({ turn, item })))
}

test('the real log user event owns the visible opener instead of its anonymous model-input response', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response(), event()])
  const original = structuredClone(read)
  const raw = rawUsers(read)
  assert.equal(raw.length, 2, 'the fixture must retain both real raw recovery sources to reach the original bug')
  assert.equal(raw[0].item.recoverySource, 'response_item')
  assert.equal(raw[0].item.clientId, undefined)
  assert.equal(raw[1].item.recoverySource, 'event_msg')
  assert.equal(raw[1].item.clientId, clientId)
  const projection = projectConversation({ threadRead: read, localUserMessages: [local], nowMs: 1000 })
  const turn = projection.turns.find((candidate) => candidate.id === turnId)
  assert.ok(turn?.opener)
  assert.equal(turn.opener.clientMessageId, clientId, 'an anonymous model-input record must not replace the visible user opener')
  assert.equal(turn.opener.id, raw[1].item.id)
  assert.equal(turn.opener.displayMessageId, local.displayMessageId)
  assert.equal(turn.renderKey, `user-turn:${local.displayMessageId}`)
  assert.deepEqual(read, original, 'display decisions must not rewrite diagnostic recovery records')
})

test('a model-input response does not impersonate a second UI user when the canonical log event exists', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response(), event()])
  const rows = projectedUsers(projectConversation({ threadRead: read, localUserMessages: [local], nowMs: 1000 }))
  assert.equal(rows.length, 1, 'one logical message must have one visible user, not response plus event')
  assert.equal(rows[0].user.clientMessageId, clientId)
  assert.equal(rows[0].user.displayMessageId, local.displayMessageId)
})

test('local and native-live display identity remains stable through dual-source log recovery, replay and cleanup', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response(), event()])
  const canonical = rawUsers(read).find(({ item }) => item.clientId === clientId)
  assert.ok(canonical)
  assert.notEqual(canonical.item.id, liveItemId, 'the generated log event and native live item must have different IDs')
  const identities = [{ itemId: canonical.item.id, turnId, clientMessageId: clientId, displayMessageId: local.displayMessageId }]
  const stages = [
    projectConversation({ threadRead: emptyRead, localUserMessages: [local], nowMs: 100 }),
    projectConversation({ threadRead: emptyRead, notifications: [nativeNotice()], localUserMessages: [local], nowMs: 200 }),
    projectConversation({ threadRead: read, localUserMessages: [local], nowMs: 300 }),
    projectConversation({ threadRead: read, notifications: [nativeNotice()], localUserMessages: [local], nowMs: 400 }),
    projectConversation({ threadRead: read, notifications: [nativeNotice()], userMessageIdentities: identities, nowMs: 500 }),
    projectConversation({ threadRead: read, userMessageIdentities: identities, nowMs: 600 }),
  ]
  for (const [index, stage] of stages.entries()) {
    const turn = stage.turns[0]
    assert.ok(turn?.opener)
    assert.equal(turn.opener.displayMessageId, local.displayMessageId, `stage ${index}: the visible opener changed to a model-input response`)
    assert.equal(turn.renderKey, `user-turn:${local.displayMessageId}`, `stage ${index}: the mounted turn identity changed`)
    assert.equal(projectedUsers(stage).length, 1, `stage ${index}: duplicate visible user`)
  }
})

test('independent same-text native clients retain both visible users in recovered history', async (t) => {
  const secondClient = 'session-display-client-b'
  const read = await readFixture(t, [...lifecyclePrefix(), response(), event(), response('model-input-response-b'), event(secondClient)])
  const rows = projectedUsers(projectConversation({ threadRead: read, nowMs: 1000 }))
  assert.deepEqual(rows.map(({ user }) => user.clientMessageId), [clientId, secondClient],
    'source projection may not erase independent user events merely because their text is equal')
  assert.equal(new Set(rows.map(({ user }) => user.displayMessageId)).size, 2)
  assert.equal(rawUsers(read).filter(({ item }) => item.clientId).length, 2)
})

test('response-only legacy history remains readable without an invented native client identity', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response('legacy-response-only')])
  const projection = projectConversation({ threadRead: read, nowMs: 1000 })
  const rows = projectedUsers(projection)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.id, 'legacy-response-only')
  assert.equal(rows[0].user.text, text)
  assert.equal(rows[0].user.clientMessageId, null)
  assert.equal(projection.turns[0].opener.id, 'legacy-response-only')
})

test('a legacy response alone cannot acknowledge a new same-text local native request', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response('legacy-unidentified-response')])
  const rows = projectedUsers(projectConversation({ threadRead: read, localUserMessages: [local], nowMs: 1000 }))
  assert.ok(rows.some(({ user }) => user.id === local.id && user.clientMessageId === clientId))
  assert.ok(rows.some(({ user }) => user.id === 'legacy-unidentified-response' && user.clientMessageId === null))
})

test('a native user notification owns UI while the log event has not arrived yet', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response()])
  const projection = projectConversation({ threadRead: read, notifications: [nativeNotice()], localUserMessages: [local], nowMs: 1000 })
  const rows = projectedUsers(projection)
  assert.equal(rows.length, 1, 'model input is not another user while a canonical native user exists')
  assert.equal(rows[0].user.id, liveItemId)
  assert.equal(rows[0].user.displayMessageId, local.displayMessageId)
  assert.equal(projection.turns[0].renderKey, `user-turn:${local.displayMessageId}`)
})

test('a native snapshot page owns UI beside a response-only recovery page of the same turn', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response()])
  const nativeRead = { thread: { id: threadId, turns: [
    { id: turnId, status: 'completed', items: [nativeNotice().params.item] },
  ] } }
  const projection = projectConversation({ threadRead: [read, nativeRead], localUserMessages: [local], nowMs: 1000 })
  const rows = projectedUsers(projection)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.id, liveItemId)
  assert.equal(rows[0].user.displayMessageId, local.displayMessageId)
  assert.equal(rawUsers(read).length, 1, 'native page selection does not rewrite raw recovery')
})

test('same-turn event ownership follows recovery source even when the response text differs', async (t) => {
  const modelText = 'Model-facing context differs from the visible request'
  const visibleText = 'The actual user request from the native event'
  const read = await readFixture(t, [...lifecyclePrefix(), response('different-model-input', modelText), event(clientId, visibleText)])
  const rows = projectedUsers(projectConversation({ threadRead: read, nowMs: 1000 }))
  assert.equal(rows.length, 1, 'the visible-user source contract must not depend on matching the text')
  assert.equal(rows[0].user.text, visibleText)
  assert.equal(rows[0].user.clientMessageId, clientId)
  assert.ok(rawUsers(read).some(({ item }) => item.id === 'different-model-input'), 'raw model-facing evidence remains available')
})

test('an event in another turn does not hide response-only legacy history', async (t) => {
  const legacyTurnId = 'separate-legacy-turn'
  const read = await readFixture(t, [
    ...lifecyclePrefix(legacyTurnId), response('other-turn-legacy', 'An older user request', legacyTurnId),
    { timestamp: at, type: 'event_msg', payload: { type: 'task_complete', turn_id: legacyTurnId } },
    ...lifecyclePrefix(), event(),
  ])
  const rows = projectedUsers(projectConversation({ threadRead: read, nowMs: 1000 }))
  assert.equal(rows.length, 2)
  const legacy = rows.find(({ user }) => user.id === 'other-turn-legacy')
  assert.ok(legacy)
  assert.equal(legacy.turn.id, legacyTurnId)
  assert.equal(legacy.user.clientMessageId, null)
  assert.ok(rows.some(({ turn, user }) => turn.id === turnId && user.clientMessageId === clientId))
})

test('native user items without recoverySource survive beside recovered user events', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), response(), event()])
  const notification = nativeNotice('independent-native-client', 'independent-native-user')
  assert.equal(Object.hasOwn(notification.params.item, 'recoverySource'), false)
  const rows = projectedUsers(projectConversation({ threadRead: read, notifications: [notification], nowMs: 1000 }))
  const native = rows.filter(({ user }) => user.id === 'independent-native-user')
  assert.equal(native.length, 1, 'a source-specific filter must not drop unrelated native user items')
  assert.equal(native[0].user.clientMessageId, 'independent-native-client')
  assert.equal(native[0].turn.id, turnId)
})

test('a recovered event with a blank client remains readable without an invented identity', async (t) => {
  const read = await readFixture(t, [...lifecyclePrefix(), event('   ', 'Legacy event without a native identity')])
  const projection = projectConversation({ threadRead: read, nowMs: 1000 })
  const rows = projectedUsers(projection)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.text, 'Legacy event without a native identity')
  assert.equal(rows[0].user.clientMessageId, null)
  assert.equal(projection.turns[0].opener.id, rows[0].user.id)
})
