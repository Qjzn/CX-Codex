import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, mkdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { writeFile } from 'node:fs/promises'
import { handleSkillsRoutes, initializeSkillsSyncOnStartup } from './skillsRoutes.js'
import { getDesktopAppRefreshStatus, requestDesktopAppRefresh } from './desktopAppRefresh.js'
import { getTunnelStatus, updateTunnelConfig } from './tunnelStatus.js'
import { readFavoriteRecords, readPinnedThreadIds, writeFavoriteRecords, writePinnedThreadIds } from './webUiState.js'
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
import { getSpawnInvocation } from '../utils/commandInvocation.js'
import {
  getOpenAiTranscribeApiKey,
  getTranscribeRequestBodyLimitBytes,
  proxyChatGptTranscribe,
  proxyOpenAiTranscribe,
  type TranscriptionProxyResult,
} from './transcriptionProxy.js'
import {
  resolveCodexCommand,
  resolveRipgrepCommand,
} from '../commandResolution.js'
import {
  AppServerRpcCache,
  getShareableRpcKey,
  shouldInvalidateThreadListCacheForRpc,
} from './appServerRpcCache.js'
import {
  AppServerRpcDiagnostics,
  type RpcDiagnostics,
} from './appServerRpcDiagnostics.js'
import {
  AppServerRpcQueue,
  getAppServerRpcQueuePriority,
} from './appServerRpcQueue.js'
import { AppServerLineBuffer } from './appServerLineBuffer.js'
import { AppServerStderrLogger } from './appServerStderrLogger.js'

type JsonRpcCall = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

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

type ServerRequestReply = {
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

type WorkspaceRootsState = {
  order: string[]
  labels: Record<string, string>
  active: string[]
}

type AppServerHealth = {
  running: boolean
  initialized: boolean
  stopping: boolean
  pid: number | null
  pendingRpcCount: number
  queuedRpcCount: number
  pendingServerRequestCount: number
  activePlanModeTurnCount: number
  rpcDiagnostics?: RpcDiagnostics
}

type PermissionDecision = 'ask' | 'allowForSession'

type WebBridgePermissionSettings = {
  allowAllPermissionRequests: boolean
  commandExecution: PermissionDecision
  fileChange: PermissionDecision
  mcpTools: PermissionDecision
}

type WebBridgeSettings = {
  permissions: WebBridgePermissionSettings
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

type TokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

type ThreadTokenUsage = {
  total: TokenUsageBreakdown
  last: TokenUsageBreakdown
  modelContextWindow: number | null
  usedPercent: number | null
  remainingTokens: number | null
}

type ThreadSearchDocument = {
  id: string
  title: string
  preview: string
  messageText: string
  searchableText: string
}

type ThreadSearchIndex = {
  docsById: Map<string, ThreadSearchDocument>
}

type GithubTrendingItem = {
  id: number
  fullName: string
  url: string
  description: string
  language: string
  stars: number
}

type TranslationCacheEntry = {
  value: string
  expiresAt: number
}

const GITHUB_DESCRIPTION_TRANSLATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES = 500
const GITHUB_DESCRIPTION_TRANSLATION_BATCH_LIMIT = 10
const githubDescriptionTranslationCache = new Map<string, TranslationCacheEntry>()

const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_METHODS_WITH_TURNS = new Set(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])
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
const DEFAULT_WEB_BRIDGE_SETTINGS: WebBridgeSettings = {
  permissions: {
    allowAllPermissionRequests: false,
    commandExecution: 'allowForSession',
    fileChange: 'allowForSession',
    mcpTools: 'ask',
  },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function trimThreadTurnsInRpcResult(method: string, result: unknown): unknown {
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns || turns.length <= THREAD_RESPONSE_TURN_LIMIT) return result

  return {
    ...record,
    thread: {
      ...thread,
      turns: turns.slice(-THREAD_RESPONSE_TURN_LIMIT),
    },
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error && payload.message.trim().length > 0) {
    return payload.message
  }

  const record = asRecord(payload)
  if (!record) return fallback

  const error = record.error
  if (typeof error === 'string' && error.length > 0) return error

  const nestedError = asRecord(error)
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.length > 0) {
    return nestedError.message
  }

  return fallback
}

function toIsoFromUnixSeconds(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : ''
}

function readTurnsFromThreadReadPayload(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  return turns
    .map((turn) => asRecord(turn))
    .filter((turn): turn is Record<string, unknown> => turn !== null)
}

function readThreadStatusTypeFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const status = thread?.status
  if (typeof status === 'string') {
    return status.trim().toLowerCase()
  }
  const statusRecord = asRecord(status)
  return typeof statusRecord?.type === 'string' ? statusRecord.type.trim().toLowerCase() : ''
}

function isTurnInProgress(turn: Record<string, unknown> | null | undefined): boolean {
  return turn?.status === 'inProgress'
}

function readActiveTurnIdFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const directActiveTurnId = typeof thread?.activeTurnId === 'string' ? thread.activeTurnId.trim() : ''
  if (directActiveTurnId) {
    return directActiveTurnId
  }
  const status = asRecord(thread?.status)
  const statusActiveTurnId =
    typeof status?.activeTurnId === 'string'
      ? status.activeTurnId.trim()
      : typeof status?.turnId === 'string'
        ? status.turnId.trim()
        : ''
  if (statusActiveTurnId) {
    return statusActiveTurnId
  }
  const turns = readTurnsFromThreadReadPayload(payload)
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const turnId = typeof turn.id === 'string' ? turn.id.trim() : ''
    if (turnId && isTurnInProgress(turn)) {
      return turnId
    }
  }
  return ''
}

function readThreadInProgressFromThreadReadPayload(payload: unknown): boolean {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  if (thread?.inProgress === true) {
    return true
  }
  const turnStatus = typeof thread?.turnStatus === 'string' ? thread.turnStatus.trim().toLowerCase() : ''
  if (turnStatus === 'inprogress' || turnStatus === 'in_progress') {
    return true
  }
  const statusType = readThreadStatusTypeFromPayload(payload)
  if (
    statusType === 'inprogress'
    || statusType === 'in_progress'
    || statusType === 'running'
    || statusType === 'active'
    || statusType === 'processing'
  ) {
    return true
  }
  const turns = readTurnsFromThreadReadPayload(payload)
  return isTurnInProgress(turns.at(-1))
}

function readThreadUpdatedAtIsoFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  return toIsoFromUnixSeconds(thread?.updatedAt)
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function readRecordNumberByAliases(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in record) {
      return readNonNegativeNumber(record[key])
    }
  }
  return 0
}

function normalizeTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    totalTokens: readRecordNumberByAliases(record, 'totalTokens', 'total_tokens'),
    inputTokens: readRecordNumberByAliases(record, 'inputTokens', 'input_tokens'),
    cachedInputTokens: readRecordNumberByAliases(record, 'cachedInputTokens', 'cached_input_tokens'),
    outputTokens: readRecordNumberByAliases(record, 'outputTokens', 'output_tokens'),
    reasoningOutputTokens: readRecordNumberByAliases(record, 'reasoningOutputTokens', 'reasoning_output_tokens'),
  }
}

