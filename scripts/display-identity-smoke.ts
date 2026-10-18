import assert from 'node:assert/strict'
import { setImmediate as nextEventLoop } from 'node:timers/promises'
import { effectScope, watch } from 'vue'
import { projectConversation } from '../src/conversation-transcript/index.js'
import type { ConversationLocalUserMessage, ConversationProjection, ConversationProjectionInput, ConversationTurn, ConversationUserBlock } from '../src/conversation-transcript/index.js'
import { filterVisibleOptimisticUserMessages, reconcileUserDisplayIdentities, userMessageSignature } from '../src/composables/messageIdentity.js'
import type { OptimisticUserMessageMeta } from '../src/composables/messageIdentity.js'
import type { AcknowledgedUserMessage, OptimisticUserMessage } from '../src/types/codex.js'
import { mergeCachedThreadMessages } from '../src/composables/threadMessageCache.js'
import { loadMessageOutboxState, MESSAGE_OUTBOX_STORAGE_KEY, parseMessageOutboxState, serializeMessageOutboxState } from '../src/composables/messageOutboxPersistence.js'
import type { MessageOutboxEntry } from '../src/composables/messageOutboxPersistence.js'
import { useDesktopState } from '../src/composables/useDesktopState.js'
import { getThreadRuntimeSnapshot } from '../src/api/codexGateway.js'

