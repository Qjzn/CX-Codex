const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_RESPONSE_TURN_ITEM_LIMIT = 160
const THREAD_RESPONSE_TURN_HEAD_ITEM_LIMIT = 1
const THREAD_METHODS_WITH_TURNS = new Set(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])
const LOW_VALUE_THREAD_ITEM_TYPES = new Set(['fileChange', 'mcpToolCall', 'reasoning'])

export function trimThreadTurnsInRpcResult(method: string, result: unknown): unknown {
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns) return result

  const recentTurns = turns.length > THREAD_RESPONSE_TURN_LIMIT
    ? turns.slice(-THREAD_RESPONSE_TURN_LIMIT)
    : turns
  const trimmedTurns = recentTurns.map(trimTurnItems)
  const didTrimTurns = recentTurns !== turns
  const didTrimItems = trimmedTurns.some((turn, index) => turn !== recentTurns[index])
  if (!didTrimTurns && !didTrimItems) return result

  return {
    ...record,
    thread: {
      ...thread,
      turns: trimmedTurns,
      ...(didTrimTurns
        ? {
            turnsView: 'recent',
            originalTurnsCount: turns.length,
          }
        : {}),
    },
  }
}

function trimTurnItems(turn: unknown): unknown {
  const record = asRecord(turn)
  const items = Array.isArray(record?.items) ? record.items : null
  if (!record || !items) return turn

  const filteredItems = items.filter((item) => !isLowValueThreadItem(item))
  if (filteredItems.length <= THREAD_RESPONSE_TURN_ITEM_LIMIT) {
    return filteredItems.length === items.length
      ? turn
      : {
          ...record,
          items: filteredItems,
        }
  }

  const tailItemLimit = THREAD_RESPONSE_TURN_ITEM_LIMIT - THREAD_RESPONSE_TURN_HEAD_ITEM_LIMIT
  return {
    ...record,
    items: [
      ...filteredItems.slice(0, THREAD_RESPONSE_TURN_HEAD_ITEM_LIMIT),
      ...filteredItems.slice(-tailItemLimit),
    ],
    itemsView: 'recent',
    originalItemsCount: items.length,
  }
}

function isLowValueThreadItem(item: unknown): boolean {
  const record = asRecord(item)
  return typeof record?.type === 'string' && LOW_VALUE_THREAD_ITEM_TYPES.has(record.type)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
