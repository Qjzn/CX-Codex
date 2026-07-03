import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, mkdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { handleSkillsRoutes, initializeSkillsSyncOnStartup } from './skillsRoutes.js'
import { getDesktopAppRefreshStatus, requestDesktopAppRefresh } from './desktopAppRefresh.js'
import { getTunnelStatus, updateTunnelConfig } from './tunnelStatus.js'
import { readFavoriteRecords, writeFavoriteRecords } from './webUiState.js'
import { RuntimeStore, type RuntimeRequestRecord, type RuntimeRequestStatus } from './runtimeStore.js'
import {
  isRuntimeActiveState,
  RUNTIME_SNAPSHOT_STALE_MS,
  RuntimeStateStore,
  toPersistableRuntimeSnapshot,
  type RuntimeExecutionState,
  type RuntimeSnapshotOverlay,
  type ThreadRuntimeSnapshot,
} from './runtimeState.js'
import { PendingServerRequestStore, type PendingServerRequest } from './pendingServerRequests.js'
import { logBridgeError, writeBridgeLog } from './bridgeLog.js'
import { getErrorMessage } from './errorMessage.js'
import {
  applyRuntimeTurnOptionsToInput,
  buildRuntimeRequestPayloadSummary,
  createRuntimePromptHash,
  createRuntimeRequestId,
  normalizePlanModeTurnStartParams,
  readCollaborationModeFromPayload,
  readRuntimeTurnOptions,
  shouldRetryPlanModeWithoutNativeMode,
  type CollaborationMode,
} from './runtimePayload.js'
import {
  readHeaderValue,
  readJsonBody,
  readRawBody,
  RequestBodyTooLargeError,
} from './httpBody.js'
import { setJson } from './httpJsonResponse.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'
import {
  getOpenAiTranscribeApiKey,
  getTranscribeRequestBodyLimitBytes,
  getTranscriptionProxyConfigSnapshot,
  proxyChatGptTranscribe,
  proxyOpenAiTranscribe,
  type TranscriptionProxyResult,
} from './transcriptionProxy.js'
import { resolveCodexCommand } from '../commandResolution.js'
import {
  ComposerFileSearchError,
  searchComposerFiles,
} from './composerFileSearch.js'
import {
  fetchGithubTrending,
  normalizeGithubTrendingLimit,
  normalizeGithubTrendingSince,
  normalizeGithubTrendingTranslationDescriptions,
  translateGithubDescriptionsToChinese,
} from './githubTrending.js'
import {
  runCommand,
  runCommandCapture,
  runCommandWithOutput,
} from './commandRunner.js'
import {
  AppServerRpcCache,
  getShareableRpcKey,
  shouldInvalidateThreadListCacheForRpc,
} from './appServerRpcCache.js'
import {
  AppServerRpcDiagnostics,
} from './appServerRpcDiagnostics.js'
import { trimThreadTurnsInRpcResult } from './appServerRpcResult.js'
import {
  AppServerRpcQueue,
  getAppServerRpcQueuePriority,
} from './appServerRpcQueue.js'
import {
  readActiveTurnIdFromThreadReadPayload,
  readThreadInProgressFromThreadReadPayload,
  readThreadSessionPathFromThreadReadPayload,
  readThreadUpdatedAtIsoFromThreadReadPayload,
} from './appServerThreadPayload.js'
import {
  readItemIdFromPayload,
  readStringByAliases,
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import {
  createAppServerJsonRpcError,
  createRpcTimeoutError,
  isInterruptSettledError,
  isRpcTimeoutError,
  isThreadMaterializingError,
} from './appServerRpcErrors.js'
import { AppServerNotificationDiagnostics } from './appServerNotificationDiagnostics.js'
import { AppServerStatusDiagnostics } from './appServerStatusDiagnostics.js'
import { readAppServerSchemaAuditSummary } from './appServerSchemaAuditSummary.js'
import {
  createAppServerRpcErrorResponse,
  createAppServerRpcNotification,
  createAppServerRpcRequest,
  createAppServerRpcSuccessResponse,
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
import { AppServerMethodCatalog } from './appServerMethodCatalog.js'
import {
  getCodexGlobalStatePath,
  getCodexSessionIndexPath,
  getCodexWorktreesDir,
  getWebBridgeSettingsPath,
} from './codexPaths.js'
import { readCodexAuth } from './codexAuth.js'
import {
  readMergedPinnedThreadIds,
  writeMergedPinnedThreadIds,
} from './pinnedThreads.js'
import { PlanModeTurnStore } from './planModeTurnStore.js'
import {
  readThreadTokenUsageFromSessionLog,
  readThreadTokenUsageFromThreadReadPayload,
  ThreadTokenUsageStore,
  type ThreadTokenUsage,
} from './threadTokenUsage.js'
import {
  readMergedThreadTitleCache,
  readThreadTitleCache,
  readThreadTitlesFromSessionIndex,
  removeFromThreadTitleCache,
  updateThreadTitleCache,
  writeThreadTitleCache,
} from './threadTitleCache.js'
import {
  buildThreadSearchIndex,
  ThreadSearchIndexStore,
} from './threadSearchIndex.js'
import {
  evaluateServerRequestPolicy,
  type WebBridgeSettings,
} from './serverRequestPolicy.js'
import {
  readServerRequestReplyPayload,
  type ServerRequestReply,
} from './serverRequestReply.js'
import { createServerRequestDiagnosticsSnapshot } from './serverRequestDiagnostics.js'
import {
  DEFAULT_WEB_BRIDGE_SETTINGS,
  normalizeWebBridgeSettings,
  readWebBridgeSettings,
  writeWebBridgeSettings,
} from './webBridgeSettings.js'
import {
  FileUploadError,
  handleMultipartFileUpload,
} from './fileUpload.js'
import {
  normalizeWorkspaceRootsState,
  readWorkspaceRootsState,
  writeWorkspaceRootsState,
  type WorkspaceRootsState,
} from './workspaceRootsState.js'
import {
  ProjectRootError,
  resolveProjectRoot,
  suggestProjectRoot,
} from './projectRoots.js'

type JsonRpcResponse = {
  id?: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
  method?: string
  params?: unknown
}

type RpcProxyRequest = {
  method: string
  params?: unknown
}

type CachedThreadRead = {
  threadRead: unknown
  inProgress: boolean
  activeTurnId: string
  updatedAtIso: string
  sessionPath: string
  cachedAtIso: string
}

type PendingRpc = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  method: string
  params: unknown
  startedAtMs: number
  timeoutId: ReturnType<typeof setTimeout>
}

const APP_SERVER_RPC_TIMEOUT_MS = 60_000
const APP_SERVER_RPC_INIT_TIMEOUT_MS = 60_000
const APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS = 30_000
const APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS = 60_000
const APP_SERVER_RPC_SLOW_WARN_MS = 1_800
const APP_SERVER_RPC_MAX_IN_FLIGHT = 2
const APP_SERVER_RPC_QUEUE_WARN_SIZE = 6
const APP_SERVER_RPC_QUEUE_MAX_SIZE = 60
const APP_SERVER_RPC_QUEUE_WARN_INTERVAL_MS = 10_000
const APP_SERVER_RPC_TIMEOUT_RESTART_WINDOW_MS = 45_000
const APP_SERVER_RPC_TIMEOUT_RESTART_THRESHOLD = 3
const APP_SERVER_RESTART_COOLDOWN_MS = 10_000
const APP_SERVER_COLD_START_GRACE_MS = 60_000
const SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS = 5 * 60_000
const SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS = 20
const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readRuntimeRequestStatusFromExecutionState(state: RuntimeExecutionState): RuntimeRequestStatus {
  if (state === 'start_uncertain') return 'start_uncertain'
  if (state === 'stop_uncertain') return 'stop_uncertain'
  if (state === 'stopping') return 'stopping'
  if (state === 'interrupted') return 'interrupted'
  if (state === 'failed') return 'failed'
  if (state === 'completed' || state === 'completed_pending_sync') return 'completed'
  if (state === 'running' || state === 'waiting_permission' || state === 'starting') return 'running'
  if (state === 'sync_degraded') return 'sync_degraded'
  return 'stopped'
}

function normalizeRuntimeEventForReplay(event: {
  seq: number
  method: string
  params: unknown
  atIso: string
}): BridgeNotificationEvent {
  return {
    seq: event.seq,
    method: event.method,
    params: event.params,
    atIso: event.atIso,
  }
}

function getRpcTimeoutMs(method: string, params: unknown): number {
  if (method === 'initialize') {
    return APP_SERVER_RPC_INIT_TIMEOUT_MS
  }
  if (method === 'thread/read') {
    const record = asRecord(params)
    return record?.includeTurns === true
      ? APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
      : APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS
  }
  if (method === 'thread/resume') {
    return APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
  }
  return APP_SERVER_RPC_TIMEOUT_MS
}

function shouldInvalidateThreadListCacheForNotification(method: string): boolean {
  if (method === 'thread/name/updated') return true
  if (!method.startsWith('thread/')) return false
  return (
    method.endsWith('/created') ||
    method.endsWith('/archived') ||
    method.endsWith('/unarchived') ||
    method.endsWith('/deleted') ||
    method.endsWith('/removed') ||
    method.endsWith('/forked') ||
    method.endsWith('/moved')
  )
}

function shouldInvalidateThreadReadCacheForRpc(method: string): boolean {
  return (
    method === 'turn/start' ||
    method === 'turn/interrupt' ||
    method === 'thread/resume' ||
    method === 'thread/rollback' ||
    method === 'thread/archive' ||
    method === 'thread/name/set'
  )
}

function shouldInvalidateThreadReadCacheForNotification(method: string): boolean {
  if (
    method === 'turn/started' ||
    method === 'turn/start' ||
    method === 'turn/completed' ||
    method === 'thread/completed' ||
    method === 'turn/interrupted' ||
    method === 'thread/interrupted' ||
    method === 'error' ||
    method.endsWith('/failed')
  ) {
    return true
  }

  return (
    method === 'item/started' ||
    method === 'item/updated' ||
    method === 'item/completed'
  )
}

function readIsoTimestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : 0
}