const threadId = 'display-identity-thread'
const turnId = 'authoritative-turn-a'
const clientId = 'immutable-request-a'
const text = 'Fixture only: preserve this logical message'
const local: ConversationLocalUserMessage = {
  id: 'optimistic-display-a', clientMessageId: clientId, text, createdAtMs: 100, deliveryState: 'sending',
}
type DisplayLocal = ConversationLocalUserMessage
type UserIdentity = NonNullable<ConversationProjectionInput['userMessageIdentities']>[number]
function threadRead(turns: unknown[] = []) { return { thread: { id: threadId, turns } } }
function authoritativeTurn(id = turnId, requestId = clientId, itemId = 'authoritative-user-a', body = text) {
  return { id, status: 'inProgress', items: [{
    id: itemId, type: 'userMessage', clientMessageId: requestId, content: [{ type: 'text', text: body }],
  }] }
}
function nativeTurn(id = turnId, requestId = clientId, itemId = 'authoritative-user-a', body = text) {
  const turn = authoritativeTurn(id, requestId, itemId, body)
  delete (turn.items[0]! as { clientMessageId?: string }).clientMessageId
  Object.assign(turn.items[0]!, { clientId: requestId })
  return turn
}
function users(projection: ConversationProjection) {
  return projection.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user').map((user) => ({ turn, user })))
}
function single(projection: ConversationProjection) {
  const rows = users(projection)
  assert.equal(rows.length, 1, 'one logical delivery must have exactly one projected user block')
  return rows[0]!
}
function displayId(user: ConversationUserBlock): string {
  return (user as ConversationUserBlock & { displayMessageId?: string }).displayMessageId ?? user.id
}
function renderKey(turn: ConversationTurn): string {
  return (turn as ConversationTurn & { renderKey?: string }).renderKey ?? turn.id
}
let checks = 0
const failures: string[] = []
function check(name: string, run: () => void): void {
  checks += 1
  try { run(); console.log(`PASS ${name}`) }
  catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const acceptedLocal = { ...local, turnId, deliveryState: 'sent' as const }
const stages = [
  projectConversation({ threadRead: threadRead(), localUserMessages: [local], nowMs: 100 }),
  projectConversation({ threadRead: threadRead(), localUserMessages: [acceptedLocal], nowMs: 200 }),
  projectConversation({ threadRead: threadRead([authoritativeTurn()]), localUserMessages: [acceptedLocal], nowMs: 300 }),
  projectConversation({ threadRead: threadRead([authoritativeTurn()]), localUserMessages: [], nowMs: 400 }),
].map(single)

check('a logical user keeps its display identity through ACK, authoritative snapshot and local cleanup', () => {
  const identities = stages.map(({ user }) => displayId(user))
  assert.ok(identities[0])
  assert.deepEqual(identities, Array(4).fill(identities[0]), 'confirmation must not replace the visible user identity')
})
check('ACK binding preserves the existing turn render key while retaining authoritative turn identity', () => {
  const renderKeys = stages.map(({ turn }) => renderKey(turn))
  assert.deepEqual(renderKeys, Array(4).fill(renderKeys[0]), 'the mounted turn must not remount when a turnId arrives')
  assert.equal(stages[1]!.turn.id, turnId, 'display stability must not replace the authoritative turn ID')
})

check('identical text from independent local requests keeps two display identities', () => {
  const projection = projectConversation({ threadRead: threadRead(), nowMs: 100, localUserMessages: [
    local, { ...local, id: 'optimistic-display-b', clientMessageId: 'immutable-request-b' },
  ] })
  const rows = users(projection)
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 2)
  assert.equal(new Set(rows.map(({ turn }) => renderKey(turn))).size, 2)
})
check('acknowledging one identical-text request does not consume the other local request', () => {
  const otherLocal = { ...local, id: 'optimistic-display-b', clientMessageId: 'immutable-request-b' }
  const projection = projectConversation({
    threadRead: threadRead([authoritativeTurn()]), localUserMessages: [acceptedLocal, otherLocal], nowMs: 300,
  })
  const rows = users(projection)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ user }) => user.clientMessageId).sort(), [clientId, 'immutable-request-b'].sort())
  const other = rows.find(({ user }) => user.clientMessageId === 'immutable-request-b')!
  assert.equal(displayId(other.user), displayId(single(projectConversation({ threadRead: threadRead(), localUserMessages: [otherLocal], nowMs: 100 })).user))
})
check('unknown user identity is never paired by equal text or by sharing the acknowledged turn', () => {
  const unknown = authoritativeTurn()
  delete (unknown.items[0]! as { clientMessageId?: string }).clientMessageId
  const projection = projectConversation({ threadRead: threadRead([unknown]), localUserMessages: [acceptedLocal], nowMs: 300 })
  assert.equal(users(projection).length, 2, 'neither equal text nor a shared turn proves which user item accepted this request')
})
check('clientUserMessageId is the same authoritative request identity as clientMessageId', () => {
  const aliased = authoritativeTurn()
  delete (aliased.items[0]! as { clientMessageId?: string }).clientMessageId
  Object.assign(aliased.items[0]!, { clientUserMessageId: clientId })
  const row = single(projectConversation({ threadRead: threadRead([aliased]), localUserMessages: [acceptedLocal], nowMs: 300 }))
  assert.equal(row.user.clientMessageId, clientId, 'deduplication and public identity must normalize the same protocol alias')
})
check('a normal turn binding cannot resolve duplicate authoritative client claims', () => {
  const projection = projectConversation({
    threadRead: threadRead([authoritativeTurn(), authoritativeTurn('another-authoritative-turn', clientId, 'another-authoritative-user')]),
    localUserMessages: [acceptedLocal], nowMs: 300,
  })
  const rows = users(projection)
  assert.equal(rows.length, 3, 'ambiguous client claims must retain the unconfirmed local user')
  assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 3)
  assert.equal(new Set(rows.map(({ turn }) => renderKey(turn))).size, 2)
  const matching = rows.filter(({ user }) => displayId(user) === displayId(stages[0]!.user))
  assert.equal(matching.length, 1)
  assert.equal(matching[0]!.user.id, local.id, 'a recovered turnId cannot choose between conflicting client claims')
})
check('stale opener metadata cannot choose between duplicate authoritative client claims', () => {
  const laterTurn = 'later-reconciled-turn'
  const rows = users(projectConversation({
    threadRead: threadRead([authoritativeTurn(), authoritativeTurn(laterTurn, clientId, 'duplicate-client-user')]),
    localUserMessages: [{ ...acceptedLocal, turnId: laterTurn, openerTurnId: turnId }], nowMs: 300,
  }))
  assert.equal(rows.length, 3)
  const matched = rows.filter(({ user }) => displayId(user) === displayId(stages[0]!.user))
  assert.deepEqual(matched.map(({ user, turn }) => [user.id, turn.id]), [[local.id, laterTurn]])
})
check('stale opener metadata cannot veto a unique exact client identity', () => {
  const laterTurn = 'only-reconciled-turn'
  const rows = users(projectConversation({
    threadRead: threadRead([authoritativeTurn(laterTurn, clientId, 'unproven-client-user')]),
    localUserMessages: [{ ...acceptedLocal, turnId: laterTurn, openerTurnId: turnId }], nowMs: 300,
  }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.user.id, 'unproven-client-user')
  assert.equal(displayId(rows[0]!.user), displayId(stages[0]!.user))
})
check('an unmatched local and a conflicting authoritative client claim keep two distinct render keys', () => {
  const rows = users(projectConversation({
    threadRead: threadRead([authoritativeTurn('conflicting-turn', 'another-client', 'conflicting-user')]),
    localUserMessages: [{ ...acceptedLocal, openerTurnId: turnId }], nowMs: 300,
  }))
  assert.deepEqual(rows.map(({ user }) => user.id), ['conflicting-user', local.id])
  assert.deepEqual(rows.map(({ turn }) => turn.id), ['conflicting-turn', turnId])
  assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 2)
  assert.equal(new Set(rows.map(({ turn }) => renderKey(turn))).size, 2)
  assert.equal(displayId(rows[1]!.user), displayId(stages[0]!.user), 'the unconfirmed local display must remain stable')
})
for (const sameDisplay of [false, true]) {
  check(`an exact cached item binding wins over an unrelated local client claim (display conflict=${sameDisplay})`, () => {
    const lockedDisplay = sameDisplay ? displayId(stages[0]!.user) : 'previously-confirmed-display'
    const rows = users(projectConversation({
      threadRead: threadRead([authoritativeTurn('locked-turn', 'locked-client', 'locked-user')]),
      userMessageIdentities: [{ itemId: 'locked-user', turnId: 'locked-turn', clientMessageId: 'locked-client', displayMessageId: lockedDisplay }],
      localUserMessages: [{ ...acceptedLocal, openerTurnId: turnId }], nowMs: 300,
    }))
    assert.deepEqual(rows.map(({ user }) => user.id), ['locked-user', local.id])
    assert.equal(displayId(rows[0]!.user), lockedDisplay, 'an unrelated local cannot take away a locked item display')
    assert.equal(new Set(rows.map(({ turn }) => renderKey(turn))).size, 2)
  })
}
check('a weaker local client association cannot replace an exact cached display binding', () => {
  const row = single(projectConversation({
    threadRead: threadRead([authoritativeTurn()]),
    userMessageIdentities: [{ itemId: 'authoritative-user-a', turnId, clientMessageId: clientId, displayMessageId: 'locked-display' }],
    localUserMessages: [{ ...acceptedLocal, displayMessageId: 'conflicting-local-display' }], nowMs: 300,
  }))
  assert.equal(row.user.id, 'authoritative-user-a')
  assert.equal(displayId(row.user), 'locked-display')
})
check('multiple steer messages in one turn keep independent request and display identities', () => {
  const turn = authoritativeTurn()
  turn.items.push({ id: 'steer-user-b', type: 'userMessage', clientMessageId: 'steer-request-b', content: [{ type: 'text', text }] })
  turn.items.push({ id: 'steer-user-c', type: 'userMessage', clientMessageId: 'steer-request-c', content: [{ type: 'text', text }] })
  const projection = projectConversation({ threadRead: threadRead([turn]), nowMs: 300, localUserMessages: [
    { ...acceptedLocal, id: 'steer-local-b', clientMessageId: 'steer-request-b' },
    { ...acceptedLocal, id: 'steer-local-c', clientMessageId: 'steer-request-c' },
  ] })
  const rows = users(projection)
  assert.equal(rows.length, 3)
  assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 3)
  assert.deepEqual(rows.map(({ user }) => user.clientMessageId), [clientId, 'steer-request-b', 'steer-request-c'])
  assert.equal(renderKey(projection.turns[0]!), renderKey(single(projectConversation({ threadRead: threadRead([authoritativeTurn()]), nowMs: 100 })).turn),
    'a steer message must not take over the already mounted parent turn key')
})
check('new-thread binding does not change a still-local message display or parent render key', () => {
  const preview = single(projectConversation({ threadRead: null, localUserMessages: [local], nowMs: 100 }))
  const bound = single(projectConversation({ threadRead: threadRead(), localUserMessages: [local], nowMs: 150 }))
  assert.equal(displayId(bound.user), displayId(preview.user))
  assert.equal(renderKey(bound.turn), renderKey(preview.turn))
})
check('duplicate snapshot pages and replayed authoritative items keep one user identity', () => {
  const snapshot = threadRead([authoritativeTurn()])
  const event = { method: 'item/completed', params: { threadId, turnId, item: authoritativeTurn().items[0] }, atIso: '2026-09-10T00:00:00Z', seq: 1 }
  const projection = projectConversation({ threadRead: [snapshot, snapshot], notifications: [event, event], localUserMessages: [acceptedLocal], nowMs: 300 })
  assert.equal(users(projection).length, 1)
})

