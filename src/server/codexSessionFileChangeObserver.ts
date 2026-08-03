import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

import {
  CX_SESSION_FILES_CHANGED_METHOD,
  type CxSessionFileChangeOrigin,
} from '../sessionFileChange.js'
import { getCodexHomeDir } from './codexPaths.js'

export type CodexSessionFileChange = {
  source: 'session-index' | 'session-log'
  threadId: string
  origin?: CxSessionFileChangeOrigin
}

export type CodexSessionFileChangeObserverOptions = {
  codexHomeDir?: string
  debounceMs?: number
  minEmitIntervalMs?: number
  maxWaitMs?: number
  onChange: (change: CodexSessionFileChange) => void
  onError?: (error: unknown) => void
}

export type CodexSessionFileChangeObserverStatus = {
  running: boolean
  watchedSessionRootCount: number
  emittedChangeCount: number
  lastChangeAtIso: string
  lastErrorCode: string
}

type PendingChange = {
  change: CodexSessionFileChange
  burstStartedAtMs: number
  timer: ReturnType<typeof setTimeout>
}

const SESSION_INDEX_PATH = 'session_index.jsonl'
const SESSION_LOG_ROOTS = new Set(['sessions', 'archived_sessions'])
const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\.jsonl$)/iu
const DEFAULT_DEBOUNCE_MS = 700
const DEFAULT_MAX_WAIT_MS = 2_500
const DEFAULT_LIVE_EVENT_COVERAGE_MS = 5_000

export function resolveCodexSessionFileChangeOrigin(
  change: CodexSessionFileChange,
  lastLiveRuntimeEventAtMs: number,
  nowMs = Date.now(),
  coverageMs = DEFAULT_LIVE_EVENT_COVERAGE_MS,
): CxSessionFileChangeOrigin {
  if (change.source !== 'session-log' || !change.threadId || lastLiveRuntimeEventAtMs <= 0) return 'external'
  const ageMs = nowMs - lastLiveRuntimeEventAtMs
  return ageMs >= 0 && ageMs <= Math.max(0, coverageMs) ? 'live-app-server' : 'external'
}

export function classifyCodexSessionFileChange(filename: string | Buffer | null): CodexSessionFileChange | null {
  if (filename === null) return null
  const normalizedPath = filename.toString().replace(/\\/gu, '/').replace(/^\.\//u, '')
  const normalizedLowerPath = normalizedPath.toLowerCase()

  if (normalizedLowerPath === SESSION_INDEX_PATH) {
    return { source: 'session-index', threadId: '' }
  }

  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length < 2 || !SESSION_LOG_ROOTS.has(segments[0]?.toLowerCase() ?? '')) return null
  const basename = segments[segments.length - 1] ?? ''
  const threadId = basename.match(THREAD_ID_PATTERN)?.[1]?.toLowerCase() ?? ''
  if (!threadId) return null
  return { source: 'session-log', threadId }
}

export function createCodexSessionFileChangedNotification(change: CodexSessionFileChange): {
  method: typeof CX_SESSION_FILES_CHANGED_METHOD
  params: CodexSessionFileChange
} {
  return {
    method: CX_SESSION_FILES_CHANGED_METHOD,
    params: change,
  }
}

export class CodexSessionFileChangeObserver {
  private readonly codexHomeDir: string
  private readonly debounceMs: number
  private readonly minEmitIntervalMs: number
  private readonly maxWaitMs: number
  private readonly onChange: (change: CodexSessionFileChange) => void
  private readonly onError: (error: unknown) => void
  private readonly pendingByKey = new Map<string, PendingChange>()
  private readonly lastEmittedAtMsByKey = new Map<string, number>()
  private readonly sessionWatchers = new Map<string, FSWatcher>()
  private rootWatcher: FSWatcher | null = null
  private emittedChangeCount = 0
  private lastChangeAtIso = ''
  private lastErrorCode = ''

