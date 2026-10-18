#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const OFFICIAL_DOCS_URL = 'https://developers.openai.com/codex/app-server'
const DEFAULT_AUDIT_ROOT = 'output/app-server-schema-audit'
const DEFAULT_OUTPUT = 'docs/app-server-schema-audit-summary.json'
const REPRESENTATIVE_LIMIT = 3

function usage() {
  console.error([
    'Usage: node scripts/update-app-server-schema-audit-summary.mjs [options]',
    '',
    'Options:',
    '  --input <path>   raw audit-summary.json to sanitize',
    '  --output <path>  summary output path (default: docs/app-server-schema-audit-summary.json)',
    '  --help           show this message',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    input: '',
    output: DEFAULT_OUTPUT,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--input') {
      options.input = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (arg === '--output') {
      options.output = argv[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.output) {
    throw new Error('--output requires a path')
  }
  return options
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
}

function findLatestAuditSummary(repoRoot) {
  const auditRoot = path.resolve(repoRoot, DEFAULT_AUDIT_ROOT)
  if (!fs.existsSync(auditRoot)) {
    throw new Error(`No schema audit output directory found: ${path.relative(repoRoot, auditRoot)}`)
  }

  const candidates = fs.readdirSync(auditRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(auditRoot, entry.name, 'audit-summary.json'))
    .filter((summaryPath) => fs.existsSync(summaryPath))
    .sort((left, right) => right.localeCompare(left))

  if (candidates.length === 0) {
    throw new Error(`No audit-summary.json files found under ${path.relative(repoRoot, auditRoot)}`)
  }
  return candidates[0]
}

function toRepoRelative(value, repoRoot) {
  if (typeof value !== 'string' || value.trim() === '') {
    return ''
  }

  const normalized = path.resolve(value)
  const relative = path.relative(repoRoot, normalized)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/')
  }
  return value.split(path.sep).join('/')
}

function hasSameCounts(existingRow, nextRow) {
  return existingRow
    && Number(existingRow.baselineCount) === nextRow.baselineCount
    && Number(existingRow.generatedCount) === nextRow.generatedCount
    && Number(existingRow.addedCount) === nextRow.addedCount
    && Number(existingRow.removedCount) === nextRow.removedCount
}

function sanitizeComparison(rawComparison, existingComparison = {}) {
  const result = {}
  for (const key of ['typescriptRoot', 'typescriptV2', 'jsonRoot', 'jsonV2']) {
    const row = rawComparison?.[key] ?? {}
    const added = Array.isArray(row.added) ? row.added : []
    const removed = Array.isArray(row.removed) ? row.removed : []
    const nextRow = {
      baselineCount: Number(row.baselineCount ?? 0),
      generatedCount: Number(row.generatedCount ?? 0),
      addedCount: Number(row.addedCount ?? added.length),
      removedCount: Number(row.removedCount ?? removed.length),
      representativeAdded: added.slice(0, REPRESENTATIVE_LIMIT),
      representativeRemoved: removed.slice(0, REPRESENTATIVE_LIMIT),
    }
    const existingRow = existingComparison?.[key]
    if (hasSameCounts(existingRow, nextRow)) {
      if (Array.isArray(existingRow.representativeAdded)) {
        nextRow.representativeAdded = existingRow.representativeAdded.slice(0, REPRESENTATIVE_LIMIT)
      }
      if (Array.isArray(existingRow.representativeRemoved)) {
        nextRow.representativeRemoved = existingRow.representativeRemoved.slice(0, REPRESENTATIVE_LIMIT)
      }
    }
    result[key] = nextRow
  }
  return result
}

function hasDrift(comparison) {
  return Object.values(comparison).some((row) => row.addedCount > 0 || row.removedCount > 0)
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function readString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** Raw-preserving: `versionRaw` keeps its original stdout bytes (CRLF/trailing newline). */
function readRawStringOrNull(value) {
  return typeof value === 'string' ? value : null
}

function readStringList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

/**
 * Carries the raw summary's provenance verbatim. It never consults the existing output summary, so a
 * raw audit that lost or changed its identity can never inherit a previous identity. Missing/absent
 * provenance stays null rather than being back-filled from the current install or process.env.
 */
function buildGeneratedBy(raw) {
  const generatedBy = asRecord(raw?.generatedBy)
  if (!generatedBy) return null

  const verification = asRecord(generatedBy.verification) ?? {}
  const generation = asRecord(generatedBy.generation) ?? {}
  const baseline = asRecord(generatedBy.baseline) ?? {}
  const generated = asRecord(generatedBy.generated) ?? {}

  return {
    launchPath: readString(generatedBy.launchPath),
    versionRaw: readRawStringOrNull(generatedBy.versionRaw),
    sha256: readRawStringOrNull(generatedBy.sha256),
    identityKind: generatedBy.identityKind === 'native' || generatedBy.identityKind === 'launcher'
      ? generatedBy.identityKind
      : 'unknown',
    selectionSource: generatedBy.selectionSource === 'explicit'
      || generatedBy.selectionSource === 'env'
      || generatedBy.selectionSource === 'path'
      ? generatedBy.selectionSource
      : 'unknown',
    verification: {
      status: readString(verification.status, 'unknown'),
      reason: readString(verification.reason),
    },
    generation: {
      status: generation.status === 'complete' || generation.status === 'failed' || generation.status === 'changed'
        ? generation.status
        : 'unknown',
      mode: readString(generation.mode),
      args: readStringList(generation.args),
    },
    baseline: {
      typescript: readString(baseline.typescript),
      json: readString(baseline.json),
    },
    generated: {
      typescript: readString(generated.typescript),
      json: readString(generated.json),
    },
  }
}

/**
 * A content-diff entry is only a real diff result when its label and its actual integer child exit
 * agree: `matched`↔0, `drift`↔1, anything else↔`error`. A missing or fractional exit, or a label
 * that contradicts the exit, is `unknown` — it can never be normalized into a trusted `matched`/0.
 */
function readContentDiffEntry(value) {
  const entry = asRecord(value)
  const exitCode = typeof entry?.exitCode === 'number' && Number.isInteger(entry.exitCode)
    ? entry.exitCode
    : null
  const declared = entry?.status
  const declaredStatus = declared === 'matched' || declared === 'drift' || declared === 'error'
    ? declared
    : 'unknown'

  if (declaredStatus === 'unknown' || exitCode === null) {
    return { status: 'unknown', exitCode }
  }

  const expected = exitCode === 0 ? 'matched' : exitCode === 1 ? 'drift' : 'error'
  return {
    status: declaredStatus === expected ? expected : 'unknown',
    exitCode,
  }
}

function buildContentDiff(raw) {
  const contentDiff = asRecord(raw?.contentDiff)
  if (!contentDiff) return null
  return {
    status: readString(contentDiff.status, 'unknown'),
    typescript: readContentDiffEntry(contentDiff.typescript),
    json: readContentDiffEntry(contentDiff.json),
  }
}

/** Only a completed content generation (status `complete`) may back a review verdict. */
function isCompleteGeneration(generatedBy) {
  return asRecord(generatedBy)?.generation?.status === 'complete'
}

/**
 * Content review status is driven by the real full-directory diff result, and a verdict is only
 * published when the generation that produced it actually completed. Every entry must pair its
 * label with the recorded integer exit, so a `complete` summary with two matched *labels* but a
 * missing/contradicting exit (or an unverified/failed/changed generation) is `unknown` instead of
 * `baseline-matched`. Add/remove name counts stay a positive drift signal only: they can never
 * produce `baseline-matched`.
 */
function resolveReviewStatus(comparison, contentDiff, generatedBy) {
  if (contentDiff?.status === 'complete' && isCompleteGeneration(generatedBy)) {
    const entries = [contentDiff.typescript, contentDiff.json]
    if (entries.every((entry) => entry.status === 'matched')) return 'baseline-matched'
    if (entries.some((entry) => entry.status === 'drift')) return 'drift-recorded'
  }
  return hasDrift(comparison) ? 'drift-recorded' : 'unknown'
}

function buildSummary(raw, repoRoot) {
  // Legacy input is never merged with a previously published summary: both the comparison rows and
  // the provenance are built from this raw audit alone, so an input that lost its identity/content
  // can neither inherit them here nor pass an old identity off as its own.
  const comparison = sanitizeComparison(raw.comparison)
  const generatedBy = buildGeneratedBy(raw)
  const contentDiff = buildContentDiff(raw)
  return {
    generatedAtIso: raw.generatedAtIso,
    officialDocsUrl: OFFICIAL_DOCS_URL,
    auditCommand: 'npm.cmd run audit:app-server-schemas',
    auditOutput: toRepoRelative(raw.auditRoot, repoRoot),
    codexCommand: raw.codexCommand || 'codex',
    generatedBy,
    contentDiff,
    baseline: {
      typescript: toRepoRelative(raw.baseline?.typescript, repoRoot),
      json: toRepoRelative(raw.baseline?.json, repoRoot),
    },
    comparison,
    reviewStatus: resolveReviewStatus(comparison, contentDiff, generatedBy),
    notes: [
      'This committed summary is a release-governance checkpoint, not a schema baseline update.',
      'Do not copy generated output directories into the repository; regenerate and review before updating documentation/app-server-schemas.',
    ],
  }
}

function main() {
  const repoRoot = process.cwd()
  const options = parseArgs(process.argv.slice(2))
  const inputPath = options.input
    ? path.resolve(repoRoot, options.input)
    : findLatestAuditSummary(repoRoot)
  const outputPath = path.resolve(repoRoot, options.output)

  const raw = readJson(inputPath)
  const summary = buildSummary(raw, repoRoot)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log(`Schema audit summary updated: ${path.relative(repoRoot, outputPath)}`)
  console.log(`Source audit summary: ${path.relative(repoRoot, inputPath)}`)
  console.log(`Review status: ${summary.reviewStatus}`)
}

main()
