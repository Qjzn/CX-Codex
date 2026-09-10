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

for (const clientKey of ['clientMessageId', 'clientUserMessageId']) {
  for (const bound of [true, false]) {
    check(`snapshot acknowledgement before outbox cleanup: ${clientKey}, bound=${bound}`, () => {
      const result = project({
        runtime: null,
        threadRead: { thread: { id: threadId, turns: [{ id: 'turn-next', status: 'inProgress', items: [{
          type: 'userMessage', id: 'authoritative-user', [clientKey]: 'client-next-message',
          content: [{ type: 'text', text: 'Start a new task.' }],
        }] }] } },
        localUserMessages: [localMessage('confirmationPending', bound ? 'turn-next' : undefined)],
      })
      const users = result.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user'))
      assert.equal(users.length, 1, 'snapshot and local outbox must not display the same execution request twice')
      assert.equal(users[0]?.id, 'authoritative-user')
      assert.equal(result.turns.length, 1, 'acknowledged unbound outbox must not add an empty local turn')
    })
  }
}

check('identical prompts with distinct or absent client ids are not text-deduplicated', () => {
  for (const clientMessageId of ['another-intent', '']) {
    const result = project({
      runtime: null,
      threadRead: { thread: { id: threadId, turns: [{ id: 'turn-other', status: 'completed', items: [{
        type: 'userMessage', id: 'another-user', clientMessageId,
        content: [{ type: 'text', text: 'Start a new task.' }],
      }] }] } },
      localUserMessages: [localMessage('confirmationPending')],
    })
    assert.equal(result.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user')).length, 2)
  }
})

for (const runtime of [null, previousRuntime]) {
  for (const keepLocal of [true, false]) {
    check(`user item acknowledgement before turn start stays pending with ${runtime ? 'older idle runtime' : 'no runtime'}, local=${keepLocal}`, () => {
      const acknowledged = {
        method: 'item/completed',
        params: {
          threadId,
          turnId: 'turn-next',
          item: {
            type: 'userMessage',
            id: 'authoritative-user',
            clientMessageId: 'client-next-message',
            content: [{ type: 'text', text: 'Start a new task.' }],
          },
        },
        atIso: at(2_200),
        seq: 20,
      }
      const localUserMessages = keepLocal ? [localMessage('confirmationPending')] : []
      const result = project({
        runtime,
        notifications: [acknowledged],
        localUserMessages,
      })
      const latest = result.turns.at(-1)
      assert.equal(result.turns[0]?.state, 'completed', 'the previous completed turn must retain its outcome')
      assert.equal(latest?.id, 'turn-next')
      assert.deepEqual(result.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user').map((block) => block.id)), ['authoritative-user'])
      assert.equal(latest?.state, 'submitting', 'a user item acknowledgement does not prove turn execution or completion')
      assert.equal(latest?.finalStatus, 'pending')
      assert.equal(latest?.startedAtMs, null, 'the user item acknowledgement time is not an execution start time')
      assert.equal(latest?.completedAtMs, null, 'neither user item completion nor old runtime completion settles the new turn')
      assert.equal(latest?.activeElapsedMs, null)

      const started = project({
        runtime,
        notifications: [acknowledged, {
          method: 'turn/started',
          params: { threadId, turn: { id: 'turn-next', status: 'inProgress', startedAt: at(2_300) } },
          atIso: at(2_300),
          seq: 21,
        }],
        localUserMessages,
      })
      assert.equal(started.turns.at(-1)?.state, 'running', 'the later authoritative turn start must advance the same turn')
      assert.equal(started.turns.at(-1)?.startedAtMs, originMs + 2_300)
      assert.equal(started.turns.at(-1)?.completedAtMs, null)
      assert.deepEqual(started.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user').map((block) => block.id)), ['authoritative-user'])
    })
  }
}

for (const state of ['completed', 'failed', 'running', 'waiting'] as const) {
  check(`authoritative ${state} is not overwritten by a matching local acknowledgement`, () => {
    const terminal = state === 'completed' || state === 'failed'
    const result = project({
      runtime: null,
      threadRead: { thread: { id: threadId, turns: [{
        id: 'turn-next',
        status: state === 'running' ? 'inProgress' : state,
        startedAt: at(2_100),
        ...(terminal ? { completedAt: at(2_300) } : {}),
        items: [{
          type: 'userMessage',
          id: 'authoritative-user',
          clientMessageId: 'client-next-message',
          content: [{ type: 'text', text: 'Start a new task.' }],
        }],
      }] } },
      localUserMessages: [localMessage('confirmationPending')],
    })
    assert.equal(result.turns.length, 1)
    const latest = result.turns[0]
    assert.equal(latest?.state, state)
    assert.equal(latest?.startedAtMs, originMs + 2_100)
    assert.equal(latest?.completedAtMs, terminal ? originMs + 2_300 : null)
    assert.deepEqual(latest?.blocks.filter((block) => block.kind === 'user').map((block) => block.id), ['authoritative-user'])
  })
}

assert.equal(failures.length, 0, `${String(failures.length)} send-feedback checks failed: ${failures.join('; ')}`)
console.log('Send-feedback projection smoke passed.')
