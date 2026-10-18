import type { RuntimeRequestRecord } from './runtimeStore.js'

const RESERVED_ASSISTANT_CLIENT_ID = /^(assistant-main|assistant-task|assistant-report):/

function isReservedClientMessageId(value: string): boolean {
  return RESERVED_ASSISTANT_CLIENT_ID.test(value.trim())
}

// Public runtime mutations must never touch the assistant-main/task/report
// namespace: those ids mark host-owned work that only dedicated internal
// starters and their own request records may create or change. A matching
// prefix is not a privilege grant here, it is a rejection.
export function isPublicAssistantRequestAllowed(
  payload: unknown,
  getRequest: (id: string) => RuntimeRequestRecord | null,
  isWorkerThread?: (threadId: string) => boolean,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true
  const body = payload as Record<string, unknown>
  // Both camelCase and snake_case aliases are checked independently: a
  // non-worker threadId must never mask a worker thread_id (or vice versa).
  for (const key of ['threadId', 'thread_id']) {
    const value = body[key]
    if (typeof value === 'string' && isWorkerThread?.(value.trim())) return false
  }
  const clientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : ''
  if (clientMessageId && isReservedClientMessageId(clientMessageId)) return false

  const requestIds: string[] = []
  if (typeof body.requestId === 'string' && body.requestId.trim()) requestIds.push(body.requestId.trim())
  if (Array.isArray(body.requestIds)) {
    for (const requestId of body.requestIds) {
      if (typeof requestId === 'string' && requestId.trim()) requestIds.push(requestId.trim())
    }
  }

  for (const requestId of requestIds) {
    if (isReservedClientMessageId(requestId)) return false
    // Storage errors must surface to the caller, never degrade to "allowed".
    const existing = getRequest(requestId)
    if (existing && isReservedClientMessageId(existing.clientMessageId)) return false
    const existingThreadId = typeof existing?.threadId === 'string' ? existing.threadId.trim() : ''
    if (existingThreadId && isWorkerThread?.(existingThreadId)) return false
  }
  return true
}
