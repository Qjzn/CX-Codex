import {
  createServerRequestResolvedNotification,
  type PendingServerRequest,
} from './pendingServerRequests.js'
import {
  evaluateServerRequestPolicy,
  isImmediateServerRequestPolicyDecision,
  type WebBridgePermissionSettings,
} from './serverRequestPolicy.js'
import type { ServerRequestReply } from './serverRequestReply.js'

export type AppServerServerRequestNotification = {
  method: string
  params: unknown
}

export type HandleAppServerServerRequestDependencies = {
  permissions: WebBridgePermissionSettings
  isPlanModeRequest: (params: unknown) => boolean
  readThreadIdFromPayload: (payload: unknown) => string
  readTurnIdFromPayload: (payload: unknown) => string
  sendServerRequestReply: (requestId: number, reply: ServerRequestReply) => void
  recordPendingServerRequest: (requestId: number, method: string, params: unknown) => PendingServerRequest
  emitNotification: (notification: AppServerServerRequestNotification) => void
  writeUnsupportedRequestWarning: (details: {
    requestId: number
    method: string
    threadId: string
    turnId: string
  }) => void
}

export type ResolveAppServerPendingServerRequestDependencies = {
  consumePendingServerRequest: (requestId: number) => PendingServerRequest | null
  sendServerRequestReply: (requestId: number, reply: ServerRequestReply) => void
  emitNotification: (notification: AppServerServerRequestNotification) => void
  readThreadIdFromPayload: (payload: unknown) => string
}

export function createAppServerRequestResolvedNotification(options: {
  requestId: number
  method: string
  params: unknown
  mode: 'automatic' | 'manual'
  readThreadIdFromPayload: (payload: unknown) => string
}): AppServerServerRequestNotification {
  return createServerRequestResolvedNotification(options)
}

export function handleAppServerServerRequest(
  requestId: number,
  method: string,
  params: unknown,
  dependencies: HandleAppServerServerRequestDependencies,
): void {
  const policy = evaluateServerRequestPolicy({
    method,
    params,
    permissions: dependencies.permissions,
    isPlanModeRequest: dependencies.isPlanModeRequest(params),
  })

  if (isImmediateServerRequestPolicyDecision(policy)) {
    if (policy.kind === 'reject-unsupported') {
      dependencies.writeUnsupportedRequestWarning({
        requestId,
        method,
        threadId: dependencies.readThreadIdFromPayload(params),
        turnId: dependencies.readTurnIdFromPayload(params),
      })
    }
    dependencies.sendServerRequestReply(requestId, {
      result: policy.result,
    })
    dependencies.emitNotification(createAppServerRequestResolvedNotification({
      requestId,
      method,
      params,
      mode: 'automatic',
      readThreadIdFromPayload: dependencies.readThreadIdFromPayload,
    }))
    return
  }

  const pendingRequest = dependencies.recordPendingServerRequest(requestId, method, params)
  dependencies.emitNotification({
    method: 'server/request',
    params: pendingRequest,
  })
}

export function resolveAppServerPendingServerRequest(
  requestId: number,
  reply: ServerRequestReply,
  dependencies: ResolveAppServerPendingServerRequestDependencies,
): void {
  const pendingRequest = dependencies.consumePendingServerRequest(requestId)
  if (!pendingRequest) {
    throw new Error(`No pending server request found for id ${String(requestId)}`)
  }

  dependencies.sendServerRequestReply(requestId, reply)
  dependencies.emitNotification(createAppServerRequestResolvedNotification({
    requestId,
    method: pendingRequest.method,
    params: pendingRequest.params,
    mode: 'manual',
    readThreadIdFromPayload: dependencies.readThreadIdFromPayload,
  }))
}
