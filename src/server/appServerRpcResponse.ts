import { createAppServerJsonRpcError } from './appServerRpcErrors.js'
import type { AppServerJsonRpcLineEvent } from './appServerJsonRpcWire.js'
import type { PendingAppServerRpc } from './appServerPendingRpcStore.js'

export type AppServerRpcResponseEvent = Extract<AppServerJsonRpcLineEvent, { kind: 'response' }>

type AppServerRpcResponseDependencies = {
  finalizePendingRpc: (id: number) => PendingAppServerRpc | null
  logSlowRpc: (
    method: string,
    startedAtMs: number,
    params: unknown,
    details: { outcome: 'error' | 'success' },
  ) => void
}

export function settleAppServerRpcResponse(
  response: AppServerRpcResponseEvent,
  dependencies: AppServerRpcResponseDependencies,
): boolean {
  const pendingRequest = dependencies.finalizePendingRpc(response.id)
  if (!pendingRequest) return false

  dependencies.logSlowRpc(pendingRequest.method, pendingRequest.startedAtMs, pendingRequest.params, {
    outcome: response.error ? 'error' : 'success',
  })
  if (response.error) {
    pendingRequest.reject(createAppServerJsonRpcError(response.error))
  } else {
    pendingRequest.resolve(response.result)
  }
  return true
}
