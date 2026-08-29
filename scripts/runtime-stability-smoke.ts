import assert from 'node:assert/strict'

import { RuntimeStateStore } from '../src/server/runtimeState.js'
import {
  annotateRecentThreadReadWithRecoveredHistory,
  trimThreadTurnsInRpcResult,
} from '../src/server/appServerRpcResult.js'
import { readThreadReadFromSessionLog } from '../src/server/appServerSessionLogThreadRead.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(payload: unknown, key: string): string {
  const value = asRecord(payload)?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function createStore(): RuntimeStateStore {
  return new RuntimeStateStore({
    readThreadIdFromPayload: (payload) => readString(payload, 'threadId'),
    readTurnIdFromPayload: (payload) => readString(payload, 'turnId'),
    readItemIdFromPayload: (payload) => readString(payload, 'itemId'),
    readThreadInProgressFromThreadReadPayload: () => false,
    getErrorMessage: (_payload, fallback) => fallback,
  }, { staleMs: Number.MAX_SAFE_INTEGER })
}

function verifyPreStartIdleDoesNotSettleTheNewTurn(): void {
  const store = createStore()
  const threadId = 'thread-start-idle-race'

  store.markStarting(threadId)
  store.observeEvent({
    method: 'thread/status/changed',
    params: { threadId, status: { type: 'idle' } },
    atIso: '2026-08-25T05:31:45.302Z',
    seq: 1,
  })

  assert.equal(
    store.snapshot(threadId).executionState,
    'starting',
    'an idle status emitted before turn/started must not settle the newly starting request',
  )

  store.observeEvent({
    method: 'thread/status/changed',
    params: { threadId, status: { type: 'active', activeFlags: [] } },
    atIso: '2026-08-25T05:31:45.478Z',
    seq: 2,
  })
  store.observeEvent({
    method: 'turn/started',
    params: { threadId, turnId: 'turn-new' },
    atIso: '2026-08-25T05:31:45.480Z',
    seq: 3,
  })

  const running = store.snapshot(threadId)
  assert.equal(running.executionState, 'running')
  assert.equal(running.activeTurnId, 'turn-new')

  store.observeEvent({
    method: 'thread/status/changed',
    params: { threadId, status: { type: 'idle' } },
    atIso: '2026-08-25T05:41:45.000Z',
    seq: 4,
  })
  assert.equal(
    store.snapshot(threadId).executionState,
    'completed_pending_sync',
    'idle remains terminal after the new turn has started',
  )
}

function verifyTruncatedAppServerHistoryRemainsDiscoverable(): void {
  const recentTurns = Array.from({ length: 5 }, (_, index) => ({ id: `recent-${index}` }))
  const recoveredTurns = Array.from({ length: 12 }, (_, index) => ({ id: `recovered-${index}` }))
  const annotated = annotateRecentThreadReadWithRecoveredHistory(
    { thread: { id: 'thread-history', turns: recentTurns } },
    { thread: { id: 'thread-history', turns: recoveredTurns } },
  ) as { thread: Record<string, unknown> }

  assert.equal(annotated.thread.turnsView, 'recent')
  assert.equal(annotated.thread.originalTurnsCount, 12)
  assert.equal(annotated.thread.turnsStartIndex, 7)
  assert.deepEqual(annotated.thread.turns, recentTurns)
}

function verifyOlderHistoryUsesAbsoluteTurnIndexes(): void {
  const recoveredTurns = Array.from({ length: 40 }, (_, index) => ({ id: `turn-${index + 5}` }))
  const older = trimThreadTurnsInRpcResult('thread/read', {
    thread: {
      id: 'thread-offset-history',
      turns: recoveredTurns,
      turnsView: 'recent',
      originalTurnsCount: 45,
      turnsStartIndex: 5,
    },
  }, {
    turnWindow: { view: 'older', beforeTurnIndex: 35 },
  }) as { thread: { turns: Array<{ id: string }>; originalTurnsCount: number; turnsStartIndex: number } }

  assert.equal(older.thread.turns.length, 10)
  assert.equal(older.thread.turns[0]?.id, 'turn-25')
  assert.equal(older.thread.turns.at(-1)?.id, 'turn-34')
  assert.equal(older.thread.originalTurnsCount, 45)
  assert.equal(older.thread.turnsStartIndex, 25)
}

verifyPreStartIdleDoesNotSettleTheNewTurn()
verifyTruncatedAppServerHistoryRemainsDiscoverable()
verifyOlderHistoryUsesAbsoluteTurnIndexes()
const inspectionPath = process.env.CX_CODEX_INSPECT_SESSION_LOG?.trim() ?? ''
if (inspectionPath) {
  const inspected = await readThreadReadFromSessionLog(inspectionPath, {
    thread: {
      id: 'thread-inspection',
      path: inspectionPath,
      turns: [],
    },
  }) as { thread?: { turns?: unknown[] } } | null
  console.log(`[runtime-stability-smoke] inspected session turns=${String(inspected?.thread?.turns?.length ?? 0)}`)
}
console.log('[runtime-stability-smoke] all checks passed')
