import type { ThreadRuntimeSnapshot } from './runtimeState.js'
import type {
  RuntimeRequestRecord,
  RuntimeRequestStatus,
} from './runtimeStore.js'
import { readRuntimeRequestStatusFromExecutionState } from './appServerRuntimeBridge.js'

export const RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES: RuntimeRequestStatus[] = [
  'pending_start',
  'start_uncertain',
  'running',
  'stopping',
  'stop_uncertain',
  'still_running',
]
export const RUNTIME_RECONCILE_RUNNING_THROTTLE_MS = 10_000
export const RUNTIME_RECONCILE_BATCH_LIMIT = 3

export type RuntimeRequestSnapshotPatch = {
  status: RuntimeRequestStatus
  threadId: string
  turnId: string
  lastError: string | null
}

export type RuntimeRequestReconcileFailurePatch = {
  status: RuntimeRequestStatus
  lastError: string
  incrementRetry: true
}

export type RuntimeThreadStatePayload = {
  snapshot: ThreadRuntimeSnapshot
  requests: RuntimeRequestRecord[]
}

type RuntimeThreadStateStore = {
  listRequestsByThread(threadId: string, statuses?: RuntimeRequestStatus[]): RuntimeRequestRecord[]
}

type RuntimeRequestReconciliationStore = RuntimeThreadStateStore & {
  updateRequest(requestId: string, patch: RuntimeRequestSnapshotPatch): RuntimeRequestRecord | null
}

export type RuntimeThreadReconcilerDependencies = {
  readThreadRuntimeSnapshot(threadId: string): Promise<ThreadRuntimeSnapshot>
  runtimeStore: RuntimeRequestReconciliationStore
}

export function createRuntimeThreadStatePayload(
  threadId: string,
  snapshot: ThreadRuntimeSnapshot,
  runtimeStore: RuntimeThreadStateStore,
): RuntimeThreadStatePayload {
  return {
    snapshot,
    requests: runtimeStore.listRequestsByThread(threadId, RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES),
  }
}

export function updateRuntimeRequestsFromSnapshot(
  threadId: string,
  snapshot: ThreadRuntimeSnapshot,
  runtimeStore: RuntimeRequestReconciliationStore,
): number {
  const activeRequests = runtimeStore.listRequestsByThread(threadId, RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES)
  for (const request of activeRequests) {
    runtimeStore.updateRequest(request.requestId, createRuntimeRequestSnapshotPatch(request, threadId, snapshot))
  }
  return activeRequests.length
}

export function createRuntimeThreadReconciler(
  dependencies: RuntimeThreadReconcilerDependencies,
): (threadId: string) => Promise<ThreadRuntimeSnapshot> {
  return async (threadId) => {
    const snapshot = await dependencies.readThreadRuntimeSnapshot(threadId)
    updateRuntimeRequestsFromSnapshot(threadId, snapshot, dependencies.runtimeStore)
    return snapshot
  }
}

export function selectRuntimeRequestsForReconcile(
  requests: RuntimeRequestRecord[],
  lastReconciledAtMsByThreadId: ReadonlyMap<string, number>,
  nowMs: number,
  limit = RUNTIME_RECONCILE_BATCH_LIMIT,
): RuntimeRequestRecord[] {
  return requests
    .filter((request) => {
      if (!request.threadId) return false
      if (request.status !== 'running' && request.status !== 'still_running') return true
      const lastAtMs = lastReconciledAtMsByThreadId.get(request.threadId) ?? 0
      return nowMs - lastAtMs >= RUNTIME_RECONCILE_RUNNING_THROTTLE_MS
    })
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function createRuntimeReconcileFailurePatch(
  request: Pick<RuntimeRequestRecord, 'status'>,
  lastError: string,
): RuntimeRequestReconcileFailurePatch {
  return {
    status: request.status === 'stopping' ? 'stop_uncertain' : request.status,
    lastError,
    incrementRetry: true,
  }
}

export function createRuntimeRequestSnapshotPatch(
  request: Pick<RuntimeRequestRecord, 'status' | 'turnId'>,
  threadId: string,
  snapshot: Pick<ThreadRuntimeSnapshot, 'activeTurnId' | 'executionState' | 'inProgress' | 'lastError'>,
): RuntimeRequestSnapshotPatch {
  const status =
    snapshot.inProgress && (request.status === 'stopping' || request.status === 'stop_uncertain')
      ? 'still_running'
      : readRuntimeRequestStatusFromExecutionState(snapshot.executionState)

  return {
    status,
    threadId,
    turnId: snapshot.activeTurnId || request.turnId,
    lastError: snapshot.lastError,
  }
}