const explicitLocal: DisplayLocal = { ...local, displayMessageId: 'stable-explicit-display-a' }
const explicitAccepted: DisplayLocal = { ...explicitLocal, turnId, deliveryState: 'sent' }
const identity: UserIdentity = {
  itemId: 'authoritative-user-a', turnId, clientMessageId: clientId, displayMessageId: explicitLocal.displayMessageId!,
}
function unidentifiedTurn() {
  const turn = authoritativeTurn()
  delete (turn.items[0]! as { clientMessageId?: string }).clientMessageId
  return turn
}
check('default display identity is deterministic for the same client, not the local storage row ID', () => {
  const before = single(projectConversation({ threadRead: threadRead(), localUserMessages: [local], nowMs: 100 }))
  const recovered = single(projectConversation({ threadRead: threadRead(), localUserMessages: [{ ...local, id: 'recovered-local-row' }], nowMs: 200 }))
  assert.equal(displayId(recovered.user), displayId(before.user))
  assert.equal(renderKey(recovered.turn), renderKey(before.turn))
})
check('explicit display identity wins and identity-only cache preserves it after local cleanup', () => {
  const rows = [
    projectConversation({ threadRead: threadRead(), localUserMessages: [explicitLocal], nowMs: 100 }),
    projectConversation({ threadRead: threadRead(), localUserMessages: [explicitAccepted], nowMs: 200 }),
    projectConversation({ threadRead: threadRead([authoritativeTurn()]), localUserMessages: [explicitAccepted], nowMs: 300 }),
    projectConversation({ threadRead: threadRead([authoritativeTurn()]), userMessageIdentities: [identity], nowMs: 400 }),
  ].map(single)
  assert.deepEqual(rows.map(({ user }) => displayId(user)), Array(4).fill(explicitLocal.displayMessageId))
  assert.deepEqual(rows.map(({ turn }) => renderKey(turn)), Array(4).fill(renderKey(rows[0]!.turn)))
  assert.deepEqual(rows.slice(1).map(({ turn }) => turn.id), Array(3).fill(turnId))
  assert.deepEqual(rows.slice(2).map(({ user }) => user.id), Array(2).fill(identity.itemId))
})
check('native client identity binds the user and exact cache retains its display after clientless refresh', () => {
  const preview = single(projectConversation({ threadRead: null, localUserMessages: [explicitLocal], nowMs: 100 }))
  const confirmed = single(projectConversation({ threadRead: threadRead([nativeTurn()]), localUserMessages: [explicitAccepted], nowMs: 300 }))
  const cleaned = single(projectConversation({ threadRead: threadRead([unidentifiedTurn()]), userMessageIdentities: [identity], nowMs: 400 }))
  assert.deepEqual([displayId(confirmed.user), displayId(cleaned.user)], Array(2).fill(explicitLocal.displayMessageId))
  assert.deepEqual([renderKey(confirmed.turn), renderKey(cleaned.turn)], Array(2).fill(renderKey(preview.turn)))
  assert.equal(confirmed.user.id, identity.itemId)
  assert.equal(cleaned.user.clientMessageId, clientId, 'the exact cached item retains its canonical request identity')
})
check('ordinary turn binding with stale opener metadata cannot pair an unidentified user', () => {
  const wrongProof = { ...explicitAccepted, openerTurnId: turnId }
  const projection = projectConversation({ threadRead: threadRead([unidentifiedTurn()]), localUserMessages: [wrongProof], nowMs: 300 })
  assert.equal(users(projection).length, 2)
  assert.equal(users(projection).filter(({ user }) => displayId(user) === explicitLocal.displayMessageId).length, 1)
})
check('returned turn identity never overrides an explicitly conflicting authoritative client identity', () => {
  const provenLocal = { ...explicitAccepted, openerTurnId: turnId }
  const projection = projectConversation({ threadRead: threadRead([authoritativeTurn(turnId, 'other-client')]), localUserMessages: [provenLocal], nowMs: 300 })
  assert.equal(users(projection).length, 2)
  assert.equal(new Set(users(projection).map(({ user }) => displayId(user))).size, 2)
})
check('partial same-turn history cannot claim an unidentified user after another client message', () => {
  const turn = authoritativeTurn(turnId, 'other-client', 'actual-opener')
  const later = { ...unidentifiedTurn().items[0]!, id: 'later-unidentified-user' }
  turn.items.push(later)
  const provenLocal = { ...explicitAccepted, openerTurnId: turnId }
  const rows = users(projectConversation({ threadRead: threadRead([turn]), localUserMessages: [provenLocal], nowMs: 300 }))
  assert.equal(rows.length, 3, 'a returned turn ID cannot identify either an unrelated or unidentified user')
  assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 3)
})
check('cached display identity requires both the exact item and the exact turn', () => {
  for (const stale of [{ ...identity, itemId: 'other-item' }, { ...identity, turnId: 'other-turn' }]) {
    const row = single(projectConversation({ threadRead: threadRead([authoritativeTurn()]), userMessageIdentities: [stale], nowMs: 400 }))
    assert.notEqual(displayId(row.user), identity.displayMessageId)
  }
})
check('cached display identity cannot override a conflicting authoritative client', () => {
  const row = single(projectConversation({ threadRead: threadRead([authoritativeTurn(turnId, 'other-client')]), userMessageIdentities: [identity], nowMs: 400 }))
  assert.notEqual(displayId(row.user), identity.displayMessageId)
  assert.equal(row.user.clientMessageId, 'other-client')
})
check('identity binding leaves authoritative source IDs and content unchanged and does not mutate input', () => {
  const snapshot = threadRead([authoritativeTurn(turnId, clientId, identity.itemId, 'Authoritative content wins')])
  const before = structuredClone(snapshot)
  const identities = [structuredClone(identity)]
  const row = single(projectConversation({ threadRead: snapshot, localUserMessages: [explicitAccepted], userMessageIdentities: identities, nowMs: 300 }))
  assert.equal(row.user.id, identity.itemId)
  assert.equal(row.turn.id, turnId)
  assert.equal(row.user.text, 'Authoritative content wins')
  assert.equal(displayId(row.user), identity.displayMessageId)
  assert.deepEqual(snapshot, before)
  assert.deepEqual(identities, [identity])
})

