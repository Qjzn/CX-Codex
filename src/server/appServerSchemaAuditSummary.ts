import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CodexLaunchIdentityKind } from '../commandResolution.js'

export type SchemaAuditComparisonKey = 'typescriptRoot' | 'typescriptV2' | 'jsonRoot' | 'jsonV2'

export type SchemaAuditComparisonRecord = {
  baselineCount: number
  generatedCount: number
  addedCount: number
  removedCount: number
  representativeAdded: string[]
  representativeRemoved: string[]
}

/**
 * Where the audited launch target came from. `explicit` is the new -CodexCommand parameter, `env`
 * is the two historical environment variables, `path` is the bare-name PATH fallback.
 */
export type SchemaAuditTargetSelectionSource = 'explicit' | 'env' | 'path' | 'unknown'

/**
 * Completion of the content-generation leg. `complete` is the only value that may back a
 * baseline-matched/drift verdict; `failed`/`changed` mean generation stopped (non-zero exit or a
 * target fingerprint change) and `unknown` is a raw summary that never recorded it (old data).
 */
export type SchemaAuditGenerationStatus = 'complete' | 'failed' | 'changed' | 'unknown'

/**
 * Provenance of the schema audit output: which target produced it and how. It reuses the B4B
 * launch-identity fields (launchPath/versionRaw/sha256/identityKind) but deliberately has no
 * `generation` counter — offline schema generation has no active app-server generation, so one must
 * never be invented here. `versionRaw` keeps the target's raw `--version` stdout text (CRLF and
 * trailing newline included); only emptiness is judged. Anything that cannot be trusted is left
 * `null`/`unknown` and is never back-filled from process.env, the current install, another summary
 * or the B4B active identity.
 */
export type SchemaAuditGeneratedBy = {
  launchPath: string
  versionRaw: string | null
  sha256: string | null
  identityKind: CodexLaunchIdentityKind
  selectionSource: SchemaAuditTargetSelectionSource
  verification: {
    status: string
    reason: string
  }
  generation: {
    status: SchemaAuditGenerationStatus
    mode: string
    args: string[]
  }
  baseline: {
    typescript: string
    json: string
  }
  generated: {
    typescript: string
    json: string
  }
}

/**
 * Real full-directory content diff result for one comparison group. `matched` maps to a raw exit 0,
 * `drift` to raw exit 1 and `error` to any other exit; a label that contradicts the recorded integer
 * exit (or has none) degrades to `unknown`. It is independent of the identity comparison and of the
 * add/remove name counts.
 */
export type SchemaAuditContentDiffStatus = 'matched' | 'drift' | 'error' | 'unknown'

export type SchemaAuditContentDiffEntry = {
  status: SchemaAuditContentDiffStatus
  exitCode: number | null
}

export type SchemaAuditContentDiff = {
  status: string
  typescript: SchemaAuditContentDiffEntry
  json: SchemaAuditContentDiffEntry
}

export type SchemaAuditIdentityMatchStatus = 'matched' | 'mismatch' | 'unknown'

export type SchemaAuditIdentityMatch = {
  status: SchemaAuditIdentityMatchStatus
  reason: string
  comparedAgainstGeneration: number | null
}

export type AppServerSchemaAuditDiagnostics = {
  available: boolean
  generatedAtIso: string
  officialDocsUrl: string
  auditCommand: string
  auditOutput: string
  reviewStatus: string
  generatedBy: SchemaAuditGeneratedBy | null
  contentDiff: SchemaAuditContentDiff | null
  comparison: Record<SchemaAuditComparisonKey, SchemaAuditComparisonRecord>
  totals: {
    addedCount: number
    removedCount: number
  }
  error: string
  /** Attached per diagnostics request by `handleDiagnosticsRoutes`; absent on the raw summary. */
  identityMatch?: SchemaAuditIdentityMatch
}

