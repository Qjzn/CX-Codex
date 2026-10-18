import {
  isRuntimeActiveState,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import {
  readActiveTurnIdFromThreadReadPayload,
  readThreadInProgressFromThreadReadPayload,
  readThreadSessionPathFromThreadReadPayload,
  readThreadUpdatedAtIsoFromThreadReadPayload,
} from './appServerThreadPayload.js'
import { rememberSessionAttachmentPaths } from './sessionAttachmentAccess.js'

export type CachedThreadRead = {
  threadRead: unknown
  inProgress: boolean
  activeTurnId: string
  updatedAtIso: string
  sessionPath: string
  cachedAtIso: string
  source: ThreadReadCacheSource
}

export type ThreadReadCacheSource = 'app-server' | 'session-log'

export const APP_SERVER_THREAD_READ_CACHE_LIMIT = 64

export function readIsoTimestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : 0
}

export function createCachedThreadRead(
  threadRead: unknown,
  nowIso: () => string = () => new Date().toISOString(),
  source: ThreadReadCacheSource = 'app-server',
): CachedThreadRead {
  return {
    threadRead,
    inProgress: readThreadInProgressFromThreadReadPayload(threadRead),
    activeTurnId: readActiveTurnIdFromThreadReadPayload(threadRead),
    updatedAtIso: readThreadUpdatedAtIsoFromThreadReadPayload(threadRead),
    sessionPath: readThreadSessionPathFromThreadReadPayload(threadRead),
    cachedAtIso: nowIso(),
    source,
  }
}

export class AppServerThreadReadCacheStore {
  private readonly cachedByThreadId = new Map<string, CachedThreadRead>()

  get count(): number {
    return this.cachedByThreadId.size
  }

  get(threadId: string): CachedThreadRead | null {
    const cached = this.cachedByThreadId.get(threadId)
    if (!cached) return null
    this.cachedByThreadId.delete(threadId)
    this.cachedByThreadId.set(threadId, cached)
    return cached
  }

  remember(threadId: string, threadRead: unknown, source: ThreadReadCacheSource = 'app-server'): CachedThreadRead {
    rememberSessionAttachmentPaths(threadRead)
    const cachedThreadRead = createCachedThreadRead(threadRead, () => new Date().toISOString(), source)
    this.cachedByThreadId.delete(threadId)
    this.cachedByThreadId.set(threadId, cachedThreadRead)
    if (this.cachedByThreadId.size > APP_SERVER_THREAD_READ_CACHE_LIMIT) {
      const oldestThreadId = this.cachedByThreadId.keys().next().value
      if (typeof oldestThreadId === 'string') this.cachedByThreadId.delete(oldestThreadId)
    }
    return cachedThreadRead
  }

  delete(threadId: string): boolean {
    return this.cachedByThreadId.delete(threadId)
  }

  clear(): void {
    this.cachedByThreadId.clear()
  }
}

export function isCachedThreadReadStaleForRuntime(
  cachedThreadRead: CachedThreadRead,
  runtimeSnapshot: ThreadRuntimeSnapshot,
  lightThreadInProgress: boolean,
): boolean {
  if (lightThreadInProgress) return false
  if (isRuntimeActiveState(runtimeSnapshot.executionState) || runtimeSnapshot.executionState === 'completed_pending_sync') {
    return true
  }

  const completedAtMs = readIsoTimestampMs(runtimeSnapshot.lastCompletedAtIso)
  if (completedAtMs <= 0) return false
  const cachedAtMs = readIsoTimestampMs(cachedThreadRead.cachedAtIso)
  return cachedAtMs <= 0 || cachedAtMs < completedAtMs
}
