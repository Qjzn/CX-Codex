import type { ThreadRuntimeSnapshot } from './runtimeState.js'
import type {
  RuntimeRequestRecord,
  RuntimeRequestStatus,
} from './runtimeStore.js'
import { readRuntimeRequestStatusFromExecutionState } from './appServerRuntimeBridge.js'
import { createRuntimePromptHash } from './runtimePayload.js'

export const RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES: RuntimeRequestStatus[] = [
  'pending_start',
  'starting',
  'start_uncertain',
  'running',
  'stopping',
  'stop_uncertain',
  'still_running',
  'sync_degraded',
]
export const RUNTIME_RECONCILE_RUNNING_THROTTLE_MS = 10_000
export const RUNTIME_RECONCILE_BATCH_LIMIT = 3

export type RuntimeRequestSnapshotPatch = {
  status: RuntimeRequestStatus
  threadId: string
  turnId: string
  lastError: string | null
  payload?: unknown
}

export type RuntimeRequestReconcileFailurePatch = {
  status: RuntimeRequestStatus
  lastError: string
  incrementRetry: true
  payload?: unknown
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
      if (canResumeRuntimePendingStart(request)) return true
      if (!request.threadId) return false
      if (
        request.status !== 'running'
        && request.status !== 'still_running'
        && request.status !== 'sync_degraded'
      ) return true
      const lastAtMs = lastReconciledAtMsByThreadId.get(request.threadId) ?? 0
      return nowMs - lastAtMs >= RUNTIME_RECONCILE_RUNNING_THROTTLE_MS
    })
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function canResumeRuntimePendingStart(
  request: Pick<
    RuntimeRequestRecord,
    'status' | 'requestId' | 'clientMessageId' | 'promptHash' | 'mode' | 'payload'
  >,
): boolean {
  if (request.status !== 'pending_start') return false
  const payload = asRecord(request.payload)
  if (!payload || payload.requestId !== request.requestId) return false
  if (payload.clientMessageId !== request.clientMessageId) return false
  if (payload.collaborationMode !== request.mode) return false
  if (!Array.isArray(payload.input) || payload.input.length === 0) return false
  return createRuntimePromptHash(payload.input) === request.promptHash
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

export function createRuntimePendingStartResumeFailurePatch(
  lastError: string,
): RuntimeRequestReconcileFailurePatch {
  return {
    status: 'failed',
    lastError,
    incrementRetry: true,
    payload: {},
  }
}

export function createRuntimeRequestSnapshotPatch(
  request: Pick<RuntimeRequestRecord, 'status' | 'turnId'> & { payload?: unknown },
  threadId: string,
  snapshot: Pick<ThreadRuntimeSnapshot, 'activeTurnId' | 'executionState' | 'inProgress' | 'lastError'>,
): RuntimeRequestSnapshotPatch {
  const startWasInterrupted =
    (request.status === 'pending_start' || request.status === 'starting')
    && !snapshot.inProgress
    && (snapshot.executionState === 'idle' || snapshot.executionState === 'stopped')
  const status = startWasInterrupted
    ? 'failed'
    : snapshot.inProgress && (request.status === 'stopping' || request.status === 'stop_uncertain')
      ? 'still_running'
      : readRuntimeRequestStatusFromExecutionState(snapshot.executionState)

  return {
    status,
    threadId,
    turnId: snapshot.activeTurnId || request.turnId,
    lastError: startWasInterrupted
      ? 'Turn start was not confirmed after bridge restart'
      : snapshot.lastError,
    ...(hasDurableRuntimeSendPayload(request.payload) ? { payload: {} } : {}),
  }
}

function hasDurableRuntimeSendPayload(payload: unknown): boolean {
  const record = asRecord(payload)
  return typeof record?.requestId === 'string'
    && typeof record.clientMessageId === 'string'
    && typeof record.collaborationMode === 'string'
    && Array.isArray(record.input)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
