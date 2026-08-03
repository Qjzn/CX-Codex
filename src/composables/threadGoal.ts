import type { UiThreadGoal, UiThreadGoalStatus } from '../types/codex'

const THREAD_GOAL_STATUSES = new Set<UiThreadGoalStatus>([
  'active',
  'paused',
  'budgetLimited',
  'usageLimited',
  'blocked',
  'complete',
])

function readFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}
export function normalizeThreadGoal(value: unknown): UiThreadGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : ''
  const objective = typeof record.objective === 'string' ? record.objective.trim() : ''
  const rawStatus = typeof record.status === 'string' ? record.status.trim() : ''
  if (!threadId || !objective || !THREAD_GOAL_STATUSES.has(rawStatus as UiThreadGoalStatus)) return null

  return {
    threadId,
    objective,
    status: rawStatus as UiThreadGoalStatus,
    tokenBudget: typeof record.tokenBudget === 'number' && Number.isFinite(record.tokenBudget)
      ? Math.max(0, record.tokenBudget)
      : null,
    tokensUsed: readFiniteNumber(record.tokensUsed),
    timeUsedSeconds: readFiniteNumber(record.timeUsedSeconds),
    createdAt: readFiniteNumber(record.createdAt),
    updatedAt: readFiniteNumber(record.updatedAt),
  }
}
