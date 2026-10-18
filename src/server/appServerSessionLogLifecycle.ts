export type SessionLogTurnLifecycle = {
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted'
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number
  error?: { message: string }
}

type LifecycleUpdate = SessionLogTurnLifecycle & { turnId: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function eventTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function unixSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  const timestamp = new Date(value * 1000)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

// Codex 0.153.4 lifecycle fields are Unix seconds, while duration_ms is
// milliseconds. The enclosing event timestamp is only a legacy-field fallback;
// message timestamps, read time, and last_agent_message are never lifecycle.
export function readSessionLogLifecycle(entry: Record<string, unknown>): LifecycleUpdate | null {
  if (entry.type !== 'event_msg') return null
  const payload = asRecord(entry.payload)
  if (!payload || !['task_started', 'task_complete', 'turn_aborted'].includes(String(payload.type))) return null
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : ''
  if (!turnId) return null
  const startedAt = unixSeconds(payload.started_at)
  const at = eventTimestamp(entry.timestamp)
  if (payload.type === 'task_started') {
    return { turnId, status: 'inProgress', startedAt: startedAt ?? at, completedAt: null }
  }
  const status = payload.type === 'turn_aborted' ? 'interrupted'
    : payload.error != null ? 'failed' : 'completed'
  const error = asRecord(payload.error)
  const errorMessage = typeof error?.message === 'string' ? error.message.trim().slice(0, 2000) : ''
  return {
    turnId, status, startedAt,
    completedAt: unixSeconds(payload.completed_at) ?? at,
    ...(typeof payload.duration_ms === 'number' && Number.isSafeInteger(payload.duration_ms) && payload.duration_ms >= 0
      ? { durationMs: payload.duration_ms } : {}),
    ...(errorMessage ? { error: { message: errorMessage } } : {}),
  }
}

export function hasSettledSessionLogLifecycle(turn: SessionLogTurnLifecycle): boolean {
  return turn.status !== 'inProgress' && Object.hasOwn(turn, 'completedAt')
}

export function applySessionLogLifecycle(turn: SessionLogTurnLifecycle, update: LifecycleUpdate): void {
  // Default legacy turns have no lifecycle fields. Once an explicit terminal
  // has settled this ID, replay cannot reopen it or move its completion clock.
  if (hasSettledSessionLogLifecycle(turn)) return
  turn.status = update.status
  turn.startedAt ??= update.startedAt ?? null
  turn.completedAt = update.completedAt ?? null
  if (turn.startedAt && turn.completedAt && Date.parse(turn.completedAt) < Date.parse(turn.startedAt)) {
    turn.completedAt = null
  }
  if (update.durationMs !== undefined) turn.durationMs = update.durationMs
  if (update.error) turn.error = { ...update.error }
}
