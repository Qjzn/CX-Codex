import {
  type RpcConnectionState,
  fetchRpcMethodCatalog,
  fetchRpcNotificationCatalog,
  fetchRpcNotificationReplay,
  fetchPendingServerRequests,
  rpcCall,
  respondServerRequest,
  subscribeRpcNotifications,
  type RpcNotification,
} from './codexRpcClient'
import type {
  ConfigReadResponse,
  GetAccountRateLimitsResponse,
  ModelListResponse,
  ReasoningEffort,
  ThreadListResponse,
  ThreadReadResponse,
  Turn,
} from './appServerDtos'
import { isAbortLikeError, normalizeCodexApiError } from './codexErrors'
import {
  readActiveTurnIdFromResponse,
  normalizeThreadGroupsV2,
  normalizeThreadMessagesV2,
  readThreadInProgressFromResponse,
} from './normalizers/v2'
import type {
  CollaborationMode,
  ComposerModelInfo,
  ComposerPluginInfo,
  ComposerPluginSelection,
  ComposerTurnOptions,
  PluginAuthStatus,
  SpeedMode,
  UiMessage,
  UiProjectGroup,
  UiThreadTokenUsage,
  UiTokenUsageBreakdown,
} from '../types/codex'
import { normalizePathForUi } from '../pathUtils.js'
import { shouldAutoLoginForResponse, tryMobileShellAutoLogin } from '../mobile/mobileAuth'

type CurrentModelConfig = {
  model: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
}

type RpcCallOptions = { signal?: AbortSignal }
type ThreadListOptions = RpcCallOptions & {
  maxPages?: number
}
type ThreadDetailOptions = RpcCallOptions & {
  responseView?: 'full' | 'older'
  beforeTurnIndex?: number
  turnLimit?: number
}
type ProjectRootSuggestion = { name: string; path: string }
type CachedProjectRootSuggestion = {
  value: ProjectRootSuggestion
  cachedAtMs: number
}
type CachedWorkspaceRootsState = {
  value: WorkspaceRootsState
  cachedAtMs: number
}
type CachedThreadRuntimeSnapshot = {
  value: ThreadRuntimeSnapshot
  cachedAtMs: number
}

const PROJECT_ROOT_SUGGESTION_CACHE_TTL_MS = 2000
const WORKSPACE_ROOTS_STATE_CACHE_TTL_MS = 2000
const THREAD_RUNTIME_SNAPSHOT_CACHE_TTL_MS = 900
const projectRootSuggestionCacheByBasePath = new Map<string, CachedProjectRootSuggestion>()
const projectRootSuggestionInFlightByBasePath = new Map<string, Promise<ProjectRootSuggestion>>()
const threadRuntimeSnapshotCacheByThreadId = new Map<string, CachedThreadRuntimeSnapshot>()
const threadRuntimeSnapshotInFlightByThreadId = new Map<string, Promise<ThreadRuntimeSnapshot>>()
let workspaceRootsStateCache: CachedWorkspaceRootsState | null = null
let workspaceRootsStateInFlight: Promise<WorkspaceRootsState> | null = null
let projectRootSuggestionCacheGeneration = 0
let workspaceRootsStateCacheGeneration = 0

export type RuntimeExecutionState =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'start_uncertain'
  | 'running'
  | 'waiting_permission'
  | 'stopping'
  | 'stop_uncertain'
  | 'completed_pending_sync'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'stopped'
  | 'sync_degraded'

export type ThreadRuntimeSnapshot = {
  messages: UiMessage[]
  executionState: RuntimeExecutionState
  inProgress: boolean
  activeTurnId: string
  activeItemId: string
  canStop: boolean
  stopRequested: boolean
  updatedAtIso: string
  lastEventSeq: number
  lastEventAtIso: string | null
  lastStartedAtIso: string | null
  lastCompletedAtIso: string | null
  lastError: string | null
  stale: boolean
  degradedReason: string | null
  messageState: 'fresh' | 'cached' | 'unavailable'
  pendingServerRequests: unknown[]
  tokenUsage: UiThreadTokenUsage | null
}

function isRuntimeSnapshotCacheable(snapshot: ThreadRuntimeSnapshot): boolean {
  return (
    snapshot.stale !== true &&
    snapshot.inProgress !== true &&
    snapshot.executionState !== 'queued' &&
    snapshot.executionState !== 'starting' &&
    snapshot.executionState !== 'start_uncertain' &&
    snapshot.executionState !== 'running' &&
    snapshot.executionState !== 'waiting_permission' &&
    snapshot.executionState !== 'stopping' &&
    snapshot.executionState !== 'stop_uncertain' &&
    snapshot.executionState !== 'completed_pending_sync' &&
    snapshot.pendingServerRequests.length === 0
  )
}

function readCachedThreadRuntimeSnapshot(threadId: string): ThreadRuntimeSnapshot | null {
  const cached = threadRuntimeSnapshotCacheByThreadId.get(threadId)
  if (!cached) return null
  if (Date.now() - cached.cachedAtMs > THREAD_RUNTIME_SNAPSHOT_CACHE_TTL_MS) {
    threadRuntimeSnapshotCacheByThreadId.delete(threadId)
    return null
  }
  return cached.value
}

function writeCachedThreadRuntimeSnapshot(threadId: string, snapshot: ThreadRuntimeSnapshot): void {
  if (!isRuntimeSnapshotCacheable(snapshot)) {
    threadRuntimeSnapshotCacheByThreadId.delete(threadId)
    return
  }
  threadRuntimeSnapshotCacheByThreadId.set(threadId, {
    value: snapshot,
    cachedAtMs: Date.now(),
  })
  while (threadRuntimeSnapshotCacheByThreadId.size > 20) {
    const oldestKey = threadRuntimeSnapshotCacheByThreadId.keys().next().value
    if (typeof oldestKey !== 'string') break
    threadRuntimeSnapshotCacheByThreadId.delete(oldestKey)
  }
}

function throwIfSignalAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new DOMException('Aborted', 'AbortError')
}

export type RuntimeRequestStatus =
  | 'pending_start'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'start_uncertain'
  | 'stopping'
  | 'stop_uncertain'
  | 'stopped'
  | 'interrupted'
  | 'still_running'
  | 'sync_degraded'

export type RuntimeTurnStartResult = {
  requestId: string
  threadId: string
  turnId: string
  status: RuntimeRequestStatus
}

export type RuntimeRequestLookupResult = {
  requestId: string
  clientMessageId: string
  threadId: string
  turnId: string
  status: RuntimeRequestStatus
  lastError: string | null
}

export type WorkspaceRootsState = {
  order: string[]
  labels: Record<string, string>
  active: string[]
  projectOrder: string[]
  pinnedProjectIds: string[]
}

export type ComposerFileSuggestion = {
  path: string
}

export type WorktreeCreateResult = {
  cwd: string
  branch: string
  gitRoot: string
}

export type WorktreeAutoCommitResult = {
  committed: boolean
}

export type WorktreeRollbackResult = {
  reset: boolean
  commitSha: string
  stashed: boolean
}

export type ThreadSearchResult = {
  threadIds: string[]
  indexedThreadCount: number
}

export type PermissionDecision = 'ask' | 'allowForSession'

export type WebBridgeSettings = {
  permissions: {
    allowAllPermissionRequests: boolean
    commandExecution: PermissionDecision
    fileChange: PermissionDecision
    mcpTools: PermissionDecision
  }
}

export type DesktopAppStatus = {
  available: boolean
  platform: string
  appInstalled: boolean
  appRunning: boolean
  appUserModelId: string
  reason: string
}

export type DesktopAppRefreshResult = {
  requested: boolean
  message: string
}

export type TunnelStatus = {
  enabled: boolean | null
  active: boolean
  publicUrl: string
  configPath: string
  configuredCommand: string
  resolvedCommand: string
  cloudflaredAvailable: boolean
  logPath: string
  lastDetectedAtIso: string
  reason: string
}

export type TunnelConfigUpdate = {
  enabled?: boolean | null
  cloudflaredCommand?: string
}

export type FavoriteRecord = {
  id: string
  threadId: string
  messageId: string
  threadTitle: string
  threadCwd: string
  role: 'user' | 'assistant' | 'system'
  text: string
  preview: string
  turnIndex: number | null
  favoritedAtIso: string
}

export type GithubTrendingProject = {
  id: number
  fullName: string
  owner: string
  repo: string
  url: string
  description: string
  descriptionZh?: string
  language: string
  languageLabel?: string
  stars: number
}

export type GithubTipsScope =
  | 'search-daily'
  | 'search-weekly'
  | 'search-monthly'
  | 'trending-daily'
  | 'trending-weekly'
  | 'trending-monthly'

function normalizeGithubProjectDescription(fullName: string, rawDescription: string): string {
  const description = rawDescription.trim()
  if (!description) return ''
  const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const [owner = '', repo = ''] = fullName.split('/', 2)
  const escapedOwner = owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ownerRepoSpaced = owner && repo
    ? `${escapedOwner}\\s*/\\s*${escapedRepo}`
    : escapedName
  return description
    .replace(/^[★☆*\s:|\-]+/u, '')
    .replace(/^(sponsor|star)\s+/i, '')
    .replace(new RegExp(`^${escapedName}\\s*[-:|]*\\s*`, 'i'), '')
    .replace(new RegExp(`^${ownerRepoSpaced}\\s*[-:|]*\\s*`, 'i'), '')
    .replace(/^(sponsor|star)\s+/i, '')
    .trim()
}

