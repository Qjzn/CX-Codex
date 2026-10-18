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
import { readAssistantRoleBinding } from './assistantRuntime.js'
import { createAssistantCoordinator } from './assistantCoordinator.js'
import { MobilePushCoordinator } from './mobilePush.js'
import {
  CodexSessionFileChangeObserver,
  createCodexSessionFileChangedNotification,
  resolveCodexSessionFileChangeOrigin,
} from './codexSessionFileChangeObserver.js'
import {
  CX_SESSION_FILES_CHANGED_METHOD,
  shouldInvalidateThreadCollectionForCxSessionFileChange,
} from '../sessionFileChange.js'
import { RuntimeMessageQueue } from './runtimeMessageQueue.js'

type CodexBridgeMiddleware = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  dispose: () => void
  subscribeNotifications: (listener: (value: BridgeNotificationEvent) => void) => () => void
  listNotificationEventsAfter: (afterSeq: number, limit?: number) => {
    notifications: BridgeNotificationEvent[]
    streamId?: string
    latestSeq: number
    oldestSeq: number
  }
}

type SharedBridgeState = {
  appServer: AppServerProcess
  methodCatalog: AppServerMethodCatalog
}

function getSharedBridgeState(): SharedBridgeState {
  return getCodexBridgeSharedState<AppServerProcess, AppServerMethodCatalog>({
    createAppServer: () => new AppServerProcess(),
    createMethodCatalog: (appServer) => new AppServerMethodCatalog({
      getActiveLaunchIdentity: () => appServer.getActiveLaunchIdentity(),
    }),
  })
}

export type CodexBridgeMiddlewareOptions = {
  remoteAccessProtected?: boolean
  runtimeDatabasePath?: string
  startupSkillsSync?: boolean
}

