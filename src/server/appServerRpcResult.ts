const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_RESPONSE_TURN_ITEM_LIMIT = 160
const THREAD_RESPONSE_TURN_HEAD_ITEM_LIMIT = 1
const THREAD_METHODS_WITH_TURNS = new Set(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])
const MIN_THREAD_RESPONSE_TURN_LIMIT = 1
const THREAD_FILE_CHANGE_LIMIT = 32
const THREAD_FILE_DIFF_TEXT_LIMIT = 20_000
const THREAD_COMMAND_OUTPUT_LIMIT = 24_000
const THREAD_MCP_ERROR_LIMIT = 4_000

type ThreadTurnWindowOptions = {
  view: 'older'
  beforeTurnIndex: number
  limit?: number
}

export function annotateRecentThreadReadWithRecoveredHistory(
  threadRead: unknown,
  recoveredThreadRead: unknown,
): unknown {
  const record = asRecord(threadRead)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  const recoveredThread = asRecord(asRecord(recoveredThreadRead)?.thread)
  const recoveredTurns = Array.isArray(recoveredThread?.turns) ? recoveredThread.turns : null
  if (!record || !thread || !turns || !recoveredTurns || recoveredTurns.length <= turns.length) return threadRead
  if (typeof thread.turnsView === 'string' && thread.turnsView.trim()) return threadRead

  return {
    ...record,
    thread: {
      ...thread,
      turnsView: 'recent',
      originalTurnsCount: recoveredTurns.length,
      turnsStartIndex: recoveredTurns.length - turns.length,
    },
  }
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

  const existingStartIndex = readNonNegativeInteger(thread.turnsStartIndex) ?? 0
  const existingOriginalTurnsCount = Math.max(
    existingStartIndex + turns.length,
    readNonNegativeInteger(thread.originalTurnsCount) ?? 0,
  )
  const window = selectTurnWindow(
    turns,
    options.turnWindow,
    existingStartIndex,
    existingOriginalTurnsCount,
  )
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
            originalTurnsCount: window.originalTurnsCount,
            turnsStartIndex: window.startIndex,
          }
        : {}),
    },
  }
}

function selectTurnWindow(
  turns: unknown[],
  options: ThreadTurnWindowOptions | undefined,
  existingStartIndex: number,
  originalTurnsCount: number,
): { turns: unknown[]; startIndex: number; originalTurnsCount: number; view: '' | 'recent' | 'older' } {
  if (options?.view === 'older') {
    const limit = clampTurnLimit(options.limit)
    const availableEndIndex = existingStartIndex + turns.length
    const beforeTurnIndex = clampIndex(options.beforeTurnIndex, existingStartIndex, availableEndIndex)
    const startIndex = Math.max(existingStartIndex, beforeTurnIndex - limit)
    return {
      turns: turns.slice(startIndex - existingStartIndex, beforeTurnIndex - existingStartIndex),
      startIndex,
      originalTurnsCount,
      view: 'older',
    }
  }

  if (turns.length <= THREAD_RESPONSE_TURN_LIMIT) {
    return { turns, startIndex: existingStartIndex, originalTurnsCount, view: '' }
  }

  const relativeStartIndex = turns.length - THREAD_RESPONSE_TURN_LIMIT
  const startIndex = existingStartIndex + relativeStartIndex
  return {
    turns: turns.slice(relativeStartIndex),
    startIndex,
    originalTurnsCount,
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

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

function trimTurnItems(turn: unknown): unknown {
  const record = asRecord(turn)
  const items = Array.isArray(record?.items) ? record.items : null
  if (!record || !items) return turn

  const filteredItems = items.map(compactObservableThreadItem)
  if (filteredItems.length <= THREAD_RESPONSE_TURN_ITEM_LIMIT) {
    const didCompactItems = filteredItems.some((item, index) => item !== items[index])
    return !didCompactItems
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

function compactObservableThreadItem(item: unknown): unknown {
  const record = asRecord(item)
  if (!record) return item

  if (record.type === 'fileChange') {
    const changes = Array.isArray(record.changes) ? record.changes : []
    const boundedChanges = changes.slice(0, THREAD_FILE_CHANGE_LIMIT).map((change) => {
      const row = asRecord(change)
      if (!row) return change
      return {
        path: typeof row.path === 'string' ? row.path : '',
        kind: row.kind ?? { type: 'update', move_path: null },
        diff: boundText(typeof row.diff === 'string' ? row.diff : '', THREAD_FILE_DIFF_TEXT_LIMIT),
      }
    })
    return {
      ...record,
      changes: boundedChanges,
      ...(changes.length > boundedChanges.length
        ? { changesView: 'bounded', originalChangesCount: changes.length }
        : {}),
    }
  }

  if (record.type === 'mcpToolCall') {
    const error = asRecord(record.error)
    return {
      type: record.type,
      id: record.id,
      server: record.server,
      tool: record.tool,
      status: record.status,
      durationMs: record.durationMs,
      arguments: null,
      result: null,
      error: error
        ? { message: boundText(typeof error.message === 'string' ? error.message : '', THREAD_MCP_ERROR_LIMIT) }
        : null,
      payloadView: 'metadata-only',
    }
  }

  if (record.type === 'reasoning') {
    return {
      type: record.type,
      id: record.id,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
      payloadView: 'metadata-only',
    }
  }

  if (record.type === 'commandExecution' && typeof record.aggregatedOutput === 'string') {
    const boundedOutput = boundText(record.aggregatedOutput, THREAD_COMMAND_OUTPUT_LIMIT)
    return boundedOutput === record.aggregatedOutput
      ? item
      : { ...record, aggregatedOutput: boundedOutput, outputView: 'bounded' }
  }

  return item
}

function boundText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n\n[content bounded by CX-Codex]`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