const GITHUB_PROGRAMMING_LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  'c++': 'C++',
  c: 'C',
  'c#': 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  scala: 'Scala',
  shell: 'Shell',
  html: 'HTML',
  css: 'CSS',
  vue: 'Vue',
  svelte: 'Svelte',
}

const githubDescriptionTranslationCache = new Map<string, string>()
const GATEWAY_FETCH_TIMEOUT_MS = 15000
const GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS = 12000
const GATEWAY_UPLOAD_FETCH_TIMEOUT_MS = 30000
const GATEWAY_RUNTIME_FETCH_TIMEOUT_MS = 90000

function hasCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)
}

function shouldTranslateGithubDescription(value: string): boolean {
  const description = value.trim()
  if (!description) return false
  if (hasCjkCharacters(description)) return false
  return /[A-Za-z]/u.test(description)
}

function localizeGithubProgrammingLanguage(language: string): string {
  const normalized = language.trim()
  if (!normalized) return ''
  return GITHUB_PROGRAMMING_LANGUAGE_LABELS[normalized.toLowerCase()] ?? normalized
}

async function localizeGithubProjectsForUi(projects: GithubTrendingProject[]): Promise<GithubTrendingProject[]> {
  if (projects.length === 0) return []

  const uniqueDescriptions: string[] = []
  for (const project of projects) {
    const description = project.description.trim()
    if (!shouldTranslateGithubDescription(description)) continue
    if (githubDescriptionTranslationCache.has(description)) continue
    if (uniqueDescriptions.includes(description)) continue
    uniqueDescriptions.push(description)
  }

  if (uniqueDescriptions.length > 0) {
    try {
      const response = await fetchWithTimeout('/codex-api/github-trending/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          descriptions: uniqueDescriptions,
        }),
      }, {
        timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
        label: 'GitHub trending translation request',
      })

      const payload = (await response.json()) as unknown
      const record =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {}
      const data =
        record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {}
      const translations = Array.isArray(data.translations) ? data.translations : []

      uniqueDescriptions.forEach((description, index) => {
        const translated = typeof translations[index] === 'string' ? translations[index].trim() : ''
        if (translated) {
          githubDescriptionTranslationCache.set(description, translated)
        }
      })
    } catch {
      // Fall back to original GitHub descriptions when translation is unavailable.
    }
  }

  return projects.map((project) => {
    const description = project.description.trim()
    const translatedDescription =
      shouldTranslateGithubDescription(description)
        ? (githubDescriptionTranslationCache.get(description) ?? '')
        : description

    return {
      ...project,
      descriptionZh: translatedDescription || undefined,
      languageLabel: localizeGithubProgrammingLanguage(project.language),
    }
  })
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    timeoutMs?: number
    label?: string
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? GATEWAY_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const upstreamSignal = init.signal
  let didTimeout = false
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)

  const abortFromUpstream = (): void => {
    controller.abort()
  }

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort()
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true })
    }
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    if (shouldAutoLoginForResponse(response) && await tryMobileShellAutoLogin()) {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      })
    }
    return response
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === 'AbortError' && !upstreamSignal?.aborted)) {
      const requestLabel = options.label?.trim() || 'Request'
      throw new Error(`${requestLabel} timed out after ${Math.ceil(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}

async function callRpc<T>(method: string, params?: unknown, options: RpcCallOptions = {}): Promise<T> {
  try {
    return await rpcCall<T>(method, params, options)
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error
    }
    throw normalizeCodexApiError(error, `RPC ${method} failed`, method)
  }
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | '' {
  const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  return typeof value === 'string' && allowed.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : ''
}

function normalizeSpeedMode(value: unknown): SpeedMode {
  return typeof value === 'string' && value.trim().toLowerCase() === 'fast'
    ? 'fast'
    : 'standard'
}

function normalizeNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeTokenUsageBreakdown(value: unknown): UiTokenUsageBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const readByAliases = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = record[key]
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate
      }
    }
    return undefined
  }
  return {
    totalTokens: normalizeNonNegativeNumber(readByAliases('totalTokens', 'total_tokens')),
    inputTokens: normalizeNonNegativeNumber(readByAliases('inputTokens', 'input_tokens')),
    cachedInputTokens: normalizeNonNegativeNumber(readByAliases('cachedInputTokens', 'cached_input_tokens')),
    outputTokens: normalizeNonNegativeNumber(readByAliases('outputTokens', 'output_tokens')),
    reasoningOutputTokens: normalizeNonNegativeNumber(readByAliases('reasoningOutputTokens', 'reasoning_output_tokens')),
  }
}

function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const total = normalizeTokenUsageBreakdown(record.total ?? record.total_token_usage)
  const last = normalizeTokenUsageBreakdown(record.last ?? record.last_token_usage)
  if (!total || !last) return null

  const rawModelContextWindow =
    typeof record.modelContextWindow === 'number' && Number.isFinite(record.modelContextWindow)
      ? record.modelContextWindow
      : typeof record.model_context_window === 'number' && Number.isFinite(record.model_context_window)
        ? record.model_context_window
        : null
  const modelContextWindow =
    typeof rawModelContextWindow === 'number' && rawModelContextWindow > 0
      ? Math.max(0, rawModelContextWindow)
      : null
  const rawUsedPercent =
    typeof record.usedPercent === 'number' && Number.isFinite(record.usedPercent)
      ? record.usedPercent
      : typeof record.used_percent === 'number' && Number.isFinite(record.used_percent)
        ? record.used_percent
        : null
  const derivedUsedTokens =
    typeof modelContextWindow === 'number' && modelContextWindow > 0
      ? Math.min(Math.max(last.totalTokens, 0), modelContextWindow)
      : null
  const usedPercent =
    typeof rawUsedPercent === 'number'
      ? Math.min(Math.max(rawUsedPercent, 0), 100)
      : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number' && modelContextWindow > 0
        ? Math.min(Math.max((derivedUsedTokens / modelContextWindow) * 100, 0), 100)
        : null
  const rawRemainingTokens =
    typeof record.remainingTokens === 'number' && Number.isFinite(record.remainingTokens)
      ? record.remainingTokens
      : typeof record.remaining_tokens === 'number' && Number.isFinite(record.remaining_tokens)
        ? record.remaining_tokens
        : null
  const remainingTokens =
    typeof rawRemainingTokens === 'number'
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

async function listThreadsByArchiveState(
  archived: boolean,
  options: ThreadListOptions = {},
): Promise<ThreadListResponse['data']> {
  const data: ThreadListResponse['data'] = []
  let cursor: string | null = null
  const maxPages = typeof options.maxPages === 'number' && Number.isFinite(options.maxPages) && options.maxPages > 0
    ? Math.trunc(options.maxPages)
    : Number.POSITIVE_INFINITY
  let pageCount = 0

  do {
    pageCount += 1
    let payload: ThreadListResponse
    try {
      payload = await callRpc<ThreadListResponse>('thread/list', {
        archived,
        limit: 100,
        sortKey: 'updated_at',
        cursor,
      }, options)
    } catch (error) {
      if (cursor && data.length > 0 && !isAbortLikeError(error)) {
        console.warn('Stopped thread/list pagination after a cursor error', error)
        break
      }
      throw error
    }
    data.push(...payload.data)
    cursor = typeof payload.nextCursor === 'string' && payload.nextCursor.length > 0
      ? payload.nextCursor
      : null
  } while (cursor && pageCount < maxPages)

  return data
}

async function getThreadGroupsV2(options: ThreadListOptions = {}): Promise<UiProjectGroup[]> {
  const data = await listThreadsByArchiveState(false, options)
  return normalizeThreadGroupsV2({ data, nextCursor: null })
}

async function getThreadMessagesV2(threadId: string, options: RpcCallOptions = {}): Promise<UiMessage[]> {
  const payload = await callRpc<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: true,
  }, options)
  return normalizeThreadMessagesV2(payload)
}

async function getThreadDetailV2(
  threadId: string,
  options: ThreadDetailOptions = {},
): Promise<{ messages: UiMessage[]; inProgress: boolean; activeTurnId: string }> {
  const payload = await callRpc<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: true,
    ...(options.responseView === 'full' ? { responseView: 'full' } : {}),
    ...(options.responseView === 'older' ? { responseView: 'older' } : {}),
    ...(typeof options.beforeTurnIndex === 'number' ? { beforeTurnIndex: options.beforeTurnIndex } : {}),
    ...(typeof options.turnLimit === 'number' ? { turnLimit: options.turnLimit } : {}),
  }, options)
  return {
    messages: normalizeThreadMessagesV2(payload),
    inProgress: readThreadInProgressFromResponse(payload),
    activeTurnId: readActiveTurnIdFromResponse(payload),
  }
}

export async function getThreadRuntimeSnapshot(
  threadId: string,
  options: RpcCallOptions = {},
): Promise<ThreadRuntimeSnapshot> {
  const normalizedThreadId = threadId.trim()
  throwIfSignalAborted(options.signal)

  const cachedSnapshot = readCachedThreadRuntimeSnapshot(normalizedThreadId)
  if (cachedSnapshot) {
    return cachedSnapshot
  }

  if (options.signal) {
    const snapshot = await fetchThreadRuntimeSnapshot(normalizedThreadId, options.signal)
    throwIfSignalAborted(options.signal)
    return snapshot
  }

  const inFlightSnapshot = threadRuntimeSnapshotInFlightByThreadId.get(normalizedThreadId)
  if (inFlightSnapshot) {
    const snapshot = await inFlightSnapshot
    throwIfSignalAborted(options.signal)
    return snapshot
  }

  const request = fetchThreadRuntimeSnapshot(normalizedThreadId)
  threadRuntimeSnapshotInFlightByThreadId.set(normalizedThreadId, request)
  try {
    const snapshot = await request
    throwIfSignalAborted(options.signal)
    return snapshot
  } finally {
    if (threadRuntimeSnapshotInFlightByThreadId.get(normalizedThreadId) === request) {
      threadRuntimeSnapshotInFlightByThreadId.delete(normalizedThreadId)
    }
  }
}

async function fetchThreadRuntimeSnapshot(
  normalizedThreadId: string,
  signal?: AbortSignal,
): Promise<ThreadRuntimeSnapshot> {
  const response = await fetchWithTimeout(`/codex-api/state/thread/${encodeURIComponent(normalizedThreadId)}`, {
    signal,
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: `Thread state snapshot request for ${normalizedThreadId}`,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to load thread snapshot ${normalizedThreadId}`))
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  const threadRead = data.threadRead as ThreadReadResponse | undefined
  const updatedAtIso = typeof data.updatedAtIso === 'string' ? data.updatedAtIso.trim() : ''
  const rawMessageState = typeof data.messageState === 'string' ? data.messageState.trim() : ''
  const messageState: ThreadRuntimeSnapshot['messageState'] =
    rawMessageState === 'cached' || rawMessageState === 'unavailable'
      ? rawMessageState
      : 'fresh'
  const pendingServerRequests = Array.isArray(data.pendingServerRequests) ? data.pendingServerRequests : []
  const tokenUsage = normalizeThreadTokenUsage(data.tokenUsage)
  const rawExecutionState = typeof data.executionState === 'string' ? data.executionState.trim() : ''
  const executionState: RuntimeExecutionState =
    rawExecutionState === 'queued' ||
    rawExecutionState === 'starting' ||
    rawExecutionState === 'start_uncertain' ||
    rawExecutionState === 'running' ||
    rawExecutionState === 'waiting_permission' ||
    rawExecutionState === 'stopping' ||
    rawExecutionState === 'stop_uncertain' ||
    rawExecutionState === 'completed_pending_sync' ||
    rawExecutionState === 'completed' ||
    rawExecutionState === 'failed' ||
    rawExecutionState === 'interrupted' ||
    rawExecutionState === 'stopped' ||
    rawExecutionState === 'sync_degraded'
      ? rawExecutionState
      : 'idle'
  const activeItemId = typeof data.activeItemId === 'string' ? data.activeItemId.trim() : ''
  const lastEventSeq = typeof data.lastEventSeq === 'number' && Number.isFinite(data.lastEventSeq)
    ? Math.max(0, Math.trunc(data.lastEventSeq))
    : 0
  const readNullableString = (value: unknown): string | null => (
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  )

  const snapshot: ThreadRuntimeSnapshot = {
    messages: threadRead ? normalizeThreadMessagesV2(threadRead) : [],
    executionState,
    inProgress:
      data.inProgress === true ||
      (threadRead ? readThreadInProgressFromResponse(threadRead) : false),
    activeTurnId:
      typeof data.activeTurnId === 'string' && data.activeTurnId.trim().length > 0
        ? data.activeTurnId.trim()
        : (threadRead ? readActiveTurnIdFromResponse(threadRead) : ''),
    activeItemId,
    canStop: data.canStop === true,
    stopRequested: data.stopRequested === true,
    updatedAtIso,
    lastEventSeq,
    lastEventAtIso: readNullableString(data.lastEventAtIso),
    lastStartedAtIso: readNullableString(data.lastStartedAtIso),
    lastCompletedAtIso: readNullableString(data.lastCompletedAtIso),
    lastError: readNullableString(data.lastError),
    stale: data.stale === true,
    degradedReason: readNullableString(data.degradedReason),
    messageState,
    pendingServerRequests,
    tokenUsage,
  }
  writeCachedThreadRuntimeSnapshot(normalizedThreadId, snapshot)
  return snapshot
}