type IdentityMeta = OptimisticUserMessageMeta
type IdentifiedAcknowledgement = AcknowledgedUserMessage
function optimisticDelivery(id: string, requestId: string, boundTurnId?: string) {
  const message: OptimisticUserMessage = { id: `optimistic-user:${id}`, role: 'user', text, deliveryState: 'sent' }
  const meta: IdentityMeta = {
    kind: 'optimisticUserMessage', signature: userMessageSignature(message), clientMessageId: requestId,
    baselineMatchCount: 0, baselineMessageCount: 0, baselineTailMessageId: '', createdAtMs: 100,
    ...(boundTurnId ? { authoritativeTurnId: boundTurnId } : {}),
  }
  return { message, meta }
}
function acknowledgedDelivery(requestId?: string): IdentifiedAcknowledgement {
  return { id: 'authoritative-user-a', role: 'user', messageType: 'userMessage', text, turnId,
    ...(requestId ? { clientMessageId: requestId } : {}) }
}
check('upstream filtering acknowledges the matching request, not the first equal-text local message', () => {
  const first = optimisticDelivery('display-b', 'immutable-request-b')
  const accepted = optimisticDelivery('display-a', clientId)
  const visible = filterVisibleOptimisticUserMessages(
    [acknowledgedDelivery(clientId)], [first.message, accepted.message],
    new Map([[first.message.id, first.meta], [accepted.message.id, accepted.meta]]),
  )
  assert.deepEqual(visible.map((message) => message.id), [first.message.id], 'the other request must survive regardless of local ordering')
})
check('upstream filtering does not consume a local request because another client opened its bound turn', () => {
  const pending = optimisticDelivery('bound-steer', 'steer-request-b', turnId)
  const visible = filterVisibleOptimisticUserMessages(
    [acknowledgedDelivery(clientId)], [pending.message], new Map([[pending.message.id, pending.meta]]),
  )
  assert.deepEqual(visible.map((message) => message.id), [pending.message.id], 'sharing a turn is not request acknowledgement')
})
check('upstream filtering requires an exact identity instead of guessing from equal text without a server client ID', () => {
  const pending = optimisticDelivery('unconfirmed', clientId)
  const visible = filterVisibleOptimisticUserMessages(
    [acknowledgedDelivery()], [pending.message], new Map([[pending.message.id, pending.meta]]),
  )
  assert.deepEqual(visible.map((message) => message.id), [pending.message.id], 'an unidentified authoritative item cannot confirm this modern request')
})
check('upstream serialized modern identity metadata also prevents equal-text guesses', () => {
  const pending = optimisticDelivery('serialized', clientId)
  pending.message.rawPayload = JSON.stringify({ ...pending.meta, displayMessageId: 'serialized-display' })
  const visible = filterVisibleOptimisticUserMessages([acknowledgedDelivery()], [pending.message])
  assert.deepEqual(visible.map((message) => message.id), [pending.message.id], 'reloading metadata must not revert to text matching')
})
check('upstream ordinary authoritative turn binding is not user-message proof', () => {
  const pending = optimisticDelivery('ordinary-bound', clientId, turnId)
  const visible = filterVisibleOptimisticUserMessages([acknowledgedDelivery()], [pending.message], new Map([[pending.message.id, pending.meta]]))
  assert.deepEqual(visible.map((message) => message.id), [pending.message.id])
})
check('upstream ignores stale opener metadata and accepts only exact client identity', () => {
  const pending = optimisticDelivery('proven-opener', clientId, turnId)
  Object.assign(pending.meta, { openerTurnId: turnId })
  pending.meta.displayMessageId = 'proven-display'
  assert.deepEqual(filterVisibleOptimisticUserMessages([acknowledgedDelivery()], [pending.message], new Map([[pending.message.id, pending.meta]])), [pending.message])
  assert.deepEqual(filterVisibleOptimisticUserMessages([acknowledgedDelivery('other-client')], [pending.message], new Map([[pending.message.id, pending.meta]])), [pending.message])
  Object.assign(pending.meta, { openerTurnId: 'different-proven-turn' })
  assert.deepEqual(filterVisibleOptimisticUserMessages([acknowledgedDelivery()], [pending.message], new Map([[pending.message.id, pending.meta]])), [pending.message])
  assert.deepEqual(filterVisibleOptimisticUserMessages([acknowledgedDelivery(clientId)], [pending.message], new Map([[pending.message.id, pending.meta]])), [])
})

