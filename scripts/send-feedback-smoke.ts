import assert from 'node:assert/strict'
import { projectConversation } from '../src/conversation-transcript/index.js'
import type {
  ConversationLocalUserMessage,
  ConversationProjection,
  ConversationProjectionInput,
} from '../src/conversation-transcript/index.js'
import { RuntimeStateStore } from '../src/server/runtimeState.js'
import {
  readItemIdFromPayload,
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from '../src/server/appServerPayloadIds.js'
import { readThreadInProgressFromThreadReadPayload } from '../src/server/appServerThreadPayload.js'

const originMs = Date.parse('2026-09-09T00:00:00.000Z')
const at = (offsetMs: number): string => new Date(originMs + offsetMs).toISOString()
const threadId = 'thread-send-feedback'
const messageId = 'local-next-message'
const previousThreadRead = {
  thread: {
    id: threadId,
    turns: [{
      id: 'turn-previous',
      status: 'completed',
      startedAt: at(0),
      completedAt: at(1_000),
      items: [{
        type: 'agentMessage',
        id: 'previous-final',
        phase: 'final_answer',
        text: 'Previous turn is complete.',
      }],
    }],
  },
}
const previousRuntime = {
  executionState: 'idle',
  lastStartedAtIso: at(0),
  lastCompletedAtIso: at(1_000),
  messageState: 'fresh' as const,
}

function localMessage(
  deliveryState: ConversationLocalUserMessage['deliveryState'],
  turnId?: string,
): ConversationLocalUserMessage {
  return {
    id: messageId,
    clientMessageId: 'client-next-message',
    text: 'Start a new task.',
    createdAtMs: originMs + 2_000,
    deliveryState,
    ...(turnId ? { turnId } : {}),
  }
}

function project(overrides: Partial<ConversationProjectionInput> = {}): ConversationProjection {
  return projectConversation({
    threadRead: previousThreadRead,
    runtime: previousRuntime,
    localUserMessages: [localMessage('sending')],
    nowMs: originMs + 2_500,
    ...overrides,
  })
}

function assertSubmissionIsVisible(projection: ConversationProjection): void {
  const latest = projection.turns.at(-1)
  assert.ok(latest, 'a submitted message must have a visible projected turn')
  assert.equal(latest.state, 'submitting', 'submission is neither queue admission nor confirmed execution')
  assert.equal(latest.finalStatus, 'pending', 'an unstarted submission has no terminal outcome yet')
  assert.equal(latest.completedAtMs, null, 'the previous generation must not complete this submission')
  assert.notEqual(latest.timingStatus, 'running', 'submission latency must not masquerade as execution time')
  assert.deepEqual(latest.blocks.filter((block) => block.kind === 'user').map((block) => block.id), [messageId])
}

const failures: string[] = []
function check(name: string, run: () => void): void {
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

check('idle thread: immediate local submission stays visible without queue or fake completion', () => {
  const result = project()
  assert.equal(result.turns[0]?.state, 'completed', 'the old turn keeps its real terminal state')
  assertSubmissionIsVisible(result)
})

for (const deliveryState of ['sending', 'confirmationPending', 'sent'] as const) {
  check(`${deliveryState}: transport feedback does not prove the agent is running`, () => {
    const result = project({ runtime: null, localUserMessages: [localMessage(deliveryState)] })
    assertSubmissionIsVisible(result)
    assert.equal(result.turns.at(-1)?.opener?.deliveryState, deliveryState)
  })
}

check('starting without an authoritative turn id remains a visible submission', () => {
  assertSubmissionIsVisible(project({
    runtime: { ...previousRuntime, executionState: 'starting' },
    localUserMessages: [localMessage('sent')],
  }))
})

for (const executionState of ['idle', 'completed'] as const) {
  check(`stale ${executionState}: an older terminal snapshot cannot settle the next message`, () => {
    assertSubmissionIsVisible(project({
      runtime: { ...previousRuntime, executionState },
      localUserMessages: [localMessage('confirmationPending')],
    }))
  })
}

check('thread/started with idle status creates no running turn', () => {
  const result = projectConversation({
    threadRead: { thread: { id: threadId, turns: [] } },
    notifications: [{
      method: 'thread/started',
      params: { thread: { id: threadId, status: { type: 'idle' }, turns: [] } },
      atIso: at(0),
      seq: 1,
    }],
    nowMs: originMs + 100,
  })
  assert.equal(result.threadId, threadId)
  assert.equal(result.turns.length, 0, 'creating an empty thread does not start an execution turn')
})

check('RuntimeStateStore: thread creation stays idle until a real turn starts', () => {
  const store = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload,
    getErrorMessage: (_payload, fallback) => fallback,
  }, { staleMs: Number.MAX_SAFE_INTEGER })
  store.observeEvent({
    method: 'thread/started',
    params: { thread: { id: threadId, status: { type: 'idle' }, turns: [] } },
    atIso: at(0),
    seq: 1,
  })
  const idle = store.snapshot(threadId)
  assert.equal(idle.executionState, 'idle', 'thread initialization is not running evidence')
  assert.equal(idle.inProgress, false)
  assert.equal(idle.canStop, false)
  assert.equal(idle.activeTurnId, '')
  assert.equal(idle.lastStartedAtIso, null, 'thread creation must not start the execution clock')
  assert.equal(store.getActiveThreadCount(), 0)

  store.observeEvent({
    method: 'turn/started',
    params: { threadId, turn: { id: 'turn-next', status: 'inProgress' } },
    atIso: at(2_200),
    seq: 2,
  })
  const running = store.snapshot(threadId)
  assert.equal(running.executionState, 'running')
  assert.equal(running.inProgress, true)
  assert.equal(running.activeTurnId, 'turn-next')
  assert.equal(running.lastStartedAtIso, at(2_200))
})

