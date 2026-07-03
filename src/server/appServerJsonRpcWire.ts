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
