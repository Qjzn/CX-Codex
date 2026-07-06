const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_RESPONSE_TURN_ITEM_LIMIT = 160
const THREAD_RESPONSE_TURN_HEAD_ITEM_LIMIT = 1
const THREAD_METHODS_WITH_TURNS = new Set(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])
const LOW_VALUE_THREAD_ITEM_TYPES = new Set(['fileChange', 'mcpToolCall', 'reasoning'])
const MIN_THREAD_RESPONSE_TURN_LIMIT = 1

type ThreadTurnWindowOptions = {
  view: 'older'
  beforeTurnIndex: number
  limit?: number
}

export function trimThreadTurnsInRpcResult(
  method: string,
  result: unknown,
  options: { preserveFullTurns?: boolean; turnWindow?: ThreadTurnWindowOptions } = {},
): unknown {
  if (options.preserveFullTurns === true) return result
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns) return result

  const window = selectTurnWindow(turns, options.turnWindow)
  const trimmedTurns = window.turns.map(trimTurnItems)
  const didTrimTurns = window.turns.length !== turns.length || window.startIndex !== 0 || window.view !== ''
  const didTrimItems = trimmedTurns.some((turn, index) => turn !== window.turns[index])
  if (!didTrimTurns && !didTrimItems) return result

  return {
    ...record,
    thread: {
      ...thread,
      turns: trimmedTurns,
      ...(didTrimTurns
        ? {
            turnsView: window.view || 'recent',
            originalTurnsCount: turns.length,
            turnsStartIndex: window.startIndex,
          }
        : {}),
    },
  }
}

function selectTurnWindow(turns: unknown[], options?: ThreadTurnWindowOptions): { turns: unknown[]; startIndex: number; view: '' | 'recent' | 'older' } {
  if (options?.view === 'older') {
    const limit = clampTurnLimit(options.limit)
    const beforeTurnIndex = clampIndex(options.beforeTurnIndex, 0, turns.length)
    const startIndex = Math.max(0, beforeTurnIndex - limit)
    return {
      turns: turns.slice(startIndex, beforeTurnIndex),
      startIndex,
      view: 'older',
    }
  }

  if (turns.length <= THREAD_RESPONSE_TURN_LIMIT) {
    return { turns, startIndex: 0, view: '' }
  }

  const startIndex = turns.length - THREAD_RESPONSE_TURN_LIMIT
  return {
    turns: turns.slice(startIndex),
    startIndex,
    view: 'recent',
  }
}

function clampTurnLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_THREAD_RESPONSE_TURN_LIMIT, Math.min(THREAD_RESPONSE_TURN_LIMIT, Math.trunc(value)))
    : THREAD_RESPONSE_TURN_LIMIT
}

function clampIndex(value: unknown, minValue: number, maxValue: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minValue, Math.min(maxValue, Math.trunc(value)))
    : maxValue
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