export async function getThreadRuntimeStatusSnapshot(
  threadId: string,
  options: RpcCallOptions = {},
): Promise<ThreadRuntimeSnapshot> {
  const response = await fetchWithTimeout(`/codex-api/runtime/thread/${encodeURIComponent(threadId)}`, {
    signal: options.signal,
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: `Thread runtime snapshot request for ${threadId}`,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to load runtime snapshot ${threadId}`))
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  const snapshotData =
    data.snapshot && typeof data.snapshot === 'object' && !Array.isArray(data.snapshot)
      ? (data.snapshot as Record<string, unknown>)
      : data
  const rawExecutionState = typeof snapshotData.executionState === 'string' ? snapshotData.executionState.trim() : ''
  const executionState: RuntimeExecutionState =
    rawExecutionState === 'queued' ||
    rawExecutionState === 'starting' ||
    rawExecutionState === 'start_uncertain' ||
    rawExecutionState === 'running' ||
    rawExecutionState === 'waiting_permission' ||
    rawExecutionState === 'stopping' ||
    rawExecutionState === 'stop_uncertain' ||
    rawExecutionState === 'completed_pending_sync' ||
    rawExecutionState === 'completed' ||
    rawExecutionState === 'failed' ||
    rawExecutionState === 'interrupted' ||
    rawExecutionState === 'stopped' ||
    rawExecutionState === 'sync_degraded'
      ? rawExecutionState
      : 'idle'
  const readNullableString = (value: unknown): string | null => (
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  )
  const rawMessageState = typeof snapshotData.messageState === 'string' ? snapshotData.messageState.trim() : ''
  const messageState: ThreadRuntimeSnapshot['messageState'] =
    rawMessageState === 'fresh' || rawMessageState === 'cached' || rawMessageState === 'unavailable'
      ? rawMessageState
      : 'unavailable'

  return {
    messages: [],
    executionState,
    inProgress: snapshotData.inProgress === true,
    activeTurnId: typeof snapshotData.activeTurnId === 'string' ? snapshotData.activeTurnId.trim() : '',
    activeItemId: typeof snapshotData.activeItemId === 'string' ? snapshotData.activeItemId.trim() : '',
    canStop: snapshotData.canStop === true,
    stopRequested: snapshotData.stopRequested === true,
    updatedAtIso: typeof snapshotData.updatedAtIso === 'string' ? snapshotData.updatedAtIso.trim() : '',
    lastEventSeq: typeof snapshotData.lastEventSeq === 'number' && Number.isFinite(snapshotData.lastEventSeq)
      ? Math.max(0, Math.trunc(snapshotData.lastEventSeq))
      : 0,
    lastEventAtIso: readNullableString(snapshotData.lastEventAtIso),
    lastStartedAtIso: readNullableString(snapshotData.lastStartedAtIso),
    lastCompletedAtIso: readNullableString(snapshotData.lastCompletedAtIso),
    lastError: readNullableString(snapshotData.lastError),
    stale: snapshotData.stale === true,
    degradedReason: readNullableString(snapshotData.degradedReason),
    messageState,
    pendingServerRequests: Array.isArray(snapshotData.pendingServerRequests) ? snapshotData.pendingServerRequests : [],
    tokenUsage: normalizeThreadTokenUsage(snapshotData.tokenUsage),
  }
}

export async function getThreadTokenUsage(
  threadId: string,
  options: RpcCallOptions = {},
): Promise<UiThreadTokenUsage | null> {
  const response = await fetchWithTimeout(`/codex-api/thread-token-usage?threadId=${encodeURIComponent(threadId)}`, {
    signal: options.signal,
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: `Thread token usage request for ${threadId}`,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to load thread token usage ${threadId}`))
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return normalizeThreadTokenUsage(data.tokenUsage)
}

export async function getThreadGroups(options: ThreadListOptions = {}): Promise<UiProjectGroup[]> {
  try {
    return await getThreadGroupsV2(options)
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error
    }
    throw normalizeCodexApiError(error, 'Failed to load thread groups', 'thread/list')
  }
}

export async function getThreadMessages(threadId: string, options: RpcCallOptions = {}): Promise<UiMessage[]> {
  try {
    return await getThreadMessagesV2(threadId, options)
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error
    }
    throw normalizeCodexApiError(error, `Failed to load thread ${threadId}`, 'thread/read')
  }
}

export async function getThreadDetail(
  threadId: string,
  options: ThreadDetailOptions = {},
): Promise<{ messages: UiMessage[]; inProgress: boolean; activeTurnId: string }> {
  try {
    return await getThreadDetailV2(threadId, options)
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error
    }
    throw normalizeCodexApiError(error, `Failed to load thread ${threadId}`, 'thread/read')
  }
}

export async function getMethodCatalog(): Promise<string[]> {
  return fetchRpcMethodCatalog()
}

export async function getNotificationCatalog(): Promise<string[]> {
  return fetchRpcNotificationCatalog()
}

export async function getNotificationReplay(afterSeq: number, limit = 200): Promise<{ notifications: RpcNotification[]; latestSeq: number; oldestSeq: number }> {
  return fetchRpcNotificationReplay(afterSeq, limit)
}

export function subscribeCodexNotifications(
  onNotification: (value: RpcNotification) => void,
  options: {
    onConnectionStateChange?: (state: RpcConnectionState) => void
    onTransportActivity?: () => void
  } = {},
): () => void {
  return subscribeRpcNotifications(onNotification, options)
}

export type { RpcConnectionState, RpcNotification }