/**
 * Minimal structural view of the frozen app-server status snapshot the comparator is allowed to
 * read. It carries no functions and is never re-resolved/probed/hashed by the comparison.
 */
export type SchemaAuditActiveIdentitySnapshot = {
  running?: boolean
  initialized?: boolean
  activeLaunchIdentity?: {
    generation?: number
    launchPath?: string
    versionRaw?: string | null
    sha256?: string | null
    identityKind?: string
  } | null
} | null

const COMPARISON_KEYS: SchemaAuditComparisonKey[] = [
  'typescriptRoot',
  'typescriptV2',
  'jsonRoot',
  'jsonV2',
]

const EMPTY_COMPARISON: Record<SchemaAuditComparisonKey, SchemaAuditComparisonRecord> = {
  typescriptRoot: createEmptyComparisonRecord(),
  typescriptV2: createEmptyComparisonRecord(),
  jsonRoot: createEmptyComparisonRecord(),
  jsonV2: createEmptyComparisonRecord(),
}

const HEX64_PATTERN = /^[0-9a-fA-F]{64}$/

/**
 * Verification states a native audit provenance may carry to stay comparable. Anything else
 * (`failed`, `changed`, `unverified`, `launcher-only`, missing) leaves the identity unknown.
 */
const TRUSTED_AUDIT_VERIFICATION_STATUSES: readonly string[] = ['verified', 'stable']

/** Windows `C:\x` / `C:/x` drive paths and `\\server\share` UNC paths. */
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/u

const moduleDir = dirname(fileURLToPath(import.meta.url))

