import type { RuntimeExecutionState } from './runtimeState.js'
import type { RuntimeRequestStatus } from './runtimeStore.js'

export type BridgeNotificationEvent = {
  method: string
  params: unknown
  atIso: string
  seq: number
}

export function readRuntimeRequestStatusFromExecutionState(state: RuntimeExecutionState): RuntimeRequestStatus {
  if (state === 'start_uncertain') return 'start_uncertain'
  if (state === 'stop_uncertain') return 'stop_uncertain'
  if (state === 'stopping') return 'stopping'
  if (state === 'interrupted') return 'interrupted'
  if (state === 'failed') return 'failed'
  if (state === 'completed' || state === 'completed_pending_sync') return 'completed'
  if (state === 'running' || state === 'waiting_permission' || state === 'starting') return 'running'
  if (state === 'sync_degraded') return 'sync_degraded'
  return 'stopped'
}

export function normalizeRuntimeEventForReplay(event: {
  seq: number
  method: string
  params: unknown
  atIso: string
}): BridgeNotificationEvent {
  return {
    seq: event.seq,
    method: event.method,
    params: event.params,
    atIso: event.atIso,
  }
}
