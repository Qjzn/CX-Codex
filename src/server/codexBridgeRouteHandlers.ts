import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'

import type { AppServerHealth } from './appServerHealth.js'
import type { AppServerMethodCatalog } from './appServerMethodCatalog.js'
import type { RuntimeRequestRecord } from './runtimeStore.js'
import type { ThreadRuntimeSnapshot } from './runtimeState.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type { ThreadTokenUsage } from './threadTokenUsage.js'
import type { WebBridgeSettings } from './serverRequestPolicy.js'
import type { ThreadReadCacheSource } from './appServerThreadReadCache.js'
import { getTranscriptionProxyConfigSnapshot } from './transcriptionProxy.js'
import { handleSkillsRoutes } from './skillsRoutes.js'
import { handleFileUploadRoute } from './fileUploadRoute.js'
import {
  handleLocalStateRoutes,
  type LocalStateRoutesDependencies,
} from './localStateRoutes.js'
import {
  handleRpcProxyRoute,
  type RpcProxyRouteDependencies,
} from './rpcProxyRoute.js'
import {
  handleRuntimeActionRoutes,
  type RuntimeActionRoutesDependencies,
} from './runtimeActionRoutes.js'
import { handleTranscriptionRoutes } from './transcriptionRoute.js'
import {
  handleServerRequestRoutes,
  type ServerRequestRoutesDependencies,
} from './serverRequestRoutes.js'
import {
  handleNotificationReplayRoute,
  type NotificationReplayListAfter,
} from './notificationReplayRoute.js'
import {
  handleRuntimeStateRoutes,
  type RuntimeStateRoutesDependencies,
} from './runtimeStateRoutes.js'
import {
  handleDiagnosticsRoutes,
  type DiagnosticsRoutesDependencies,
} from './diagnosticsRoutes.js'
import { handleGithubTrendingRoutes } from './githubTrendingRoutes.js'
import { handleWorktreeRoutes } from './worktreeRoutes.js'
import {
  handleWorkspaceMetaRoutes,
  type WorkspaceMetaRoutesDependencies,
} from './workspaceMetaRoutes.js'
import { handleProjectRootRoutes } from './projectRootRoutes.js'
import { handleComposerFileSearchRoutes } from './composerFileSearchRoutes.js'
import {
  handleThreadRoutes,
  type ThreadRoutesDependencies,
} from './threadRoutes.js'
import { handleStatusRoutes } from './statusRoutes.js'
import {
  handleNotificationSseRoute,
  type NotificationSseRouteDependencies,
} from './notificationSseRoute.js'
import type { CodexBridgeRouteHandler } from './codexBridgeRouteDispatch.js'

type CodexBridgeRouteAppServer = {
  rpc(method: string, params: unknown): Promise<unknown>
  setWebBridgeSettings(settings: WebBridgeSettings): void
  markPlanModeTurn(threadId: string, turnId?: string): void
  clearPlanModeTurn(threadId: string, turnId?: string): void
  respondToServerRequest: ServerRequestRoutesDependencies['respondToServerRequest']
  listPendingServerRequests: ServerRequestRoutesDependencies['listPendingServerRequests']
  listPendingServerRequestsForThread: RuntimeStateRoutesDependencies['listPendingServerRequestsForThread']
  getThreadTokenUsage: RuntimeStateRoutesDependencies['getThreadTokenUsage']
  getStatus(): AppServerHealth
}

type RuntimeRouteStore = RuntimeStateRoutesDependencies['runtimeRequestStore']
  & DiagnosticsRoutesDependencies['runtimeStore']
  & {
    getLatestRequestByClientMessageId(clientMessageId: string): RuntimeRequestRecord | null
  }

type RuntimeStateStoreForRoutes = RpcProxyRouteDependencies['runtimeStateStore']
  & RuntimeStateRoutesDependencies['runtimeStateStore']

type ThreadSearchIndexStoreForRoutes = ThreadRoutesDependencies['threadSearchIndexStore'] & {
  clear(): void
}

type ThreadReadCacheStoreForRoutes = {
  delete(threadId: string): void
  remember(threadId: string, threadRead: unknown, source?: ThreadReadCacheSource): void
}

type StatusDiagnosticsForRoutes = {
  observeThreadUnsubscribeResponse: RpcProxyRouteDependencies['observeThreadUnsubscribeResponse']
  snapshot(): unknown
}

type NotificationDiagnosticsForRoutes = {
  snapshot(): unknown
}

type NotificationReplayForRoutes = {
  latestSeq: number
}

