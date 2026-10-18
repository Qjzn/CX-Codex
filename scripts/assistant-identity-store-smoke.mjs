// A1 assistant identity store smoke: exercises the REAL RuntimeStore class.
//
// The bundle is produced from src/server/runtimeStore.ts with esbuild
// (platform node, format ESM, better-sqlite3 kept external) and imported
// through a file URL, so the smoke can never drift onto a hand-rolled mock.
//
// All run artifacts (bundle, SQLite database, report) stay under the A1 task
// output directory: output/hermes-codex-upgrade-20261015/followup-20261016/.
// Nothing is written under the real user home and the run directory is kept.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const taskOutputRoot = join(repoRoot, 'output', 'hermes-codex-upgrade-20261015', 'followup-20261016')
const runRoot = join(taskOutputRoot, `a1-store-smoke-${Date.now()}-${process.pid}`)
mkdirSync(runRoot, { recursive: true })

const entryPath = join(repoRoot, 'src', 'server', 'runtimeStore.ts')
const bundlePath = join(runRoot, 'runtimeStore.bundle.mjs')

await esbuild.build({
  entryPoints: [entryPath],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  logLevel: 'warning',
})

// Synthetic child home: the real OS profile must never be touched even though
// RuntimeStore imports node:os. This smoke always passes an explicit dbPath.
const testUserHome = join(runRoot, 'test-user-home')
mkdirSync(testUserHome, { recursive: true })
if (process.platform === 'win32') {
  process.env.USERPROFILE = testUserHome
} else {
  process.env.HOME = testUserHome
}

const { RuntimeStore } = await import(pathToFileURL(bundlePath).href)
const { default: Database } = await import('better-sqlite3')

assert.equal(typeof RuntimeStore, 'function', 'runtimeStore bundle must export the RuntimeStore class')

const dbPath = join(runRoot, 'db', 'assistant-identity.sqlite')
mkdirSync(join(runRoot, 'db'), { recursive: true })

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: String((error && error.message) || error) })
  }
}

function openRaw() {
  return new Database(dbPath, { readonly: true })
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value

const storeA = new RuntimeStore(dbPath)
const storeB = new RuntimeStore(dbPath)

let created = null
let createdId = ''
let createdCreatedAt = ''
let revisionAfterCreate = 0

test('fresh database reads null identity and does not insert a row', () => {
  assert.equal(storeA.readAssistantIdentity(), null)
  const raw = openRaw()
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM assistant_identity').get().n, 0)
  } finally {
    raw.close()
  }
})

test('first write creates a stable UUID at revision 1 with ISO timestamps', () => {
  const result = storeA.writeAssistantIdentity({ name: '  CX Codex Assistant  ', cwd: 'E:/workspace/demo', revision: null })
  assert.equal(result.status, 'saved')
  const identity = result.identity
  assert.match(identity.assistantId, UUID_RE)
  assert.equal(identity.name, 'CX Codex Assistant')
  assert.equal(identity.cwd, 'E:/workspace/demo')
  assert.equal(identity.revision, 1)
  assert.ok(isIso(identity.createdAt), `createdAt not ISO: ${identity.createdAt}`)
  assert.ok(isIso(identity.updatedAt), `updatedAt not ISO: ${identity.updatedAt}`)
  assert.equal(identity.updatedAt, identity.createdAt)

  const readBack = storeA.readAssistantIdentity()
  assert.deepEqual(readBack, identity)
  created = identity
  createdId = identity.assistantId
  createdCreatedAt = identity.createdAt
  revisionAfterCreate = identity.revision
})

test('second create on the same database conflicts with the existing singleton', () => {
  const result = storeA.writeAssistantIdentity({ name: 'Other Assistant', cwd: 'E:/workspace/other', revision: null })
  assert.equal(result.status, 'conflict')
  assert.ok(result.identity, 'conflict must return the existing identity')
  assert.equal(result.identity.assistantId, createdId)
  assert.equal(result.identity.revision, 1)
})

test('update at the exact revision increments and preserves id and createdAt', () => {
  const result = storeB.writeAssistantIdentity({ name: 'Renamed Assistant', cwd: 'E:/workspace/renamed', revision: 1 })
  assert.equal(result.status, 'saved')
  assert.equal(result.identity.assistantId, createdId)
  assert.equal(result.identity.createdAt, createdCreatedAt)
  assert.equal(result.identity.revision, 2)
  assert.equal(result.identity.name, 'Renamed Assistant')
  assert.equal(result.identity.cwd, 'E:/workspace/renamed')
  assert.ok(result.identity.updatedAt >= createdCreatedAt)
  revisionAfterCreate = 2
  createdId = result.identity.assistantId
})