check('metadata reconciliation captures explicit identity before the matching optimistic row is cleaned up', () => {
  const pending = optimisticDelivery('cached-explicit', clientId, turnId)
  pending.meta.displayMessageId = identity.displayMessageId
  const incoming = [acknowledgedDelivery(clientId)]
  const original = structuredClone(incoming)
  const metadata = new Map([[pending.message.id, pending.meta]])
  const saved = reconcileUserDisplayIdentities([], incoming, [pending.message], metadata)
  assert.equal(saved[0]!.displayMessageId, identity.displayMessageId)
  assert.equal(saved[0]!.clientMessageId, clientId)
  assert.deepEqual(filterVisibleOptimisticUserMessages(saved, [pending.message], metadata), [])
  assert.deepEqual(incoming, original, 'caching identity must not mutate the authoritative input')
})
check('metadata survives JSON reload and a later exact item snapshot without a client ID', () => {
  const previous = [{ ...acknowledgedDelivery(clientId), displayMessageId: identity.displayMessageId }]
  const reloaded = JSON.parse(JSON.stringify(previous)) as AcknowledgedUserMessage[]
  const incoming = [{ ...acknowledgedDelivery(), text: 'A fresh authoritative snapshot' }]
  const saved = reconcileUserDisplayIdentities(reloaded, incoming, [], new Map())
  assert.equal(saved[0]!.clientMessageId, clientId)
  assert.equal(saved[0]!.displayMessageId, identity.displayMessageId)
  assert.equal(saved[0]!.text, incoming[0]!.text)
  assert.equal(saved[0]!.id, identity.itemId)
  assert.equal(saved[0]!.turnId, turnId)
})
check('metadata cannot transfer a remembered display binding across a turn, item, or client conflict', () => {
  const previous = [{ ...acknowledgedDelivery(clientId), displayMessageId: identity.displayMessageId }]
  for (const incoming of [
    { ...acknowledgedDelivery(), id: 'different-authoritative-item' },
    { ...acknowledgedDelivery(), turnId: 'different-authoritative-turn' },
    acknowledgedDelivery('conflicting-client'),
  ]) {
    const saved = reconcileUserDisplayIdentities(previous, [incoming], [], new Map())
    assert.equal(saved[0]!.displayMessageId, undefined)
    assert.equal(saved[0]!.clientMessageId, incoming.clientMessageId)
  }
})
check('metadata keeps a compatible exact cached display over a weaker leftover local claim', () => {
  const previous = [{ ...acknowledgedDelivery(clientId), displayMessageId: 'locked-cache-display' }]
  const pending = optimisticDelivery('cache-leftover', clientId, turnId)
  pending.meta.displayMessageId = 'weaker-leftover-display'
  for (const incoming of [acknowledgedDelivery(clientId), acknowledgedDelivery()]) {
    const saved = reconcileUserDisplayIdentities(previous, [incoming], [pending.message], new Map([[pending.message.id, pending.meta]]))
    assert.equal(saved[0]!.displayMessageId, 'locked-cache-display')
    assert.equal(saved[0]!.clientMessageId, clientId)
  }
})
check('metadata does not lock a previous display when the authoritative client explicitly conflicts', () => {
  const previous = [{ ...acknowledgedDelivery(clientId), displayMessageId: 'incompatible-cache-display' }]
  const pending = optimisticDelivery('new-client-local', 'new-authoritative-client', turnId)
  pending.meta.displayMessageId = 'new-client-display'
  const saved = reconcileUserDisplayIdentities(previous, [acknowledgedDelivery('new-authoritative-client')],
    [pending.message], new Map([[pending.message.id, pending.meta]]))
  assert.equal(saved[0]!.displayMessageId, 'new-client-display')
  assert.equal(saved[0]!.clientMessageId, 'new-authoritative-client')
})
check('an exact client match cannot take a display already locked to a different authoritative item', () => {
  const secondTurnId = 'second-proven-turn'
  const lockedDisplay = 'display-locked-to-first-item'
  const first = acknowledgedDelivery(clientId)
  const secondClient = 'second-independent-client'
  const second = { ...acknowledgedDelivery(secondClient), id: 'second-authoritative-user', turnId: secondTurnId }
  const previous = [{ ...first, displayMessageId: lockedDisplay }]
  const pending = optimisticDelivery('conflicting-client-display', secondClient, secondTurnId)
  pending.meta.displayMessageId = lockedDisplay
  const cached = reconcileUserDisplayIdentities(previous, [first, second], [pending.message], new Map([[pending.message.id, pending.meta]]))
  const snapshot = threadRead([authoritativeTurn(), authoritativeTurn(secondTurnId, secondClient, second.id)])
  const localClaim = { ...acceptedLocal, clientMessageId: secondClient, turnId: secondTurnId, displayMessageId: lockedDisplay }
  for (const bindings of [previous, cached]) {
    const rows = users(projectConversation({ threadRead: snapshot, localUserMessages: [localClaim], nowMs: 300,
      userMessageIdentities: bindings.map((message) => ({ itemId: message.id, turnId: message.turnId!,
        clientMessageId: message.clientMessageId, displayMessageId: message.displayMessageId! })),
    }))
    assert.deepEqual(rows.map(({ user }) => user.id), [first.id, second.id])
    assert.equal(displayId(rows[0]!.user), lockedDisplay)
    assert.equal(new Set(rows.map(({ user }) => displayId(user))).size, 2)
    assert.equal(new Set(rows.map(({ turn }) => renderKey(turn))).size, 2)
  }
})
check('metadata reconciliation leaves equal-text independent modern requests visible', () => {
  const pending = optimisticDelivery('not-accepted', 'other-client', turnId)
  pending.meta.displayMessageId = 'unaccepted-display'
  const metadata = new Map([[pending.message.id, pending.meta]])
  for (const incoming of [acknowledgedDelivery(clientId), acknowledgedDelivery()]) {
    const saved = reconcileUserDisplayIdentities([], [incoming], [pending.message], metadata)
    assert.equal(saved[0]!.displayMessageId, undefined)
    assert.deepEqual(filterVisibleOptimisticUserMessages(saved, [pending.message], metadata), [pending.message])
  }
})
check('metadata remembers an exact client user without claiming a later unidentified same-turn user', () => {
  const pending = optimisticDelivery('cache-opener', clientId, turnId)
  pending.meta.displayMessageId = identity.displayMessageId
  const incoming = [acknowledgedDelivery(clientId), { ...acknowledgedDelivery(), id: 'later-user' }]
  const saved = reconcileUserDisplayIdentities([], incoming, [pending.message], new Map([[pending.message.id, pending.meta]]))
  assert.equal(saved[0]!.displayMessageId, identity.displayMessageId)
  assert.equal(saved[0]!.clientMessageId, clientId)
  assert.equal(saved[1]!.displayMessageId, undefined)
  assert.equal(saved[1]!.clientMessageId, undefined)
  const reloaded = reconcileUserDisplayIdentities(JSON.parse(JSON.stringify(saved)), incoming, [], new Map())
  assert.deepEqual(reloaded, saved)
})
check('cache merge recognizes changed client and display metadata on an otherwise unchanged authoritative item', () => {
  const previous = [{ ...acknowledgedDelivery(), displayMessageId: 'previous-display' }]
  for (const incoming of [
    { ...acknowledgedDelivery(clientId), displayMessageId: 'previous-display' },
    { ...acknowledgedDelivery(), displayMessageId: identity.displayMessageId },
    { ...acknowledgedDelivery(clientId), displayMessageId: identity.displayMessageId },
  ]) {
    const merged = mergeCachedThreadMessages(previous, [incoming])
    assert.equal(merged[0]!.clientMessageId, incoming.clientMessageId)
    assert.equal(merged[0]!.displayMessageId, incoming.displayMessageId)
  }
})
check('cache merge preserves same-turn equal-text messages from different modern clients', () => {
  const previous = [acknowledgedDelivery(clientId)]
  const incoming = [{ ...acknowledgedDelivery('other-client'), id: 'independent-authoritative-user' }]
  const merged = mergeCachedThreadMessages(previous, incoming, { preserveMissing: true })
  assert.deepEqual(merged.map((message) => message.clientMessageId), [clientId, 'other-client'])
})
check('outbox JSON codec retains display identity separately from a replaced execution client ID', () => {
  const nowMs = 1_000_000
  const entry: MessageOutboxEntry = {
    clientMessageId: 'replacement-execution-client', displayMessageId: identity.displayMessageId,
    threadId, cwd: 'C:/fixture/workspace', text, imageUrls: [], skills: [], fileAttachments: [],
    modelId: '', reasoningEffort: '', speedMode: 'standard', collaborationMode: 'execute',
    state: 'confirming', createdAtMs: nowMs, updatedAtMs: nowMs,
  }
  const reloaded = parseMessageOutboxState(serializeMessageOutboxState([entry], [], nowMs), nowMs)
  assert.equal(reloaded.entries.length, 1)
  assert.equal(reloaded.entries[0]!.clientMessageId, entry.clientMessageId)
  assert.equal(reloaded.entries[0]!.displayMessageId, identity.displayMessageId)
})

