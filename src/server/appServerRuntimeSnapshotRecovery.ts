import {
  isRuntimeActiveState,
  RUNTIME_SNAPSHOT_STALE_MS,
  type RuntimeExecutionState,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import { readIsoTimestampMs } from './appServerThreadReadCache.js'

export type RuntimeSnapshotRecoveryOptions = {
  pendingServerRequests: ThreadRuntimeSnapshot['pendingServerRequests']
  tokenUsage: ThreadRuntimeSnapshot['tokenUsage']
  appServerStartedAtMs: number
  nowMs?: number
  staleMs?: number
}

export function createLocalRuntimeSnapshotFromPersisted(
  persistedSnapshot: ThreadRuntimeSnapshot,
  options: RuntimeSnapshotRecoveryOptions,
): ThreadRuntimeSnapshot {
  const nowMs = options.nowMs ?? Date.now()
  const staleMs = options.staleMs ?? RUNTIME_SNAPSHOT_STALE_MS
  const persistedLastAtMs =
    readIsoTimestampMs(persistedSnapshot.lastEventAtIso) ||
    readIsoTimestampMs(persistedSnapshot.updatedAtIso)
  const persistedStale =
    options.pendingServerRequests.length === 0 &&
    isRuntimeActiveState(persistedSnapshot.executionState) &&
    persistedLastAtMs > 0 &&
    (
      nowMs - persistedLastAtMs > staleMs ||
      options.appServerStartedAtMs > persistedLastAtMs
    )
  const executionState: RuntimeExecutionState = persistedStale ? 'sync_degraded' : persistedSnapshot.executionState

  return {
    ...persistedSnapshot,
    executionState,
    pendingServerRequests: options.pendingServerRequests,
    tokenUsage: options.tokenUsage,
    threadRead: null,
    messageState: 'unavailable',
    inProgress: isRuntimeActiveState(executionState),
    canStop: persistedSnapshot.canStop === true && !persistedSnapshot.stale && !persistedStale,
    stale: persistedSnapshot.stale === true || persistedStale,
    degradedReason: persistedStale
      ? options.appServerStartedAtMs > persistedLastAtMs
        ? 'app-server restarted after active runtime snapshot'
        : 'persisted runtime snapshot is stale'
      : persistedSnapshot.degradedReason,
  }
}
