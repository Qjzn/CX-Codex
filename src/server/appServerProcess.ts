import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolveCodexCommand } from '../commandResolution.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'
import { createAppServerClientInfo, readPackageVersion } from './appServerClientInfo.js'
import { createAppServerHealthSnapshot, type AppServerHealth } from './appServerHealth.js'
import { createAppServerInitializeParams } from './appServerInitialization.js'
import { createAppServerRpcNotification, createAppServerRpcRequest } from './appServerJsonRpcWire.js'
import { sendAppServerJsonRpcLine } from './appServerJsonRpcWriter.js'
import {
  createAppServerArgs,
  createAppServerLaunchPolicySnapshot,
  resolveAppServerLaunchPolicy,
} from './appServerLaunch.js'
import { AppServerLineBuffer } from './appServerLineBuffer.js'
import { dispatchAppServerJsonRpcLine } from './appServerLineDispatcher.js'
import { AppServerNotificationListeners } from './appServerNotificationListeners.js'
import { captureAppServerNotificationState } from './appServerNotificationState.js'
import { cleanupAppServerProcessRuntime } from './appServerProcessCleanup.js'
import { attachAppServerProcessHandlers } from './appServerProcessHandlers.js'
import { terminateAppServerProcess } from './appServerProcessTermination.js'
import { AppServerPendingRpcStore } from './appServerPendingRpcStore.js'
import { AppServerRpcCache, getShareableRpcKey, shouldInvalidateThreadListCacheForRpc } from './appServerRpcCache.js'
import { AppServerRpcDiagnostics } from './appServerRpcDiagnostics.js'
import { createRpcTimeoutError } from './appServerRpcErrors.js'
import { AppServerRpcQueue, getAppServerRpcQueuePriority } from './appServerRpcQueue.js'
import { createAppServerRpcTimeoutRecoveryDecision } from './appServerRpcTimeoutRecovery.js'
import { getRpcTimeoutMs } from './appServerRpcTimeoutPolicy.js'
import { clearAppServerSessionStores } from './appServerSessionCleanup.js'
import { readThreadReadIncludeTurnsForMethod } from './appServerThreadReadParams.js'
import { logBridgeError, writeBridgeLog } from './bridgeLog.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import {
  createServerRequestReplyResponse,
  readServerRequestReplyPayload,
  type ServerRequestReply,
} from './serverRequestReply.js'
import type { WebBridgeSettings } from './serverRequestPolicy.js'
import { AppServerStderrLogger } from './appServerStderrLogger.js'
import { AppServerProcessServerRequests } from './appServerProcessServerRequests.js'
import { ThreadTokenUsageStore, type ThreadTokenUsage } from './threadTokenUsage.js'
import { DEFAULT_WEB_BRIDGE_SETTINGS, normalizeWebBridgeSettings } from './webBridgeSettings.js'

const APP_SERVER_RPC_SLOW_WARN_MS = 1_800
const APP_SERVER_RPC_MAX_IN_FLIGHT = 2
const APP_SERVER_RPC_QUEUE_WARN_SIZE = 6
const APP_SERVER_RPC_QUEUE_MAX_SIZE = 60
const APP_SERVER_RPC_QUEUE_WARN_INTERVAL_MS = 10_000
const APP_SERVER_RPC_TIMEOUT_RESTART_WINDOW_MS = 45_000
const APP_SERVER_RPC_TIMEOUT_RESTART_THRESHOLD = 3
const APP_SERVER_RESTART_COOLDOWN_MS = 10_000
const APP_SERVER_COLD_START_GRACE_MS = 60_000

export class AppServerProcess {
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
  private readonly serverRequests = new AppServerProcessServerRequests()
  private readonly rpcCache = new AppServerRpcCache()
  private readonly threadTokenUsage = new ThreadTokenUsageStore()
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
            pendingServerRequestCount: this.serverRequests.pendingCount,
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
      pendingServerRequests: this.serverRequests.pendingServerRequests,
      rpcCache: this.rpcCache,
      threadTokenUsage: this.threadTokenUsage,
      planModeTurns: this.serverRequests.planModeTurns,
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
      pendingServerRequestCount: this.serverRequests.pendingCount,
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
      clearPlanModeTurnByThreadOrTurn: (threadId, turnId) => {
        this.serverRequests.clearPlanModeTurnByThreadOrTurn(threadId, turnId)
      },
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
    this.serverRequests.markPlanModeTurn(threadId, turnId)
  }

  clearPlanModeTurn(threadId: string, turnId = ''): void {
    this.serverRequests.clearPlanModeTurn(threadId, turnId)
  }

  getActivePlanModeTurnCount(): number {
    return this.serverRequests.getActivePlanModeTurnCount()
  }

  private resolvePendingServerRequest(requestId: number, reply: ServerRequestReply): void {
    this.serverRequests.resolvePendingServerRequest(requestId, reply, {
      sendServerRequestReply: (requestId, reply) => this.sendServerRequestReply(requestId, reply),
      emitNotification: (notification) => this.emitNotification(notification),
    })
  }

  private handleServerRequest(requestId: number, method: string, params: unknown): void {
    this.serverRequests.handleServerRequest(requestId, method, params, {
      permissions: this.webBridgeSettings.permissions,
      sendServerRequestReply: (requestId, reply) => this.sendServerRequestReply(requestId, reply),
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
    return this.serverRequests.listPendingServerRequests()
  }

  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[] {
    return this.serverRequests.listPendingServerRequestsForThread(threadId)
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
      pendingServerRequestCount: this.serverRequests.pendingCount,
      activePlanModeTurnCount: this.serverRequests.activePlanModeTurnCount,
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
