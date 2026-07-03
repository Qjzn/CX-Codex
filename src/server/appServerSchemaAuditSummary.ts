import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SchemaAuditComparisonKey = 'typescriptRoot' | 'typescriptV2' | 'jsonRoot' | 'jsonV2'

export type SchemaAuditComparisonRecord = {
  baselineCount: number
  generatedCount: number
  addedCount: number
  removedCount: number
  representativeAdded: string[]
  representativeRemoved: string[]
}

export type AppServerSchemaAuditDiagnostics = {
  available: boolean
  generatedAtIso: string
  officialDocsUrl: string
  auditCommand: string
  auditOutput: string
  reviewStatus: string
  comparison: Record<SchemaAuditComparisonKey, SchemaAuditComparisonRecord>
  totals: {
    addedCount: number
    removedCount: number
  }
  error: string
}

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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 5)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