export async function replyToServerRequest(
  id: number,
  payload: { result?: unknown; error?: { code?: number; message: string } },
): Promise<void> {
  await respondServerRequest({
    id,
    ...payload,
  })
}

export async function getPendingServerRequests(options: RpcCallOptions = {}): Promise<unknown[]> {
  return fetchPendingServerRequests(options)
}

export async function resumeThread(threadId: string, options: RpcCallOptions = {}): Promise<void> {
  await callRpc('thread/resume', { threadId }, options)
}

export async function archiveThread(threadId: string): Promise<void> {
  await callRpc('thread/archive', { threadId })
}

export async function renameThread(threadId: string, threadName: string): Promise<void> {
  await callRpc('thread/name/set', { threadId, name: threadName })
}

export async function rollbackThread(threadId: string, numTurns: number): Promise<UiMessage[]> {
  const payload = await callRpc<ThreadReadResponse>('thread/rollback', { threadId, numTurns })
  return normalizeThreadMessagesV2(payload)
}

function normalizeThreadIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>

  const thread = record.thread
  if (thread && typeof thread === 'object') {
    const threadId = (thread as Record<string, unknown>).id
    if (typeof threadId === 'string' && threadId.length > 0) {
      return threadId
    }
  }
  return ''
}

function normalizeRuntimeRequestStatus(value: unknown): RuntimeRequestStatus {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (
    normalized === 'pending_start' ||
    normalized === 'starting' ||
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'start_uncertain' ||
    normalized === 'stopping' ||
    normalized === 'stop_uncertain' ||
    normalized === 'stopped' ||
    normalized === 'interrupted' ||
    normalized === 'still_running' ||
    normalized === 'sync_degraded'
  ) {
    return normalized
  }
  return 'failed'
}

function normalizeRuntimeExecutionState(value: unknown): RuntimeExecutionState {
  const rawExecutionState = typeof value === 'string' ? value.trim() : ''
  return rawExecutionState === 'queued' ||
    rawExecutionState === 'starting' ||
    rawExecutionState === 'start_uncertain' ||
    rawExecutionState === 'running' ||
    rawExecutionState === 'waiting_permission' ||
    rawExecutionState === 'stopping' ||
    rawExecutionState === 'stop_uncertain' ||
    rawExecutionState === 'completed_pending_sync' ||
    rawExecutionState === 'completed' ||
    rawExecutionState === 'failed' ||
    rawExecutionState === 'interrupted' ||
    rawExecutionState === 'stopped' ||
    rawExecutionState === 'sync_degraded'
    ? rawExecutionState
    : 'idle'
}

function normalizeRuntimeTurnStartResult(payload: unknown): RuntimeTurnStartResult {
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? root.data as Record<string, unknown>
      : root
  const request =
    data.request && typeof data.request === 'object' && !Array.isArray(data.request)
      ? data.request as Record<string, unknown>
      : {}
  const requestId =
    typeof data.requestId === 'string' && data.requestId.trim().length > 0
      ? data.requestId.trim()
      : typeof request.requestId === 'string'
        ? request.requestId.trim()
        : ''
  return {
    requestId,
    threadId: typeof data.threadId === 'string' ? data.threadId.trim() : '',
    turnId: typeof data.turnId === 'string' ? data.turnId.trim() : '',
    status: normalizeRuntimeRequestStatus(data.status),
  }
}

function normalizeRuntimeRequestLookupResult(payload: unknown): RuntimeRequestLookupResult | null {
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? root.data as Record<string, unknown>
      : null
  if (!data) return null
  return {
    requestId: typeof data.requestId === 'string' ? data.requestId.trim() : '',
    clientMessageId: typeof data.clientMessageId === 'string' ? data.clientMessageId.trim() : '',
    threadId: typeof data.threadId === 'string' ? data.threadId.trim() : '',
    turnId: typeof data.turnId === 'string' ? data.turnId.trim() : '',
    status: normalizeRuntimeRequestStatus(data.status),
    lastError: typeof data.lastError === 'string' ? data.lastError : null,
  }
}

export async function startThread(cwd?: string, model?: string): Promise<string> {
  try {
    const params: Record<string, unknown> = {}
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      params.cwd = cwd.trim()
    }
    if (typeof model === 'string' && model.trim().length > 0) {
      params.model = model.trim()
    }
    const payload = await callRpc<{ thread?: { id?: string } }>('thread/start', params)
    const threadId = normalizeThreadIdFromPayload(payload)
    if (!threadId) {
      throw new Error('thread/start did not return a thread id')
    }
    return threadId
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to start a new thread', 'thread/start')
  }
}

export async function forkThread(threadId: string, cwd?: string, model?: string): Promise<string> {
  try {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) {
      throw new Error('thread/fork requires threadId')
    }
    const params: Record<string, unknown> = {
      threadId: normalizedThreadId,
    }
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      params.cwd = cwd.trim()
    }
    if (typeof model === 'string' && model.trim().length > 0) {
      params.model = model.trim()
    }
    const payload = await callRpc<{ thread?: { id?: string } }>('thread/fork', params)
    const nextThreadId = normalizeThreadIdFromPayload(payload)
    if (!nextThreadId) {
      throw new Error('thread/fork did not return a thread id')
    }
    return nextThreadId
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to fork thread ${threadId}`, 'thread/fork')
  }
}

export type FileAttachmentParam = { label: string; path: string; fsPath: string }

function buildTextWithAttachments(
  prompt: string,
  files: FileAttachmentParam[],
): string {
  if (files.length === 0) return prompt
  let prefix = '# Files mentioned by the user:\n'
  for (const f of files) {
    prefix += `\n## ${f.label}: ${f.path}\n`
  }
  return `${prefix}\n## My request for Codex:\n\n${prompt}\n`
}

function isLocalImageInput(value: string): boolean {
  if (!value) return false
  if (value.startsWith('/codex-local-image?')) return false
  if (value.startsWith('file://')) return true
  if (/^[A-Za-z]:[\\/]/u.test(value)) return true
  return value.startsWith('/')
}

function buildTurnStartInput(
  text: string,
  imageUrls: string[] = [],
  skills?: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[] = [],
  plugins?: ComposerPluginSelection[],
): Array<Record<string, unknown>> {
  const finalText = buildTextWithAttachments(text, fileAttachments)
  const input: Array<Record<string, unknown>> = [{ type: 'text', text: finalText }]
  for (const imageUrl of imageUrls) {
    const normalizedUrl = imageUrl.trim()
    if (!normalizedUrl) continue
    if (isLocalImageInput(normalizedUrl)) {
      input.push({
        type: 'localImage',
        path: normalizedUrl,
      })
      continue
    }
    input.push({
      type: 'image',
      url: normalizedUrl,
      image_url: normalizedUrl,
    })
  }
  if (skills) {
    for (const skill of skills) {
      input.push({ type: 'skill', name: skill.name, path: skill.path })
    }
  }
  if (plugins) {
    for (const plugin of plugins) {
      const name = plugin.name.trim()
      const id = plugin.id.trim()
      const path = plugin.path?.trim() || (plugin.source === 'app' ? `app://${id}` : `plugin://${id}`)
      if (!name || !path) continue
      input.push({ type: 'mention', name, path })
    }
  }
  return input
}

export async function startThreadTurn(
  threadId: string,
  text: string,
  imageUrls: string[] = [],
  model?: string,
  effort?: ReasoningEffort,
  skills?: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[] = [],
  collaborationMode: CollaborationMode = 'execute',
): Promise<string> {
  try {
    const input = buildTurnStartInput(text, imageUrls, skills, fileAttachments)
    const attachments = fileAttachments.map((f) => ({ label: f.label, path: f.path, fsPath: f.fsPath }))
    const params: Record<string, unknown> = {
      threadId,
      input,
    }
    if (collaborationMode === 'plan') {
      params.collaborationMode = 'plan'
    }
    if (attachments.length > 0) params.attachments = attachments
    if (typeof model === 'string' && model.length > 0) {
      params.model = model
    }
    if (typeof effort === 'string' && effort.length > 0) {
      params.effort = effort
    }
    const payload = await callRpc<{ turn?: Turn }>('turn/start', params)
    return typeof payload?.turn?.id === 'string' ? payload.turn.id.trim() : ''
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to start turn for thread ${threadId}`, 'turn/start')
  }
}

export async function startRuntimeThreadTurn(args: {
  threadId?: string
  cwd?: string
  text: string
  imageUrls?: string[]
  model?: string
  effort?: ReasoningEffort
  skills?: Array<{ name: string; path: string }>
  fileAttachments?: FileAttachmentParam[]
  collaborationMode?: CollaborationMode
  turnOptions?: ComposerTurnOptions
  clientMessageId?: string
}): Promise<RuntimeTurnStartResult> {
  const fileAttachments = args.fileAttachments ?? []
  const body: Record<string, unknown> = {
    threadId: args.threadId?.trim() ?? '',
    cwd: args.cwd?.trim() ?? '',
    input: buildTurnStartInput(args.text, args.imageUrls ?? [], args.skills, fileAttachments, args.turnOptions?.plugins),
    attachments: fileAttachments.map((f) => ({ label: f.label, path: f.path, fsPath: f.fsPath })),
    collaborationMode: args.collaborationMode ?? 'execute',
    turnOptions: args.turnOptions,
    clientMessageId: args.clientMessageId ?? '',
  }
  if (args.model?.trim()) body.model = args.model.trim()
  if (args.effort?.trim()) body.effort = args.effort.trim()

  const response = await fetchWithTimeout('/codex-api/runtime/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    timeoutMs: GATEWAY_RUNTIME_FETCH_TIMEOUT_MS,
    label: 'Runtime turn start request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok && response.status !== 202) {
    throw new Error(getErrorMessageFromPayload(payload, 'Failed to start runtime turn'))
  }
  return normalizeRuntimeTurnStartResult(payload)
}

export async function getRuntimeRequestByClientMessageId(clientMessageId: string): Promise<RuntimeRequestLookupResult | null> {
  const normalizedClientMessageId = clientMessageId.trim()
  if (!normalizedClientMessageId) return null
  const response = await fetchWithTimeout(
    `/codex-api/runtime/request?clientMessageId=${encodeURIComponent(normalizedClientMessageId)}`,
    { method: 'GET' },
    {
      timeoutMs: GATEWAY_FETCH_TIMEOUT_MS,
      label: 'Runtime request lookup',
    },
  )
  if (response.status === 404) return null
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, 'Failed to look up runtime request'))
  }
  return normalizeRuntimeRequestLookupResult(payload)
}

export async function interruptThreadTurn(threadId: string, turnId?: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedTurnId = turnId?.trim() || ''
  if (!normalizedThreadId) return

  try {
    if (!normalizedTurnId) {
      throw new Error('turn/interrupt requires turnId')
    }
    await callRpc('turn/interrupt', { threadId: normalizedThreadId, turnId: normalizedTurnId })
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to interrupt turn for thread ${normalizedThreadId}`, 'turn/interrupt')
  }
}

