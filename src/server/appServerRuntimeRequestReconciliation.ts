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

export type RuntimeRequestSnapshotPatch = {
  status: RuntimeRequestStatus
  threadId: string
  turnId: string
  lastError: string | null
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
