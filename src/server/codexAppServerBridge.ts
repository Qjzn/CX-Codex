import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { initializeSkillsSyncOnStartup } from './skillsRoutes.js'
import { RuntimeStore, type RuntimeRequestRecord, type RuntimeRequestStatus } from './runtimeStore.js'
import {
  type BridgeNotificationEvent,
} from './appServerRuntimeBridge.js'
import { subscribeBridgeNotificationRuntimeSync } from './appServerNotificationRuntimeSync.js'
import {
  createAppServerNotificationReplayBundle,
} from './appServerNotificationReplay.js'
import { createAppServerRuntimeReconciliation } from './appServerRuntimeReconciliation.js'
import {
  RuntimeStateStore,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import {
  PendingServerRequestStore,
  type PendingServerRequest,
} from './pendingServerRequests.js'
import { logBridgeError, writeBridgeLog } from './bridgeLog.js'
import { getErrorMessage } from './errorMessage.js'
import {
  readJsonBody,
} from './httpBody.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'
import { writeCodexBridgeRequestError } from './codexBridgeRequestError.js'
import { disposeCodexBridgeMiddlewareResources } from './codexBridgeMiddlewareDispose.js'
import { createCodexBridgeRouteHandlers } from './codexBridgeRouteHandlers.js'
import { runCodexBridgeRouteHandlers } from './codexBridgeRouteDispatch.js'
import { getCodexBridgeSharedState } from './codexBridgeSharedState.js'
import { resolveCodexCommand } from '../commandResolution.js'
import {
  AppServerRpcCache,
  getShareableRpcKey,
  shouldInvalidateThreadListCacheForRpc,
} from './appServerRpcCache.js'
import {
  AppServerRpcDiagnostics,
} from './appServerRpcDiagnostics.js'
import {
  AppServerRpcQueue,
  getAppServerRpcQueuePriority,
} from './appServerRpcQueue.js'
import {
  readThreadInProgressFromThreadReadPayload,
} from './appServerThreadPayload.js'
import {
  readItemIdFromPayload,
  readStringByAliases,
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import { readThreadReadIncludeTurnsForMethod } from './appServerThreadReadParams.js'
import { getRpcTimeoutMs } from './appServerRpcTimeoutPolicy.js'
import { createAppServerRpcTimeoutRecoveryDecision } from './appServerRpcTimeoutRecovery.js'
import {
  AppServerThreadReadCacheStore,
} from './appServerThreadReadCache.js'
import { createAppServerRuntimeReaders } from './appServerRuntimeReaders.js'
import { createLocalRuntimeSnapshot } from './appServerRuntimeSnapshotRecovery.js'
import {
  createRpcTimeoutError,
} from './appServerRpcErrors.js'
import { AppServerNotificationDiagnostics } from './appServerNotificationDiagnostics.js'
import { AppServerStatusDiagnostics } from './appServerStatusDiagnostics.js'
import { readAppServerSchemaAuditSummary } from './appServerSchemaAuditSummary.js'
import {
  AppServerHookDiagnosticsCache,
} from './appServerHookDiagnostics.js'
import { AppServerNotificationListeners } from './appServerNotificationListeners.js'
import {
  WindowsSandboxReadinessCache,
} from './windowsSandboxDiagnostics.js'
import { createAppServerDiagnosticsReaders } from './appServerDiagnosticsReaders.js'
import {
  createAppServerRpcNotification,
  createAppServerRpcRequest,
} from './appServerJsonRpcWire.js'
import { sendAppServerJsonRpcLine } from './appServerJsonRpcWriter.js'
import { createAppServerClientInfo, readPackageVersion } from './appServerClientInfo.js'
import { createAppServerInitializeParams } from './appServerInitialization.js'
import {
  createAppServerArgs,
  createAppServerLaunchPolicySnapshot,
  resolveAppServerLaunchPolicy,
  type AppServerLaunchPolicySnapshot,
} from './appServerLaunch.js'
import {
  createAppServerHealthSnapshot,
  type AppServerHealth,
} from './appServerHealth.js'
import { AppServerLineBuffer } from './appServerLineBuffer.js'
import { AppServerStderrLogger } from './appServerStderrLogger.js'
import { cleanupAppServerProcessRuntime } from './appServerProcessCleanup.js'
import { attachAppServerProcessHandlers } from './appServerProcessHandlers.js'
import { AppServerPendingRpcStore } from './appServerPendingRpcStore.js'
import { clearAppServerSessionStores } from './appServerSessionCleanup.js'
import { terminateAppServerProcess } from './appServerProcessTermination.js'
import { AppServerMethodCatalog } from './appServerMethodCatalog.js'
import { captureAppServerNotificationState } from './appServerNotificationState.js'
import {
  getCodexGlobalStatePath,
  getCodexSessionIndexPath,
  getWebBridgeSettingsPath,
} from './codexPaths.js'
import { readMergedPinnedThreadIds } from './pinnedThreads.js'
import { PlanModeTurnStore } from './planModeTurnStore.js'
import {
  ThreadTokenUsageStore,
  type ThreadTokenUsage,
} from './threadTokenUsage.js'
import { readThreadTitlesFromSessionIndex } from './threadTitleCache.js'
import {
  createThreadSearchIndexStore,
} from './threadSearchIndex.js'
import {
  type WebBridgeSettings,
} from './serverRequestPolicy.js'
import {
  createServerRequestReplyResponse,
  readServerRequestReplyPayload,
  type ServerRequestReply,
} from './serverRequestReply.js'
import {
  DEFAULT_WEB_BRIDGE_SETTINGS,
  normalizeWebBridgeSettings,
  readWebBridgeSettings,
} from './webBridgeSettings.js'
import { startCodexBridgeStartupTasks } from './codexBridgeStartupTasks.js'
import {
  AppServerThreadListAugmenter,
  createAppServerThreadListRpcResultAugmenter,
} from './appServerThreadListAugment.js'
import { createAppServerRuntimeSnapshotPersister } from './appServerRuntimeSnapshotPersistence.js'
import { createAppServerRuntimeActions } from './appServerRuntimeActions.js'
import {
  handleAppServerServerRequest,
  resolveAppServerPendingServerRequest,
} from './appServerServerRequestHandler.js'
import { dispatchAppServerJsonRpcLine } from './appServerLineDispatcher.js'

const APP_SERVER_RPC_SLOW_WARN_MS = 1_800
const APP_SERVER_RPC_MAX_IN_FLIGHT = 2
const APP_SERVER_RPC_QUEUE_WARN_SIZE = 6
const APP_SERVER_RPC_QUEUE_MAX_SIZE = 60
const APP_SERVER_RPC_QUEUE_WARN_INTERVAL_MS = 10_000
const APP_SERVER_RPC_TIMEOUT_RESTART_WINDOW_MS = 45_000
const APP_SERVER_RPC_TIMEOUT_RESTART_THRESHOLD = 3
const APP_SERVER_RESTART_COOLDOWN_MS = 10_000
const APP_SERVER_COLD_START_GRACE_MS = 60_000
const supplementalThreadListAugmenter = new AppServerThreadListAugmenter()

class AppServerProcess {
  private process: ChildProcessWithoutNullStreams | null = null
  private initialized = false
  private initializePromise: Promise<void> | null = null
  private readonly stdoutLineBuffer = new AppServerLineBuffer()
  private nextId = 1
  private stopping = false
  private startedAtMs = 0
  private lastRestartAtMs = 0
  private readonly stderrLogger = new AppServerStderrLogger()
  private readonly rpcDiagnostics = new AppServerRpcDiagnostics(
    {
      isHeavyThreadRead: readThreadReadIncludeTurnsForMethod,
    },
    {
      slowWarnMs: APP_SERVER_RPC_SLOW_WARN_MS,
      queueWarnSize: APP_SERVER_RPC_QUEUE_WARN_SIZE,
      queueWarnIntervalMs: APP_SERVER_RPC_QUEUE_WARN_INTERVAL_MS,
      timeoutRestartWindowMs: APP_SERVER_RPC_TIMEOUT_RESTART_WINDOW_MS,
      timeoutRestartThreshold: APP_SERVER_RPC_TIMEOUT_RESTART_THRESHOLD,
    },
  )
  private readonly pending = new AppServerPendingRpcStore()
  private readonly rpcQueue = new AppServerRpcQueue({
    maxSize: APP_SERVER_RPC_QUEUE_MAX_SIZE,
    maxInFlight: APP_SERVER_RPC_MAX_IN_FLIGHT,
    diagnostics: this.rpcDiagnostics,
    execute: (method, params) => this.call(method, params),
  })
  private readonly expectedExitProcesses = new WeakSet<ChildProcessWithoutNullStreams>()
  private readonly notificationListeners = new AppServerNotificationListeners<{ method: string; params: unknown }>()
  private readonly pendingServerRequests = new PendingServerRequestStore()
  private readonly rpcCache = new AppServerRpcCache()
  private readonly threadTokenUsage = new ThreadTokenUsageStore()
  private readonly planModeTurns = new PlanModeTurnStore()
  private webBridgeSettings: WebBridgeSettings = DEFAULT_WEB_BRIDGE_SETTINGS
  private readonly appServerLaunchPolicy = resolveAppServerLaunchPolicy()
  private readonly appServerArgs = createAppServerArgs(this.appServerLaunchPolicy)

  private getCodexCommand(): string {
    const codexCommand = resolveCodexCommand()
    if (!codexCommand) {
      throw new Error('Codex CLI is not available. Install @openai/codex or set CX_CODEX_CODEX_COMMAND.')
    }
    return codexCommand
  }

  private start(): void {
    if (this.process) return

    this.stopping = false
    this.startedAtMs = Date.now()
    const invocation = getSpawnInvocation(this.getCodexCommand(), this.appServerArgs)
    const proc = spawn(invocation.command, invocation.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = proc

    attachAppServerProcessHandlers(proc, {
      isCurrentProcess: (eventProc) => this.process === eventProc,
      handleStdoutChunk: (chunk) => this.stdoutLineBuffer.push(chunk, (line) => this.handleLine(line)),
      handleStderrMessage: (message) => this.stderrLogger.log(message),
      handleStdinError: (error) => {
        logBridgeError('Codex app-server stdin failed', error)
        this.restartAppServer('stdin error')
      },
      handleProcessError: (error) => {
        logBridgeError('Codex app-server process error', error)
        this.cleanupProcessRuntime(error)
        this.process = null
        this.initialized = false
        this.initializePromise = null
        this.stdoutLineBuffer.clear()
      },
      handleProcessExit: () => {
        const expectedExit = this.stopping || this.expectedExitProcesses.has(proc)
        const failure = new Error(this.stopping ? 'codex app-server stopped' : 'codex app-server exited unexpectedly')
        if (!expectedExit) {
          logBridgeError('Codex app-server exited unexpectedly', failure, {
            pendingRpcCount: this.pending.count,
            pendingServerRequestCount: this.pendingServerRequests.count,
          })
        }

        if (this.process === proc) {
          this.cleanupProcessRuntime(failure)
          this.process = null
          this.initialized = false
          this.initializePromise = null
          this.stdoutLineBuffer.clear()
        }
      },
    })
  }

  private rejectQueuedRpcCalls(error: Error): void {
    this.rpcQueue.rejectAll(error)
  }

  private clearSessionStores(): void {
    clearAppServerSessionStores({
      pendingServerRequests: this.pendingServerRequests,
      rpcCache: this.rpcCache,
      threadTokenUsage: this.threadTokenUsage,
      planModeTurns: this.planModeTurns,
    })
  }

  private cleanupProcessRuntime(error: Error, options?: { rejectQueuedRpcCalls?: boolean }): void {
    cleanupAppServerProcessRuntime(error, {
      pendingRpcStore: this.pending,
      rejectQueuedRpcCalls: (error) => this.rejectQueuedRpcCalls(error),
      clearSessionStores: () => this.clearSessionStores(),
    }, options)
  }

  private sendLine(payload: Record<string, unknown>): void {
    sendAppServerJsonRpcLine(payload, {
      getProcess: () => this.process,
      handleWriteFailure: () => this.restartAppServer('stdin write failed'),
    })
  }

  private noteRpcTimeout(method: string, params: unknown, timeoutMs: number): void {
    const decision = createAppServerRpcTimeoutRecoveryDecision({
      method,
      params,
      timeoutMs,
      startedAtMs: this.startedAtMs,
      coldStartGraceMs: APP_SERVER_COLD_START_GRACE_MS,
      dependencies: {
        now: Date.now,
        recordTimeout: (method, params, timeoutMs, nowMs) => {
          this.rpcDiagnostics.recordTimeout(method, params, timeoutMs, nowMs)
        },
        noteRestartableTimeout: (method, nowMs) => this.rpcDiagnostics.noteRestartableTimeout(method, nowMs),
      },
    })

    if (decision.kind === 'startup-grace') {
      writeBridgeLog('warn', 'App-server RPC timed out during startup grace', {
        method,
        durationMs: timeoutMs,
        processAgeMs: decision.processAgeMs,
        includeTurns: decision.includeTurns,
      })
      return
    }

    if (decision.kind !== 'restart') return

    this.restartAppServer('repeated RPC timeouts', {
      method,
      timeoutMs,
      timeoutCount: decision.timeoutCount,
      includeTurns: decision.includeTurns,
    })
  }

  private restartAppServer(reason: string, details: Record<string, unknown> = {}): void {
    const proc = this.process
    if (!proc) return

    const now = Date.now()
    if (now - this.lastRestartAtMs < APP_SERVER_RESTART_COOLDOWN_MS) {
      return
    }
    this.lastRestartAtMs = now
    this.rpcDiagnostics.resetTimeoutWindow()
    this.expectedExitProcesses.add(proc)

    writeBridgeLog('warn', 'Restarting Codex app-server', {
      reason,
      pid: proc.pid,
      pendingRpcCount: this.pending.count,
      pendingServerRequestCount: this.pendingServerRequests.count,
      ...details,
    })

    this.process = null
    this.initialized = false
    this.initializePromise = null
    this.stdoutLineBuffer.clear()
    this.cleanupProcessRuntime(new Error(`codex app-server restarted: ${reason}`))

    terminateAppServerProcess(proc)
  }

  private handleLine(line: string): void {
    dispatchAppServerJsonRpcLine(line, {
      isPendingResponseId: (id) => this.pending.has(id),
      finalizePendingRpc: (id) => this.pending.finalize(id),
      logSlowRpc: (method, startedAtMs, params, details) => {
        this.rpcDiagnostics.logSlowRpc(method, startedAtMs, params, details)
      },
      captureNotificationState: (notification) => this.captureNotificationState(notification),
      emitNotification: (notification) => this.emitNotification(notification),
      handleServerRequest: (requestId, method, params) => this.handleServerRequest(requestId, method, params),
    })
  }

  private emitNotification(notification: { method: string; params: unknown }): void {
    this.notificationListeners.emit(notification)
  }

  private captureNotificationState(notification: { method: string; params: unknown }): void {
    captureAppServerNotificationState(notification, {
      clearThreadListCache: () => this.rpcCache.clearThreadList(),
      clearPlanModeTurnByThreadOrTurn: (threadId, turnId) => this.planModeTurns.clearByThreadOrTurn(threadId, turnId),
      observeThreadTokenUsage: (params) => this.threadTokenUsage.observeUpdate(params),
    })
  }

  private sendServerRequestReply(requestId: number, reply: ServerRequestReply): void {
    this.sendLine(createServerRequestReplyResponse(requestId, reply))
  }

  setWebBridgeSettings(settings: WebBridgeSettings): void {
    this.webBridgeSettings = normalizeWebBridgeSettings(settings)
  }

  getWebBridgeSettings(): WebBridgeSettings {
    return this.webBridgeSettings
  }

  markPlanModeTurn(threadId: string, turnId = ''): void {
    this.planModeTurns.mark(threadId, turnId)
  }

  clearPlanModeTurn(threadId: string, turnId = ''): void {
    this.planModeTurns.clear(threadId, turnId)
  }

  getActivePlanModeTurnCount(): number {
    return this.planModeTurns.count
  }

  private isPlanModeServerRequest(params: unknown): boolean {
    const threadId = this.readServerRequestThreadId(params)
    const turnId = readTurnIdFromPayload(params)
    return this.planModeTurns.isActiveRequest(threadId, turnId)
  }

  private readServerRequestThreadId(params: unknown): string {
    return readThreadIdFromPayload(params)
  }

  private resolvePendingServerRequest(requestId: number, reply: ServerRequestReply): void {
    resolveAppServerPendingServerRequest(requestId, reply, {
      consumePendingServerRequest: (requestId) => this.pendingServerRequests.consume(requestId),
      sendServerRequestReply: (requestId, reply) => this.sendServerRequestReply(requestId, reply),
      emitNotification: (notification) => this.emitNotification(notification),
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
    })
  }

  private handleServerRequest(requestId: number, method: string, params: unknown): void {
    handleAppServerServerRequest(requestId, method, params, {
      permissions: this.webBridgeSettings.permissions,
      isPlanModeRequest: (requestParams) => this.isPlanModeServerRequest(requestParams),
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
      readTurnIdFromPayload,
      sendServerRequestReply: (requestId, reply) => this.sendServerRequestReply(requestId, reply),
      recordPendingServerRequest: (requestId, method, params) => this.pendingServerRequests.record(requestId, method, params),
      emitNotification: (notification) => this.emitNotification(notification),
      writeUnsupportedRequestWarning: (details) => {
        writeBridgeLog('warn', 'Declined unsupported app-server request', {
          requestId: details.requestId,
          method: details.method,
          threadId: details.threadId,
          turnId: details.turnId,
        })
      },
    })
  }

  private enqueueRpc(method: string, params: unknown): Promise<unknown> {
    return this.rpcQueue.enqueue(method, params)
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    this.start()
    const id = this.nextId++
    const timeoutMs = getRpcTimeoutMs(method, params)

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const timedOutRequest = this.pending.finalize(id)
        if (!timedOutRequest) return
        writeBridgeLog('warn', 'App-server RPC timed out', {
          method,
          durationMs: timeoutMs,
          includeTurns: readThreadReadIncludeTurnsForMethod(method, params),
        })
        this.noteRpcTimeout(method, params, timeoutMs)
        timedOutRequest.reject(createRpcTimeoutError(method, timeoutMs))
      }, timeoutMs)
      timeoutId.unref?.()

      this.pending.record(id, {
        resolve,
        reject,
        method,
        params,
        startedAtMs: Date.now(),
        timeoutId,
      })

      this.sendLine(createAppServerRpcRequest(id, method, params))
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (this.initializePromise) {
      await this.initializePromise
      return
    }

    this.initializePromise = (async () => {
      const clientInfo = createAppServerClientInfo(await readPackageVersion())
      await this.call('initialize', createAppServerInitializeParams(clientInfo))
      this.sendLine(createAppServerRpcNotification('initialized'))
      this.initialized = true
    })().finally(() => {
      this.initializePromise = null
    })

    await this.initializePromise
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    await this.ensureInitialized()
    if (shouldInvalidateThreadListCacheForRpc(method)) {
      this.rpcCache.clearThreadList()
    }
    if (getAppServerRpcQueuePriority(method, params) === 0) {
      return this.call(method, params)
    }

    const shareableKey = getShareableRpcKey(method, params)
    if (!shareableKey) {
      return this.enqueueRpc(method, params)
    }

    return this.rpcCache.executeShareableRead(
      method,
      params,
      shareableKey,
      (rpcMethod, rpcParams) => this.enqueueRpc(rpcMethod, rpcParams),
    )
  }

  async warmup(): Promise<void> {
    await this.ensureInitialized()
  }

  onNotification(listener: (value: { method: string; params: unknown }) => void): () => void {
    return this.notificationListeners.subscribe(listener)
  }

  async respondToServerRequest(payload: unknown): Promise<void> {
    await this.ensureInitialized()
    const { id, reply } = readServerRequestReplyPayload(payload)
    this.resolvePendingServerRequest(id, reply)
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return this.pendingServerRequests.list()
  }

  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[] {
    return this.pendingServerRequests.listForThread(threadId, (params) => this.readServerRequestThreadId(params))
  }

  getThreadTokenUsage(threadId: string): ThreadTokenUsage | null {
    return this.threadTokenUsage.get(threadId)
  }

  getStatus(): AppServerHealth {
    return createAppServerHealthSnapshot({
      running: this.process !== null,
      initialized: this.initialized,
      stopping: this.stopping,
      pid: this.process?.pid ?? null,
      pendingRpcCount: this.pending.count,
      queuedRpcCount: this.rpcQueue.count,
      pendingServerRequestCount: this.pendingServerRequests.count,
      activePlanModeTurnCount: this.planModeTurns.count,
      launchPolicy: createAppServerLaunchPolicySnapshot(this.appServerLaunchPolicy),
      rpcDiagnostics: this.rpcDiagnostics.snapshot(this.pending.count, this.rpcQueue.count),
    })
  }

  getStartedAtMs(): number {
    return this.startedAtMs
  }

  dispose(): void {
    const failure = new Error('codex app-server stopped')
    this.rejectQueuedRpcCalls(failure)
    if (!this.process) return

    const proc = this.process
    this.stopping = true
    this.process = null
    this.initialized = false
    this.initializePromise = null
    this.stdoutLineBuffer.clear()

    this.cleanupProcessRuntime(failure, { rejectQueuedRpcCalls: false })

    terminateAppServerProcess(proc)
  }
}

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
  const threadSearchIndexStore = createThreadSearchIndexStore({
    listThreads: (params) => appServer.rpc('thread/list', params),
    getSessionIndexPath: getCodexSessionIndexPath,
    readThreadTitlesFromSessionIndex,
  })
  const threadReadCacheStore = new AppServerThreadReadCacheStore()
  const augmentThreadListRpcResult = createAppServerThreadListRpcResultAugmenter({
    augmenter: supplementalThreadListAugmenter,
    readPinnedThreadIds: readMergedPinnedThreadIds,
    rpc: (method, params) => appServer.rpc(method, params),
  })
  const runtimeStateStore = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload,
    getErrorMessage,
  })
  const runtimeStore = new RuntimeStore()
  const notificationDiagnostics = new AppServerNotificationDiagnostics()
  const statusDiagnostics = new AppServerStatusDiagnostics()
  const hookDiagnosticsCache = new AppServerHookDiagnosticsCache()
  const windowsSandboxReadinessCache = new WindowsSandboxReadinessCache()
  const bridgeNotificationListeners = new AppServerNotificationListeners<BridgeNotificationEvent>()
  const {
    notificationReplay,
    rememberNotificationEvent,
    listNotificationEventsAfter,
  } = createAppServerNotificationReplayBundle({
    initialSeq: runtimeStore.getLatestEventSeq(),
    appendEvent: (event) => {
      runtimeStore.appendEvent(event)
    },
    listEventsAfter: (afterSeq, limit) => runtimeStore.listEventsAfter(afterSeq, limit),
    observeNotification: (observation) => {
      notificationDiagnostics.observe(observation)
      statusDiagnostics.observeStatusNotification({
        method: observation.method,
        atIso: observation.atIso,
        threadId: observation.threadId,
        payload: observation.params,
      })
    },
    readThreadIdFromPayload,
    readTurnIdFromPayload,
  })

  const persistRuntimeSnapshot = createAppServerRuntimeSnapshotPersister({
    snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
    listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
    getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
    upsertSnapshot: (nextSnapshot) => runtimeStore.upsertSnapshot(nextSnapshot),
  })

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

  const unsubscribeAppServerNotifications = subscribeBridgeNotificationRuntimeSync({
    subscribeNotifications: (listener) => appServer.onNotification(listener),
    rememberNotificationEvent,
    runtimeStateStore,
    readThreadIdFromPayload,
    persistRuntimeSnapshot,
    runtimeStore,
    deleteCachedThreadRead: (threadId) => threadReadCacheStore.delete(threadId),
    emitNotification: (event) => {
      bridgeNotificationListeners.emit(event)
    },
  })

  startCodexBridgeStartupTasks({
    initializeSkillsSyncOnStartup: () => initializeSkillsSyncOnStartup(appServer),
    warmupAppServer: () => appServer.warmup(),
    getWebBridgeSettingsPath,
    readWebBridgeSettings,
    setWebBridgeSettings: (settings) => appServer.setWebBridgeSettings(settings),
    logError: logBridgeError,
  })

  const {
    readThreadRuntimeSnapshot,
    readLocalRuntimeSnapshot,
    readCachedThreadTokenUsage,
  } = createAppServerRuntimeReaders({
    rpc: (method, params) => appServer.rpc(method, params),
    observeThreadRead: (details) => statusDiagnostics.observeThreadRead(details),
    getCachedThreadRead: (normalizedThreadId) => threadReadCacheStore.get(normalizedThreadId),
    rememberCachedThreadRead: (normalizedThreadId, threadRead) => threadReadCacheStore.remember(normalizedThreadId, threadRead),
    snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
    observeRuntimeThreadRead: (normalizedThreadId, inProgress, activeTurnId, updatedAtIso, source) => {
      runtimeStateStore.observeThreadRead(normalizedThreadId, inProgress, activeTurnId, updatedAtIso, source)
    },
    markRuntimeDegraded: (normalizedThreadId, reason) => runtimeStateStore.markDegraded(normalizedThreadId, reason),
    persistRuntimeSnapshot,
    listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
    getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
    getErrorMessage,
    writeWarning: (message, details) => {
      writeBridgeLog('warn', message, details)
    },
    getSnapshot: (normalizedThreadId) => runtimeStore.getSnapshot(normalizedThreadId),
    getAppServerStartedAtMs: () => appServer.getStartedAtMs(),
  })

  const {
    reconcileRuntimeThread,
    runtimeReconcileScheduler,
  } = createAppServerRuntimeReconciliation({
    readThreadRuntimeSnapshot,
    runtimeStore,
    getErrorMessage,
    writeReconcileFailure: (details) => {
      writeBridgeLog('warn', 'Runtime reconcile failed', details)
    },
  })

  const {
    startRuntimeTurn,
    interruptRuntimeTurn,
  } = createAppServerRuntimeActions({
    createRequest: (record) => runtimeStore.createRequest(record),
    updateRequest: (requestId, patch) => runtimeStore.updateRequest(requestId, patch),
    getRequest: (requestId) => runtimeStore.getRequest(requestId),
    rpc: (method, params) => appServer.rpc(method, params),
    clearThreadSearchIndex: () => threadSearchIndexStore.clear(),
    markStarting: (threadId) => runtimeStateStore.markStarting(threadId),
    markRunning: (threadId, turnId = '') => runtimeStateStore.markRunning(threadId, turnId),
    markStartUncertain: (threadId, lastError = null) => runtimeStateStore.markStartUncertain(threadId, lastError),
    persistRuntimeSnapshot,
    markPlanModeTurn: (threadId, turnId = '') => appServer.markPlanModeTurn(threadId, turnId),
    markStopping: (threadId) => runtimeStateStore.markStopping(threadId),
    markInterrupted: (threadId, lastError = null) => runtimeStateStore.markInterrupted(threadId, lastError),
    markStopUncertain: (threadId, lastError = null) => runtimeStateStore.markStopUncertain(threadId, lastError),
    clearPlanModeTurn: (threadId, turnId = '') => appServer.clearPlanModeTurn(threadId, turnId),
    getErrorMessage,
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
