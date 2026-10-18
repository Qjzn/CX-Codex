import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'

function runVerifier(t, resolved) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'cx-codex-dependency-security-'))
  t.after(() => {
    const withinTemp = relative(tmpdir(), fixtureRoot)
    assert.ok(withinTemp && !withinTemp.startsWith('..') && !isAbsolute(withinTemp))
    rmSync(fixtureRoot, { recursive: true, force: true })
  })
  mkdirSync(join(fixtureRoot, 'scripts'))
  const scriptPath = join(fixtureRoot, 'scripts', 'verify-dependency-security.mjs')
  copyFileSync(new URL('./verify-dependency-security.mjs', import.meta.url), scriptPath)
  writeFileSync(join(fixtureRoot, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'dependency-security-fixture' },
      'node_modules/yauzl': { version: '2.10.0', resolved },
    },
  }))
  const npmCliPath = join(fixtureRoot, 'fake-npm.cjs')
  writeFileSync(npmCliPath, `
const { writeFileSync } = require('node:fs')
if (process.argv[2] === '--version') console.log('10.9.3')
else {
  writeFileSync('audit-called', '')
  console.log(JSON.stringify({ metadata: { vulnerabilities: { total: 0 }, dependencies: { total: 1 } } }))
}
`)
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: npmCliPath },
  })
  assert.ifError(result.error)
  return { ...result, auditCalled: existsSync(join(fixtureRoot, 'audit-called')) }
}

test('rejects mirror tarballs before running npm audit', (t) => {
  const result = runVerifier(t, 'https://registry.npmmirror.com/yauzl/-/yauzl-2.10.0.tgz')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /node_modules\/yauzl.*https:\/\/registry\.npmjs\.org/)
  assert.equal(result.auditCalled, false)
})

test('audits official registry tarballs and allows entries without resolved URLs', (t) => {
  const result = runVerifier(t, 'https://registry.npmjs.org/@scope/yauzl/-/yauzl-2.10.0.tgz')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.auditCalled, true)
  assert.match(result.stdout, /0 vulnerabilities/)
})

for (const resolved of [
  'https://registry.npmjs.org.example.com/yauzl.tgz',
  'http://registry.npmjs.org/yauzl.tgz',
  'https://registry.npmjs.org:8443/yauzl.tgz',
  'https://user:secret@registry.npmjs.org/yauzl.tgz',
  'not a URL',
]) {
  test(`rejects non-official or credential-bearing URL: ${resolved.replace('user:secret@', '')}`, (t) => {
    const result = runVerifier(t, resolved)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.equal(result.auditCalled, false)
    assert.doesNotMatch(result.stderr, /user:secret/)
  })
}
