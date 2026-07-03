const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_METHODS_WITH_TURNS = new Set(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])

export function trimThreadTurnsInRpcResult(method: string, result: unknown): unknown {
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns || turns.length <= THREAD_RESPONSE_TURN_LIMIT) return result

  return {
    ...record,
    thread: {
      ...thread,
      turns: turns.slice(-THREAD_RESPONSE_TURN_LIMIT),
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