// The state fixture only substitutes external I/O. Recovery, binding, cache
// persistence, projection and outbox cleanup execute the production functions.
async function checkCachedGatewayIdentity(): Promise<void> {
  const name = 'cached gateway snapshots preserve historical turn identity and cannot consume a new request'
  checks += 1
  const originalFetch = globalThis.fetch
  const stateThreadId = 'cached-gateway-display-race'
  const pending = optimisticDelivery('gateway-pending', 'gateway-new-client', 'gateway-new-turn')
  pending.meta.displayMessageId = 'gateway-new-display'
  const meta = new Map([[pending.message.id, pending.meta]])
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `/codex-api/state/thread/${stateThreadId}?preferCachedMessages=1`)
    return Response.json({ data: {
      messageState: 'cached', executionState: 'running', inProgress: true, activeTurnId: 'gateway-new-turn',
      threadRead: { thread: { id: stateThreadId, turns: [{ id: 'gateway-old-turn', status: 'completed', items: [{
        id: 'gateway-old-user', type: 'userMessage', content: [{ type: 'text', text: 'Different historical intent' }],
      }] }] } },
    } })
  }
  try {
    const snapshot = await getThreadRuntimeSnapshot(stateThreadId, { preferCachedMessages: true, cachedSnapshotMaxAgeMs: 0 })
    const cached = reconcileUserDisplayIdentities([], snapshot.acknowledgedUserMessages, [pending.message], meta)
    const remaining = filterVisibleOptimisticUserMessages(cached, [pending.message], meta)
    assert.deepEqual({
      activeTurnId: snapshot.activeTurnId,
      historicalTurnId: cached[0]?.turnId,
      historicalClient: cached[0]?.clientMessageId,
      historicalDisplay: cached[0]?.displayMessageId,
      remainingLocalIds: remaining.map((message) => message.id),
    }, {
      activeTurnId: 'gateway-new-turn', historicalTurnId: 'gateway-old-turn',
      historicalClient: undefined, historicalDisplay: undefined, remainingLocalIds: [pending.message.id],
    }, 'runtime activity is not delivery evidence for a historical user item')
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    globalThis.fetch = originalFetch
  }
}
await checkCachedGatewayIdentity()

