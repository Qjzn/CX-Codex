import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, appendFile, rename, unlink, rmdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Real generated JSONL -> production reader/cache -> production projection.
// Main lifecycle cases supply no synthetic runtime or native-turn state that
// could conceal a recovery failure. All clocks are fixed; no real sessions/API.
const bundle = await build({
  stdin: {
    contents: `
      export { readThreadReadFromSessionLog, parseThreadReadFromSessionLog } from './src/server/appServerSessionLogThreadRead.ts'
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
const { readThreadReadFromSessionLog, parseThreadReadFromSessionLog, projectConversation } = compiled.exports
const threadId = 'session-lifecycle-fixture-thread'
const turnId = 'session-lifecycle-fixture-turn'
const clientId = 'session-lifecycle-client'
const base = Date.parse('2026-09-10T12:00:00.000Z')
const at = (ms) => new Date(base + ms).toISOString()
const encode = (entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
const header = { timestamp: at(0), type: 'session_meta', payload: {
  id: threadId, cli_version: '0.153.4', history_mode: 'legacy',
} }
function lifecycle(type, ms, extra = {}) {
  // Older records omit payload started_at/completed_at. Entry timestamps are
  // the CX compatibility boundary; native payload clock precedence is separate.
  return { timestamp: at(ms), type: 'event_msg', payload: { type, turn_id: turnId, ...extra } }
}
function user(ms = 500) {
  return { timestamp: at(ms), type: 'event_msg', payload: {
    type: 'user_message', client_id: clientId, message: 'Fixture request', images: [], local_images: [],
  } }
}
function assistant(ms, text = 'Public progress: checking the requested behavior.', phase = 'commentary') {
  return { timestamp: at(ms), type: 'event_msg', payload: { type: 'agent_message', message: text, phase } }
}
function runningEntries() {
  return [header, lifecycle('task_started', 0),
    { timestamp: at(0), type: 'turn_context', payload: { turn_id: turnId } }, user(), assistant(2000)]
}
async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'cx-session-lifecycle-'))
  const path = join(root, 'fixture.jsonl')
  const replacement = join(root, 'replacement.jsonl')
  await writeFile(path, encode(entries), 'utf8')
  const remove = async (target) => {
    try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  t.after(async () => { await remove(path); await remove(replacement); await rmdir(root) })
  const fallback = { thread: { id: threadId, turns: [], path } }
  return {
    path,
    read: () => readThreadReadFromSessionLog(path, fallback, { fromStart: true }),
    tail: () => readThreadReadFromSessionLog(path, fallback),
    full: () => parseThreadReadFromSessionLog(path, fallback, { fromStart: true }),
    append: (entries) => appendFile(path, encode(entries), 'utf8'),
    rewrite: (entries) => writeFile(path, encode(entries), 'utf8'),
    replace: async (entries) => {
      await writeFile(replacement, encode(entries), 'utf8')
      await rename(replacement, path)
    },
  }
}
function project(read, now, additions = {}) {
  return projectConversation({ threadRead: read, nowMs: base + now, ...additions })
}
function onlyTurn(projection) {
  assert.equal(projection.turns.length, 1)
  return projection.turns[0]
}

test('a recovered started legacy turn with public commentary remains running with an execution clock', async (t) => {
  const file = await fixture(t, runningEntries())
  const read = await file.read()
  assert.notEqual(read?.thread?.turns[0]?.status, 'completed', 'reader must not mark an unfinished task completed')
  const turn = onlyTurn(project(read, 5000))
  assert.equal(turn.id, turnId)
  assert.equal(turn.state, 'running')
  assert.equal(turn.startedAtMs, base, 'task_started is earlier than user delivery or first commentary')
  assert.equal(turn.completedAtMs, null)
  assert.equal(turn.activeElapsedMs, 5000)
  assert.equal(turn.timingStatus, 'running')
  assert.equal(turn.finalStatus, 'pending')
  assert.deepEqual(turn.commentary.map((block) => block.text), ['Public progress: checking the requested behavior.'])
})

test('incremental public commentary preserves the running start and advances elapsed time without resetting identity', async (t) => {
  const file = await fixture(t, runningEntries())
  const initial = onlyTurn(project(await file.read(), 5000))
  await file.append([assistant(7000, 'Public progress: verification is continuing.')])
  const next = onlyTurn(project(await file.read(), 12_000))
  const full = onlyTurn(project(await file.full(), 12_000))
  assert.deepEqual([initial.state, next.state, full.state], ['running', 'running', 'running'])
  assert.deepEqual([initial.startedAtMs, next.startedAtMs, full.startedAtMs], [base, base, base])
  assert.deepEqual([initial.activeElapsedMs, next.activeElapsedMs, full.activeElapsedMs], [5000, 12_000, 12_000])
  assert.equal(next.renderKey, initial.renderKey)
  assert.equal(next.commentary[0].id, initial.commentary[0].id)
  assert.equal(next.commentary.length, 2)
  assert.deepEqual(next.commentary, full.commentary)
})

test('task_complete freezes the authoritative execution end across cached reads, full recovery and later UI clocks', async (t) => {
  const file = await fixture(t, runningEntries())
  await file.read()
  await file.append([assistant(14_900, 'Fixture completed result.', 'final_answer'),
    lifecycle('task_complete', 15_000, { last_agent_message: 'Fixture completed result.' })])
  const completed = await file.read()
  const cached = await file.read()
  const full = await file.full()
  for (const [read, now] of [[completed, 20_000], [cached, 65_000], [full, 90_000]]) {
    const turn = onlyTurn(project(read, now))
    assert.equal(turn.state, 'completed')
    assert.equal(turn.startedAtMs, base)
    assert.equal(turn.completedAtMs, base + 15_000, 'the terminal event, not reload time or last text, ends execution')
    assert.equal(turn.activeElapsedMs, 15_000)
    assert.equal(turn.timingStatus, 'complete')
    assert.equal(turn.final?.text, 'Fixture completed result.')
  }
})

test('turn_aborted recovers an interrupted terminal state and a stable execution end', async (t) => {
  const file = await fixture(t, runningEntries())
  await file.read()
  await file.append([lifecycle('turn_aborted', 9000, { reason: 'interrupted' })])
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 60_000))
    assert.equal(turn.state, 'interrupted')
    assert.equal(turn.finalStatus, 'interrupted')
    assert.equal(turn.startedAtMs, base)
    assert.equal(turn.completedAtMs, base + 9000)
    assert.equal(turn.activeElapsedMs, 9000)
    assert.equal(turn.timingStatus, 'complete')
  }
})

test('a pending interaction outranks a running recovered task and runtime fact while pausing active elapsed time', async (t) => {
  const file = await fixture(t, runningEntries())
  const read = await file.read()
  const request = { id: 7, method: 'item/commandExecution/requestApproval', receivedAtIso: at(3000),
    params: { threadId, turnId, itemId: 'fixture-command', reason: 'Fixture approval only' } }
  const turn = onlyTurn(project(read, 8000, {
    pendingRequests: [request],
    runtime: { executionState: 'running', activeTurnId: turnId, lastStartedAtIso: at(0), messageState: 'cached' },
  }))
  assert.equal(turn.state, 'waiting')
  assert.equal(turn.interactions[0]?.status, 'pending')
  assert.equal(turn.finalStatus, 'pending')
  assert.equal(turn.startedAtMs, base)
  assert.equal(turn.completedAtMs, null)
  assert.equal(turn.waitedMs, 5000)
  assert.equal(turn.activeElapsedMs, 3000)
})

test('old history without explicit lifecycle stays readable without inventing a running task or live clock', async (t) => {
  const file = await fixture(t, [header, user(), assistant(2000)])
  const read = await file.read()
  const before = onlyTurn(project(read, 5000))
  const later = onlyTurn(project(await file.full(), 60_000))
  for (const turn of [before, later]) {
    assert.notEqual(turn.state, 'running')
    assert.notEqual(turn.timingStatus, 'running')
    assert.equal(turn.activeElapsedMs, null, 'missing terminal boundaries must not turn a historical record into a ticking timer')
    assert.equal(turn.opener?.text, 'Fixture request')
    assert.equal(turn.commentary[0]?.text, 'Public progress: checking the requested behavior.')
  }
})

test('a repeated old task_started cannot revive an already completed turn or reset its clock', async (t) => {
  const file = await fixture(t, [...runningEntries(), lifecycle('task_complete', 15_000)])
  const first = onlyTurn(project(await file.read(), 20_000))
  await file.append([lifecycle('task_started', 0)])
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 90_000))
    assert.equal(turn.state, 'completed')
    assert.equal(turn.startedAtMs, base)
    assert.equal(turn.completedAtMs, base + 15_000)
    assert.equal(turn.activeElapsedMs, 15_000)
    assert.equal(turn.renderKey, first.renderKey)
  }
  const nextTurnId = 'session-lifecycle-after-replay-turn'
  const nextClientId = 'session-lifecycle-after-replay-client'
  const nextUser = user(30_500)
  nextUser.payload.client_id = nextClientId
  nextUser.payload.message = 'Independent request after an old start replay'
  await file.append([
    lifecycle('task_started', 30_000, { turn_id: nextTurnId }),
    { timestamp: at(30_000), type: 'turn_context', payload: { turn_id: nextTurnId } },
    nextUser,
    assistant(32_000, 'Public progress for the new independent task.'),
  ])
  for (const read of [await file.read(), await file.full()]) {
    const projection = project(read, 35_000)
    assert.equal(projection.turns.length, 2)
    const previous = projection.turns.find((turn) => turn.id === turnId)
    const next = projection.turns.find((turn) => turn.id === nextTurnId)
    assert.equal(previous?.state, 'completed')
    assert.equal(previous?.completedAtMs, base + 15_000)
    assert.ok(next, 'ignoring a settled start replay must not poison the next legitimate task scope')
    assert.equal(next.state, 'running')
    assert.equal(next.opener?.clientMessageId, nextClientId)
    assert.equal(next.startedAtMs, base + 30_000)
    assert.equal(next.completedAtMs, null)
    assert.equal(next.activeElapsedMs, 5000)
    assert.equal(next.commentary[0]?.text, 'Public progress for the new independent task.')
  }
})

test('wrong-turn or missing-ID terminal events cannot complete the active turn', async (t) => {
  const noId = lifecycle('task_complete', 9000)
  delete noId.payload.turn_id
  const otherTurn = lifecycle('task_complete', 9000, { turn_id: 'unrelated-terminal-turn' })
  const conflict = { timestamp: at(8000), type: 'turn_context', payload: { turn_id: 'unrelated-context-turn' } }
  for (const suffix of [[noId], [otherTurn], [conflict, otherTurn]]) {
    const file = await fixture(t, runningEntries())
    await file.read()
    await file.append(suffix)
    for (const read of [await file.read(), await file.full()]) {
      const turn = project(read, 20_000).turns.find((entry) => entry.id === turnId)
      assert.ok(turn)
      assert.notEqual(turn.state, 'completed', 'no foreign or absent turn identity can terminate this task')
      assert.equal(turn.completedAtMs, null)
      assert.equal(turn.startedAtMs, base)
    }
  }
})

test('final text arriving before task_complete does not stop the running execution clock', async (t) => {
  const file = await fixture(t, runningEntries())
  await file.read()
  await file.append([assistant(8000, 'Final text is available before lifecycle completion.', 'final_answer')])
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 12_000))
    assert.equal(turn.final?.text, 'Final text is available before lifecycle completion.')
    assert.equal(turn.state, 'running')
    assert.equal(turn.completedAtMs, null)
    assert.equal(turn.startedAtMs, base)
    assert.equal(turn.activeElapsedMs, 12_000)
    assert.equal(turn.timingStatus, 'running')
  }
})

test('atomic same-path replacement cannot inherit the prior file running lifecycle', async (t) => {
  const file = await fixture(t, runningEntries())
  await file.read()
  const beforeStats = await stat(file.path)
  await file.replace([header, user(10_000), assistant(12_000)])
  const afterStats = await stat(file.path)
  assert.notDeepEqual([afterStats.dev, afterStats.ino, afterStats.birthtimeMs],
    [beforeStats.dev, beforeStats.ino, beforeStats.birthtimeMs], 'the file identity really changed')
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 60_000))
    assert.notEqual(turn.state, 'running')
    assert.notEqual(turn.startedAtMs, base)
    assert.equal(turn.activeElapsedMs, null)
  }
})

test('same-file truncation cannot inherit the old terminal lifecycle', async (t) => {
  const file = await fixture(t, [...runningEntries(), lifecycle('task_complete', 15_000),
    { type: 'fixture_padding', payload: 'x'.repeat(2048) }])
  await file.read()
  const beforeStats = await stat(file.path)
  await file.rewrite([header, user(20_000), assistant(22_000)])
  const afterStats = await stat(file.path)
  assert.equal(afterStats.ino, beforeStats.ino)
  assert.ok(afterStats.size < beforeStats.size)
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 90_000))
    assert.equal(turn.completedAtMs, null, 'a new truncated history did not contain the old completion event')
    assert.notEqual(turn.startedAtMs, base)
    assert.equal(turn.activeElapsedMs, null)
  }
})

test('tail recovery with a known terminal but no start keeps execution duration unavailable', async (t) => {
  const rawBoundary = { timestamp: at(3000), type: 'response_item', payload: {
    type: 'message', id: 'tail-hidden-boundary', role: 'user', content: [{ type: 'input_text', text: 'Model input only' }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId, content_item_kinds: ['user.text'] },
  } }
  const file = await fixture(t, [header, lifecycle('task_started', 0),
    { type: 'fixture_padding', payload: 'x'.repeat(24_001_024) },
    rawBoundary, assistant(4000), lifecycle('task_complete', 5000)])
  assert.ok((await stat(file.path)).size - 24_000_000 > Buffer.byteLength(encode([header, lifecycle('task_started', 0)])))
  const turn = onlyTurn(project(await file.tail(), 60_000))
  assert.equal(turn.id, turnId)
  assert.equal(turn.state, 'completed')
  assert.equal(turn.startedAtMs, null, 'first visible item time is not an observed execution start')
  assert.equal(turn.completedAtMs, base + 5000)
  assert.equal(turn.activeElapsedMs, null)
  assert.equal(turn.timingStatus, 'unavailable')
})

test('missing lifecycle timestamps never fall back to item time or the current wall clock', async (t) => {
  const noStartTimestamp = lifecycle('task_started', 0)
  delete noStartTimestamp.timestamp
  const noStartFile = await fixture(t, [header, noStartTimestamp, user(), assistant(2000)])
  const noStartRead = await noStartFile.read()
  for (const additions of [{}, { runtime: {
    executionState: 'running', activeTurnId: turnId, lastStartedAtIso: at(500), messageState: 'cached',
  } }]) {
    const running = onlyTurn(project(noStartRead, 60_000, additions))
    assert.equal(running.state, 'running')
    assert.equal(running.startedAtMs, null, 'explicitly unknown execution time is not a runtime bookkeeping timestamp')
    assert.equal(running.activeElapsedMs, null)
    assert.equal(running.timingStatus, 'unavailable')
  }

  const noEndTimestamp = lifecycle('task_complete', 15_000)
  delete noEndTimestamp.timestamp
  const noEndFile = await fixture(t, [...runningEntries(), noEndTimestamp])
  for (const read of [await noEndFile.read(), await noEndFile.full()]) {
    for (const additions of [{}, { runtime: {
      executionState: 'completed', activeTurnId: '', lastStartedAtIso: at(0), lastCompletedAtIso: at(20_000), messageState: 'cached',
    } }]) {
      const ended = onlyTurn(project(read, 90_000, additions))
      assert.equal(ended.state, 'completed')
      assert.equal(ended.startedAtMs, base)
      assert.equal(ended.completedAtMs, null, 'a late runtime reconciliation cannot supply an explicitly unknown end')
      assert.equal(ended.activeElapsedMs, null)
      assert.equal(ended.timingStatus, 'unavailable')
    }
  }
})

test('native payload Unix-second lifecycle clocks outrank later log entry timestamps', async (t) => {
  const file = await fixture(t, [header,
    lifecycle('task_started', 2000, { started_at: (base + 1000) / 1000 }),
    user(2500), assistant(3000),
    lifecycle('task_complete', 9000, { completed_at: (base + 4000) / 1000, duration_ms: 3000 })])
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 60_000))
    assert.equal(turn.state, 'completed')
    assert.equal(turn.startedAtMs, base + 1000)
    assert.equal(turn.completedAtMs, base + 4000)
    assert.equal(turn.activeElapsedMs, 3000, 'delayed JSONL timestamps cannot lengthen native execution timing')
    assert.equal(turn.timingStatus, 'complete')
  }
})

test('an explicit task_complete error recovers a failed terminal result rather than success', async (t) => {
  const file = await fixture(t, runningEntries())
  await file.read()
  await file.append([lifecycle('task_complete', 9000, {
    completed_at: (base + 9000) / 1000,
    error: { message: 'Fixture terminal failure', codex_error_info: null },
  })])
  for (const read of [await file.read(), await file.full()]) {
    const turn = onlyTurn(project(read, 60_000))
    assert.equal(turn.state, 'failed')
    assert.equal(turn.finalStatus, 'failed')
    assert.match(turn.error, /Fixture terminal failure/u)
    assert.equal(turn.startedAtMs, base)
    assert.equal(turn.completedAtMs, base + 9000)
    assert.equal(turn.activeElapsedMs, 9000)
  }
})