export async function readAppServerSchemaAuditSummary(
  summaryPath = resolveAppServerSchemaAuditSummaryPath(),
): Promise<AppServerSchemaAuditDiagnostics> {
  try {
    const raw = await readFile(summaryPath, 'utf8')
    return normalizeAppServerSchemaAuditSummary(JSON.parse(raw) as unknown)
  } catch (error) {
    return {
      available: false,
      generatedAtIso: '',
      officialDocsUrl: '',
      auditCommand: '',
      auditOutput: '',
      reviewStatus: 'unavailable',
      generatedBy: null,
      contentDiff: null,
      comparison: EMPTY_COMPARISON,
      totals: {
        addedCount: 0,
        removedCount: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function normalizeAppServerSchemaAuditSummary(value: unknown): AppServerSchemaAuditDiagnostics {
  const root = asRecord(value)
  const comparisonRoot = asRecord(root?.comparison)
  const comparison = createEmptyComparison()

  for (const key of COMPARISON_KEYS) {
    comparison[key] = normalizeComparisonRecord(asRecord(comparisonRoot?.[key]))
  }

  const totals = COMPARISON_KEYS.reduce(
    (current, key) => ({
      addedCount: current.addedCount + comparison[key].addedCount,
      removedCount: current.removedCount + comparison[key].removedCount,
    }),
    { addedCount: 0, removedCount: 0 },
  )

  return {
    available: true,
    generatedAtIso: readString(root, 'generatedAtIso'),
    officialDocsUrl: readString(root, 'officialDocsUrl'),
    auditCommand: readString(root, 'auditCommand'),
    auditOutput: readString(root, 'auditOutput'),
    reviewStatus: readString(root, 'reviewStatus') || 'unknown',
    generatedBy: normalizeGeneratedBy(asRecord(root?.generatedBy)),
    contentDiff: normalizeContentDiff(asRecord(root?.contentDiff)),
    comparison,
    totals,
    error: '',
  }
}

export function resolveAppServerSchemaAuditSummaryPath(): string {
  const explicit = process.env.CX_CODEX_SCHEMA_AUDIT_SUMMARY_PATH?.trim()
    || process.env.CODEXUI_SCHEMA_AUDIT_SUMMARY_PATH?.trim()
  if (explicit) return resolve(explicit)

  return resolveFirstExistingCandidate([
    resolve('docs/app-server-schema-audit-summary.json'),
    join(moduleDir, '..', 'docs', 'app-server-schema-audit-summary.json'),
    join(moduleDir, '..', '..', 'docs', 'app-server-schema-audit-summary.json'),
  ])
}

function resolveFirstExistingCandidate(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] ?? resolve('docs/app-server-schema-audit-summary.json')
}

/**
 * Pure identity comparison between an already-loaded audit summary provenance and one frozen
 * active-status snapshot. It never resolves a path, probes `--version`, hashes a file or generates
 * anything, and it never judges `matched` from `available`/`reviewStatus`/method counts alone.
 */
export function compareSchemaAuditIdentity(
  summary: unknown,
  activeStatus: SchemaAuditActiveIdentitySnapshot,
): SchemaAuditIdentityMatch {
  const active = activeStatus?.activeLaunchIdentity ?? null
  const comparedAgainstGeneration = active && isPositiveInteger(active.generation)
    ? active.generation as number
    : null

  if (activeStatus === null || activeStatus === undefined) {
    return unknownIdentityMatch('no-active-server-status', comparedAgainstGeneration)
  }
  if (activeStatus.running !== true) {
    return unknownIdentityMatch('active-server-not-running', comparedAgainstGeneration)
  }
  if (active === null) {
    return unknownIdentityMatch('no-active-launch-identity', comparedAgainstGeneration)
  }

  // A trusted native identity needs the whole active target: native kind, a platform-absolute launch
  // path, a 64-hex SHA, non-blank raw version stdout. A relative path is never comparable — not even
  // when both sides spell the same relative string — because it names no frozen target.
  if (
    active.identityKind !== 'native'
    || typeof active.launchPath !== 'string'
    || !isPlatformAbsolutePath(active.launchPath)
    || !isHex64(active.sha256)
    || typeof active.versionRaw !== 'string'
    || active.versionRaw.trim().length === 0
  ) {
    return unknownIdentityMatch('active-identity-not-complete-native', comparedAgainstGeneration)
  }
  // The active generation is reported, never invented: an absent/zero/negative generation means the
  // active launch is not a completed generation, so the comparison is unknown rather than matched.
  if (!isPositiveInteger(active.generation)) {
    return unknownIdentityMatch('active-generation-missing-or-invalid', comparedAgainstGeneration)
  }

  const generatedBy = asRecord(asRecord(summary)?.generatedBy)
  if (generatedBy === null) {
    return unknownIdentityMatch('summary-generated-by-missing', comparedAgainstGeneration)
  }
  if (generatedBy.identityKind !== 'native') {
    return unknownIdentityMatch('summary-generated-by-not-native', comparedAgainstGeneration)
  }

  const launchPath = readRawString(generatedBy, 'launchPath')
  const versionRaw = readRawStringOrNull(generatedBy, 'versionRaw')
  const sha256 = readRawStringOrNull(generatedBy, 'sha256')
  // Blank/relative recorded target, blank raw version or missing SHA is incomplete provenance.
  // `versionRaw` is judged on blankness only and is kept byte-exact for the comparison below.
  if (
    launchPath.length === 0
    || !isPlatformAbsolutePath(launchPath)
    || versionRaw === null
    || versionRaw.trim().length === 0
    || sha256 === null
    || sha256.length === 0
  ) {
    return unknownIdentityMatch('summary-generated-by-incomplete', comparedAgainstGeneration)
  }

  const generation = asRecord(generatedBy.generation)
  if (generation?.status !== 'complete') {
    return unknownIdentityMatch('summary-generation-not-complete', comparedAgainstGeneration)
  }

  // A completed offline generation is only trustworthy when the audit itself verified the frozen
  // target: a failed/changed/unverified verification state is unknown, never a match.
  const verification = asRecord(generatedBy.verification)
  const verificationStatus = typeof verification?.status === 'string' ? verification.status.trim() : ''
  if (!TRUSTED_AUDIT_VERIFICATION_STATUSES.includes(verificationStatus)) {
    return unknownIdentityMatch('summary-verification-not-verified', comparedAgainstGeneration)
  }

  if (!isHex64(sha256)) {
    return unknownIdentityMatch('summary-sha-not-64-hex', comparedAgainstGeneration)
  }

  if (normalizeLaunchPathForComparison(launchPath) !== normalizeLaunchPathForComparison(active.launchPath)) {
    return mismatchIdentityMatch('launch-path-mismatch', comparedAgainstGeneration)
  }
  if (versionRaw !== active.versionRaw) {
    return mismatchIdentityMatch('version-mismatch', comparedAgainstGeneration)
  }
  if (sha256.toLowerCase() !== (active.sha256 as string).toLowerCase()) {
    return mismatchIdentityMatch('sha256-mismatch', comparedAgainstGeneration)
  }

  return {
    status: 'matched',
    reason: 'identity-matched',
    comparedAgainstGeneration,
  }
}

function unknownIdentityMatch(reason: string, comparedAgainstGeneration: number | null): SchemaAuditIdentityMatch {
  return { status: 'unknown', reason, comparedAgainstGeneration }
}

function mismatchIdentityMatch(reason: string, comparedAgainstGeneration: number | null): SchemaAuditIdentityMatch {
  return { status: 'mismatch', reason, comparedAgainstGeneration }
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64_PATTERN.test(value)
}

/** A real completed generation is a positive integer; `0`/negative/fractional/absent are not. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * A frozen launch target is always a platform-absolute path: a Windows drive/UNC path on win32 and a
 * `/-rooted` path elsewhere. A relative path names no target and is never trusted.
 */
function isPlatformAbsolutePath(value: string): boolean {
  if (value.length === 0) return false
  return process.platform === 'win32' ? WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) : value.startsWith('/')
}

/**
 * Compares paths by the current platform's own semantics. Windows is case-insensitive and treats
 * both separators the same; on POSIX the comparison stays case-sensitive and a backslash is an
 * ordinary filename character, so it is never rewritten there.
 */
function normalizeLaunchPathForComparison(value: string): string {
  if (process.platform !== 'win32') return value
  return value.replace(/\\/gu, '/').toLowerCase()
}

function normalizeGeneratedBy(record: Record<string, unknown> | null): SchemaAuditGeneratedBy | null {
  if (record === null) return null

  const verification = asRecord(record.verification)
  const generation = asRecord(record.generation)
  const baseline = asRecord(record.baseline)
  const generated = asRecord(record.generated)

  return {
    launchPath: readRawString(record, 'launchPath'),
    versionRaw: readRawStringOrNull(record, 'versionRaw'),
    sha256: readRawStringOrNull(record, 'sha256'),
    identityKind: readIdentityKind(record, 'identityKind'),
    selectionSource: readSelectionSource(record, 'selectionSource'),
    verification: {
      status: readString(verification, 'status') || 'unknown',
      reason: readString(verification, 'reason'),
    },
    generation: {
      status: readGenerationStatus(generation, 'status'),
      mode: readString(generation, 'mode'),
      args: readStringList(generation?.args),
    },
    baseline: {
      typescript: readString(baseline, 'typescript'),
      json: readString(baseline, 'json'),
    },
    generated: {
      typescript: readString(generated, 'typescript'),
      json: readString(generated, 'json'),
    },
  }
}

function normalizeContentDiff(record: Record<string, unknown> | null): SchemaAuditContentDiff | null {
  if (record === null) return null
  return {
    status: readString(record, 'status') || 'unknown',
    typescript: normalizeContentDiffEntry(asRecord(record.typescript)),
    json: normalizeContentDiffEntry(asRecord(record.json)),
  }
}

function normalizeContentDiffEntry(record: Record<string, unknown> | null): SchemaAuditContentDiffEntry {
  // The declared label is trusted only when a real integer child exit agrees with it: `matched` needs
  // exit 0, `drift` needs exit 1 and `error` needs any other integer. A fractional, non-numeric or
  // absent exit is not a diff result at all, so it stays null instead of being truncated into a
  // trusted code, and a contradiction (matched/1, matched/null, matched/0.5, drift/0, error/0, ...)
  // never keeps the declared status: it degrades to `unknown` while a real integer exit is still
  // preserved as evidence. The identity comparison never reads this.
  const rawExit = record?.exitCode
  const exitCode = typeof rawExit === 'number' && Number.isInteger(rawExit) ? rawExit : null
  return {
    status: pairContentDiffStatus(readContentDiffStatus(record, 'status'), exitCode),
    exitCode,
  }
}

/** Pairs a declared content-diff label with the actual integer child exit the audit recorded. */
function pairContentDiffStatus(
  declared: SchemaAuditContentDiffStatus,
  exitCode: number | null,
): SchemaAuditContentDiffStatus {
  if (exitCode === null) return 'unknown'
  if (declared === 'matched') return exitCode === 0 ? 'matched' : 'unknown'
  if (declared === 'drift') return exitCode === 1 ? 'drift' : 'unknown'
  if (declared === 'error') return exitCode === 0 || exitCode === 1 ? 'unknown' : 'error'
  return 'unknown'
}

function readContentDiffStatus(record: Record<string, unknown> | null, key: string): SchemaAuditContentDiffStatus {
  const value = record?.[key]
  return value === 'matched' || value === 'drift' || value === 'error' ? value : 'unknown'
}

function readGenerationStatus(record: Record<string, unknown> | null, key: string): SchemaAuditGenerationStatus {
  const value = record?.[key]
  return value === 'complete' || value === 'failed' || value === 'changed' ? value : 'unknown'
}

function readIdentityKind(record: Record<string, unknown> | null, key: string): CodexLaunchIdentityKind {
  const value = record?.[key]
  return value === 'native' || value === 'launcher' ? value : 'unknown'
}

function readSelectionSource(record: Record<string, unknown> | null, key: string): SchemaAuditTargetSelectionSource {
  const value = record?.[key]
  return value === 'explicit' || value === 'env' || value === 'path' ? value : 'unknown'
}

function normalizeComparisonRecord(record: Record<string, unknown> | null): SchemaAuditComparisonRecord {
  return {
    baselineCount: readFiniteNumber(record, 'baselineCount'),
    generatedCount: readFiniteNumber(record, 'generatedCount'),
    addedCount: readFiniteNumber(record, 'addedCount'),
    removedCount: readFiniteNumber(record, 'removedCount'),
    representativeAdded: readStringArray(record?.representativeAdded),
    representativeRemoved: readStringArray(record?.representativeRemoved),
  }
}

function createEmptyComparison(): Record<SchemaAuditComparisonKey, SchemaAuditComparisonRecord> {
  return {
    typescriptRoot: createEmptyComparisonRecord(),
    typescriptV2: createEmptyComparisonRecord(),
    jsonRoot: createEmptyComparisonRecord(),
    jsonV2: createEmptyComparisonRecord(),
  }
}

function createEmptyComparisonRecord(): SchemaAuditComparisonRecord {
  return {
    baselineCount: 0,
    generatedCount: 0,
    addedCount: 0,
    removedCount: 0,
    representativeAdded: [],
    representativeRemoved: [],
  }
}

function readFiniteNumber(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Raw-preserving string reader: provenance text such as `versionRaw` must keep its original bytes
 * (CRLF, trailing newline) so a PowerShell capture and a Node capture of the same stdout compare
 * equal. Trimming here would silently break that.
 */
function readRawString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function readRawStringOrNull(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function readStringArray(value: unknown): string[] {
  return readStringList(value, 5)
}

function readStringList(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