type DesktopState = ReturnType<typeof useDesktopState>
async function flushState(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await nextEventLoop()
}
async function checkLookupIdentity(newThread: boolean, hasNativeIdentity: boolean, hasLegacyOpener = false): Promise<void> {
  const name = `public ${newThread ? 'new' : 'existing'}-thread state ${hasNativeIdentity ? 'retains native client identity through GET recovery, cache cleanup and reload' : `keeps an unidentified user unconfirmed after GET ${hasLegacyOpener ? 'with stale opener metadata' : 'turnId'}`}`
  checks += 1
  const originals = Object.fromEntries(['window', 'fetch', 'WebSocket'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const realDateNow = Date.now
  let nowMs = realDateNow() + (newThread ? 180_000 : hasNativeIdentity ? 120_000 : 60_000)
  Date.now = () => nowMs
  const stateThreadId = `public-display-${newThread}-${hasNativeIdentity}-${hasLegacyOpener}`
  const stateTurnId = `${stateThreadId}-turn`
  const stateItemId = `${stateThreadId}-user`
  const storage = new Map<string, string>()
  const writes: Array<{ key: string; value: string }> = []
  const timers = new Map<number, () => void>()
  let nextTimerId = 0
  let snapshotHasMessage = false
  let sentClientId = ''
  let sendCount = 0
  let lookupCount = 0
  const unexpected: string[] = []
  class FixtureSocket { readyState = 1; close() { this.readyState = 3 } }
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  const read = () => ({ thread: { id: stateThreadId, turns: snapshotHasMessage ? [{
    id: stateTurnId, status: 'inProgress', items: [{ id: stateItemId, type: 'userMessage',
      ...(hasNativeIdentity ? { clientId: sentClientId } : {}), content: [{ type: 'text', text }] }],
  }] : [] } })
  const snapshot = () => ({
    threadId: stateThreadId, threadRead: read(), executionState: snapshotHasMessage ? 'running' : 'idle', messageState: 'fresh',
    inProgress: snapshotHasMessage, canStop: snapshotHasMessage, stale: false, lastEventSeq: 0,
    activeTurnId: snapshotHasMessage ? stateTurnId : '', pendingServerRequests: [], updatedAtIso: new Date(nowMs).toISOString(),
  })
  Object.assign(globalThis, {
    WebSocket: FixtureSocket,
    window: {
      performance: globalThis.performance,
      localStorage: {
        get length() { return storage.size }, key: (index: number) => [...storage.keys()][index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { writes.push({ key, value }); storage.set(key, value) },
        removeItem: (key: string) => storage.delete(key),
      },
      setTimeout: (callback: () => void) => { const id = ++nextTimerId; timers.set(id, callback); return id },
      clearTimeout: (id: number) => timers.delete(id), setInterval: () => ++nextTimerId, clearInterval: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
      location: { protocol: 'http:', host: 'fixture.invalid', origin: 'http://fixture.invalid', pathname: '/', search: '', hash: '' },
    },
  })
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url === '/codex-api/runtime/send') {
      sendCount += 1
      sentClientId = JSON.parse(String(init?.body)).clientMessageId
      return new Response('<html>Accepted but response lost</html>', { status: 502 })
    }
    if (url.startsWith('/codex-api/runtime/request?')) {
      lookupCount += 1
      assert.equal(new URL(url, 'http://fixture.invalid').searchParams.get('clientMessageId'), sentClientId)
      return respond({ data: { requestId: `${stateThreadId}-request`, clientMessageId: sentClientId,
        threadId: stateThreadId, turnId: stateTurnId, status: 'running', ...(hasLegacyOpener ? { openerTurnId: stateTurnId } : {}) } })
    }
    if (url.startsWith('/codex-api/state/thread/')) return respond({ data: snapshot() })
    if (url.endsWith('/reconcile')) return respond({ data: { snapshot: snapshot() } })
    if (url.startsWith('/codex-api/runtime/thread/')) return respond({ data: snapshot() })
    if (url.startsWith('/codex-api/runtime/queue')) return respond({ data: [] })
    if (url.startsWith('/codex-api/events/replay')) return respond({ data: { notifications: [], latestSeq: 0, oldestSeq: 0, streamId: '' } })
    if (url === '/codex-api/rpc') {
      const { method } = JSON.parse(String(init?.body))
      if (method === 'thread/list') return respond({ result: { data: [{ id: stateThreadId, cwd: 'C:/fixture/workspace', preview: text, createdAt: 100, updatedAt: 100 }], nextCursor: null } })
      if (method === 'thread/read') return respond({ result: read() })
      if (method === 'thread/goal/get') return respond({ result: { goal: null } })
      if (method === 'generate-thread-title') return respond({ result: { title: '' } })
      unexpected.push(`RPC ${method}`)
      throw new Error(`Unexpected fixture RPC ${method}`)
    }
    if (url === '/codex-api/workspace-roots-state') return respond({ data: { roots: [], activeRoots: [], labels: {} } })
    if (url === '/codex-api/thread-titles') return respond({ data: { titles: {}, manualTitleIds: [] } })
    if (url === '/codex-api/server-requests/pending') return respond({ data: [] })
    if (url.startsWith('/codex-api/thread-token-usage')) return respond({ data: { tokenUsage: null } })
    unexpected.push(url)
    throw new Error(`Unexpected fixture request ${url}`)
  }
  let scope = effectScope()
  let state: DesktopState = scope.run(() => useDesktopState())!
  const displayHistory: string[][] = []
  const failedHistory: boolean[] = []
  try {
    state.setWorktreeGitAutomationEnabled(false)
    if (!newThread) await state.selectThread(stateThreadId)
    state.startPolling()
    await flushState()
    scope.run(() => {
      watch(() => users(state.selectedConversationProjection.value).map(({ user }) => displayId(user)),
        (ids) => displayHistory.push(ids), { flush: 'post' })
      watch(() => users(state.selectedConversationProjection.value).some(({ user }) => user.deliveryState === 'failed'),
        (failed) => failedHistory.push(failed), { flush: 'sync' })
    })
    if (newThread) await state.sendMessageToNewThread(text, 'C:/fixture/workspace')
    else await state.sendMessageToSelectedThread(text)
    await flushState()
    assert.equal(sendCount, 1)
    assert.equal(lookupCount, 1, 'the actual GET recovery path must have executed')
    assert.equal(state.selectedThreadId.value, stateThreadId)
    const localRow = single(state.selectedConversationProjection.value)
    const stableDisplay = displayId(localRow.user)
    assert.equal(localRow.turn.id, stateTurnId)
    assert.equal(loadMessageOutboxState().entries.length, 1, 'ACK without the user item does not yet clean the outbox')
    snapshotHasMessage = true
    nowMs += 60_000
    await state.refreshSelectedThreadContent()
    await flushState()
    if (hasNativeIdentity) {
      const confirmed = single(state.selectedConversationProjection.value)
      assert.equal(confirmed.user.id, stateItemId)
      assert.equal(displayId(confirmed.user), stableDisplay)
      assert.equal(confirmed.user.clientMessageId, sentClientId)
      assert.equal(renderKey(confirmed.turn), renderKey(localRow.turn))
      assert.equal(loadMessageOutboxState().entries.length, 0)
      const cacheIndex = writes.findIndex(({ key, value }) => key === 'codex-web-local.thread-message-cache.v1'
        && value.includes(stableDisplay) && value.includes(stateItemId))
      const removalIndex = writes.findIndex(({ key }) => key.startsWith(`${MESSAGE_OUTBOX_STORAGE_KEY}.removal.`))
      assert.ok(cacheIndex >= 0 && removalIndex > cacheIndex, 'durable identity metadata must precede outbox removal')
      const firstVisible = displayHistory.findIndex((ids) => ids.length > 0)
      assert.ok(firstVisible >= 0 && displayHistory.slice(firstVisible).every((ids) => ids.length === 1 && ids[0] === stableDisplay),
        `render-batch identity changed: ${JSON.stringify(displayHistory)}`)
      state.stopPolling(); scope.stop(); await flushState()
      nowMs += 60_000
      scope = effectScope()
      state = scope.run(() => useDesktopState())!
      state.setWorktreeGitAutomationEnabled(false)
      await state.selectThread(stateThreadId)
      await flushState()
      const reloaded = single(state.selectedConversationProjection.value)
      assert.equal(reloaded.user.id, stateItemId)
      assert.equal(displayId(reloaded.user), stableDisplay, 'an actual fresh state instance must recover the cached identity')
      assert.equal(reloaded.user.clientMessageId, sentClientId)
    } else {
      assert.equal(users(state.selectedConversationProjection.value).length, 2, 'ordinary turnId cannot acknowledge an unidentified item')
      assert.equal(loadMessageOutboxState().entries.length, 1)
    }
    assert.ok(!failedHistory.includes(true))
    assert.deepEqual(unexpected, [])
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.stopPolling(); scope.stop(); await flushState()
    Date.now = realDateNow
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}
await checkLookupIdentity(false, true)
await checkLookupIdentity(false, false)
await checkLookupIdentity(false, false, true)
await checkLookupIdentity(true, true)
await checkLookupIdentity(true, false, true)

console.log(`${checks - failures.length}/${checks} display-identity checks passed. Pure projection keys do not prove DOM object retention.`)
if (failures.length) process.exitCode = 1
