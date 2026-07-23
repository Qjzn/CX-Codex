import type { RuntimeRequestStatus, ThreadRuntimeSnapshot } from '../api/codexGateway'

export function isRuntimeRequestAwaitingDeliveryConfirmation(status: RuntimeRequestStatus): boolean {
  return (
    status === 'pending_start'
    || status === 'starting'
    || status === 'start_uncertain'
    || status === 'sync_degraded'
  )
}

export function shouldSettleOptimisticDeliveryFromRuntimeSnapshot(
  executionState: ThreadRuntimeSnapshot['executionState'],
  hasUnconfirmedOutboxEntry: boolean,
): boolean {
  return executionState !== 'failed' || !hasUnconfirmedOutboxEntry
}
