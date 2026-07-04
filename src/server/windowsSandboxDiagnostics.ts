import { getErrorMessage } from './errorMessage.js'

export const WINDOWS_SANDBOX_READINESS_CACHE_MS = 5 * 60 * 1000

const APP_SERVER_READINESS_STATUSES = ['ready', 'notConfigured', 'updateRequired'] as const

export type WindowsSandboxAppServerReadinessStatus = typeof APP_SERVER_READINESS_STATUSES[number]
export type WindowsSandboxReadinessStatus = WindowsSandboxAppServerReadinessStatus | 'unsupported' | 'unavailable'
export type WindowsSandboxReadinessSource = 'app-server' | 'platform' | 'error'

export type WindowsSandboxReadinessDiagnostics = {
  status: WindowsSandboxReadinessStatus
  available: boolean
  checkedAtIso: string
  source: WindowsSandboxReadinessSource
  error: string
}

type WindowsSandboxReadinessCacheOptions = {
  ttlMs?: number
  nowMs?: () => number
  nowIso?: () => string
}

export type WindowsSandboxReadinessReaderDependencies = {
  cache: WindowsSandboxReadinessCache
  rpc(method: string, params: unknown): Promise<unknown>
  isWindows: () => boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function trimDiagnosticError(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 160) return trimmed
  return `${trimmed.slice(0, 157)}...`
}

function isAppServerReadinessStatus(value: unknown): value is WindowsSandboxAppServerReadinessStatus {
  return typeof value === 'string'
    && (APP_SERVER_READINESS_STATUSES as readonly string[]).includes(value)
}

export function normalizeWindowsSandboxReadiness(
  payload: unknown,
  checkedAtIso = new Date().toISOString(),
): WindowsSandboxReadinessDiagnostics {
  const record = asRecord(payload)
  const status = record?.status
  if (isAppServerReadinessStatus(status)) {
    return {
      status,
      available: true,
      checkedAtIso,
      source: 'app-server',
      error: '',
    }
  }

  return {
    status: 'unavailable',
    available: false,
    checkedAtIso,
    source: 'error',
    error: trimDiagnosticError(`Unknown Windows sandbox readiness status: ${String(status)}`),
  }
}

export function createWindowsSandboxReadinessUnavailable(
  error: unknown,
  checkedAtIso = new Date().toISOString(),
): WindowsSandboxReadinessDiagnostics {
  return {
    status: 'unavailable',
    available: false,
    checkedAtIso,
    source: 'error',
    error: trimDiagnosticError(getErrorMessage(error, 'Windows sandbox readiness is unavailable')),
  }
}

export function createWindowsSandboxReadinessUnsupported(
  checkedAtIso = new Date().toISOString(),
): WindowsSandboxReadinessDiagnostics {
  return {
    status: 'unsupported',
    available: false,
    checkedAtIso,
    source: 'platform',
    error: process.platform === 'win32' ? '' : 'Windows sandbox readiness is only supported on Windows.',
  }
}

export class WindowsSandboxReadinessCache {
  private cached: WindowsSandboxReadinessDiagnostics | null = null
  private cachedAtMs = 0
  private inFlight: Promise<WindowsSandboxReadinessDiagnostics> | null = null
  private readonly ttlMs: number
  private readonly nowMs: () => number
  private readonly nowIso: () => string

  constructor(options: WindowsSandboxReadinessCacheOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? WINDOWS_SANDBOX_READINESS_CACHE_MS)
    this.nowMs = options.nowMs ?? Date.now
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async read(readinessRpc: () => Promise<unknown>): Promise<WindowsSandboxReadinessDiagnostics> {
    const nowMs = this.nowMs()
    if (this.cached && nowMs - this.cachedAtMs < this.ttlMs) {
      return this.cached
    }

    if (this.inFlight) return this.inFlight

    this.inFlight = (async () => {
      try {
        const payload = await readinessRpc()
        const diagnostics = normalizeWindowsSandboxReadiness(payload, this.nowIso())
        this.cached = diagnostics
        this.cachedAtMs = this.nowMs()
        return diagnostics
      } catch (error) {
        const diagnostics = createWindowsSandboxReadinessUnavailable(error, this.nowIso())
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

export function createWindowsSandboxReadinessReader(
  dependencies: WindowsSandboxReadinessReaderDependencies,
): () => Promise<WindowsSandboxReadinessDiagnostics> {
  return async () => {
    if (!dependencies.isWindows()) {
      return createWindowsSandboxReadinessUnsupported()
    }
    return await dependencies.cache.read(() => dependencies.rpc('windowsSandbox/readiness', undefined))
  }
}
