import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  shouldInvalidateThreadListCacheForRpc,
  shouldInvalidateThreadReadCacheForRpc,
} from './appServerRpcCache.js'
import {
  isInterruptSettledError,
  isRpcTimeoutError,
  isThreadMaterializingError,
} from './appServerRpcErrors.js'
import { trimThreadTurnsInRpcResult } from './appServerRpcResult.js'
import {
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import { readThreadSessionPathFromThreadReadPayload } from './appServerThreadPayload.js'
import { readThreadReadIncludeTurns } from './appServerThreadReadParams.js'
import { readThreadReadFromSessionLog } from './appServerSessionLogThreadRead.js'
import { setJson } from './httpJsonResponse.js'
import {
  normalizePlanModeTurnStartParams,
  readCollaborationModeFromPayload,
  shouldRetryPlanModeWithoutNativeMode,
} from './runtimePayload.js'

type RpcProxyRequest = {
  method: string
  params?: unknown
}

type RpcRuntimeStateStore = {
  markStarting: (threadId: string, turnId?: string) => void
  markStopping: (threadId: string) => void
  markQueued: (threadId: string) => void
  markRunning: (threadId: string, turnId?: string) => void
  markInterrupted: (threadId: string) => void
}

export type RpcProxyRouteDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  rpc: (method: string, params: unknown) => Promise<unknown>
  runtimeStateStore: RpcRuntimeStateStore
  persistRuntimeSnapshot: (threadId: string) => unknown
  markPlanModeTurn: (threadId: string, turnId?: string) => void
  clearPlanModeTurn: (threadId: string, turnId?: string) => void
  observeThreadUnsubscribeResponse: (details: { threadId?: string; payload: unknown }) => void
  deleteCachedThreadRead: (threadId: string) => void
  rememberCachedThreadRead: (threadId: string, threadRead: unknown) => void
  readSessionLogThreadRead?: (sessionPath: string, fallbackThreadRead: unknown) => Promise<unknown | null>
  augmentThreadListRpcResult: (params: unknown, result: unknown) => Promise<unknown>
  clearThreadSearchIndex: () => void
}