function isCachedThreadReadStaleForRuntime(
  cachedThreadRead: CachedThreadRead,
  runtimeSnapshot: ThreadRuntimeSnapshot,
  lightThreadInProgress: boolean,
): boolean {
  if (lightThreadInProgress) return false
  if (isRuntimeActiveState(runtimeSnapshot.executionState) || runtimeSnapshot.executionState === 'completed_pending_sync') {
    return true
  }

  const completedAtMs = readIsoTimestampMs(runtimeSnapshot.lastCompletedAtIso)
  if (completedAtMs <= 0) return false
  const cachedAtMs = readIsoTimestampMs(cachedThreadRead.cachedAtIso)
  return cachedAtMs <= 0 || cachedAtMs < completedAtMs
}

function isMissingHeadError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes("not a valid object name: 'head'") ||
    message.includes('not a valid object name: head') ||
    message.includes('invalid reference: head')
  )
}

function isNotGitRepositoryError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase()
  return message.includes('not a git repository') || message.includes('fatal: not a git repository')
}

async function ensureRepoHasInitialCommit(repoRoot: string): Promise<void> {
  const agentsPath = join(repoRoot, 'AGENTS.md')
  try {
    await stat(agentsPath)
  } catch {
    await writeFile(agentsPath, '', 'utf8')
  }

  await runCommand('git', ['add', 'AGENTS.md'], { cwd: repoRoot })
  await runCommand(
    'git',
    ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', 'Initialize repository for worktree support'],
    { cwd: repoRoot },
  )
}

function normalizeCommitMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
  return normalized.slice(0, 2000)
}

function getRollbackGitDirForCwd(cwd: string): string {
  return join(cwd, '.codex', 'rollbacks', '.git')
}

async function ensureLocalCodexGitignoreHasRollbacks(cwd: string): Promise<void> {
  const localCodexDir = join(cwd, '.codex')
  const gitignorePath = join(localCodexDir, '.gitignore')
  await mkdir(localCodexDir, { recursive: true })
  let current = ''
  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch {
    current = ''
  }
  const rows = current.split(/\r?\n/).map((line) => line.trim())
  if (rows.includes('rollbacks/')) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? `${current}\n` : current
  await writeFile(gitignorePath, `${prefix}rollbacks/\n`, 'utf8')
}

async function ensureRollbackGitRepo(cwd: string): Promise<string> {
  const gitDir = getRollbackGitDirForCwd(cwd)
  try {
    const headInfo = await stat(join(gitDir, 'HEAD'))
    if (!headInfo.isFile()) {
      throw new Error('Invalid rollback git repository')
    }
  } catch {
    await mkdir(dirname(gitDir), { recursive: true })
  await runCommand('git', ['--git-dir', gitDir, '--work-tree', cwd, 'init'])
  }
  await runCommand('git', ['--git-dir', gitDir, 'config', 'user.email', 'codex@local'])
  await runCommand('git', ['--git-dir', gitDir, 'config', 'user.name', 'Codex Rollback'])
  try {
    await runCommandCapture('git', ['--git-dir', gitDir, '--work-tree', cwd, 'rev-parse', '--verify', 'HEAD'])
  } catch {
    await runCommand(
      'git',
      ['--git-dir', gitDir, '--work-tree', cwd, 'commit', '--allow-empty', '-m', 'Initialize rollback history'],
    )
  }
  await ensureLocalCodexGitignoreHasRollbacks(cwd)
  return gitDir
}

