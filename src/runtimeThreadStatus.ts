export type RuntimeThreadStatusLifecycle =
  | 'active'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'stopped'
  | 'unknown'

export function readRuntimeThreadStatusLifecycle(payload: unknown): RuntimeThreadStatusLifecycle {
  const root = asRecord(payload)
  const status = root?.status
  const statusRecord = asRecord(status)
  const statusType = normalizeStatusValue(
    typeof status === 'string' ? status : statusRecord?.type,
  )
  const activeFlags = Array.isArray(statusRecord?.activeFlags)
    ? statusRecord.activeFlags.map(normalizeActiveFlag).filter(Boolean)
    : []

  if (
    activeFlags.includes('waitingonapproval')
    || activeFlags.includes('waitingonuserinput')
  ) {
    return 'waiting_permission'
  }

  if (
    statusType === 'awaiting_approval'
    || statusType === 'requires_action'
    || statusType === 'waiting'
    || statusType === 'waiting_permission'
  ) {
    return 'waiting_permission'
  }

  if (
    statusType === 'active'
    || statusType === 'in_progress'
    || statusType === 'inprogress'
    || statusType === 'materializing'
    || statusType === 'pending'
    || statusType === 'processing'
    || statusType === 'queued'
    || statusType === 'running'
    || statusType === 'started'
    || statusType === 'starting'
  ) {
    return 'active'
  }

  if (statusType === 'idle' || statusType === 'complete' || statusType === 'completed') {
    return 'completed'
  }
  if (
    statusType === 'error'
    || statusType === 'failed'
    || statusType === 'system_error'
    || statusType === 'systemerror'
  ) {
    return 'failed'
  }
  if (statusType === 'canceled' || statusType === 'cancelled' || statusType === 'interrupted') {
    return 'interrupted'
  }
  if (statusType === 'stopped') return 'stopped'
  return 'unknown'
}

export function isRuntimeThreadStatusTerminal(
  lifecycle: RuntimeThreadStatusLifecycle,
): lifecycle is 'completed' | 'failed' | 'interrupted' | 'stopped' {
  return (
    lifecycle === 'completed'
    || lifecycle === 'failed'
    || lifecycle === 'interrupted'
    || lifecycle === 'stopped'
  )
}

function normalizeStatusValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeActiveFlag(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9]/gu, '') : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
