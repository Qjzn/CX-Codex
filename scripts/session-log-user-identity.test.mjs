import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import fs, { promises as fsPromises } from 'node:fs'
import { mkdtemp, writeFile, appendFile, rename, stat, utimes, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Real production file reader and incremental cache; all session files are
// generated fixtures. Never read an existing Codex home, contact a model or
// connect to the bridge. The fixture shape comes from isolated Codex 0.153.4:
// response_item user precedes event_msg user_message; only the event has
// client_id, and that event carries neither a message ID nor a turn ID.
const bundle = await build({
  stdin: {
    contents: `export { readThreadReadFromSessionLog } from './src/server/appServerSessionLogThreadRead.ts'`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { readThreadReadFromSessionLog } = compiled.exports

const threadId = 'session-user-identity-fixture'
const turnId = 'session-identity-turn'
const clientId = 'session-client-a'
const text = 'Fixture only: inspect this message'
const at = '2026-09-10T10:59:41.318Z'
const secondAt = '2026-09-10T10:59:42.318Z'
const encode = (entries, lineEnding = '\n') => `${entries.map((entry) => JSON.stringify(entry)).join(lineEnding)}${lineEnding}`
function userEvent(client = clientId, body = text, timestamp = at) {
  return { timestamp, type: 'event_msg', payload: {
    type: 'user_message', client_id: client, message: body,
    images: [], local_images: [], audio: [], local_audio: [], text_elements: [],
  } }
}
function userResponse(id = 'msg-fixture-user', body = text, idOfTurn = turnId) {
  return { timestamp: at, type: 'response_item', payload: {
    type: 'message', id, role: 'user', content: [{ type: 'input_text', text: body }],
    internal_chat_message_metadata_passthrough: { turn_id: idOfTurn, content_item_kinds: ['user.text'] },
  } }
}
function assistantEvent() {
  return { timestamp: secondAt, type: 'event_msg', payload: {
    type: 'agent_message', message: 'Fixture commentary only', phase: 'commentary',
  } }
}
function lifecycle(type, idOfTurn = turnId) {
  return { timestamp: at, type: 'event_msg', payload: { type, turn_id: idOfTurn } }
}
function turnContext(idOfTurn = turnId) {
  return { timestamp: at, type: 'turn_context', payload: { turn_id: idOfTurn } }
}
function identified(result, client = clientId) {
  const rows = users(result).filter(({ item }) => item.clientId === client)
  assert.equal(rows.length, 1, `one identified event is expected for ${client}`)
  return rows[0]
}
function users(result) {
  assert.ok(result?.thread, 'the production reader must return the generated session')
  return result.thread.turns.flatMap((turn) => turn.items.filter((item) => item.type === 'userMessage')
    .map((item) => ({ turn, item })))
}
function visibleText(item) {
  return (item.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}
async function fixture(t, initial, lineEnding = '\n') {
  const root = await mkdtemp(join(tmpdir(), 'cx-session-user-identity-'))
  const path = join(root, 'fixture.jsonl')
  const replacement = join(root, 'replacement.jsonl')
  await writeFile(path, encode(initial, lineEnding), 'utf8')
  // Exact generated targets only; no recursive removal or existing user files.
  const removeIfPresent = async (target) => {
    try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  t.after(async () => { await removeIfPresent(path); await removeIfPresent(replacement); await rmdir(root) })
  const fallback = { thread: { id: threadId, turns: [], preview: '', createdAt: 0, updatedAt: 0, path } }
  return {
    path,
    read: (options) => readThreadReadFromSessionLog(path, fallback, options),
    append: (entries) => appendFile(path, encode(entries, lineEnding), 'utf8'),
    appendRaw: (value) => appendFile(path, value, 'utf8'),
    rewrite: (entries) => writeFile(path, encode(entries), 'utf8'),
    rewriteRaw: (value) => writeFile(path, value, 'utf8'),
    replace: async (entries, preserveTimes = false) => {
      const originalStats = await stat(path)
      await writeFile(replacement, encode(entries), 'utf8')
      if (preserveTimes) await utimes(replacement, originalStats.atime, originalStats.mtime)
      // Windows does not consistently allow rename-over-existing. The reader
      // is idle here, so removing only our generated old file gives the same
      // same-path/new-file-identity cache transition without a rename race.
      await unlink(path)
      await rename(replacement, path)
    },
  }
}

for (const fromStart of [false, true]) {
  test(`event-only ${fromStart ? 'full' : 'default'} file read preserves native client_id as user clientId`, async (t) => {
    const file = await fixture(t, [userEvent()])
    const rows = users(await file.read({ fromStart }))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].item.clientId, clientId)
    assert.equal(rows[0].item.recoverySource, 'event_msg')
    assert.equal(visibleText(rows[0].item), text)
  })
}

test('full response then event recovery preserves event client identity without assigning it to equal-text response', async (t) => {
  const response = userResponse()
  const file = await fixture(t, [response, userEvent()])
  const rows = users(await file.read({ fromStart: true }))
  const identified = rows.filter(({ item }) => item.clientId === clientId)
  assert.equal(identified.length, 1, 'the identity-bearing event must not be dropped because its text matches a response')
  assert.equal(identified[0].item.recoverySource, 'event_msg')
  assert.notEqual(identified[0].item.id, response.payload.id, 'equal text does not authorize transferring client identity to a response ID')
  const responseItem = rows.find(({ item }) => item.id === response.payload.id)
  if (responseItem) assert.equal(responseItem.item.clientId, undefined)
})

test('full recovery keeps same-text user events from independent clients distinct', async (t) => {
  const file = await fixture(t, [userEvent(), userEvent('session-client-b', text, secondAt)])
  const rows = users(await file.read({ fromStart: true }))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ item }) => item.clientId), [clientId, 'session-client-b'])
  assert.equal(new Set(rows.map(({ item }) => item.id)).size, 2)
})