export type RuntimeInterruptSource = 'composer-stop' | 'runtime-status-stop' | 'unknown'

export type RuntimeInterruptAudit = {
  source?: RuntimeInterruptSource
  requestedAtIso?: string
  clientElapsedMs?: number | null
  userAgent?: string
}

export async function interruptRuntimeThreadTurn(
  threadId: string,
  turnId?: string,
  audit: RuntimeInterruptAudit = {},
): Promise<RuntimeTurnStartResult> {
  const normalizedThreadId = threadId.trim()
  const normalizedTurnId = turnId?.trim() || ''
  if (!normalizedThreadId) {
    return { requestId: '', threadId: '', turnId: '', status: 'failed' }
  }
  if (!normalizedTurnId) {
    throw new Error('runtime/interrupt requires turnId')
  }
  const response = await fetchWithTimeout('/codex-api/runtime/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      source: audit.source ?? 'unknown',
      requestedAtIso: audit.requestedAtIso,
      clientElapsedMs: audit.clientElapsedMs,
      userAgent: audit.userAgent,
    }),
  }, {
    timeoutMs: GATEWAY_RUNTIME_FETCH_TIMEOUT_MS,
    label: 'Runtime interrupt request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok && response.status !== 202) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to interrupt turn for thread ${normalizedThreadId}`))
  }
  return normalizeRuntimeTurnStartResult(payload)
}

