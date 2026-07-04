import {
  createRuntimeReconcileScheduler,
  type RuntimeReconcileScheduler,
} from './appServerRuntimeReconcileScheduler.js'
import {
  createRuntimeThreadReconciler,
  type RuntimeRequestReconcileFailurePatch,
  type RuntimeRequestSnapshotPatch,
} from './appServerRuntimeRequestReconciliation.js'
import type { ThreadRuntimeSnapshot } from './runtimeState.js'
import type { RuntimeRequestRecord, RuntimeRequestStatus } from './runtimeStore.js'

type RuntimeReconciliationStore = {
  listRequestsByThread(threadId: string, statuses?: RuntimeRequestStatus[]): RuntimeRequestRecord[]
  listUncertainRequests(limit: number): RuntimeRequestRecord[]
  updateRequest(
    requestId: string,
    patch: RuntimeRequestSnapshotPatch | RuntimeRequestReconcileFailurePatch,
  ): RuntimeRequestRecord | null
}

export type AppServerRuntimeReconciliationDependencies = {
  readThreadRuntimeSnapshot(threadId: string): Promise<ThreadRuntimeSnapshot>
  runtimeStore: RuntimeReconciliationStore
  getErrorMessage(error: unknown, fallback: string): string
  writeReconcileFailure(details: {
    threadId: string
    requestId: string
    status: RuntimeRequestRecord['status']
    error: string
  }): void
}

export type AppServerRuntimeReconciliation = {
  reconcileRuntimeThread(threadId: string): Promise<ThreadRuntimeSnapshot>
  runtimeReconcileScheduler: RuntimeReconcileScheduler
}

export function createAppServerRuntimeReconciliation(
  dependencies: AppServerRuntimeReconciliationDependencies,
): AppServerRuntimeReconciliation {
  const reconcileRuntimeThread = createRuntimeThreadReconciler({
    readThreadRuntimeSnapshot: dependencies.readThreadRuntimeSnapshot,
    runtimeStore: dependencies.runtimeStore,
  })

  const runtimeReconcileScheduler = createRuntimeReconcileScheduler({
    listUncertainRequests: (limit) => dependencies.runtimeStore.listUncertainRequests(limit),
    reconcileRuntimeThread,
    updateRequest: (requestId, patch) => dependencies.runtimeStore.updateRequest(requestId, patch),
    getErrorMessage: dependencies.getErrorMessage,
    writeReconcileFailure: dependencies.writeReconcileFailure,
  })

  return {
    reconcileRuntimeThread,
    runtimeReconcileScheduler,
  }
}
