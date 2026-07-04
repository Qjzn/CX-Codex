import {
  createAppServerRpcErrorResponse,
  createAppServerRpcSuccessResponse,
  type AppServerJsonRpcResponse,
} from './appServerJsonRpcWire.js'

export type ServerRequestReply = {
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

export type ParsedServerRequestReply = {
  id: number
  reply: ServerRequestReply
}

export function readServerRequestReplyPayload(payload: unknown): ParsedServerRequestReply {
  const body = asRecord(payload)
  if (!body) {
    throw new Error('Invalid response payload: expected object')
  }

  const id = body.id
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('Invalid response payload: "id" must be an integer')
  }

  const rawError = asRecord(body.error)
  if (rawError) {
    const message = typeof rawError.message === 'string' && rawError.message.trim().length > 0
      ? rawError.message.trim()
      : 'Server request rejected by client'
    const code = typeof rawError.code === 'number' && Number.isFinite(rawError.code)
      ? Math.trunc(rawError.code)
      : -32000
    return { id, reply: { error: { code, message } } }
  }

  if (!('result' in body)) {
    throw new Error('Invalid response payload: expected "result" or "error"')
  }

  return { id, reply: { result: body.result } }
}

export function createServerRequestReplyResponse(requestId: number, reply: ServerRequestReply): AppServerJsonRpcResponse {
  if (reply.error) {
    return createAppServerRpcErrorResponse(requestId, reply.error)
  }
  return createAppServerRpcSuccessResponse(requestId, reply.result ?? {})
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