export async function reconcileThreadRuntime(threadId: string, options: RpcCallOptions = {}): Promise<ThreadRuntimeSnapshot> {
  const response = await fetchWithTimeout(`/codex-api/runtime/thread/${encodeURIComponent(threadId)}/reconcile`, {
    method: 'POST',
    signal: options.signal,
  }, {
    timeoutMs: GATEWAY_RUNTIME_FETCH_TIMEOUT_MS,
    label: `Runtime reconcile request for ${threadId}`,
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to reconcile runtime thread ${threadId}`))
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : {}
  const snapshot =
    data.snapshot && typeof data.snapshot === 'object' && !Array.isArray(data.snapshot)
      ? data.snapshot as Record<string, unknown>
      : {}
  return {
    messages: [],
    executionState: normalizeRuntimeExecutionState(snapshot.executionState),
    inProgress: snapshot.inProgress === true,
    activeTurnId: typeof snapshot.activeTurnId === 'string' ? snapshot.activeTurnId : '',
    activeItemId: typeof snapshot.activeItemId === 'string' ? snapshot.activeItemId : '',
    canStop: snapshot.canStop === true,
    stopRequested: snapshot.stopRequested === true,
    updatedAtIso: typeof snapshot.updatedAtIso === 'string' ? snapshot.updatedAtIso : '',
    lastEventSeq: typeof snapshot.lastEventSeq === 'number' ? snapshot.lastEventSeq : 0,
    lastEventAtIso: typeof snapshot.lastEventAtIso === 'string' ? snapshot.lastEventAtIso : null,
    lastStartedAtIso: typeof snapshot.lastStartedAtIso === 'string' ? snapshot.lastStartedAtIso : null,
    lastCompletedAtIso: typeof snapshot.lastCompletedAtIso === 'string' ? snapshot.lastCompletedAtIso : null,
    lastError: typeof snapshot.lastError === 'string' ? snapshot.lastError : null,
    stale: snapshot.stale === true,
    degradedReason: typeof snapshot.degradedReason === 'string' ? snapshot.degradedReason : null,
    messageState: 'unavailable',
    pendingServerRequests: Array.isArray(snapshot.pendingServerRequests) ? snapshot.pendingServerRequests : [],
    tokenUsage: normalizeThreadTokenUsage(snapshot.tokenUsage),
  }
}

export async function setDefaultModel(model: string): Promise<void> {
  await callRpc('setDefaultModel', { model })
}

export async function setCodexSpeedMode(mode: SpeedMode): Promise<void> {
  const normalizedMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
  await callRpc('config/batchWrite', {
    edits: [
      {
        keyPath: 'features.fast_mode',
        value: true,
        mergeStrategy: 'upsert',
      },
      {
        keyPath: 'service_tier',
        value: normalizedMode === 'fast' ? 'fast' : null,
        mergeStrategy: normalizedMode === 'fast' ? 'upsert' : 'replace',
      },
    ],
    filePath: null,
    expectedVersion: null,
  })
}

export async function getAvailableModels(): Promise<ComposerModelInfo[]> {
  const models: ComposerModelInfo[] = []
  const seen = new Set<string>()
  let cursor: string | null = null

  do {
    const payload: ModelListResponse = await callRpc<ModelListResponse>('model/list', {
      ...(cursor ? { cursor } : {}),
      includeHidden: false,
    })
    for (const row of payload.data) {
      const model = (row.model || row.id).trim()
      const id = (row.id || model).trim()
      if (!model || row.hidden || seen.has(model)) continue
      seen.add(model)
      models.push({
        id,
        model,
        displayName: row.displayName.trim() || model,
        description: row.description.trim(),
        hidden: row.hidden,
        isDefault: row.isDefault,
        defaultReasoningEffort: row.defaultReasoningEffort,
        supportedReasoningEfforts: row.supportedReasoningEfforts.map((option) => ({
          value: option.reasoningEffort,
          description: option.description.trim(),
        })),
      })
    }
    cursor = typeof payload.nextCursor === 'string' && payload.nextCursor.trim()
      ? payload.nextCursor.trim()
      : null
  } while (cursor)

  return models
}

export async function getAvailableModelIds(): Promise<string[]> {
  return (await getAvailableModels()).map((model) => model.model)
}

export async function getCurrentModelConfig(): Promise<CurrentModelConfig> {
  const payload = await callRpc<ConfigReadResponse>('config/read', {})
  const model = payload.config.model ?? ''
  const reasoningEffort = normalizeReasoningEffort(payload.config.model_reasoning_effort)
  const speedMode = normalizeSpeedMode(payload.config.service_tier)
  return { model, reasoningEffort, speedMode }
}

export async function getAccountRateLimits(): Promise<GetAccountRateLimitsResponse> {
  return await callRpc<GetAccountRateLimitsResponse>('account/rateLimits/read')
}

function normalizeWorkspaceRootsState(payload: unknown): WorkspaceRootsState {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}

  const normalizeArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const next: string[] = []
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0 && !next.includes(item)) {
        next.push(item)
      }
    }
    return next
  }

  const labelsRaw = record.labels
  const labels: Record<string, string> = {}
  if (labelsRaw && typeof labelsRaw === 'object' && !Array.isArray(labelsRaw)) {
    for (const [key, value] of Object.entries(labelsRaw as Record<string, unknown>)) {
      const normalizedKey = typeof key === 'string' ? normalizePathForUi(key) : ''
      if (normalizedKey.length > 0 && typeof value === 'string') {
        labels[normalizedKey] = value
      }
    }
  }

  return {
    order: normalizeArray(record.order).map((value) => normalizePathForUi(value)),
    labels,
    active: normalizeArray(record.active).map((value) => normalizePathForUi(value)),
    projectOrder: normalizeArray(record.projectOrder).map((value) => normalizePathForUi(value)),
    pinnedProjectIds: normalizeArray(record.pinnedProjectIds).map((value) => normalizePathForUi(value)),
  }
}

export async function getWorkspaceRootsState(): Promise<WorkspaceRootsState> {
  if (workspaceRootsStateCache && Date.now() - workspaceRootsStateCache.cachedAtMs < WORKSPACE_ROOTS_STATE_CACHE_TTL_MS) {
    return cloneWorkspaceRootsState(workspaceRootsStateCache.value)
  }
  if (workspaceRootsStateInFlight) {
    return cloneWorkspaceRootsState(await workspaceRootsStateInFlight)
  }

  const cacheGeneration = workspaceRootsStateCacheGeneration
  const request = fetchWorkspaceRootsState()
    .then((state) => {
      if (workspaceRootsStateCacheGeneration === cacheGeneration) {
        workspaceRootsStateCache = {
          value: cloneWorkspaceRootsState(state),
          cachedAtMs: Date.now(),
        }
      }
      return state
    })
    .finally(() => {
      if (workspaceRootsStateInFlight === request) {
        workspaceRootsStateInFlight = null
      }
    })
  workspaceRootsStateInFlight = request

  return cloneWorkspaceRootsState(await request)
}

async function fetchWorkspaceRootsState(): Promise<WorkspaceRootsState> {
  const response = await fetchWithTimeout('/codex-api/workspace-roots-state', {}, {
    label: 'Workspace roots request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error('Failed to load workspace roots state')
  }
  const envelope =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  return normalizeWorkspaceRootsState(envelope.data)
}

function cloneWorkspaceRootsState(state: WorkspaceRootsState): WorkspaceRootsState {
  return {
    order: [...state.order],
    labels: { ...state.labels },
    active: [...state.active],
    projectOrder: [...state.projectOrder],
    pinnedProjectIds: [...state.pinnedProjectIds],
  }
}

export async function createWorktree(sourceCwd: string): Promise<WorktreeCreateResult> {
  const response = await fetchWithTimeout('/codex-api/worktree/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceCwd }),
  }, {
    label: 'Worktree create request',
  })
  const payload = (await response.json()) as { data?: WorktreeCreateResult; error?: string }
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to create worktree')
  }
  clearWorkspaceRootsStateCache()
  clearProjectRootSuggestionCache()
  return {
    ...payload.data,
    cwd: normalizePathForUi(payload.data.cwd),
    gitRoot: normalizePathForUi(payload.data.gitRoot),
  }
}

export async function autoCommitWorktreeChanges(cwd: string, message: string): Promise<WorktreeAutoCommitResult> {
  const response = await fetchWithTimeout('/codex-api/worktree/auto-commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, message }),
  }, {
    label: 'Worktree auto-commit request',
  })
  const payload = (await response.json()) as { data?: WorktreeAutoCommitResult; error?: string }
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to auto-commit rollback changes')
  }
  return payload.data
}

export async function rollbackWorktreeToMessage(cwd: string, message: string): Promise<WorktreeRollbackResult> {
  const response = await fetchWithTimeout('/codex-api/worktree/rollback-to-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, message }),
  }, {
    label: 'Worktree rollback request',
  })
  const payload = (await response.json()) as { data?: WorktreeRollbackResult; error?: string }
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Failed to rollback project to message commit')
  }
  return payload.data
}

export async function getHomeDirectory(): Promise<string> {
  const response = await fetchWithTimeout('/codex-api/home-directory', {}, {
    label: 'Home directory request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error('Failed to load home directory')
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return typeof data.path === 'string' ? data.path.trim() : ''
}

export async function setWorkspaceRootsState(nextState: WorkspaceRootsState): Promise<void> {
  const response = await fetchWithTimeout('/codex-api/workspace-roots-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nextState),
  }, {
    label: 'Workspace roots save request',
  })
  if (!response.ok) {
    throw new Error('Failed to save workspace roots state')
  }
  clearWorkspaceRootsStateCache()
}

export async function openProjectRoot(path: string, options?: { createIfMissing?: boolean; label?: string }): Promise<string> {
  const response = await fetchWithTimeout('/codex-api/project-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      createIfMissing: options?.createIfMissing === true,
      label: options?.label ?? '',
    }),
  }, {
    label: 'Project root open request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to open project root')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  const normalizedPath = typeof data.path === 'string' ? normalizePathForUi(data.path) : ''
  if (normalizedPath) {
    clearWorkspaceRootsStateCache()
    clearProjectRootSuggestionCache()
  }
  return normalizedPath
}

export async function getProjectRootSuggestion(basePath: string): Promise<ProjectRootSuggestion> {
  const normalizedBasePath = normalizePathForUi(basePath).trim()
  if (!normalizedBasePath) {
    return { name: '', path: '' }
  }

  const cached = projectRootSuggestionCacheByBasePath.get(normalizedBasePath)
  if (cached && Date.now() - cached.cachedAtMs < PROJECT_ROOT_SUGGESTION_CACHE_TTL_MS) {
    return cached.value
  }

  const inFlight = projectRootSuggestionInFlightByBasePath.get(normalizedBasePath)
  if (inFlight) return await inFlight

  const cacheGeneration = projectRootSuggestionCacheGeneration
  const request = fetchProjectRootSuggestion(normalizedBasePath)
    .then((suggestion) => {
      if (projectRootSuggestionCacheGeneration === cacheGeneration) {
        projectRootSuggestionCacheByBasePath.set(normalizedBasePath, {
          value: suggestion,
          cachedAtMs: Date.now(),
        })
      }
      return suggestion
    })
    .finally(() => {
      if (projectRootSuggestionInFlightByBasePath.get(normalizedBasePath) === request) {
        projectRootSuggestionInFlightByBasePath.delete(normalizedBasePath)
      }
    })
  projectRootSuggestionInFlightByBasePath.set(normalizedBasePath, request)
  return await request
}

async function fetchProjectRootSuggestion(basePath: string): Promise<ProjectRootSuggestion> {
  const query = new URLSearchParams({ basePath })
  const response = await fetchWithTimeout(`/codex-api/project-root-suggestion?${query.toString()}`, {}, {
    label: 'Project root suggestion request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to suggest project name')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return {
    name: typeof data.name === 'string' ? data.name.trim() : '',
    path: typeof data.path === 'string' ? normalizePathForUi(data.path) : '',
  }
}

function clearProjectRootSuggestionCache(): void {
  projectRootSuggestionCacheGeneration += 1
  projectRootSuggestionCacheByBasePath.clear()
  projectRootSuggestionInFlightByBasePath.clear()
}

function clearWorkspaceRootsStateCache(): void {
  workspaceRootsStateCacheGeneration += 1
  workspaceRootsStateCache = null
  workspaceRootsStateInFlight = null
}

export async function searchComposerFiles(cwd: string, query: string, limit = 20): Promise<ComposerFileSuggestion[]> {
  const trimmedCwd = cwd.trim()
  if (!trimmedCwd) return []
  const response = await fetchWithTimeout('/codex-api/composer-file-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: trimmedCwd,
      query: query.trim(),
      limit,
    }),
  }, {
    label: 'Composer file search request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to search files')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data = Array.isArray(record.data) ? record.data : []
  const suggestions: ComposerFileSuggestion[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const rawPath = row.path
    const value = typeof rawPath === 'string' ? rawPath.trim() : ''
    if (!value) continue
    suggestions.push({ path: value })
  }
  return suggestions
}

export async function searchThreads(
  query: string,
  limit = 200,
): Promise<ThreadSearchResult> {
  const response = await fetchWithTimeout('/codex-api/thread-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Thread search request',
  })
  const payload = (await response.json()) as { data?: ThreadSearchResult; error?: string }
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to search threads')
  }
  return payload.data ?? { threadIds: [], indexedThreadCount: 0 }
}

function normalizePermissionDecision(value: unknown, fallback: PermissionDecision): PermissionDecision {
  return value === 'ask' || value === 'allowForSession' ? value : fallback
}

function normalizeWebBridgeSettingsPayload(value: unknown): WebBridgeSettings {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record
  const permissions =
    data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions)
      ? (data.permissions as Record<string, unknown>)
      : {}
  return {
    permissions: {
      allowAllPermissionRequests: permissions.allowAllPermissionRequests === true,
      commandExecution: normalizePermissionDecision(permissions.commandExecution, 'allowForSession'),
      fileChange: normalizePermissionDecision(permissions.fileChange, 'allowForSession'),
      mcpTools: normalizePermissionDecision(permissions.mcpTools, 'ask'),
    },
  }
}

function normalizeFavoriteRecordPayload(value: unknown): FavoriteRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : ''
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : ''
  const text = typeof record.text === 'string' ? record.text : ''
  if (!threadId || !messageId || !text.trim()) return null

  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${threadId}:${messageId}`,
    threadId,
    messageId,
    threadTitle: typeof record.threadTitle === 'string' ? record.threadTitle : '',
    threadCwd: typeof record.threadCwd === 'string' ? record.threadCwd : '',
    role: record.role === 'user' || record.role === 'assistant' || record.role === 'system'
      ? record.role
      : 'assistant',
    text,
    preview: typeof record.preview === 'string' ? record.preview : '',
    turnIndex: typeof record.turnIndex === 'number' ? record.turnIndex : null,
    favoritedAtIso: typeof record.favoritedAtIso === 'string' ? record.favoritedAtIso : '',
  }
}

function normalizeFavoriteRecordsPayload(value: unknown): FavoriteRecord[] {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  const data = Array.isArray(record.data) ? record.data : value
  if (!Array.isArray(data)) return []

  const normalized: FavoriteRecord[] = []
  const seenIds = new Set<string>()
  for (const item of data) {
    const favorite = normalizeFavoriteRecordPayload(item)
    if (!favorite || seenIds.has(favorite.id)) continue
    seenIds.add(favorite.id)
    normalized.push(favorite)
  }
  return normalized
}

function normalizePinnedThreadIdsPayload(value: unknown): string[] {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  const data = Array.isArray(record.data) ? record.data : value
  if (!Array.isArray(data)) return []

  const normalized: string[] = []
  for (const item of data) {
    if (typeof item !== 'string') continue
    const threadId = item.trim()
    if (!threadId || normalized.includes(threadId)) continue
    normalized.push(threadId)
  }
  return normalized
}

export async function getWebBridgeSettings(): Promise<WebBridgeSettings> {
  const response = await fetchWithTimeout('/codex-api/web-settings', {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Web settings request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load Web settings')
    throw new Error(message)
  }
  return normalizeWebBridgeSettingsPayload(payload)
}

export async function getFavoriteRecords(): Promise<FavoriteRecord[]> {
  const response = await fetchWithTimeout('/codex-api/favorites', {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Favorite records request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load favorites')
    throw new Error(message)
  }
  return normalizeFavoriteRecordsPayload(payload)
}

export async function updateFavoriteRecords(favorites: FavoriteRecord[]): Promise<FavoriteRecord[]> {
  const response = await fetchWithTimeout('/codex-api/favorites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorites }),
  }, {
    label: 'Favorite records update request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to save favorites')
    throw new Error(message)
  }
  return normalizeFavoriteRecordsPayload(payload)
}

export async function getPinnedThreadIds(): Promise<string[]> {
  const response = await fetchWithTimeout('/codex-api/pinned-threads', {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Pinned thread ids request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load pinned threads')
    throw new Error(message)
  }
  return normalizePinnedThreadIdsPayload(payload)
}

export async function updatePinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const response = await fetchWithTimeout('/codex-api/pinned-threads', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinnedThreadIds }),
  }, {
    label: 'Pinned thread ids update request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to save pinned threads')
    throw new Error(message)
  }
  return normalizePinnedThreadIdsPayload(payload)
}