function normalizeThreadTokenUsage(value: unknown): ThreadTokenUsage | null {
  const record = asRecord(value)
  if (!record) return null
  const total = normalizeTokenUsageBreakdown(record.total ?? record.total_token_usage)
  const last = normalizeTokenUsageBreakdown(record.last ?? record.last_token_usage)
  if (!total || !last) return null

  const rawContextWindow = record.modelContextWindow ?? record.model_context_window
  const modelContextWindow =
    typeof rawContextWindow === 'number' && Number.isFinite(rawContextWindow) && rawContextWindow > 0
      ? Math.max(0, rawContextWindow)
      : null
  const rawUsedPercent = record.usedPercent ?? record.used_percent
  const derivedUsedTokens =
    typeof modelContextWindow === 'number' && modelContextWindow > 0
      ? Math.min(Math.max(last.totalTokens, 0), modelContextWindow)
      : null
  const usedPercent =
    typeof rawUsedPercent === 'number' && Number.isFinite(rawUsedPercent)
      ? Math.min(Math.max(rawUsedPercent, 0), 100)
      : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number' && modelContextWindow > 0
        ? Math.min(Math.max((derivedUsedTokens / modelContextWindow) * 100, 0), 100)
        : null
  const rawRemainingTokens = record.remainingTokens ?? record.remaining_tokens
  const remainingTokens =
    typeof rawRemainingTokens === 'number' && Number.isFinite(rawRemainingTokens)
      ? Math.max(0, rawRemainingTokens)
      : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number'
        ? Math.max(modelContextWindow - derivedUsedTokens, 0)
        : null

  return {
    total,
    last,
    modelContextWindow,
    usedPercent,
    remainingTokens,
  }
}

function readThreadTokenUsageFromThreadReadPayload(payload: unknown): ThreadTokenUsage | null {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  return normalizeThreadTokenUsage(root?.tokenUsage ?? thread?.tokenUsage)
}

function readThreadSessionPathFromThreadReadPayload(payload: unknown): string {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  const sessionPath = typeof thread?.path === 'string' ? thread.path.trim() : ''
  if (sessionPath) return sessionPath
  return typeof root?.path === 'string' ? root.path.trim() : ''
}

function isThreadMaterializingError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase()
  if (!message) return false
  return (
    message.includes('is not materialized yet') ||
    message.includes('includeturns is unavailable before first user message') ||
    message.includes('no rollout found for thread id') ||
    (message.includes('rollout') && message.includes('is empty'))
  )
}

function createRpcTimeoutError(method: string, timeoutMs: number): Error {
  const error = new Error(`${method} timed out after ${Math.ceil(timeoutMs / 1000)}s`)
  error.name = 'AppServerRpcTimeoutError'
  return error
}

function isRpcTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AppServerRpcTimeoutError'
}

function isInterruptSettledError(error: unknown): boolean {
  if (isRpcTimeoutError(error)) return false
  const message = getErrorMessage(error, '').toLowerCase()
  if (!message) return false
  return (
    message.includes('no active turn') ||
    message.includes('not running') ||
    message.includes('already completed') ||
    message.includes('cannot interrupt') ||
    message.includes('unable to interrupt') ||
    message.includes('active turn not found')
  )
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringByAliases(record: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = normalizeThreadId(record[key])
    if (value) return value
  }
  return ''
}

function readThreadIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''

  const direct = readStringByAliases(root, 'threadId', 'thread_id')
  if (direct) return direct

  const request = asRecord(root.request)
  const requestThreadId = readStringByAliases(request, 'threadId', 'thread_id')
  if (requestThreadId) return requestThreadId
  const requestParams = asRecord(request?.params)
  const requestParamsThreadId = readStringByAliases(requestParams, 'threadId', 'thread_id')
  if (requestParamsThreadId) return requestParamsThreadId

  const params = asRecord(root.params)
  const paramsThreadId = readStringByAliases(params, 'threadId', 'thread_id')
  if (paramsThreadId) return paramsThreadId

  const thread = asRecord(root.thread)
  const threadId = readStringByAliases(thread, 'id', 'threadId', 'thread_id')
  if (threadId) return threadId

  const turn = asRecord(root.turn)
  const turnThreadId = readStringByAliases(turn, 'threadId', 'thread_id')
  if (turnThreadId) return turnThreadId

  const item = asRecord(root.item)
  const itemThreadId = readStringByAliases(item, 'threadId', 'thread_id')
  if (itemThreadId) return itemThreadId

  return ''
}

function readTurnIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  const direct = readStringByAliases(root, 'turnId', 'turn_id', 'activeTurnId')
  if (direct) return direct
  const request = asRecord(root.request)
  const requestTurnId = readStringByAliases(request, 'turnId', 'turn_id', 'activeTurnId')
  if (requestTurnId) return requestTurnId
  const requestParams = asRecord(request?.params)
  const requestParamsTurnId = readStringByAliases(requestParams, 'turnId', 'turn_id', 'activeTurnId')
  if (requestParamsTurnId) return requestParamsTurnId
  const params = asRecord(root.params)
  const paramsTurnId = readStringByAliases(params, 'turnId', 'turn_id', 'activeTurnId')
  if (paramsTurnId) return paramsTurnId
  const turn = asRecord(root.turn)
  const turnId = readStringByAliases(turn, 'id', 'turnId', 'turn_id')
  if (turnId) return turnId
  const item = asRecord(root.item)
  return readStringByAliases(item, 'turnId', 'turn_id')
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

function readItemIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  const direct = readStringByAliases(root, 'itemId', 'item_id')
  if (direct) return direct
  const item = asRecord(root.item)
  return readStringByAliases(item, 'id', 'itemId', 'item_id')
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

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function extractThreadMessageText(threadReadPayload: unknown): string {
  const payload = asRecord(threadReadPayload)
  const thread = asRecord(payload?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const parts: string[] = []

  for (const turn of turns) {
    const turnRecord = asRecord(turn)
    const items = Array.isArray(turnRecord?.items) ? turnRecord.items : []
    for (const item of items) {
      const itemRecord = asRecord(item)
      const type = typeof itemRecord?.type === 'string' ? itemRecord.type : ''
      if (type === 'agentMessage' && typeof itemRecord?.text === 'string' && itemRecord.text.trim().length > 0) {
        parts.push(itemRecord.text.trim())
        continue
      }
      if (type === 'userMessage') {
        const content = Array.isArray(itemRecord?.content) ? itemRecord.content : []
        for (const block of content) {
          const blockRecord = asRecord(block)
          if (blockRecord?.type === 'text' && typeof blockRecord.text === 'string' && blockRecord.text.trim().length > 0) {
            parts.push(blockRecord.text.trim())
          }
        }
        continue
      }
      if (type === 'commandExecution') {
        const command = typeof itemRecord?.command === 'string' ? itemRecord.command.trim() : ''
        const output = typeof itemRecord?.aggregatedOutput === 'string' ? itemRecord.aggregatedOutput.trim() : ''
        if (command) parts.push(command)
        if (output) parts.push(output)
      }
    }
  }

  return parts.join('\n').trim()
}

function isExactPhraseMatch(query: string, doc: ThreadSearchDocument): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return doc.title.toLowerCase().includes(q)
}

