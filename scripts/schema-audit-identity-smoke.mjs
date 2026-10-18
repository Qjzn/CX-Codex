#!/usr/bin/env node
// B4C identity smoke: exercises the schema-audit updater (provenance round-trip + content-diff driven
// review status) and the PowerShell audit script (frozen target / provenance / failure preservation)
// with synthetic fixtures only. No real Codex runtime, no model, no app-server, no network.
//
// Every fixture, fake launcher, raw summary and output directory is confined to a fresh per-run
// output/hermes-codex-upgrade-20261015/b4c-identity-smoke-<stamp>-<pid> root, which is never deleted
// (prior runs stay on disk as evidence). Fixtures never come from, and never write to,
// docs/app-server-schema-audit-summary.json or documentation/app-server-schemas/**.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
// Every run gets its own fresh, unique, task-owned output root. Prior evidence is never deleted: each
// run keeps its raw summaries, launcher logs, per-stage records and child stdout/stderr side by side.
const runStamp = `${new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+$/u, '').replace('T', '-')}-${process.pid}`
const outputRoot = join(repoRoot, 'output', 'hermes-codex-upgrade-20261015', `b4c-identity-smoke-${runStamp}`)
const outputRootRelative = relative(repoRoot, outputRoot).split(sep).join('/')
const evidenceDir = join(outputRoot, 'evidence')
const updaterScript = join(repoRoot, 'scripts', 'update-app-server-schema-audit-summary.mjs')
const auditScript = join(repoRoot, 'scripts', 'audit-app-server-schemas.ps1')
const docsSummaryPath = join(repoRoot, 'docs', 'app-server-schema-audit-summary.json')

const PS_BASE_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass']
const UPDATER_TIMEOUT_MS = 60_000
const AUDIT_TIMEOUT_MS = 180_000
const NATIVE_SHA_UPPER = 'DD13BDB162A184FA04039488B234A8258EF9B76F84E926C505D5742B19249A6A'


let failures = 0
let skipped = 0
let invocationValidator = null