test('incremental clone retains the existing event client identity when only assistant output is appended', async (t) => {
  const file = await fixture(t, [userEvent()])
  const first = users(await file.read())
  assert.equal(first.length, 1)
  await file.append([assistantEvent()])
  const rows = users(await file.read())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].item.id, first[0].item.id)
  assert.equal(rows[0].item.clientId, clientId, 'incremental seed cloning must not discard a recovered user client ID')
  assert.equal(rows[0].item.recoverySource, 'event_msg')
})

test('incremental append preserves old and new same-text client identities independently', async (t) => {
  const file = await fixture(t, [userEvent()])
  await file.read({ fromStart: true })
  await file.append([userEvent('session-client-b', text, secondAt)])
  const rows = users(await file.read({ fromStart: true }))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ item }) => item.clientId), [clientId, 'session-client-b'])
  assert.equal(new Set(rows.map(({ item }) => item.id)).size, 2)
})

test('event appended after a cached equal-text response still retains its own client identity', async (t) => {
  const response = userResponse()
  const file = await fixture(t, [response])
  const before = users(await file.read())
  assert.equal(before.length, 1)
  assert.equal(before[0].item.clientId, undefined)
  await file.append([userEvent()])
  const rows = users(await file.read())
  const identified = rows.filter(({ item }) => item.clientId === clientId)
  assert.equal(identified.length, 1)
  assert.equal(identified[0].item.recoverySource, 'event_msg')
  assert.notEqual(identified[0].item.id, response.payload.id)
})

test('internal user context remains hidden even when the event carries a client identity', async (t) => {
  const hidden = '<environment_context>Fixture internal environment only</environment_context>'
  const file = await fixture(t, [userResponse('hidden-response', hidden), userEvent('hidden-client', hidden), userEvent()])
  const rows = users(await file.read())
  assert.equal(rows.length, 1)
  assert.equal(visibleText(rows[0].item), text)
  assert.equal(JSON.stringify(rows).includes('hidden-client'), false)
  assert.equal(JSON.stringify(rows).includes('Fixture internal environment only'), false)
})

test('response image recovery remains intact and does not manufacture a client identity', async (t) => {
  const file = await fixture(t, [userResponse('image-response',
    'Inspect this image <image name="Image #1" path="C:/fixture/image.png"></image>')])
  const rows = users(await file.read())
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].item.content, [
    { type: 'text', text: 'Inspect this image' }, { type: 'localImage', path: 'C:/fixture/image.png' },
  ])
  assert.equal(rows[0].item.clientId, undefined)
})

