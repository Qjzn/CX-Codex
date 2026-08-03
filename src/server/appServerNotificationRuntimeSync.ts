import { shouldInvalidateThreadReadCacheForNotification } from './appServerRpcCache.js'
import { isCxSessionFilesChangedMethod } from '../sessionFileChange.js'
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

export type BridgeNotificationRuntimeSyncSubscriberDependencies = BridgeNotificationRuntimeSyncDependencies & {
  subscribeNotifications(listener: (notification: AppServerNotification) => void): () => void
}

const TRANSIENT_RUNTIME_PROGRESS_METHODS = new Set([
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'command/exec/outputDelta',
  'process/outputDelta',
])
const INTERNAL_RUNTIME_NOTIFICATION_METHODS = new Set([
  'runtime/queue/updated',
])

function shouldPersistRuntimeSnapshot(method: string): boolean {
  return !TRANSIENT_RUNTIME_PROGRESS_METHODS.has(method)
}

export function syncBridgeNotificationRuntimeState(
  notification: AppServerNotification,
  dependencies: BridgeNotificationRuntimeSyncDependencies,
): BridgeNotificationEvent {
  const event = dependencies.rememberNotificationEvent(notification)
  const externalSessionFileChange = isCxSessionFilesChangedMethod(notification.method)
  const internalRuntimeNotification = INTERNAL_RUNTIME_NOTIFICATION_METHODS.has(notification.method)
  if (!externalSessionFileChange && !internalRuntimeNotification) {
    dependencies.runtimeStateStore.observeEvent(event)
  }

  const eventThreadId = dependencies.readThreadIdFromPayload(notification.params)
  if (
    eventThreadId
    && !externalSessionFileChange
    && !internalRuntimeNotification
    && shouldPersistRuntimeSnapshot(notification.method)
  ) {
    const snapshot = dependencies.persistRuntimeSnapshot(eventThreadId)
    updateRuntimeRequestsFromSnapshot(eventThreadId, snapshot, dependencies.runtimeStore)
  }

  if (eventThreadId && shouldInvalidateThreadReadCacheForNotification(notification.method, notification.params)) {
    dependencies.deleteCachedThreadRead(eventThreadId)
  }

  dependencies.emitNotification(event)
  return event
}

export function subscribeBridgeNotificationRuntimeSync(
  dependencies: BridgeNotificationRuntimeSyncSubscriberDependencies,
): () => void {
  return dependencies.subscribeNotifications((notification) => {
    syncBridgeNotificationRuntimeState(notification, dependencies)
  })
}