  constructor(options: CodexSessionFileChangeObserverOptions) {
    this.codexHomeDir = options.codexHomeDir ?? getCodexHomeDir()
    this.debounceMs = normalizeDelay(options.debounceMs, DEFAULT_DEBOUNCE_MS)
    this.minEmitIntervalMs = normalizeDelay(options.minEmitIntervalMs, 2_000)
    this.maxWaitMs = Math.max(this.debounceMs, normalizeDelay(options.maxWaitMs, DEFAULT_MAX_WAIT_MS))
    this.onChange = options.onChange
    this.onError = options.onError ?? (() => {})
  }

  start(): void {
    if (this.rootWatcher) return
    try {
      const rootWatcher = watch(this.codexHomeDir, { persistent: false }, (_eventType, filename) => {
        const normalizedName = filename?.toString().replace(/\\/gu, '/').toLowerCase() ?? ''
        if (normalizedName === SESSION_INDEX_PATH) {
          this.schedule({ source: 'session-index', threadId: '' })
        }
        const rootName = normalizedName.split('/')[0] ?? ''
        if (SESSION_LOG_ROOTS.has(rootName)) this.startSessionWatcher(rootName)
      })
      rootWatcher.on('error', (error) => {
        if (this.rootWatcher === rootWatcher) this.rootWatcher = null
        rootWatcher.close()
        this.reportError(error)
      })
      this.rootWatcher = rootWatcher
      for (const rootName of SESSION_LOG_ROOTS) this.startSessionWatcher(rootName)
    } catch (error) {
      this.reportError(error)
    }
  }

  getStatus(): CodexSessionFileChangeObserverStatus {
    return {
      running: this.rootWatcher !== null,
      watchedSessionRootCount: this.sessionWatchers.size,
      emittedChangeCount: this.emittedChangeCount,
      lastChangeAtIso: this.lastChangeAtIso,
      lastErrorCode: this.lastErrorCode,
    }
  }

  dispose(): void {
    this.rootWatcher?.close()
    this.rootWatcher = null
    for (const watcher of this.sessionWatchers.values()) watcher.close()
    this.sessionWatchers.clear()
    for (const pending of this.pendingByKey.values()) {
      clearTimeout(pending.timer)
    }
    this.pendingByKey.clear()
    this.lastEmittedAtMsByKey.clear()
  }

  private startSessionWatcher(rootName: string): void {
    if (this.sessionWatchers.has(rootName)) return
    try {
      const watcher = watch(join(this.codexHomeDir, rootName), {
        recursive: true,
        persistent: false,
      }, (_eventType, filename) => {
        if (filename === null) return
        const change = classifyCodexSessionFileChange(`${rootName}/${filename.toString()}`)
        if (change) this.schedule(change)
      })
      watcher.on('error', (error) => {
        this.sessionWatchers.delete(rootName)
        watcher.close()
        this.reportError(error)
      })
      this.sessionWatchers.set(rootName, watcher)
    } catch (error) {
      if (!isMissingPathError(error)) this.reportError(error)
    }
  }

  private schedule(change: CodexSessionFileChange): void {
    const key = change.threadId || change.source
    const nowMs = Date.now()
    const existing = this.pendingByKey.get(key)
    if (existing) clearTimeout(existing.timer)
    const burstStartedAtMs = existing?.burstStartedAtMs ?? nowMs
    const quietAtMs = nowMs + this.debounceMs
    const maxWaitAtMs = burstStartedAtMs + this.maxWaitMs
    const intervalAtMs = (this.lastEmittedAtMsByKey.get(key) ?? 0) + this.minEmitIntervalMs
    const targetAtMs = Math.max(intervalAtMs, Math.min(quietAtMs, maxWaitAtMs))
    const timer = setTimeout(() => {
      this.pendingByKey.delete(key)
      this.emit(key, change)
    }, Math.max(0, targetAtMs - nowMs))
    timer.unref?.()
    this.pendingByKey.set(key, { change, burstStartedAtMs, timer })
  }

  private emit(key: string, change: CodexSessionFileChange): void {
    try {
      this.onChange(change)
      this.lastEmittedAtMsByKey.set(key, Date.now())
      this.emittedChangeCount += 1
      this.lastChangeAtIso = new Date().toISOString()
    } catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown): void {
    this.lastErrorCode = readErrorCode(error)
    this.onError(error)
  }
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function readErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return error instanceof Error && error.name ? error.name : 'UNKNOWN'
}
