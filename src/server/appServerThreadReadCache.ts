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
    return this.cachedByThreadId.get(threadId) ?? null
  }

  remember(threadId: string, threadRead: unknown, source: ThreadReadCacheSource = 'app-server'): CachedThreadRead {
    const cachedThreadRead = createCachedThreadRead(threadRead, () => new Date().toISOString(), source)
    this.cachedByThreadId.set(threadId, cachedThreadRead)
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