export async function updateWebBridgeSettings(settings: WebBridgeSettings): Promise<WebBridgeSettings> {
  const response = await fetchWithTimeout('/codex-api/web-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }, {
    label: 'Web settings update request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to update Web settings')
    throw new Error(message)
  }
  return normalizeWebBridgeSettingsPayload(payload)
}

export async function getDesktopAppStatus(): Promise<DesktopAppStatus> {
  const response = await fetchWithTimeout('/codex-api/desktop-app/status', {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Desktop app status request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load desktop app status')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return {
    available: data.available === true,
    platform: typeof data.platform === 'string' ? data.platform : '',
    appInstalled: data.appInstalled === true,
    appRunning: data.appRunning === true,
    appUserModelId: typeof data.appUserModelId === 'string' ? data.appUserModelId : '',
    reason: typeof data.reason === 'string' ? data.reason : '',
  }
}

export async function refreshDesktopApp(): Promise<DesktopAppRefreshResult> {
  const response = await fetchWithTimeout('/codex-api/desktop-app/refresh', {
    method: 'POST',
  }, {
    label: 'Desktop app refresh request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to refresh the desktop app')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return {
    requested: data.requested === true,
    message:
      typeof data.message === 'string' && data.message.trim().length > 0
        ? data.message
        : 'Official Codex desktop app refresh requested.',
  }
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const response = await fetchWithTimeout('/codex-api/tunnel-status', {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'Tunnel status request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load tunnel status')
    throw new Error(message)
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}

  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : null,
    active: data.active === true,
    publicUrl: typeof data.publicUrl === 'string' ? data.publicUrl : '',
    configPath: typeof data.configPath === 'string' ? data.configPath : '',
    configuredCommand: typeof data.configuredCommand === 'string' ? data.configuredCommand : '',
    resolvedCommand: typeof data.resolvedCommand === 'string' ? data.resolvedCommand : '',
    cloudflaredAvailable: data.cloudflaredAvailable === true,
    logPath: typeof data.logPath === 'string' ? data.logPath : '',
    lastDetectedAtIso: typeof data.lastDetectedAtIso === 'string' ? data.lastDetectedAtIso : '',
    reason: typeof data.reason === 'string' ? data.reason : '',
  }
}

export async function updateTunnelStatus(config: TunnelConfigUpdate): Promise<TunnelStatus> {
  const response = await fetchWithTimeout('/codex-api/tunnel-status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }, {
    label: 'Tunnel status update request',
  })
  const payload = await response.json()
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to update tunnel settings')
    throw new Error(message)
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}

  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : null,
    active: data.active === true,
    publicUrl: typeof data.publicUrl === 'string' ? data.publicUrl : '',
    configPath: typeof data.configPath === 'string' ? data.configPath : '',
    configuredCommand: typeof data.configuredCommand === 'string' ? data.configuredCommand : '',
    resolvedCommand: typeof data.resolvedCommand === 'string' ? data.resolvedCommand : '',
    cloudflaredAvailable: data.cloudflaredAvailable === true,
    logPath: typeof data.logPath === 'string' ? data.logPath : '',
    lastDetectedAtIso: typeof data.lastDetectedAtIso === 'string' ? data.lastDetectedAtIso : '',
    reason: typeof data.reason === 'string' ? data.reason : '',
  }
}

function formatGithubDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function getGithubTrendingProjects(limit = 10): Promise<GithubTrendingProject[]> {
  const safeLimit = Math.min(10, Math.max(1, Math.floor(limit)))
  const sinceDate = new Date()
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 7)
  const query = new URLSearchParams({
    q: `created:>=${formatGithubDate(sinceDate)}`,
    sort: 'stars',
    order: 'desc',
    per_page: String(safeLimit),
  })
  const response = await fetchWithTimeout(`https://api.github.com/search/repositories?${query.toString()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'GitHub trending request',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub trending projects (${response.status})`)
  }
  const payload = (await response.json()) as unknown
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const items = Array.isArray(record.items) ? record.items : []
  const projects: GithubTrendingProject[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'number' ? row.id : 0
    const fullName = typeof row.full_name === 'string' ? row.full_name.trim() : ''
    const htmlUrl = typeof row.html_url === 'string' ? row.html_url.trim() : ''
    if (!id || !fullName || !htmlUrl) continue
    const [owner = '', repo = ''] = fullName.split('/', 2)
    projects.push({
      id,
      fullName,
      owner,
      repo,
      url: htmlUrl,
      description: normalizeGithubProjectDescription(
        fullName,
        typeof row.description === 'string' ? row.description : '',
      ),
      language: typeof row.language === 'string' ? row.language.trim() : '',
      stars: typeof row.stargazers_count === 'number' ? row.stargazers_count : 0,
    })
  }
  return await localizeGithubProjectsForUi(projects)
}

export async function getGithubProjectsForScope(
  scope: GithubTipsScope,
  limit = 10,
): Promise<GithubTrendingProject[]> {
  const safeLimit = Math.min(10, Math.max(1, Math.floor(limit)))
  if (scope.startsWith('search-')) {
    const sinceDate = new Date()
    if (scope === 'search-daily') sinceDate.setUTCDate(sinceDate.getUTCDate() - 1)
    else if (scope === 'search-weekly') sinceDate.setUTCDate(sinceDate.getUTCDate() - 7)
    else sinceDate.setUTCDate(sinceDate.getUTCDate() - 30)

    const query = new URLSearchParams({
      q: `created:>=${formatGithubDate(sinceDate)}`,
      sort: 'stars',
      order: 'desc',
      per_page: String(safeLimit),
    })
    const response = await fetchWithTimeout(`https://api.github.com/search/repositories?${query.toString()}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, {
      timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
      label: 'GitHub search request',
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub search projects (${response.status})`)
    }
    const payload = (await response.json()) as unknown
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    const items = Array.isArray(record.items) ? record.items : []
    const projects: GithubTrendingProject[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'number' ? row.id : 0
      const fullName = typeof row.full_name === 'string' ? row.full_name.trim() : ''
      const htmlUrl = typeof row.html_url === 'string' ? row.html_url.trim() : ''
      if (!id || !fullName || !htmlUrl) continue
      const [owner = '', repo = ''] = fullName.split('/', 2)
      projects.push({
        id,
        fullName,
        owner,
        repo,
        url: htmlUrl,
        description: normalizeGithubProjectDescription(
          fullName,
          typeof row.description === 'string' ? row.description : '',
        ),
        language: typeof row.language === 'string' ? row.language.trim() : '',
        stars: typeof row.stargazers_count === 'number' ? row.stargazers_count : 0,
      })
    }
    return await localizeGithubProjectsForUi(projects)
  }

  const since =
    scope === 'trending-daily'
      ? 'daily'
      : scope === 'trending-weekly'
        ? 'weekly'
        : 'monthly'
  const query = new URLSearchParams({ since, limit: String(safeLimit) })
  const response = await fetchWithTimeout(`/codex-api/github-trending?${query.toString()}`, {}, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: 'GitHub trending scope request',
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to fetch GitHub trending projects')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data = Array.isArray(record.data) ? record.data : []
  const projects: GithubTrendingProject[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'number' ? row.id : 0
    const fullName = typeof row.fullName === 'string' ? row.fullName.trim() : ''
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    if (!id || !fullName || !url) continue
    const [owner = '', repo = ''] = fullName.split('/', 2)
    projects.push({
      id,
      fullName,
      owner,
      repo,
      url,
      description: normalizeGithubProjectDescription(
        fullName,
        typeof row.description === 'string' ? row.description : '',
      ),
      language: typeof row.language === 'string' ? row.language.trim() : '',
      stars: typeof row.stars === 'number' ? row.stars : 0,
    })
  }
  return await localizeGithubProjectsForUi(projects)
}

function getErrorMessageFromPayload(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
  const error = record.error
  return typeof error === 'string' && error.trim().length > 0 ? error : fallback
}

export type ThreadTitleCache = { titles: Record<string, string>; order: string[] }
let supportsThreadTitleGeneration: boolean | null = null