function check(label, run) {
  try {
    run()
    console.log(`ok - ${label}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${label}`)
    console.error(error && error.stack ? error.stack : String(error))
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

function sha256OfFile(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Writes a synthetic launcher/summary fixture. `lines` is the complete file body: the previous
 * two-list signature was called with a single list, so spreading the (undefined) second list threw
 * before any PowerShell case could run.
 */
function writeCmd(path, lines) {
  assert.ok(invocationValidator, 'Strict invocation validator must exist before a fake launcher')
  const guarded = [lines[0], `"${process.execPath}" "${invocationValidator}" %*`,
    'if errorlevel 1 exit /b 41', ...lines.slice(1)]
  writeFileSync(path, guarded.join('\r\n') + '\r\n', 'latin1')
}

/**
 * Keeps each child's real exit/status, stdout and stderr inside this run's fresh output root, so a
 * failing check can be audited from the evidence alone instead of a live re-run.
 */
function recordEvidence(label, result) {
  mkdirSync(evidenceDir, { recursive: true })
  const record = {
    label,
    status: result.status ?? null,
    signal: result.signal ?? null,
    error: result.error ? String(result.error.message ?? result.error) : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
  const fileName = `${label.replace(/[^A-Za-z0-9._-]+/gu, '-')}.json`
  writeFileSync(join(evidenceDir, fileName), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

function comparisonWith(counts) {
  return {
    typescriptRoot: { baselineCount: counts, generatedCount: counts, addedCount: 0, removedCount: 0 },
    typescriptV2: { baselineCount: counts, generatedCount: counts, addedCount: 0, removedCount: 0 },
    jsonRoot: { baselineCount: counts, generatedCount: counts, addedCount: 0, removedCount: 0 },
    jsonV2: { baselineCount: counts, generatedCount: counts, addedCount: 0, removedCount: 0 },
  }
}

function buildNativeProvenance() {
  return {
    launchPath: 'E:/b4c-fixture/codex.exe',
    versionRaw: 'codex-cli 0.162.1\r\n',
    sha256: NATIVE_SHA_UPPER,
    identityKind: 'native',
    selectionSource: 'explicit',
    verification: { status: 'verified', reason: '' },
    generation: {
      status: 'complete',
      mode: 'app-server generate-ts + app-server generate-json-schema',
      args: ['app-server', 'generate-ts'],
    },
    baseline: {
      typescript: 'documentation/app-server-schemas/typescript',
      json: 'documentation/app-server-schemas/json',
    },
    generated: {
      typescript: `${outputRootRelative}/generated/typescript`,
      json: `${outputRootRelative}/generated/json`,
    },
  }
}

function runUpdater(rawPath, outputPath) {
  // `process.execPath` keeps the root's own Node 22 interpreter explicit — never a bare `node`.
  const result = spawnSync(process.execPath, [updaterScript, '--input', rawPath, '--output', outputPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: UPDATER_TIMEOUT_MS,
  })
  recordEvidence(`updater-${basename(outputPath)}`, result)
  assert.equal(result.error, undefined, `updater could not run: ${result.error ? String(result.error.message) : ''}`)
  assert.equal(result.status, 0, `updater exited ${String(result.status)}: ${result.stderr || ''}`)
  assert.ok(existsSync(outputPath), `updater did not write ${outputPath}`)
  return readJson(outputPath)
}

function selectPowerShell() {
  const candidates = [
    process.env.CX_CODEX_POWERSHELL_COMMAND,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') : '',
    'pwsh',
    'powershell.exe',
    'powershell',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, [...PS_BASE_ARGS, '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    if (!probe.error && probe.status === 0) {
      return candidate
    }
  }
  return null
}

function newestAuditSummary(auditOutputRoot) {
  const base = join(repoRoot, auditOutputRoot)
  assert.ok(existsSync(base), `audit output root missing: ${base}`)
  const stamps = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.ok(stamps.length > 0, `no audit run directory under ${base}`)
  const summaryPath = join(base, stamps[stamps.length - 1], 'audit-summary.json')
  assert.ok(existsSync(summaryPath), `audit summary missing: ${summaryPath}`)
  return readJson(summaryPath)
}

// --- fixtures --------------------------------------------------------------

// This run's fresh unique root is created and used as-is: no previous run's evidence is deleted.
mkdirSync(outputRoot, { recursive: true })
mkdirSync(evidenceDir, { recursive: true })
const rawDir = join(outputRoot, 'raw')
const outDir = join(outputRoot, 'out')
mkdirSync(rawDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

// --- updater ---------------------------------------------------------------

check('updater round-trips generatedBy provenance and keeps raw version stdout', () => {
  const rawPath = join(rawDir, 'round-trip.json')
  const outputPath = join(outDir, 'round-trip.summary.json')
  writeJson(rawPath, {
    generatedAtIso: '2026-10-16T00:00:00.000Z',
    codexCommand: 'E:/b4c-fixture/codex.exe',
    auditRoot: `${outputRootRelative}/ps-audit/example`,
    baseline: {
      typescript: 'documentation/app-server-schemas/typescript',
      json: 'documentation/app-server-schemas/json',
    },
    generatedBy: buildNativeProvenance(),
    comparison: comparisonWith(3),
    contentDiff: {
      status: 'complete',
      typescript: { status: 'matched', exitCode: 0 },
      json: { status: 'matched', exitCode: 0 },
    },
  })

  const summary = runUpdater(rawPath, outputPath)
  assert.equal(summary.reviewStatus, 'baseline-matched')
  assert.deepEqual(summary.generatedBy, buildNativeProvenance())
  assert.equal(summary.generatedBy.versionRaw, 'codex-cli 0.162.1\r\n')
  assert.equal(summary.generatedBy.sha256, NATIVE_SHA_UPPER)
  assert.deepEqual(summary.contentDiff, {
    status: 'complete',
    typescript: { status: 'matched', exitCode: 0 },
    json: { status: 'matched', exitCode: 0 },
  })
})

check('updater records drift when content differs with identical name counts', () => {
  const rawPath = join(rawDir, 'same-count-drift.json')
  const outputPath = join(outDir, 'same-count-drift.summary.json')
  writeJson(rawPath, {
    generatedAtIso: '2026-10-16T00:00:00.000Z',
    codexCommand: 'E:/b4c-fixture/codex.exe',
    auditRoot: `${outputRootRelative}/ps-audit/example`,
    baseline: { typescript: 'documentation/app-server-schemas/typescript', json: 'documentation/app-server-schemas/json' },
    generatedBy: buildNativeProvenance(),
    comparison: comparisonWith(3),
    contentDiff: {
      status: 'complete',
      typescript: { status: 'drift', exitCode: 1 },
      json: { status: 'matched', exitCode: 0 },
    },
  })

  const summary = runUpdater(rawPath, outputPath)
  assert.equal(summary.reviewStatus, 'drift-recorded')
})

check('updater keeps unknown for an errored or missing content diff', () => {
  const erroredRaw = join(rawDir, 'content-error.json')
  const erroredOut = join(outDir, 'content-error.summary.json')
  writeJson(erroredRaw, {
    generatedAtIso: '2026-10-16T00:00:00.000Z',
    codexCommand: 'E:/b4c-fixture/codex.exe',
    baseline: { typescript: 'documentation/app-server-schemas/typescript', json: 'documentation/app-server-schemas/json' },
    generatedBy: buildNativeProvenance(),
    comparison: comparisonWith(3),
    contentDiff: {
      status: 'failed',
      typescript: { status: 'error', exitCode: 128 },
      json: { status: 'matched', exitCode: 0 },
    },
  })
  assert.equal(runUpdater(erroredRaw, erroredOut).reviewStatus, 'unknown')

  const legacyRaw = join(rawDir, 'legacy-no-content-diff.json')
  const legacyOut = join(outDir, 'legacy-no-content-diff.summary.json')
  writeJson(legacyRaw, {
    generatedAtIso: '2026-08-07T22:06:55.8568574Z',
    codexCommand: 'codex',
    baseline: { typescript: 'documentation/app-server-schemas/typescript', json: 'documentation/app-server-schemas/json' },
    comparison: comparisonWith(4),
  })
  const legacySummary = runUpdater(legacyRaw, legacyOut)
  assert.equal(legacySummary.reviewStatus, 'unknown')
  assert.equal(legacySummary.generatedBy, null)
  assert.equal(legacySummary.contentDiff, null)
})

check('updater never inherits identity from an existing output summary', () => {
  const outputPath = join(outDir, 'no-inherit.summary.json')
  writeJson(outputPath, {
    generatedAtIso: '2026-10-01T00:00:00.000Z',
    reviewStatus: 'baseline-matched',
    generatedBy: buildNativeProvenance(),
    comparison: comparisonWith(3),
    contentDiff: { status: 'complete', typescript: { status: 'matched', exitCode: 0 }, json: { status: 'matched', exitCode: 0 } },
  })
  const existingBefore = readJson(outputPath)
  assert.ok(existingBefore.generatedBy, 'precondition: existing output has an identity')

  const rawPath = join(rawDir, 'no-identity.json')
  writeJson(rawPath, {
    generatedAtIso: '2026-10-16T00:00:00.000Z',
    codexCommand: 'codex',
    baseline: { typescript: 'documentation/app-server-schemas/typescript', json: 'documentation/app-server-schemas/json' },
    comparison: comparisonWith(3),
    contentDiff: { status: 'complete', typescript: { status: 'matched', exitCode: 0 }, json: { status: 'matched', exitCode: 0 } },
  })

  const summary = runUpdater(rawPath, outputPath)
  assert.equal(summary.generatedBy, null)
})

check('updater leaves the committed docs summary untouched', () => {
  const before = sha256OfFile(docsSummaryPath)
  const rawPath = join(rawDir, 'untouched.json')
  const outputPath = join(outDir, 'untouched.summary.json')
  writeJson(rawPath, {
    generatedAtIso: '2026-10-16T00:00:00.000Z',
    codexCommand: 'E:/b4c-fixture/codex.exe',
    baseline: { typescript: 'documentation/app-server-schemas/typescript', json: 'documentation/app-server-schemas/json' },
    generatedBy: buildNativeProvenance(),
    comparison: comparisonWith(2),
    contentDiff: { status: 'complete', typescript: { status: 'matched', exitCode: 0 }, json: { status: 'matched', exitCode: 0 } },
  })
  runUpdater(rawPath, outputPath)
  assert.equal(sha256OfFile(docsSummaryPath), before, 'docs/app-server-schema-audit-summary.json must not change')
})

// --- PowerShell audit (synthetic launchers only) ---------------------------

const powerShell = selectPowerShell()
if (!powerShell) {
  skipped += 1
  console.log('SKIPPED (unverified) - PowerShell audit launcher fixtures: no usable PowerShell executable found')
} else {
  const launcherDir = join(outputRoot, 'launchers')
  const pathPoisonDir = join(outputRoot, 'path-poison')
  // Every PS output path is derived from this run's actual (fresh, unique) output root.
  const psAuditRoot = `${outputRootRelative}/ps-audit`
  mkdirSync(launcherDir, { recursive: true })
  mkdirSync(pathPoisonDir, { recursive: true })

  const callLogPath = join(launcherDir, 'launcher-calls.log')
  const unexpectedLogPath = join(launcherDir, 'launcher-unexpected.log')
  invocationValidator = join(launcherDir, 'validate-invocation.cjs')
  writeFileSync(invocationValidator, `
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
let valid = args.length === 1 && args[0] === '--version';
if (args.length === 4 && args[0] === 'app-server'
    && ['generate-ts', 'generate-json-schema'].includes(args[1]) && args[2] === '--out'
    && path.isAbsolute(args[3])) {
  try {
    const root = fs.realpathSync(${JSON.stringify(resolve(repoRoot, psAuditRoot))});
    const out = fs.realpathSync(args[3]); const rel = path.relative(root, out);
    valid = Boolean(rel) && !path.isAbsolute(rel) && rel !== '..'
      && !rel.startsWith('..' + path.sep) && fs.statSync(out).isDirectory();
  } catch {}
}
if (!valid) {
  fs.appendFileSync(${JSON.stringify(unexpectedLogPath)}, 'UNEXPECTED ' + JSON.stringify(args) + '\\n');
  process.exit(41);
}
`, { flag: 'wx' })
  // An unexpected invocation is a defect, never a silent success: the fake launchers record it and
  // exit non-zero, and every case asserts the log stayed empty.
  const unexpectedLines = [
    `echo UNEXPECTED %~f0 %* >> "${unexpectedLogPath}"`,
    'exit /b 41',
  ]

  function assertNoUnexpectedInvocations(label) {
    const text = existsSync(unexpectedLogPath) ? readFileSync(unexpectedLogPath, 'utf8').trim() : ''
    assert.equal(text, '', `${label}: fake launcher invoked in an unexpected way: ${text}`)
  }

  const fakeLauncher = join(launcherDir, 'fake-codex.cmd')
  writeCmd(fakeLauncher, [
    '@echo off',
    `echo %~f0 %* >> "${callLogPath}"`,
    'if "%~1"=="--version" goto version',
    'if "%~1"=="app-server" goto gen',
    ...unexpectedLines,
    ':version',
    'echo codex-cli 9.9.9',
    'exit /b 0',
    ':gen',
    'if "%~2"=="generate-ts" (',
    '  echo export type B4cFakeSchema = string;> "%~4\\fake-schema.ts"',
    '  exit /b 0',
    ')',
    'if "%~2"=="generate-json-schema" (',
    '  echo b4c-fake-json-schema> "%~4\\fake-schema.json"',
    '  exit /b 0',
    ')',
    ...unexpectedLines,
  ])

  const poisonLauncher = join(pathPoisonDir, 'fake-codex.cmd')
  writeCmd(poisonLauncher, [
    '@echo off',
    `echo POISON %~f0 %* >> "${callLogPath}"`,
    ...unexpectedLines,
  ])

  const versionFailLauncher = join(launcherDir, 'fake-codex-version-fail.cmd')
  writeCmd(versionFailLauncher, [
    '@echo off',
    'if "%~1"=="--version" exit /b 7',
    ...unexpectedLines,
  ])

  const generateFailLauncher = join(launcherDir, 'fake-codex-generate-ts-fail.cmd')
  writeCmd(generateFailLauncher, [
    '@echo off',
    'if "%~1"=="--version" (',
    '  echo codex-cli 1.0.0',
    '  exit /b 0',
    ')',
    'if "%~2"=="generate-ts" exit /b 3',
    ...unexpectedLines,
  ])

  const changingLauncher = join(launcherDir, 'fake-codex-changes.cmd')
  writeCmd(changingLauncher, [
    '@echo off',
    `echo %~f0 %* >> "${callLogPath}"`,
    'if "%~1"=="--version" goto version',
    'if "%~1"=="app-server" goto gen',
    ...unexpectedLines,
    ':version',
    'echo codex-cli 9.9.9',
    'exit /b 0',
    ':gen',
    'if "%~2"=="generate-ts" (',
    '  echo export type B4cFakeSchema = string;> "%~4\\fake-schema.ts"',
    `  echo rem b4c-mutate>> "${changingLauncher}"`,
    '  exit /b 0',
    ')',
    'if "%~2"=="generate-json-schema" (',
    '  echo b4c-fake-json-schema> "%~4\\fake-schema.json"',
    '  exit /b 0',
    ')',
    ...unexpectedLines,
  ])

  // Bounded child runs: a hung audit is reported as an error instead of blocking the harness, and
  // every child's real status/stdout/stderr is kept as evidence inside this run's output root.
  const runAudit = (label, args, env = {}) => {
    const result = spawnSync(
      powerShell,
      [...PS_BASE_ARGS, '-File', auditScript, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: AUDIT_TIMEOUT_MS,
        env: { ...process.env, ...env },
      },
    )
    recordEvidence(`ps-audit-${label}`, result)
    assert.equal(
      result.error,
      undefined,
      `audit run "${label}" could not complete: ${result.error ? String(result.error.message) : ''}`,
    )
    assert.notEqual(result.status, null, `audit run "${label}" produced no exit status`)
    return result
  }

  check('PS audit freezes the explicit target and publishes launcher-only provenance', () => {
    writeFileSync(callLogPath, '', 'utf8')
    const caseRoot = `${psAuditRoot}/explicit`
    const result = runAudit('explicit', [
      '-CodexCommand', fakeLauncher,
      '-OutputRoot', caseRoot,
    ], {
      // A brand-new PATH candidate must not be able to steal the second phase.
      PATH: `${pathPoisonDir};${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 1, `expected drift exit 1, got ${String(result.status)}: ${result.stderr || ''}`)

    const summary = newestAuditSummary(caseRoot)
    assert.equal(summary.generatedBy.identityKind, 'launcher')
    assert.equal(summary.generatedBy.verification.status, 'launcher-only')
    assert.equal(summary.generatedBy.verification.reason, '')
    assert.equal(summary.generatedBy.selectionSource, 'explicit')
    assert.equal(summary.generatedBy.versionRaw, 'codex-cli 9.9.9\r\n')
    assert.match(String(summary.generatedBy.sha256), /^[0-9A-Fa-f]{64}$/)
    assert.equal(summary.generatedBy.generation.status, 'complete')
    assert.equal(summary.contentDiff.status, 'complete')
    assert.equal(summary.contentDiff.typescript.status, 'drift')
    assert.equal(summary.contentDiff.typescript.exitCode, 1)
    assert.equal(summary.generatedBy.launchPath, fakeLauncher)
    // Raw per-stage execution records carry the real child exits of every phase that ran.
    assert.equal(summary.stages.version.exitCode, 0)
    assert.equal(summary.stages.version.error, null)
    assert.equal(summary.stages.typescript.exitCode, 0)
    assert.equal(summary.stages.json.exitCode, 0)
    assertNoUnexpectedInvocations('explicit case')

    const calls = readFileSync(callLogPath, 'utf8').split(/\r?\n/).filter(Boolean)
    assert.ok(calls.length >= 3, `expected version + two generation calls, saw ${calls.length}`)
    for (const call of calls) {
      assert.ok(
        call.startsWith(fakeLauncher),
        `every phase must call the frozen target, saw: ${call}`,
      )
    }
    assert.ok(calls.some((call) => call.includes('--version')), 'version probe must target the frozen launcher')
    assert.ok(calls.some((call) => call.includes('app-server generate-ts')), 'generate-ts must target the frozen launcher')
    assert.ok(calls.some((call) => call.includes('app-server generate-json-schema')), 'generate-json-schema must target the frozen launcher')
  })

  check('PS audit stops with the original exit code when --version fails', () => {
    const caseRoot = `${psAuditRoot}/version-fail`
    const result = runAudit('version-fail', ['-CodexCommand', versionFailLauncher, '-OutputRoot', caseRoot])
    assert.equal(result.status, 7, `expected the launcher's own exit 7, got ${String(result.status)}`)
    const summary = newestAuditSummary(caseRoot)
    assert.equal(summary.generatedBy.generation.status, 'failed')
    assert.equal(summary.generatedBy.verification.reason, 'version-probe-failed')
    assert.equal(summary.generatedBy.identityKind, 'unknown')
    assert.equal(summary.generatedBy.sha256, null)
    // The raw record keeps the real version exit and marks the unexecuted generation stages null.
    assert.equal(summary.stages.version.exitCode, 7)
    assert.equal(summary.stages.typescript, null)
    assert.equal(summary.stages.json, null)
    assertNoUnexpectedInvocations('version-fail case')
  })

  check('PS audit stops with the original exit code when a schema subcommand fails', () => {
    const caseRoot = `${psAuditRoot}/generate-ts-fail`
    const result = runAudit('generate-ts-fail', ['-CodexCommand', generateFailLauncher, '-OutputRoot', caseRoot])
    assert.equal(result.status, 3, `expected the launcher's own exit 3, got ${String(result.status)}`)
    const summary = newestAuditSummary(caseRoot)
    assert.equal(summary.generatedBy.generation.status, 'failed')
    assert.equal(summary.generatedBy.verification.reason, 'generate-ts-failed')
    // ...and the JSON leg is never run after the TypeScript leg already failed.
    assert.equal(summary.stages.version.exitCode, 0)
    assert.equal(summary.stages.typescript.exitCode, 3)
    assert.equal(summary.stages.json, null)
    assertNoUnexpectedInvocations('generate-ts-fail case')
  })

  check('PS audit reports changed when the target fingerprint moves mid-run', () => {
    const caseRoot = `${psAuditRoot}/changed`
    const result = runAudit('changed', ['-CodexCommand', changingLauncher, '-OutputRoot', caseRoot])
    assert.equal(result.status, 1, `expected failure exit 1, got ${String(result.status)}`)
    const summary = newestAuditSummary(caseRoot)
    assert.equal(summary.generatedBy.generation.status, 'changed')
    assert.equal(summary.generatedBy.verification.reason, 'target-fingerprint-changed-after-generate-ts')
    // A target that moved during generate-ts stops the audit there: JSON is never run.
    assert.equal(summary.stages.version.exitCode, 0)
    assert.equal(summary.stages.typescript.exitCode, 0)
    assert.equal(summary.stages.json, null)
    assertNoUnexpectedInvocations('changed case')
  })

  check('PS audit SkipGenerate stays a command-wiring check without provenance', () => {
    const caseRoot = `${psAuditRoot}/skip-generate`
    const result = runAudit('skip-generate', ['-CodexCommand', fakeLauncher, '-OutputRoot', caseRoot, '-SkipGenerate'])
    assert.equal(result.status, 0, `expected exit 0, got ${String(result.status)}: ${result.stderr || ''}`)
    const base = join(repoRoot, caseRoot)
    const stamps = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    assert.ok(stamps.length > 0, 'SkipGenerate must still create the audit directory')
    const stamp = stamps.sort()[stamps.length - 1]
    assert.equal(existsSync(join(base, stamp, 'audit-summary.json')), false, 'SkipGenerate must not publish a full provenance summary')
    assert.equal(statSync(join(base, stamp, 'typescript')).isDirectory(), true)
    assert.equal(statSync(join(base, stamp, 'json')).isDirectory(), true)
    assertNoUnexpectedInvocations('skip-generate case')
  })
}

console.log('')
if (failures === 0) {
  console.log(`schema audit identity smoke ok${skipped > 0 ? ` (${skipped} case group skipped/unverified)` : ''}`)
  process.exit(0)
}
console.error(`schema audit identity smoke FAILED with ${failures} failing check(s)`)
process.exit(1)
