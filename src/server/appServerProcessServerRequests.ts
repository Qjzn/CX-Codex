import {
  handleAppServerServerRequest,
  resolveAppServerPendingServerRequest,
  type AppServerServerRequestNotification,
} from './appServerServerRequestHandler.js'
import { readThreadIdFromPayload, readTurnIdFromPayload } from './appServerPayloadIds.js'
import {
  createServerRequestResolvedNotification,
  PendingServerRequestStore,
  type PendingServerRequest,
} from './pendingServerRequests.js'
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
      // Read-only lookup: the pending request stays in the single store until the
      // reply was validated and written.
      getPendingServerRequest: (id) => this.pendingServerRequests.list().find((row) => row.id === id) ?? null,
      consumePendingServerRequest: (requestId) => this.pendingServerRequests.consume(requestId),
      sendServerRequestReply: dependencies.sendServerRequestReply,
      emitNotification: dependencies.emitNotification,
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
    })
  }

  /**
   * CX safety adaptation (not verified exact current desktop parity): a confirmed terminal
   * turn notification is the only event that expires the local pending server requests of a
   * turn. Thread and turn are matched against the stored request payload through the existing
   * payload id readers, so a request that does not own both ids stays pending. Nothing is sent
   * back to the runtime from here: no result, deny or grant.
   */
  expirePendingServerRequestsForTerminalTurn(
    notification: { method: string; params: unknown },
    dependencies: Pick<AppServerProcessServerRequestDependencies, 'emitNotification'>,
  ): number[] {
    const terminalTurn = readTerminalTurnNotification(notification)
    if (!terminalTurn) return []

    const expiring = this.pendingServerRequests.list().filter((pending) => (
      this.readServerRequestThreadId(pending.params) === terminalTurn.threadId
      && readTurnIdFromPayload(pending.params) === terminalTurn.turnId
    ))

    const consumedIds: number[] = []
    for (const pending of expiring) {
      // consume() is the ownership handover: only the caller that actually removed the row
      // may emit the resolved notification, so a duplicate terminal notification is a no-op.
      if (!this.pendingServerRequests.consume(pending.id)) continue
      consumedIds.push(pending.id)
      dependencies.emitNotification(createServerRequestResolvedNotification({
        requestId: pending.id,
        method: pending.method,
        params: pending.params,
        mode: 'automatic',
        readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
      }))
    }
    return consumedIds
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

/**
 * Only a confirmed turn/completed notification with a nonempty threadId, a nested turn.id and a
 * terminal turn.status expires local pending requests. A retryable error, missing ids, a
 * nonterminal state or a turn/interrupt RPC acknowledgement never produce a terminal turn here,
 * and a top-level turnId that conflicts with the nested turn.id keeps the pending request.
 */
function readTerminalTurnNotification(
  notification: { method: string; params: unknown },
): { threadId: string; turnId: string } | null {
  if (notification.method !== 'turn/completed') return null

  const params = readRecord(notification.params)
  if (!params) return null

  const threadId = readThreadIdFromPayload(params)
  if (!threadId.trim()) return null

  const turn = readRecord(params.turn)
  if (!turn) return null

  const turnId = readString(turn.id)
  if (!turnId.trim()) return null
  if (!isTerminalTurnStatus(readString(turn.status))) return null

  // A retryable failure is not terminal for cleanup purposes: the turn is expected to be retried,
  // so its pending server requests must stay pending.
  const turnError = readRecord(turn.error)
  if (turnError && turnError.willRetry === true) return null

  const topLevelTurnId = readString(params.turnId)
  if (topLevelTurnId && topLevelTurnId !== turnId) return null

  return { threadId, turnId }
}

function isTerminalTurnStatus(status: string): boolean {
  return status === 'completed' || status === 'interrupted' || status === 'failed'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
