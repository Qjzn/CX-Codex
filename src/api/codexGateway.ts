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
import type { SpeedMode, UiMessage, UiProjectGroup, UiThreadTokenUsage, UiTokenUsageBreakdown } from '../types/codex'
import { normalizePathForUi } from '../pathUtils.js'
import { shouldAutoLoginForResponse, tryMobileShellAutoLogin } from '../mobile/mobileAuth'

type CurrentModelConfig = {
  model: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
}

type RpcCallOptions = { signal?: AbortSignal }

export type RuntimeExecutionState =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_permission'
  | 'stopping'
  | 'completed_pending_sync'
  | 'completed'
  | 'failed'
  | 'interrupted'
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

export type WorkspaceRootsState = {
  order: string[]
  labels: Record<string, string>
  active: string[]
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

async function getThreadGroupsV2(options: RpcCallOptions = {}): Promise<UiProjectGroup[]> {
  const data: ThreadListResponse['data'] = []
  let cursor: string | null = null

  do {
    const payload: ThreadListResponse = await callRpc<ThreadListResponse>('thread/list', {
      archived: false,
      limit: 100,
      sortKey: 'updated_at',
      cursor,
    }, options)
    data.push(...payload.data)
    cursor = typeof payload.nextCursor === 'string' && payload.nextCursor.length > 0
      ? payload.nextCursor
      : null
  } while (cursor)

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
  options: RpcCallOptions = {},
): Promise<{ messages: UiMessage[]; inProgress: boolean; activeTurnId: string }> {
  const payload = await callRpc<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: true,
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
  const response = await fetchWithTimeout(`/codex-api/state/thread/${encodeURIComponent(threadId)}`, {
    signal: options.signal,
  }, {
    timeoutMs: GATEWAY_BACKGROUND_FETCH_TIMEOUT_MS,
    label: `Thread state snapshot request for ${threadId}`,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(getErrorMessageFromPayload(payload, `Failed to load thread snapshot ${threadId}`))
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
    rawExecutionState === 'running' ||
    rawExecutionState === 'waiting_permission' ||
    rawExecutionState === 'stopping' ||
    rawExecutionState === 'completed_pending_sync' ||
    rawExecutionState === 'completed' ||
    rawExecutionState === 'failed' ||
    rawExecutionState === 'interrupted' ||
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

  return {
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
}

export async function getThreadRuntimeStatusSnapshot(
  threadId: string,
  options: RpcCallOptions = {},
): Promise<ThreadRuntimeSnapshot> {
  const response = await fetchWithTimeout(`/codex-api/runtime/snapshot?threadId=${encodeURIComponent(threadId)}`, {
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
  const rawExecutionState = typeof data.executionState === 'string' ? data.executionState.trim() : ''
  const executionState: RuntimeExecutionState =
    rawExecutionState === 'queued' ||
    rawExecutionState === 'starting' ||
    rawExecutionState === 'running' ||
    rawExecutionState === 'waiting_permission' ||
    rawExecutionState === 'stopping' ||
    rawExecutionState === 'completed_pending_sync' ||
    rawExecutionState === 'completed' ||
    rawExecutionState === 'failed' ||
    rawExecutionState === 'interrupted' ||
    rawExecutionState === 'sync_degraded'
      ? rawExecutionState
      : 'idle'
  const readNullableString = (value: unknown): string | null => (
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  )
  const rawMessageState = typeof data.messageState === 'string' ? data.messageState.trim() : ''
  const messageState: ThreadRuntimeSnapshot['messageState'] =
    rawMessageState === 'fresh' || rawMessageState === 'cached' || rawMessageState === 'unavailable'
      ? rawMessageState
      : 'unavailable'

  return {
    messages: [],
    executionState,
    inProgress: data.inProgress === true,
    activeTurnId: typeof data.activeTurnId === 'string' ? data.activeTurnId.trim() : '',
    activeItemId: typeof data.activeItemId === 'string' ? data.activeItemId.trim() : '',
    canStop: data.canStop === true,
    stopRequested: data.stopRequested === true,
    updatedAtIso: typeof data.updatedAtIso === 'string' ? data.updatedAtIso.trim() : '',
    lastEventSeq: typeof data.lastEventSeq === 'number' && Number.isFinite(data.lastEventSeq)
      ? Math.max(0, Math.trunc(data.lastEventSeq))
      : 0,
    lastEventAtIso: readNullableString(data.lastEventAtIso),
    lastStartedAtIso: readNullableString(data.lastStartedAtIso),
    lastCompletedAtIso: readNullableString(data.lastCompletedAtIso),
    lastError: readNullableString(data.lastError),
    stale: data.stale === true,
    degradedReason: readNullableString(data.degradedReason),
    messageState,
    pendingServerRequests: Array.isArray(data.pendingServerRequests) ? data.pendingServerRequests : [],
    tokenUsage: normalizeThreadTokenUsage(data.tokenUsage),
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

export async function getThreadGroups(options: RpcCallOptions = {}): Promise<UiProjectGroup[]> {
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
  options: RpcCallOptions = {},
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
  options: { onConnectionStateChange?: (state: RpcConnectionState) => void } = {},
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

export async function getPendingServerRequests(): Promise<unknown[]> {
  return fetchPendingServerRequests()
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

export async function startThreadTurn(
  threadId: string,
  text: string,
  imageUrls: string[] = [],
  model?: string,
  effort?: ReasoningEffort,
  skills?: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[] = [],
): Promise<string> {
  try {
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
    const attachments = fileAttachments.map((f) => ({ label: f.label, path: f.path, fsPath: f.fsPath }))
    const params: Record<string, unknown> = {
      threadId,
      input,
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

export async function getAvailableModelIds(): Promise<string[]> {
  const payload = await callRpc<ModelListResponse>('model/list', {})
  const ids: string[] = []
  for (const row of payload.data) {
    const candidate = row.id || row.model
    if (!candidate || ids.includes(candidate)) continue
    ids.push(candidate)
  }
  return ids
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
  }
}

export async function getWorkspaceRootsState(): Promise<WorkspaceRootsState> {
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
  return normalizedPath
}

export async function getProjectRootSuggestion(basePath: string): Promise<{ name: string; path: string }> {
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