test('a standalone response without native client metadata remains unidentified', async (t) => {
  const file = await fixture(t, [userResponse()])
  const rows = users(await file.read())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].item.id, 'msg-fixture-user')
  assert.equal(rows[0].item.clientId, undefined)
})

test('null and blank event client_id values do not manufacture an identity', async (t) => {
  const file = await fixture(t, [userEvent(null), userEvent('   ', text, secondAt)])
  const rows = users(await file.read())
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ item }) => item.clientId), [undefined, undefined])
})

test('task_started opens a user-event turn scope and matching turn_context only confirms it', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), turnContext(), userEvent()])
  const row = identified(await file.read())
  assert.equal(row.turn.id, turnId)
  assert.equal(row.item.recoverySource, 'event_msg')
})

for (const terminal of ['task_complete', 'turn_aborted']) {
  test(`${terminal} closes the scope before a later identified event`, async (t) => {
    const file = await fixture(t, [lifecycle('task_started'), userEvent(), lifecycle(terminal), userEvent('after-terminal', text, secondAt)])
    const result = await file.read()
    assert.equal(identified(result).turn.id, turnId)
    assert.notEqual(identified(result, 'after-terminal').turn.id, turnId)
  })
}

test('an isolated turn_context cannot establish user-event ownership', async (t) => {
  const file = await fixture(t, [turnContext(), userEvent()])
  assert.notEqual(identified(await file.read()).turn.id, turnId)
})

for (const [name, conflict] of [
  ['context', turnContext('different-turn')],
  ['response metadata', userResponse('different-response', 'Unrelated response text', 'different-turn')],
  ['nested start', lifecycle('task_started', 'different-turn')],
]) {
  test(`${name} conflict disables event ownership until a terminal boundary`, async (t) => {
    const file = await fixture(t, [lifecycle('task_started'), conflict,
      userEvent('conflicted-event'), lifecycle('task_started', 'another-nested-turn'),
      userEvent('still-conflicted-event', text, secondAt), lifecycle('task_complete'),
      lifecycle('task_started', 'fresh-turn'), userEvent('fresh-event', text, '2026-09-10T10:59:43.318Z')])
    const result = await file.read()
    for (const client of ['conflicted-event', 'still-conflicted-event']) {
      assert.ok(![turnId, 'different-turn', 'another-nested-turn'].includes(identified(result, client).turn.id),
        `${name}: a conflicting scope cannot assign the event to any candidate turn`)
    }
    assert.equal(identified(result, 'fresh-event').turn.id, 'fresh-turn')
  })
}

test('incremental task scope survives a read boundary and closes after terminal append', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent()])
  assert.equal(identified(await file.read()).turn.id, turnId)
  await file.append([userEvent('same-active-turn', text, secondAt)])
  assert.equal(identified(await file.read(), 'same-active-turn').turn.id, turnId)
  await file.append([lifecycle('task_complete'), userEvent('outside-scope', text, '2026-09-10T10:59:43.318Z')])
  assert.notEqual(identified(await file.read(), 'outside-scope').turn.id, turnId)
})

test('incremental and full reads yield equal event IDs, client identities and lifecycle bindings', async (t) => {
  const first = [lifecycle('task_started'), userEvent()]
  const second = [assistantEvent(), userEvent('session-client-b', text, at), lifecycle('task_complete')]
  const incremental = await fixture(t, first)
  await incremental.read({ fromStart: true })
  await incremental.append(second)
  const full = await fixture(t, [...first, ...second])
  const select = (result) => users(result).map(({ turn, item }) => ({
    turnId: turn.id, id: item.id, clientId: item.clientId, content: item.content, recoverySource: item.recoverySource,
  }))
  const appended = select(await incremental.read({ fromStart: true }))
  const scanned = select(await full.read({ fromStart: true }))
  assert.deepEqual(appended, scanned, 'byte-offset identities must be independent of incremental entry counting')
  assert.deepEqual(appended.map((row) => row.clientId), [clientId, 'session-client-b'])
})