test('stale expected revision conflicts and leaves the row unchanged', () => {
  const before = storeA.readAssistantIdentity()
  const result = storeA.writeAssistantIdentity({ name: 'Stale Writer', cwd: 'E:/workspace/stale', revision: 1 })
  assert.equal(result.status, 'conflict')
  assert.equal(result.identity.revision, before.revision)
  const after = storeA.readAssistantIdentity()
  assert.deepEqual(after, before)
})

test('two overlapping connections: only one write at the same expected revision wins', () => {
  const expected = storeA.readAssistantIdentity().revision
  const first = storeA.writeAssistantIdentity({ name: 'Winner A', cwd: 'E:/workspace/a', revision: expected })
  const second = storeB.writeAssistantIdentity({ name: 'Loser B', cwd: 'E:/workspace/b', revision: expected })
  assert.equal(first.status, 'saved')
  assert.equal(first.identity.revision, expected + 1)
  assert.equal(second.status, 'conflict')
  assert.equal(second.identity.revision, expected + 1)
  assert.equal(second.identity.name, 'Winner A')

  const reverseExpected = first.identity.revision
  const reverseFirst = storeA.writeAssistantIdentity({ name: 'Winner A2', cwd: 'E:/workspace/a2', revision: reverseExpected })
  const reverseSecond = storeB.writeAssistantIdentity({ name: 'Loser B2', cwd: 'E:/workspace/b2', revision: reverseExpected })
  assert.equal(reverseFirst.status, 'saved')
  assert.equal(reverseSecond.status, 'conflict')
  assert.equal(reverseSecond.identity.revision, reverseExpected + 1)
  assert.equal(reverseSecond.identity.name, 'Winner A2')

  const raw = openRaw()
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM assistant_identity').get().n, 1)
  } finally {
    raw.close()
  }
})

test('malformed input rejects with TypeError and never mutates the row', () => {
  const before = storeA.readAssistantIdentity()
  const badNames = ['', '   ', 'x'.repeat(81), 42, null, undefined]
  for (const name of badNames) {
    assert.throws(() => storeA.writeAssistantIdentity({ name, cwd: 'E:/workspace/demo', revision: null }), TypeError, `name=${JSON.stringify(name)}`)
  }
  const badCwds = ['', '   ', 7, null]
  for (const cwd of badCwds) {
    assert.throws(() => storeA.writeAssistantIdentity({ name: 'Valid Name', cwd, revision: null }), TypeError, `cwd=${JSON.stringify(cwd)}`)
  }
  const badRevisions = ['1', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined, true]
  for (const revision of badRevisions) {
    assert.throws(() => storeA.writeAssistantIdentity({ name: 'Valid Name', cwd: 'E:/workspace/demo', revision }), TypeError, `revision=${String(revision)}`)
  }
  assert.deepEqual(storeA.readAssistantIdentity(), before)
})

test('reopened store on the same file sees the identical identity', () => {
  const snapshot = storeA.readAssistantIdentity()
  storeA.close()
  storeB.close()
  const reopened = new RuntimeStore(dbPath)
  try {
    assert.deepEqual(reopened.readAssistantIdentity(), snapshot)
    assert.equal(reopened.readAssistantIdentity().assistantId, createdId)
  } finally {
    reopened.close()
  }
})

test('identity writes never fabricate runtime rows or extra tables', () => {
  const raw = openRaw()
  try {
    const names = tableNames(raw)
    assert.ok(names.includes('assistant_identity'), `assistant_identity missing: ${names.join(',')}`)
    assert.ok(names.includes('runtime_requests'), 'runtime_requests missing')
    assert.ok(names.includes('runtime_events'), 'runtime_events missing')
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM runtime_requests').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM runtime_events').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM assistant_identity').get().n, 1)
    const row = raw.prepare('SELECT * FROM assistant_identity').get()
    assert.equal(row.singleton, 1)
    assert.equal(row.revision, storeBReopenRevision())
    assert.equal(row.assistant_id, createdId)
    const columns = Object.keys(row)
    for (const forbidden of ['capabilities', 'role', 'thread_id', 'turn_id']) {
      assert.ok(!columns.includes(forbidden), `unexpected column ${forbidden}`)
    }
  } finally {
    raw.close()
  }
})

function storeBReopenRevision() {
  const probe = new RuntimeStore(dbPath)
  try {
    return probe.readAssistantIdentity().revision
  } finally {
    probe.close()
  }
}

const failed = results.filter((entry) => !entry.ok)
const report = {
  task: 'A1 assistant identity store smoke',
  bundle: bundlePath,
  database: dbPath,
  runRoot,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}
writeFileSync(join(runRoot, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

for (const entry of results) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : ` -> ${entry.error}`}`)
}
console.log(`\nA1 identity store smoke: ${report.passed}/${report.total} passed`)
console.log(`runRoot=${runRoot}`)

if (failed.length > 0) {
  process.exitCode = 1
}
