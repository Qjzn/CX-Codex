import { getErrorMessage } from './errorMessage.js'

export const APP_SERVER_HOOK_DIAGNOSTICS_CACHE_MS = 5 * 60 * 1000

export type AppServerHookSummaryRecord = {
  eventName: string
  handlerType: string
  source: string
  trustStatus: string
  enabled: boolean
  isManaged: boolean
  hasMatcher: boolean
  hasStatusMessage: boolean
  pluginId: string
}

export type AppServerHookDiagnostics = {
  available: boolean
  checkedAtIso: string
  cwdCount: number
  hookCount: number
  enabledCount: number
  disabledCount: number
  managedCount: number
  untrustedCount: number
  modifiedCount: number
  warningCount: number
  errorCount: number
  byEvent: Record<string, number>
  bySource: Record<string, number>
  byTrust: Record<string, number>
  recentHooks: AppServerHookSummaryRecord[]
  error: string
}

type AppServerHookDiagnosticsCacheOptions = {
  ttlMs?: number
  nowMs?: () => number
  nowIso?: () => string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string, maxLength = 80): string {
  const value = record?.[key]
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength)
}

function trimDiagnosticError(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 160) return trimmed
  return `${trimmed.slice(0, 157)}...`
}

function increment(map: Record<string, number>, key: string): void {
  const normalizedKey = key.trim() || 'unknown'
  map[normalizedKey] = (map[normalizedKey] ?? 0) + 1
}

function readArray(record: Record<string, unknown> | null, key: string): unknown[] {
  const value = record?.[key]
  return Array.isArray(value) ? value : []
}

export function normalizeAppServerHookDiagnostics(
  payload: unknown,
  checkedAtIso = new Date().toISOString(),
): AppServerHookDiagnostics {
  const record = asRecord(payload)
  const entries = readArray(record, 'data')
  const diagnostics: AppServerHookDiagnostics = {
    available: true,
    checkedAtIso,
    cwdCount: entries.length,
    hookCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    managedCount: 0,
    untrustedCount: 0,
    modifiedCount: 0,
    warningCount: 0,
    errorCount: 0,
    byEvent: {},
    bySource: {},
    byTrust: {},
    recentHooks: [],
    error: '',
  }

  for (const entryValue of entries) {
    const entry = asRecord(entryValue)
    diagnostics.warningCount += readArray(entry, 'warnings').length
    diagnostics.errorCount += readArray(entry, 'errors').length

    for (const hookValue of readArray(entry, 'hooks')) {
      const hook = asRecord(hookValue)
      const eventName = readString(hook, 'eventName')
      const handlerType = readString(hook, 'handlerType')
      const source = readString(hook, 'source')
      const trustStatus = readString(hook, 'trustStatus')
      const enabled = hook?.enabled === true
      const isManaged = hook?.isManaged === true

      diagnostics.hookCount += 1
      if (enabled) {
        diagnostics.enabledCount += 1
      } else {
        diagnostics.disabledCount += 1
      }
      if (isManaged) diagnostics.managedCount += 1
      if (trustStatus === 'untrusted') diagnostics.untrustedCount += 1
      if (trustStatus === 'modified') diagnostics.modifiedCount += 1
      increment(diagnostics.byEvent, eventName)
      increment(diagnostics.bySource, source)
      increment(diagnostics.byTrust, trustStatus)

      if (diagnostics.recentHooks.length < 10) {
        diagnostics.recentHooks.push({
          eventName: eventName || 'unknown',
          handlerType: handlerType || 'unknown',
          source: source || 'unknown',
          trustStatus: trustStatus || 'unknown',
          enabled,
          isManaged,
          hasMatcher: readString(hook, 'matcher').length > 0,
          hasStatusMessage: readString(hook, 'statusMessage').length > 0,
          pluginId: readString(hook, 'pluginId'),
        })
      }
    }
  }

  return diagnostics
}

export function createAppServerHookDiagnosticsUnavailable(
  error: unknown,
  checkedAtIso = new Date().toISOString(),
): AppServerHookDiagnostics {
  return {
    available: false,
    checkedAtIso,
    cwdCount: 0,
    hookCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    managedCount: 0,
    untrustedCount: 0,
    modifiedCount: 0,
    warningCount: 0,
    errorCount: 0,
    byEvent: {},
    bySource: {},
    byTrust: {},
    recentHooks: [],
    error: trimDiagnosticError(getErrorMessage(error, 'App Server hook diagnostics are unavailable')),
  }
}

export class AppServerHookDiagnosticsCache {
  private cached: AppServerHookDiagnostics | null = null
  private cachedAtMs = 0
  private inFlight: Promise<AppServerHookDiagnostics> | null = null
  private readonly ttlMs: number
  private readonly nowMs: () => number
  private readonly nowIso: () => string

  constructor(options: AppServerHookDiagnosticsCacheOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? APP_SERVER_HOOK_DIAGNOSTICS_CACHE_MS)
    this.nowMs = options.nowMs ?? Date.now
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async read(readHooks: () => Promise<unknown>): Promise<AppServerHookDiagnostics> {
    const nowMs = this.nowMs()
    if (this.cached && nowMs - this.cachedAtMs < this.ttlMs) {
      return this.cached
    }

    if (this.inFlight) return this.inFlight

    this.inFlight = (async () => {
      try {
        const payload = await readHooks()
        const diagnostics = normalizeAppServerHookDiagnostics(payload, this.nowIso())
        this.cached = diagnostics
        this.cachedAtMs = this.nowMs()
        return diagnostics
      } catch (error) {
        const diagnostics = createAppServerHookDiagnosticsUnavailable(error, this.nowIso())
        this.cached = diagnostics
        this.cachedAtMs = this.nowMs()
        return diagnostics
      } finally {
        this.inFlight = null
      }
    })()

    return this.inFlight
  }

  clear(): void {
    this.cached = null
    this.cachedAtMs = 0
    this.inFlight = null
  }
}