test('same-timestamp different clients remain distinct across incremental reads', async (t) => {
  const file = await fixture(t, [userEvent()])
  const first = identified(await file.read())
  await file.append([userEvent('session-client-b', text, at)])
  const result = await file.read()
  const second = identified(result, 'session-client-b')
  assert.notEqual(second.item.id, first.item.id)
  assert.equal(users(result).length, 2)
})

test('the same client ID in two explicit lifecycle turns is not globally deduplicated', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent(), lifecycle('task_complete'),
    lifecycle('task_started', 'second-explicit-turn'), userEvent(clientId, text, secondAt)])
  const rows = users(await file.read()).filter(({ item }) => item.clientId === clientId)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ turn }) => turn.id), [turnId, 'second-explicit-turn'])
  assert.equal(new Set(rows.map(({ item }) => item.id)).size, 2)
})

test('a partial trailing JSON line is reread completely without losing the eventual user identity', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent()])
  const serialized = JSON.stringify(userEvent('partial-line-client', text, secondAt))
  const split = Math.floor(serialized.length / 2)
  await file.appendRaw(serialized.slice(0, split))
  const first = await file.read()
  assert.equal(users(first).length, 1)
  await file.appendRaw(`${serialized.slice(split)}\n`)
  const result = await file.read()
  assert.equal(users(result).length, 2)
  assert.equal(identified(result, 'partial-line-client').turn.id, turnId)
})

test('truncating a cached file never carries its prior task scope into the replacement content', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent(), assistantEvent()])
  await file.read()
  await file.rewrite([userEvent('truncated-client')])
  const result = await file.read()
  assert.equal(users(result).length, 1)
  assert.notEqual(identified(result, 'truncated-client').turn.id, turnId)
  assert.equal(users(result).some(({ item }) => item.clientId === clientId), false)
})

test('same-path replacement with an identical prefix and more bytes does not inherit the old scope or cached users', async (t) => {
  const prefix = { timestamp: at, type: 'session_meta', payload: { id: threadId, timestamp: at, source: 'fixture' } }
  const file = await fixture(t, [prefix, lifecycle('task_started'), userEvent()])
  await file.read()
  await file.replace([prefix, userEvent('replacement-client', `${text} ${'replacement '.repeat(80)}`)])
  const result = await file.read()
  assert.equal(users(result).length, 1)
  assert.notEqual(identified(result, 'replacement-client').turn.id, turnId)
  assert.equal(users(result).some(({ item }) => item.clientId === clientId), false)
})

test('same-size same-mtime same-path replacement invalidates cached client identity', async (t) => {
  const file = await fixture(t, [userEvent('old-client-aa')])
  await file.read()
  await file.replace([userEvent('new-client-bb')], true)
  const rows = users(await file.read())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].item.clientId, 'new-client-bb')
})

test('identified image-only events preserve safe local_images and survive incremental cache cloning', async (t) => {
  const event = userEvent(clientId, '')
  event.payload.local_images = ['C:/fixture/local.png', { path: 'C:/fixture/not-a-string.png' }, '', 'https://remote.invalid/not-local.png']
  event.payload.images = ['https://remote.invalid/remote.png']
  const file = await fixture(t, [lifecycle('task_started'), event])
  const first = identified(await file.read())
  assert.deepEqual(first.item.content, [{ type: 'localImage', path: 'C:/fixture/local.png' }])
  assert.equal(first.turn.id, turnId)
  await file.append([assistantEvent()])
  const after = identified(await file.read())
  assert.equal(after.item.id, first.item.id)
  assert.deepEqual(after.item.content, first.item.content)
  assert.equal(after.item.recoverySource, 'event_msg')
})

test('event image-path markup preserves the existing local image format without treating remote images as local files', async (t) => {
  const event = userEvent(clientId, 'Inspect <image name="Image #1" path="C:/fixture/markup.png"></image>')
  event.payload.images = ['https://remote.invalid/remote.png']
  const file = await fixture(t, [event])
  const row = identified(await file.read())
  assert.deepEqual(row.item.content, [
    { type: 'text', text: 'Inspect' }, { type: 'localImage', path: 'C:/fixture/markup.png' },
  ])
})

