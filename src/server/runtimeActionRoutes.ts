import type { IncomingMessage, ServerResponse } from 'node:http'

import { setJson } from './httpJsonResponse.js'
import { RuntimeThreadBusyError, type RuntimeRequestRecord } from './runtimeStore.js'
import type { RuntimeMessageQueueEntry } from './runtimeMessageQueue.js'

type RuntimeActionResult = {
  status: string
}

export type RuntimeActionRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  startRuntimeTurn: (payload: unknown) => Promise<RuntimeActionResult>
  interruptRuntimeTurn: (payload: unknown) => Promise<RuntimeActionResult>
  getLatestRequestByClientMessageId: (clientMessageId: string) => RuntimeRequestRecord | null
  enqueueRuntimeTurn?: (payload: unknown) => RuntimeMessageQueueEntry
  listRuntimeQueue?: (threadId?: string) => RuntimeMessageQueueEntry[]
  cancelQueuedRuntimeTurn?: (requestId: string) => boolean | Promise<boolean>
  restoreQueuedRuntimeTurn?: (requestId: string) => boolean
  retryQueuedRuntimeTurn?: (requestId: string) => boolean
  reorderQueuedRuntimeTurns?: (threadId: string, requestIds: string[]) => boolean | Promise<boolean>
}

export async function handleRuntimeActionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: RuntimeActionRoutesDependencies,
): Promise<boolean> {
  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/queue' && dependencies.enqueueRuntimeTurn) {
    const payload = await dependencies.readJsonBody(req)
    const result = dependencies.enqueueRuntimeTurn(payload)
    setJson(res, 202, { data: result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/runtime/queue' && dependencies.listRuntimeQueue) {
    const threadId = url.searchParams.get('threadId')?.trim() ?? ''
    setJson(res, 200, { data: dependencies.listRuntimeQueue(threadId) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/queue/reorder' && dependencies.reorderQueuedRuntimeTurns) {
    const payload = await dependencies.readJsonBody(req)
    const row = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const threadId = typeof row.threadId === 'string' ? row.threadId.trim() : ''
    const requestIds = Array.isArray(row.requestIds)
      ? row.requestIds.filter((requestId): requestId is string => typeof requestId === 'string')
      : []
    const reordered = await dependencies.reorderQueuedRuntimeTurns(threadId, requestIds)
    setJson(res, reordered ? 200 : 409, reordered ? { ok: true } : { error: 'Runtime queue changed before reorder' })
    return true
  }

  if (url.pathname.startsWith('/codex-api/runtime/queue/')) {
    const suffix = decodeURIComponent(url.pathname.slice('/codex-api/runtime/queue/'.length)).trim()
    const isRetry = suffix.endsWith('/retry')
    const isRestore = suffix.endsWith('/restore')
    const requestId = (
      isRetry
        ? suffix.slice(0, -'/retry'.length)
        : isRestore
          ? suffix.slice(0, -'/restore'.length)
          : suffix
    ).trim()
    if (!requestId) {
      setJson(res, 400, { error: 'Missing queue request id' })
      return true
    }
    if (req.method === 'DELETE' && !isRetry && !isRestore && dependencies.cancelQueuedRuntimeTurn) {
      const removed = await dependencies.cancelQueuedRuntimeTurn(requestId)
      setJson(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'Queued message not found' })
      return true
    }
    if (req.method === 'POST' && isRetry && dependencies.retryQueuedRuntimeTurn) {
      const retried = dependencies.retryQueuedRuntimeTurn(requestId)
      setJson(res, retried ? 202 : 409, retried ? { ok: true } : { error: 'Queued message is not retryable' })
      return true
    }
    if (req.method === 'POST' && isRestore && dependencies.restoreQueuedRuntimeTurn) {
      const restored = dependencies.restoreQueuedRuntimeTurn(requestId)
      setJson(res, restored ? 202 : 409, restored ? { ok: true } : { error: 'Queued message is not restorable' })
      return true
    }
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/send') {
    const payload = await dependencies.readJsonBody(req)
    try {
      const result = await dependencies.startRuntimeTurn(payload)
      setJson(res, isRuntimeStartPending(result.status) ? 202 : 200, { data: result })
    } catch (error) {
      if (!(error instanceof RuntimeThreadBusyError)) throw error
      setJson(res, 409, {
        error: '当前会话已有任务正在执行，请等待完成后再发送。',
        code: error.code,
      })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/runtime/request') {
    const clientMessageId = url.searchParams.get('clientMessageId')?.trim() ?? ''
    if (!clientMessageId) {
      setJson(res, 400, { error: 'Missing clientMessageId' })
      return true
    }
    const request = dependencies.getLatestRequestByClientMessageId(clientMessageId)
    if (!request) {
      setJson(res, 404, { data: null })
      return true
    }
    setJson(res, 200, { data: request })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/interrupt') {
    const payload = await dependencies.readJsonBody(req)
    const result = await dependencies.interruptRuntimeTurn(payload)
    setJson(res, result.status === 'stop_uncertain' ? 202 : 200, { data: result })
    return true
  }

  return false
}

function isRuntimeStartPending(status: string): boolean {
  return status === 'queued'
    || status === 'pending_start'
    || status === 'starting'
    || status === 'start_uncertain'
    || status === 'sync_degraded'
}
