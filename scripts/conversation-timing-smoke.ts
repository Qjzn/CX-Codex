import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectConversation } from '../src/conversation-transcript/index.js'

const base = Date.parse('2026-09-09T16:02:00.000Z')
const at = (ms: number): string => new Date(base + ms).toISOString()
const item = { id: 'final-b', type: 'agentMessage', phase: 'final_answer', text: 'QUEUE_B_OK' }
const completedTurn = { id: 'turn-b', status: 'completed', startedAt: at(30_000), completedAt: at(33_000), items: [item] }
const lateRuntime = { executionState: 'completed', activeTurnId: '', lastStartedAtIso: at(30_654), lastCompletedAtIso: at(48_964), messageState: 'fresh' as const }
const failures: string[] = []
function check(label: string, run: () => void): void {
  try { run(); console.log(`PASS ${label}`) } catch (error) { failures.push(label); console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`) }
}

check('completed snapshot execution duration excludes later runtime reconciliation', () => {
  const latest = projectConversation({ nowMs: base + 60_000, threadRead: { thread: { id: 'queue-thread', turns: [completedTurn] } }, runtime: lateRuntime }).turns[0]!
  assert.equal(latest.completedAtMs, base + 33_000)
  assert.equal(latest.startedAtMs, base + 30_000)
  assert.equal(latest.activeElapsedMs, 3_000, 'A three-second reply must not become nineteen seconds on reload')
})

check('turn lifecycle event timestamps also outrank later runtime bookkeeping', () => {
  const latest = projectConversation({ nowMs: base + 60_000, threadRead: { thread: { id: 'queue-thread', turns: [] } }, runtime: lateRuntime, notifications: [
    { method: 'turn/started', atIso: at(30_654), params: { threadId: 'queue-thread', turn: { id: 'turn-b', startedAt: at(30_000) } } },
    { method: 'turn/completed', atIso: at(33_184), params: { threadId: 'queue-thread', turn: completedTurn } },
  ] }).turns[0]!
  assert.equal(latest.activeElapsedMs, 3_000)
})

check('runtime remains a fallback when the terminal turn lacks lifecycle timestamps', () => {
  const latest = projectConversation({ nowMs: base + 60_000, threadRead: { thread: { id: 'queue-thread', turns: [{ id: 'turn-b', status: 'completed', items: [item] }] } }, runtime: lateRuntime }).turns[0]!
  assert.equal(latest.startedAtMs, base + 30_654)
  assert.equal(latest.completedAtMs, base + 48_964)
  assert.equal(latest.timingStatus, 'complete')
})

check('preserve a terminal start when runtime has an earlier queued timestamp', () => {
  const latest = projectConversation({ nowMs: base + 60_000, threadRead: { thread: { id: 'queue-thread', turns: [completedTurn] } }, runtime: { ...lateRuntime, lastStartedAtIso: at(0) } }).turns[0]!
  assert.equal(latest.activeElapsedMs, 3_000)
})

check('a partial terminal snapshot can still recover its missing end', () => {
  const latest = projectConversation({ nowMs: base + 60_000, threadRead: { thread: { id: 'queue-thread', turns: [{ ...completedTurn, completedAt: undefined }] } }, runtime: { ...lateRuntime, lastCompletedAtIso: at(33_000) } }).turns[0]!
  assert.equal(latest.activeElapsedMs, 3_000)
})

if (process.argv[2]) {
  check('captured test-thread reload preserves all authoritative turn boundaries', () => {
    const input = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
    const projection = projectConversation(input)
    const rawTurns = input.threadRead.thread.turns
    for (const turn of projection.turns) {
      const raw = rawTurns.find((entry: { id: string }) => entry.id === turn.id)
      assert.equal(turn.startedAtMs, raw.startedAt * 1_000)
      assert.equal(turn.completedAtMs, raw.completedAt * 1_000)
      assert.equal(turn.activeElapsedMs, (raw.completedAt - raw.startedAt) * 1_000)
    }
    console.log(JSON.stringify({ liveProjectedElapsedMs: projection.turns.map(turn => turn.activeElapsedMs), rawDurationMs: rawTurns.map((turn: { durationMs: number }) => turn.durationMs) }))
  })
}

assert.equal(failures.length, 0, `${failures.length} conversation timing checks failed: ${failures.join('; ')}`)
console.log('Conversation timing smoke passed.')
