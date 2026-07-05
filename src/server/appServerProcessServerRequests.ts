import {
  handleAppServerServerRequest,
  resolveAppServerPendingServerRequest,
  type AppServerServerRequestNotification,
} from './appServerServerRequestHandler.js'
import { readThreadIdFromPayload, readTurnIdFromPayload } from './appServerPayloadIds.js'
import { PendingServerRequestStore, type PendingServerRequest } from './pendingServerRequests.js'
import { PlanModeTurnStore } from './planModeTurnStore.js'
import type { ServerRequestReply } from './serverRequestReply.js'
import type { WebBridgePermissionSettings } from './serverRequestPolicy.js'

type AppServerProcessServerRequestDependencies = {
  permissions: WebBridgePermissionSettings
  sendServerRequestReply: (requestId: number, reply: ServerRequestReply) => void
  emitNotification: (notification: AppServerServerRequestNotification) => void
  writeUnsupportedRequestWarning: (details: {
    requestId: number
    method: string
    threadId: string
    turnId: string
  }) => void
}

export class AppServerProcessServerRequests {
  readonly pendingServerRequests = new PendingServerRequestStore()
  readonly planModeTurns = new PlanModeTurnStore()

  get pendingCount(): number {
    return this.pendingServerRequests.count
  }

  get activePlanModeTurnCount(): number {
    return this.planModeTurns.count
  }

  markPlanModeTurn(threadId: string, turnId = ''): void {
    this.planModeTurns.mark(threadId, turnId)
  }

  clearPlanModeTurn(threadId: string, turnId = ''): void {
    this.planModeTurns.clear(threadId, turnId)
  }

  clearPlanModeTurnByThreadOrTurn(threadId: string, turnId = ''): void {
    this.planModeTurns.clearByThreadOrTurn(threadId, turnId)
  }

  getActivePlanModeTurnCount(): number {
    return this.planModeTurns.count
  }

  readServerRequestThreadId(params: unknown): string {
    return readThreadIdFromPayload(params)
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return this.pendingServerRequests.list()
  }

  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[] {
    return this.pendingServerRequests.listForThread(threadId, (params) => this.readServerRequestThreadId(params))
  }

  resolvePendingServerRequest(
    requestId: number,
    reply: ServerRequestReply,
    dependencies: Pick<AppServerProcessServerRequestDependencies, 'sendServerRequestReply' | 'emitNotification'>,
  ): void {
    resolveAppServerPendingServerRequest(requestId, reply, {
      consumePendingServerRequest: (requestId) => this.pendingServerRequests.consume(requestId),
      sendServerRequestReply: dependencies.sendServerRequestReply,
      emitNotification: dependencies.emitNotification,
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
    })
  }

  handleServerRequest(
    requestId: number,
    method: string,
    params: unknown,
    dependencies: AppServerProcessServerRequestDependencies,
  ): void {
    handleAppServerServerRequest(requestId, method, params, {
      permissions: dependencies.permissions,
      isPlanModeRequest: (requestParams) => {
        const threadId = this.readServerRequestThreadId(requestParams)
        const turnId = readTurnIdFromPayload(requestParams)
        return this.planModeTurns.isActiveRequest(threadId, turnId)
      },
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
      readTurnIdFromPayload,
      sendServerRequestReply: dependencies.sendServerRequestReply,
      recordPendingServerRequest: (requestId, method, params) => (
        this.pendingServerRequests.record(requestId, method, params)
      ),
      emitNotification: dependencies.emitNotification,
      writeUnsupportedRequestWarning: dependencies.writeUnsupportedRequestWarning,
    })
  }
}
