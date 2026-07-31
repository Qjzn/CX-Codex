import {
  createAppServerNotificationReplayBundle,
  type AppServerNotificationReplayBundle,
  type AppServerNotificationReplayOptions,
} from './appServerNotificationReplay.js'
import {
  type AppServerNotification,
  type BridgeNotificationRuntimeSyncDependencies,
  subscribeBridgeNotificationRuntimeSync,
  syncBridgeNotificationRuntimeState,
} from './appServerNotificationRuntimeSync.js'
import { AppServerNotificationListeners } from './appServerNotificationListeners.js'
import type { BridgeNotificationEvent } from './appServerRuntimeBridge.js'
import {
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import type { RuntimeEventRecord } from './runtimeStore.js'

type RuntimeEventReplay = {
  notifications: RuntimeEventRecord[]
  streamId: string
  latestSeq: number
  oldestSeq: number
}

type CodexBridgeNotificationRuntimeStore =
  BridgeNotificationRuntimeSyncDependencies['runtimeStore'] & {
    getLatestEventSeq(): number
    getStreamId(): string
    appendEvent(event: RuntimeEventRecord): RuntimeEventRecord
    listEventsAfter(afterSeq: number, limit: number): RuntimeEventReplay
  }

type NotificationDiagnosticsObserver = {
  observe(observation: Parameters<AppServerNotificationReplayOptions['observeNotification']>[0]): void
}

type StatusDiagnosticsObserver = {
  observeStatusNotification(observation: {
    method: string
    atIso: string
    threadId?: string
    payload: unknown
  }): void
}

export type CodexBridgeNotificationRuntimeDependencies = {
  subscribeAppServerNotifications(listener: (notification: AppServerNotification) => void): () => void
  runtimeStore: CodexBridgeNotificationRuntimeStore
  runtimeStateStore: BridgeNotificationRuntimeSyncDependencies['runtimeStateStore']
  threadReadCacheStore: {
    delete(threadId: string): void
  }
  notificationDiagnostics: NotificationDiagnosticsObserver
  statusDiagnostics: StatusDiagnosticsObserver
  persistRuntimeSnapshot: BridgeNotificationRuntimeSyncDependencies['persistRuntimeSnapshot']
  onRuntimeEvent?: (event: RuntimeEventRecord) => void
}

export type CodexBridgeNotificationRuntime = Pick<
  AppServerNotificationReplayBundle,
  'notificationReplay' | 'listNotificationEventsAfter'
> & {
  bridgeNotificationListeners: AppServerNotificationListeners<BridgeNotificationEvent>
  publishBridgeNotification: (notification: AppServerNotification) => BridgeNotificationEvent
  unsubscribeAppServerNotifications: () => void
}

export function createCodexBridgeNotificationRuntime(
  dependencies: CodexBridgeNotificationRuntimeDependencies,
): CodexBridgeNotificationRuntime {
  const bridgeNotificationListeners = new AppServerNotificationListeners<BridgeNotificationEvent>()
  const {
    notificationReplay,
    rememberNotificationEvent,
    listNotificationEventsAfter,
  } = createAppServerNotificationReplayBundle({
    initialSeq: dependencies.runtimeStore.getLatestEventSeq(),
    streamId: dependencies.runtimeStore.getStreamId(),
    appendEvent: (event) => {
      dependencies.runtimeStore.appendEvent(event)
    },
    listEventsAfter: (afterSeq, limit) => dependencies.runtimeStore.listEventsAfter(afterSeq, limit),
    observeNotification: (observation) => {
      dependencies.notificationDiagnostics.observe(observation)
      dependencies.statusDiagnostics.observeStatusNotification({
        method: observation.method,
        atIso: observation.atIso,
        threadId: observation.threadId,
        payload: observation.params,
      })
    },
    readThreadIdFromPayload,
    readTurnIdFromPayload,
  })

  const runtimeSyncDependencies: BridgeNotificationRuntimeSyncDependencies = {
    rememberNotificationEvent,
    runtimeStateStore: dependencies.runtimeStateStore,
    readThreadIdFromPayload,
    persistRuntimeSnapshot: dependencies.persistRuntimeSnapshot,
    runtimeStore: dependencies.runtimeStore,
    deleteCachedThreadRead: (threadId) => dependencies.threadReadCacheStore.delete(threadId),
    emitNotification: (event) => {
      dependencies.onRuntimeEvent?.({
        ...event,
        threadId: readThreadIdFromPayload(event.params),
        turnId: readTurnIdFromPayload(event.params),
      })
      bridgeNotificationListeners.emit(event)
    },
  }
  const publishBridgeNotification = (notification: AppServerNotification): BridgeNotificationEvent => {
    return syncBridgeNotificationRuntimeState(notification, runtimeSyncDependencies)
  }
  const unsubscribeAppServerNotifications = subscribeBridgeNotificationRuntimeSync({
    subscribeNotifications: dependencies.subscribeAppServerNotifications,
    ...runtimeSyncDependencies,
  })

  return {
    notificationReplay,
    listNotificationEventsAfter,
    bridgeNotificationListeners,
    publishBridgeNotification,
    unsubscribeAppServerNotifications,
  }
}
