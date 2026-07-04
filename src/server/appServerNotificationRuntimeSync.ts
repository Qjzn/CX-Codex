import { shouldInvalidateThreadReadCacheForNotification } from './appServerRpcCache.js'
import { updateRuntimeRequestsFromSnapshot } from './appServerRuntimeRequestReconciliation.js'
import type { BridgeNotificationEvent } from './appServerRuntimeBridge.js'
import type { RuntimeStateStore, ThreadRuntimeSnapshot } from './runtimeState.js'
import type { RuntimeRequestRecord, RuntimeRequestStatus } from './runtimeStore.js'

export type AppServerNotification = {
  method: string
  params: unknown
}

type RuntimeRequestReconciliationStore = {
  listRequestsByThread(threadId: string, statuses?: RuntimeRequestStatus[]): RuntimeRequestRecord[]
  updateRequest(
    requestId: string,
    patch: {
      status: RuntimeRequestStatus
      threadId: string
      turnId: string
      lastError: string | null
    },
  ): RuntimeRequestRecord | null
}

export type BridgeNotificationRuntimeSyncDependencies = {
  rememberNotificationEvent(notification: AppServerNotification): BridgeNotificationEvent
  runtimeStateStore: Pick<RuntimeStateStore, 'observeEvent'>
  readThreadIdFromPayload(payload: unknown): string
  persistRuntimeSnapshot(threadId: string): ThreadRuntimeSnapshot
  runtimeStore: RuntimeRequestReconciliationStore
  deleteCachedThreadRead(threadId: string): void
  emitNotification(event: BridgeNotificationEvent): void
}

export function syncBridgeNotificationRuntimeState(
  notification: AppServerNotification,
  dependencies: BridgeNotificationRuntimeSyncDependencies,
): BridgeNotificationEvent {
  const event = dependencies.rememberNotificationEvent(notification)
  dependencies.runtimeStateStore.observeEvent(event)

  const eventThreadId = dependencies.readThreadIdFromPayload(notification.params)
  if (eventThreadId) {
    const snapshot = dependencies.persistRuntimeSnapshot(eventThreadId)
    updateRuntimeRequestsFromSnapshot(eventThreadId, snapshot, dependencies.runtimeStore)
  }

  if (eventThreadId && shouldInvalidateThreadReadCacheForNotification(notification.method)) {
    dependencies.deleteCachedThreadRead(eventThreadId)
  }

  dependencies.emitNotification(event)
  return event
}