export async function getThreadTitleCache(): Promise<ThreadTitleCache> {
  try {
    const response = await fetchWithTimeout('/codex-api/thread-titles', {}, {
      timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
      label: 'Thread title cache request',
    })
    if (!response.ok) return { titles: {}, order: [] }
    const envelope = (await response.json()) as { data?: ThreadTitleCache }
    return envelope.data ?? { titles: {}, order: [] }
  } catch {
    return { titles: {}, order: [] }
  }
}

export async function persistThreadTitle(id: string, title: string): Promise<void> {
  try {
    await fetchWithTimeout('/codex-api/thread-titles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title }),
    }, {
      timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
      label: 'Thread title save request',
    })
  } catch {
    // Best-effort persist
  }
}

export async function generateThreadTitle(prompt: string, cwd: string | null): Promise<string> {
  if (supportsThreadTitleGeneration === false) {
    return ''
  }
  try {
    const result = await callRpc<{ title?: string }>('generate-thread-title', { prompt, cwd })
    supportsThreadTitleGeneration = true
    return result.title?.trim() ?? ''
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('unknown variant `generate-thread-title`')
    ) {
      supportsThreadTitleGeneration = false
    }
    return ''
  }
}

export type SkillInfo = {
  name: string
  description: string
  path: string
  scope: string
  enabled: boolean
}

type SkillsListResponseEntry = {
  cwd: string
  skills: Array<{
    name: string
    description: string
    shortDescription?: string
    path: string
    scope: string
    enabled: boolean
  }>
  errors: unknown[]
}

type McpServerStatusResponseEntry = {
  name?: string
  tools?: Record<string, {
    name?: string
    title?: string
    description?: string
  }>
  resources?: unknown[]
  resourceTemplates?: unknown[]
  authStatus?: string
}

type NativePluginListEntry = {
  id?: string
  name?: string
  installed?: boolean
  enabled?: boolean
  availability?: string
  interface?: {
    displayName?: string | null
    shortDescription?: string | null
  } | null
}

type NativePluginMarketplace = {
  plugins?: NativePluginListEntry[]
}

function normalizePluginAuthStatus(value: unknown): PluginAuthStatus {
  if (
    value === 'unsupported' ||
    value === 'notLoggedIn' ||
    value === 'bearerToken' ||
    value === 'oAuth'
  ) {
    return value
  }
  return 'unknown'
}

function normalizePluginDisplayName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '未命名插件'
  const known: Record<string, string> = {
    chrome: 'Chrome',
    computer: '电脑',
    'computer-use': '电脑',
    documents: 'Documents',
    spreadsheets: 'Spreadsheets',
    presentations: 'Presentations',
    netlify: 'Netlify',
    superpowers: 'Superpowers',
    hyperframes: 'HyperFrames by HeyGen',
  }
  const key = trimmed.toLowerCase()
  if (known[key]) return known[key]
  return trimmed
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizePluginListKey(source: ComposerPluginInfo['source'], id: string): string {
  return `${source}:${id.trim().toLowerCase()}`
}

function normalizeNativePluginInfo(entry: NativePluginListEntry): ComposerPluginInfo | null {
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (
    !id ||
    entry.installed !== true ||
    entry.enabled !== true ||
    (typeof entry.availability === 'string' && entry.availability !== 'AVAILABLE')
  ) {
    return null
  }
  const rawName = typeof entry.interface?.displayName === 'string'
    ? entry.interface.displayName.trim()
    : ''
  const fallbackName = typeof entry.name === 'string' ? entry.name.trim() : ''
  const description = typeof entry.interface?.shortDescription === 'string'
    ? entry.interface.shortDescription.trim()
    : ''

  return {
    id,
    name: rawName || normalizePluginDisplayName(fallbackName || id.split('@')[0] || id),
    description,
    source: 'plugin',
    mentionPath: `plugin://${id}`,
    authStatus: 'unknown',
    isAccessible: true,
    isEnabled: true,
    distributionChannel: null,
    installUrl: null,
    toolCount: 0,
    resourceCount: 0,
    resourceTemplateCount: 0,
    tools: [],
  }
}

function normalizeMcpServerStatus(entry: McpServerStatusResponseEntry): ComposerPluginInfo | null {
  const rawName = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (!rawName) return null
  const tools = Object.entries(entry.tools ?? {})
    .map(([key, tool]) => {
      const name = (tool?.name || key).trim()
      if (!name) return null
      return {
        name,
        title: (tool?.title || tool?.name || key).trim(),
        description: (tool?.description || '').trim(),
      }
    })
    .filter((tool): tool is { name: string; title: string; description: string } => tool !== null)
    .sort((first, second) => first.title.localeCompare(second.title))

  const authStatus = normalizePluginAuthStatus(entry.authStatus)
  const resourceCount = Array.isArray(entry.resources) ? entry.resources.length : 0
  const resourceTemplateCount = Array.isArray(entry.resourceTemplates) ? entry.resourceTemplates.length : 0
  if (tools.length === 0 && resourceCount === 0 && resourceTemplateCount === 0 && authStatus !== 'notLoggedIn') {
    return null
  }

  return {
    id: rawName,
    name: normalizePluginDisplayName(rawName),
    description: tools[0]?.description || '',
    source: 'mcp',
    mentionPath: `plugin://${rawName}`,
    authStatus,
    toolCount: tools.length,
    resourceCount,
    resourceTemplateCount,
    tools,
  }
}

function sortComposerPlugins(plugins: ComposerPluginInfo[]): ComposerPluginInfo[] {
  const priority: Record<ComposerPluginInfo['source'], number> = { plugin: 0, mcp: 1, app: 2 }
  return plugins.sort((first, second) => {
    if (first.source !== second.source) return priority[first.source] - priority[second.source]
    return first.name.localeCompare(second.name)
  })
}

function mergeComposerPluginLists(...lists: ComposerPluginInfo[][]): ComposerPluginInfo[] {
  const plugins: ComposerPluginInfo[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const plugin of list) {
      const key = normalizePluginListKey(plugin.source, plugin.id)
      if (seen.has(key)) continue
      seen.add(key)
      plugins.push(plugin)
    }
  }
  return sortComposerPlugins(plugins)
}

export async function getNativeComposerPluginsList(): Promise<ComposerPluginInfo[]> {
  const payload = await callRpc<{ marketplaces?: NativePluginMarketplace[] }>('plugin/list', {})
  const plugins: ComposerPluginInfo[] = []
  for (const marketplace of payload.marketplaces ?? []) {
    for (const entry of marketplace.plugins ?? []) {
      const plugin = normalizeNativePluginInfo(entry)
      if (plugin) plugins.push(plugin)
    }
  }
  return mergeComposerPluginLists(plugins)
}

export async function getMcpComposerPluginsList(): Promise<ComposerPluginInfo[]> {
  const plugins: ComposerPluginInfo[] = []
  let cursor: string | null = null
  do {
    const params: Record<string, unknown> = {}
    if (cursor) params.cursor = cursor
    const payload = await callRpc<{ data?: McpServerStatusResponseEntry[]; nextCursor?: string | null }>(
      'mcpServerStatus/list',
      params,
    )
    for (const entry of payload.data ?? []) {
      const plugin = normalizeMcpServerStatus(entry)
      if (plugin) plugins.push(plugin)
    }
    cursor = typeof payload.nextCursor === 'string' && payload.nextCursor.trim()
      ? payload.nextCursor.trim()
      : null
  } while (cursor)
  return mergeComposerPluginLists(plugins)
}

export async function getComposerPluginsList(): Promise<ComposerPluginInfo[]> {
  const [nativeResult, mcpResult] = await Promise.allSettled([
    getNativeComposerPluginsList(),
    getMcpComposerPluginsList(),
  ])
  return mergeComposerPluginLists(
    nativeResult.status === 'fulfilled' ? nativeResult.value : [],
    mcpResult.status === 'fulfilled' ? mcpResult.value : [],
  )
}

export async function startComposerPluginOauthLogin(pluginId: string): Promise<string> {
  const name = pluginId.trim()
  if (!name) throw new Error('插件名称不能为空')
  const payload = await callRpc<{ authorizationUrl?: string }>('mcpServer/oauth/login', {
    name,
    timeoutSecs: 120,
  })
  return payload.authorizationUrl?.trim() ?? ''
}

export async function reloadComposerPlugins(): Promise<void> {
  await callRpc('config/mcpServer/reload')
}

export async function getSkillsList(cwds?: string[]): Promise<SkillInfo[]> {
  try {
    const params: Record<string, unknown> = {}
    if (cwds && cwds.length > 0) params.cwds = cwds
    const payload = await callRpc<{ data: SkillsListResponseEntry[] }>('skills/list', params)
    const skills: SkillInfo[] = []
    const seen = new Set<string>()
    for (const entry of payload.data) {
      for (const skill of entry.skills) {
        if (!skill.name || seen.has(skill.path)) continue
        seen.add(skill.path)
        skills.push({
          name: skill.name,
          description: skill.shortDescription || skill.description || '',
          path: skill.path,
          scope: skill.scope,
          enabled: skill.enabled,
        })
      }
    }
    return skills
  } catch {
    return []
  }
}

export async function uploadFile(file: File): Promise<string | null> {
  try {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetchWithTimeout('/codex-api/upload-file', { method: 'POST', body: form }, {
      timeoutMs: GATEWAY_UPLOAD_FETCH_TIMEOUT_MS,
      label: 'Upload file request',
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { path?: string }
    return data.path ?? null
  } catch {
    return null
  }
}