for (const lineEnding of ['\n', '\r\n']) {
  test(`UTF-8 ${lineEnding === '\n' ? 'LF' : 'CRLF'} full and incremental file reads use equal byte-offset identities`, async (t) => {
    const first = [lifecycle('task_started'), userEvent(clientId, '你好，消息🙂 café')]
    const second = [userEvent('unicode-second-client', '继续检查：日本語 Ω', secondAt), lifecycle('task_complete')]
    const incremental = await fixture(t, first, lineEnding)
    await incremental.read({ fromStart: true })
    await incremental.append(second)
    const full = await fixture(t, [...first, ...second], lineEnding)
    const select = (result) => users(result).map(({ turn, item }) => ({
      turnId: turn.id, id: item.id, clientId: item.clientId, content: item.content,
    }))
    const appended = select(await incremental.read({ fromStart: true }))
    assert.deepEqual(appended, select(await full.read({ fromStart: true })))
    assert.deepEqual(appended.map((item) => item.clientId), [clientId, 'unicode-second-client'])
  })
}

test('a complete trailing JSON object without newline keeps its identity when the line is later terminated', async (t) => {
  const file = await fixture(t, [])
  await file.rewriteRaw(`${encode([lifecycle('task_started')])}${JSON.stringify(userEvent())}`)
  const first = identified(await file.read())
  assert.equal(first.turn.id, turnId)
  await file.appendRaw(`\n${encode([userEvent('following-complete-line', text, secondAt)])}`)
  const result = await file.read()
  const retained = identified(result)
  assert.equal(retained.item.id, first.item.id)
  assert.equal(users(result).length, 2)
  assert.equal(identified(result, 'following-complete-line').turn.id, turnId)
})

test('a later equal-text response cannot erase or take ownership of a preceding identified event', async (t) => {
  const response = userResponse()
  const file = await fixture(t, [lifecycle('task_started'), userEvent(), response])
  const result = await file.read()
  const row = identified(result)
  assert.equal(row.item.recoverySource, 'event_msg')
  assert.notEqual(row.item.id, response.payload.id)
  const responseItem = users(result).find(({ item }) => item.id === response.payload.id)
  if (responseItem) assert.equal(responseItem.item.clientId, undefined)
})

test('same-client same-turn duplicate event records remain separate rather than globally deduplicated', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent(), userEvent()])
  const rows = users(await file.read()).filter(({ item }) => item.clientId === clientId)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(({ turn }) => turn.id), [turnId, turnId])
  assert.equal(new Set(rows.map(({ item }) => item.id)).size, 2)
})

test('malformed candidate JSON fails task scope closed until the next terminal boundary', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent()])
  await file.appendRaw('{"timestamp":"2026-09-10T10:59:42.000Z","type":"event_msg","payload":\n')
  await file.append([userEvent('after-malformed', text, secondAt), lifecycle('task_complete'),
    lifecycle('task_started', 'recovered-safe-turn'), userEvent('after-safe-restart', text, '2026-09-10T10:59:43.318Z')])
  const result = await file.read()
  assert.equal(identified(result).turn.id, turnId)
  assert.notEqual(identified(result, 'after-malformed').turn.id, turnId,
    'a malformed candidate may hide a lifecycle boundary, so later ownership cannot be guessed')
  assert.equal(identified(result, 'after-safe-restart').turn.id, 'recovered-safe-turn')
})

test('unrecognized malformed log records invalidate an otherwise active task scope', async (t) => {
  const file = await fixture(t, [lifecycle('task_started'), userEvent()])
  await file.appendRaw('not valid JSON; a missing lifecycle boundary may be here\n')
  await file.append([userEvent('after-unrecognized-record', 'After damaged log record', secondAt)])
  const result = await file.read({ fromStart: true })
  assert.equal(identified(result).turn.id, turnId)
  assert.notEqual(identified(result, 'after-unrecognized-record').turn.id, turnId)
})

