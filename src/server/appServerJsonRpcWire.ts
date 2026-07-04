export type AppServerJsonRpcRequest = {
  id: number
  method: string
  params?: unknown
}

export type AppServerJsonRpcNotification = {
  method: string
  params?: unknown
}

export type AppServerJsonRpcResponse = {
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

export type AppServerJsonRpcLineEvent =
  | {
    kind: 'response'
    id: number
    result?: unknown
    error?: AppServerJsonRpcResponse['error']
  }
  | {
    kind: 'notification'
    method: string
    params: unknown
  }
  | {
    kind: 'server-request'
    id: number
    method: string
    params: unknown
  }

export type AppServerJsonRpcLineReadOptions = {
  isPendingResponseId?: (id: number) => boolean
}

export function createAppServerRpcRequest(id: number, method: string, params: unknown): AppServerJsonRpcRequest {
  return {
    id,
    method,
    params,
  }
}

export function createAppServerRpcNotification(method: string, params?: unknown): AppServerJsonRpcNotification {
  if (params === undefined) {
    return { method }
  }
  return { method, params }
}

export function createAppServerRpcSuccessResponse(id: number, result: unknown = {}): AppServerJsonRpcResponse {
  return { id, result }
}

export function createAppServerRpcErrorResponse(
  id: number,
  error: { code: number; message: string },
): AppServerJsonRpcResponse {
  return { id, error }
}

export function readAppServerJsonRpcLineEvent(
  line: string,
  options: AppServerJsonRpcLineReadOptions = {},
): AppServerJsonRpcLineEvent | null {
  let message: {
    id?: unknown
    result?: unknown
    error?: AppServerJsonRpcResponse['error']
    method?: unknown
    params?: unknown
  }
  try {
    message = JSON.parse(line) as typeof message
  } catch {
    return null
  }

  const id = typeof message.id === 'number' ? message.id : null
  const method = typeof message.method === 'string' ? message.method : null

  if (id !== null && options.isPendingResponseId?.(id) === true) {
    return {
      kind: 'response',
      id,
      result: message.result,
      error: message.error,
    }
  }

  if (method !== null && id === null) {
    return {
      kind: 'notification',
      method,
      params: message.params ?? null,
    }
  }

  if (id !== null && method !== null) {
    return {
      kind: 'server-request',
      id,
      method,
      params: message.params ?? null,
    }
  }

  return null
}
