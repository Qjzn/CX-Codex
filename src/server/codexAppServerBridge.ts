import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { handleSkillsRoutes, initializeSkillsSyncOnStartup } from './skillsRoutes.js'
import { RuntimeStore, type RuntimeRequestRecord, type RuntimeRequestStatus } from './runtimeStore.js'
import {
  type BridgeNotificationEvent,
} from './appServerRuntimeBridge.js'
import { syncBridgeNotificationRuntimeState } from './appServerNotificationRuntimeSync.js'
import { AppServerNotificationReplay } from './appServerNotificationReplay.js'
import {
  updateRuntimeRequestsFromSnapshot,
} from './appServerRuntimeRequestReconciliation.js'
import { createRuntimeReconcileScheduler } from './appServerRuntimeReconcileScheduler.js'
import {
  RuntimeStateStore,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import {
  createServerRequestResolvedNotification,
  PendingServerRequestStore,
  type PendingServerRequest,
} from './pendingServerRequests.js'
import { logBridgeError, writeBridgeLog } from './bridgeLog.js'
import { getErrorMessage } from './errorMessage.js'
import {
  readJsonBody,
  RequestBodyTooLargeError,
} from './httpBody.js'
import { setJson } from './httpJsonResponse.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'
import {
  getTranscriptionProxyConfigSnapshot,
} from './transcriptionProxy.js'
import { handleTranscriptionRoutes } from './transcriptionRoute.js'
import { handleNotificationReplayRoute } from './notificationReplayRoute.js'
import { handleLocalStateRoutes } from './localStateRoutes.js'
import { handleNotificationSseRoute } from './notificationSseRoute.js'
import { handleRuntimeStateRoutes } from './runtimeStateRoutes.js'
import { handleDiagnosticsRoutes } from './diagnosticsRoutes.js'
import { handleWorkspaceMetaRoutes } from './workspaceMetaRoutes.js'
import { handleProjectRootRoutes } from './projectRootRoutes.js'
import { handleComposerFileSearchRoutes } from './composerFileSearchRoutes.js'
import { handleThreadRoutes } from './threadRoutes.js'
import { handleStatusRoutes } from './statusRoutes.js'
import { handleGithubTrendingRoutes } from './githubTrendingRoutes.js'
import { handleServerRequestRoutes } from './serverRequestRoutes.js'
import { handleFileUploadRoute } from './fileUploadRoute.js'
import { handleRuntimeActionRoutes } from './runtimeActionRoutes.js'
import { handleWorktreeRoutes } from './worktreeRoutes.js'
import { handleRpcProxyRoute } from './rpcProxyRoute.js'
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
import { readAppServerThreadRuntimeSnapshot } from './appServerThreadRuntimeSnapshot.js'
import { createLocalRuntimeSnapshot } from './appServerRuntimeSnapshotRecovery.js'
import {
  createRpcTimeoutError,
} from './appServerRpcErrors.js'
import { settleAppServerRpcResponse } from './appServerRpcResponse.js'
import { AppServerNotificationDiagnostics } from './appServerNotificationDiagnostics.js'
import { AppServerStatusDiagnostics } from './appServerStatusDiagnostics.js'
import { readAppServerSchemaAuditSummary } from './appServerSchemaAuditSummary.js'
import {
  AppServerHookDiagnosticsCache,
  type AppServerHookDiagnostics,
} from './appServerHookDiagnostics.js'
import { AppServerNotificationListeners } from './appServerNotificationListeners.js'
import {
  createWindowsSandboxReadinessUnsupported,
  WindowsSandboxReadinessCache,
  type WindowsSandboxReadinessDiagnostics,
} from './windowsSandboxDiagnostics.js'
import {
  createAppServerRpcNotification,
  createAppServerRpcRequest,
  readAppServerJsonRpcLineEvent,
} from './appServerJsonRpcWire.js'
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
  resolveThreadTokenUsage,
  ThreadTokenUsageStore,
  type ThreadTokenUsage,
} from './threadTokenUsage.js'
import { readThreadTitlesFromSessionIndex } from './threadTitleCache.js'
import {
  buildThreadSearchIndex,
  ThreadSearchIndexStore,
} from './threadSearchIndex.js'
import {
  evaluateServerRequestPolicy,
  isImmediateServerRequestPolicyDecision,
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
import { AppServerThreadListAugmenter } from './appServerThreadListAugment.js'
import { startRuntimeTurnWithAppServer } from './appServerRuntimeStart.js'
import { interruptRuntimeTurnWithAppServer } from './appServerRuntimeInterrupt.js'
import { persistAppServerRuntimeSnapshot } from './appServerRuntimeSnapshotPersistence.js'
import { readAppServerLocalRuntimeSnapshot } from './appServerLocalRuntimeSnapshot.js'

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

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.stdoutLineBuffer.push(chunk, (line) => this.handleLine(line))
    })

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (!message) return
      this.stderrLogger.log(message)
    })

    proc.stdin.on('error', (error) => {
      if (this.process !== proc) return
      logBridgeError('Codex app-server stdin failed', error)
      this.restartAppServer('stdin error')
    })

    proc.on('error', (error) => {
      if (this.process !== proc) return
      logBridgeError('Codex app-server process error', error)
      this.pending.rejectAll(error)
      this.rejectQueuedRpcCalls(error)
      this.clearSessionStores()
      this.process = null
      this.initialized = false
      this.initializePromise = null
      this.stdoutLineBuffer.clear()
    })

    proc.on('exit', () => {
      const expectedExit = this.stopping || this.expectedExitProcesses.has(proc)
      const failure = new Error(this.stopping ? 'codex app-server stopped' : 'codex app-server exited unexpectedly')
      if (!expectedExit) {
        logBridgeError('Codex app-server exited unexpectedly', failure, {
          pendingRpcCount: this.pending.count,
          pendingServerRequestCount: this.pendingServerRequests.count,
        })
      }

      if (this.process === proc) {
        this.pending.rejectAll(failure)
        this.rejectQueuedRpcCalls(failure)
        this.clearSessionStores()
        this.process = null
        this.initialized = false
        this.initializePromise = null
        this.stdoutLineBuffer.clear()
      }
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

  private sendLine(payload: Record<string, unknown>): void {
    if (!this.process) {
      throw new Error('codex app-server is not running')
    }

    try {
      this.process.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch (error) {
      this.restartAppServer('stdin write failed')
      throw error
    }
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
    this.pending.rejectAll(new Error(`codex app-server restarted: ${reason}`))
    this.rejectQueuedRpcCalls(new Error(`codex app-server restarted: ${reason}`))
    this.clearSessionStores()

    terminateAppServerProcess(proc)
  }

  private handleLine(line: string): void {
    const message = readAppServerJsonRpcLineEvent(line, {
      isPendingResponseId: (id) => this.pending.has(id),
    })
    if (!message) return

    if (message.kind === 'response') {
      settleAppServerRpcResponse(message, {
        finalizePendingRpc: (id) => this.pending.finalize(id),
        logSlowRpc: (method, startedAtMs, params, details) => {
          this.rpcDiagnostics.logSlowRpc(method, startedAtMs, params, details)
        },
      })
      return
    }

    if (message.kind === 'notification') {
      const notification = {
        method: message.method,
        params: message.params,
      }
      this.captureNotificationState(notification)
      this.emitNotification(notification)
      return
    }

    this.handleServerRequest(message.id, message.method, message.params)
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

  private emitServerRequestResolved(
    requestId: number,
    method: string,
    params: unknown,
    mode: 'automatic' | 'manual',
  ): void {
    this.emitNotification(createServerRequestResolvedNotification({
      requestId,
      method,
      params,
      mode,
      readThreadIdFromPayload: (payload) => this.readServerRequestThreadId(payload),
    }))
  }

  private resolvePendingServerRequest(requestId: number, reply: ServerRequestReply): void {
    const pendingRequest = this.pendingServerRequests.consume(requestId)
    if (!pendingRequest) {
      throw new Error(`No pending server request found for id ${String(requestId)}`)
    }

    this.sendServerRequestReply(requestId, reply)
    this.emitServerRequestResolved(requestId, pendingRequest.method, pendingRequest.params, 'manual')
  }

  private handleServerRequest(requestId: number, method: string, params: unknown): void {
    const policy = evaluateServerRequestPolicy({
      method,
      params,
      permissions: this.webBridgeSettings.permissions,
      isPlanModeRequest: this.isPlanModeServerRequest(params),
    })

    if (isImmediateServerRequestPolicyDecision(policy)) {
      if (policy.kind === 'reject-unsupported') {
        writeBridgeLog('warn', 'Declined unsupported app-server request', {
          requestId,
          method,
          threadId: this.readServerRequestThreadId(params),
          turnId: readTurnIdFromPayload(params),
        })
      }
      this.sendServerRequestReply(requestId, {
        result: policy.result,
      })
      this.emitServerRequestResolved(requestId, method, params, 'automatic')
      return
    }

    const pendingRequest = this.pendingServerRequests.record(requestId, method, params)

    this.emitNotification({
      method: 'server/request',
      params: pendingRequest,
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

    this.pending.rejectAll(failure)
    this.clearSessionStores()

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

const SHARED_BRIDGE_KEY = '__codexRemoteSharedBridge__'

function getSharedBridgeState(): SharedBridgeState {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_BRIDGE_KEY]?: SharedBridgeState
  }

  const existing = globalScope[SHARED_BRIDGE_KEY]
  if (existing) return existing

  const appServer = new AppServerProcess()
  const created: SharedBridgeState = {
    appServer,
    methodCatalog: new AppServerMethodCatalog(),
  }
  globalScope[SHARED_BRIDGE_KEY] = created
  return created
}

async function augmentThreadListRpcResult(
  appServer: AppServerProcess,
  params: unknown,
  result: unknown,
): Promise<unknown> {
  return await supplementalThreadListAugmenter.augmentThreadListRpcResult({
    params,
    result,
    readPinnedThreadIds: readMergedPinnedThreadIds,
    readThreadById: (threadId) => appServer.rpc('thread/read', {
      threadId,
      includeTurns: false,
    }),
  })
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const { appServer, methodCatalog } = getSharedBridgeState()
  const threadSearchIndexStore = new ThreadSearchIndexStore(async () => buildThreadSearchIndex(
    (params) => appServer.rpc('thread/list', params),
    await readThreadTitlesFromSessionIndex(getCodexSessionIndexPath()),
  ))
  const threadReadCacheStore = new AppServerThreadReadCacheStore()
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
  const notificationReplay = new AppServerNotificationReplay({
    initialSeq: runtimeStore.getLatestEventSeq(),
    appendEvent: (event) => {
      runtimeStore.appendEvent(event)
    },
    listEventsAfter: (afterSeq, limit) => runtimeStore.listEventsAfter(afterSeq, limit),
    observeNotification: (observation) => {
      notificationDiagnostics.observe(observation)
    },
    readThreadIdFromPayload,
    readTurnIdFromPayload,
  })

  function persistRuntimeSnapshot(threadId: string, snapshot?: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot {
    return persistAppServerRuntimeSnapshot(threadId, snapshot, {
      snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
      listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
      getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
      upsertSnapshot: (nextSnapshot) => runtimeStore.upsertSnapshot(nextSnapshot),
    })
  }

  function rememberNotificationEvent(notification: { method: string; params: unknown }): BridgeNotificationEvent {
    return notificationReplay.remember(notification)
  }

  function listNotificationEventsAfter(afterSeq: number, limit = 200): {
    notifications: BridgeNotificationEvent[]
    latestSeq: number
    oldestSeq: number
  } {
    return notificationReplay.listAfter(afterSeq, limit)
  }

  async function readWindowsSandboxReadinessDiagnostics(): Promise<WindowsSandboxReadinessDiagnostics> {
    if (process.platform !== 'win32') {
      return createWindowsSandboxReadinessUnsupported()
    }
    return windowsSandboxReadinessCache.read(() => appServer.rpc('windowsSandbox/readiness', undefined))
  }

  async function readAppServerHookDiagnostics(): Promise<AppServerHookDiagnostics> {
    return hookDiagnosticsCache.read(() => appServer.rpc('hooks/list', { cwds: [process.cwd()] }))
  }

  const unsubscribeAppServerNotifications = appServer.onNotification((notification: { method: string; params: unknown }) => {
    syncBridgeNotificationRuntimeState(notification, {
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
  })

  void initializeSkillsSyncOnStartup(appServer)
    .catch((error) => {
      logBridgeError('Startup skills sync failed', error)
    })
  void appServer.warmup()
    .catch((error) => {
      logBridgeError('App server warmup failed', error)
    })
  void readWebBridgeSettings(getWebBridgeSettingsPath())
    .then((settings) => {
      appServer.setWebBridgeSettings(settings)
    })
    .catch((error) => {
      logBridgeError('Web settings load failed', error)
    })

  async function readThreadRuntimeSnapshot(threadId: string): Promise<ThreadRuntimeSnapshot> {
    return await readAppServerThreadRuntimeSnapshot(threadId, {
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
    })
  }

  function readLocalRuntimeSnapshot(threadId: string): ThreadRuntimeSnapshot {
    return readAppServerLocalRuntimeSnapshot(threadId, {
      getSnapshot: (normalizedThreadId) => runtimeStore.getSnapshot(normalizedThreadId),
      listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
      getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
      getAppServerStartedAtMs: () => appServer.getStartedAtMs(),
      snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
      persistRuntimeSnapshot,
    })
  }

  async function reconcileRuntimeThread(threadId: string): Promise<ThreadRuntimeSnapshot> {
    const snapshot = await readThreadRuntimeSnapshot(threadId)
    updateRuntimeRequestsFromSnapshot(threadId, snapshot, runtimeStore)
    return snapshot
  }

  async function startRuntimeTurn(payload: unknown): Promise<{
    request: RuntimeRequestRecord
    threadId: string
    turnId: string
    status: RuntimeRequestStatus
  }> {
    return await startRuntimeTurnWithAppServer(payload, {
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
      getErrorMessage,
    })
  }

  async function interruptRuntimeTurn(payload: unknown): Promise<{
    requestId: string
    threadId: string
    turnId: string
    status: RuntimeRequestStatus
  }> {
    return await interruptRuntimeTurnWithAppServer(payload, {
      createRequest: (record) => runtimeStore.createRequest(record),
      updateRequest: (requestId, patch) => runtimeStore.updateRequest(requestId, patch),
      rpc: (method, params) => appServer.rpc(method, params),
      markStopping: (threadId) => runtimeStateStore.markStopping(threadId),
      markInterrupted: (threadId, lastError = null) => runtimeStateStore.markInterrupted(threadId, lastError),
      markStopUncertain: (threadId, lastError = null) => runtimeStateStore.markStopUncertain(threadId, lastError),
      persistRuntimeSnapshot,
      clearPlanModeTurn: (threadId, turnId = '') => appServer.clearPlanModeTurn(threadId, turnId),
      getErrorMessage,
    })
  }

  const runtimeReconcileScheduler = createRuntimeReconcileScheduler({
    listUncertainRequests: (limit) => runtimeStore.listUncertainRequests(limit),
    reconcileRuntimeThread,
    updateRequest: (requestId, patch) => runtimeStore.updateRequest(requestId, patch),
    getErrorMessage,
    writeReconcileFailure: (details) => {
      writeBridgeLog('warn', 'Runtime reconcile failed', details)
    },
  })

  async function readCachedThreadTokenUsage(threadId: string): Promise<ThreadTokenUsage | null> {
    return await resolveThreadTokenUsage(threadId, {
      getCachedTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
      getCachedThreadRead: (normalizedThreadId) => threadReadCacheStore.get(normalizedThreadId),
    })
  }

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    try {
      if (!req.url) {
        next()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      if (await handleSkillsRoutes(req, res, url, { appServer, readJsonBody })) {
        return
      }

      if (await handleFileUploadRoute(req, res, url)) {
        return
      }

      if (await handleLocalStateRoutes(req, res, url, {
        readJsonBody,
        setWebBridgeSettings: (settings) => appServer.setWebBridgeSettings(settings),
      })) {
        return
      }

      if (await handleRpcProxyRoute(req, res, url, {
        readJsonBody,
        rpc: (method, params) => appServer.rpc(method, params),
        runtimeStateStore,
        persistRuntimeSnapshot,
        markPlanModeTurn: (threadId, turnId = '') => appServer.markPlanModeTurn(threadId, turnId),
        clearPlanModeTurn: (threadId, turnId = '') => appServer.clearPlanModeTurn(threadId, turnId),
        deleteCachedThreadRead: (threadId) => threadReadCacheStore.delete(threadId),
        rememberCachedThreadRead: (threadId, threadRead) => {
          threadReadCacheStore.remember(threadId, threadRead)
        },
        augmentThreadListRpcResult: (params, result) => augmentThreadListRpcResult(appServer, params, result),
        clearThreadSearchIndex: () => threadSearchIndexStore.clear(),
      })) {
        return
      }

      if (await handleRuntimeActionRoutes(req, res, url, {
        readJsonBody,
        startRuntimeTurn,
        interruptRuntimeTurn,
        getLatestRequestByClientMessageId: (clientMessageId) => runtimeStore.getLatestRequestByClientMessageId(clientMessageId),
      })) {
        return
      }

      if (await handleTranscriptionRoutes(req, res, url)) {
        return
      }

      if (await handleServerRequestRoutes(req, res, url, {
        readJsonBody,
        respondToServerRequest: (payload) => appServer.respondToServerRequest(payload),
        listPendingServerRequests: () => appServer.listPendingServerRequests(),
      })) {
        return
      }

      if (handleNotificationReplayRoute(req, res, url, middleware.listNotificationEventsAfter)) {
        return
      }

      if (await handleRuntimeStateRoutes(req, res, url, {
        runtimeRequestStore: runtimeStore,
        runtimeStateStore,
        reconcileRuntimeThread,
        readLocalRuntimeSnapshot,
        persistRuntimeSnapshot,
        readThreadRuntimeSnapshot,
        readCachedThreadTokenUsage,
        listPendingServerRequestsForThread: (threadId) => appServer.listPendingServerRequestsForThread(threadId),
        getThreadTokenUsage: (threadId) => appServer.getThreadTokenUsage(threadId),
      })) {
        return
      }

      if (await handleDiagnosticsRoutes(req, res, url, {
        getAppServerStatus: () => appServer.getStatus(),
        getNotificationDiagnostics: () => notificationDiagnostics.snapshot(),
        getStatusDiagnostics: () => statusDiagnostics.snapshot(),
        listPendingServerRequests: () => appServer.listPendingServerRequests(),
        readHookDiagnostics: readAppServerHookDiagnostics,
        readSchemaAuditSummary: readAppServerSchemaAuditSummary,
        readWindowsSandboxDiagnostics: readWindowsSandboxReadinessDiagnostics,
        getTranscriptionDiagnostics: getTranscriptionProxyConfigSnapshot,
        runtimeStore,
      })) {
        return
      }

      if (await handleGithubTrendingRoutes(req, res, url, {
        readJsonBody,
      })) {
        return
      }

      if (await handleWorktreeRoutes(req, res, url, {
        readJsonBody,
      })) {
        return
      }

      if (await handleWorkspaceMetaRoutes(req, res, url, {
        methodCatalog,
        readJsonBody,
        homeDirectory: homedir,
      })) {
        return
      }

      if (await handleProjectRootRoutes(req, res, url, {
        readJsonBody,
      })) {
        return
      }

      if (await handleComposerFileSearchRoutes(req, res, url, {
        readJsonBody,
      })) {
        return
      }

      if (await handleThreadRoutes(req, res, url, {
        readJsonBody,
        threadSearchIndexStore,
      })) {
        return
      }

      if (await handleStatusRoutes(req, res, url, {
        readJsonBody,
      })) {
        return
      }

      if (handleNotificationSseRoute(req, res, url, {
        latestSeq: () => notificationReplay.latestSeq,
        subscribeNotifications: middleware.subscribeNotifications,
      })) {
        return
      }

      next()
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        setJson(res, 413, { error: `Request body is too large. Maximum request size is ${error.maxBytes} bytes.` })
        return
      }
      const message = getErrorMessage(error, 'Unknown bridge error')
      logBridgeError('Bridge request failed', error, {
        requestMethod: req.method ?? '',
        requestPath: req.url ?? '',
      })
      setJson(res, 502, { error: message })
    }
  }

  middleware.dispose = () => {
    runtimeReconcileScheduler.dispose()
    threadSearchIndexStore.clear()
    bridgeNotificationListeners.clear()
    unsubscribeAppServerNotifications()
    notificationDiagnostics.clear()
    statusDiagnostics.clear()
    hookDiagnosticsCache.clear()
    windowsSandboxReadinessCache.clear()
    runtimeStore.close()
    appServer.dispose()
  }
  middleware.subscribeNotifications = (
    listener: (value: BridgeNotificationEvent) => void,
  ) => {
    return bridgeNotificationListeners.subscribe(listener)
  }
  middleware.listNotificationEventsAfter = listNotificationEventsAfter

  return middleware
}
