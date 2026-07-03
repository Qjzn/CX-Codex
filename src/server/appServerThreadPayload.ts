export function readActiveTurnIdFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const directActiveTurnId = typeof thread?.activeTurnId === 'string' ? thread.activeTurnId.trim() : ''
  if (directActiveTurnId) {
    return directActiveTurnId
  }
  const status = asRecord(thread?.status)
  const statusActiveTurnId =
    typeof status?.activeTurnId === 'string'
      ? status.activeTurnId.trim()
      : typeof status?.turnId === 'string'
        ? status.turnId.trim()
        : ''
  if (statusActiveTurnId) {
    return statusActiveTurnId
  }
  const turns = readTurnsFromThreadReadPayload(payload)
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const turnId = typeof turn.id === 'string' ? turn.id.trim() : ''
    if (turnId && isTurnInProgress(turn)) {
      return turnId
    }
  }
  return ''
}

export function readThreadInProgressFromThreadReadPayload(payload: unknown): boolean {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  if (thread?.inProgress === true) {
    return true
  }
  const turnStatus = typeof thread?.turnStatus === 'string' ? thread.turnStatus.trim().toLowerCase() : ''
  if (turnStatus === 'inprogress' || turnStatus === 'in_progress') {
    return true
  }
  const statusType = readThreadStatusTypeFromPayload(payload)
  if (
    statusType === 'inprogress'
    || statusType === 'in_progress'
    || statusType === 'running'
    || statusType === 'active'
    || statusType === 'processing'
  ) {
    return true
  }
  const turns = readTurnsFromThreadReadPayload(payload)
  return isTurnInProgress(turns.at(-1))
}

export function readThreadUpdatedAtIsoFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  return toIsoFromUnixSeconds(thread?.updatedAt)
}

export function readThreadSessionPathFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const sessionPath = typeof thread?.path === 'string' ? thread.path.trim() : ''
  if (sessionPath) return sessionPath
  return typeof root?.path === 'string' ? root.path.trim() : ''
}

function readThreadStatusTypeFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const status = thread?.status
  if (typeof status === 'string') {
    return status.trim().toLowerCase()
  }
  const statusRecord = asRecord(status)
  return typeof statusRecord?.type === 'string' ? statusRecord.type.trim().toLowerCase() : ''
}

function readTurnsFromThreadReadPayload(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  return turns
    .map((turn) => asRecord(turn))
    .filter((turn): turn is Record<string, unknown> => turn !== null)
}

function isTurnInProgress(turn: Record<string, unknown> | null | undefined): boolean {
  return turn?.status === 'inProgress'
}

function toIsoFromUnixSeconds(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