async function runRollbackGit(cwd: string, args: string[]): Promise<void> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  await runCommand('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

async function runRollbackGitCapture(cwd: string, args: string[]): Promise<string> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  return await runCommandCapture('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

async function runRollbackGitWithOutput(cwd: string, args: string[]): Promise<string> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  return await runCommandWithOutput('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

async function hasRollbackGitWorkingTreeChanges(cwd: string): Promise<boolean> {
  const status = await runRollbackGitWithOutput(cwd, ['status', '--porcelain'])
  return status.trim().length > 0
}

async function findRollbackCommitByExactMessage(cwd: string, message: string): Promise<string> {
  const normalizedTarget = normalizeCommitMessage(message)
  if (!normalizedTarget) return ''
  const raw = await runRollbackGitWithOutput(cwd, ['log', '--format=%H%x1f%B%x1e'])
  const entries = raw.split('\x1e')
  for (const entry of entries) {
    if (!entry.trim()) continue
    const [shaRaw, bodyRaw] = entry.split('\x1f')
    const sha = (shaRaw ?? '').trim()
    const body = normalizeCommitMessage(bodyRaw ?? '')
    if (!sha) continue
    if (body === normalizedTarget) return sha
  }
  return ''
}

const supplementalThreadSummaryCacheById = new Map<string, { value: unknown | null; cachedAtMs: number; failed?: boolean }>()

async function loadThreadSummariesById(
  appServer: AppServerProcess,
  threadIds: string[],
  excludedThreadIds: Set<string>,
): Promise<unknown[]> {
  const summaries: unknown[] = []
  const seen = new Set<string>(excludedThreadIds)
  let uncachedReadCount = 0

  for (const rawThreadId of threadIds) {
    const threadId = rawThreadId.trim()
    if (!threadId || seen.has(threadId)) continue
    seen.add(threadId)

    const cached = supplementalThreadSummaryCacheById.get(threadId)
    if (cached && Date.now() - cached.cachedAtMs <= SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS) {
      if (!cached.failed && cached.value) {
        summaries.push(cached.value)
      }
      continue
    }

    if (uncachedReadCount >= SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS) continue
    uncachedReadCount += 1

    try {
      const response = asRecord(await appServer.rpc('thread/read', {
        threadId,
        includeTurns: false,
      }))
      const thread = asRecord(response?.thread)
      if (thread?.id === threadId) {
        supplementalThreadSummaryCacheById.set(threadId, {
          value: thread,
          cachedAtMs: Date.now(),
        })
        summaries.push(thread)
      } else {
        supplementalThreadSummaryCacheById.set(threadId, {
          value: null,
          cachedAtMs: Date.now(),
          failed: true,
        })
      }
    } catch {
      supplementalThreadSummaryCacheById.set(threadId, {
        value: null,
        cachedAtMs: Date.now(),
        failed: true,
      })
      // Keep desktop/index parity best-effort; a missing historical thread must not break the list.
    }
  }

  if (supplementalThreadSummaryCacheById.size > 100) {
    const overflow = supplementalThreadSummaryCacheById.size - 100
    for (const key of Array.from(supplementalThreadSummaryCacheById.keys()).slice(0, overflow)) {
      supplementalThreadSummaryCacheById.delete(key)
    }
  }

  return summaries
}

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
      isHeavyThreadRead: (method, params) => method === 'thread/read' ? asRecord(params)?.includeTurns === true : undefined,
    },
    {
      slowWarnMs: APP_SERVER_RPC_SLOW_WARN_MS,
      queueWarnSize: APP_SERVER_RPC_QUEUE_WARN_SIZE,
      queueWarnIntervalMs: APP_SERVER_RPC_QUEUE_WARN_INTERVAL_MS,
      timeoutRestartWindowMs: APP_SERVER_RPC_TIMEOUT_RESTART_WINDOW_MS,
      timeoutRestartThreshold: APP_SERVER_RPC_TIMEOUT_RESTART_THRESHOLD,
    },
  )
  private readonly pending = new Map<number, PendingRpc>()
  private readonly rpcQueue = new AppServerRpcQueue({
    maxSize: APP_SERVER_RPC_QUEUE_MAX_SIZE,
    maxInFlight: APP_SERVER_RPC_MAX_IN_FLIGHT,
    diagnostics: this.rpcDiagnostics,
    execute: (method, params) => this.call(method, params),
  })
  private readonly expectedExitProcesses = new WeakSet<ChildProcessWithoutNullStreams>()
  private readonly notificationListeners = new Set<(value: { method: string; params: unknown }) => void>()
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
      this.rejectAllPending(error)
      this.rejectQueuedRpcCalls(error)
      this.pendingServerRequests.clear()
      this.rpcCache.clearSharedReads()
      this.rpcCache.clearThreadList()
      this.threadTokenUsage.clear()
      this.planModeTurns.clearAll()
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
          pendingRpcCount: this.pending.size,
          pendingServerRequestCount: this.pendingServerRequests.count,
        })
      }

      if (this.process === proc) {
        this.rejectAllPending(failure)
        this.rejectQueuedRpcCalls(failure)
        this.pendingServerRequests.clear()
        this.rpcCache.clearSharedReads()
        this.rpcCache.clearThreadList()
        this.threadTokenUsage.clear()
        this.planModeTurns.clearAll()
        this.process = null
        this.initialized = false
        this.initializePromise = null
        this.stdoutLineBuffer.clear()
      }
    })
  }

  private rejectAllPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeoutId)
      request.reject(error)
    }
    this.pending.clear()
  }

  private rejectQueuedRpcCalls(error: Error): void {
    this.rpcQueue.rejectAll(error)
  }

  private finalizePendingRpc(id: number): PendingRpc | null {
    const pendingRequest = this.pending.get(id) ?? null
    if (!pendingRequest) return null
    this.pending.delete(id)
    clearTimeout(pendingRequest.timeoutId)
    return pendingRequest
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
    const now = Date.now()
    this.rpcDiagnostics.recordTimeout(method, params, timeoutMs, now)

    const processAgeMs = this.startedAtMs > 0 ? now - this.startedAtMs : 0
    if (method !== 'initialize' && processAgeMs < APP_SERVER_COLD_START_GRACE_MS) {
      writeBridgeLog('warn', 'App-server RPC timed out during startup grace', {
        method,
        durationMs: timeoutMs,
        processAgeMs,
        includeTurns: method === 'thread/read' ? asRecord(params)?.includeTurns === true : undefined,
      })
      return
    }

    const { shouldRestart, timeoutCount } = this.rpcDiagnostics.noteRestartableTimeout(method, now)
    if (!shouldRestart) return

    this.restartAppServer('repeated RPC timeouts', {
      method,
      timeoutMs,
      timeoutCount,
      includeTurns: method === 'thread/read' ? asRecord(params)?.includeTurns === true : undefined,
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
      pendingRpcCount: this.pending.size,
      pendingServerRequestCount: this.pendingServerRequests.count,
      ...details,
    })

    this.process = null
    this.initialized = false
    this.initializePromise = null
    this.stdoutLineBuffer.clear()
    this.rejectAllPending(new Error(`codex app-server restarted: ${reason}`))
    this.rejectQueuedRpcCalls(new Error(`codex app-server restarted: ${reason}`))
    this.pendingServerRequests.clear()
    this.rpcCache.clearSharedReads()
    this.rpcCache.clearThreadList()
    this.threadTokenUsage.clear()
    this.planModeTurns.clearAll()

    try {
      proc.stdin.end()
    } catch {}

    try {
      proc.kill('SIGTERM')
    } catch {}

    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch {}
      }
    }, 1500)
    forceKillTimer.unref()
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse
    try {
      message = JSON.parse(line) as JsonRpcResponse
    } catch {
      return
    }

    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const pendingRequest = this.finalizePendingRpc(message.id)
      if (!pendingRequest) return

      this.rpcDiagnostics.logSlowRpc(pendingRequest.method, pendingRequest.startedAtMs, pendingRequest.params, {
        outcome: message.error ? 'error' : 'success',
      })
      if (message.error) {
        pendingRequest.reject(createAppServerJsonRpcError(message.error))
      } else {
        pendingRequest.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string' && typeof message.id !== 'number') {
      const notification = {
        method: message.method,
        params: message.params ?? null,
      }
      this.captureNotificationState(notification)
      this.emitNotification(notification)
      return
    }

    // Handle server-initiated JSON-RPC requests (approvals, dynamic tool calls, etc.).
    if (typeof message.id === 'number' && typeof message.method === 'string') {
      this.handleServerRequest(message.id, message.method, message.params ?? null)
    }
  }

  private emitNotification(notification: { method: string; params: unknown }): void {
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }

  private captureNotificationState(notification: { method: string; params: unknown }): void {
    if (shouldInvalidateThreadListCacheForNotification(notification.method)) {
      this.rpcCache.clearThreadList()
    }

    if (
      notification.method === 'turn/completed' ||
      notification.method === 'thread/completed' ||
      notification.method === 'turn/interrupted' ||
      notification.method === 'thread/interrupted' ||
      notification.method === 'error' ||
      notification.method.endsWith('/failed')
    ) {
      this.clearPlanModeTurnByPayload(notification.params)
    }

    if (notification.method !== 'thread/tokenUsage/updated') return

    this.threadTokenUsage.observeUpdate(notification.params)
  }

  private sendServerRequestReply(requestId: number, reply: ServerRequestReply): void {
    if (reply.error) {
      this.sendLine(createAppServerRpcErrorResponse(requestId, reply.error))
      return
    }

    this.sendLine(createAppServerRpcSuccessResponse(requestId, reply.result ?? {}))
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

  clearPlanModeTurnByPayload(payload: unknown): void {
    const threadId = readThreadIdFromPayload(payload)
    const turnId = readTurnIdFromPayload(payload)
    this.planModeTurns.clearByThreadOrTurn(threadId, turnId)
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
    this.emitNotification({
      method: 'server/request/resolved',
      params: {
        id: requestId,
        method,
        threadId: this.readServerRequestThreadId(params),
        mode,
        resolvedAtIso: new Date().toISOString(),
      },
    })
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

    if (policy.kind === 'plan-decline') {
      this.sendServerRequestReply(requestId, {
        result: policy.result,
      })
      this.emitServerRequestResolved(requestId, method, params, 'automatic')
      return
    }

    if (policy.kind === 'auto-approve') {
      this.sendServerRequestReply(requestId, {
        result: policy.result,
      })
      this.emitServerRequestResolved(requestId, method, params, 'automatic')
      return
    }

    if (policy.kind === 'reject-unsupported') {
      writeBridgeLog('warn', 'Declined unsupported app-server request', {
        requestId,
        method,
        threadId: this.readServerRequestThreadId(params),
        turnId: readTurnIdFromPayload(params),
      })
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
        const timedOutRequest = this.finalizePendingRpc(id)
        if (!timedOutRequest) return
        writeBridgeLog('warn', 'App-server RPC timed out', {
          method,
          durationMs: timeoutMs,
          includeTurns: method === 'thread/read' ? asRecord(params)?.includeTurns === true : undefined,
        })
        this.noteRpcTimeout(method, params, timeoutMs)
        timedOutRequest.reject(createRpcTimeoutError(method, timeoutMs))
      }, timeoutMs)
      timeoutId.unref?.()

      this.pending.set(id, {
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

    if (method === 'thread/list') {
      const cached = this.rpcCache.readThreadList(shareableKey, true)
      if (cached) {
        if (cached.stale) {
          this.rpcCache.refreshThreadListInBackground(shareableKey, params, (rpcMethod, rpcParams) => this.enqueueRpc(rpcMethod, rpcParams))
        }
        return cached.value
      }
    }
    if (method === 'model/list') {
      const cached = this.rpcCache.readModelList(shareableKey, true)
      if (cached) {
        if (cached.stale) {
          this.rpcCache.refreshModelListInBackground(shareableKey, params, (rpcMethod, rpcParams) => this.enqueueRpc(rpcMethod, rpcParams))
        }
        return cached.value
      }
    }

    const existingRequest = this.rpcCache.getSharedRead(shareableKey)
    if (existingRequest) {
      return existingRequest
    }

    const request = this.enqueueRpc(method, params)
      .then((value) => {
        if (method === 'thread/list') {
          this.rpcCache.writeThreadList(shareableKey, value)
        } else if (method === 'model/list') {
          this.rpcCache.writeModelList(shareableKey, value)
        }
        return value
      })
      .finally(() => {
        this.rpcCache.deleteSharedRead(shareableKey)
      })
    this.rpcCache.setSharedRead(shareableKey, request)
    return request
  }

  async warmup(): Promise<void> {
    await this.ensureInitialized()
  }

  onNotification(listener: (value: { method: string; params: unknown }) => void): () => void {
    this.notificationListeners.add(listener)
    return () => {
      this.notificationListeners.delete(listener)
    }
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
      pendingRpcCount: this.pending.size,
      queuedRpcCount: this.rpcQueue.count,
      pendingServerRequestCount: this.pendingServerRequests.count,
      activePlanModeTurnCount: this.planModeTurns.count,
      launchPolicy: createAppServerLaunchPolicySnapshot(this.appServerLaunchPolicy),
      rpcDiagnostics: this.rpcDiagnostics.snapshot(this.pending.size, this.rpcQueue.count),
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

    this.rejectAllPending(failure)
    this.pendingServerRequests.clear()
    this.rpcCache.clearSharedReads()
    this.rpcCache.clearThreadList()
    this.threadTokenUsage.clear()
    this.planModeTurns.clearAll()

    try {
      proc.stdin.end()
    } catch {
      // ignore close errors on shutdown
    }

    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore kill errors on shutdown
    }

    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore kill errors on shutdown
        }
      }
    }, 1500)
    forceKillTimer.unref()
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

type BridgeNotificationEvent = {
  method: string
  params: unknown
  atIso: string
  seq: number
}

type SharedBridgeState = {
  appServer: AppServerProcess
  methodCatalog: AppServerMethodCatalog
}

