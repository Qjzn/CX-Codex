export function readStringByAliases(record: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = normalizeId(record[key])
    if (value) return value
  }
  return ''
}

export function readThreadIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''

  const direct = readStringByAliases(root, 'threadId', 'thread_id')
  if (direct) return direct

  const request = asRecord(root.request)
  const requestThreadId = readStringByAliases(request, 'threadId', 'thread_id')
  if (requestThreadId) return requestThreadId
  const requestParams = asRecord(request?.params)
  const requestParamsThreadId = readStringByAliases(requestParams, 'threadId', 'thread_id')
  if (requestParamsThreadId) return requestParamsThreadId

  const params = asRecord(root.params)
  const paramsThreadId = readStringByAliases(params, 'threadId', 'thread_id')
  if (paramsThreadId) return paramsThreadId

  const thread = asRecord(root.thread)
  const threadId = readStringByAliases(thread, 'id', 'threadId', 'thread_id')
  if (threadId) return threadId

  const turn = asRecord(root.turn)
  const turnThreadId = readStringByAliases(turn, 'threadId', 'thread_id')
  if (turnThreadId) return turnThreadId

  const item = asRecord(root.item)
  const itemThreadId = readStringByAliases(item, 'threadId', 'thread_id')
  if (itemThreadId) return itemThreadId

  return ''
}

export function readTurnIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  const direct = readStringByAliases(root, 'turnId', 'turn_id', 'activeTurnId')
  if (direct) return direct
  const request = asRecord(root.request)
  const requestTurnId = readStringByAliases(request, 'turnId', 'turn_id', 'activeTurnId')
  if (requestTurnId) return requestTurnId
  const requestParams = asRecord(request?.params)
  const requestParamsTurnId = readStringByAliases(requestParams, 'turnId', 'turn_id', 'activeTurnId')
  if (requestParamsTurnId) return requestParamsTurnId
  const params = asRecord(root.params)
  const paramsTurnId = readStringByAliases(params, 'turnId', 'turn_id', 'activeTurnId')
  if (paramsTurnId) return paramsTurnId
  const turn = asRecord(root.turn)
  const turnId = readStringByAliases(turn, 'id', 'turnId', 'turn_id')
  if (turnId) return turnId
  const item = asRecord(root.item)
  return readStringByAliases(item, 'turnId', 'turn_id')
}

export function readItemIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  const direct = readStringByAliases(root, 'itemId', 'item_id')
  if (direct) return direct
  const item = asRecord(root.item)
  return readStringByAliases(item, 'id', 'itemId', 'item_id')
}

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
