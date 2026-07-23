import type { IncomingMessage, ServerResponse } from 'node:http'
import { initializeSkillsSyncOnStartup } from './skillsRoutes.js'
import {
  type BridgeNotificationEvent,
} from './appServerRuntimeBridge.js'
import { logBridgeError, writeBridgeLog } from './bridgeLog.js'
import { getErrorMessage } from './errorMessage.js'
import {
  readJsonBody,
} from './httpBody.js'
import { writeCodexBridgeRequestError } from './codexBridgeRequestError.js'
import { disposeCodexBridgeMiddlewareResources } from './codexBridgeMiddlewareDispose.js'
import { createCodexBridgeNotificationRuntime } from './codexBridgeNotificationRuntime.js'
import { createCodexBridgeRouteHandlers } from './codexBridgeRouteHandlers.js'
import { runCodexBridgeRouteHandlers } from './codexBridgeRouteDispatch.js'
import { getCodexBridgeSharedState } from './codexBridgeSharedState.js'
import { AppServerProcess } from './appServerProcess.js'
import { readAppServerSchemaAuditSummary } from './appServerSchemaAuditSummary.js'
import { createAppServerDiagnosticsReaders } from './appServerDiagnosticsReaders.js'
import { AppServerMethodCatalog } from './appServerMethodCatalog.js'
import {
  getWebBridgeSettingsPath,
} from './codexPaths.js'
import {
  readWebBridgeSettings,
} from './webBridgeSettings.js'
import { startCodexBridgeStartupTasks } from './codexBridgeStartupTasks.js'
import { createCodexBridgeRuntimeOperations } from './codexBridgeRuntimeOperations.js'
import { createCodexBridgeMiddlewareState } from './codexBridgeMiddlewareState.js'
import { MobilePushCoordinator } from './mobilePush.js'

type CodexBridgeMiddleware = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  dispose: () => void
  subscribeNotifications: (listener: (value: BridgeNotificationEvent) => void) => () => void
  listNotificationEventsAfter: (afterSeq: number, limit?: number) => {
    notifications: BridgeNotificationEvent[]
    latestSeq: number
    oldestSeq: number
  }
}

type SharedBridgeState = {
  appServer: AppServerProcess
  methodCatalog: AppServerMethodCatalog
}

function getSharedBridgeState(): SharedBridgeState {
  return getCodexBridgeSharedState({
    createAppServer: () => new AppServerProcess(),
    createMethodCatalog: () => new AppServerMethodCatalog(),
  })
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const { appServer, methodCatalog } = getSharedBridgeState()
  const {
    threadSearchIndexStore,
    threadReadCacheStore,
    augmentThreadListRpcResult,
    runtimeStateStore,
    runtimeStore,
    notificationDiagnostics,
    statusDiagnostics,
    hookDiagnosticsCache,
    windowsSandboxReadinessCache,
  } = createCodexBridgeMiddlewareState(appServer)
  const mobilePushCoordinator = new MobilePushCoordinator({ store: runtimeStore })
  const {
    persistRuntimeSnapshot,
    readThreadRuntimeSnapshot,
    readLocalRuntimeSnapshot,
    readCachedThreadTokenUsage,
    reconcileRuntimeThread,
    runtimeReconcileScheduler,
    startRuntimeTurn,
    interruptRuntimeTurn,
  } = createCodexBridgeRuntimeOperations({
    appServer,
    runtimeStore,
    runtimeStateStore,
    threadReadCacheStore,
    threadSearchIndexStore,
    statusDiagnostics,
    getErrorMessage,
    writeWarning: (message, details) => {
      writeBridgeLog('warn', message, details)
    },
    writeReconcileFailure: (details) => {
      writeBridgeLog('warn', 'Runtime reconcile failed', details)
    },
  })

  const {
    notificationReplay,
    listNotificationEventsAfter,
    bridgeNotificationListeners,
    unsubscribeAppServerNotifications,
  } = createCodexBridgeNotificationRuntime({
    subscribeAppServerNotifications: (listener) => appServer.onNotification(listener),
    runtimeStore,
    runtimeStateStore,
    threadReadCacheStore,
    notificationDiagnostics,
    statusDiagnostics,
    persistRuntimeSnapshot,
    onRuntimeEvent: (event) => {
      void mobilePushCoordinator.handleRuntimeEvent(event).catch((error) => {
        writeBridgeLog('warn', 'Mobile push terminal wake failed', {
          method: event.method,
          threadId: event.threadId,
          seq: event.seq,
          error: getErrorMessage(error, 'mobile_push_delivery_failed'),
        })
      })
    },
  })
  mobilePushCoordinator.start()

  const {
    readAppServerHookDiagnostics,
    readWindowsSandboxReadinessDiagnostics,
  } = createAppServerDiagnosticsReaders({
    hookDiagnosticsCache,
    windowsSandboxReadinessCache,
    rpc: (method, params) => appServer.rpc(method, params),
    getCwds: () => [process.cwd()],
    isWindows: () => process.platform === 'win32',
  })

  startCodexBridgeStartupTasks({
    initializeSkillsSyncOnStartup: () => initializeSkillsSyncOnStartup(appServer),
    warmupAppServer: () => appServer.warmup(),
    getWebBridgeSettingsPath,
    readWebBridgeSettings,
    setWebBridgeSettings: (settings) => appServer.setWebBridgeSettings(settings),
    logError: logBridgeError,
  })

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    try {
      if (!req.url) {
        next()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      if (await runCodexBridgeRouteHandlers(createCodexBridgeRouteHandlers(req, res, url, {
        appServer,
        methodCatalog,
        readJsonBody,
        runtimeStateStore,
        runtimeStore,
        threadSearchIndexStore,
        threadReadCacheStore,
        notificationDiagnostics,
        statusDiagnostics,
        notificationReplay,
        listNotificationEventsAfter: middleware.listNotificationEventsAfter,
        subscribeNotifications: middleware.subscribeNotifications,
        persistRuntimeSnapshot,
        startRuntimeTurn,
        interruptRuntimeTurn,
        augmentThreadListRpcResult,
        reconcileRuntimeThread,
        readLocalRuntimeSnapshot,
        readThreadRuntimeSnapshot,
        readCachedThreadTokenUsage,
        readAppServerHookDiagnostics,
        readAppServerSchemaAuditSummary,
        readWindowsSandboxReadinessDiagnostics,
        mobilePushCoordinator,
      }))) {
        return
      }

      next()
    } catch (error) {
      writeCodexBridgeRequestError(res, error, {
        requestMethod: req.method ?? '',
        requestPath: req.url ?? '',
      })
    }
  }

  middleware.dispose = () => {
    disposeCodexBridgeMiddlewareResources({
      runtimeReconcileScheduler,
      threadSearchIndexStore,
      bridgeNotificationListeners,
      unsubscribeAppServerNotifications,
      notificationDiagnostics,
      statusDiagnostics,
      hookDiagnosticsCache,
      windowsSandboxReadinessCache,
      mobilePushCoordinator,
      runtimeStore,
      appServer,
    })
  }
  middleware.subscribeNotifications = (
    listener: (value: BridgeNotificationEvent) => void,
  ) => {
    return bridgeNotificationListeners.subscribe(listener)
  }
  middleware.listNotificationEventsAfter = listNotificationEventsAfter

  return middleware
}
