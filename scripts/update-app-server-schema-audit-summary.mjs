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

function buildSummary(raw, repoRoot, existingSummary = null) {
  const comparison = sanitizeComparison(raw.comparison, existingSummary?.comparison)
  return {
    generatedAtIso: raw.generatedAtIso,
    officialDocsUrl: OFFICIAL_DOCS_URL,
    auditCommand: 'npm.cmd run audit:app-server-schemas',
    auditOutput: toRepoRelative(raw.auditRoot, repoRoot),
    codexCommand: raw.codexCommand || 'codex',
    baseline: {
      typescript: toRepoRelative(raw.baseline?.typescript, repoRoot),
      json: toRepoRelative(raw.baseline?.json, repoRoot),
    },
    comparison,
    reviewStatus: hasDrift(comparison) ? 'drift-recorded' : 'baseline-matched',
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
  const existingSummary = fs.existsSync(outputPath) ? readJson(outputPath) : null
  const summary = buildSummary(raw, repoRoot, existingSummary)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log(`Schema audit summary updated: ${path.relative(repoRoot, outputPath)}`)
  console.log(`Source audit summary: ${path.relative(repoRoot, inputPath)}`)
  console.log(`Review status: ${summary.reviewStatus}`)
}

main()
