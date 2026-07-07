import type { PendingAppServerRpc } from './appServerPendingRpcStore.js'
import { settleAppServerRpcResponse } from './appServerRpcResponse.js'
import { readAppServerJsonRpcLineEvent } from './appServerJsonRpcWire.js'

export type AppServerLineDispatcherNotification = {
  method: string
  params: unknown
}

export type DispatchAppServerJsonRpcLineDependencies = {
  isPendingResponseId: (id: number) => boolean
  finalizePendingRpc: (id: number) => PendingAppServerRpc | null
  recordRpcCompletion: (
    method: string,
    startedAtMs: number,
    params: unknown,
    details: { outcome: 'error' | 'success' },
  ) => void
  captureNotificationState: (notification: AppServerLineDispatcherNotification) => void
  emitNotification: (notification: AppServerLineDispatcherNotification) => void
  handleServerRequest: (requestId: number, method: string, params: unknown) => void
}

export function dispatchAppServerJsonRpcLine(
  line: string,
  dependencies: DispatchAppServerJsonRpcLineDependencies,
): boolean {
  const message = readAppServerJsonRpcLineEvent(line, {
    isPendingResponseId: dependencies.isPendingResponseId,
  })
  if (!message) return false

  if (message.kind === 'response') {
    settleAppServerRpcResponse(message, {
      finalizePendingRpc: dependencies.finalizePendingRpc,
      recordRpcCompletion: dependencies.recordRpcCompletion,
    })
    return true
  }

  if (message.kind === 'notification') {
    const notification = {
      method: message.method,
      params: message.params,
    }
    dependencies.captureNotificationState(notification)
    dependencies.emitNotification(notification)
    return true
  }

  dependencies.handleServerRequest(message.id, message.method, message.params)
  return true
}