function scoreFileCandidate(path: string, query: string): number {
  if (!query) return 0
  const lowerPath = path.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const baseName = lowerPath.slice(lowerPath.lastIndexOf('/') + 1)
  if (baseName === lowerQuery) return 0
  if (baseName.startsWith(lowerQuery)) return 1
  if (baseName.includes(lowerQuery)) return 2
  if (lowerPath.includes(`/${lowerQuery}`)) return 3
  if (lowerPath.includes(lowerQuery)) return 4
  return 10
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function parseGithubTrendingHtml(html: string, limit: number): GithubTrendingItem[] {
  const rows = html.match(/<article[\s\S]*?<\/article>/g) ?? []
  const items: GithubTrendingItem[] = []
  let seq = Date.now()
  for (const row of rows) {
    const repoBlockMatch = row.match(/<h2[\s\S]*?<\/h2>/)
    const hrefMatch = repoBlockMatch?.[0]?.match(/href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/)
    if (!hrefMatch) continue
    const fullName = hrefMatch[1] ?? ''
    if (!fullName || items.some((item) => item.fullName === fullName)) continue
    const descriptionMatch =
      row.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      ?? row.match(/<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      ?? row.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const languageMatch = row.match(/programmingLanguage[^>]*>\s*([\s\S]*?)\s*<\/span>/)
    const starsMatch = row.match(/href="\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/stargazers"[\s\S]*?>([\s\S]*?)<\/a>/)
    const starsText = stripHtml(starsMatch?.[1] ?? '').replace(/,/g, '')
    const stars = Number.parseInt(starsText, 10)
    items.push({
      id: seq,
      fullName,
      url: `https://github.com/${fullName}`,
      description: stripHtml(descriptionMatch?.[1] ?? ''),
      language: stripHtml(languageMatch?.[1] ?? ''),
      stars: Number.isFinite(stars) ? stars : 0,
    })
    seq += 1
    if (items.length >= limit) break
  }
  return items
}

async function fetchGithubTrending(since: 'daily' | 'weekly' | 'monthly', limit: number): Promise<GithubTrendingItem[]> {
  const endpoint = `https://github.com/trending?since=${since}`
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'codex-web-local',
      Accept: 'text/html',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub trending fetch failed (${response.status})`)
  }
  const html = await response.text()
  return parseGithubTrendingHtml(html, limit)
}

function normalizeGithubDescriptionTranslationText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function hasCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)
}

function shouldTranslateGithubDescription(value: string): boolean {
  const normalized = normalizeGithubDescriptionTranslationText(value)
  if (!normalized) return false
  if (hasCjkCharacters(normalized)) return false
  return /[A-Za-z]/u.test(normalized)
}

function pruneGithubDescriptionTranslationCache(): void {
  const now = Date.now()
  for (const [key, entry] of githubDescriptionTranslationCache.entries()) {
    if (entry.expiresAt <= now) {
      githubDescriptionTranslationCache.delete(key)
    }
  }

  if (githubDescriptionTranslationCache.size <= GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES) {
    return
  }

  const overflow = githubDescriptionTranslationCache.size - GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES
  let removed = 0
  for (const key of githubDescriptionTranslationCache.keys()) {
    githubDescriptionTranslationCache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

function readGoogleTranslateText(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return ''

  let translated = ''
  for (const segment of payload[0]) {
    if (!Array.isArray(segment) || typeof segment[0] !== 'string') continue
    translated += segment[0]
  }

  return normalizeGithubDescriptionTranslationText(translated)
}

async function translateGithubDescriptionToChinese(text: string): Promise<string> {
  const normalized = normalizeGithubDescriptionTranslationText(text)
  if (!shouldTranslateGithubDescription(normalized)) {
    return normalized
  }

  const cached = githubDescriptionTranslationCache.get(normalized)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  if (cached) {
    githubDescriptionTranslationCache.delete(normalized)
  }

  const query = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'zh-CN',
    dt: 't',
    q: normalized,
  })
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'cx-codex-server-bridge',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub description translation failed (${response.status})`)
  }

  const translated = readGoogleTranslateText(await response.json())
  const nextValue = translated || normalized
  githubDescriptionTranslationCache.set(normalized, {
    value: nextValue,
    expiresAt: Date.now() + GITHUB_DESCRIPTION_TRANSLATION_CACHE_TTL_MS,
  })
  pruneGithubDescriptionTranslationCache()
  return nextValue
}

async function translateGithubDescriptionsToChinese(descriptions: string[]): Promise<string[]> {
  const normalizedDescriptions = descriptions.map((description) => normalizeGithubDescriptionTranslationText(description))
  const uniqueTranslations = new Map<string, Promise<string>>()

  return await Promise.all(normalizedDescriptions.map(async (description) => {
    if (!description) return ''
    if (!uniqueTranslations.has(description)) {
      uniqueTranslations.set(
        description,
        translateGithubDescriptionToChinese(description).catch(() => description),
      )
    }
    return await uniqueTranslations.get(description)!
  }))
}

async function listFilesWithRipgrep(cwd: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const ripgrepCommand = resolveRipgrepCommand()
    if (!ripgrepCommand) {
      reject(new Error('ripgrep (rg) is not available'))
      return
    }

    const proc = spawn(ripgrepCommand, ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        const rows = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        resolve(rows)
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      reject(new Error(details || 'rg --files failed'))
    })
  })
}

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`))
    })
  })
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

async function runCommandCapture(command: string, args: string[], options: { cwd?: string } = {}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`))
    })
  })
}

