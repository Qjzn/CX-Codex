import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const output = resolve('output/session-path-resolver-tests')
await fs.mkdir(output, { recursive: true })
const compiled = await build({
  entryPoints: ['src/server/codexSessionPathResolver.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports,
)
const { resolveCodexSessionLogPath: discover } = module.exports
const ID = '111111aa-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const meta = (id) => `${JSON.stringify({ type: 'session_meta', payload: { id } })}\n`

async function home() {
  const root = await fs.mkdtemp(join(output, 'home-'))
  await fs.mkdir(join(root, 'sessions'))
  await fs.mkdir(join(root, 'archived_sessions'))
  return root
}

async function log(root, name = 'old', id = ID, metadataId = id, at = 1000) {
  const path = join(root, 'sessions', `rollout-${name}-${id}.jsonl`)
  await fs.writeFile(path, meta(metadataId))
  await fs.utimes(path, new Date(at), new Date(at))
  return path
}

async function withReaddir(wrapper, run) {
  const original = fs.readdir
  fs.readdir = (...args) => wrapper(original, ...args)
  syncBuiltinESMExports()
  try { await run() } finally { fs.readdir = original; syncBuiltinESMExports() }
}

test('20 concurrent same-home discoveries enumerate a synthetic 10k-entry listing once', async () => {
  const root = await home()
  const expected = await log(root)
  let reads = 0
  let visitedEntries = 0
  const syntheticEntries = Array.from({ length: 10_000 }, (_, index) => ({
    name: `unrelated-${index}.jsonl`,
    isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true,
  }))
  await withReaddir(async (original, path, options) => {
    reads++
    const actual = await original(path, options)
    const entries = path === join(root, 'sessions') ? [...actual, ...syntheticEntries] : actual
    visitedEntries += entries.length
    return entries
  }, async () => {
    assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => discover(ID, root))), Array(20).fill(expected))
  })
  assert.equal(reads, 2, 'only sessions and archived_sessions should be enumerated once')
  assert.equal(visitedEntries, 10_001, '10k synthetic entries must not be processed once per caller')
})

test('keys isolate homes and thread IDs while normalizing home paths and UUIDs', async () => {
  const first = await home()
  const second = await home()
  const firstId = await log(first)
  const firstOther = await log(first, 'other', OTHER)
  const secondId = await log(second)
  let reads = 0
  await withReaddir(async (original, ...args) => { reads++; return original(...args) }, async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => [
      discover(ID, first), discover(` ${ID.toUpperCase()} `, join(first, 'unused', '..')),
      discover(OTHER, first), discover(ID, second),
    ]).flat())
    for (let index = 0; index < results.length; index += 4) {
      assert.deepEqual(results.slice(index, index + 4), [firstId, firstId, firstOther, secondId])
    }
  })
  assert.equal(reads, 6, 'three distinct home/thread keys each enumerate two roots')
})

test('rejected discoveries are shared and cleared so a later request retries', async () => {
  const root = await home()
  const expected = await log(root)
  let attempts = 0
  await withReaddir(async () => {
    attempts++
    throw Object.assign(new Error('synthetic directory denied'), { code: 'EACCES' })
  }, async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => discover(ID, root)))
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason.code === 'EACCES'))
  })
  assert.equal(attempts, 1)
  assert.equal(await discover(ID, root), expected)
})

test('empty and successful discoveries expire immediately for new files and shard rotation', async () => {
  const root = await home()
  assert.deepEqual(await Promise.all([discover(ID, root), discover(ID, root)]), ['', ''])
  const old = await log(root)
  assert.equal(await discover(ID, root), old)
  const latest = await log(root, 'latest', ID, ID, 2000)
  assert.equal(await discover(ID, root), latest)
  await log(root, 'newest-wrong-identity', ID, OTHER, 3000)
  assert.equal(await discover(ID, root), latest, 'filename hints must not bypass metadata identity')
})

test('invalid IDs perform no filesystem enumeration', async () => {
  const root = await home()
  await withReaddir(async () => { throw new Error('invalid IDs must not enumerate') }, async () => {
    assert.equal(await discover('../outside', root), '')
    assert.equal(await discover('not-a-uuid', root), '')
  })
})

test('concurrent discovery rejects redirected session roots and directory links', async () => {
  const root = await home()
  const outside = await home()
  const outsideLog = await log(outside)
  await fs.symlink(join(outside, 'sessions'), join(root, 'sessions', 'redirected'), process.platform === 'win32' ? 'junction' : 'dir')
  await fs.rmdir(join(root, 'archived_sessions'))
  await fs.symlink(join(outside, 'sessions'), join(root, 'archived_sessions'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => discover(ID, root))), Array(20).fill(''))
  assert.equal(await fs.readFile(outsideLog, 'utf8'), meta(ID))
})

test('concurrent discovery rejects file symlinks', async (context) => {
  const root = await home()
  const outside = await home()
  const outsideLog = await log(outside)
  try { await fs.symlink(outsideLog, join(root, 'sessions', `rollout-${ID}.jsonl`), 'file') }
  catch (error) {
    if (error.code === 'EPERM') { context.skip('host does not grant file symlink creation'); return }
    throw error
  }
  assert.deepEqual(await Promise.all([discover(ID, root), discover(ID, root)]), ['', ''])
})