export function createCodexBridgeMiddleware(options: CodexBridgeMiddlewareOptions = {}): CodexBridgeMiddleware {
  const { appServer, methodCatalog } = getSharedBridgeState()
  const {
    threadSearchIndexStore,
    threadReadCacheStore,
    invalidateSupplementalThreadListCache,
    augmentThreadListRpcResult,
    runtimeStateStore,
    runtimeStore,
    notificationDiagnostics,
    statusDiagnostics,
    hookDiagnosticsCache,
    windowsSandboxReadinessCache,
  } = createCodexBridgeMiddlewareState(appServer, {
    runtimeDatabasePath: options.runtimeDatabasePath,
  })
  appServer.setRestartProtectionReader(() => Math.max(
    runtimeStore.getRestartBlockingRequestCount(),
    runtimeStateStore.getActiveThreadCount(),
  ))
  let assistantCoordinator: ReturnType<typeof createAssistantCoordinator> | null = null
  function requireAssistantCoordinator() {
    if (!assistantCoordinator) throw new Error('Assistant coordinator is not ready')
    return assistantCoordinator
  }
  const mobilePushCoordinator = new MobilePushCoordinator({ store: runtimeStore })
  let runtimeMessageQueue: RuntimeMessageQueue | null = null
  const recentLiveRuntimeEventAtMsByThreadId = new Map<string, number>()
  const {
    persistRuntimeSnapshot,
    readThreadRuntimeSnapshot,
    readLocalRuntimeSnapshot,
    readCachedThreadTokenUsage,
    reconcileRuntimeThread,
    runtimeReconcileScheduler,
    startRuntimeTurn,
    startRuntimeTurnSettled,
    startAssistantConversation,
    interruptRuntimeTurn,
    createAssistantWorkerStarter,
    createAssistantWorkerInterrupter,
  } = createCodexBridgeRuntimeOperations({
    assistantMainSetup: {
      readInstructions: () => requireAssistantCoordinator().mainSetup.readInstructions(),
      readTools: () => requireAssistantCoordinator().mainSetup.readTools(),
      onThreadCreated: result => requireAssistantCoordinator().mainSetup.onThreadCreated(result),
    },
    resumeAssistantTask: payload => requireAssistantCoordinator().resumePending(payload),
    readAssistantMainClientMessageId: () => runtimeStore.readAssistantMainConversation()?.clientMessageId ?? null,
    isManagedThread: (threadId) => readAssistantRoleBinding(runtimeStore)?.threadId === threadId || !!assistantCoordinator?.isWorkerThread(threadId),
    appServer,
    runtimeStore,
    runtimeStateStore,
    threadReadCacheStore,
    threadSearchIndexStore,
    statusDiagnostics,
    getErrorMessage,
    notifyQueuedRequest: (request) => runtimeMessageQueue?.notifyQueuedRequest(request),
    writeWarning: (message, details) => {
      writeBridgeLog('warn', message, details)
    },
    writeReconcileFailure: (details) => {
      writeBridgeLog('warn', 'Runtime reconcile failed', details)
    },
  })
  assistantCoordinator = createAssistantCoordinator({
    appServer, store: runtimeStore,
    runtime: { createAssistantWorkerStarter, createAssistantWorkerInterrupter, reconcileRuntimeThread },
    readReportQueue: () => runtimeMessageQueue,
    onError: error => writeBridgeLog('warn', 'Assistant task awaits verification', { error: getErrorMessage(error, 'assistant_task_failed') }),
  })
  appServer.setRpcPolicy(assistantCoordinator.policy)
  appServer.setRpcWriteGuard(assistantCoordinator.beforeWrite)
  appServer.setServerRequestInterceptor(assistantCoordinator.intercept)
  void assistantCoordinator.kick()

  const {
    notificationReplay,
    listNotificationEventsAfter,
    bridgeNotificationListeners,
    publishBridgeNotification,
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
      if (event.method !== CX_SESSION_FILES_CHANGED_METHOD && event.threadId) {
        recentLiveRuntimeEventAtMsByThreadId.set(event.threadId, Date.now())
        if (recentLiveRuntimeEventAtMsByThreadId.size > 512) {
          const oldestThreadId = recentLiveRuntimeEventAtMsByThreadId.keys().next().value
          if (typeof oldestThreadId === 'string') recentLiveRuntimeEventAtMsByThreadId.delete(oldestThreadId)
        }
      }
      runtimeMessageQueue?.handleRuntimeEvent(event.method, event.threadId, event.params)
      if (event.method === 'turn/completed' || event.method === 'turn/interrupted' || event.method === 'error' || event.method.endsWith('/failed')) {
        void assistantCoordinator?.kick()
      }
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
  runtimeMessageQueue = new RuntimeMessageQueue({
    store: runtimeStore,
    startRuntimeTurn: payload => requireAssistantCoordinator().startReport(payload) ?? startRuntimeTurnSettled(payload),
    shouldApplyQueuedSpeedMode: payload => readAssistantRoleBinding(runtimeStore)?.threadId !== (payload as { threadId?: unknown } | null)?.threadId,
    rpc: (method, params) => appServer.rpc(method, params),
    publishNotification: (notification) => { publishBridgeNotification(notification) },
    getErrorMessage,
  })
  runtimeMessageQueue.start()
  void assistantCoordinator.kick()
  const sessionFileChangeObserver = new CodexSessionFileChangeObserver({
    onChange: (change) => {
      if (shouldInvalidateThreadCollectionForCxSessionFileChange(change)) {
        appServer.invalidateThreadListCache()
        threadSearchIndexStore.clear()
      }
      invalidateSupplementalThreadListCache(change.threadId)
      publishBridgeNotification(createCodexSessionFileChangedNotification({
        ...change,
        origin: resolveCodexSessionFileChangeOrigin(
          change,
          recentLiveRuntimeEventAtMsByThreadId.get(change.threadId) ?? 0,
        ),
      }))
    },
    onError: (error) => {
      writeBridgeLog('warn', 'Codex session file change observer failed', {
        error: getErrorMessage(error, 'session_file_observer_failed'),
      })
    },
  })
  sessionFileChangeObserver.start()
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
    startupSkillsSync: options.startupSkillsSync,
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
        assistant: requireAssistantCoordinator(),
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
        startAssistantConversation,
        interruptRuntimeTurn,
        enqueueRuntimeTurn: (payload) => runtimeMessageQueue!.enqueue(payload),
        listRuntimeQueue: (threadId = '') => runtimeMessageQueue!.list(threadId),
        cancelQueuedRuntimeTurn: (requestId) => runtimeMessageQueue!.cancel(requestId),
        restoreQueuedRuntimeTurn: (requestId) => runtimeMessageQueue!.restore(requestId),
        retryQueuedRuntimeTurn: (requestId) => runtimeMessageQueue!.retry(requestId),
        reorderQueuedRuntimeTurns: (threadId, requestIds) => runtimeMessageQueue!.reorder(threadId, requestIds),
        augmentThreadListRpcResult: async (params, result) => requireAssistantCoordinator().annotateThreadList(await augmentThreadListRpcResult(params, result)),
        reconcileRuntimeThread,
        readLocalRuntimeSnapshot,
        readThreadRuntimeSnapshot,
        readCachedThreadTokenUsage,
        readAppServerHookDiagnostics,
        readAppServerSchemaAuditSummary,
        readWindowsSandboxReadinessDiagnostics,
        getSessionFileSyncStatus: () => sessionFileChangeObserver.getStatus(),
        mobilePushCoordinator,
        remoteAccessProtected: options.remoteAccessProtected === true,
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
    assistantCoordinator?.dispose()
    disposeCodexBridgeMiddlewareResources({
      runtimeReconcileScheduler,
      runtimeMessageQueue,
      threadSearchIndexStore,
      bridgeNotificationListeners,
      unsubscribeAppServerNotifications,
      notificationDiagnostics,
      statusDiagnostics,
      hookDiagnosticsCache,
      windowsSandboxReadinessCache,
      mobilePushCoordinator,
      sessionFileChangeObserver,
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