check('authoritative turn/started binds the existing local message once and starts execution', () => {
  const notification = {
    method: 'turn/started',
    params: { threadId, turn: { id: 'turn-next', status: 'inProgress', startedAt: at(2_200) } },
    atIso: at(2_200),
    seq: 20,
  }
  const result = project({
    runtime: {
      executionState: 'running',
      activeTurnId: 'turn-next',
      lastStartedAtIso: at(2_200),
      messageState: 'fresh',
    },
    // The caller binds the optimistic message after the server identifies its turn.
    localUserMessages: [localMessage('sent', 'turn-next')],
    notifications: [notification, notification],
  })
  const latest = result.turns.at(-1)
  assert.equal(result.turns.length, 2, 'a replay must not create another synthetic user turn')
  assert.equal(latest?.id, 'turn-next')
  assert.equal(latest?.state, 'running')
  assert.equal(latest?.finalStatus, 'pending')
  assert.equal(latest?.completedAtMs, null)
  assert.equal(latest?.timingStatus, 'running')
  assert.deepEqual(result.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user').map((block) => block.id)), [messageId])
})

check('new turn/started is not settled by the previous runtime snapshot', () => {
  const result = project({
    notifications: [{ method: 'turn/started', params: { threadId, turn: { id: 'turn-next', startedAt: at(2_200) } }, atIso: at(2_200), seq: 20 }],
    localUserMessages: [localMessage('sent', 'turn-next')],
  })
  assert.equal(result.turns.at(-1)?.state, 'running')
  assert.equal(result.turns.at(-1)?.completedAtMs, null)
})

check('a failed local send never inherits previous execution time', () => {
  const latest = project({ localUserMessages: [localMessage('failed')] }).turns.at(-1)
  assert.equal(latest?.state, 'failed')
  assert.equal(latest?.startedAtMs, null)
  assert.equal(latest?.completedAtMs, null)
  assert.equal(latest?.activeElapsedMs, null)
})

check('a completed notification wins over an older running snapshot', () => {
  const latest = project({
    runtime: { executionState: 'running', activeTurnId: 'turn-next', lastStartedAtIso: at(2_200) },
    localUserMessages: [localMessage('sent', 'turn-next')],
    notifications: [
      { method: 'turn/started', params: { threadId, turn: { id: 'turn-next', startedAt: at(2_200) } }, atIso: at(2_200), seq: 20 },
      { method: 'turn/completed', params: { threadId, turn: { id: 'turn-next', status: 'completed', completedAt: at(3_000) } }, atIso: at(3_000), seq: 21 },
    ],
  }).turns.at(-1)
  assert.equal(latest?.state, 'completed')
  assert.equal(latest?.timingStatus, 'complete')
})

check('an old active runtime cannot revive the previous turn while the next turn is running', () => {
  const result = project({
    runtime: { executionState: 'running', activeTurnId: 'turn-previous', lastStartedAtIso: at(0) },
    localUserMessages: [localMessage('sent', 'turn-next')],
    notifications: [{ method: 'turn/started', params: { threadId, turn: { id: 'turn-next', startedAt: at(2_200) } }, atIso: at(2_200), seq: 20 }],
  })
  assert.equal(result.turns[0]?.state, 'completed')
  assert.equal(result.turns[1]?.state, 'running')
})

check('a newer in-progress thread/read stays running without a start notification', () => {
  const latest = project({
    threadRead: { thread: { id: threadId, turns: [{ id: 'turn-next', status: 'inProgress', startedAt: at(2_200), items: [] }] } },
    localUserMessages: [localMessage('sent', 'turn-next')],
  }).turns.at(-1)
  assert.equal(latest?.state, 'running')
  assert.equal(latest?.startedAtMs, originMs + 2_200)
  assert.equal(latest?.completedAtMs, null)
})

for (const runtime of [{ executionState: 'idle' }, previousRuntime]) {
  check(`an in-progress snapshot without timing cannot be settled by unbound idle ${'lastCompletedAtIso' in runtime ? 'with old timing' : 'without timing'}`, () => {
    const latest = project({
      threadRead: { thread: { id: threadId, turns: [{ id: 'turn-next', status: 'inProgress', items: [] }] } },
      localUserMessages: [localMessage('sent', 'turn-next')],
      runtime,
    }).turns.at(-1)
    assert.equal(latest?.state, 'running')
    assert.equal(latest?.completedAtMs, null)
    assert.equal(latest?.startedAtMs, null, 'local send time is not execution start evidence')
    assert.equal(latest?.activeElapsedMs, null)
  })
}

assert.equal(failures.length, 0, `${String(failures.length)} send-feedback checks failed: ${failures.join('; ')}`)
console.log('Send-feedback projection smoke passed.')