const SHARED_BRIDGE_KEY = '__codexRemoteSharedBridge__'
const NOTIFICATION_REPLAY_BUFFER_LIMIT = 500

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
  const paramsRecord = asRecord(params)
  if (paramsRecord?.archived !== true) return result
  if (typeof paramsRecord?.cursor === 'string' && paramsRecord.cursor.length > 0) return result

  const resultRecord = asRecord(result)
  const data = Array.isArray(resultRecord?.data) ? resultRecord.data : null
  if (!data) return result

  const pinnedThreadIds = await readMergedPinnedThreadIds()
  if (pinnedThreadIds.length === 0) return result

  const existingThreadIds = new Set<string>()
  for (const row of data) {
    const record = asRecord(row)
    const id = typeof record?.id === 'string' ? record.id : ''
    if (id) existingThreadIds.add(id)
  }

  const supplementalThreads = await loadThreadSummariesById(appServer, pinnedThreadIds, existingThreadIds)
  if (supplementalThreads.length === 0) return result

  return {
    ...resultRecord,
    data: [...data, ...supplementalThreads],
  }
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const { appServer, methodCatalog } = getSharedBridgeState()
  const threadSearchIndexStore = new ThreadSearchIndexStore(async () => buildThreadSearchIndex(
    (params) => appServer.rpc('thread/list', params),
    await readThreadTitlesFromSessionIndex(getCodexSessionIndexPath()),
  ))
  const cachedThreadReadsByThreadId = new Map<string, CachedThreadRead>()
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
  const notificationReplayBuffer: BridgeNotificationEvent[] = []
  const bridgeNotificationListeners = new Set<(value: BridgeNotificationEvent) => void>()
  let notificationSeq = runtimeStore.getLatestEventSeq()

  function rememberCachedThreadRead(threadId: string, threadRead: unknown): CachedThreadRead {
    const cachedThreadRead: CachedThreadRead = {
      threadRead,
      inProgress: readThreadInProgressFromThreadReadPayload(threadRead),
      activeTurnId: readActiveTurnIdFromThreadReadPayload(threadRead),
      updatedAtIso: readThreadUpdatedAtIsoFromThreadReadPayload(threadRead),
      sessionPath: readThreadSessionPathFromThreadReadPayload(threadRead),
      cachedAtIso: new Date().toISOString(),
    }
    cachedThreadReadsByThreadId.set(threadId, cachedThreadRead)
    return cachedThreadRead
  }

  function persistRuntimeSnapshot(threadId: string, snapshot?: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot {
    const nextSnapshot = snapshot ?? runtimeStateStore.snapshot(threadId, {
      pendingServerRequests: appServer.listPendingServerRequestsForThread(threadId),
      tokenUsage: appServer.getThreadTokenUsage(threadId),
    })
    runtimeStore.upsertSnapshot({
      threadId,
      executionState: nextSnapshot.executionState,
      activeTurnId: nextSnapshot.activeTurnId,
      activeItemId: nextSnapshot.activeItemId,
      canStop: nextSnapshot.canStop,
      stopRequested: nextSnapshot.stopRequested,
      lastEventSeq: nextSnapshot.lastEventSeq,
      updatedAtIso: nextSnapshot.updatedAtIso,
      snapshot: toPersistableRuntimeSnapshot(nextSnapshot),
    })
    return nextSnapshot
  }

  function rememberNotificationEvent(notification: { method: string; params: unknown }): BridgeNotificationEvent {
    notificationSeq += 1
    const threadId = readThreadIdFromPayload(notification.params)
    const turnId = readTurnIdFromPayload(notification.params)
    const event: BridgeNotificationEvent = {
      method: notification.method,
      params: notification.params,
      atIso: new Date().toISOString(),
      seq: notificationSeq,
    }
    notificationDiagnostics.observe({
      method: event.method,
      atIso: event.atIso,
      threadId,
      turnId,
    })
    runtimeStore.appendEvent({
      seq: event.seq,
      method: event.method,
      params: event.params,
      atIso: event.atIso,
      threadId,
      turnId,
    })
    notificationReplayBuffer.push(event)
    if (notificationReplayBuffer.length > NOTIFICATION_REPLAY_BUFFER_LIMIT) {
      notificationReplayBuffer.splice(0, notificationReplayBuffer.length - NOTIFICATION_REPLAY_BUFFER_LIMIT)
    }
    return event
  }

  function listNotificationEventsAfter(afterSeq: number, limit = 200): {
    notifications: BridgeNotificationEvent[]
    latestSeq: number
    oldestSeq: number
  } {
    const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.trunc(afterSeq)) : 0
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), NOTIFICATION_REPLAY_BUFFER_LIMIT)) : 200
    const persistedReplay = runtimeStore.listEventsAfter(normalizedAfterSeq, normalizedLimit)
    if (persistedReplay.notifications.length > 0 || normalizedAfterSeq < persistedReplay.latestSeq) {
      return {
        notifications: persistedReplay.notifications.map(normalizeRuntimeEventForReplay),
        latestSeq: persistedReplay.latestSeq,
        oldestSeq: persistedReplay.oldestSeq,
      }
    }
    return {
      notifications: notificationReplayBuffer
        .filter((notification) => notification.seq > normalizedAfterSeq)
        .slice(0, normalizedLimit),
      latestSeq: notificationSeq,
      oldestSeq: notificationReplayBuffer[0]?.seq ?? notificationSeq,
    }
  }

  const unsubscribeAppServerNotifications = appServer.onNotification((notification: { method: string; params: unknown }) => {
    const event = rememberNotificationEvent(notification)
    runtimeStateStore.observeEvent(event)
    const eventThreadId = readThreadIdFromPayload(notification.params)
    if (eventThreadId) {
      const snapshot = persistRuntimeSnapshot(eventThreadId)
      updateRuntimeRequestsFromSnapshot(eventThreadId, snapshot)
    }
    if (shouldInvalidateThreadReadCacheForNotification(notification.method)) {
      if (eventThreadId) {
        cachedThreadReadsByThreadId.delete(eventThreadId)
      }
    }
    for (const listener of bridgeNotificationListeners) {
      listener(event)
    }
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
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) {
      throw new Error('Missing thread id')
    }

    const cachedThreadRead = cachedThreadReadsByThreadId.get(normalizedThreadId) ?? null
    let lightThreadRead: unknown = null
    try {
      lightThreadRead = await appServer.rpc('thread/read', {
        threadId: normalizedThreadId,
        includeTurns: false,
      })
      statusDiagnostics.observeThreadRead({
        threadId: normalizedThreadId,
        payload: lightThreadRead,
      })
    } catch (error) {
      if (!isThreadMaterializingError(error) && !isRpcTimeoutError(error)) {
        throw error
      }
      writeBridgeLog('warn', 'Light thread snapshot unavailable', {
        threadId: normalizedThreadId,
        error: getErrorMessage(error, 'Light thread snapshot failed'),
      })
    }

    const lightUpdatedAtIso = lightThreadRead ? readThreadUpdatedAtIsoFromThreadReadPayload(lightThreadRead) : ''
    const lightInProgress = lightThreadRead ? readThreadInProgressFromThreadReadPayload(lightThreadRead) : false
    const runtimeSnapshotBeforeMessageRead = runtimeStateStore.snapshot(normalizedThreadId, {
      pendingServerRequests: appServer.listPendingServerRequestsForThread(normalizedThreadId),
      tokenUsage: appServer.getThreadTokenUsage(normalizedThreadId),
    })
    let threadRead: unknown = null
    let messageState: ThreadRuntimeSnapshot['messageState'] = 'unavailable'

    if (
      cachedThreadRead &&
      lightUpdatedAtIso &&
      cachedThreadRead.updatedAtIso === lightUpdatedAtIso &&
      !isCachedThreadReadStaleForRuntime(cachedThreadRead, runtimeSnapshotBeforeMessageRead, lightInProgress)
    ) {
      threadRead = cachedThreadRead.threadRead
      messageState = 'fresh'
    } else {
      try {
        const rawThreadRead = await appServer.rpc('thread/read', {
          threadId: normalizedThreadId,
          includeTurns: true,
        })
        threadRead = trimThreadTurnsInRpcResult('thread/read', rawThreadRead)
        statusDiagnostics.observeThreadRead({
          threadId: normalizedThreadId,
          payload: threadRead,
        })
        rememberCachedThreadRead(normalizedThreadId, threadRead)
        messageState = 'fresh'
      } catch (error) {
        if (!isThreadMaterializingError(error) && !isRpcTimeoutError(error)) {
          throw error
        }
        if (cachedThreadRead) {
          threadRead = cachedThreadRead.threadRead
          messageState = 'cached'
          writeBridgeLog('warn', 'Heavy thread snapshot fell back to cached messages', {
            threadId: normalizedThreadId,
            lightUpdatedAtIso,
            cachedUpdatedAtIso: cachedThreadRead.updatedAtIso,
            error: getErrorMessage(error, 'Heavy thread snapshot failed'),
          })
        } else {
          writeBridgeLog('warn', 'Heavy thread snapshot unavailable with no cache', {
            threadId: normalizedThreadId,
            lightUpdatedAtIso,
            error: getErrorMessage(error, 'Heavy thread snapshot failed'),
          })
        }
      }
    }

    const sessionPath =
      (lightThreadRead ? readThreadSessionPathFromThreadReadPayload(lightThreadRead) : '')
      || (threadRead ? readThreadSessionPathFromThreadReadPayload(threadRead) : '')
      || cachedThreadRead?.sessionPath
      || ''
    const tokenUsage = appServer.getThreadTokenUsage(normalizedThreadId)
      ?? (threadRead ? readThreadTokenUsageFromThreadReadPayload(threadRead) : null)
      ?? (lightThreadRead ? readThreadTokenUsageFromThreadReadPayload(lightThreadRead) : null)

    const updatedAtIso =
      messageState === 'cached'
        ? (cachedThreadRead?.updatedAtIso ?? lightUpdatedAtIso)
        : lightThreadRead
          ? readThreadUpdatedAtIsoFromThreadReadPayload(lightThreadRead)
          : threadRead
            ? readThreadUpdatedAtIsoFromThreadReadPayload(threadRead)
            : ''
    const freshThreadInProgress =
      threadRead && messageState === 'fresh'
        ? readThreadInProgressFromThreadReadPayload(threadRead)
        : false
    const inProgress =
      lightInProgress
      || freshThreadInProgress
      || (!lightThreadRead && messageState === 'cached' ? (cachedThreadRead?.inProgress ?? false) : false)
    const activeTurnId =
      (lightThreadRead ? readActiveTurnIdFromThreadReadPayload(lightThreadRead) : '')
      || (threadRead && messageState === 'fresh' ? readActiveTurnIdFromThreadReadPayload(threadRead) : '')
      || (!lightThreadRead && messageState === 'cached' ? (cachedThreadRead?.activeTurnId ?? '') : '')

    if (lightThreadRead || threadRead || cachedThreadRead) {
      runtimeStateStore.observeThreadRead(
        normalizedThreadId,
        inProgress,
        activeTurnId,
        updatedAtIso,
        messageState === 'cached' ? 'cache' : 'thread-read',
      )
    } else {
      runtimeStateStore.markDegraded(normalizedThreadId, 'thread snapshot unavailable')
    }

    return persistRuntimeSnapshot(normalizedThreadId, runtimeStateStore.snapshot(normalizedThreadId, {
      threadRead,
      messageState,
      pendingServerRequests: appServer.listPendingServerRequestsForThread(normalizedThreadId),
      tokenUsage,
    }))
  }

  function readLocalRuntimeSnapshot(threadId: string): ThreadRuntimeSnapshot {
    const normalizedThreadId = threadId.trim()
    const persisted = runtimeStore.getSnapshot(normalizedThreadId)
    const persistedSnapshot = asRecord(persisted?.snapshot) as ThreadRuntimeSnapshot | null
    const pendingServerRequests = appServer.listPendingServerRequestsForThread(normalizedThreadId)
    const tokenUsage = appServer.getThreadTokenUsage(normalizedThreadId)
    if (persistedSnapshot) {
      const persistedLastAtMs =
        readIsoTimestampMs(persistedSnapshot.lastEventAtIso) ||
        readIsoTimestampMs(persistedSnapshot.updatedAtIso)
      const persistedStale =
        pendingServerRequests.length === 0 &&
        isRuntimeActiveState(persistedSnapshot.executionState) &&
        persistedLastAtMs > 0 &&
        (
          Date.now() - persistedLastAtMs > RUNTIME_SNAPSHOT_STALE_MS ||
          appServer.getStartedAtMs() > persistedLastAtMs
        )
      const executionState: RuntimeExecutionState = persistedStale ? 'sync_degraded' : persistedSnapshot.executionState
      return {
        ...persistedSnapshot,
        executionState,
        pendingServerRequests,
        tokenUsage,
        threadRead: null,
        messageState: 'unavailable',
        inProgress: isRuntimeActiveState(executionState),
        canStop: persistedSnapshot.canStop === true && !persistedSnapshot.stale && !persistedStale,
        stale: persistedSnapshot.stale === true || persistedStale,
        degradedReason: persistedStale
          ? appServer.getStartedAtMs() > persistedLastAtMs
            ? 'app-server restarted after active runtime snapshot'
            : 'persisted runtime snapshot is stale'
          : persistedSnapshot.degradedReason,
      }
    }
    return persistRuntimeSnapshot(normalizedThreadId, runtimeStateStore.snapshot(normalizedThreadId, {
      pendingServerRequests,
      tokenUsage,
    }))
  }

  function updateRuntimeRequestsFromSnapshot(threadId: string, snapshot: ThreadRuntimeSnapshot): void {
    const activeRequests = runtimeStore.listRequestsByThread(threadId, [
      'pending_start',
      'start_uncertain',
      'running',
      'stopping',
      'stop_uncertain',
      'still_running',
    ])
    if (activeRequests.length === 0) return

    for (const request of activeRequests) {
      const nextStatus =
        snapshot.inProgress && (request.status === 'stopping' || request.status === 'stop_uncertain')
          ? 'still_running'
          : readRuntimeRequestStatusFromExecutionState(snapshot.executionState)
      runtimeStore.updateRequest(request.requestId, {
        status: nextStatus,
        threadId,
        turnId: snapshot.activeTurnId || request.turnId,
        lastError: snapshot.lastError,
      })
    }
  }

  async function reconcileRuntimeThread(threadId: string): Promise<ThreadRuntimeSnapshot> {
    const snapshot = await readThreadRuntimeSnapshot(threadId)
    updateRuntimeRequestsFromSnapshot(threadId, snapshot)
    return snapshot
  }

  async function startRuntimeTurn(payload: unknown): Promise<{
    request: RuntimeRequestRecord
    threadId: string
    turnId: string
    status: RuntimeRequestStatus
  }> {
    const body = asRecord(payload)
    if (!body) throw new Error('Invalid body: expected runtime send payload')

    const requestId = readString(body.requestId).trim() || createRuntimeRequestId()
    const clientMessageId = readString(body.clientMessageId).trim()
    const mode = readCollaborationModeFromPayload(body)
    const model = readString(body.model).trim()
    const cwd = readString(body.cwd).trim()
    let threadId = readStringByAliases(body, 'threadId', 'thread_id')
    const turnOptions = readRuntimeTurnOptions(body.turnOptions)
    const input = applyRuntimeTurnOptionsToInput(Array.isArray(body.input) ? body.input : [], turnOptions)
    if (input.length === 0) {
      throw new Error('runtime/send requires input')
    }

    runtimeStore.createRequest({
      requestId,
      clientMessageId,
      threadId,
      status: 'pending_start',
      promptHash: createRuntimePromptHash(input),
      mode,
      payload: buildRuntimeRequestPayloadSummary({
        threadId,
        cwd,
        model,
        collaborationMode: mode,
        input,
        effort: body.effort,
        attachments: body.attachments,
        turnOptions,
      }),
    })

    try {
      if (!threadId) {
        const threadParams: Record<string, unknown> = {}
        if (cwd) threadParams.cwd = cwd
        if (model) threadParams.model = model
        const startedThread = await appServer.rpc('thread/start', threadParams)
        threadId = readThreadIdFromPayload(startedThread)
        if (!threadId) throw new Error('thread/start did not return a thread id')
        threadSearchIndexStore.clear()
        runtimeStore.updateRequest(requestId, {
          threadId,
          status: 'pending_start',
        })
      }

      const turnParams: Record<string, unknown> = {
        threadId,
        input,
      }
      if (Array.isArray(body.attachments) && body.attachments.length > 0) {
        turnParams.attachments = body.attachments
      }
      if (model) turnParams.model = model
      const effort = readString(body.effort).trim()
      if (effort) turnParams.effort = effort
      if (mode === 'plan') turnParams.collaborationMode = 'plan'

      runtimeStateStore.markStarting(threadId)
      persistRuntimeSnapshot(threadId)
      runtimeStore.updateRequest(requestId, {
        status: 'starting',
        threadId,
      })

      let rpcParams: unknown = mode === 'plan'
        ? normalizePlanModeTurnStartParams(turnParams, { includeNativeMode: true })
        : turnParams
      let rpcResult: unknown
      try {
        rpcResult = await appServer.rpc('turn/start', rpcParams)
      } catch (error) {
        if (mode !== 'plan' || !shouldRetryPlanModeWithoutNativeMode(error)) {
          throw error
        }
        rpcParams = normalizePlanModeTurnStartParams(turnParams, { includeNativeMode: false })
        rpcResult = await appServer.rpc('turn/start', rpcParams)
      }

      const turnId = readTurnIdFromPayload(rpcResult)
      if (mode === 'plan') {
        appServer.markPlanModeTurn(threadId, turnId)
      }
      runtimeStateStore.markRunning(threadId, turnId)
      const snapshot = persistRuntimeSnapshot(threadId)
      const request = runtimeStore.updateRequest(requestId, {
        status: 'running',
        threadId,
        turnId: turnId || snapshot.activeTurnId,
        lastError: null,
      }) ?? runtimeStore.getRequest(requestId)
      return {
        request: request as RuntimeRequestRecord,
        threadId,
        turnId: turnId || snapshot.activeTurnId,
        status: 'running',
      }
    } catch (error) {
      if (threadId && isRpcTimeoutError(error)) {
        runtimeStateStore.markStartUncertain(threadId, getErrorMessage(error, 'turn/start timed out'))
        persistRuntimeSnapshot(threadId)
        const request = runtimeStore.updateRequest(requestId, {
          status: 'start_uncertain',
          threadId,
          lastError: getErrorMessage(error, 'turn/start timed out'),
        }) ?? runtimeStore.getRequest(requestId)
        return {
          request: request as RuntimeRequestRecord,
          threadId,
          turnId: '',
          status: 'start_uncertain',
        }
      }

      runtimeStore.updateRequest(requestId, {
        status: 'failed',
        threadId,
        lastError: getErrorMessage(error, 'runtime send failed'),
      })
      throw error
    }
  }

  async function interruptRuntimeTurn(payload: unknown): Promise<{
    requestId: string
    threadId: string
    turnId: string
    status: RuntimeRequestStatus
  }> {
    const body = asRecord(payload)
    if (!body) throw new Error('Invalid body: expected runtime interrupt payload')

    const threadId = readStringByAliases(body, 'threadId', 'thread_id')
    const turnId = readStringByAliases(body, 'turnId', 'turn_id', 'activeTurnId')
    if (!threadId) throw new Error('runtime/interrupt requires threadId')
    if (!turnId) throw new Error('runtime/interrupt requires turnId')

    const requestId = readString(body.requestId).trim() || createRuntimeRequestId()
    const source = readString(body.source).trim() || 'unknown'
    const requestedAtIso = readString(body.requestedAtIso).trim()
    const userAgent = readString(body.userAgent).trim()
    const clientElapsedMs = typeof body.clientElapsedMs === 'number' && Number.isFinite(body.clientElapsedMs)
      ? Math.max(0, Math.round(body.clientElapsedMs))
      : null
    runtimeStore.createRequest({
      requestId,
      threadId,
      turnId,
      status: 'stopping',
      mode: 'interrupt',
      payload: {
        threadId,
        turnId,
        source,
        requestedAtIso,
        clientElapsedMs,
        userAgent: userAgent.slice(0, 240),
      },
    })
    runtimeStateStore.markStopping(threadId)
    persistRuntimeSnapshot(threadId)

    try {
      await appServer.rpc('turn/interrupt', { threadId, turnId })
      appServer.clearPlanModeTurn(threadId, turnId)
      runtimeStateStore.markInterrupted(threadId)
      persistRuntimeSnapshot(threadId)
      runtimeStore.updateRequest(requestId, {
        status: 'stopped',
        threadId,
        turnId,
        lastError: null,
      })
      return { requestId, threadId, turnId, status: 'stopped' }
    } catch (error) {
      if (isInterruptSettledError(error)) {
        appServer.clearPlanModeTurn(threadId, turnId)
        runtimeStateStore.markInterrupted(threadId, getErrorMessage(error, 'turn already settled'))
        persistRuntimeSnapshot(threadId)
        runtimeStore.updateRequest(requestId, {
          status: 'stopped',
          threadId,
          turnId,
          lastError: null,
        })
        return { requestId, threadId, turnId, status: 'stopped' }
      }

      if (isRpcTimeoutError(error)) {
        runtimeStateStore.markStopUncertain(threadId, getErrorMessage(error, 'turn/interrupt timed out'))
        persistRuntimeSnapshot(threadId)
        runtimeStore.updateRequest(requestId, {
          status: 'stop_uncertain',
          threadId,
          turnId,
          lastError: getErrorMessage(error, 'turn/interrupt timed out'),
        })
        return { requestId, threadId, turnId, status: 'stop_uncertain' }
      }

      runtimeStore.updateRequest(requestId, {
        status: 'failed',
        threadId,
        turnId,
        lastError: getErrorMessage(error, 'runtime interrupt failed'),
      })
      throw error
    }
  }

  let runtimeReconcileInFlight = false
  const runtimeReconcileLastAtMsByThreadId = new Map<string, number>()
  const runtimeReconcileTimer = setInterval(() => {
    if (runtimeReconcileInFlight) return
    const now = Date.now()
    const candidates = runtimeStore
      .listUncertainRequests(10)
      .filter((request) => {
        if (!request.threadId) return false
        if (request.status !== 'running' && request.status !== 'still_running') return true
        const lastAtMs = runtimeReconcileLastAtMsByThreadId.get(request.threadId) ?? 0
        return now - lastAtMs >= 10_000
      })
      .slice(0, 3)
    if (candidates.length === 0) return

    runtimeReconcileInFlight = true
    void (async () => {
      for (const request of candidates) {
        try {
          await reconcileRuntimeThread(request.threadId)
          runtimeReconcileLastAtMsByThreadId.set(request.threadId, Date.now())
        } catch (error) {
          runtimeStore.updateRequest(request.requestId, {
            status: request.status === 'stopping' ? 'stop_uncertain' : request.status,
            lastError: getErrorMessage(error, 'runtime reconcile failed'),
            incrementRetry: true,
          })
          writeBridgeLog('warn', 'Runtime reconcile failed', {
            threadId: request.threadId,
            requestId: request.requestId,
            status: request.status,
            error: getErrorMessage(error, 'runtime reconcile failed'),
          })
        }
      }
    })().finally(() => {
      runtimeReconcileInFlight = false
    })
  }, 2000)
  runtimeReconcileTimer.unref?.()

  async function readCachedThreadTokenUsage(threadId: string): Promise<ThreadTokenUsage | null> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null

    const cachedTokenUsage = appServer.getThreadTokenUsage(normalizedThreadId)
    if (cachedTokenUsage) return cachedTokenUsage

    const cachedThreadRead = cachedThreadReadsByThreadId.get(normalizedThreadId) ?? null
    const cachedPayloadTokenUsage = cachedThreadRead
      ? readThreadTokenUsageFromThreadReadPayload(cachedThreadRead.threadRead)
      : null
    if (cachedPayloadTokenUsage) return cachedPayloadTokenUsage

    const sessionPath = cachedThreadRead?.sessionPath?.trim() ?? ''
    if (!sessionPath) return null

    return await readThreadTokenUsageFromSessionLog(sessionPath)
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

      if (req.method === 'POST' && url.pathname === '/codex-api/upload-file') {
        try {
          const result = await handleMultipartFileUpload(req)
          setJson(res, 200, result)
        } catch (error) {
          const statusCode = error instanceof FileUploadError ? error.statusCode : 500
          setJson(res, statusCode, { error: getErrorMessage(error, 'Upload failed') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/web-settings') {
        const settings = await readWebBridgeSettings(getWebBridgeSettingsPath())
        appServer.setWebBridgeSettings(settings)
        setJson(res, 200, { data: settings })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/web-settings') {
        const payload = await readJsonBody(req)
        const settings = await writeWebBridgeSettings(getWebBridgeSettingsPath(), payload)
        appServer.setWebBridgeSettings(settings)
        setJson(res, 200, { data: settings })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/favorites') {
        const favorites = await readFavoriteRecords()
        setJson(res, 200, { data: favorites })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/favorites') {
        const payload = await readJsonBody(req)
        const record =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {}
        const favorites = await writeFavoriteRecords(Array.isArray(record.favorites) ? record.favorites as never[] : [])
        setJson(res, 200, { data: favorites })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/pinned-threads') {
        const pinnedThreadIds = await readMergedPinnedThreadIds()
        setJson(res, 200, { data: pinnedThreadIds })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/pinned-threads') {
        const payload = await readJsonBody(req)
        const record =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {}
        const pinnedThreadIds = await writeMergedPinnedThreadIds(
          Array.isArray(record.pinnedThreadIds) ? record.pinnedThreadIds as never[] : [],
        )
        setJson(res, 200, { data: pinnedThreadIds })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/rpc') {
        const payload = await readJsonBody(req)
        const body = asRecord(payload) as RpcProxyRequest | null

        if (!body || typeof body.method !== 'string' || body.method.length === 0) {
          setJson(res, 400, { error: 'Invalid body: expected { method, params? }' })
          return
        }

        const collaborationMode = body.method === 'turn/start'
          ? readCollaborationModeFromPayload(body.params)
          : 'execute'
        const rpcParams = body.method === 'turn/start'
          ? normalizePlanModeTurnStartParams(body.params, { includeNativeMode: true })
          : body.params
        const rpcThreadId = readThreadIdFromPayload(rpcParams)
        if (rpcThreadId && shouldInvalidateThreadReadCacheForRpc(body.method)) {
          cachedThreadReadsByThreadId.delete(rpcThreadId)
        }
        if (body.method === 'turn/start' && rpcThreadId) {
          const initialTurnId = readTurnIdFromPayload(rpcParams)
          runtimeStateStore.markStarting(rpcThreadId, initialTurnId)
          persistRuntimeSnapshot(rpcThreadId)
          if (collaborationMode === 'plan') {
            appServer.markPlanModeTurn(rpcThreadId, initialTurnId)
          }
        } else if (body.method === 'turn/interrupt' && rpcThreadId) {
          runtimeStateStore.markStopping(rpcThreadId)
          persistRuntimeSnapshot(rpcThreadId)
        } else if (body.method === 'thread/resume' && rpcThreadId) {
          runtimeStateStore.markQueued(rpcThreadId)
          persistRuntimeSnapshot(rpcThreadId)
        }

        let rpcResult: unknown
        try {
          try {
            rpcResult = await appServer.rpc(body.method, rpcParams ?? null)
          } catch (error) {
            if (body.method !== 'turn/start' || collaborationMode !== 'plan' || !shouldRetryPlanModeWithoutNativeMode(error)) {
              throw error
            }
            const fallbackParams = normalizePlanModeTurnStartParams(body.params, { includeNativeMode: false })
            rpcResult = await appServer.rpc(body.method, fallbackParams ?? null)
          }
          if (body.method === 'turn/start' && rpcThreadId) {
            const startedTurnId = readTurnIdFromPayload(rpcResult)
            runtimeStateStore.markRunning(rpcThreadId, startedTurnId)
            persistRuntimeSnapshot(rpcThreadId)
            if (collaborationMode === 'plan' && startedTurnId) {
              appServer.markPlanModeTurn(rpcThreadId, startedTurnId)
            }
          } else if (body.method === 'turn/interrupt' && rpcThreadId) {
            appServer.clearPlanModeTurn(rpcThreadId, readTurnIdFromPayload(rpcParams))
          }
        } catch (error) {
          if (body.method === 'turn/interrupt' && rpcThreadId && isInterruptSettledError(error)) {
            appServer.clearPlanModeTurn(rpcThreadId, readTurnIdFromPayload(rpcParams))
            runtimeStateStore.markInterrupted(rpcThreadId)
            persistRuntimeSnapshot(rpcThreadId)
            setJson(res, 200, {
              result: null,
              warning: isRpcTimeoutError(error)
                ? 'turn/interrupt timed out; runtime state was settled locally'
                : 'turn/interrupt did not find an active turn; runtime state was settled locally',
            })
            return
          }
          if (
            (body.method === 'thread/resume' || body.method === 'thread/archive')
            && isThreadMaterializingError(error)
          ) {
            setJson(res, 200, { result: null })
            return
          }
          throw error
        }
        const enrichedRpcResult = body.method === 'thread/list'
          ? await augmentThreadListRpcResult(appServer, rpcParams, rpcResult)
          : rpcResult
        const result = trimThreadTurnsInRpcResult(body.method, enrichedRpcResult)
        if (shouldInvalidateThreadListCacheForRpc(body.method)) {
          threadSearchIndexStore.clear()
        }
        if (
          body.method === 'thread/read' &&
          rpcThreadId &&
          asRecord(rpcParams)?.includeTurns === true
        ) {
          rememberCachedThreadRead(rpcThreadId, result)
        }
        setJson(res, 200, { result })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/runtime/send') {
        const payload = await readJsonBody(req)
        const result = await startRuntimeTurn(payload)
        setJson(res, result.status === 'start_uncertain' ? 202 : 200, { data: result })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/runtime/request') {
        const clientMessageId = url.searchParams.get('clientMessageId')?.trim() ?? ''
        if (!clientMessageId) {
          setJson(res, 400, { error: 'Missing clientMessageId' })
          return
        }
        const request = runtimeStore.getLatestRequestByClientMessageId(clientMessageId)
        if (!request) {
          setJson(res, 404, { data: null })
          return
        }
        setJson(res, 200, { data: request })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/runtime/interrupt') {
        const payload = await readJsonBody(req)
        const result = await interruptRuntimeTurn(payload)
        setJson(res, result.status === 'stop_uncertain' ? 202 : 200, { data: result })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/transcribe') {
        let rawBody: Buffer
        try {
          rawBody = await readRawBody(req, { maxBytes: getTranscribeRequestBodyLimitBytes() })
        } catch (err) {
          if (err instanceof RequestBodyTooLargeError) {
            setJson(res, 413, { error: `Transcription upload is too large. Maximum request size is ${err.maxBytes} bytes.` })
            return
          }
          throw err
        }
        const incomingCt = readHeaderValue(req.headers['content-type'], 'application/octet-stream')
        const openAiApiKey = getOpenAiTranscribeApiKey()
        let upstream: TranscriptionProxyResult
        if (openAiApiKey) {
          upstream = await proxyOpenAiTranscribe(rawBody, incomingCt, openAiApiKey)
        } else {
          const auth = await readCodexAuth()
          if (!auth) {
            setJson(res, 401, { error: 'No auth token available for transcription' })
            return
          }
          upstream = await proxyChatGptTranscribe(rawBody, incomingCt, auth.accessToken, auth.accountId)
        }

        res.statusCode = upstream.status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(upstream.body)
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/server-requests/respond') {
        const payload = await readJsonBody(req)
        await appServer.respondToServerRequest(payload)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending') {
        setJson(res, 200, { data: appServer.listPendingServerRequests() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending/diagnostics') {
        setJson(res, 200, {
          data: createServerRequestDiagnosticsSnapshot(appServer.listPendingServerRequests()),
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/events/replay') {
        const afterSeq = Number.parseInt((url.searchParams.get('after') ?? '0').trim(), 10)
        const limit = Number.parseInt((url.searchParams.get('limit') ?? '200').trim(), 10)
        setJson(res, 200, { data: middleware.listNotificationEventsAfter(afterSeq, limit) })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/runtime/events') {
        const afterSeq = Number.parseInt((url.searchParams.get('afterSeq') ?? url.searchParams.get('after') ?? '0').trim(), 10)
        const limit = Number.parseInt((url.searchParams.get('limit') ?? '200').trim(), 10)
        setJson(res, 200, { data: middleware.listNotificationEventsAfter(afterSeq, limit) })
        return
      }

      if (url.pathname.startsWith('/codex-api/runtime/thread/')) {
        const suffix = url.pathname.slice('/codex-api/runtime/thread/'.length)
        const isReconcile = suffix.endsWith('/reconcile')
        const encodedThreadId = isReconcile ? suffix.slice(0, -'/reconcile'.length) : suffix
        const threadId = decodeURIComponent(encodedThreadId).trim()
        if (!threadId) {
          setJson(res, 400, { error: 'Missing threadId' })
          return
        }
        if (req.method === 'POST' && isReconcile) {
          const snapshot = await reconcileRuntimeThread(threadId)
          setJson(res, 200, {
            data: {
              snapshot,
              requests: runtimeStore.listRequestsByThread(threadId, [
                'pending_start',
                'start_uncertain',
                'running',
                'stopping',
                'stop_uncertain',
                'still_running',
              ]),
            },
          })
          return
        }
        if (req.method === 'GET' && !isReconcile) {
          setJson(res, 200, {
            data: {
              snapshot: readLocalRuntimeSnapshot(threadId),
              requests: runtimeStore.listRequestsByThread(threadId, [
                'pending_start',
                'start_uncertain',
                'running',
                'stopping',
                'stop_uncertain',
                'still_running',
              ]),
            },
          })
          return
        }
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/runtime/snapshot') {
        const threadId = (url.searchParams.get('threadId') ?? '').trim()
        if (!threadId) {
          setJson(res, 400, { error: 'Missing threadId' })
          return
        }
        const snapshot = persistRuntimeSnapshot(threadId, runtimeStateStore.snapshot(threadId, {
          pendingServerRequests: appServer.listPendingServerRequestsForThread(threadId),
          tokenUsage: appServer.getThreadTokenUsage(threadId),
        }))
        setJson(res, 200, { data: snapshot })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/runtime/snapshots') {
        const threadIds = (url.searchParams.get('threadIds') ?? '')
          .split(',')
          .map((threadId) => threadId.trim())
          .filter((threadId) => threadId.length > 0)
          .slice(0, 100)
        const overlays = new Map<string, RuntimeSnapshotOverlay>()
        for (const threadId of threadIds) {
          overlays.set(threadId, {
            pendingServerRequests: appServer.listPendingServerRequestsForThread(threadId),
            tokenUsage: appServer.getThreadTokenUsage(threadId),
          })
        }
        setJson(res, 200, { data: runtimeStateStore.snapshots(threadIds, overlays) })
        return
      }

      if (req.method === 'GET' && url.pathname.startsWith('/codex-api/state/thread/')) {
        const encodedThreadId = url.pathname.slice('/codex-api/state/thread/'.length)
        const threadId = decodeURIComponent(encodedThreadId).trim()
        if (!threadId) {
          setJson(res, 400, { error: 'Missing thread id' })
          return
        }

        const snapshot = await readThreadRuntimeSnapshot(threadId)
        setJson(res, 200, { data: snapshot })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-token-usage') {
        const threadId = (url.searchParams.get('threadId') ?? '').trim()
        if (!threadId) {
          setJson(res, 400, { error: 'Missing threadId' })
          return
        }
        const tokenUsage = await readCachedThreadTokenUsage(threadId)
        setJson(res, 200, { data: { tokenUsage } })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/health') {
        const schemaAudit = await readAppServerSchemaAuditSummary()
        const serverRequestDiagnostics = createServerRequestDiagnosticsSnapshot(appServer.listPendingServerRequests())
        setJson(res, 200, {
          status: 'ok',
          data: {
            appServer: appServer.getStatus(),
            notificationDiagnostics: notificationDiagnostics.snapshot(),
            statusDiagnostics: statusDiagnostics.snapshot(),
            serverRequestDiagnostics,
            schemaAudit,
            transcription: getTranscriptionProxyConfigSnapshot(),
            runtimeStore: runtimeStore.getHealth(),
            timestamp: new Date().toISOString(),
          },
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/diagnostics') {
        const runtimeHealth = runtimeStore.getHealth()
        const schemaAudit = await readAppServerSchemaAuditSummary()
        const serverRequestDiagnostics = createServerRequestDiagnosticsSnapshot(appServer.listPendingServerRequests())
        const recentEvents = runtimeStore
          .listEventsAfter(Math.max(0, runtimeHealth.latestSeq - 20), 20)
          .notifications
          .slice(-10)
          .map((event) => ({
            seq: event.seq,
            method: event.method,
            atIso: event.atIso,
            threadId: event.threadId,
            turnId: event.turnId,
          }))
        const uncertainRequests = runtimeStore.listUncertainRequests(10).map((request) => ({
          requestId: request.requestId,
          clientMessageId: request.clientMessageId,
          threadId: request.threadId,
          turnId: request.turnId,
          status: request.status,
          retryCount: request.retryCount,
          updatedAtIso: request.updatedAtIso,
          lastError: request.lastError,
        }))
        setJson(res, 200, {
          status: 'ok',
          data: {
            appServer: appServer.getStatus(),
            notificationDiagnostics: notificationDiagnostics.snapshot(),
            statusDiagnostics: statusDiagnostics.snapshot(),
            serverRequestDiagnostics,
            schemaAudit,
            transcription: getTranscriptionProxyConfigSnapshot(),
            runtimeStore: runtimeHealth,
            runtime: {
              uncertainRequests,
              recentEvents,
            },
            pendingServerRequests: serverRequestDiagnostics.pendingRequests,
            timestamp: new Date().toISOString(),
          },
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/methods') {
        const methods = await methodCatalog.listMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/notifications') {
        const methods = await methodCatalog.listNotificationMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/workspace-roots-state') {
        const state = await readWorkspaceRootsState(getCodexGlobalStatePath())
        setJson(res, 200, { data: state })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
        setJson(res, 200, { data: { path: homedir() } })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/github-trending') {
        const since = normalizeGithubTrendingSince(url.searchParams.get('since'))
        const limit = normalizeGithubTrendingLimit(url.searchParams.get('limit'))
        try {
          const data = await fetchGithubTrending(since, limit)
          setJson(res, 200, { data })
        } catch (error) {
          setJson(res, 502, { error: getErrorMessage(error, 'Failed to fetch GitHub trending') })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/github-trending/translate') {
        const payload = asRecord(await readJsonBody(req))
        const descriptions = normalizeGithubTrendingTranslationDescriptions(payload?.descriptions)

        try {
          const translations = await translateGithubDescriptionsToChinese(descriptions)
          setJson(res, 200, { data: { translations } })
        } catch {
          setJson(res, 200, { data: { translations: descriptions } })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/worktree/create') {
        const payload = asRecord(await readJsonBody(req))
        const rawSourceCwd = typeof payload?.sourceCwd === 'string' ? payload.sourceCwd.trim() : ''
        if (!rawSourceCwd) {
          setJson(res, 400, { error: 'Missing sourceCwd' })
          return
        }

        const sourceCwd = isAbsolute(rawSourceCwd) ? rawSourceCwd : resolve(rawSourceCwd)
        try {
          const sourceInfo = await stat(sourceCwd)
          if (!sourceInfo.isDirectory()) {
            setJson(res, 400, { error: 'sourceCwd is not a directory' })
            return
          }
        } catch {
          setJson(res, 404, { error: 'sourceCwd does not exist' })
          return
        }

        try {
          let gitRoot = ''
          try {
            gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
          } catch (error) {
            if (!isNotGitRepositoryError(error)) throw error
            await runCommand('git', ['init'], { cwd: sourceCwd })
            gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
          }
          const repoName = basename(gitRoot) || 'repo'
          const worktreesRoot = getCodexWorktreesDir()
          await mkdir(worktreesRoot, { recursive: true })

          // Match Codex desktop layout so project grouping resolves to repo name:
          // ~/.codex/worktrees/<id>/<repoName>
          let worktreeId = ''
          let worktreeParent = ''
          let worktreeCwd = ''
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const candidate = randomBytes(2).toString('hex')
            const parent = join(worktreesRoot, candidate)
            try {
              await stat(parent)
              continue
            } catch {
              worktreeId = candidate
              worktreeParent = parent
              worktreeCwd = join(parent, repoName)
              break
            }
          }
          if (!worktreeId || !worktreeParent || !worktreeCwd) {
            throw new Error('Failed to allocate a unique worktree id')
          }
          const branch = `codex/${worktreeId}`

          await mkdir(worktreeParent, { recursive: true })
          try {
            await runCommand('git', ['worktree', 'add', '-b', branch, worktreeCwd, 'HEAD'], { cwd: gitRoot })
          } catch (error) {
            if (!isMissingHeadError(error)) throw error
            await ensureRepoHasInitialCommit(gitRoot)
            await runCommand('git', ['worktree', 'add', '-b', branch, worktreeCwd, 'HEAD'], { cwd: gitRoot })
          }

          setJson(res, 200, {
            data: {
              cwd: worktreeCwd,
              branch,
              gitRoot,
            },
          })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to create worktree') })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/worktree/auto-commit') {
        const payload = asRecord(await readJsonBody(req))
        const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
        const commitMessage = normalizeCommitMessage(payload?.message)
        if (!rawCwd) {
          setJson(res, 400, { error: 'Missing cwd' })
          return
        }
        if (!commitMessage) {
          setJson(res, 400, { error: 'Missing message' })
          return
        }

        const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
        try {
          const cwdInfo = await stat(cwd)
          if (!cwdInfo.isDirectory()) {
            setJson(res, 400, { error: 'cwd is not a directory' })
            return
          }
        } catch {
          setJson(res, 404, { error: 'cwd does not exist' })
          return
        }

        try {
          await ensureRollbackGitRepo(cwd)
          const beforeStatus = await runRollbackGitWithOutput(cwd, ['status', '--porcelain'])
          if (!beforeStatus.trim()) {
            setJson(res, 200, { data: { committed: false } })
            return
          }

          await runRollbackGit(cwd, ['add', '-A'])
          const stagedStatus = await runRollbackGitWithOutput(cwd, ['diff', '--cached', '--name-only'])
          if (!stagedStatus.trim()) {
            setJson(res, 200, { data: { committed: false } })
            return
          }

          await runRollbackGit(cwd, ['commit', '-m', commitMessage])
          setJson(res, 200, { data: { committed: true } })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to auto-commit rollback changes') })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/worktree/rollback-to-message') {
        const payload = asRecord(await readJsonBody(req))
        const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
        const commitMessage = normalizeCommitMessage(payload?.message)
        if (!rawCwd) {
          setJson(res, 400, { error: 'Missing cwd' })
          return
        }
        if (!commitMessage) {
          setJson(res, 400, { error: 'Missing message' })
          return
        }

        const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
        try {
          const cwdInfo = await stat(cwd)
          if (!cwdInfo.isDirectory()) {
            setJson(res, 400, { error: 'cwd is not a directory' })
            return
          }
        } catch {
          setJson(res, 404, { error: 'cwd does not exist' })
          return
        }

        try {
          await ensureRollbackGitRepo(cwd)
          const commitSha = await findRollbackCommitByExactMessage(cwd, commitMessage)
          if (!commitSha) {
            setJson(res, 404, { error: 'No matching commit found for this user message' })
            return
          }
          let resetTargetSha = ''
          try {
            resetTargetSha = await runRollbackGitCapture(cwd, ['rev-parse', `${commitSha}^`])
          } catch {
            setJson(res, 409, { error: 'Cannot rollback: matched commit has no parent commit' })
            return
          }

          let stashed = false
          if (await hasRollbackGitWorkingTreeChanges(cwd)) {
            const stashMessage = `codex-auto-stash-before-rollback-${Date.now()}`
            await runRollbackGit(cwd, ['stash', 'push', '-u', '-m', stashMessage])
            stashed = true
          }

          await runRollbackGit(cwd, ['reset', '--hard', resetTargetSha])
          setJson(res, 200, { data: { reset: true, commitSha, resetTargetSha, stashed } })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to rollback project to user message commit') })
        }
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/workspace-roots-state') {
        const payload = await readJsonBody(req)
        const record = asRecord(payload)
        if (!record) {
          setJson(res, 400, { error: 'Invalid body: expected object' })
          return
        }
        const nextState: WorkspaceRootsState = normalizeWorkspaceRootsState(record)
        await writeWorkspaceRootsState(getCodexGlobalStatePath(), nextState)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/project-root') {
        const payload = asRecord(await readJsonBody(req))
        const rawPath = typeof payload?.path === 'string' ? payload.path.trim() : ''
        const createIfMissing = payload?.createIfMissing === true
        const label = typeof payload?.label === 'string' ? payload.label : ''
        const statePath = getCodexGlobalStatePath()
        try {
          const existingState = await readWorkspaceRootsState(statePath)
          const result = await resolveProjectRoot(rawPath, {
            createIfMissing,
            label,
            existingState,
          })
          await writeWorkspaceRootsState(statePath, result.workspaceState)
          setJson(res, 200, { data: { path: result.path } })
        } catch (error) {
          if (error instanceof ProjectRootError) {
            setJson(res, error.statusCode, { error: error.message })
            return
          }
          throw error
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/project-root-suggestion') {
        const basePath = url.searchParams.get('basePath')?.trim() ?? ''
        try {
          const suggestion = await suggestProjectRoot(basePath)
          setJson(res, 200, { data: suggestion })
        } catch (error) {
          if (error instanceof ProjectRootError) {
            setJson(res, error.statusCode, { error: error.message })
            return
          }
          throw error
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/composer-file-search') {
        const payload = asRecord(await readJsonBody(req))
        const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
        const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
        try {
          const data = await searchComposerFiles({
            cwd: rawCwd,
            query,
            limit: payload?.limit,
          })
          setJson(res, 200, { data })
        } catch (error) {
          if (error instanceof ComposerFileSearchError) {
            setJson(res, error.statusCode, { error: error.message })
            return
          }
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to search files') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-titles') {
        const cache = await readMergedThreadTitleCache(getCodexGlobalStatePath(), getCodexSessionIndexPath())
        setJson(res, 200, { data: cache })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/thread-search') {
        const payload = asRecord(await readJsonBody(req))
        const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
        const limitRaw = typeof payload?.limit === 'number' ? payload.limit : 200
        const limit = Math.max(1, Math.min(1000, Math.floor(limitRaw)))
        if (!query) {
          setJson(res, 200, { data: { threadIds: [], indexedThreadCount: 0 } })
          return
        }

        const searchResult = await threadSearchIndexStore.search(query, limit)
        setJson(res, 200, { data: searchResult })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/thread-titles') {
        const payload = asRecord(await readJsonBody(req))
        const id = typeof payload?.id === 'string' ? payload.id : ''
        const title = typeof payload?.title === 'string' ? payload.title : ''
        if (!id) {
          setJson(res, 400, { error: 'Missing id' })
          return
        }
        const statePath = getCodexGlobalStatePath()
        const cache = await readThreadTitleCache(statePath)
        const next = title ? updateThreadTitleCache(cache, id, title) : removeFromThreadTitleCache(cache, id)
        await writeThreadTitleCache(statePath, next)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/desktop-app/status') {
        const status = await getDesktopAppRefreshStatus()
        setJson(res, 200, { data: status })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/desktop-app/refresh') {
        try {
          const result = await requestDesktopAppRefresh()
          setJson(res, 202, { data: result })
        } catch (error) {
          setJson(res, 409, { error: getErrorMessage(error, 'Failed to refresh the official Codex desktop app') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/tunnel-status') {
        const status = await getTunnelStatus()
        setJson(res, 200, { data: status })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/tunnel-status') {
        const payload = await readJsonBody(req)
        const record =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {}
        const status = await updateTunnelConfig({
          enabled: typeof record.enabled === 'boolean' ? record.enabled : null,
          cloudflaredCommand: typeof record.cloudflaredCommand === 'string' ? record.cloudflaredCommand : undefined,
        })
        setJson(res, 200, { data: status })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/events') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')

        let keepAlive: ReturnType<typeof setInterval> | null = null
        let unsubscribe: (() => void) | null = null
        const close = () => {
          if (keepAlive !== null) {
            clearInterval(keepAlive)
            keepAlive = null
          }
          unsubscribe?.()
          unsubscribe = null
          if (!res.writableEnded) {
            res.end()
          }
        }
        const writeSse = (chunk: string): void => {
          if (res.writableEnded || res.destroyed) return
          try {
            res.write(chunk)
          } catch {
            close()
          }
        }
        unsubscribe = middleware.subscribeNotifications((notification: BridgeNotificationEvent) => {
          writeSse(`data: ${JSON.stringify(notification)}\n\n`)
        })

        writeSse(`event: ready\ndata: ${JSON.stringify({ ok: true, latestSeq: notificationSeq })}\n\n`)
        keepAlive = setInterval(() => {
          writeSse(`data: ${JSON.stringify({
            method: BRIDGE_HEARTBEAT_METHOD,
            params: { ok: true },
            atIso: new Date().toISOString(),
          })}\n\n`)
        }, 15000)

        req.on('close', close)
        req.on('aborted', close)
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
    clearInterval(runtimeReconcileTimer)
    threadSearchIndexStore.clear()
    bridgeNotificationListeners.clear()
    unsubscribeAppServerNotifications()
    notificationDiagnostics.clear()
    statusDiagnostics.clear()
    runtimeStore.close()
    appServer.dispose()
  }
  middleware.subscribeNotifications = (
    listener: (value: BridgeNotificationEvent) => void,
  ) => {
    bridgeNotificationListeners.add(listener)
    return () => {
      bridgeNotificationListeners.delete(listener)
    }
  }
  middleware.listNotificationEventsAfter = listNotificationEventsAfter

  return middleware
}
