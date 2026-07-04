import type { PendingServerRequest } from './pendingServerRequests.js'
import {
  toPersistableRuntimeSnapshot,
  type RuntimeSnapshotOverlay,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import type { RuntimeSnapshotRecord } from './runtimeStore.js'

export type AppServerRuntimeSnapshotPersistenceDependencies = {
  snapshotRuntime(threadId: string, overlay?: RuntimeSnapshotOverlay): ThreadRuntimeSnapshot
  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[]
  getThreadTokenUsage(threadId: string): unknown | null
  upsertSnapshot(snapshot: RuntimeSnapshotRecord): RuntimeSnapshotRecord
}

export function persistAppServerRuntimeSnapshot(
  threadId: string,
  snapshot: ThreadRuntimeSnapshot | undefined,
  dependencies: AppServerRuntimeSnapshotPersistenceDependencies,
): ThreadRuntimeSnapshot {
  const nextSnapshot = snapshot ?? dependencies.snapshotRuntime(threadId, {
    pendingServerRequests: dependencies.listPendingServerRequestsForThread(threadId),
    tokenUsage: dependencies.getThreadTokenUsage(threadId),
  })

  dependencies.upsertSnapshot({
    threadId,
    executionState: nextSnapshot.executionState,
    activeTurnId: nextSnapshot.activeTurnId,
    activeItemId: nextSnapshot.activeItemId,
    canStop: nextSnapshot.canStop,
    stopRequested: nextSnapshot.stopRequested,
    lastEventSeq: nextSnapshot.lastEventSeq,
    updatedAtIso: nextSnapshot.updatedAtIso,
    snapshot: toPersistableRuntimeSnapshot(nextSnapshot),
  })

  return nextSnapshot
}

export function createAppServerRuntimeSnapshotPersister(
  dependencies: AppServerRuntimeSnapshotPersistenceDependencies,
): (threadId: string, snapshot?: ThreadRuntimeSnapshot) => ThreadRuntimeSnapshot {
  return (threadId, snapshot) => persistAppServerRuntimeSnapshot(threadId, snapshot, dependencies)
}