export async function handleRpcProxyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: RpcProxyRouteDependencies,
): Promise<boolean> {
  if (req.method !== 'POST' || url.pathname !== '/codex-api/rpc') {
    return false
  }

  const payload = await dependencies.readJsonBody(req)
  const body = asRecord(payload) as RpcProxyRequest | null

  if (!body || typeof body.method !== 'string' || body.method.length === 0) {
    setJson(res, 400, { error: 'Invalid body: expected { method, params? }' })
    return true
  }

  const collaborationMode = body.method === 'turn/start'
    ? readCollaborationModeFromPayload(body.params)
    : 'execute'
  const threadReadResponseView = readThreadReadResponseView(body.method, body.params)
  const requestedFullThreadRead = threadReadResponseView === 'full'
  const requestedTurnWindow = readThreadReadTurnWindow(body.method, body.params)
  const forwardedParams = stripLocalThreadReadParams(body.method, body.params)
  const rpcParams = body.method === 'turn/start'
    ? normalizePlanModeTurnStartParams(forwardedParams, { includeNativeMode: true })
    : forwardedParams
  const rpcThreadId = readThreadIdFromPayload(rpcParams)
  if (rpcThreadId && shouldInvalidateThreadReadCacheForRpc(body.method)) {
    dependencies.deleteCachedThreadRead(rpcThreadId)
  }
  if (body.method === 'turn/start' && rpcThreadId) {
    const initialTurnId = readTurnIdFromPayload(rpcParams)
    dependencies.runtimeStateStore.markStarting(rpcThreadId, initialTurnId)
    dependencies.persistRuntimeSnapshot(rpcThreadId)
    if (collaborationMode === 'plan') {
      dependencies.markPlanModeTurn(rpcThreadId, initialTurnId)
    }
  } else if (body.method === 'turn/interrupt' && rpcThreadId) {
    dependencies.runtimeStateStore.markStopping(rpcThreadId)
    dependencies.persistRuntimeSnapshot(rpcThreadId)
  } else if (body.method === 'thread/resume' && rpcThreadId) {
    dependencies.runtimeStateStore.markQueued(rpcThreadId)
    dependencies.persistRuntimeSnapshot(rpcThreadId)
  }

  let rpcResult: unknown
  try {
    try {
      rpcResult = await dependencies.rpc(body.method, rpcParams ?? null)
    } catch (error) {
      if (body.method !== 'turn/start' || collaborationMode !== 'plan' || !shouldRetryPlanModeWithoutNativeMode(error)) {
        throw error
      }
      const fallbackParams = normalizePlanModeTurnStartParams(body.params, { includeNativeMode: false })
      rpcResult = await dependencies.rpc(body.method, fallbackParams ?? null)
    }
    if (body.method === 'turn/start' && rpcThreadId) {
      const startedTurnId = readTurnIdFromPayload(rpcResult)
      dependencies.runtimeStateStore.markRunning(rpcThreadId, startedTurnId)
      dependencies.persistRuntimeSnapshot(rpcThreadId)
      if (collaborationMode === 'plan' && startedTurnId) {
        dependencies.markPlanModeTurn(rpcThreadId, startedTurnId)
      }
    } else if (body.method === 'turn/interrupt' && rpcThreadId) {
      dependencies.clearPlanModeTurn(rpcThreadId, readTurnIdFromPayload(rpcParams))
    }
    if (body.method === 'thread/unsubscribe') {
      dependencies.observeThreadUnsubscribeResponse({ threadId: rpcThreadId, payload: rpcResult })
    }
  } catch (error) {
    if (
      body.method === 'thread/read' &&
      rpcThreadId &&
      readThreadReadIncludeTurns(rpcParams) &&
      isThreadMaterializingError(error)
    ) {
      const fallbackThreadRead = await readSessionLogFallbackThreadRead(rpcThreadId, rpcParams, dependencies)
      if (fallbackThreadRead) {
        const result = trimThreadTurnsInRpcResult(body.method, fallbackThreadRead, {
          preserveFullTurns: requestedFullThreadRead,
          turnWindow: requestedTurnWindow,
        })
        if (!requestedFullThreadRead && !requestedTurnWindow) {
          dependencies.rememberCachedThreadRead(rpcThreadId, result)
        }
        setJson(res, 200, {
          result,
          warning: 'thread/read fell back to local session log messages',
        })
        return true
      }
    }
    if (body.method === 'turn/interrupt' && rpcThreadId && isInterruptSettledError(error)) {
      dependencies.clearPlanModeTurn(rpcThreadId, readTurnIdFromPayload(rpcParams))
      dependencies.runtimeStateStore.markInterrupted(rpcThreadId)
      dependencies.persistRuntimeSnapshot(rpcThreadId)
      setJson(res, 200, {
        result: null,
        warning: isRpcTimeoutError(error)
          ? 'turn/interrupt timed out; runtime state was settled locally'
          : 'turn/interrupt did not find an active turn; runtime state was settled locally',
      })
      return true
    }
    if (
      (body.method === 'thread/resume' || body.method === 'thread/archive')
      && isThreadMaterializingError(error)
    ) {
      setJson(res, 200, { result: null })
      return true
    }
    throw error
  }

  const enrichedRpcResult = body.method === 'thread/list'
    ? await dependencies.augmentThreadListRpcResult(rpcParams, rpcResult)
    : rpcResult
  const result = trimThreadTurnsInRpcResult(body.method, enrichedRpcResult, {
    preserveFullTurns: requestedFullThreadRead,
    turnWindow: requestedTurnWindow,
  })
  if (shouldInvalidateThreadListCacheForRpc(body.method)) {
    dependencies.clearThreadSearchIndex()
  }
  if (
    body.method === 'thread/read' &&
    rpcThreadId &&
    readThreadReadIncludeTurns(rpcParams) &&
    !requestedFullThreadRead &&
    !requestedTurnWindow
  ) {
    dependencies.rememberCachedThreadRead(rpcThreadId, result)
  }
  setJson(res, 200, { result })
  return true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readThreadReadResponseView(method: string, params: unknown): '' | 'full' | 'older' {
  const record = asRecord(params)
  if (method !== 'thread/read' || !readThreadReadIncludeTurns(record)) return ''
  return record?.responseView === 'full'
    ? 'full'
    : record?.responseView === 'older'
      ? 'older'
      : ''
}

function readThreadReadTurnWindow(method: string, params: unknown): { view: 'older'; beforeTurnIndex: number; limit?: number } | undefined {
  const record = asRecord(params)
  if (readThreadReadResponseView(method, record) !== 'older') return undefined
  const beforeTurnIndex = readNonNegativeInteger(record?.beforeTurnIndex)
  if (beforeTurnIndex === null) return undefined
  const limit = readNonNegativeInteger(record?.turnLimit)
  return {
    view: 'older',
    beforeTurnIndex,
    ...(limit !== null ? { limit } : {}),
  }
}

function stripLocalThreadReadParams(method: string, params: unknown): unknown {
  const record = asRecord(params)
  if (
    method !== 'thread/read' ||
    !record ||
    (
      record.responseView === undefined &&
      record.beforeTurnIndex === undefined &&
      record.turnLimit === undefined
    )
  ) {
    return params
  }
  const {
    responseView: _responseView,
    beforeTurnIndex: _beforeTurnIndex,
    turnLimit: _turnLimit,
    ...forwarded
  } = record
  return forwarded
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

async function readSessionLogFallbackThreadRead(
  threadId: string,
  rpcParams: unknown,
  dependencies: RpcProxyRouteDependencies,
): Promise<unknown | null> {
  try {
    const rawParams = asRecord(rpcParams)
    const lightThreadRead = await dependencies.rpc('thread/read', {
      ...(rawParams ?? {}),
      threadId,
      includeTurns: false,
    })
    const sessionPath = readThreadSessionPathFromThreadReadPayload(lightThreadRead)
    if (!sessionPath) return null
    return await (dependencies.readSessionLogThreadRead ?? readThreadReadFromSessionLog)(sessionPath, lightThreadRead)
  } catch {
    return null
  }
}