async function runCommandWithOutput(command: string, args: string[], options: { cwd?: string } = {}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`))
    })
  })
}


function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && !normalized.includes(item)) {
      normalized.push(item)
    }
  }
  return normalized
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length > 0 && typeof item === 'string') {
      next[key] = item
    }
  }
  return next
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

function getCodexAuthPath(): string {
  return join(getCodexHomeDir(), 'auth.json')
}

type CodexAuth = {
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

async function readCodexAuth(): Promise<{ accessToken: string; accountId?: string } | null> {
  try {
    const raw = await readFile(getCodexAuthPath(), 'utf8')
    const auth = JSON.parse(raw) as CodexAuth
    const token = auth.tokens?.access_token
    if (!token) return null
    return { accessToken: token, accountId: auth.tokens?.account_id ?? undefined }
  } catch {
    return null
  }
}

function getCodexGlobalStatePath(): string {
  return join(getCodexHomeDir(), '.codex-global-state.json')
}

function getWebBridgeSettingsPath(): string {
  return join(getCodexHomeDir(), 'web-bridge-settings.json')
}

function getCodexSessionIndexPath(): string {
  return join(getCodexHomeDir(), 'session_index.jsonl')
}

type ThreadTitleCache = { titles: Record<string, string>; order: string[] }
const MAX_THREAD_TITLES = 500
const EMPTY_THREAD_TITLE_CACHE: ThreadTitleCache = { titles: {}, order: [] }

type SessionIndexThreadTitleCacheState = {
  fileSignature: string | null
  cache: ThreadTitleCache
}

let sessionIndexThreadTitleCacheState: SessionIndexThreadTitleCacheState = {
  fileSignature: null,
  cache: EMPTY_THREAD_TITLE_CACHE,
}

type SessionLogThreadTokenUsageCacheState = {
  fileSignature: string | null
  tokenUsage: ThreadTokenUsage | null
}

const MAX_SESSION_LOG_TOKEN_USAGE_CACHE_ENTRIES = 400
const sessionLogThreadTokenUsageCacheStateByPath = new Map<string, SessionLogThreadTokenUsageCacheState>()

function writeSessionLogThreadTokenUsageCacheState(
  sessionPath: string,
  cacheState: SessionLogThreadTokenUsageCacheState,
): void {
  if (sessionLogThreadTokenUsageCacheStateByPath.has(sessionPath)) {
    sessionLogThreadTokenUsageCacheStateByPath.delete(sessionPath)
  }
  sessionLogThreadTokenUsageCacheStateByPath.set(sessionPath, cacheState)
  while (sessionLogThreadTokenUsageCacheStateByPath.size > MAX_SESSION_LOG_TOKEN_USAGE_CACHE_ENTRIES) {
    const oldestKey = sessionLogThreadTokenUsageCacheStateByPath.keys().next().value
    if (typeof oldestKey !== 'string') break
    sessionLogThreadTokenUsageCacheStateByPath.delete(oldestKey)
  }
}

function normalizeThreadTitleCache(value: unknown): ThreadTitleCache {
  const record = asRecord(value)
  if (!record) return EMPTY_THREAD_TITLE_CACHE
  const rawTitles = asRecord(record.titles)
  const titles: Record<string, string> = {}
  if (rawTitles) {
    for (const [k, v] of Object.entries(rawTitles)) {
      if (typeof v === 'string' && v.length > 0) titles[k] = v
    }
  }
  const order = normalizeStringArray(record.order)
  return { titles, order }
}

function updateThreadTitleCache(cache: ThreadTitleCache, id: string, title: string): ThreadTitleCache {
  const titles = { ...cache.titles, [id]: title }
  const order = [id, ...cache.order.filter((o) => o !== id)]
  while (order.length > MAX_THREAD_TITLES) {
    const removed = order.pop()
    if (removed) delete titles[removed]
  }
  return { titles, order }
}

function removeFromThreadTitleCache(cache: ThreadTitleCache, id: string): ThreadTitleCache {
  const { [id]: _, ...titles } = cache.titles
  return { titles, order: cache.order.filter((o) => o !== id) }
}

type SessionIndexThreadTitle = {
  id: string
  title: string
  updatedAtMs: number
}

function normalizeSessionIndexThreadTitle(value: unknown): SessionIndexThreadTitle | null {
  const record = asRecord(value)
  if (!record) return null

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.thread_name === 'string' ? record.thread_name.trim() : ''
  const updatedAtIso = typeof record.updated_at === 'string' ? record.updated_at.trim() : ''
  const updatedAtMs = updatedAtIso ? Date.parse(updatedAtIso) : Number.NaN

  if (!id || !title) return null
  return {
    id,
    title,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  }
}

function trimThreadTitleCache(cache: ThreadTitleCache): ThreadTitleCache {
  const titles = { ...cache.titles }
  const order = cache.order.filter((id) => {
    if (!titles[id]) return false
    return true
  }).slice(0, MAX_THREAD_TITLES)

  for (const id of Object.keys(titles)) {
    if (!order.includes(id)) {
      delete titles[id]
    }
  }

  return { titles, order }
}

function mergeThreadTitleCaches(base: ThreadTitleCache, overlay: ThreadTitleCache): ThreadTitleCache {
  const titles = { ...base.titles, ...overlay.titles }
  const order: string[] = []

  for (const id of [...overlay.order, ...base.order]) {
    if (!titles[id] || order.includes(id)) continue
    order.push(id)
  }

  for (const id of Object.keys(titles)) {
    if (!order.includes(id)) {
      order.push(id)
    }
  }

  return trimThreadTitleCache({ titles, order })
}

async function readThreadTitleCache(): Promise<ThreadTitleCache> {
  const statePath = getCodexGlobalStatePath()
  try {
    const raw = await readFile(statePath, 'utf8')
    const payload = asRecord(JSON.parse(raw)) ?? {}
    return normalizeThreadTitleCache(payload['thread-titles'])
  } catch {
    return EMPTY_THREAD_TITLE_CACHE
  }
}

async function writeThreadTitleCache(cache: ThreadTitleCache): Promise<void> {
  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }
  payload['thread-titles'] = cache
  await writeFile(statePath, JSON.stringify(payload), 'utf8')
}

function getSessionIndexFileSignature(stats: { mtimeMs: number; size: number }): string {
  return `${String(stats.mtimeMs)}:${String(stats.size)}`
}

function normalizeThreadTokenUsageFromSessionLogEntry(entry: unknown): ThreadTokenUsage | null {
  const record = asRecord(entry)
  if (record?.type !== 'event_msg') return null

  const payload = asRecord(record.payload)
  if (payload?.type !== 'token_count') return null

  const info = asRecord(payload.info)
  if (!info) return null

  return normalizeThreadTokenUsage({
    total: info.total ?? info.total_token_usage,
    last: info.last ?? info.last_token_usage,
    modelContextWindow: info.modelContextWindow ?? info.model_context_window,
  })
}

async function parseThreadTokenUsageFromSessionLog(sessionPath: string): Promise<ThreadTokenUsage | null> {
  let latestTokenUsage: ThreadTokenUsage | null = null
  const input = createReadStream(sessionPath, { encoding: 'utf8' })
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const tokenUsage = normalizeThreadTokenUsageFromSessionLogEntry(JSON.parse(trimmed) as unknown)
        if (tokenUsage) {
          latestTokenUsage = tokenUsage
        }
      } catch {
        // Skip malformed lines and keep scanning the rest of the session log.
      }
    }
  } finally {
    lines.close()
    input.close()
  }

  return latestTokenUsage
}

async function readThreadTokenUsageFromSessionLog(sessionPath: string): Promise<ThreadTokenUsage | null> {
  const normalizedSessionPath = sessionPath.trim()
  if (!normalizedSessionPath) return null

  try {
    const stats = await stat(normalizedSessionPath)
    const fileSignature = getSessionIndexFileSignature(stats)
    const cached = sessionLogThreadTokenUsageCacheStateByPath.get(normalizedSessionPath)
    if (cached?.fileSignature === fileSignature) {
      return cached.tokenUsage
    }

    const tokenUsage = await parseThreadTokenUsageFromSessionLog(normalizedSessionPath)
    writeSessionLogThreadTokenUsageCacheState(normalizedSessionPath, { fileSignature, tokenUsage })
    return tokenUsage
  } catch {
    writeSessionLogThreadTokenUsageCacheState(normalizedSessionPath, {
      fileSignature: 'missing',
      tokenUsage: null,
    })
    return null
  }
}

async function parseThreadTitlesFromSessionIndex(sessionIndexPath: string): Promise<ThreadTitleCache> {
  const latestById = new Map<string, SessionIndexThreadTitle>()
  const input = createReadStream(sessionIndexPath, { encoding: 'utf8' })
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const entry = normalizeSessionIndexThreadTitle(JSON.parse(trimmed) as unknown)
        if (!entry) continue

        const previous = latestById.get(entry.id)
        if (!previous || entry.updatedAtMs >= previous.updatedAtMs) {
          latestById.set(entry.id, entry)
        }
      } catch {
        // Skip malformed lines and keep scanning the rest of the index.
      }
    }
  } finally {
    lines.close()
    input.close()
  }

  const entries = Array.from(latestById.values()).sort((first, second) => second.updatedAtMs - first.updatedAtMs)
  const titles: Record<string, string> = {}
  const order: string[] = []
  for (const entry of entries) {
    titles[entry.id] = entry.title
    order.push(entry.id)
  }

  return trimThreadTitleCache({ titles, order })
}

async function readThreadTitlesFromSessionIndex(): Promise<ThreadTitleCache> {
  const sessionIndexPath = getCodexSessionIndexPath()

  try {
    const stats = await stat(sessionIndexPath)
    const fileSignature = getSessionIndexFileSignature(stats)
    if (sessionIndexThreadTitleCacheState.fileSignature === fileSignature) {
      return sessionIndexThreadTitleCacheState.cache
    }

    const cache = await parseThreadTitlesFromSessionIndex(sessionIndexPath)
    sessionIndexThreadTitleCacheState = { fileSignature, cache }
    return cache
  } catch {
    sessionIndexThreadTitleCacheState = {
      fileSignature: 'missing',
      cache: EMPTY_THREAD_TITLE_CACHE,
    }
    return sessionIndexThreadTitleCacheState.cache
  }
}

async function readMergedThreadTitleCache(): Promise<ThreadTitleCache> {
  const [sessionIndexCache, persistedCache] = await Promise.all([
    readThreadTitlesFromSessionIndex(),
    readThreadTitleCache(),
  ])
  return mergeThreadTitleCaches(persistedCache, sessionIndexCache)
}

async function readDesktopPinnedThreadIds(): Promise<string[]> {
  try {
    const raw = await readFile(getCodexGlobalStatePath(), 'utf8')
    const payload = asRecord(JSON.parse(raw)) ?? {}
    return normalizeStringArray(payload['pinned-thread-ids'])
  } catch {
    return []
  }
}

async function writeDesktopPinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const normalized = normalizeStringArray(pinnedThreadIds)
  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }
  payload['pinned-thread-ids'] = normalized
  await mkdir(getCodexHomeDir(), { recursive: true })
  await writeFile(statePath, JSON.stringify(payload), 'utf8')
  return normalized
}

async function readMergedPinnedThreadIds(): Promise<string[]> {
  const [webPinnedIds, desktopPinnedIds] = await Promise.all([
    readPinnedThreadIds(),
    readDesktopPinnedThreadIds(),
  ])
  return normalizeStringArray([...webPinnedIds, ...desktopPinnedIds])
}

async function writeMergedPinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const normalized = normalizeStringArray(pinnedThreadIds)
  const [webPinnedIds, desktopPinnedIds] = await Promise.all([
    writePinnedThreadIds(normalized),
    writeDesktopPinnedThreadIds(normalized),
  ])
  return normalizeStringArray([...webPinnedIds, ...desktopPinnedIds])
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

async function readWorkspaceRootsState(): Promise<WorkspaceRootsState> {
  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}

  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    payload = asRecord(parsed) ?? {}
  } catch {
    payload = {}
  }

  return {
    order: normalizeStringArray(payload['electron-saved-workspace-roots']),
    labels: normalizeStringRecord(payload['electron-workspace-root-labels']),
    active: normalizeStringArray(payload['active-workspace-roots']),
  }
}

async function writeWorkspaceRootsState(nextState: WorkspaceRootsState): Promise<void> {
  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }

  payload['electron-saved-workspace-roots'] = normalizeStringArray(nextState.order)
  payload['electron-workspace-root-labels'] = normalizeStringRecord(nextState.labels)
  payload['active-workspace-roots'] = normalizeStringArray(nextState.active)

  await writeFile(statePath, JSON.stringify(payload), 'utf8')
}

function normalizePermissionDecision(value: unknown, fallback: PermissionDecision): PermissionDecision {
  return value === 'ask' || value === 'allowForSession' ? value : fallback
}

function normalizeWebBridgeSettings(value: unknown): WebBridgeSettings {
  const record = asRecord(value)
  const permissions = asRecord(record?.permissions)
  const defaultPermissions = DEFAULT_WEB_BRIDGE_SETTINGS.permissions
  return {
    permissions: {
      allowAllPermissionRequests: permissions?.allowAllPermissionRequests === true,
      commandExecution: normalizePermissionDecision(permissions?.commandExecution, defaultPermissions.commandExecution),
      fileChange: normalizePermissionDecision(permissions?.fileChange, defaultPermissions.fileChange),
      mcpTools: normalizePermissionDecision(permissions?.mcpTools, defaultPermissions.mcpTools),
    },
  }
}

async function readWebBridgeSettings(): Promise<WebBridgeSettings> {
  try {
    const raw = await readFile(getWebBridgeSettingsPath(), 'utf8')
    return normalizeWebBridgeSettings(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_WEB_BRIDGE_SETTINGS
  }
}

async function writeWebBridgeSettings(settings: WebBridgeSettings): Promise<WebBridgeSettings> {
  const normalized = normalizeWebBridgeSettings(settings)
  await writeFile(getWebBridgeSettingsPath(), JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function bufferIndexOf(buf: Buffer, needle: Buffer, start = 0): number {
  for (let i = start; i <= buf.length - needle.length; i++) {
    let match = true
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { match = false; break }
    }
    if (match) return i
  }
  return -1
}

function handleFileUpload(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks)
      const contentType = req.headers['content-type'] ?? ''
      const boundaryMatch = contentType.match(/boundary=(.+)/i)
      if (!boundaryMatch) { setJson(res, 400, { error: 'Missing multipart boundary' }); return }
      const boundary = boundaryMatch[1]
      const boundaryBuf = Buffer.from(`--${boundary}`)
      const parts: Buffer[] = []
      let searchStart = 0
      while (searchStart < body.length) {
        const idx = body.indexOf(boundaryBuf, searchStart)
        if (idx < 0) break
        if (searchStart > 0) parts.push(body.subarray(searchStart, idx))
        searchStart = idx + boundaryBuf.length
        if (body[searchStart] === 0x0d && body[searchStart + 1] === 0x0a) searchStart += 2
      }
      let fileName = 'uploaded-file'
      let fileData: Buffer | null = null
      const headerSep = Buffer.from('\r\n\r\n')
      for (const part of parts) {
        const headerEnd = bufferIndexOf(part, headerSep)
        if (headerEnd < 0) continue
        const headers = part.subarray(0, headerEnd).toString('utf8')
        const fnMatch = headers.match(/filename="([^"]+)"/i)
        if (!fnMatch) continue
        fileName = fnMatch[1].replace(/[/\\]/g, '_')
        let end = part.length
        if (end >= 2 && part[end - 2] === 0x0d && part[end - 1] === 0x0a) end -= 2
        fileData = part.subarray(headerEnd + 4, end)
        break
      }
      if (!fileData) { setJson(res, 400, { error: 'No file in request' }); return }
      const uploadDir = join(tmpdir(), 'codex-web-uploads')
      await mkdir(uploadDir, { recursive: true })
      const destDir = await mkdtemp(join(uploadDir, 'f-'))
      const destPath = join(destDir, fileName)
      await writeFile(destPath, fileData)
      setJson(res, 200, { path: destPath })
    } catch (err) {
      setJson(res, 500, { error: getErrorMessage(err, 'Upload failed') })
    }
  })
  req.on('error', (err: Error) => {
    setJson(res, 500, { error: getErrorMessage(err, 'Upload stream error') })
  })
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function looksLikeMcpElicitationPayload(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false
  return (
    readString(payload.message).trim().length > 0 ||
    readString(payload.mode).trim().length > 0 ||
    readString(payload.url).trim().length > 0 ||
    asRecord(payload.requestedSchema) !== null ||
    asRecord(payload.schema) !== null ||
    asRecord(payload.inputSchema) !== null ||
    asRecord(payload.jsonSchema) !== null
  )
}

function readMcpElicitationPayload(params: unknown): Record<string, unknown> | null {
  const row = asRecord(params)
  if (!row) return null
  const requestParams = asRecord(asRecord(row.request)?.params)
  if (looksLikeMcpElicitationPayload(requestParams)) return requestParams
  const elicitationParams = asRecord(asRecord(row.elicitation)?.params)
  if (looksLikeMcpElicitationPayload(elicitationParams)) return elicitationParams
  const nestedParams = asRecord(row.params)
  if (looksLikeMcpElicitationPayload(nestedParams)) return nestedParams
  return row
}

function isMcpElicitationRequestMethod(method: string): boolean {
  const normalized = method.trim().toLowerCase()
  return (
    normalized === 'mcpserver/elicitation/request' ||
    normalized === 'mcpserver/elication/request' ||
    normalized === 'elicitation/create'
  )
}

function isMcpToolPermissionRequest(method: string, params: unknown): boolean {
  if (!isMcpElicitationRequestMethod(method)) return false
  const payload = readMcpElicitationPayload(params)
  const message = readString(payload?.message).trim()
  if (/^Allow\s+the\s+.+?\s+MCP\s+server\s+to\s+run\s+tool\s+["“][^"”]+["”]\??$/iu.test(message)) {
    return true
  }
  const serverName = readString(payload?.serverName || payload?.server).trim()
  const toolName = readString(payload?.toolName || payload?.tool).trim()
  return serverName.length > 0 && toolName.length > 0
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
  private readonly threadTokenUsageByThreadId = new Map<string, ThreadTokenUsage>()
  private readonly planModeTurnsByThreadId = new Map<string, { turnId: string; startedAtMs: number }>()
  private webBridgeSettings: WebBridgeSettings = DEFAULT_WEB_BRIDGE_SETTINGS
  private readonly appServerArgs = [
    'app-server',
    '-c',
    'approval_policy="never"',
    '-c',
    'sandbox_mode="danger-full-access"',
  ]

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
      this.threadTokenUsageByThreadId.clear()
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
        this.threadTokenUsageByThreadId.clear()
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
    this.threadTokenUsageByThreadId.clear()

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
        pendingRequest.reject(new Error(message.error.message))
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

    const params = asRecord(notification.params)
    const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : ''
    if (!threadId) return

    const tokenUsage = normalizeThreadTokenUsage(params?.tokenUsage)
    if (tokenUsage) {
      this.threadTokenUsageByThreadId.set(threadId, tokenUsage)
      return
    }

    this.threadTokenUsageByThreadId.delete(threadId)
  }

  private sendServerRequestReply(requestId: number, reply: ServerRequestReply): void {
    if (reply.error) {
      this.sendLine({
        jsonrpc: '2.0',
        id: requestId,
        error: reply.error,
      })
      return
    }

    this.sendLine({
      jsonrpc: '2.0',
      id: requestId,
      result: reply.result ?? {},
    })
  }

  setWebBridgeSettings(settings: WebBridgeSettings): void {
    this.webBridgeSettings = normalizeWebBridgeSettings(settings)
  }

  getWebBridgeSettings(): WebBridgeSettings {
    return this.webBridgeSettings
  }

  markPlanModeTurn(threadId: string, turnId = ''): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    this.planModeTurnsByThreadId.set(normalizedThreadId, {
      turnId: turnId.trim(),
      startedAtMs: Date.now(),
    })
  }

  clearPlanModeTurn(threadId: string, turnId = ''): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    const current = this.planModeTurnsByThreadId.get(normalizedThreadId)
    if (!current) return
    const normalizedTurnId = turnId.trim()
    if (normalizedTurnId && current.turnId && current.turnId !== normalizedTurnId) return
    this.planModeTurnsByThreadId.delete(normalizedThreadId)
  }

  clearPlanModeTurnByPayload(payload: unknown): void {
    const threadId = readThreadIdFromPayload(payload)
    const turnId = readTurnIdFromPayload(payload)
    if (threadId) {
      this.clearPlanModeTurn(threadId, turnId)
      return
    }
    if (!turnId) return
    for (const [activeThreadId, activePlan] of this.planModeTurnsByThreadId.entries()) {
      if (activePlan.turnId && activePlan.turnId === turnId) {
        this.planModeTurnsByThreadId.delete(activeThreadId)
      }
    }
  }

  getActivePlanModeTurnCount(): number {
    return this.planModeTurnsByThreadId.size
  }

  private isPlanModeServerRequest(params: unknown): boolean {
    const threadId = this.readServerRequestThreadId(params)
    if (!threadId) return false
    const activePlan = this.planModeTurnsByThreadId.get(threadId)
    if (!activePlan) return false
    const requestTurnId = readTurnIdFromPayload(params)
    if (activePlan.turnId && requestTurnId && activePlan.turnId !== requestTurnId) return false
    return true
  }

  private shouldDeclinePlanModeServerRequest(method: string, params: unknown): boolean {
    if (!this.isPlanModeServerRequest(params)) return false
    return (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      isMcpToolPermissionRequest(method, params)
    )
  }

  private buildPlanModeDeclineResult(method: string, params: unknown): unknown {
    if (isMcpToolPermissionRequest(method, params)) {
      return { action: 'decline' }
    }
    return { decision: 'decline' }
  }

  private shouldAutoApproveServerRequest(method: string, params: unknown): boolean {
    const permissions = this.webBridgeSettings.permissions
    if (permissions.allowAllPermissionRequests) {
      return (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval' ||
        isMcpToolPermissionRequest(method, params)
      )
    }
    if (method === 'item/commandExecution/requestApproval') {
      return permissions.commandExecution === 'allowForSession'
    }
    if (method === 'item/fileChange/requestApproval') {
      return permissions.fileChange === 'allowForSession'
    }
    if (isMcpToolPermissionRequest(method, params)) {
      return permissions.mcpTools === 'allowForSession'
    }
    return false
  }

  private buildAutoApprovalResult(method: string, params: unknown): unknown {
    if (isMcpToolPermissionRequest(method, params)) {
      return { action: 'accept' }
    }
    return { decision: 'acceptForSession' }
  }

  private shouldRejectUnsupportedServerRequest(method: string): boolean {
    return method === 'item/tool/call'
  }

  private buildUnsupportedServerRequestResult(method: string): unknown {
    if (method === 'item/tool/call') {
      return {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: 'CX-Codex Web 收到了 Codex 工具调用请求，但当前 Web 端不能代执行这个工具。请改用文字方案继续，或提示用户在桌面端 Codex 客户端处理需要的工具操作。',
          },
        ],
      }
    }
    return {}
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
    if (this.shouldDeclinePlanModeServerRequest(method, params)) {
      this.sendServerRequestReply(requestId, {
        result: this.buildPlanModeDeclineResult(method, params),
      })
      this.emitServerRequestResolved(requestId, method, params, 'automatic')
      return
    }

    if (this.shouldAutoApproveServerRequest(method, params)) {
      this.sendServerRequestReply(requestId, {
        result: this.buildAutoApprovalResult(method, params),
      })
      this.emitServerRequestResolved(requestId, method, params, 'automatic')
      return
    }

    if (this.shouldRejectUnsupportedServerRequest(method)) {
      writeBridgeLog('warn', 'Declined unsupported app-server request', {
        requestId,
        method,
        threadId: this.readServerRequestThreadId(params),
        turnId: readTurnIdFromPayload(params),
      })
      this.sendServerRequestReply(requestId, {
        result: this.buildUnsupportedServerRequestResult(method),
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

      this.sendLine({
        jsonrpc: '2.0',
        id,
        method,
        params,
      } satisfies JsonRpcCall)
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (this.initializePromise) {
      await this.initializePromise
      return
    }

    this.initializePromise = this.call('initialize', {
      clientInfo: {
        name: 'codex-web-local',
        version: '0.1.0',
      },
    }).then(() => {
      this.initialized = true
    }).finally(() => {
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

    const body = asRecord(payload)
    if (!body) {
      throw new Error('Invalid response payload: expected object')
    }

    const id = body.id
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new Error('Invalid response payload: "id" must be an integer')
    }

    const rawError = asRecord(body.error)
    if (rawError) {
      const message = typeof rawError.message === 'string' && rawError.message.trim().length > 0
        ? rawError.message.trim()
        : 'Server request rejected by client'
      const code = typeof rawError.code === 'number' && Number.isFinite(rawError.code)
        ? Math.trunc(rawError.code)
        : -32000
      this.resolvePendingServerRequest(id, { error: { code, message } })
      return
    }

    if (!('result' in body)) {
      throw new Error('Invalid response payload: expected "result" or "error"')
    }

    this.resolvePendingServerRequest(id, { result: body.result })
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return this.pendingServerRequests.list()
  }

  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[] {
    return this.pendingServerRequests.listForThread(threadId, (params) => this.readServerRequestThreadId(params))
  }

  getThreadTokenUsage(threadId: string): ThreadTokenUsage | null {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null
    return this.threadTokenUsageByThreadId.get(normalizedThreadId) ?? null
  }

  getStatus(): AppServerHealth {
    return {
      running: this.process !== null,
      initialized: this.initialized,
      stopping: this.stopping,
      pid: this.process?.pid ?? null,
      pendingRpcCount: this.pending.size,
      queuedRpcCount: this.rpcQueue.count,
      pendingServerRequestCount: this.pendingServerRequests.count,
      activePlanModeTurnCount: this.planModeTurnsByThreadId.size,
      rpcDiagnostics: this.rpcDiagnostics.snapshot(this.pending.size, this.rpcQueue.count),
    }
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
    this.threadTokenUsageByThreadId.clear()

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

class MethodCatalog {
  private methodCache: string[] | null = null
  private notificationCache: string[] | null = null

  private async runGenerateSchemaCommand(outDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const codexCommand = resolveCodexCommand()
      if (!codexCommand) {
        reject(new Error('Codex CLI is not available. Install @openai/codex or set CX_CODEX_CODEX_COMMAND.'))
        return
      }

      const invocation = getSpawnInvocation(codexCommand, ['app-server', 'generate-json-schema', '--out', outDir])
      const process = spawn(invocation.command, invocation.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      })

      let stderr = ''

      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      process.on('error', reject)
      process.on('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }

        reject(new Error(stderr.trim() || `generate-json-schema exited with code ${String(code)}`))
      })
    })
  }

  private extractMethodsFromClientRequest(payload: unknown): string[] {
    const root = asRecord(payload)
    const oneOf = Array.isArray(root?.oneOf) ? root.oneOf : []
    const methods = new Set<string>()

    for (const entry of oneOf) {
      const row = asRecord(entry)
      const properties = asRecord(row?.properties)
      const methodDef = asRecord(properties?.method)
      const methodEnum = Array.isArray(methodDef?.enum) ? methodDef.enum : []

      for (const item of methodEnum) {
        if (typeof item === 'string' && item.length > 0) {
          methods.add(item)
        }
      }
    }

    return Array.from(methods).sort((a, b) => a.localeCompare(b))
  }

  private extractMethodsFromServerNotification(payload: unknown): string[] {
    const root = asRecord(payload)
    const oneOf = Array.isArray(root?.oneOf) ? root.oneOf : []
    const methods = new Set<string>()

    for (const entry of oneOf) {
      const row = asRecord(entry)
      const properties = asRecord(row?.properties)
      const methodDef = asRecord(properties?.method)
      const methodEnum = Array.isArray(methodDef?.enum) ? methodDef.enum : []

      for (const item of methodEnum) {
        if (typeof item === 'string' && item.length > 0) {
          methods.add(item)
        }
      }
    }

    return Array.from(methods).sort((a, b) => a.localeCompare(b))
  }

  async listMethods(): Promise<string[]> {
    if (this.methodCache) {
      return this.methodCache
    }

    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    await this.runGenerateSchemaCommand(outDir)

    const clientRequestPath = join(outDir, 'ClientRequest.json')
    const raw = await readFile(clientRequestPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const methods = this.extractMethodsFromClientRequest(parsed)

    this.methodCache = methods
    return methods
  }

  async listNotificationMethods(): Promise<string[]> {
    if (this.notificationCache) {
      return this.notificationCache
    }

    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    await this.runGenerateSchemaCommand(outDir)

    const serverNotificationPath = join(outDir, 'ServerNotification.json')
    const raw = await readFile(serverNotificationPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const methods = this.extractMethodsFromServerNotification(parsed)

    this.notificationCache = methods
    return methods
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
  methodCatalog: MethodCatalog
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
    methodCatalog: new MethodCatalog(),
  }
  globalScope[SHARED_BRIDGE_KEY] = created
  return created
}

async function loadAllThreadsForSearch(appServer: AppServerProcess): Promise<ThreadSearchDocument[]> {
  const threadsById = new Map<string, { id: string; title: string; preview: string }>()

  for (const archived of [false, true]) {
    let cursor: string | null = null

    do {
      const response = asRecord(await appServer.rpc('thread/list', {
        archived,
        limit: 100,
        sortKey: 'updated_at',
        cursor,
      }))
      const data = Array.isArray(response?.data) ? response.data : []
      for (const row of data) {
        const record = asRecord(row)
        const id = typeof record?.id === 'string' ? record.id : ''
        if (!id || threadsById.has(id)) continue
        const title = typeof record?.name === 'string' && record.name.trim().length > 0
          ? record.name.trim()
          : (typeof record?.preview === 'string' && record.preview.trim().length > 0 ? record.preview.trim() : 'Untitled thread')
        const preview = typeof record?.preview === 'string' ? record.preview : ''
        threadsById.set(id, { id, title, preview })
      }
      cursor = typeof response?.nextCursor === 'string' && response.nextCursor.length > 0 ? response.nextCursor : null
    } while (cursor)
  }

  const sessionIndexCache = await readThreadTitlesFromSessionIndex()
  for (const id of sessionIndexCache.order) {
    if (threadsById.has(id)) continue
    const title = sessionIndexCache.titles[id]?.trim() ?? ''
    if (!title) continue
    threadsById.set(id, { id, title, preview: '' })
  }

  return Array.from(threadsById.values()).map((thread) => ({
    id: thread.id,
    title: thread.title,
    preview: thread.preview,
    messageText: '',
    searchableText: thread.title,
  }))
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

async function buildThreadSearchIndex(appServer: AppServerProcess): Promise<ThreadSearchIndex> {
  const docs = await loadAllThreadsForSearch(appServer)
  const docsById = new Map<string, ThreadSearchDocument>(docs.map((doc) => [doc.id, doc]))
  return { docsById }
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const { appServer, methodCatalog } = getSharedBridgeState()
  let threadSearchIndex: ThreadSearchIndex | null = null
  let threadSearchIndexPromise: Promise<ThreadSearchIndex> | null = null
  const cachedThreadReadsByThreadId = new Map<string, CachedThreadRead>()
  const runtimeStateStore = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload,
    getErrorMessage,
  })
  const runtimeStore = new RuntimeStore()
  const notificationReplayBuffer: BridgeNotificationEvent[] = []
  const bridgeNotificationListeners = new Set<(value: BridgeNotificationEvent) => void>()
  let notificationSeq = runtimeStore.getLatestEventSeq()

  async function getThreadSearchIndex(): Promise<ThreadSearchIndex> {
    if (threadSearchIndex) return threadSearchIndex
    if (!threadSearchIndexPromise) {
      threadSearchIndexPromise = buildThreadSearchIndex(appServer)
        .then((index) => {
          threadSearchIndex = index
          return index
        })
        .finally(() => {
          threadSearchIndexPromise = null
        })
    }
    return threadSearchIndexPromise
  }

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
    const event: BridgeNotificationEvent = {
      method: notification.method,
      params: notification.params,
      atIso: new Date().toISOString(),
      seq: notificationSeq,
    }
    runtimeStore.appendEvent({
      seq: event.seq,
      method: event.method,
      params: event.params,
      atIso: event.atIso,
      threadId: readThreadIdFromPayload(event.params),
      turnId: readTurnIdFromPayload(event.params),
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
  void readWebBridgeSettings()
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
        handleFileUpload(req, res)
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/web-settings') {
        const settings = await readWebBridgeSettings()
        appServer.setWebBridgeSettings(settings)
        setJson(res, 200, { data: settings })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/web-settings') {
        const payload = await readJsonBody(req)
        const settings = await writeWebBridgeSettings(normalizeWebBridgeSettings(payload))
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
        setJson(res, 200, {
          status: 'ok',
          data: {
            appServer: appServer.getStatus(),
            runtimeStore: runtimeStore.getHealth(),
            timestamp: new Date().toISOString(),
          },
        })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/diagnostics') {
        const runtimeHealth = runtimeStore.getHealth()
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
            runtimeStore: runtimeHealth,
            runtime: {
              uncertainRequests,
              recentEvents,
            },
            pendingServerRequests: appServer.listPendingServerRequests().map((request) => ({
              id: request.id,
              method: request.method,
              receivedAtIso: request.receivedAtIso,
            })),
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
        const state = await readWorkspaceRootsState()
        setJson(res, 200, { data: state })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
        setJson(res, 200, { data: { path: homedir() } })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/github-trending') {
        const sinceRaw = (url.searchParams.get('since') ?? '').trim().toLowerCase()
        const since: 'daily' | 'weekly' | 'monthly' =
          sinceRaw === 'weekly' ? 'weekly' : sinceRaw === 'monthly' ? 'monthly' : 'daily'
        const limitRaw = Number.parseInt((url.searchParams.get('limit') ?? '6').trim(), 10)
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, limitRaw)) : 6
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
        const incomingDescriptions = Array.isArray(payload?.descriptions) ? payload.descriptions : []
        const descriptions = incomingDescriptions
          .slice(0, GITHUB_DESCRIPTION_TRANSLATION_BATCH_LIMIT)
          .map((value) => (typeof value === 'string' ? value : ''))

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
          const worktreesRoot = join(getCodexHomeDir(), 'worktrees')
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
        const nextState: WorkspaceRootsState = {
          order: normalizeStringArray(record.order),
          labels: normalizeStringRecord(record.labels),
          active: normalizeStringArray(record.active),
        }
        await writeWorkspaceRootsState(nextState)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/project-root') {
        const payload = asRecord(await readJsonBody(req))
        const rawPath = typeof payload?.path === 'string' ? payload.path.trim() : ''
        const createIfMissing = payload?.createIfMissing === true
        const label = typeof payload?.label === 'string' ? payload.label : ''
        if (!rawPath) {
          setJson(res, 400, { error: 'Missing path' })
          return
        }

        const normalizedPath = isAbsolute(rawPath) ? rawPath : resolve(rawPath)
        let pathExists = true
        try {
          const info = await stat(normalizedPath)
          if (!info.isDirectory()) {
            setJson(res, 400, { error: 'Path exists but is not a directory' })
            return
          }
        } catch {
          pathExists = false
        }

        if (!pathExists && createIfMissing) {
          await mkdir(normalizedPath, { recursive: true })
        } else if (!pathExists) {
          setJson(res, 404, { error: 'Directory does not exist' })
          return
        }

        const existingState = await readWorkspaceRootsState()
        const nextOrder = [normalizedPath, ...existingState.order.filter((item) => item !== normalizedPath)]
        const nextActive = [normalizedPath, ...existingState.active.filter((item) => item !== normalizedPath)]
        const nextLabels = { ...existingState.labels }
        if (label.trim().length > 0) {
          nextLabels[normalizedPath] = label.trim()
        }
        await writeWorkspaceRootsState({
          order: nextOrder,
          labels: nextLabels,
          active: nextActive,
        })
        setJson(res, 200, { data: { path: normalizedPath } })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/project-root-suggestion') {
        const basePath = url.searchParams.get('basePath')?.trim() ?? ''
        if (!basePath) {
          setJson(res, 400, { error: 'Missing basePath' })
          return
        }
        const normalizedBasePath = isAbsolute(basePath) ? basePath : resolve(basePath)
        try {
          const baseInfo = await stat(normalizedBasePath)
          if (!baseInfo.isDirectory()) {
            setJson(res, 400, { error: 'basePath is not a directory' })
            return
          }
        } catch {
          setJson(res, 404, { error: 'basePath does not exist' })
          return
        }

        let index = 1
        while (index < 100000) {
          const candidateName = `New Project (${String(index)})`
          const candidatePath = join(normalizedBasePath, candidateName)
          try {
            await stat(candidatePath)
            index += 1
            continue
          } catch {
            setJson(res, 200, { data: { name: candidateName, path: candidatePath } })
            return
          }
        }

        setJson(res, 500, { error: 'Failed to compute project name suggestion' })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/composer-file-search') {
        const payload = asRecord(await readJsonBody(req))
        const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
        const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
        const limitRaw = typeof payload?.limit === 'number' ? payload.limit : 20
        const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
        if (!rawCwd) {
          setJson(res, 400, { error: 'Missing cwd' })
          return
        }
        const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
        try {
          const info = await stat(cwd)
          if (!info.isDirectory()) {
            setJson(res, 400, { error: 'cwd is not a directory' })
            return
          }
        } catch {
          setJson(res, 404, { error: 'cwd does not exist' })
          return
        }

        try {
          const files = await listFilesWithRipgrep(cwd)
          const scored = files
            .map((path) => ({ path, score: scoreFileCandidate(path, query) }))
            .filter((row) => query.length === 0 || row.score < 10)
            .sort((a, b) => (a.score - b.score) || a.path.localeCompare(b.path))
            .slice(0, limit)
            .map((row) => ({ path: row.path }))
          setJson(res, 200, { data: scored })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to search files') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-titles') {
        const cache = await readMergedThreadTitleCache()
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

        const index = await getThreadSearchIndex()
        const matchedIds = Array.from(index.docsById.entries())
          .filter(([, doc]) => isExactPhraseMatch(query, doc))
          .slice(0, limit)
          .map(([id]) => id)

        setJson(res, 200, { data: { threadIds: matchedIds, indexedThreadCount: index.docsById.size } })
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
        const cache = await readThreadTitleCache()
        const next = title ? updateThreadTitleCache(cache, id, title) : removeFromThreadTitleCache(cache, id)
        await writeThreadTitleCache(next)
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
    threadSearchIndex = null
    bridgeNotificationListeners.clear()
    unsubscribeAppServerNotifications()
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