export type CodexBridgeRouteHandlersDependencies = {
  appServer: CodexBridgeRouteAppServer
  methodCatalog: AppServerMethodCatalog
  readJsonBody: LocalStateRoutesDependencies['readJsonBody']
  runtimeStateStore: RuntimeStateStoreForRoutes
  runtimeStore: RuntimeRouteStore
  threadSearchIndexStore: ThreadSearchIndexStoreForRoutes
  threadReadCacheStore: ThreadReadCacheStoreForRoutes
  notificationDiagnostics: NotificationDiagnosticsForRoutes
  statusDiagnostics: StatusDiagnosticsForRoutes
  notificationReplay: NotificationReplayForRoutes
  listNotificationEventsAfter: NotificationReplayListAfter
  subscribeNotifications: NotificationSseRouteDependencies['subscribeNotifications']
  persistRuntimeSnapshot(threadId: string, snapshot?: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot
  startRuntimeTurn: RuntimeActionRoutesDependencies['startRuntimeTurn']
  interruptRuntimeTurn: RuntimeActionRoutesDependencies['interruptRuntimeTurn']
  augmentThreadListRpcResult: RpcProxyRouteDependencies['augmentThreadListRpcResult']
  reconcileRuntimeThread: RuntimeStateRoutesDependencies['reconcileRuntimeThread']
  readLocalRuntimeSnapshot: RuntimeStateRoutesDependencies['readLocalRuntimeSnapshot']
  readThreadRuntimeSnapshot: RuntimeStateRoutesDependencies['readThreadRuntimeSnapshot']
  readCachedThreadTokenUsage: RuntimeStateRoutesDependencies['readCachedThreadTokenUsage']
  readAppServerHookDiagnostics: DiagnosticsRoutesDependencies['readHookDiagnostics']
  readAppServerSchemaAuditSummary: DiagnosticsRoutesDependencies['readSchemaAuditSummary']
  readWindowsSandboxReadinessDiagnostics: DiagnosticsRoutesDependencies['readWindowsSandboxDiagnostics']
}

export function createCodexBridgeRouteHandlers(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: CodexBridgeRouteHandlersDependencies,
): CodexBridgeRouteHandler[] {
  const {
    appServer,
    readJsonBody,
    runtimeStateStore,
    runtimeStore,
    threadSearchIndexStore,
    threadReadCacheStore,
    notificationDiagnostics,
    statusDiagnostics,
  } = dependencies

  return [
    () => handleSkillsRoutes(req, res, url, { appServer, readJsonBody }),
    () => handleFileUploadRoute(req, res, url),
    () => handleLocalStateRoutes(req, res, url, {
      readJsonBody,
      setWebBridgeSettings: (settings) => appServer.setWebBridgeSettings(settings),
    }),
    () => handleRpcProxyRoute(req, res, url, {
      readJsonBody,
      rpc: (method, params) => appServer.rpc(method, params),
      runtimeStateStore,
      persistRuntimeSnapshot: dependencies.persistRuntimeSnapshot,
      markPlanModeTurn: (threadId, turnId = '') => appServer.markPlanModeTurn(threadId, turnId),
      clearPlanModeTurn: (threadId, turnId = '') => appServer.clearPlanModeTurn(threadId, turnId),
      observeThreadUnsubscribeResponse: statusDiagnostics.observeThreadUnsubscribeResponse,
      deleteCachedThreadRead: (threadId) => threadReadCacheStore.delete(threadId),
      rememberCachedThreadRead: (threadId, threadRead, source) => {
        threadReadCacheStore.remember(threadId, threadRead, source)
      },
      augmentThreadListRpcResult: dependencies.augmentThreadListRpcResult,
      clearThreadSearchIndex: () => threadSearchIndexStore.clear(),
    }),
    () => handleRuntimeActionRoutes(req, res, url, {
      readJsonBody,
      startRuntimeTurn: dependencies.startRuntimeTurn,
      interruptRuntimeTurn: dependencies.interruptRuntimeTurn,
      getLatestRequestByClientMessageId: (clientMessageId) => runtimeStore.getLatestRequestByClientMessageId(clientMessageId),
    }),
    () => handleTranscriptionRoutes(req, res, url),
    () => handleServerRequestRoutes(req, res, url, {
      readJsonBody,
      respondToServerRequest: (payload) => appServer.respondToServerRequest(payload),
      listPendingServerRequests: () => appServer.listPendingServerRequests(),
    }),
    () => handleNotificationReplayRoute(req, res, url, dependencies.listNotificationEventsAfter),
    () => handleRuntimeStateRoutes(req, res, url, {
      runtimeRequestStore: runtimeStore,
      runtimeStateStore,
      reconcileRuntimeThread: dependencies.reconcileRuntimeThread,
      readLocalRuntimeSnapshot: dependencies.readLocalRuntimeSnapshot,
      persistRuntimeSnapshot: dependencies.persistRuntimeSnapshot,
      readThreadRuntimeSnapshot: dependencies.readThreadRuntimeSnapshot,
      readCachedThreadTokenUsage: dependencies.readCachedThreadTokenUsage,
      listPendingServerRequestsForThread: (threadId) => appServer.listPendingServerRequestsForThread(threadId),
      getThreadTokenUsage: (threadId) => appServer.getThreadTokenUsage(threadId),
    }),
    () => handleDiagnosticsRoutes(req, res, url, {
      getAppServerStatus: () => appServer.getStatus(),
      getNotificationDiagnostics: () => notificationDiagnostics.snapshot(),
      getStatusDiagnostics: () => statusDiagnostics.snapshot(),
      listPendingServerRequests: () => appServer.listPendingServerRequests(),
      readHookDiagnostics: dependencies.readAppServerHookDiagnostics,
      readSchemaAuditSummary: dependencies.readAppServerSchemaAuditSummary,
      readWindowsSandboxDiagnostics: dependencies.readWindowsSandboxReadinessDiagnostics,
      getTranscriptionDiagnostics: getTranscriptionProxyConfigSnapshot,
      runtimeStore,
    }),
    () => handleGithubTrendingRoutes(req, res, url, {
      readJsonBody,
    }),
    () => handleWorktreeRoutes(req, res, url, {
      readJsonBody,
    }),
    () => handleWorkspaceMetaRoutes(req, res, url, {
      methodCatalog: dependencies.methodCatalog,
      readJsonBody,
      homeDirectory: homedir,
    }),
    () => handleProjectRootRoutes(req, res, url, {
      readJsonBody,
    }),
    () => handleComposerFileSearchRoutes(req, res, url, {
      readJsonBody,
    }),
    () => handleThreadRoutes(req, res, url, {
      readJsonBody,
      threadSearchIndexStore,
    }),
    () => handleStatusRoutes(req, res, url, {
      readJsonBody,
    }),
    () => handleNotificationSseRoute(req, res, url, {
      latestSeq: () => dependencies.notificationReplay.latestSeq,
      subscribeNotifications: dependencies.subscribeNotifications,
    }),
  ]
}