test('a rewrite after actual stream parsing but before the second checkpoint cannot seed an old task scope', async (t) => {
  const oldEntries = [lifecycle('task_started', 'turn-old'), userEvent('client-old', 'Before rewrite')]
  const newEntries = [lifecycle('task_started', 'turn-new'), userEvent('client-new', 'Before rewrite')]
  assert.equal(Buffer.byteLength(encode(oldEntries)), Buffer.byteLength(encode(newEntries)))
  const file = await fixture(t, oldEntries)
  const originalOpen = fsPromises.open
  const originalCreateReadStream = fs.createReadStream
  let checkpointOpens = 0
  let actualStream
  let swappedAfterParsing = false
  fs.createReadStream = (...args) => {
    const stream = originalCreateReadStream(...args)
    if (args[0] === file.path) actualStream = stream
    return stream
  }
  fsPromises.open = async (...args) => {
    if (args[0] === file.path && args[1] === 'r') {
      checkpointOpens += 1
      // First open captures the pre-read checkpoint. The second occurs after
      // the actual bounded stream has been consumed, before the post-read
      // checkpoint. Do not move the rewrite to the first open: that would
      // change the input before parsing and fail to exercise the cache race.
      if (checkpointOpens === 2) {
        assert.ok(actualStream?.readableEnded, 'rewrite must occur after real stream parsing has ended')
        await file.rewrite(newEntries)
        swappedAfterParsing = true
      }
    }
    return originalOpen(...args)
  }
  syncBuiltinESMExports()
  let first
  try { first = await file.read({ fromStart: true }) }
  finally {
    fsPromises.open = originalOpen
    fs.createReadStream = originalCreateReadStream
    syncBuiltinESMExports()
  }
  assert.equal(checkpointOpens, 2, 'the fixture must hit pre-read and post-read checkpoint opens exactly')
  assert.equal(swappedAfterParsing, true)
  assert.equal(identified(first, 'client-old').turn.id, 'turn-old', 'first result really came from the old parsed bytes')
  await file.append([userEvent('client-after-rewrite', 'After rewrite', secondAt)])
  const after = await file.read({ fromStart: true })
  assert.equal(identified(after, 'client-new').turn.id, 'turn-new')
  assert.equal(identified(after, 'client-after-rewrite').turn.id, 'turn-new')
  assert.equal(users(after).some(({ item }) => item.clientId === 'client-old'), false)
})

test('ordinary append during the real bounded stream retains scope and resumes incrementally without losing records', async (t) => {
  const initial = [lifecycle('task_started'), userEvent()]
  const oldByteEnd = Buffer.byteLength(encode(initial))
  const file = await fixture(t, initial)
  const originalCreateReadStream = fs.createReadStream
  const readStarts = []
  let appendedDuringStream = false
  fs.createReadStream = (...args) => {
    const stream = originalCreateReadStream(...args)
    if (args[0] !== file.path) return stream
    readStarts.push(args[1]?.start ?? 0)
    const actualIterator = stream[Symbol.asyncIterator].bind(stream)
    stream[Symbol.asyncIterator] = async function* () {
      for await (const chunk of actualIterator()) {
        if (!appendedDuringStream) {
          assert.equal(readStarts.length, 1)
          assert.ok(Buffer.isBuffer(chunk) && chunk.length > 0, 'inject only while consuming a real file-stream chunk')
          await file.append([userEvent('normal-append-client', 'Appended while the initial stream was open', secondAt)])
          appendedDuringStream = true
        }
        yield chunk // Preserve the real stream bytes and ordering unchanged.
      }
    }
    return stream
  }
  syncBuiltinESMExports()
  let first
  let after
  try {
    first = await file.read({ fromStart: true })
    assert.equal(appendedDuringStream, true)
    assert.equal(users(first).length, 1, 'the first fixed byte range excludes the concurrent append')
    after = await file.read({ fromStart: true })
  } finally {
    fs.createReadStream = originalCreateReadStream
    syncBuiltinESMExports()
  }
  assert.deepEqual(readStarts, [0, oldByteEnd], 'normal append must keep the valid checkpoint and use the original byte boundary')
  assert.equal(users(after).length, 2)
  assert.equal(identified(after).item.id, identified(first).item.id)
  assert.equal(identified(after).turn.id, turnId)
  assert.equal(identified(after, 'normal-append-client').turn.id, turnId)
})
