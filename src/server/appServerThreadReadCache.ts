import {
  isRuntimeActiveState,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'

export type CachedThreadRead = {
  threadRead: unknown
  inProgress: boolean
  activeTurnId: string
  updatedAtIso: string
  sessionPath: string
  cachedAtIso: string
}

export function readIsoTimestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : 0
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
