import type { RuntimeRequestStatus } from '../api/codexGateway'

export function isRuntimeRequestAwaitingDeliveryConfirmation(status: RuntimeRequestStatus): boolean {
  return (
    status === 'pending_start'
    || status === 'starting'
    || status === 'start_uncertain'
    || status === 'sync_degraded'
  )
}
