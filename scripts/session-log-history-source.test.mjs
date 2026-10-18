import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import fs, { promises as fsPromises } from 'node:fs'
import { mkdtemp, writeFile, appendFile, rename, unlink, rmdir, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Synthetic files, real production reader/cache/projection. No real sessions,
// model, bridge or browser. Assert source behavior, not an implementation field.
const bundle = await build({
  stdin: {
    contents: `
      export { readThreadReadFromSessionLog, parseThreadReadFromSessionLog } from './src/server/appServerSessionLogThreadRead.ts'
      export { projectConversation } from './src/conversation-transcript/index.ts'
      export { readAppServerThreadRuntimeSnapshot } from './src/server/appServerThreadRuntimeSnapshot.ts'
      export { createCachedThreadRead } from './src/server/appServerThreadReadCache.ts'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { readThreadReadFromSessionLog, parseThreadReadFromSessionLog, projectConversation,
  readAppServerThreadRuntimeSnapshot, createCachedThreadRead } = compiled.exports
const threadId = 'history-source-fixture-thread'
const turnId = 'history-source-fixture-turn'
const clientId = 'history-source-client-a'
const text = 'Fixture only: preserve my visible request'
const at = '2026-09-10T12:00:00.000Z'
const local = { id: 'local-history-source-a', clientMessageId: clientId,
  displayMessageId: 'stable-history-display-a', text, createdAtMs: 100, deliveryState: 'confirmationPending' }
const encode = (entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
function header(mode = 'legacy') {
  return { timestamp: at, type: 'session_meta', payload: {
    id: threadId, cli_version: '0.153.4', ...(mode === undefined ? {} : { history_mode: mode }),
  } }
}
function prefix(idOfTurn = turnId) {
  return [
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started', turn_id: idOfTurn } },
    { timestamp: at, type: 'turn_context', payload: { turn_id: idOfTurn } },
  ]
}
function response(id = 'model-input-a', idOfTurn = turnId) {
  return { timestamp: at, type: 'response_item', payload: {
    type: 'message', id, role: 'user', content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: { turn_id: idOfTurn, content_item_kinds: ['user.text'] },
  } }
}
function event(client = clientId) {
  return { timestamp: at, type: 'event_msg', payload: {
    type: 'user_message', client_id: client, message: text,
    images: [], local_images: [], audio: [], local_audio: [], text_elements: [],
  } }
}
function userRows(projection) {
  return projection.turns.flatMap((turn) => turn.blocks.filter((block) => block.kind === 'user')
    .map((user) => ({ turn, user })))
}
function project(read, messages = []) {
  return projectConversation({ threadRead: read, localUserMessages: messages, nowMs: 1000 })
}
async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'cx-history-source-contract-'))
  const path = join(root, 'fixture.jsonl')
  const replacement = join(root, 'replacement.jsonl')
  await writeFile(path, typeof entries === 'string' ? entries : encode(entries), 'utf8')
  const remove = async (target) => {
    try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  t.after(async () => { await remove(path); await remove(replacement); await rmdir(root) })
  const fallback = { thread: { id: threadId, turns: [], path } }
  return {
    path,
    replacement,
    read: (options) => readThreadReadFromSessionLog(path, fallback, options),
    parse: (options) => parseThreadReadFromSessionLog(path, fallback, options),
    append: (entries) => appendFile(path, encode(entries), 'utf8'),
    patchBytes: async (offset, value) => {
      const handle = await open(path, 'r+')
      try { await handle.write(Buffer.from(value), 0, Buffer.byteLength(value), offset) }
      finally { await handle.close() }
    },
    replace: async (entries) => {
      await writeFile(replacement, encode(entries), 'utf8')
      // Only these generated files: actual same-path/new-file identity change.
      await unlink(path)
      await rename(replacement, path)
    },
  }
}

test('explicit legacy raw-only history does not impersonate a visible user', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const read = await file.read({ fromStart: true })
  assert.equal(read?.thread?.id, threadId, 'known legacy raw-only recovery must remain a usable thread, not trigger a null fallback')
  assert.ok(Array.isArray(read.thread.turns))
  assert.equal(userRows(project(read)).length, 0, 'model input is not a UI user in explicitly declared legacy history')
  const rows = userRows(project(read, [local]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.id, local.id)
  assert.equal(rows[0].user.deliveryState, 'confirmationPending', 'raw model input cannot acknowledge a local user')
})

test('raw-first incremental recovery preserves the local display and turn identity until the event arrives', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const before = project({ thread: { id: threadId, turns: [] } }, [local])
  const rawOnly = project(await file.read(), [local])
  await file.append([event()])
  const identified = project(await file.read(), [local])
  for (const [index, projection] of [before, rawOnly, identified].entries()) {
    const rows = userRows(projection)
    assert.equal(rows.length, 1, `stage ${index}: raw input created a temporary anonymous bubble`)
    assert.equal(rows[0].user.displayMessageId, local.displayMessageId)
    assert.equal(rows[0].turn.renderKey, `user-turn:${local.displayMessageId}`)
  }
  assert.equal(userRows(rawOnly)[0].user.deliveryState, 'confirmationPending')
  assert.equal(userRows(identified)[0].user.clientMessageId, clientId)
  assert.notEqual(userRows(identified)[0].user.id, local.id)
})

test('absent, unknown and CLI-version-only headers keep unidentified response-only history readable', async (t) => {
  const cliOnly = header()
  delete cliOnly.payload.history_mode
  for (const entries of [[], [header('unknown-fixture-mode')], [cliOnly]]) {
    const file = await fixture(t, [...entries, ...prefix(), response()])
    const read = await file.read({ fromStart: true })
    const rows = userRows(project(read))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].user.id, 'model-input-a')
    assert.equal(rows[0].user.text, text)
    assert.equal(rows[0].user.clientMessageId, null)
    assert.ok(userRows(project(read, [local])).some(({ user }) => user.id === local.id
      && user.deliveryState === 'confirmationPending'))
  }
})

test('a cold tail-window read still respects the legacy session header outside that window', async (t) => {
  // The production default window is 24,000,000 bytes. A real oversized neutral
  // record places the header outside it without mocking range reads or constants.
  const filler = { type: 'fixture_padding', payload: 'x'.repeat(24_001_024) }
  const file = await fixture(t, [header(), filler, ...prefix(), response()])
  const size = (await stat(file.path)).size
  assert.ok(size - 24_000_000 > Buffer.byteLength(encode([header()])))
  const cold = project(await file.read(), [local])
  const directTail = project(await file.parse(), [local])
  const full = project(await file.read({ fromStart: true }), [local])
  const directFull = project(await file.parse({ fromStart: true }), [local])
  for (const [label, projection] of [['cold tail', cold], ['direct tail', directTail], ['full', full], ['direct full', directFull]]) {
    const rows = userRows(projection)
    assert.equal(rows.length, 1, `${label}: an out-of-window header must not turn model input into UI`)
    assert.equal(rows[0].user.id, local.id)
    assert.equal(rows[0].user.deliveryState, 'confirmationPending')
  }
})

test('cold, unchanged cached and incrementally updated reads retain the same history-source decision', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const cold = await file.read()
  const cached = await file.read()
  await file.append([{ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: {} } }])
  const incremental = await file.read()
  await file.append([event()])
  const eventRead = await file.read()
  for (const [label, read] of [['cold', cold], ['cached', cached], ['incremental', incremental]]) {
    assert.equal(read?.thread?.id, threadId, `${label}: known legacy history must not fall back to a null read`)
    assert.equal(userRows(project(read)).length, 0, `${label}: raw-only legacy users leaked into UI`)
    assert.equal(userRows(project(read, [local]))[0].user.deliveryState, 'confirmationPending')
  }
  const rows = userRows(project(eventRead, [local]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user.displayMessageId, local.displayMessageId)
  assert.equal(rows[0].user.clientMessageId, clientId)
})

test('same-path file replacement does not inherit the previous file history mode', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const legacy = await file.read()
  await file.replace([header('unknown-fixture-mode'), ...prefix(), response('unknown-mode-input')])
  const unknown = await file.read()
  await file.replace([header(), ...prefix(), response('replacement-legacy-input')])
  const newLegacy = await file.read()
  assert.equal(userRows(project(legacy)).length, 0)
  assert.deepEqual(userRows(project(unknown)).map(({ user }) => user.id), ['unknown-mode-input'])
  assert.equal(userRows(project(newLegacy)).length, 0)
})

test('two same-text clients remain separate through raw-first incremental batches', async (t) => {
  const second = { ...local, id: 'local-history-source-b', clientMessageId: 'history-source-client-b',
    displayMessageId: 'stable-history-display-b' }
  const locals = [local, second]
  const file = await fixture(t, [header(), ...prefix(), response()])
  const rawOnly = project(await file.read(), locals)
  await file.append([event(), response('model-input-b')])
  const firstEvent = project(await file.read(), locals)
  await file.append([event(second.clientMessageId)])
  const bothEvents = project(await file.read(), locals)
  for (const [index, projection] of [rawOnly, firstEvent, bothEvents].entries()) {
    const rows = userRows(projection)
    assert.equal(rows.length, 2, `stage ${index}: do not add raw-input users or collapse equal-text clients`)
    assert.deepEqual(rows.map(({ user }) => user.clientMessageId).sort(), [clientId, second.clientMessageId].sort())
    assert.deepEqual(rows.map(({ user }) => user.displayMessageId).sort(), locals.map((user) => user.displayMessageId).sort())
  }
  assert.ok(userRows(firstEvent).some(({ user }) => user.id === second.id && user.deliveryState === 'confirmationPending'))
  assert.ok(userRows(bothEvents).every(({ user }) => !locals.some((entry) => entry.id === user.id)))
})

test('the first legacy session header stays authoritative over a later copied unknown header', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const before = await file.read()
  await file.append([header('future'), response('after-copied-meta')])
  const reads = [before, await file.read(), await file.parse(), await file.parse({ fromStart: true })]
  for (const read of reads) {
    assert.equal(read?.thread?.id, threadId)
    assert.equal(userRows(project(read)).length, 0, 'a copied metadata record may not replace the first session source contract')
  }
})

test('later legacy metadata cannot grant authority when the first header is unknown or has no history mode', async (t) => {
  const missing = header()
  delete missing.payload.history_mode
  for (const first of [header('future'), missing]) {
    const file = await fixture(t, [first, ...prefix(), response()])
    await file.read()
    await file.append([header(), response('after-later-legacy')])
    for (const read of [await file.read(), await file.parse(), await file.parse({ fromStart: true })]) {
      const rows = userRows(project(read))
      assert.deepEqual(rows.map(({ user }) => user.id), ['model-input-a', 'after-later-legacy'])
      assert.ok(rows.every(({ user }) => user.clientMessageId === null))
    }
  }
})

test('same-inode header rewrite beyond old 512-byte guards invalidates legacy permission before append', async (t) => {
  const longHeader = { timestamp: at, type: 'session_meta', payload: {
    id: threadId, cli_version: '0.153.4', padding: 'x'.repeat(600), history_mode: 'legacy',
  } }
  const entries = [longHeader, ...prefix(), response(), { type: 'fixture_footer', payload: 'z'.repeat(2048) }]
  const initial = encode(entries)
  const modeOffset = Buffer.byteLength(initial.slice(0, initial.indexOf('"history_mode":"legacy"') + '"history_mode":"'.length))
  assert.ok(modeOffset > 557, 'the changed authority bytes must be outside the old prefix checkpoint')
  assert.ok(modeOffset + 6 < Buffer.byteLength(initial) - 512, 'the old tail checkpoint must also exclude the changed bytes')
  const file = await fixture(t, entries)
  const before = await file.read()
  const originalStats = await stat(file.path)
  await file.patchBytes(modeOffset, 'future')
  const patchedStats = await stat(file.path)
  assert.deepEqual([patchedStats.dev, patchedStats.ino, patchedStats.birthtimeMs, patchedStats.size],
    [originalStats.dev, originalStats.ino, originalStats.birthtimeMs, originalStats.size], 'use a real equal-length same-file rewrite')
  await file.append([{ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: {} } }])
  const after = await file.read()
  const direct = await file.parse({ fromStart: true })
  assert.equal(userRows(project(before)).length, 0)
  for (const read of [after, direct]) {
    assert.deepEqual(userRows(project(read)).map(({ user }) => user.id), ['model-input-a'],
      'an older cached legacy decision must not hide a response after header authority changed')
  }
})

test('non-header or incomplete first records cannot be rescued by a later legacy session header', async (t) => {
  const suffix = encode([...prefix(), response()])
  const cases = [
    encode([{ type: 'fixture_non_header', payload: {} }, header()]) + suffix,
    '{"type":"session_meta","payload":\n' + encode([header()]) + suffix,
    JSON.stringify(header()) + JSON.stringify({ type: 'fixture_joined_without_newline' }) + '\n' + suffix,
  ]
  for (const bytes of cases) {
    const file = await fixture(t, bytes)
    for (const read of [await file.read(), await file.parse({ fromStart: true })]) {
      assert.deepEqual(userRows(project(read)).map(({ user }) => user.id), ['model-input-a'],
        'only a complete first nonempty physical record can establish history authority')
    }
  }
})

test('a session header whose complete line exceeds the 64-KiB bound stays conservative even on full scan', async (t) => {
  const oversized = { timestamp: at, type: 'session_meta', payload: {
    id: threadId, cli_version: '0.153.4', history_mode: 'legacy', padding: 'x'.repeat(65_536),
  } }
  assert.ok(Buffer.byteLength(encode([oversized])) > 65_536)
  const file = await fixture(t, [oversized, ...prefix(), response()])
  for (const read of [await file.read(), await file.read({ fromStart: true }), await file.parse(), await file.parse({ fromStart: true })]) {
    assert.deepEqual(userRows(project(read)).map(({ user }) => user.id), ['model-input-a'],
      'full body parsing must not bypass the bounded header authority check')
  }
})

test('leading empty lines still allow the first complete matching legacy session header', async (t) => {
  const file = await fixture(t, '\n \r\n' + encode([header(), ...prefix(), response()]))
  for (const read of [await file.read(), await file.parse(), await file.parse({ fromStart: true })]) {
    assert.equal(read?.thread?.id, threadId)
    assert.equal(userRows(project(read)).length, 0)
  }
})

test('a session header for another thread cannot grant legacy permissions to the fallback thread', async (t) => {
  const unrelated = header()
  unrelated.payload.id = 'unrelated-header-thread'
  const file = await fixture(t, [unrelated, ...prefix(), response()])
  for (const read of [await file.read(), await file.read({ fromStart: true }), await file.parse(), await file.parse({ fromStart: true })]) {
    assert.equal(read?.thread?.id, threadId)
    const rows = userRows(project(read))
    assert.deepEqual(rows.map(({ user }) => user.id), ['model-input-a'])
    assert.equal(rows[0].user.clientMessageId, null)
  }
})

test('unchanged same-path cache isolates history permission by the requested fallback thread ID', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const initialStats = await stat(file.path)
  const correct = await file.read()
  const differentId = 'different-fallback-thread'
  const mismatched = await readThreadReadFromSessionLog(file.path, {
    thread: { id: differentId, turns: [], path: file.path },
  })
  const correctAgain = await file.read()
  const finalStats = await stat(file.path)
  assert.deepEqual([finalStats.dev, finalStats.ino, finalStats.size, finalStats.mtimeMs],
    [initialStats.dev, initialStats.ino, initialStats.size, initialStats.mtimeMs], 'exercise an unchanged-file cache hit, not a file invalidation')
  assert.equal(correct?.thread?.id, threadId)
  assert.equal(userRows(project(correct)).length, 0)
  assert.equal(mismatched?.thread?.id, differentId, 'a path cache may not return another requested thread identity')
  assert.deepEqual(userRows(project(mismatched)).map(({ user }) => user.id), ['model-input-a'])
  assert.equal(userRows(project(mismatched))[0].user.clientMessageId, null)
  assert.equal(correctAgain?.thread?.id, threadId)
  assert.equal(userRows(project(correctAgain)).length, 0)
})

test('runtime snapshot accepts real legacy raw-only recovery without issuing heavy thread/read', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const rpcCalls = []
  const recoveryCalls = []
  const remembered = []
  const runtimeObservations = []
  const snapshot = await readAppServerThreadRuntimeSnapshot(threadId, {
    rpc: async (method, params) => {
      rpcCalls.push({ method, params })
      assert.equal(method, 'thread/read')
      assert.equal(params.includeTurns, false, 'a usable empty history must not fall through to the slow full RPC')
      return { thread: { id: threadId, path: file.path, inProgress: true, activeTurnId: turnId,
        updatedAt: Math.floor(Date.parse(at) / 1000), turns: [] } }
    },
    observeThreadRead: () => {},
    getCachedThreadRead: () => null,
    rememberCachedThreadRead: (id, threadRead, source) => {
      const cached = createCachedThreadRead(threadRead, () => at, source)
      remembered.push({ id, cached })
      return cached
    },
    snapshotRuntime: (id, overlay = {}) => ({ threadId: id, executionState: 'running',
      activeTurnId: turnId, inProgress: true, messageState: 'unavailable', threadRead: null,
      pendingServerRequests: [], tokenUsage: null, ...overlay }),
    observeRuntimeThreadRead: (...args) => runtimeObservations.push(args),
    markRuntimeDegraded: () => assert.fail('a known empty history is usable, not a degraded runtime'),
    persistRuntimeSnapshot: (_id, value) => value,
    listPendingServerRequestsForThread: () => [],
    getThreadTokenUsage: () => null,
    resolveSessionLogPath: async (id) => { assert.equal(id, threadId); return file.path },
    validateSessionLogPath: async () => assert.fail('the fixture resolver already returned its exact owned path'),
    readSessionLogThreadRead: async (path, fallback) => {
      recoveryCalls.push({ path, fallback })
      return await readThreadReadFromSessionLog(path, fallback)
    },
    getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
    writeWarning: () => assert.fail('successful empty recovery should not generate a fallback warning'),
  })
  assert.deepEqual(rpcCalls, [{ method: 'thread/read', params: { threadId, includeTurns: false } }])
  assert.equal(recoveryCalls.length, 1, 'the public snapshot path must actually call the production log reader')
  assert.equal(recoveryCalls[0].path, file.path)
  assert.equal(recoveryCalls[0].fallback.thread.id, threadId)
  assert.equal(snapshot.threadRead?.thread?.id, threadId)
  assert.deepEqual(snapshot.threadRead.thread.turns, [], 'the accepted real recovery is an empty UI history')
  assert.equal(snapshot.messageState, 'cached')
  assert.equal(remembered.length, 1)
  assert.equal(remembered[0].cached.source, 'session-log')
  assert.deepEqual(remembered[0].cached.threadRead, snapshot.threadRead)
  assert.equal(runtimeObservations.length, 1)
})

test('a cold truncated tail with no recoverable records is not an authoritative empty legacy history', async (t) => {
  const visiblePrefix = [header(), ...prefix(), event(),
    { timestamp: at, type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } }]
  const file = await fixture(t, [...visiblePrefix, { type: 'fixture_neutral_tail', payload: 'x'.repeat(24_001_024) }])
  assert.ok((await stat(file.path)).size - 24_000_000 > Buffer.byteLength(encode(visiblePrefix)))
  const coldTail = await file.read()
  const directTail = await file.parse()
  const full = await file.parse({ fromStart: true })
  assert.equal(userRows(project(full)).length, 1, 'the fixture really has an earlier visible native user')
  assert.equal(coldTail, null, 'a tail that skipped all records must request recovery instead of erasing known history')
  assert.equal(directTail, null, 'direct parsing cannot call a truncated tail a complete empty history either')
})

test('replacement between the real header checkpoint and stream creation cannot expose or remember a mixed empty snapshot', async (t) => {
  const oldEntries = [header(), ...prefix(), response('model-input-a')]
  const newEntries = [header('future'), ...prefix(), response('model-input-b')]
  assert.equal(Buffer.byteLength(encode(oldEntries)), Buffer.byteLength(encode(newEntries)))
  const file = await fixture(t, oldEntries)
  await writeFile(file.replacement, encode(newEntries), 'utf8')
  const originalCreateReadStream = fs.createReadStream
  const originalOpen = fsPromises.open
  let completedCheckpoints = 0
  let replacedBeforeStream = false
  const recoveredResults = []
  const remembered = []
  const rpcCalls = []
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args)
    if (args[0] === file.path && args[1] === 'r') {
      const originalClose = handle.close.bind(handle)
      handle.close = async () => { await originalClose(); completedCheckpoints += 1 }
    }
    return handle
  }
  fs.createReadStream = (...args) => {
    if (args[0] === file.path && !replacedBeforeStream) {
      assert.equal(completedCheckpoints, 1, 'replace only after the real pre-read checkpoint has closed its file handle')
      // The old checkpoint handle is closed and no body stream exists yet.
      // Real rename-over-existing atomically changes the path to our prepared
      // same-size file; do not substitute an in-place or post-parse rewrite.
      fs.renameSync(file.replacement, file.path)
      replacedBeforeStream = true
    }
    return originalCreateReadStream(...args)
  }
  syncBuiltinESMExports()
  let snapshot
  try {
    snapshot = await readAppServerThreadRuntimeSnapshot(threadId, {
      rpc: async (method, params) => {
        rpcCalls.push({ method, params })
        assert.equal(method, 'thread/read')
        return { thread: { id: threadId, path: file.path, turns: params.includeTurns ? [{ id: turnId,
          status: 'completed', items: [{ type: 'userMessage', id: 'heavy-recovery-user', content: [{ type: 'text', text }] }] }] : [] } }
      },
      observeThreadRead: () => {},
      getCachedThreadRead: () => null,
      rememberCachedThreadRead: (_id, threadRead, source) => {
        remembered.push(threadRead)
        return createCachedThreadRead(threadRead, () => at, source)
      },
      snapshotRuntime: (id, overlay = {}) => ({ threadId: id, executionState: 'idle',
        activeTurnId: '', inProgress: false, messageState: 'unavailable', threadRead: null,
        pendingServerRequests: [], tokenUsage: null, ...overlay }),
      observeRuntimeThreadRead: () => {},
      markRuntimeDegraded: () => assert.fail('stable reread or heavy recovery should remain usable'),
      persistRuntimeSnapshot: (_id, value) => value,
      listPendingServerRequestsForThread: () => [],
      getThreadTokenUsage: () => null,
      resolveSessionLogPath: async () => file.path,
      validateSessionLogPath: async () => assert.fail('only the exact owned fixture path is permitted'),
      readSessionLogThreadRead: async (path, fallback) => {
        const result = await readThreadReadFromSessionLog(path, fallback)
        recoveredResults.push(result)
        return result
      },
      getErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
      writeWarning: () => {},
    })
  } finally {
    fs.createReadStream = originalCreateReadStream
    fsPromises.open = originalOpen
    syncBuiltinESMExports()
  }
  assert.equal(replacedBeforeStream, true)
  assert.ok(completedCheckpoints >= 2, 'the post-read guard must observe the replacement too')
  assert.equal(recoveredResults.length, 1)
  const recovered = recoveredResults[0]
  assert.ok(recovered === null || userRows(project(recovered)).some(({ user }) => user.id === 'model-input-b'),
    'reject mixed old-header/new-body output or perform a stable reread; never return an empty success')
  assert.ok(remembered.every((read) => userRows(project(read)).length > 0), 'outer snapshot cache must never remember the mixed empty success')
  assert.equal(userRows(project(snapshot.threadRead)).length, 1)
  assert.equal(rpcCalls[0].params.includeTurns, false)
})

function assistantWithoutTurn() {
  return { timestamp: at, type: 'event_msg', payload: {
    type: 'agent_message', message: 'Fixture output after hidden raw input', phase: 'commentary',
  } }
}
function assistantRows(read) {
  return (read?.thread?.turns ?? []).flatMap((turn) => turn.items.filter((item) => item.type === 'agentMessage')
    .map((item) => ({ turnId: turn.id, itemId: item.id, text: item.text })))
}

test('incremental recovery retains a hidden next-turn boundary without exposing an empty UI turn', async (t) => {
  const nextTurn = 'history-source-next-turn'
  const file = await fixture(t, [header(), ...prefix(), event(),
    { timestamp: at, type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } },
    ...prefix(nextTurn), response('hidden-next-raw', nextTurn)])
  const first = await file.read({ fromStart: true })
  assert.deepEqual(first.thread.turns.map((turn) => turn.id), [turnId], 'private hidden boundaries must not add empty UI turns')
  await file.append([assistantWithoutTurn()])
  const incremental = await file.read({ fromStart: true })
  const full = await file.parse({ fromStart: true })
  assert.equal(assistantRows(full)[0]?.turnId, nextTurn)
  assert.equal(assistantRows(incremental)[0]?.turnId, nextTurn, 'new output must not be attached to the earlier completed turn')
  assert.deepEqual(assistantRows(incremental), assistantRows(full))
  assert.equal(userRows(project(incremental)).length, 1, 'the hidden raw input is not an extra UI user')
})

test('the first raw-only turn keeps its explicit boundary for later turnless assistant output', async (t) => {
  const file = await fixture(t, [header(), ...prefix(), response()])
  const first = await file.read({ fromStart: true })
  assert.deepEqual(first.thread.turns, [])
  await file.append([assistantWithoutTurn()])
  const incremental = await file.read({ fromStart: true })
  const full = await file.parse({ fromStart: true })
  for (const read of [incremental, full]) {
    assert.equal(assistantRows(read)[0]?.turnId, turnId, 'a hidden first boundary must not become a synthetic event-ID turn')
    assert.equal(userRows(project(read)).length, 0)
  }
  assert.deepEqual(assistantRows(incremental), assistantRows(full))
})
