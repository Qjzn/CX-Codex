import { computed, ref, watch } from 'vue'
import {
  autoCommitWorktreeChanges,
  archiveThread,
  forkThread,
  getAccountRateLimits,
  renameThread,
  getAvailableModelIds,
  getComposerPluginsList,
  getCurrentModelConfig,
  getPendingServerRequests,
  getSkillsList,
  getThreadDetail,
  getThreadRuntimeSnapshot,
  getThreadRuntimeStatusSnapshot,
  getThreadTokenUsage,
  interruptRuntimeThreadTurn,
  replyToServerRequest,
  reconcileThreadRuntime,
  rollbackThread,
  getThreadGroups,
  getWorkspaceRootsState,
  setCodexSpeedMode,
  setDefaultModel,
  setWorkspaceRootsState,
  startThread,
  startComposerPluginOauthLogin,
  reloadComposerPlugins,
  getThreadTitleCache,
  getNotificationReplay,
  getRuntimeRequestByClientMessageId,
  persistThreadTitle,
  generateThreadTitle,
  resumeThread,
  rollbackWorktreeToMessage,
  startRuntimeThreadTurn,
  subscribeCodexNotifications,
  type RuntimeInterruptSource,
  type RpcConnectionState,
  type RpcNotification,
  type SkillInfo,
  type ThreadRuntimeSnapshot,
} from '../api/codexGateway'
import type {
  CollaborationMode,
  ComposerPluginInfo,
  ComposerPluginSource,
  ComposerTurnOptions,
  CommandExecutionData,
  ReasoningEffort,
  SpeedMode,
  ThreadScrollState,
  UiLiveOverlay,
  UiMessage,
  UiProjectGroup,
  UiRateLimitSnapshot,
  UiRuntimeStatusSummary,
  UiServerRequest,
  UiServerRequestReply,
  UiThreadTokenUsage,
  UiThread,
} from '../types/codex'
import { isAbortLikeError } from '../api/codexErrors'
import { normalizePathForUi, toProjectName } from '../pathUtils.js'
import {
  MOBILE_APP_PAUSE_EVENT,
  MOBILE_APP_RESUME_EVENT,
  MOBILE_NETWORK_OFFLINE_EVENT,
  MOBILE_NETWORK_ONLINE_EVENT,
} from '../mobile/events'
import {
  isNativeAndroidShell,
  performMobileShellHapticFeedback,
  setMobileShellKeepAwake,
  showMobileShellNotification,
  type MobileShellHapticStyle,
  type MobileShellNotificationType,
} from '../mobile/mobileShell'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

function shouldRefreshMessagesFromNotification(method: string): boolean {
  if (method === THREAD_TOKEN_USAGE_UPDATED_METHOD) return false
  return (
    method === 'turn/started' ||
    method === 'turn/completed' ||
    method === 'item/completed' ||
    method === 'error' ||
    method === 'server/request' ||
    method === 'server/request/resolved' ||
    method.startsWith('thread/')
  )
}

function shouldRefreshThreadListFromNotification(method: string): boolean {
  if (method === THREAD_TOKEN_USAGE_UPDATED_METHOD) return false
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

function shouldUrgentlyRefreshFromNotification(method: string): boolean {
  return method === 'turn/completed' || method === 'item/completed' || method === 'error'
}

function shouldBoostSyncForNotification(method: string): boolean {
  if (method === THREAD_TOKEN_USAGE_UPDATED_METHOD) return false
  return (
    method === 'turn/started' ||
    method === 'turn/completed' ||
    method === 'error' ||
    method.startsWith('item/') ||
    method.startsWith('thread/')
  )
}

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const SCROLL_STATE_STORAGE_KEY = 'codex-web-local.thread-scroll-state.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const SELECTED_MODEL_STORAGE_KEY = 'codex-web-local.selected-model-id.v1'
const SELECTED_REASONING_EFFORT_STORAGE_KEY = 'codex-web-local.selected-reasoning-effort.v1'
const SELECTED_COLLABORATION_MODE_STORAGE_KEY = 'codex-web-local.selected-collaboration-mode.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const HIDDEN_THREAD_IDS_STORAGE_KEY = 'codex-web-local.hidden-thread-ids.v1'
const QUEUED_MESSAGES_STORAGE_KEY = 'codex-web-local.queued-messages.v1'
const NOTIFICATION_SEQ_STORAGE_KEY = 'codex-web-local.notification-seq.v1'
const EVENT_SYNC_DEBOUNCE_MS = 350
const BACKGROUND_SYNC_INTERVAL_MS = 9000
const ACTIVE_THREAD_DETAIL_SYNC_INTERVAL_MS = 12000
const ACTIVE_THREAD_DETAIL_SYNC_IDLE_MS = 18000
const ACTIVE_SYNC_BOOST_INTERVAL_MS = 2500
const ACTIVE_SYNC_BOOST_WINDOW_MS = 18000
const RESUME_SYNC_RETRY_DELAYS_MS = [0, 1200, 4500, 12000]
const ANDROID_RESUME_SYNC_RETRY_DELAYS_MS = [0, 4500, 12000]
const ANDROID_RESUME_SYNC_DEBOUNCE_MS = 2500
const ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS = 120000
const ACTIVE_SYNC_STALE_MS = 14000
const STALE_THREAD_ACTIVE_TURN_TTL_MS = 5 * 60 * 1000
const STALE_THREAD_ACTIVE_TURN_IMMEDIATE_MS = 20 * 60 * 1000
const OPTIMISTIC_EXECUTION_RECOVERY_GRACE_MS = 6000
const LIVE_OVERLAY_ACTIVITY_GRACE_MS = 4500
const UNKNOWN_ACTIVE_TURN_ID = '__unknown_active_turn__'
const LIVE_DELTA_BATCH_MS = 48
const NOTIFICATION_STALE_MS = 30000
const THREAD_LIST_REFRESH_INTERVAL_MS = 300000
const THREAD_TOKEN_USAGE_REFRESH_RETRY_MS = 5 * 60 * 1000
const RATE_LIMIT_REFRESH_DEBOUNCE_MS = 1500
const RATE_LIMIT_REFRESH_MIN_INTERVAL_MS = 300000
const COMPOSER_PLUGINS_REFRESH_DEBOUNCE_MS = 450
const SKILLS_CHANGED_REFRESH_DEBOUNCE_MS = 350
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const THREAD_TOKEN_USAGE_UPDATED_METHOD = 'thread/tokenUsage/updated'
const SKILLS_CHANGED_METHOD = 'skills/changed'
const COMPOSER_PLUGIN_INVALIDATING_NOTIFICATION_METHODS = new Set([
  'app/list/updated',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
])
const MODEL_FALLBACK_ID = 'gpt-5.2-codex'
const AUTO_COMMIT_MESSAGE_FALLBACK = 'Auto-commit from Codex rollback chat turn'
const OPTIMISTIC_USER_MESSAGE_TYPE = 'userMessage.optimistic'

type FileAttachment = { label: string; path: string; fsPath: string }
type QueuedMessage = {
  id: string
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: FileAttachment[]
  modelId: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
  collaborationMode: CollaborationMode
  turnOptions?: ComposerTurnOptions
}

type RealtimeConnectionState = RpcConnectionState

function createClientMessageId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12)
  return `cm-${Date.now()}-${randomPart}`
}

function normalizeTurnOptions(value: unknown): ComposerTurnOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const plugins = Array.isArray(row.plugins)
    ? row.plugins
      .filter((item): item is { id: string; name: string; path?: string; source?: 'mcp' | 'app' } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).id === 'string'
        && typeof (item as Record<string, unknown>).name === 'string'
      ))
      .map((item) => {
        const id = item.id.trim()
        const name = item.name.trim()
        const source: ComposerPluginSource = item.source === 'app' ? 'app' : 'mcp'
        const path = typeof item.path === 'string' && item.path.trim()
          ? item.path.trim()
          : (source === 'app' ? `app://${id}` : `plugin://${id}`)
        return { id, name, path, source }
      })
      .filter((item) => item.id.length > 0 && item.name.length > 0)
    : []
  const rawGoal = row.goal
  const goal = rawGoal && typeof rawGoal === 'object' && !Array.isArray(rawGoal)
    ? {
        enabled: (rawGoal as Record<string, unknown>).enabled === true,
        text: typeof (rawGoal as Record<string, unknown>).text === 'string'
          ? ((rawGoal as Record<string, unknown>).text as string).trim()
          : '',
      }
    : undefined
  const normalizedGoal = goal?.enabled === true ? goal : undefined
  if (plugins.length === 0 && !normalizedGoal) return undefined
  return {
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(normalizedGoal ? { goal: normalizedGoal } : {}),
  }
}

function cloneTurnOptions(options?: ComposerTurnOptions): ComposerTurnOptions | undefined {
  return normalizeTurnOptions(options)
}

function loadReadStateMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(READ_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveReadStateMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(state))
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function localizeActivityText(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) return ''

  const directMap: Record<string, string> = {
    'Thinking': '思考中',
    'Planning': '规划中',
    'Running command': '执行命令',
    'Preparing context': '准备上下文',
    'Streaming reply': '生成回复',
    'Reading messages': '读取消息',
    'Syncing': '同步中',
    'Queued': '排队中',
    'Sending': '发送中',
    'Confirming status': '确认任务状态中',
    'Stopping': '停止中',
    'Confirming stop': '停止确认中',
    'Model': '模型',
    'Speed': '速度',
    'Fast': '快速',
    'Standard': '标准',
    'default': '默认',
    'minimal': '极低',
    'low': '低',
    'medium': '中',
    'high': '高',
    'xhigh': '极高',
    'none': '无',
  }

  if (directMap[normalized]) return directMap[normalized]

  const colonMatch = normalized.match(/^(Model|Thinking|Speed):\s*(.+)$/u)
  if (colonMatch) {
    const label = directMap[colonMatch[1]] ?? colonMatch[1]
    const rawValue = colonMatch[2].trim()
    const translatedValue = directMap[rawValue] ?? rawValue
    return `${label}：${translatedValue}`
  }

  return normalized
}

function normalizeThreadScrollState(value: unknown): ThreadScrollState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const rawState = value as Record<string, unknown>
  if (typeof rawState.scrollTop !== 'number' || !Number.isFinite(rawState.scrollTop)) return null
  if (typeof rawState.isAtBottom !== 'boolean') return null

  const normalized: ThreadScrollState = {
    scrollTop: Math.max(0, rawState.scrollTop),
    isAtBottom: rawState.isAtBottom,
  }

  if (typeof rawState.scrollRatio === 'number' && Number.isFinite(rawState.scrollRatio)) {
    normalized.scrollRatio = clamp(rawState.scrollRatio, 0, 1)
  }

  return normalized
}

function loadThreadScrollStateMap(): Record<string, ThreadScrollState> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(SCROLL_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, ThreadScrollState> = {}
    for (const [threadId, state] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId) continue
      const normalizedState = normalizeThreadScrollState(state)
      if (normalizedState) {
        normalizedMap[threadId] = normalizedState
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadScrollStateMap(state: Record<string, ThreadScrollState>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SCROLL_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  const raw = window.localStorage.getItem(SELECTED_THREAD_STORAGE_KEY)
  return raw ?? ''
}

function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    window.localStorage.removeItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

function loadSelectedModelId(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)?.trim() ?? ''
}

function saveSelectedModelId(modelId: string): void {
  if (typeof window === 'undefined') return
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) {
    window.localStorage.removeItem(SELECTED_MODEL_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, normalizedModelId)
}

function loadSelectedReasoningEffort(): ReasoningEffort | '' {
  if (typeof window === 'undefined') return 'medium'
  try {
    const raw = window.localStorage.getItem(SELECTED_REASONING_EFFORT_STORAGE_KEY)?.trim() ?? ''
    return REASONING_EFFORT_OPTIONS.includes(raw as ReasoningEffort) ? raw as ReasoningEffort : 'medium'
  } catch {
    return 'medium'
  }
}

function hasStoredSelectedReasoningEffort(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(SELECTED_REASONING_EFFORT_STORAGE_KEY)?.trim() ?? ''
    return REASONING_EFFORT_OPTIONS.includes(raw as ReasoningEffort)
  } catch {
    return false
  }
}

function saveSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
  if (typeof window === 'undefined') return
  try {
    if (!effort) {
      window.localStorage.removeItem(SELECTED_REASONING_EFFORT_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(SELECTED_REASONING_EFFORT_STORAGE_KEY, effort)
  } catch {
    // Keep the in-memory effort when localStorage is unavailable.
  }
}

function loadSelectedCollaborationMode(): CollaborationMode {
  if (typeof window === 'undefined') return 'execute'
  try {
    return window.localStorage.getItem(SELECTED_COLLABORATION_MODE_STORAGE_KEY) === 'plan'
      ? 'plan'
      : 'execute'
  } catch {
    return 'execute'
  }
}

function saveSelectedCollaborationMode(mode: CollaborationMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SELECTED_COLLABORATION_MODE_STORAGE_KEY, mode)
  } catch {
    // Keep in-memory mode when localStorage is unavailable.
  }
}

function loadProjectOrder(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const order: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string' || item.length === 0) continue
      const normalizedItem = toProjectName(item)
      if (normalizedItem.length > 0 && !order.includes(normalizedItem)) {
        order.push(normalizedItem)
      }
    }
    return order
  } catch {
    return []
  }
}

function saveProjectOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order))
}

function loadProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(PROJECT_DISPLAY_NAME_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const displayNames: Record<string, string> = {}
    for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedProjectName = typeof projectName === 'string' ? toProjectName(projectName) : ''
      if (normalizedProjectName.length > 0 && typeof displayName === 'string') {
        displayNames[normalizedProjectName] = displayName
      }
    }
    return displayNames
  } catch {
    return {}
  }
}

function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(displayNames))
}

function loadHiddenThreadIds(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(HIDDEN_THREAD_IDS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function saveHiddenThreadIds(threadIds: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIDDEN_THREAD_IDS_STORAGE_KEY, JSON.stringify(threadIds))
}

function normalizeQueuedMessage(value: unknown): QueuedMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (!id) return null

  const text = typeof row.text === 'string' ? row.text : ''
  const imageUrls = Array.isArray(row.imageUrls)
    ? row.imageUrls.filter((item): item is string => typeof item === 'string')
    : []
  const skills = Array.isArray(row.skills)
    ? row.skills
      .filter((item): item is { name: string; path: string } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).name === 'string'
        && typeof (item as Record<string, unknown>).path === 'string'
      ))
      .map((item) => ({ name: item.name, path: item.path }))
    : []
  const fileAttachments = Array.isArray(row.fileAttachments)
    ? row.fileAttachments
      .filter((item): item is FileAttachment => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).label === 'string'
        && typeof (item as Record<string, unknown>).path === 'string'
        && typeof (item as Record<string, unknown>).fsPath === 'string'
      ))
      .map((item) => ({ label: item.label, path: item.path, fsPath: item.fsPath }))
    : []

  return {
    id,
    text,
    imageUrls,
    skills,
    fileAttachments,
    modelId: typeof row.modelId === 'string' ? row.modelId.trim() : '',
    reasoningEffort: typeof row.reasoningEffort === 'string' && REASONING_EFFORT_OPTIONS.includes(row.reasoningEffort as ReasoningEffort)
      ? row.reasoningEffort as ReasoningEffort
      : '',
    speedMode: row.speedMode === 'fast' ? 'fast' : 'standard',
    collaborationMode: row.collaborationMode === 'plan' ? 'plan' : 'execute',
    turnOptions: normalizeTurnOptions(row.turnOptions),
  }
}

function loadQueuedMessagesMap(): Record<string, QueuedMessage[]> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(QUEUED_MESSAGES_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const next: Record<string, QueuedMessage[]> = {}
    for (const [threadId, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId || !Array.isArray(rows)) continue
      const normalizedRows = rows
        .map((row) => normalizeQueuedMessage(row))
        .filter((row): row is QueuedMessage => row !== null)
      if (normalizedRows.length > 0) {
        next[threadId] = normalizedRows
      }
    }
    return next
  } catch {
    return {}
  }
}

function saveQueuedMessagesMap(queueByThreadId: Record<string, QueuedMessage[]>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUEUED_MESSAGES_STORAGE_KEY, JSON.stringify(queueByThreadId))
  } catch {
    // Keep in-memory queue state when storage is unavailable or quota-limited.
  }
}

function loadLastNotificationSeq(): number {
  if (typeof window === 'undefined') return 0

  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SEQ_STORAGE_KEY)
    if (!raw) return 0
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? Math.max(0, value) : 0
  } catch {
    return 0
  }
}

function saveLastNotificationSeq(seq: number): void {
  if (typeof window === 'undefined') return

  try {
    const normalizedSeq = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0
    if (normalizedSeq <= 0) {
      window.localStorage.removeItem(NOTIFICATION_SEQ_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(NOTIFICATION_SEQ_STORAGE_KEY, String(normalizedSeq))
  } catch {
    // Replay still works within the current page lifetime if storage is unavailable.
  }
}

function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder: string[] = []

  for (const projectName of previousOrder) {
    if (!nextOrder.includes(projectName)) {
      nextOrder.push(projectName)
    }
  }

  for (const group of incomingGroups) {
    if (!nextOrder.includes(group.projectName)) {
      nextOrder.push(group.projectName)
    }
  }

  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered: UiProjectGroup[] = projectOrder
    .map((projectName) => incomingByName.get(projectName) ?? null)
    .filter((group): group is UiProjectGroup => group !== null && group.threads.length > 0)

  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) {
      ordered.push(group)
    }
  }

  return ordered
}

function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }

  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.status === second.status &&
    first.aggregatedOutput === second.aggregatedOutput &&
    first.exitCode === second.exitCode &&
    first.durationMs === second.durationMs &&
    first.startedAtMs === second.startedAtMs
  )
}

function isUnsupportedChatGptModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('not supported when using codex with a chatgpt account') ||
    message.includes('model is not supported')
  )
}

function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    first.turnIndex === second.turnIndex
  )
}

function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous.map((previousMessage) => {
    const nextMessage = incomingById.get(previousMessage.id)
    if (!nextMessage) {
      return previousMessage
    }
    if (areMessageFieldsEqual(previousMessage, nextMessage)) {
      return previousMessage
    }
    return nextMessage
  })

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function normalizeMessageSignatureList(values: string[] | undefined): string {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\u001f')
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function userMessageSignature(message: UiMessage): string {
  const filePaths = (message.fileAttachments ?? []).map((file) => file.path)
  return [
    normalizeMessageText(message.text),
    normalizeMessageSignatureList(message.images),
    normalizeMessageSignatureList(filePaths),
  ].join('\u001e')
}

function parseOptimisticUserMessageMeta(message: UiMessage): OptimisticUserMessageMeta | null {
  if (message.messageType !== OPTIMISTIC_USER_MESSAGE_TYPE) return null
  if (!message.rawPayload) return null

  try {
    const parsed = JSON.parse(message.rawPayload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.kind !== 'optimisticUserMessage') return null
    if (typeof record.signature !== 'string') return null
    if (typeof record.baselineMatchCount !== 'number' || !Number.isFinite(record.baselineMatchCount)) return null
    if (typeof record.createdAtMs !== 'number' || !Number.isFinite(record.createdAtMs)) return null
    return {
      kind: 'optimisticUserMessage',
      signature: record.signature,
      baselineMatchCount: Math.max(0, Math.floor(record.baselineMatchCount)),
      createdAtMs: record.createdAtMs,
    }
  } catch {
    return null
  }
}

function countPersistedUserMessageSignatures(messages: UiMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.messageType === OPTIMISTIC_USER_MESSAGE_TYPE) continue
    const signature = userMessageSignature(message)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  return counts
}

function filterVisibleOptimisticUserMessages(persisted: UiMessage[], optimistic: UiMessage[]): UiMessage[] {
  if (optimistic.length === 0) return optimistic

  const persistedCounts = countPersistedUserMessageSignatures(persisted)
  const consumedAcknowledgements = new Map<string, number>()

  return optimistic.filter((message) => {
    const meta = parseOptimisticUserMessageMeta(message)
    const signature = meta?.signature ?? userMessageSignature(message)
    const baselineMatchCount = meta?.baselineMatchCount ?? 0
    const acknowledgedCount = Math.max((persistedCounts.get(signature) ?? 0) - baselineMatchCount, 0)
    const consumedCount = consumedAcknowledgements.get(signature) ?? 0

    if (acknowledgedCount > consumedCount) {
      consumedAcknowledgements.set(signature, consumedCount + 1)
      return false
    }

    return true
  })
}

function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantTexts.size === 0) {
    return previous
  }

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...previous, nextMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}

type TurnSummaryState = {
  turnId: string
  durationMs: number
}

type TurnActivityState = {
  label: string
  details: string[]
}

type TurnErrorState = {
  message: string
}

type OptimisticUserMessageMeta = {
  kind: 'optimisticUserMessage'
  signature: string
  baselineMatchCount: number
  createdAtMs: number
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

type ThreadReadActiveState = {
  turnId: string
  firstObservedAtMs: number
  lastObservedAtMs: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function parseIsoTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  const displaySeconds = seconds > 0 || parts.length === 0 ? seconds : 0
  parts.push(`${displaySeconds}s`)
  return parts.join(' ')
}

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.turnId === second.turnId && first.durationMs === second.durationMs
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: `Worked for ${formatTurnDuration(summary.durationMs)}`,
    messageType: WORKED_MESSAGE_TYPE,
  }
}

function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }
  return -1
}

function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const summaryMessage = buildTurnSummaryMessage(summary)
  const sanitizedMessages = messages.filter((message) => message.messageType !== WORKED_MESSAGE_TYPE)
  const insertIndex = findLastAssistantMessageIndex(sanitizedMessages)
  if (insertIndex < 0) {
    return [...sanitizedMessages, summaryMessage]
  }
  const next = [...sanitizedMessages]
  next.splice(insertIndex, 0, summaryMessage)
  return next
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

function mergeIncomingWithLocalInProgressThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  inProgressById: Record<string, boolean>,
): UiProjectGroup[] {
  const incomingThreadIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  const localInProgressThreads = flattenThreads(previous).filter(
    (thread) => inProgressById[thread.id] === true && !incomingThreadIds.has(thread.id),
  )

  if (localInProgressThreads.length === 0) {
    return incoming
  }

  const incomingByProjectName = new Map(incoming.map((group) => [group.projectName, group]))
  const merged: UiProjectGroup[] = incoming.map((group) => ({
    projectName: group.projectName,
    threads: [...group.threads],
  }))

  for (const thread of localInProgressThreads) {
    const existingGroup = incomingByProjectName.get(thread.projectName)
    if (existingGroup) {
      const mergedGroupIndex = merged.findIndex((group) => group.projectName === thread.projectName)
      if (mergedGroupIndex >= 0) {
        merged[mergedGroupIndex] = {
          projectName: merged[mergedGroupIndex].projectName,
          threads: [thread, ...merged[mergedGroupIndex].threads],
        }
      }
      continue
    }

    merged.push({
      projectName: thread.projectName,
      threads: [thread],
    })
  }

  return merged
}

function toProjectNameFromWorkspaceRoot(value: string): string {
  return toProjectName(value)
}

function normalizeComparablePath(value: string): string {
  return normalizePathForUi(value).replace(/\/+$/u, '').toLowerCase()
}

function isWorkspaceRootForProject(rootPath: string, projectName: string, projectCwds: string[]): boolean {
  const rootProjectName = toProjectNameFromWorkspaceRoot(rootPath)
  if (rootProjectName === projectName) return true

  const normalizedRoot = normalizeComparablePath(rootPath)
  if (!normalizedRoot) return false
  return projectCwds.some((cwd) => {
    const normalizedCwd = normalizeComparablePath(cwd)
    return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}/`)
  })
}

function toOptimisticThreadTitle(message: string): string {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) return 'Untitled thread'
  return firstLine.slice(0, 80)
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const optimisticUserMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const liveCommandsByThreadId = ref<Record<string, UiMessage[]>>({})
  const threadTokenUsageByThreadId = ref<Record<string, UiThreadTokenUsage>>({})
  const tokenUsageRefreshInFlightByThreadId = new Map<string, Promise<void>>()
  const tokenUsageRefreshAttemptedAtByThreadId = new Map<string, number>()
  const messageLoadInFlightByThreadId = new Map<string, Promise<void>>()
  const inProgressById = ref<Record<string, boolean>>({})
  type PendingTurnRequest = {
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    effort: ReasoningEffort | ''
    collaborationMode: CollaborationMode
    turnOptions?: ComposerTurnOptions
    fallbackRetried: boolean
    createdAtMs: number
  }
  type BufferedAgentDelta = { threadId: string; messageId: string; delta: string }
  type BufferedCommandDelta = { threadId: string; itemId: string; delta: string }
  const queuedMessagesByThreadId = ref<Record<string, QueuedMessage[]>>(loadQueuedMessagesMap())
  const queueProcessingByThreadId = ref<Record<string, boolean>>({})
  const eventUnreadByThreadId = ref<Record<string, boolean>>({})
  const availableModelIds = ref<string[]>([])
  const selectedModelId = ref(loadSelectedModelId())
  const selectedReasoningEffort = ref<ReasoningEffort | ''>(loadSelectedReasoningEffort())
  const selectedSpeedMode = ref<SpeedMode>('standard')
  const selectedCollaborationMode = ref<CollaborationMode>(loadSelectedCollaborationMode())
  const readStateByThreadId = ref<Record<string, string>>(loadReadStateMap())
  const scrollStateByThreadId = ref<Record<string, ThreadScrollState>>(loadThreadScrollStateMap())
  const projectOrder = ref<string[]>(loadProjectOrder())
  const projectDisplayNameById = ref<Record<string, string>>(loadProjectDisplayNames())
  const hiddenThreadIds = ref<string[]>(loadHiddenThreadIds())
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const lastThreadDetailSyncAtById = ref<Record<string, number>>({})
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
  const runtimeExecutionStateByThreadId = ref<Record<string, ThreadRuntimeSnapshot['executionState']>>({})
  const runtimeCanStopByThreadId = ref<Record<string, boolean>>({})
  const runtimeStaleByThreadId = ref<Record<string, boolean>>({})
  const runtimeStatusSummaryByThreadId = ref<Record<string, UiRuntimeStatusSummary>>({})
  const lastExecutionSignalAtByThreadId = ref<Record<string, number>>({})
  const threadReadActiveStateByThreadId = ref<Record<string, ThreadReadActiveState>>({})
  const ignoredStaleActiveTurnByThreadId = ref<Record<string, string>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})
  const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({})

  const threadTitleById = ref<Record<string, string>>({})

  const installedSkills = ref<SkillInfo[]>([])
  const availableComposerPlugins = ref<ComposerPluginInfo[]>([])
  const isLoadingComposerPlugins = ref(false)
  const accountRateLimitSnapshots = ref<UiRateLimitSnapshot[]>([])

  const isLoadingThreads = ref(false)
  const isLoadingMessages = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isUpdatingSpeedMode = ref(false)
  const isRollingBack = ref(false)
  const error = ref('')
  const syncError = ref('')
  const isPolling = ref(false)
  const notificationHealthTick = ref(Date.now())
  const realtimeConnectionState = ref<RealtimeConnectionState>('connecting')
  const lastSuccessfulSyncAtMs = ref(0)
  const hasLoadedThreads = ref(false)
  let stopNotificationStream: (() => void) | null = null
  let backgroundSyncTimer: number | null = null
  let scrollStateSaveTimer: number | null = null
  let activeSyncBoostTimer: number | null = null
  let liveDeltaFlushTimer: number | null = null
  let eventSyncTimer: number | null = null
  let syncAbortController: AbortController | null = null
  let threadSelectionAbortController: AbortController | null = null
  let foregroundMessageLoadId = 0
  let rateLimitRefreshTimer: number | null = null
  let composerPluginsRefreshTimer: number | null = null
  let skillsChangedRefreshTimer: number | null = null
  let rateLimitRefreshPromise: Promise<void> | null = null
  let lastRateLimitRefreshStartedAtMs = 0
  const resumePromiseByThreadId = new Map<string, Promise<void>>()
  let hasRateLimitTrackingEnabled = false
  let lastNotificationAtMs = Date.now()
  let lastNotificationSeq = loadLastNotificationSeq()
  let lastThreadListSyncAtMs = 0
  let activeSyncBoostUntilMs = 0
  let pendingThreadsRefresh = false
  const pendingThreadMessageRefresh = new Set<string>()
  let visibilitySyncTimer: number | null = null
  const resumeSyncTimers = new Set<number>()
  let lastAndroidResumeSyncScheduledAtMs = 0
  let stopVisibilitySync = (): void => {}
  let hasHydratedWorkspaceRootsState = false
  let activeReasoningItemId = ''
  let shouldAutoScrollOnNextAgentEvent = false
  let androidAppPaused = false
  let lastAndroidNotificationKey = ''
  let lastAndroidNotificationAtMs = 0
  let replayNotificationsPromise: Promise<void> | null = null
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()
  const settledRuntimeMessageRefreshKeyByThreadId = new Map<string, string>()
  const settledRuntimeRpcRefreshKeyByThreadId = new Map<string, string>()
  const fallbackRetryInFlightThreadIds = new Set<string>()
  const isWorktreeGitAutomationEnabled = ref(true)
  const bufferedAgentDeltaByKey = new Map<string, BufferedAgentDelta>()
  const bufferedCommandDeltaByKey = new Map<string, BufferedCommandDelta>()
  const bufferedReasoningDeltaByThreadId = new Map<string, string>()

  const sourceThreads = computed(() => flattenThreads(sourceGroups.value))
  const sourceThreadById = computed<Record<string, UiThread>>(() => {
    const next: Record<string, UiThread> = {}
    for (const thread of sourceThreads.value) {
      next[thread.id] = thread
    }
    return next
  })
  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const selectedThreadScrollState = computed<ThreadScrollState | null>(
    () => scrollStateByThreadId.value[selectedThreadId.value] ?? null,
  )
  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => {
    const rows: UiServerRequest[] = []
    const selected = selectedThreadId.value
    if (selected && Array.isArray(pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  })

  function pendingServerRequestStatusLabel(request: UiServerRequest): string {
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return '等待确认'
      case 'item/tool/requestUserInput':
        return '等待输入'
      case 'item/tool/call':
        return '工具不可用'
      default:
        if (isMcpPermissionPrompt(request)) return '等待授权'
        return isMcpElicitationRequestMethod(request.method) ? '等待输入' : '等待处理'
    }
  }

  function isMcpElicitationRequestMethod(method: string): boolean {
    const normalized = method.trim().toLowerCase()
    return (
      normalized === 'mcpserver/elicitation/request' ||
      normalized === 'mcpserver/elication/request' ||
      normalized === 'elicitation/create'
    )
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

  function readMcpElicitationMessage(params: unknown): string {
    const payload = readMcpElicitationPayload(params)
    return readString(payload?.message).trim()
  }

  function isMcpPermissionPrompt(request: UiServerRequest): boolean {
    if (!isMcpElicitationRequestMethod(request.method)) return false
    const message = readMcpElicitationMessage(request.params)
    const promptMatch = message.match(/^Allow\s+the\s+(.+?)\s+MCP\s+server\s+to\s+run\s+tool\s+["“]([^"”]+)["”]\??$/iu)
    if (promptMatch) return true
    const payload = readMcpElicitationPayload(request.params)
    const serverName = readString(payload?.serverName || payload?.server).trim()
    const toolName = readString(payload?.toolName || payload?.tool).trim()
    return serverName.length > 0 && toolName.length > 0
  }

  function readMcpElicitationMode(params: unknown): string {
    const payload = readMcpElicitationPayload(params)
    return readString(payload?.mode).trim().toLowerCase()
  }

  function pendingServerRequestStatusDetails(request: UiServerRequest): string[] {
    const details: string[] = []
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        details.push('命令执行需要批准')
        break
      case 'item/fileChange/requestApproval':
        details.push('文件变更需要批准')
        break
      case 'item/tool/requestUserInput':
        details.push('需要补充输入')
        break
      case 'item/tool/call':
        details.push('CX-Codex Web 暂不支持执行桌面端工具调用')
        break
      default:
        if (isMcpPermissionPrompt(request)) {
          details.push('MCP 工具权限确认')
        } else if (isMcpElicitationRequestMethod(request.method)) {
          details.push(readMcpElicitationMode(request.params) === 'url' ? 'MCP 服务需要打开外部页面' : 'MCP 服务需要补充信息')
        } else {
          details.push(sanitizeDisplayText(request.method))
        }
        break
    }

    const elicitationMessage = isMcpElicitationRequestMethod(request.method)
      ? readMcpElicitationMessage(request.params)
      : ''
    if (elicitationMessage) {
      details.push(sanitizeDisplayText(elicitationMessage))
    }

    const reason = readString(asRecord(request.params)?.reason).trim()
    if (reason) {
      details.push(sanitizeDisplayText(reason))
    }

    details.push(`请求 #${String(request.id)}`)
    return details.filter((value, index, rows) => value.length > 0 && rows.indexOf(value) === index).slice(0, 3)
  }

  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null

    const pendingRequest = selectedThreadServerRequests.value[0]
    if (pendingRequest) {
      return {
        activityLabel: pendingServerRequestStatusLabel(pendingRequest),
        activityDetails: pendingServerRequestStatusDetails(pendingRequest),
        reasoningText: '',
        errorText: '',
      }
    }

    const activity = turnActivityByThreadId.value[threadId]
    const reasoningText = (liveReasoningTextByThreadId.value[threadId] ?? '').trim()
    const errorText = (turnErrorByThreadId.value[threadId]?.message ?? '').trim()
    const isInProgress = isThreadExecutionActive(threadId)
    const isSettled = hasSettledThreadDetail(threadId)
    const hasRecoveredCompletion = hasRecoveredCompletionAfterRunningActivity(threadId)
    const hasFreshTransientSignal = !isSettled && hasFreshExecutionSignal(threadId, LIVE_OVERLAY_ACTIVITY_GRACE_MS)
    const hasRunningCommand = !hasRecoveredCompletion && (
      hasRunningLiveCommand(threadId) ||
      hasPersistedRunningCommand(threadId)
    )
    const hasPendingSignal = hasPendingServerRequestSignal(threadId)

    if (
      !isInProgress &&
      !errorText &&
      !reasoningText &&
      !hasRunningCommand &&
      !hasPendingSignal &&
      !hasFreshTransientSignal
    ) return null
    if (isSettled && !errorText && !reasoningText && !hasRunningCommand && !hasPendingSignal) return null
    if (!activity && !reasoningText && !errorText && !isInProgress && !hasRunningCommand && !hasPendingSignal) return null
    return {
      activityLabel: localizeActivityText(activity?.label || 'Thinking'),
      activityDetails: (activity?.details ?? []).map((line) => localizeActivityText(line)),
      reasoningText,
      errorText,
    }
  })
  const selectedThreadExecutionActive = computed(() => (
    selectedThreadId.value ? isThreadExecutionActive(selectedThreadId.value) : false
  ))
  const selectedThreadCanStop = computed(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    if (hasRecoveredCompletionAfterRunningActivity(threadId)) return false
    if (runtimeCanStopByThreadId.value[threadId] === true) return true
    const runtimeState = runtimeExecutionStateByThreadId.value[threadId]
    if (runtimeState === 'start_uncertain' || runtimeState === 'stopping' || runtimeState === 'stop_uncertain') {
      return false
    }
    if (
      isRuntimeExecutionStale(threadId) &&
      !hasRunningLiveCommand(threadId) &&
      !hasPendingServerRequestSignal(threadId) &&
      !hasQueuedThreadWork(threadId)
    ) return false
    return (
      isThreadExecutionActive(threadId) &&
      typeof activeTurnIdByThreadId.value[threadId] === 'string' &&
      activeTurnIdByThreadId.value[threadId].trim().length > 0
    )
  })
  const selectedThreadRuntimeStatus = computed<UiRuntimeStatusSummary>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return emptyRuntimeStatusSummary('')
    const previous = runtimeStatusSummaryByThreadId.value[threadId] ?? emptyRuntimeStatusSummary(threadId)
    const executionState = runtimeExecutionStateByThreadId.value[threadId] ?? previous.executionState
    const turnError = turnErrorByThreadId.value[threadId]?.message ?? ''
    return {
      ...previous,
      threadId,
      executionState,
      canStop: selectedThreadCanStop.value,
      stale: runtimeStaleByThreadId.value[threadId] === true || previous.stale,
      activeTurnId: activeTurnIdByThreadId.value[threadId] ?? previous.activeTurnId,
      lastError: turnError || previous.lastError,
    }
  })
  const selectedThreadTokenUsage = computed<UiThreadTokenUsage | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null
    return threadTokenUsageByThreadId.value[threadId] ?? null
  })
  const notificationStale = computed(() => {
    notificationHealthTick.value
    return Date.now() - lastNotificationAtMs >= NOTIFICATION_STALE_MS
  })
  const hasSyncDemand = computed(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return isLoadingMessages.value || isSendingMessage.value
    if (isLoadingMessages.value || isSendingMessage.value) return true
    if (isThreadExecutionActive(threadId)) return true
    if (eventUnreadByThreadId.value[threadId] === true) return true
    if ((pendingServerRequestsByThreadId.value[threadId] ?? []).length > 0) return true
    if ((pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE] ?? []).length > 0) return true
    return false
  })
  const syncLagging = computed(() => {
    notificationHealthTick.value
    if (!hasSyncDemand.value) return false
    const lastObservedActivityAt = Math.max(lastNotificationAtMs, lastSuccessfulSyncAtMs.value)
    if (lastObservedActivityAt <= 0) return true
    return Date.now() - lastObservedActivityAt >= ACTIVE_SYNC_STALE_MS
  })
  const androidShellAvailable = isNativeAndroidShell()
  let androidKeepAwakeEnabled = false
  function setAndroidKeepAwake(enabled: boolean): void {
    if (!androidShellAvailable || androidKeepAwakeEnabled === enabled) return
    androidKeepAwakeEnabled = enabled
    void setMobileShellKeepAwake(enabled).catch(() => {
      if (androidKeepAwakeEnabled === enabled) {
        androidKeepAwakeEnabled = !enabled
      }
    })
  }
  function triggerAndroidHaptic(style: MobileShellHapticStyle = 'light'): void {
    if (!androidShellAvailable) return
    void performMobileShellHapticFeedback(style).catch(() => {})
  }
  function getThreadDisplayTitle(threadId: string): string {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || normalizedThreadId === GLOBAL_SERVER_REQUEST_SCOPE) return 'CX-Codex'
    return (
      threadTitleById.value[normalizedThreadId]?.trim() ||
      sourceThreadById.value[normalizedThreadId]?.title?.trim() ||
      '当前任务'
    )
  }
  function shouldShowAndroidTaskNotification(threadId: string): boolean {
    if (!androidShellAvailable) return false
    if (androidAppPaused) return true
    if (!isDocumentVisible()) return true
    const normalizedThreadId = threadId.trim()
    return Boolean(normalizedThreadId && normalizedThreadId !== selectedThreadId.value)
  }
  function showAndroidTaskNotification(
    type: MobileShellNotificationType,
    title: string,
    body: string,
    threadId: string,
  ): void {
    if (!shouldShowAndroidTaskNotification(threadId)) return
    const key = `${type}:${threadId}:${title}:${body}`
    const now = Date.now()
    if (key === lastAndroidNotificationKey && now - lastAndroidNotificationAtMs < 2500) return
    lastAndroidNotificationKey = key
    lastAndroidNotificationAtMs = now
    void showMobileShellNotification(title, body, type).catch(() => {})
  }
  const stopAndroidKeepAwakeWatch = androidShellAvailable
    ? watch(hasSyncDemand, (active) => setAndroidKeepAwake(active), { immediate: true })
    : null
  const messages = computed<UiMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const optimisticUser = filterVisibleOptimisticUserMessages(
      persisted,
      optimisticUserMessagesByThreadId.value[threadId] ?? [],
    )
    const liveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
    const liveCommands = liveCommandsByThreadId.value[threadId] ?? []
    const combined = [...persisted, ...optimisticUser, ...liveCommands, ...liveAgent]

    const summary = turnSummaryByThreadId.value[threadId]
    if (!summary) return combined
    return insertTurnSummaryMessage(combined, summary)
  })

  function setSelectedThreadId(nextThreadId: string): void {
    if (selectedThreadId.value === nextThreadId) return
    selectedThreadId.value = nextThreadId
    saveSelectedThreadId(nextThreadId)
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
  }

  function setSelectedModelId(modelId: string): void {
    selectedModelId.value = modelId.trim()
    saveSelectedModelId(selectedModelId.value)
  }

  function setWorktreeGitAutomationEnabled(enabled: boolean): void {
    isWorktreeGitAutomationEnabled.value = enabled
  }

  async function applyFallbackModelSelection(): Promise<void> {
    selectedModelId.value = MODEL_FALLBACK_ID
    saveSelectedModelId(selectedModelId.value)
    if (!availableModelIds.value.includes(MODEL_FALLBACK_ID)) {
      availableModelIds.value = [...availableModelIds.value, MODEL_FALLBACK_ID]
    }
    try {
      await setDefaultModel(MODEL_FALLBACK_ID)
    } catch {
      // Keep local selection even when persisting default model fails.
    }
  }

  function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
    settledRuntimeMessageRefreshKeyByThreadId.delete(threadId)
    settledRuntimeRpcRefreshKeyByThreadId.delete(threadId)
    pendingTurnRequestByThreadId.value = {
      ...pendingTurnRequestByThreadId.value,
      [threadId]: request,
    }
  }

  function clearPendingTurnRequest(threadId: string): void {
    if (!pendingTurnRequestByThreadId.value[threadId]) return
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
  }

  async function autoCommitCompletedWorktreeTurn(threadId: string, commitMessage: string): Promise<void> {
    if (!isWorktreeGitAutomationEnabled.value) return
    const normalizedMessage = commitMessage.trim()
    if (!normalizedMessage) return
    const thread = allThreads.value.find((row) => row.id === threadId)
    if (!thread) return
    if (thread.hasWorktree !== true) return
    const cwd = thread.cwd.trim()
    if (!cwd) return
    await autoCommitWorktreeChanges(cwd, normalizedMessage)
    pendingThreadsRefresh = true
  }

  async function rollbackWorktreeGitToTurnMessage(threadId: string, turnIndex: number): Promise<void> {
    if (!isWorktreeGitAutomationEnabled.value) return
    const thread = allThreads.value.find((row) => row.id === threadId)
    if (!thread) return
    if (thread.hasWorktree !== true) return
    const cwd = thread.cwd.trim()
    if (!cwd) return

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const rollbackUserMessage = persisted.find((message) => message.role === 'user' && message.turnIndex === turnIndex)
    const rollbackMessageText = rollbackUserMessage?.text?.trim() ?? ''
    if (!rollbackMessageText) return

    try {
      await rollbackWorktreeToMessage(cwd, rollbackMessageText)
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : ''
      if (message.includes('No matching commit found')) {
        return
      }
      throw unknownError
    }
    pendingThreadsRefresh = true
  }

  async function retryPendingTurnWithFallback(threadId: string): Promise<void> {
    if (fallbackRetryInFlightThreadIds.has(threadId)) return
    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending || pending.fallbackRetried) return

    fallbackRetryInFlightThreadIds.add(threadId)
    setPendingTurnRequest(threadId, {
      ...pending,
      fallbackRetried: true,
    })

    try {
      await applyFallbackModelSelection()
      // Remove the failed user turn before replaying on fallback model to avoid duplicated user messages.
      try {
        const rolledBackMessages = await rollbackThread(threadId, 1)
        setPersistedMessagesForThread(threadId, rolledBackMessages)
        setLiveAgentMessagesForThread(threadId, [])
        clearLiveReasoningForThread(threadId)
        if (liveCommandsByThreadId.value[threadId]) {
          liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
        }
      } catch {
        // If rollback fails, continue with retry rather than dropping the turn.
      }
      setTurnErrorForThread(threadId, null)
      error.value = ''
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, {
        label: pending.collaborationMode === 'plan' ? 'Planning' : 'Thinking',
        details: buildPendingTurnDetails(MODEL_FALLBACK_ID, pending.effort, pending.collaborationMode),
      })
      setThreadInProgress(threadId, true)
      markThreadLiveExecutionSignal(threadId)

      await ensureThreadResumed(threadId)

      const retryResult = await startRuntimeThreadTurn({
        threadId,
        text: pending.text,
        imageUrls: pending.imageUrls,
        model: MODEL_FALLBACK_ID,
        effort: pending.effort || undefined,
        skills: pending.skills.length > 0 ? pending.skills : undefined,
        fileAttachments: pending.fileAttachments,
        collaborationMode: pending.collaborationMode,
        turnOptions: pending.turnOptions,
      })
      if (retryResult.turnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: retryResult.turnId,
        }
      }

      markThreadResumed(threadId)

      scheduleRateLimitRefresh()
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      scheduleEventSync(700)
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
    } finally {
      fallbackRetryInFlightThreadIds.delete(threadId)
    }
  }

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }
    selectedReasoningEffort.value = effort
    saveSelectedReasoningEffort(effort)
  }

  function setSelectedCollaborationMode(mode: CollaborationMode): void {
    const nextMode: CollaborationMode = mode === 'plan' ? 'plan' : 'execute'
    selectedCollaborationMode.value = nextMode
    saveSelectedCollaborationMode(nextMode)
  }

  function consumePlanModeAfterSubmit(mode: CollaborationMode): void {
    if (mode !== 'plan') return
    if (selectedCollaborationMode.value !== 'plan') return
    setSelectedCollaborationMode('execute')
  }

  async function updateSelectedSpeedMode(mode: SpeedMode): Promise<void> {
    const nextMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
    if (isUpdatingSpeedMode.value || selectedSpeedMode.value === nextMode) {
      return
    }

    const previousMode = selectedSpeedMode.value
    selectedSpeedMode.value = nextMode
    isUpdatingSpeedMode.value = true
    error.value = ''

    try {
      await setCodexSpeedMode(nextMode)
    } catch (unknownError) {
      selectedSpeedMode.value = previousMode
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to update Fast mode'
    } finally {
      isUpdatingSpeedMode.value = false
    }
  }

  function buildPendingTurnDetails(modelId: string, effort: ReasoningEffort | '', mode: CollaborationMode = selectedCollaborationMode.value): string[] {
    const modelLabel = modelId.trim() || 'default'
    const effortLabel = effort || 'default'
    const speedLabel = selectedSpeedMode.value === 'fast' ? 'Fast' : 'Standard'
    return [
      mode === 'plan' ? '模式：计划' : '模式：执行',
      localizeActivityText(`Model: ${modelLabel}`),
      localizeActivityText(`Thinking: ${effortLabel}`),
      localizeActivityText(`Speed: ${speedLabel}`),
    ]
  }

  async function refreshModelPreferences(): Promise<void> {
    try {
      const [modelIds, currentConfig] = await Promise.all([
        getAvailableModelIds(),
        getCurrentModelConfig(),
      ])

      availableModelIds.value = modelIds

      const hasSelectedModel = selectedModelId.value.length > 0 && modelIds.includes(selectedModelId.value)
      if (!hasSelectedModel) {
        if (currentConfig.model && modelIds.includes(currentConfig.model)) {
          selectedModelId.value = currentConfig.model
        } else if (modelIds.length > 0) {
          selectedModelId.value = modelIds[0]
        } else {
          selectedModelId.value = ''
        }
        saveSelectedModelId(selectedModelId.value)
      }

      if (
        !hasStoredSelectedReasoningEffort() &&
        currentConfig.reasoningEffort &&
        REASONING_EFFORT_OPTIONS.includes(currentConfig.reasoningEffort)
      ) {
        selectedReasoningEffort.value = currentConfig.reasoningEffort
      }
      selectedSpeedMode.value = currentConfig.speedMode
    } catch {
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  async function refreshRateLimits(options: { force?: boolean } = {}): Promise<void> {
    hasRateLimitTrackingEnabled = true
    if (rateLimitRefreshPromise) {
      await rateLimitRefreshPromise
      return
    }

    const now = Date.now()
    if (!options.force && now - lastRateLimitRefreshStartedAtMs < RATE_LIMIT_REFRESH_MIN_INTERVAL_MS) {
      return
    }
    lastRateLimitRefreshStartedAtMs = now

    rateLimitRefreshPromise = (async () => {
      try {
        accountRateLimitSnapshots.value = normalizeRateLimitSnapshotsPayload(await getAccountRateLimits())
      } catch {
        // Keep the last known rate-limit state if the endpoint is temporarily unavailable.
      } finally {
        rateLimitRefreshPromise = null
      }
    })()

    await rateLimitRefreshPromise
  }

  function scheduleRateLimitRefresh(): void {
    if (!hasRateLimitTrackingEnabled) {
      return
    }

    if (typeof window === 'undefined') {
      void refreshRateLimits()
      return
    }

    if (rateLimitRefreshTimer !== null) {
      window.clearTimeout(rateLimitRefreshTimer)
    }

    const elapsedMs = Date.now() - lastRateLimitRefreshStartedAtMs
    const waitForMinIntervalMs = Math.max(0, RATE_LIMIT_REFRESH_MIN_INTERVAL_MS - elapsedMs)
    const delayMs = Math.max(RATE_LIMIT_REFRESH_DEBOUNCE_MS, waitForMinIntervalMs)

    rateLimitRefreshTimer = window.setTimeout(() => {
      rateLimitRefreshTimer = null
      void refreshRateLimits()
    }, delayMs)
  }

  function applyCachedTitlesToGroups(groups: UiProjectGroup[]): UiProjectGroup[] {
    const titles = threadTitleById.value
    if (Object.keys(titles).length === 0) return groups
    return groups.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const cached = titles[thread.id]
        return cached ? { ...thread, title: cached } : thread
      }),
    }))
  }

  function applyThreadFlags(): void {
    const withTitles = applyCachedTitlesToGroups(sourceGroups.value)
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = isThreadExecutionActive(thread.id)
        const isSelected = selectedThreadId.value === thread.id
        const lastReadIso = readStateByThreadId.value[thread.id]
        const unreadByEvent = eventUnreadByThreadId.value[thread.id] === true
        const unread = !isSelected && !inProgress && (unreadByEvent || lastReadIso !== thread.updatedAtIso)

        return {
          ...thread,
          inProgress,
          unread,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    const nowIso = new Date().toISOString()
    const normalizedCwd = normalizePathForUi(cwd)
    const projectName = toProjectName(normalizedCwd)
    const optimisticTitle = toOptimisticThreadTitle(firstMessageText)
    const nextThread: UiThread = {
      id: threadId,
      title: optimisticTitle,
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }

    if (!threadTitleById.value[threadId]) {
      threadTitleById.value = {
        ...threadTitleById.value,
        [threadId]: optimisticTitle,
      }
    }

    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroup: UiProjectGroup = {
        projectName,
        threads: [nextThread, ...remainingThreads],
      }
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, nextGroup)
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }

    const nextProjectOrder = mergeProjectOrder(projectOrder.value, sourceGroups.value)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    applyThreadFlags()
  }

  function removeThreadFromSourceGroups(threadId: string): UiThread[] {
    const nextGroups = sourceGroups.value
      .map((group) => ({
        projectName: group.projectName,
        threads: group.threads.filter((thread) => thread.id !== threadId),
      }))
      .filter((group) => group.threads.length > 0)

    sourceGroups.value = nextGroups
    applyThreadFlags()
    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)
    return flatThreads
  }

  function hideThreadLocally(threadId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!hiddenThreadIds.value.includes(normalizedThreadId)) {
      hiddenThreadIds.value = [...hiddenThreadIds.value, normalizedThreadId]
      saveHiddenThreadIds(hiddenThreadIds.value)
    }

    const flatThreads = removeThreadFromSourceGroups(normalizedThreadId)
    if (selectedThreadId.value === normalizedThreadId) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    const nextScrollState = pruneThreadStateMap(scrollStateByThreadId.value, activeThreadIds)
    if (nextScrollState !== scrollStateByThreadId.value) {
      scrollStateByThreadId.value = nextScrollState
      saveThreadScrollStateMap(nextScrollState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    persistedMessagesByThreadId.value = pruneThreadStateMap(persistedMessagesByThreadId.value, activeThreadIds)
    optimisticUserMessagesByThreadId.value = pruneThreadStateMap(optimisticUserMessagesByThreadId.value, activeThreadIds)
    liveAgentMessagesByThreadId.value = pruneThreadStateMap(liveAgentMessagesByThreadId.value, activeThreadIds)
    liveReasoningTextByThreadId.value = pruneThreadStateMap(liveReasoningTextByThreadId.value, activeThreadIds)
    liveCommandsByThreadId.value = pruneThreadStateMap(liveCommandsByThreadId.value, activeThreadIds)
    threadTokenUsageByThreadId.value = pruneThreadStateMap(threadTokenUsageByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    activeTurnIdByThreadId.value = pruneThreadStateMap(activeTurnIdByThreadId.value, activeThreadIds)
    runtimeExecutionStateByThreadId.value = pruneThreadStateMap(runtimeExecutionStateByThreadId.value, activeThreadIds)
    runtimeCanStopByThreadId.value = pruneThreadStateMap(runtimeCanStopByThreadId.value, activeThreadIds)
    runtimeStaleByThreadId.value = pruneThreadStateMap(runtimeStaleByThreadId.value, activeThreadIds)
    runtimeStatusSummaryByThreadId.value = pruneThreadStateMap(runtimeStatusSummaryByThreadId.value, activeThreadIds)
    lastExecutionSignalAtByThreadId.value = pruneThreadStateMap(lastExecutionSignalAtByThreadId.value, activeThreadIds)
    threadReadActiveStateByThreadId.value = pruneThreadStateMap(threadReadActiveStateByThreadId.value, activeThreadIds)
    ignoredStaleActiveTurnByThreadId.value = pruneThreadStateMap(ignoredStaleActiveTurnByThreadId.value, activeThreadIds)
    eventUnreadByThreadId.value = pruneThreadStateMap(eventUnreadByThreadId.value, activeThreadIds)
    inProgressById.value = pruneThreadStateMap(inProgressById.value, activeThreadIds)
    const nextQueuedMessages = pruneThreadStateMap(queuedMessagesByThreadId.value, activeThreadIds)
    if (nextQueuedMessages !== queuedMessagesByThreadId.value) {
      replaceQueuedMessagesState(nextQueuedMessages)
    }
    queueProcessingByThreadId.value = pruneThreadStateMap(queueProcessingByThreadId.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  function replaceQueuedMessagesState(nextState: Record<string, QueuedMessage[]>): void {
    queuedMessagesByThreadId.value = nextState
    saveQueuedMessagesMap(nextState)
  }

  function setQueuedMessagesForThread(threadId: string, queue: QueuedMessage[]): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    const nextState = queue.length > 0
      ? { ...queuedMessagesByThreadId.value, [normalizedThreadId]: queue }
      : omitKey(queuedMessagesByThreadId.value, normalizedThreadId)
    replaceQueuedMessagesState(nextState)
  }

  function removeQueuedMessageByThreadId(threadId: string, messageId: string): void {
    const normalizedThreadId = threadId.trim()
    const normalizedMessageId = messageId.trim()
    if (!normalizedThreadId || !normalizedMessageId) return
    const queue = queuedMessagesByThreadId.value[normalizedThreadId]
    if (!queue) return
    const next = queue.filter((message) => message.id !== normalizedMessageId)
    setQueuedMessagesForThread(normalizedThreadId, next)
  }

  function markThreadAsRead(threadId: string): void {
    const thread = sourceThreadById.value[threadId]
    if (!thread) return

    readStateByThreadId.value = {
      ...readStateByThreadId.value,
      [threadId]: thread.updatedAtIso,
    }
    saveReadStateMap(readStateByThreadId.value)
    if (eventUnreadByThreadId.value[threadId]) {
      eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, threadId)
    }
    applyThreadFlags()
  }

  function markAllThreadsAsRead(): void {
    const nextReadState = { ...readStateByThreadId.value }
    let hasChanged = false

    for (const thread of Object.values(sourceThreadById.value)) {
      const threadId = thread.id.trim()
      const updatedAtIso = thread.updatedAtIso.trim()
      if (!threadId || !updatedAtIso) continue
      if (nextReadState[threadId] === updatedAtIso && eventUnreadByThreadId.value[threadId] !== true) continue
      nextReadState[threadId] = updatedAtIso
      hasChanged = true
    }

    const hadEventUnread = Object.keys(eventUnreadByThreadId.value).length > 0
    if (!hasChanged && !hadEventUnread) return

    readStateByThreadId.value = nextReadState
    saveReadStateMap(nextReadState)
    if (hadEventUnread) {
      eventUnreadByThreadId.value = {}
    }
    applyThreadFlags()
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function setThreadInProgress(threadId: string, nextInProgress: boolean): void {
    if (!threadId) return
    const currentValue = inProgressById.value[threadId] === true
    if (currentValue === nextInProgress) return
    if (nextInProgress) {
      inProgressById.value = {
        ...inProgressById.value,
        [threadId]: true,
      }
    } else {
      inProgressById.value = omitKey(inProgressById.value, threadId)
    }
    applyThreadFlags()
  }

  function areTokenUsageBreakdownsEqual(
    first?: UiThreadTokenUsage['total'],
    second?: UiThreadTokenUsage['total'],
  ): boolean {
    if (!first && !second) return true
    if (!first || !second) return false
    return (
      first.totalTokens === second.totalTokens &&
      first.inputTokens === second.inputTokens &&
      first.cachedInputTokens === second.cachedInputTokens &&
      first.outputTokens === second.outputTokens &&
      first.reasoningOutputTokens === second.reasoningOutputTokens
    )
  }

  function areThreadTokenUsagesEqual(first: UiThreadTokenUsage | null, second: UiThreadTokenUsage | null): boolean {
    if (!first && !second) return true
    if (!first || !second) return false
    return (
      first.modelContextWindow === second.modelContextWindow &&
      first.usedPercent === second.usedPercent &&
      first.remainingTokens === second.remainingTokens &&
      areTokenUsageBreakdownsEqual(first.total, second.total) &&
      areTokenUsageBreakdownsEqual(first.last, second.last)
    )
  }

  function setThreadTokenUsage(threadId: string, tokenUsage: UiThreadTokenUsage | null): void {
    if (!threadId) return
    const previous = threadTokenUsageByThreadId.value[threadId] ?? null
    if (areThreadTokenUsagesEqual(previous, tokenUsage)) return

    if (tokenUsage) {
      threadTokenUsageByThreadId.value = {
        ...threadTokenUsageByThreadId.value,
        [threadId]: tokenUsage,
      }
      return
    }

    if (previous) {
      threadTokenUsageByThreadId.value = omitKey(threadTokenUsageByThreadId.value, threadId)
    }
  }

  function refreshThreadTokenUsageInBackground(threadId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    if (threadTokenUsageByThreadId.value[normalizedThreadId]) return
    if (tokenUsageRefreshInFlightByThreadId.has(normalizedThreadId)) return
    const lastAttemptAt = tokenUsageRefreshAttemptedAtByThreadId.get(normalizedThreadId) ?? 0
    if (lastAttemptAt > 0 && Date.now() - lastAttemptAt < THREAD_TOKEN_USAGE_REFRESH_RETRY_MS) return

    tokenUsageRefreshAttemptedAtByThreadId.set(normalizedThreadId, Date.now())
    const request = getThreadTokenUsage(normalizedThreadId)
      .then((tokenUsage) => {
        if (tokenUsage) {
          setThreadTokenUsage(normalizedThreadId, tokenUsage)
          tokenUsageRefreshAttemptedAtByThreadId.delete(normalizedThreadId)
        }
      })
      .catch(() => {
        // Context usage is informational; never block or surface errors during thread switching.
      })
      .finally(() => {
        tokenUsageRefreshInFlightByThreadId.delete(normalizedThreadId)
      })
    tokenUsageRefreshInFlightByThreadId.set(normalizedThreadId, request)
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId) return
    if (threadId === selectedThreadId.value) return
    if (eventUnreadByThreadId.value[threadId] === true) return
    eventUnreadByThreadId.value = {
      ...eventUnreadByThreadId.value,
      [threadId]: true,
    }
    applyThreadFlags()
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: localizeActivityText(normalizedLabel),
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(threadId: string, message: string | null): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    if (isTransientConnectionStatusMessage(normalizedMessage)) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    if (previous?.message === normalizedMessage) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage },
    }
  }

  function clearTransientTurnErrorForThread(threadId: string): void {
    const previous = turnErrorByThreadId.value[threadId]?.message ?? ''
    if (!previous || !isTransientConnectionStatusMessage(previous)) return
    turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
  }

  function normalizeActiveTurnId(turnId: string): string {
    const normalizedTurnId = turnId.trim()
    return normalizedTurnId || UNKNOWN_ACTIVE_TURN_ID
  }

  function readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const maybeMessage = (error as { message?: unknown }).message
      if (typeof maybeMessage === 'string') return maybeMessage
      const maybeError = (error as { error?: unknown }).error
      if (typeof maybeError === 'string') return maybeError
    }
    return ''
  }

  function isTransientConnectionStatusMessage(message: string): boolean {
    const normalizedMessage = normalizeMessageText(message)
    if (!normalizedMessage) return false
    const lowerMessage = normalizedMessage.toLowerCase()
    if (
      lowerMessage.includes('responses/compact') ||
      lowerMessage.includes('remote compact') ||
      lowerMessage.includes('stream disconnected before completion')
    ) {
      return false
    }

    if (/reconnecting(?:\.*\s*\d+\s*\/\s*\d+)?/iu.test(normalizedMessage)) return true
    if (/实时通道|通知流|事件流|重连|断线重连/iu.test(normalizedMessage)) return true
    return (
      /websocket|eventsource|event source|sse|transport|notification stream|network|connection/iu.test(normalizedMessage) &&
      /timeout|timed out|disconnect|disconnected|reconnect|超时|断开|重连/iu.test(normalizedMessage)
    )
  }

  function isStaleInterruptError(error: unknown): boolean {
    const message = readErrorMessage(error).toLowerCase()
    if (!message) return false
    return (
      message.includes('no active turn') ||
      message.includes('not running') ||
      message.includes('already completed') ||
      message.includes('cannot interrupt') ||
      message.includes('unable to interrupt') ||
      message.includes('active turn not found') ||
      message.includes('thread not found')
    )
  }

  function setSyncErrorMessage(message: string | null): void {
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (syncError.value === normalizedMessage) return
    syncError.value = normalizedMessage
  }

  function setSyncErrorFromUnknown(error: unknown): void {
    setSyncErrorMessage(readErrorMessage(error))
  }

  function clearSyncError(): void {
    if (!syncError.value) return
    syncError.value = ''
  }

  function isThreadMaterializingError(error: unknown): boolean {
    const message = readErrorMessage(error).toLowerCase()
    if (!message) return false
    return (
      message.includes('is not materialized yet') ||
      message.includes('includeturns is unavailable before first user message') ||
      message.includes('no rollout found for thread id') ||
      (message.includes('rollout') && message.includes('is empty'))
    )
  }

  function isMissingThreadError(error: unknown): boolean {
    const message = readErrorMessage(error).toLowerCase()
    return message.includes('thread not found')
  }

  function isTerminalExecutionError(error: unknown): boolean {
    const message = readErrorMessage(error).toLowerCase()
    if (!message) return false
    return (
      isMissingThreadError(error) ||
      message.includes('error running remote compact task') ||
      message.includes('responses/compact') ||
      message.includes('stream disconnected before completion')
    )
  }

  function markThreadResumed(threadId: string): void {
    if (!threadId || resumedThreadById.value[threadId] === true) return
    resumedThreadById.value = {
      ...resumedThreadById.value,
      [threadId]: true,
    }
  }

  function ensureThreadResumed(threadId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || resumedThreadById.value[normalizedThreadId] === true) {
      return Promise.resolve()
    }

    const existingPromise = resumePromiseByThreadId.get(normalizedThreadId)
    if (existingPromise) {
      return existingPromise
    }

    const nextPromise = resumeThread(normalizedThreadId, { signal: options.signal })
      .then(() => {
        markThreadResumed(normalizedThreadId)
      })
      .finally(() => {
        if (resumePromiseByThreadId.get(normalizedThreadId) === nextPromise) {
          resumePromiseByThreadId.delete(normalizedThreadId)
        }
      })

    resumePromiseByThreadId.set(normalizedThreadId, nextPromise)
    return nextPromise
  }

  function setThreadReadActiveState(threadId: string, nextState: ThreadReadActiveState | null): void {
    if (!threadId) return

    const previous = threadReadActiveStateByThreadId.value[threadId]
    if (!nextState) {
      if (!previous) return
      threadReadActiveStateByThreadId.value = omitKey(threadReadActiveStateByThreadId.value, threadId)
      return
    }

    if (
      previous &&
      previous.turnId === nextState.turnId &&
      previous.firstObservedAtMs === nextState.firstObservedAtMs &&
      previous.lastObservedAtMs === nextState.lastObservedAtMs
    ) {
      return
    }

    threadReadActiveStateByThreadId.value = {
      ...threadReadActiveStateByThreadId.value,
      [threadId]: nextState,
    }
  }

  function rememberIgnoredStaleActiveTurn(threadId: string, turnId: string): void {
    if (!threadId || !turnId) return
    if (ignoredStaleActiveTurnByThreadId.value[threadId] === turnId) return
    ignoredStaleActiveTurnByThreadId.value = {
      ...ignoredStaleActiveTurnByThreadId.value,
      [threadId]: turnId,
    }
  }

  function clearIgnoredStaleActiveTurn(threadId: string): void {
    if (!threadId || !(threadId in ignoredStaleActiveTurnByThreadId.value)) return
    ignoredStaleActiveTurnByThreadId.value = omitKey(ignoredStaleActiveTurnByThreadId.value, threadId)
  }

  function markThreadLiveExecutionSignal(threadId: string): void {
    if (!threadId) return
    const now = Date.now()
    const previous = lastExecutionSignalAtByThreadId.value[threadId] ?? 0
    if (now > previous) {
      lastExecutionSignalAtByThreadId.value = {
        ...lastExecutionSignalAtByThreadId.value,
        [threadId]: now,
      }
    }
    clearTransientTurnErrorForThread(threadId)
    clearIgnoredStaleActiveTurn(threadId)
  }

  function clearThreadExecutionTracking(threadId: string): void {
    if (!threadId) return
    setThreadReadActiveState(threadId, null)
    clearIgnoredStaleActiveTurn(threadId)
    settlePersistedRunningCommandsForThread(threadId)
    if (threadId in lastExecutionSignalAtByThreadId.value) {
      lastExecutionSignalAtByThreadId.value = omitKey(lastExecutionSignalAtByThreadId.value, threadId)
    }
  }

  function settleRecoveredExecutionTracking(threadId: string): void {
    if (!threadId) return
    clearThreadExecutionTracking(threadId)
    setThreadInProgress(threadId, false)
    setTurnActivityForThread(threadId, null)
    clearLiveReasoningForThread(threadId)
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    runtimeExecutionStateByThreadId.value = {
      ...runtimeExecutionStateByThreadId.value,
      [threadId]: 'completed',
    }
    if (threadId in runtimeStaleByThreadId.value) {
      runtimeStaleByThreadId.value = omitKey(runtimeStaleByThreadId.value, threadId)
    }
    if (threadId in runtimeCanStopByThreadId.value) {
      runtimeCanStopByThreadId.value = omitKey(runtimeCanStopByThreadId.value, threadId)
    }
  }

  function clearSettledRuntimeResidue(
    threadId: string,
    state: ThreadRuntimeSnapshot['executionState'] = 'completed',
  ): void {
    if (!threadId) return
    clearThreadExecutionTracking(threadId)
    setThreadInProgress(threadId, false)
    setTurnActivityForThread(threadId, null)
    clearLiveReasoningForThread(threadId)
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    if (threadId in runtimeCanStopByThreadId.value) {
      runtimeCanStopByThreadId.value = omitKey(runtimeCanStopByThreadId.value, threadId)
    }
    if (isRuntimeExecutionSettledState(state)) {
      runtimeExecutionStateByThreadId.value = {
        ...runtimeExecutionStateByThreadId.value,
        [threadId]: state,
      }
    }
  }

  function settleTerminalExecutionError(threadId: string, terminalError: unknown): void {
    if (!threadId) return

    const errorMessage = normalizeMessageText(readErrorMessage(terminalError)) || '任务已中断，状态已恢复'
    clearPendingTurnRequest(threadId)
    clearSettledRuntimeResidue(threadId, 'failed')
    setPendingServerRequestsForThread(threadId, [])
    setTurnErrorForThread(threadId, errorMessage)
    error.value = errorMessage
    pendingThreadMessageRefresh.delete(threadId)
    pendingThreadsRefresh = true

    if (!isMissingThreadError(terminalError)) {
      void processQueuedMessages(threadId)
    }
  }

  function hasFreshExecutionSignal(threadId: string, maxAgeMs = ACTIVE_SYNC_STALE_MS): boolean {
    if (!threadId) return false
    const lastSignalAt = lastExecutionSignalAtByThreadId.value[threadId] ?? 0
    return lastSignalAt > 0 && Date.now() - lastSignalAt < maxAgeMs
  }

  function getThreadUpdatedAtMs(threadId: string): number {
    if (!threadId) return 0
    const updatedAtIso = sourceThreadById.value[threadId]?.updatedAtIso ?? ''
    if (!updatedAtIso) return 0
    const updatedAtMs = Date.parse(updatedAtIso)
    return Number.isFinite(updatedAtMs) ? updatedAtMs : 0
  }

  function hasLoadedThreadDetail(threadId: string): boolean {
    if (!threadId) return false
    return loadedMessagesByThreadId.value[threadId] === true || (lastThreadDetailSyncAtById.value[threadId] ?? 0) > 0
  }

  function isRuntimeExecutionActiveState(state: ThreadRuntimeSnapshot['executionState'] | undefined): boolean {
    return (
      state === 'queued' ||
      state === 'starting' ||
      state === 'start_uncertain' ||
      state === 'running' ||
      state === 'waiting_permission' ||
      state === 'stopping' ||
      state === 'stop_uncertain'
    )
  }

  function isRuntimeExecutionSettledState(state: ThreadRuntimeSnapshot['executionState'] | undefined): boolean {
    return (
      state === 'completed_pending_sync' ||
      state === 'completed' ||
      state === 'failed' ||
      state === 'interrupted' ||
      state === 'stopped' ||
      state === 'idle' ||
      state === 'sync_degraded'
    )
  }

  function getSettledRuntimeMessageRefreshKey(snapshot: ThreadRuntimeSnapshot | null): string {
    if (!snapshot) return ''
    if (!isRuntimeExecutionSettledState(snapshot.executionState)) return ''
    if ((snapshot.pendingServerRequests ?? []).length > 0) return ''

    const eventSeqKey = snapshot.lastEventSeq > 0 ? `seq:${snapshot.lastEventSeq}` : ''
    const timeKey = snapshot.lastCompletedAtIso || snapshot.lastEventAtIso || ''
    if (!eventSeqKey && !timeKey) return ''
    return `${snapshot.executionState}:${eventSeqKey}:${timeKey}`
  }

  function shouldRefreshMessagesForSettledRuntime(threadId: string, snapshot: ThreadRuntimeSnapshot | null): boolean {
    if (!threadId) return false
    const refreshKey = getSettledRuntimeMessageRefreshKey(snapshot)
    if (!refreshKey) return false
    return settledRuntimeMessageRefreshKeyByThreadId.get(threadId) !== refreshKey
  }

  function markSettledRuntimeMessagesRefreshed(threadId: string, snapshot: ThreadRuntimeSnapshot | null): void {
    if (!threadId) return
    const refreshKey = getSettledRuntimeMessageRefreshKey(snapshot)
    if (!refreshKey) return
    settledRuntimeMessageRefreshKeyByThreadId.set(threadId, refreshKey)
  }

  function isRuntimeExecutionStale(threadId: string): boolean {
    return runtimeStaleByThreadId.value[threadId] === true
  }

  function isRuntimeExecutionFreshActiveState(threadId: string): boolean {
    return isRuntimeExecutionActiveState(runtimeExecutionStateByThreadId.value[threadId]) && !isRuntimeExecutionStale(threadId)
  }

  function emptyRuntimeStatusSummary(threadId: string): UiRuntimeStatusSummary {
    return {
      threadId,
      executionState: 'idle',
      canStop: false,
      stale: false,
      stopRequested: false,
      activeTurnId: '',
      lastError: null,
      degradedReason: null,
      messageState: 'unavailable',
      updatedAtIso: '',
      lastEventSeq: 0,
      lastStartedAtIso: null,
      lastCompletedAtIso: null,
    }
  }

  function rememberRuntimeStatusSummary(threadId: string, nextSummary: UiRuntimeStatusSummary): void {
    if (!threadId) return
    const previous = runtimeStatusSummaryByThreadId.value[threadId]
    if (previous && JSON.stringify(previous) === JSON.stringify(nextSummary)) return
    runtimeStatusSummaryByThreadId.value = {
      ...runtimeStatusSummaryByThreadId.value,
      [threadId]: nextSummary,
    }
  }

  function rememberRuntimeSnapshotSummary(threadId: string, snapshot: ThreadRuntimeSnapshot): void {
    rememberRuntimeStatusSummary(threadId, {
      threadId,
      executionState: snapshot.executionState,
      canStop: snapshot.canStop && !snapshot.stale,
      stale: snapshot.stale,
      stopRequested: snapshot.stopRequested,
      activeTurnId: snapshot.activeTurnId,
      lastError: snapshot.lastError,
      degradedReason: snapshot.degradedReason,
      messageState: snapshot.messageState,
      updatedAtIso: snapshot.updatedAtIso,
      lastEventSeq: snapshot.lastEventSeq,
      lastStartedAtIso: snapshot.lastStartedAtIso,
      lastCompletedAtIso: snapshot.lastCompletedAtIso,
    })
  }

  function rememberRuntimeLocalStateSummary(
    threadId: string,
    state: ThreadRuntimeSnapshot['executionState'],
    options: { canStop?: boolean; activeTurnId?: string } = {},
  ): void {
    const previous = runtimeStatusSummaryByThreadId.value[threadId] ?? emptyRuntimeStatusSummary(threadId)
    const nextActiveTurnId = options.activeTurnId?.trim() || (isRuntimeExecutionSettledState(state) ? '' : previous.activeTurnId)
    rememberRuntimeStatusSummary(threadId, {
      ...previous,
      threadId,
      executionState: state,
      canStop: options.canStop === true,
      stale: false,
      stopRequested: state === 'stopping' || state === 'stop_uncertain'
        ? true
        : isRuntimeExecutionSettledState(state)
          ? false
          : previous.stopRequested,
      activeTurnId: nextActiveTurnId,
      updatedAtIso: new Date().toISOString(),
    })
  }

  function applyRuntimeSnapshotState(threadId: string, snapshot: ThreadRuntimeSnapshot): void {
    if (!threadId) return
    rememberRuntimeSnapshotSummary(threadId, snapshot)
    runtimeExecutionStateByThreadId.value = {
      ...runtimeExecutionStateByThreadId.value,
      [threadId]: snapshot.executionState,
    }
    if (snapshot.stale) {
      runtimeStaleByThreadId.value = {
        ...runtimeStaleByThreadId.value,
        [threadId]: true,
      }
    } else if (threadId in runtimeStaleByThreadId.value) {
      runtimeStaleByThreadId.value = omitKey(runtimeStaleByThreadId.value, threadId)
    }
    if (snapshot.canStop && !snapshot.stale) {
      runtimeCanStopByThreadId.value = {
        ...runtimeCanStopByThreadId.value,
        [threadId]: true,
      }
    } else if (threadId in runtimeCanStopByThreadId.value) {
      runtimeCanStopByThreadId.value = omitKey(runtimeCanStopByThreadId.value, threadId)
    }

    if (isRuntimeExecutionActiveState(snapshot.executionState)) {
      if (snapshot.stale) return
      settledRuntimeMessageRefreshKeyByThreadId.delete(threadId)
      settledRuntimeRpcRefreshKeyByThreadId.delete(threadId)
      if (snapshot.executionState === 'start_uncertain') {
        setTurnActivityForThread(threadId, {
          label: 'Confirming status',
          details: snapshot.lastError ? [snapshot.lastError] : [],
        })
      } else if (snapshot.executionState === 'stopping') {
        setTurnActivityForThread(threadId, { label: 'Stopping', details: [] })
      } else if (snapshot.executionState === 'stop_uncertain') {
        setTurnActivityForThread(threadId, {
          label: 'Confirming stop',
          details: snapshot.lastError ? [snapshot.lastError] : [],
        })
      }
      markThreadLiveExecutionSignal(threadId)
      return
    }

    if (isRuntimeExecutionSettledState(snapshot.executionState)) {
      const hasPendingServerRequests = (snapshot.pendingServerRequests ?? []).length > 0
      if (!hasPendingServerRequests && pendingTurnRequestByThreadId.value[threadId]) {
        clearPendingTurnRequest(threadId)
      }
      if (!hasPendingServerRequests && !hasQueuedFollowupWork(threadId)) {
        clearSettledRuntimeResidue(threadId, snapshot.executionState)
        return
      }
      setThreadReadActiveState(threadId, null)
      clearIgnoredStaleActiveTurn(threadId)
    }
  }

  function setRuntimeExecutionState(
    threadId: string,
    state: ThreadRuntimeSnapshot['executionState'],
    options: { canStop?: boolean; activeTurnId?: string } = {},
  ): void {
    if (!threadId) return
    rememberRuntimeLocalStateSummary(threadId, state, options)
    runtimeExecutionStateByThreadId.value = {
      ...runtimeExecutionStateByThreadId.value,
      [threadId]: state,
    }
    if (threadId in runtimeStaleByThreadId.value) {
      runtimeStaleByThreadId.value = omitKey(runtimeStaleByThreadId.value, threadId)
    }

    if (options.canStop === true) {
      runtimeCanStopByThreadId.value = {
        ...runtimeCanStopByThreadId.value,
        [threadId]: true,
      }
    } else if (threadId in runtimeCanStopByThreadId.value) {
      runtimeCanStopByThreadId.value = omitKey(runtimeCanStopByThreadId.value, threadId)
    }

    const nextActiveTurnId = options.activeTurnId?.trim() ?? ''
    if (nextActiveTurnId) {
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [threadId]: nextActiveTurnId,
      }
    } else if (isRuntimeExecutionSettledState(state) && activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }

    if (isRuntimeExecutionActiveState(state)) {
      settledRuntimeMessageRefreshKeyByThreadId.delete(threadId)
      settledRuntimeRpcRefreshKeyByThreadId.delete(threadId)
      if (state === 'start_uncertain') {
        setTurnActivityForThread(threadId, { label: 'Confirming status', details: [] })
      } else if (state === 'stopping') {
        setTurnActivityForThread(threadId, { label: 'Stopping', details: [] })
      } else if (state === 'stop_uncertain') {
        setTurnActivityForThread(threadId, { label: 'Confirming stop', details: [] })
      }
      setThreadInProgress(threadId, true)
      markThreadLiveExecutionSignal(threadId)
      setThreadReadActiveState(threadId, null)
      clearIgnoredStaleActiveTurn(threadId)
      return
    }

    if (isRuntimeExecutionSettledState(state)) {
      setThreadInProgress(threadId, false)
      setThreadReadActiveState(threadId, null)
      clearIgnoredStaleActiveTurn(threadId)
      if (threadId in lastExecutionSignalAtByThreadId.value) {
        lastExecutionSignalAtByThreadId.value = omitKey(lastExecutionSignalAtByThreadId.value, threadId)
      }
    }
  }

  function applyRuntimeNotificationState(notification: RpcNotification): void {
    const method = notification.method

    if (method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (request) {
        setRuntimeExecutionState(request.threadId, 'waiting_permission', {
          canStop: true,
          activeTurnId: request.turnId,
        })
      }
      return
    }

    if (method === 'server/request/resolved') {
      const threadId = extractThreadIdFromNotification(notification)
      if (threadId) {
        setRuntimeExecutionState(threadId, 'running', { canStop: true })
      }
      return
    }

    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return

    if (method === 'turn/started' || method === 'thread/started') {
      const startedTurn = readTurnStartedInfo(notification)
      setRuntimeExecutionState(threadId, 'running', {
        canStop: true,
        activeTurnId: startedTurn?.turnId ?? '',
      })
      return
    }

    if (method === 'turn/completed' || method === 'thread/completed') {
      const turnError = readTurnErrorMessage(notification)
      setRuntimeExecutionState(threadId, turnError ? 'failed' : 'completed', { canStop: false })
      return
    }

    if (method === 'turn/interrupted' || method === 'thread/interrupted') {
      setRuntimeExecutionState(threadId, 'interrupted', { canStop: false })
      return
    }

    if (method === 'error' || method.endsWith('/failed')) {
      setRuntimeExecutionState(threadId, 'failed', { canStop: false })
      return
    }

    if (method === 'item/started' || method === 'item/updated' || method === 'item/delta' || method.endsWith('/delta')) {
      setRuntimeExecutionState(threadId, 'running', { canStop: true })
    }
  }

  async function refreshRuntimeStatusSnapshot(threadId: string, signal?: AbortSignal): Promise<ThreadRuntimeSnapshot | null> {
    if (!threadId) return null
    try {
      let snapshot = await getThreadRuntimeStatusSnapshot(threadId, { signal })
      if (
        snapshot.executionState === 'start_uncertain' ||
        snapshot.executionState === 'stopping' ||
        snapshot.executionState === 'stop_uncertain'
      ) {
        snapshot = await reconcileThreadRuntime(threadId, { signal })
      }
      applyRuntimeSnapshotState(threadId, snapshot)
      const normalizedPendingRequests = snapshot.pendingServerRequests
        .map((row) => normalizeServerRequest(row))
        .filter((request): request is UiServerRequest => request !== null)
      setPendingServerRequestsForThread(threadId, normalizedPendingRequests)
      setThreadTokenUsage(threadId, snapshot.tokenUsage)
      return snapshot
    } catch (error) {
      if (isAbortLikeError(error)) throw error
      if (isTerminalExecutionError(error)) {
        settleTerminalExecutionError(threadId, error)
      }
      return null
    }
  }

  function hasSettledThreadDetail(threadId: string): boolean {
    if (!threadId || !hasLoadedThreadDetail(threadId)) return false
    if (isRuntimeExecutionFreshActiveState(threadId)) return false
    if (inProgressById.value[threadId] === true) return false
    if (typeof activeTurnIdByThreadId.value[threadId] === 'string' && activeTurnIdByThreadId.value[threadId].trim().length > 0) return false
    if (hasPendingServerRequestSignal(threadId)) return false
    if (hasQueuedThreadWork(threadId)) return false
    return true
  }

  function hasStrongExecutionSignal(threadId: string): boolean {
    if (!threadId) return false
    if (hasQueuedThreadWork(threadId)) return true
    if (hasRunningLiveCommand(threadId)) return true
    if (!hasRecoveredCompletionAfterRunningCommand(threadId) && hasPersistedRunningCommand(threadId)) return true
    return (pendingServerRequestsByThreadId.value[threadId] ?? []).length > 0
  }

  function hasAuthoritativeExecutionSignal(threadId: string): boolean {
    if (!threadId) return false
    const runtimeState = runtimeExecutionStateByThreadId.value[threadId]
    if (isRuntimeExecutionFreshActiveState(threadId)) return true
    if (hasRecoveredCompletionAfterRunningActivity(threadId)) return false
    if (isRuntimeExecutionSettledState(runtimeState) && !hasStrongExecutionSignal(threadId)) return false
    if (hasSettledThreadDetail(threadId) && !hasStrongExecutionSignal(threadId)) return false
    if (sourceThreadById.value[threadId]?.inProgress === true && !hasLoadedThreadDetail(threadId)) return true
    if (hasStrongExecutionSignal(threadId)) return true
    return hasFreshExecutionSignal(threadId, OPTIMISTIC_EXECUTION_RECOVERY_GRACE_MS)
  }

  function resolveThreadReadExecutionState(
    threadId: string,
    inProgress: boolean,
    activeTurnId: string,
  ): { inProgress: boolean; activeTurnId: string } {
    if (!threadId) {
      return { inProgress: false, activeTurnId: '' }
    }

    const normalizedActiveTurnId = activeTurnId.trim()
    const runtimeState = runtimeExecutionStateByThreadId.value[threadId]
    if (isRuntimeExecutionSettledState(runtimeState) && !hasStrongExecutionSignal(threadId)) {
      clearThreadExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }
    if (hasRecoveredCompletionAfterRunningActivity(threadId)) {
      settleRecoveredExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }
    if (isRuntimeExecutionFreshActiveState(threadId)) {
      clearIgnoredStaleActiveTurn(threadId)
      return { inProgress: true, activeTurnId: normalizedActiveTurnId || activeTurnIdByThreadId.value[threadId] || '' }
    }

    if (!inProgress) {
      const currentActiveTurnId = activeTurnIdByThreadId.value[threadId]?.trim() ?? ''
      const hasRecoverableTransientState =
        hasPendingServerRequestSignal(threadId) ||
        hasQueuedThreadWork(threadId) ||
        hasFreshExecutionSignal(threadId, OPTIMISTIC_EXECUTION_RECOVERY_GRACE_MS)
      if (hasRecoverableTransientState) {
        return {
          inProgress: true,
          activeTurnId: currentActiveTurnId || normalizedActiveTurnId,
        }
      }
      clearThreadExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }

    if (
      isRuntimeExecutionStale(threadId) &&
      hasLoadedThreadDetail(threadId) &&
      hasRecoveredCompletionAfterRunningActivity(threadId) &&
      !hasPendingServerRequestSignal(threadId) &&
      !hasQueuedThreadWork(threadId)
    ) {
      clearThreadExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }

    if (hasStrongExecutionSignal(threadId)) {
      clearIgnoredStaleActiveTurn(threadId)
      return { inProgress: true, activeTurnId: normalizedActiveTurnId }
    }

    const activeTurnKey = normalizeActiveTurnId(normalizedActiveTurnId)
    if (ignoredStaleActiveTurnByThreadId.value[threadId] === activeTurnKey) {
      settleRecoveredExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }

    const now = Date.now()
    const previousState = threadReadActiveStateByThreadId.value[threadId]
    const nextState =
      previousState && previousState.turnId === activeTurnKey
        ? {
            ...previousState,
            lastObservedAtMs: now,
          }
        : {
            turnId: activeTurnKey,
            firstObservedAtMs: now,
            lastObservedAtMs: now,
          }
    setThreadReadActiveState(threadId, nextState)

    const lastSignalAt = lastExecutionSignalAtByThreadId.value[threadId] ?? 0
    const lastMeaningfulActivityAt = Math.max(lastSignalAt, nextState.firstObservedAtMs)
    const threadUpdatedAtMs = getThreadUpdatedAtMs(threadId)
    const shouldTreatAsImmediatelyStale =
      lastSignalAt <= 0 &&
      threadUpdatedAtMs > 0 &&
      now - threadUpdatedAtMs >= STALE_THREAD_ACTIVE_TURN_IMMEDIATE_MS

    if (
      shouldTreatAsImmediatelyStale ||
      now - lastMeaningfulActivityAt >= STALE_THREAD_ACTIVE_TURN_TTL_MS
    ) {
      rememberIgnoredStaleActiveTurn(threadId, activeTurnKey)
      settleRecoveredExecutionTracking(threadId)
      return { inProgress: false, activeTurnId: '' }
    }

    return { inProgress: true, activeTurnId: normalizedActiveTurnId }
  }

  function hasRunningLiveCommand(threadId: string): boolean {
    return (liveCommandsByThreadId.value[threadId] ?? [])
      .some((message) => message.commandExecution?.status === 'inProgress')
  }

  function hasAssistantOutputAfterLatestPersistedRunningCommand(threadId: string): boolean {
    const messages = persistedMessagesByThreadId.value[threadId] ?? []
    let latestRunningCommandIndex = -1
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index]?.commandExecution?.status === 'inProgress') {
        latestRunningCommandIndex = index
      }
    }
    if (latestRunningCommandIndex < 0) return false
    for (let index = latestRunningCommandIndex + 1; index < messages.length; index += 1) {
      const message = messages[index]
      if (message?.role === 'assistant' && message.text.trim().length > 0) return true
    }
    return false
  }

  function hasAssistantOutputAfterLatestUserMessage(threadId: string): boolean {
    const messages = persistedMessagesByThreadId.value[threadId] ?? []
    let latestUserMessageIndex = -1
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index]?.role === 'user') {
        latestUserMessageIndex = index
      }
    }
    if (latestUserMessageIndex < 0) return false
    for (let index = latestUserMessageIndex + 1; index < messages.length; index += 1) {
      const message = messages[index]
      if (message?.role === 'assistant' && message.text.trim().length > 0) return true
    }
    return false
  }

  function hasRecoveredCompletionAfterRunningCommand(threadId: string): boolean {
    if (!threadId) return false
    if (!hasLoadedThreadDetail(threadId)) return false
    if (!hasAssistantOutputAfterLatestPersistedRunningCommand(threadId)) return false
    if (hasPendingServerRequestSignal(threadId)) return false
    if (hasQueuedThreadWork(threadId)) return false
    return true
  }

  function hasRecoveredCompletionAfterRunningActivity(threadId: string): boolean {
    if (!threadId) return false
    if (!hasLoadedThreadDetail(threadId)) return false
    if (isRuntimeExecutionFreshActiveState(threadId)) return false
    if (hasPendingServerRequestSignal(threadId)) return false
    if (hasQueuedThreadWork(threadId)) return false
    if (hasAssistantOutputAfterLatestPersistedRunningCommand(threadId)) return true
    return hasRunningLiveCommand(threadId) && hasAssistantOutputAfterLatestUserMessage(threadId)
  }

  function settlePersistedRunningCommandsForThread(threadId: string): void {
    const messages = persistedMessagesByThreadId.value[threadId] ?? []
    if (!messages.some((message) => message.commandExecution?.status === 'inProgress')) return
    const now = Date.now()
    const nextMessages = messages.map((message) => {
      const commandExecution = message.commandExecution
      if (commandExecution?.status !== 'inProgress') return message
      const durationMs =
        typeof commandExecution.durationMs === 'number' && commandExecution.durationMs > 0
          ? commandExecution.durationMs
          : typeof commandExecution.startedAtMs === 'number' && commandExecution.startedAtMs > 0
            ? Math.max(0, now - commandExecution.startedAtMs)
            : commandExecution.durationMs
      return {
        ...message,
        commandExecution: {
          ...commandExecution,
          status: 'interrupted' as const,
          durationMs,
          startedAtMs: null,
        },
      }
    })
    setPersistedMessagesForThread(threadId, nextMessages)
  }

  function hasPersistedRunningCommand(threadId: string): boolean {
    if (!threadId) return false
    if (hasRecoveredCompletionAfterRunningActivity(threadId)) return false
    if (hasRecoveredCompletionAfterRunningCommand(threadId)) return false
    const runtimeIsStale = isRuntimeExecutionStale(threadId)
    const hasAuthoritativeRunningSignal =
      isRuntimeExecutionFreshActiveState(threadId) ||
      hasRunningLiveCommand(threadId) ||
      hasPendingServerRequestSignal(threadId) ||
      hasQueuedThreadWork(threadId) ||
      (!runtimeIsStale && hasFreshExecutionSignal(threadId, STALE_THREAD_ACTIVE_TURN_TTL_MS))
    if (!hasAuthoritativeRunningSignal) return false
    if (
      runtimeIsStale &&
      hasAssistantOutputAfterLatestPersistedRunningCommand(threadId) &&
      !hasRunningLiveCommand(threadId) &&
      !hasPendingServerRequestSignal(threadId) &&
      !hasQueuedThreadWork(threadId)
    ) return false
    if (hasSettledThreadDetail(threadId) && !hasRunningLiveCommand(threadId)) return false
    return (persistedMessagesByThreadId.value[threadId] ?? [])
      .some((message) => message.commandExecution?.status === 'inProgress')
  }

  function hasQueuedThreadWork(threadId: string): boolean {
    if (!threadId) return false
    if (pendingTurnRequestByThreadId.value[threadId]) return true
    if (queueProcessingByThreadId.value[threadId] === true) return true
    return (queuedMessagesByThreadId.value[threadId] ?? []).length > 0
  }

  function hasQueuedFollowupWork(threadId: string): boolean {
    if (!threadId) return false
    if (queueProcessingByThreadId.value[threadId] === true) return true
    return (queuedMessagesByThreadId.value[threadId] ?? []).length > 0
  }

  function hasPendingServerRequestSignal(threadId: string): boolean {
    if (!threadId) return false
    if ((pendingServerRequestsByThreadId.value[threadId] ?? []).length > 0) return true
    return (pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE] ?? []).length > 0
  }

  function isThreadExecutionActive(threadId: string): boolean {
    if (!threadId) return false
    if (hasRecoveredCompletionAfterRunningActivity(threadId)) return false
    const runtimeState = runtimeExecutionStateByThreadId.value[threadId]
    if (isRuntimeExecutionFreshActiveState(threadId)) return true
    if (isRuntimeExecutionSettledState(runtimeState) && !hasStrongExecutionSignal(threadId)) return false
    if (hasSettledThreadDetail(threadId) && !hasStrongExecutionSignal(threadId)) return false
    const hasAuthoritativeSignal = hasAuthoritativeExecutionSignal(threadId)
    if (inProgressById.value[threadId] === true && hasAuthoritativeSignal) return true

    const activeTurnId = activeTurnIdByThreadId.value[threadId]
    if (typeof activeTurnId === 'string' && activeTurnId.trim().length > 0 && hasAuthoritativeSignal) return true

    if (hasRunningLiveCommand(threadId)) return true
    if (hasPersistedRunningCommand(threadId)) return true
    if (hasQueuedThreadWork(threadId)) return true

    if (
      !hasSettledThreadDetail(threadId) &&
      turnActivityByThreadId.value[threadId] &&
      hasFreshExecutionSignal(threadId, LIVE_OVERLAY_ACTIVITY_GRACE_MS)
    ) {
      return true
    }

    const reasoningText = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (
      !hasSettledThreadDetail(threadId) &&
      reasoningText.trim().length > 0 &&
      hasFreshExecutionSignal(threadId, LIVE_OVERLAY_ACTIVITY_GRACE_MS)
    ) {
      return true
    }

    return false
  }

  function hasOptimisticOnlyExecutionState(threadId: string): boolean {
    if (!threadId || !isThreadExecutionActive(threadId)) return false
    if (sourceThreadById.value[threadId]?.inProgress === true) return false
    if (hasRunningLiveCommand(threadId) || hasPersistedRunningCommand(threadId)) return false
    if (hasPendingServerRequestSignal(threadId)) return false
    if (hasFreshExecutionSignal(threadId, OPTIMISTIC_EXECUTION_RECOVERY_GRACE_MS)) return false

    const pendingTurnRequest = pendingTurnRequestByThreadId.value[threadId]
    if (pendingTurnRequest) {
      return Date.now() - pendingTurnRequest.createdAtMs >= OPTIMISTIC_EXECUTION_RECOVERY_GRACE_MS
    }

    if (activeTurnIdByThreadId.value[threadId]) return true
    if (queueProcessingByThreadId.value[threadId] === true) return true
    return false
  }

  function reconcileLiveThreadState(threadId: string, inProgress: boolean): void {
    if (!threadId) return

    if (inProgress) {
      if (!turnActivityByThreadId.value[threadId]) {
        const hasRunningCommand =
          hasRunningLiveCommand(threadId) ||
          hasPersistedRunningCommand(threadId)
        setTurnActivityForThread(threadId, {
          label: hasRunningCommand ? 'Running command' : 'Thinking',
          details: [],
        })
      }
      return
    }

    setTurnActivityForThread(threadId, null)
    clearLiveReasoningForThread(threadId)
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
  }

  function clearRecoveredIdleThreadState(threadId: string): void {
    if (!threadId) return
    clearPendingTurnRequest(threadId)
    clearThreadExecutionTracking(threadId)
    setThreadInProgress(threadId, false)
    reconcileLiveThreadState(threadId, false)
  }

  function settleInterruptedThreadState(threadId: string): void {
    if (!threadId) return
    clearPendingTurnRequest(threadId)
    clearThreadExecutionTracking(threadId)
    setThreadInProgress(threadId, false)
    setTurnActivityForThread(threadId, null)
    setTurnErrorForThread(threadId, null)
    clearLiveReasoningForThread(threadId)
    setPendingServerRequestsForThread(threadId, [])
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    runtimeExecutionStateByThreadId.value = {
      ...runtimeExecutionStateByThreadId.value,
      [threadId]: 'interrupted',
    }
    if (threadId in runtimeStaleByThreadId.value) {
      runtimeStaleByThreadId.value = omitKey(runtimeStaleByThreadId.value, threadId)
    }
    if (threadId in runtimeCanStopByThreadId.value) {
      runtimeCanStopByThreadId.value = omitKey(runtimeCanStopByThreadId.value, threadId)
    }
  }

  async function recoverThreadExecutionState(threadId: string): Promise<void> {
    if (!threadId || !isThreadExecutionActive(threadId)) return
    const shouldRecover =
      hasOptimisticOnlyExecutionState(threadId) ||
      notificationStale.value ||
      syncLagging.value ||
      realtimeConnectionState.value === 'reconnecting' ||
      realtimeConnectionState.value === 'disconnected'
    if (!shouldRecover) return

    try {
      if (hasOptimisticOnlyExecutionState(threadId) || hasPendingServerRequestSignal(threadId)) {
        await loadPendingServerRequestsFromBridge()
      }
      await loadMessages(threadId, { silent: true })
    } catch {
      if (
        !hasPersistedRunningCommand(threadId) &&
        !hasRunningLiveCommand(threadId) &&
        !hasFreshExecutionSignal(threadId, ACTIVE_SYNC_STALE_MS)
      ) {
        clearRecoveredIdleThreadState(threadId)
      }
    }
  }

  function currentThreadVersion(threadId: string): string {
    const thread = sourceThreadById.value[threadId]
    return thread?.updatedAtIso ?? ''
  }

  function noteSuccessfulSync(): void {
    const now = Date.now()
    lastSuccessfulSyncAtMs.value = now
    notificationHealthTick.value = now
    clearSyncError()
  }

  function isDocumentVisible(): boolean {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  }

  function clearEventSyncTimer(): void {
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
  }

  function abortCurrentSync(): void {
    const controller = syncAbortController
    if (!controller) return
    if (!controller.signal.aborted) {
      controller.abort()
    }
    clearSyncAbortController(controller)
  }

  function scheduleEventSync(delayMs = EVENT_SYNC_DEBOUNCE_MS): void {
    if (typeof window === 'undefined') return
    if (eventSyncTimer !== null) {
      if (delayMs >= EVENT_SYNC_DEBOUNCE_MS) return
      clearEventSyncTimer()
    }
    eventSyncTimer = window.setTimeout(() => {
      eventSyncTimer = null
      void syncFromNotifications()
    }, Math.max(0, delayMs))
  }

  function queueSelectedThreadSync(options: { includeThreadList?: boolean; forceMessageRefresh?: boolean } = {}): void {
    if (options.includeThreadList !== false) {
      pendingThreadsRefresh = true
    }
    if (options.forceMessageRefresh === true && selectedThreadId.value) {
      pendingThreadMessageRefresh.add(selectedThreadId.value)
    }
  }

  function shouldRefreshThreadListForBackground(now = Date.now()): boolean {
    if (!hasLoadedThreads.value) return true
    if (pendingThreadsRefresh) return true
    return !selectedThreadId.value && now - lastThreadListSyncAtMs >= THREAD_LIST_REFRESH_INTERVAL_MS
  }

  function shouldRefreshThreadListForActiveBoost(now = Date.now()): boolean {
    if (!hasLoadedThreads.value) return true
    if (pendingThreadsRefresh) return true
    return !selectedThreadId.value && now - lastThreadListSyncAtMs >= ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS
  }

  function shouldRefreshThreadListForResume(isFirstAttempt: boolean, now = Date.now()): boolean {
    if (!hasLoadedThreads.value) return true
    if (pendingThreadsRefresh) return true
    if (androidShellAvailable) return false
    return isFirstAttempt && !selectedThreadId.value && now - lastThreadListSyncAtMs >= THREAD_LIST_REFRESH_INTERVAL_MS
  }

  function clearSyncAbortController(controller?: AbortController | null): void {
    if (!controller) {
      syncAbortController = null
      return
    }
    if (syncAbortController === controller) {
      syncAbortController = null
    }
  }

  function stopActiveSyncBoost(): void {
    if (activeSyncBoostTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(activeSyncBoostTimer)
      activeSyncBoostTimer = null
    }
  }

  function shouldRunActiveSyncBoost(now = Date.now()): boolean {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    if (now < activeSyncBoostUntilMs) return true
    if (!isThreadExecutionActive(threadId)) return false
    const lastSignalAt = lastExecutionSignalAtByThreadId.value[threadId] ?? 0
    return lastSignalAt > 0 && now - lastSignalAt < ACTIVE_SYNC_BOOST_WINDOW_MS
  }

  function scheduleActiveSyncBoost(): void {
    if (typeof window === 'undefined' || activeSyncBoostTimer !== null) return
    activeSyncBoostTimer = window.setInterval(() => {
      const now = Date.now()
      notificationHealthTick.value = now

      if (!isDocumentVisible()) {
        stopActiveSyncBoost()
        return
      }

      if (!shouldRunActiveSyncBoost(now)) {
        stopActiveSyncBoost()
        return
      }

      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) {
        stopActiveSyncBoost()
        return
      }

      const lastDetailSyncAt = lastThreadDetailSyncAtById.value[activeThreadId] ?? 0
      const shouldRefreshMessages =
        pendingThreadMessageRefresh.has(activeThreadId) ||
        now - lastDetailSyncAt >= ACTIVE_SYNC_BOOST_INTERVAL_MS
      const shouldRefreshThreads = shouldRefreshThreadListForActiveBoost(now)

      if (shouldRefreshMessages || shouldRefreshThreads) {
        void syncThreadStatus({
          includeThreadList: shouldRefreshThreads,
          forceMessageRefresh: shouldRefreshMessages,
        })
      }

      if (now >= activeSyncBoostUntilMs && !isThreadExecutionActive(activeThreadId)) {
        stopActiveSyncBoost()
      }
    }, ACTIVE_SYNC_BOOST_INTERVAL_MS)
  }

  function markActiveSyncBoost(durationMs = ACTIVE_SYNC_BOOST_WINDOW_MS): void {
    activeSyncBoostUntilMs = Math.max(activeSyncBoostUntilMs, Date.now() + durationMs)
    if (!isDocumentVisible()) return
    scheduleActiveSyncBoost()
  }

  function clearBufferedLiveDeltas(): void {
    if (liveDeltaFlushTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(liveDeltaFlushTimer)
      liveDeltaFlushTimer = null
    }
    bufferedAgentDeltaByKey.clear()
    bufferedCommandDeltaByKey.clear()
    bufferedReasoningDeltaByThreadId.clear()
  }

  function flushBufferedLiveDeltas(): void {
    if (liveDeltaFlushTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(liveDeltaFlushTimer)
      liveDeltaFlushTimer = null
    }

    if (
      bufferedAgentDeltaByKey.size === 0 &&
      bufferedCommandDeltaByKey.size === 0 &&
      bufferedReasoningDeltaByThreadId.size === 0
    ) {
      return
    }

    const agentEntries = Array.from(bufferedAgentDeltaByKey.values())
    const commandEntries = Array.from(bufferedCommandDeltaByKey.values())
    const reasoningEntries = Array.from(bufferedReasoningDeltaByThreadId.entries())
    bufferedAgentDeltaByKey.clear()
    bufferedCommandDeltaByKey.clear()
    bufferedReasoningDeltaByThreadId.clear()
    const activeThreadIds = new Set<string>()

    for (const [threadId, delta] of reasoningEntries) {
      activeThreadIds.add(threadId)
      const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
      setLiveReasoningText(threadId, `${previous}${delta}`)
    }

    const agentEntriesByThread = new Map<string, BufferedAgentDelta[]>()
    for (const entry of agentEntries) {
      activeThreadIds.add(entry.threadId)
      const rows = agentEntriesByThread.get(entry.threadId) ?? []
      rows.push(entry)
      agentEntriesByThread.set(entry.threadId, rows)
    }
    for (const [threadId, rows] of agentEntriesByThread) {
      let nextMessages = liveAgentMessagesByThreadId.value[threadId] ?? []
      for (const row of rows) {
        const existing = nextMessages.find((message) => message.id === row.messageId)
        nextMessages = upsertMessage(nextMessages, {
          id: row.messageId,
          role: 'assistant',
          text: `${existing?.text ?? ''}${row.delta}`,
          messageType: 'agentMessage.live',
        })
      }
      setLiveAgentMessagesForThread(threadId, nextMessages)
    }

    const commandEntriesByThread = new Map<string, BufferedCommandDelta[]>()
    for (const entry of commandEntries) {
      activeThreadIds.add(entry.threadId)
      const rows = commandEntriesByThread.get(entry.threadId) ?? []
      rows.push(entry)
      commandEntriesByThread.set(entry.threadId, rows)
    }
    for (const [threadId, rows] of commandEntriesByThread) {
      let nextMessages = liveCommandsByThreadId.value[threadId] ?? []
      for (const row of rows) {
        const current = nextMessages.find((message) => message.id === row.itemId)
        if (!current?.commandExecution) continue
        nextMessages = upsertMessage(nextMessages, {
          ...current,
          commandExecution: {
            ...current.commandExecution,
            aggregatedOutput: `${current.commandExecution.aggregatedOutput}${row.delta}`,
          },
        })
      }
      if (nextMessages !== liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: nextMessages }
      }
    }

    for (const threadId of activeThreadIds) {
      markThreadLiveExecutionSignal(threadId)
    }
  }

  function scheduleLiveDeltaFlush(): void {
    if (typeof window === 'undefined') {
      flushBufferedLiveDeltas()
      return
    }
    if (liveDeltaFlushTimer !== null) return
    liveDeltaFlushTimer = window.setTimeout(() => {
      liveDeltaFlushTimer = null
      flushBufferedLiveDeltas()
    }, LIVE_DELTA_BATCH_MS)
  }

  function bufferLiveAgentDelta(threadId: string, messageId: string, delta: string): void {
    if (!threadId || !messageId || !delta) return
    const key = `${threadId}:${messageId}`
    const current = bufferedAgentDeltaByKey.get(key)
    if (current) {
      current.delta += delta
    } else {
      bufferedAgentDeltaByKey.set(key, { threadId, messageId, delta })
    }
    scheduleLiveDeltaFlush()
  }

  function bufferLiveReasoningDelta(threadId: string, delta: string): void {
    if (!threadId || !delta) return
    bufferedReasoningDeltaByThreadId.set(threadId, `${bufferedReasoningDeltaByThreadId.get(threadId) ?? ''}${delta}`)
    scheduleLiveDeltaFlush()
  }

  function bufferLiveCommandDelta(threadId: string, itemId: string, delta: string): void {
    if (!threadId || !itemId || !delta) return
    const key = `${threadId}:${itemId}`
    const current = bufferedCommandDeltaByKey.get(key)
    if (current) {
      current.delta += delta
    } else {
      bufferedCommandDeltaByKey.set(key, { threadId, itemId, delta })
    }
    scheduleLiveDeltaFlush()
  }

  function setThreadScrollState(threadId: string, nextState: ThreadScrollState): void {
    if (!threadId) return

    const normalizedState: ThreadScrollState = {
      scrollTop: Math.max(0, nextState.scrollTop),
      isAtBottom: nextState.isAtBottom === true,
    }
    if (typeof nextState.scrollRatio === 'number' && Number.isFinite(nextState.scrollRatio)) {
      normalizedState.scrollRatio = clamp(nextState.scrollRatio, 0, 1)
    }

    const previousState = scrollStateByThreadId.value[threadId]
    if (
      previousState &&
      previousState.scrollTop === normalizedState.scrollTop &&
      previousState.isAtBottom === normalizedState.isAtBottom &&
      previousState.scrollRatio === normalizedState.scrollRatio
    ) {
      return
    }

    scrollStateByThreadId.value = {
      ...scrollStateByThreadId.value,
      [threadId]: normalizedState,
    }
    schedulePersistThreadScrollState()
  }

  function schedulePersistThreadScrollState(force = false): void {
    if (typeof window === 'undefined') return
    if (force) {
      if (scrollStateSaveTimer) {
        window.clearTimeout(scrollStateSaveTimer)
        scrollStateSaveTimer = null
      }
      saveThreadScrollStateMap(scrollStateByThreadId.value)
      return
    }
    if (scrollStateSaveTimer) {
      window.clearTimeout(scrollStateSaveTimer)
    }
    scrollStateSaveTimer = window.setTimeout(() => {
      scrollStateSaveTimer = null
      saveThreadScrollStateMap(scrollStateByThreadId.value)
    }, 180)
  }

  function shouldKeepThreadPinnedToBottom(threadId: string): boolean {
    if (!threadId || !shouldAutoScrollOnNextAgentEvent) return false
    const scrollState = scrollStateByThreadId.value[threadId]
    return !scrollState || scrollState.isAtBottom === true
  }

  function setPersistedMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = persistedMessagesByThreadId.value[threadId] ?? []
    if (!areMessageArraysEqual(previous, nextMessages)) {
      persistedMessagesByThreadId.value = {
        ...persistedMessagesByThreadId.value,
        [threadId]: nextMessages,
      }
    }

    const previousOptimistic = optimisticUserMessagesByThreadId.value[threadId] ?? []
    const nextOptimistic = filterVisibleOptimisticUserMessages(nextMessages, previousOptimistic)
    if (!areMessageArraysEqual(previousOptimistic, nextOptimistic)) {
      optimisticUserMessagesByThreadId.value = {
        ...optimisticUserMessagesByThreadId.value,
        [threadId]: nextOptimistic,
      }
    }
  }

  function addOptimisticUserMessage(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    fileAttachments: FileAttachment[] = [],
  ): string {
    if (!threadId) return ''
    const normalizedText = text.trim()
    const normalizedImages = imageUrls.map((url) => url.trim()).filter((url) => url.length > 0)
    const normalizedFileAttachments = fileAttachments
      .map((file) => ({
        label: file.label,
        path: file.path || file.fsPath || file.label,
      }))
      .filter((file) => file.path.trim().length > 0)

    if (!normalizedText && normalizedImages.length === 0 && normalizedFileAttachments.length === 0) {
      return ''
    }

    const optimisticMessage: UiMessage = {
      id: `optimistic-user:${threadId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      text: normalizedText,
      images: normalizedImages.length > 0 ? normalizedImages : undefined,
      fileAttachments: normalizedFileAttachments.length > 0 ? normalizedFileAttachments : undefined,
      messageType: OPTIMISTIC_USER_MESSAGE_TYPE,
    }
    const signature = userMessageSignature(optimisticMessage)
    const persistedCounts = countPersistedUserMessageSignatures(persistedMessagesByThreadId.value[threadId] ?? [])
    const meta: OptimisticUserMessageMeta = {
      kind: 'optimisticUserMessage',
      signature,
      baselineMatchCount: persistedCounts.get(signature) ?? 0,
      createdAtMs: Date.now(),
    }
    optimisticMessage.rawPayload = JSON.stringify(meta)

    optimisticUserMessagesByThreadId.value = {
      ...optimisticUserMessagesByThreadId.value,
      [threadId]: [...(optimisticUserMessagesByThreadId.value[threadId] ?? []), optimisticMessage],
    }
    return optimisticMessage.id
  }

  function removeOptimisticUserMessage(threadId: string, messageId: string): void {
    if (!threadId || !messageId) return
    const previous = optimisticUserMessagesByThreadId.value[threadId] ?? []
    const next = previous.filter((message) => message.id !== messageId)
    if (next.length === previous.length) return
    optimisticUserMessagesByThreadId.value = {
      ...optimisticUserMessagesByThreadId.value,
      [threadId]: next,
    }
  }

  function setLiveAgentMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveAgentMessagesByThreadId.value = {
      ...liveAgentMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveAgentMessagesForThread(threadId, next)
  }

  function setLiveReasoningText(threadId: string, text: string): void {
    if (!threadId) return
    const normalized = text.trim()
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (normalized.length === 0) {
      if (!previous) return
      liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
      return
    }
    if (previous === normalized) return
    liveReasoningTextByThreadId.value = {
      ...liveReasoningTextByThreadId.value,
      [threadId]: normalized,
    }
  }

  function clearLiveReasoningForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveReasoningTextByThreadId.value)) return
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  function readString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function readStringByAliases(record: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = readString(record[key])
      if (value) return value
    }
    return ''
  }

  function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function readNumberByAliases(record: Record<string, unknown>, ...keys: string[]): number | null {
    for (const key of keys) {
      const value = readNumber(record[key])
      if (typeof value === 'number') return value
    }
    return null
  }

  function normalizeTokenUsageBreakdown(value: unknown): UiThreadTokenUsage['total'] | null {
    const record = asRecord(value)
    if (!record) return null
    return {
      totalTokens: Math.max(0, readNumberByAliases(record, 'totalTokens', 'total_tokens') ?? 0),
      inputTokens: Math.max(0, readNumberByAliases(record, 'inputTokens', 'input_tokens') ?? 0),
      cachedInputTokens: Math.max(0, readNumberByAliases(record, 'cachedInputTokens', 'cached_input_tokens') ?? 0),
      outputTokens: Math.max(0, readNumberByAliases(record, 'outputTokens', 'output_tokens') ?? 0),
      reasoningOutputTokens: Math.max(0, readNumberByAliases(record, 'reasoningOutputTokens', 'reasoning_output_tokens') ?? 0),
    }
  }

  function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
    const record = asRecord(value)
    if (!record) return null
    const total = normalizeTokenUsageBreakdown(record.total ?? record.total_token_usage)
    const last = normalizeTokenUsageBreakdown(record.last ?? record.last_token_usage)
    if (!total || !last) return null

    const rawContextWindow = readNumberByAliases(record, 'modelContextWindow', 'model_context_window')
    const modelContextWindow =
      typeof rawContextWindow === 'number' && rawContextWindow > 0
        ? Math.max(0, rawContextWindow)
        : null
    const rawUsedPercent = readNumberByAliases(record, 'usedPercent', 'used_percent')
    const derivedUsedTokens =
      typeof modelContextWindow === 'number' && modelContextWindow > 0
        ? Math.min(Math.max(last.totalTokens, 0), modelContextWindow)
        : null
    const usedPercent =
      typeof rawUsedPercent === 'number'
        ? clamp(rawUsedPercent, 0, 100)
        : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number' && modelContextWindow > 0
          ? clamp((derivedUsedTokens / modelContextWindow) * 100, 0, 100)
          : null
    const rawRemainingTokens = readNumberByAliases(record, 'remainingTokens', 'remaining_tokens')
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

  function readThreadTokenUsageUpdate(notification: RpcNotification): { threadId: string; tokenUsage: UiThreadTokenUsage | null } | null {
    if (notification.method !== THREAD_TOKEN_USAGE_UPDATED_METHOD) return null
    const params = asRecord(notification.params)
    const threadId = readString(params?.threadId).trim()
    if (!threadId) return null
    return {
      threadId,
      tokenUsage: normalizeThreadTokenUsage(params?.tokenUsage),
    }
  }

  function getRateLimitWindowKey(window: UiRateLimitSnapshot['primary']): string {
    if (!window) return 'none'
    return [
      Math.round(window.usedPercent),
      window.windowDurationMins ?? 'any',
      window.resetsAt ?? 'open',
    ].join(':')
  }

  function getRateLimitSnapshotKey(snapshot: UiRateLimitSnapshot): string {
    const stableId = snapshot.limitId?.trim() || snapshot.limitName?.trim()
    if (stableId) return stableId
    return [
      snapshot.planType ?? '',
      getRateLimitWindowKey(snapshot.primary),
      getRateLimitWindowKey(snapshot.secondary),
      snapshot.credits?.balance ?? '',
      snapshot.credits?.unlimited === true ? 'unlimited' : '',
    ].join('|')
  }

  function normalizeRateLimitWindow(value: unknown): UiRateLimitSnapshot['primary'] {
    const record = asRecord(value)
    if (!record) return null

    return {
      usedPercent: clamp(readNumberByAliases(record, 'usedPercent', 'used_percent') ?? 0, 0, 100),
      windowDurationMins: readNumberByAliases(record, 'windowDurationMins', 'window_duration_mins', 'window_minutes'),
      resetsAt: readNumberByAliases(record, 'resetsAt', 'resets_at'),
    }
  }

  function normalizeRateLimitSnapshot(value: unknown, fallbackLimitId = ''): UiRateLimitSnapshot | null {
    const record = asRecord(value)
    if (!record) return null

    const credits = asRecord(record.credits)
    const limitId = readStringByAliases(record, 'limitId', 'limit_id') || fallbackLimitId
    return {
      limitId: limitId || null,
      limitName: readStringByAliases(record, 'limitName', 'limit_name') || null,
      primary: normalizeRateLimitWindow(record.primary),
      secondary: normalizeRateLimitWindow(record.secondary),
      credits: credits
        ? {
            hasCredits: credits.hasCredits === true || credits.has_credits === true,
            unlimited: credits.unlimited === true,
            balance: readString(credits.balance) || null,
          }
        : null,
      planType: readStringByAliases(record, 'planType', 'plan_type') || null,
    }
  }

  function normalizeRateLimitSnapshotsPayload(value: unknown): UiRateLimitSnapshot[] {
    const record = asRecord(value)
    if (!record) return []

    const next: UiRateLimitSnapshot[] = []
    const seen = new Set<string>()
    const pushSnapshot = (snapshot: UiRateLimitSnapshot | null): void => {
      if (!snapshot) return
      const key = getRateLimitSnapshotKey(snapshot)
      if (seen.has(key)) return
      seen.add(key)
      next.push(snapshot)
    }

    pushSnapshot(normalizeRateLimitSnapshot(record.rateLimits ?? record.rate_limits))

    const byLimitId = asRecord(record.rateLimitsByLimitId ?? record.rate_limits_by_limit_id)
    if (byLimitId) {
      for (const [limitId, snapshot] of Object.entries(byLimitId)) {
        pushSnapshot(normalizeRateLimitSnapshot(snapshot, limitId))
      }
    }

    return next
  }

  function extractThreadIdFromNotification(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    const directThreadId = readString(params.threadId)
    if (directThreadId) return directThreadId
    const snakeThreadId = readString(params.thread_id)
    if (snakeThreadId) return snakeThreadId

    const conversationId = readString(params.conversationId)
    if (conversationId) return conversationId
    const snakeConversationId = readString(params.conversation_id)
    if (snakeConversationId) return snakeConversationId

    const request = asRecord(params.request)
    const nestedRequestDirectThreadId = readString(request?.threadId)
    if (nestedRequestDirectThreadId) return nestedRequestDirectThreadId
    const nestedRequestDirectSnakeThreadId = readString(request?.thread_id)
    if (nestedRequestDirectSnakeThreadId) return nestedRequestDirectSnakeThreadId
    const nestedRequestParams = asRecord(request?.params)
    const nestedRequestThreadId = readString(nestedRequestParams?.threadId)
    if (nestedRequestThreadId) return nestedRequestThreadId
    const nestedRequestSnakeThreadId = readString(nestedRequestParams?.thread_id)
    if (nestedRequestSnakeThreadId) return nestedRequestSnakeThreadId

    const thread = asRecord(params.thread)
    const nestedThreadId = readString(thread?.id)
    if (nestedThreadId) return nestedThreadId

    const turn = asRecord(params.turn)
    const turnThreadId = readString(turn?.threadId)
    if (turnThreadId) return turnThreadId
    const turnSnakeThreadId = readString(turn?.thread_id)
    if (turnSnakeThreadId) return turnSnakeThreadId

    const item = asRecord(params.item)
    const itemThreadId = readString(item?.threadId)
    if (itemThreadId) return itemThreadId
    const itemSnakeThreadId = readString(item?.thread_id)
    if (itemSnakeThreadId) return itemSnakeThreadId

    const requestParams = asRecord(params.params)
    const requestThreadId = readString(requestParams?.threadId)
    if (requestThreadId) return requestThreadId
    const requestSnakeThreadId = readString(requestParams?.thread_id)
    if (requestSnakeThreadId) return requestSnakeThreadId

    return ''
  }

  function readTurnErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'turn/completed') return ''
    const params = asRecord(notification.params)
    const turn = asRecord(params?.turn)
    if (!turn || turn.status !== 'failed') return ''
    const errorPayload = asRecord(turn.error)
    return readString(errorPayload?.message)
  }

  function readNotificationErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'error') return ''
    const params = asRecord(notification.params)
    return (
      readString(params?.message) ||
      readString(asRecord(params?.error)?.message)
    )
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const method = readString(row.method)
    const requestParams = row.params
    if (typeof id !== 'number' || !Number.isInteger(id) || !method) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const threadId = extractThreadIdFromNotification({ method, params: requestParams, atIso: '' }) || GLOBAL_SERVER_REQUEST_SCOPE
    const turnId = readString(requestParamRecord?.turnId)
    const itemId = readString(requestParamRecord?.itemId)
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function setPendingServerRequestsForThread(threadId: string, requests: UiServerRequest[]): void {
    const normalizedThreadId = threadId.trim() || GLOBAL_SERVER_REQUEST_SCOPE
    const sorted = [...requests].sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
    if (sorted.length === 0) {
      if (!pendingServerRequestsByThreadId.value[normalizedThreadId]) return
      pendingServerRequestsByThreadId.value = omitKey(pendingServerRequestsByThreadId.value, normalizedThreadId)
      return
    }
    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [normalizedThreadId]: sorted,
    }
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
  }

  function pruneAutoResolvedPendingServerRequests(): void {
    if (Object.keys(pendingServerRequestsByThreadId.value).length === 0) return

    const next: Record<string, UiServerRequest[]> = {}
    let changed = false
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.method !== 'item/tool/call')
      if (filtered.length !== requests.length) {
        changed = true
      }
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }

    if (changed) {
      pendingServerRequestsByThreadId.value = next
      applyThreadFlags()
    }
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      showAndroidTaskNotification(
        'request',
        '需要确认',
        `${getThreadDisplayTitle(request.threadId)} 等待你的处理`,
        request.threadId,
      )
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' && Number.isInteger(id)) {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return localizeActivityText(value)
  }

  function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    if (notification.method === 'turn/started') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/started') {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        return {
          threadId,
          activity: {
            label: 'Thinking',
            details: [],
          },
        }
      }
      if (itemType === 'agentmessage') {
        return {
          threadId,
          activity: {
            label: 'Writing response',
            details: [],
          },
        }
      }
      if (itemType === 'commandexecution') {
        const cmd = readString(item?.command)
        return {
          threadId,
          activity: {
            label: 'Running command',
            details: cmd ? [cmd] : [],
          },
        }
      }
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Running command',
          details: [],
        },
      }
    }

    if (
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/summaryPartAdded'
    ) {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/agentMessage/delta') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }

    return null
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      completedAtMs,
      startedAtMs,
    }
  }

  function liveReasoningMessageId(reasoningItemId: string): string {
    return `${reasoningItemId}:live-reasoning`
  }

  function readReasoningStartedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readReasoningDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический источник дельт для UI — уже нормализованный item/*.
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { messageId: liveReasoningMessageId(itemId), delta }
    }

    return null
  }

  function readReasoningSectionBreakMessageId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    // Канонический source для section break — item/*
    if (notification.method === 'item/reasoning/summaryPartAdded') {
      const itemId = readString(params.itemId)
      if (!itemId) return ''
      return liveReasoningMessageId(itemId)
    }

    return ''
  }

  function readReasoningCompletedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return liveReasoningMessageId(readString(item.id))
    }

    return ''
  }

  function readAgentMessageStartedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический live-канал агентского текста.
    if (notification.method === 'item/agentMessage/delta') {
      const messageId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!messageId || !delta) return null
      return { messageId, delta }
    }

    return null
  }

  function readAgentMessageCompleted(notification: RpcNotification): UiMessage | null {
    const params = asRecord(notification.params)
    if (!params) return null

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return null
      const id = readString(item.id)
      const text = readString(item.text)
      if (!id || !text) return null
      return {
        id,
        role: 'assistant',
        text,
        messageType: 'agentMessage.live',
      }
    }

    return null
  }

  function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: {
        command,
        cwd,
        status: 'inProgress',
        aggregatedOutput: '',
        exitCode: null,
        durationMs: 0,
        startedAtMs: Date.now(),
      },
    }
  }

  function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
    if (notification.method !== 'item/commandExecution/outputDelta') return null
    const params = asRecord(notification.params)
    if (!params) return null
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { itemId, delta }
  }

  function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const statusRaw = readString(item.status)
    const status: CommandExecutionData['status'] =
      statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
    const aggregatedOutput = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    const durationMs = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? Math.max(0, item.durationMs) : null
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status, aggregatedOutput, exitCode, durationMs, startedAtMs: null },
    }
  }

  function upsertLiveCommand(threadId: string, msg: UiMessage): void {
    const previous = liveCommandsByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, msg)
    if (next === previous) return
    liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
  }

  function removeLiveCommandsPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveCommandsByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((m) => m.id))
    const next = current.filter((m) => !persistedIds.has(m.id))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    } else {
      liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
    }
  }

  function isAgentContentEvent(notification: RpcNotification): boolean {
    if (notification.method === 'item/agentMessage/delta') {
      return true
    }

    const params = asRecord(notification.params)
    if (!params) return false

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      return item?.type === 'agentMessage'
    }

    return false
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (notification.method === 'item/completed' || notification.method === 'turn/completed') {
      flushBufferedLiveDeltas()
    }

    applyRuntimeNotificationState(notification)

    if (handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'account/rateLimits/updated') {
      scheduleRateLimitRefresh()
    }

    if (COMPOSER_PLUGIN_INVALIDATING_NOTIFICATION_METHODS.has(notification.method)) {
      scheduleComposerPluginsRefreshFromNotification()
    }

    const threadTokenUsageUpdate = readThreadTokenUsageUpdate(notification)
    if (threadTokenUsageUpdate) {
      setThreadTokenUsage(threadTokenUsageUpdate.threadId, threadTokenUsageUpdate.tokenUsage)
    }

    if (shouldBoostSyncForNotification(notification.method)) {
      markActiveSyncBoost()
    }

    if (notification.method === 'thread/name/updated') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      const threadName = readString(params?.threadName)
      if (threadId && threadName) {
        threadTitleById.value = { ...threadTitleById.value, [threadId]: threadName }
        applyThreadFlags()
        void persistThreadTitle(threadId, threadName)
      }
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      markThreadLiveExecutionSignal(turnActivity.threadId)
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      markThreadLiveExecutionSignal(startedTurn.threadId)
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [startedTurn.threadId]: startedTurn.turnId,
      }
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      setThreadInProgress(startedTurn.threadId, true)
      if (eventUnreadByThreadId.value[startedTurn.threadId]) {
        eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, startedTurn.threadId)
      }
    }

    const completedTurn = readTurnCompletedInfo(notification)
    const turnErrorMessage = readTurnErrorMessage(notification)
    const completedThreadId = completedTurn?.threadId ?? extractThreadIdFromNotification(notification)
    const shouldRetryWithFallback =
      Boolean(completedThreadId) &&
      Boolean(turnErrorMessage) &&
      selectedModelId.value !== MODEL_FALLBACK_ID &&
      isUnsupportedChatGptModelError(new Error(turnErrorMessage))
    if (completedTurn) {
      const pendingTurnRequest = pendingTurnRequestByThreadId.value[completedTurn.threadId]
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
      })
      clearThreadExecutionTracking(completedTurn.threadId)
      if (activeTurnIdByThreadId.value[completedTurn.threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, completedTurn.threadId)
      }
      setThreadInProgress(completedTurn.threadId, false)
      setTurnActivityForThread(completedTurn.threadId, null)
      markThreadUnreadByEvent(completedTurn.threadId)
      if (!shouldRetryWithFallback) {
        clearPendingTurnRequest(completedTurn.threadId)
        void processQueuedMessages(completedTurn.threadId)
      }
      if (!turnErrorMessage && !shouldRetryWithFallback) {
        const commitMessage = pendingTurnRequest?.text?.trim() || AUTO_COMMIT_MESSAGE_FALLBACK
        void autoCommitCompletedWorktreeTurn(completedTurn.threadId, commitMessage).catch(() => {
          // Keep chat flow resilient when auto-commit fails.
        })
        showAndroidTaskNotification(
          'success',
          '任务已完成',
          getThreadDisplayTitle(completedTurn.threadId),
          completedTurn.threadId,
        )
      }
    }

    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
        showAndroidTaskNotification(
          'error',
          '任务出错',
          turnErrorMessage,
          failedThreadId,
        )
      }
      error.value = turnErrorMessage
      if (failedThreadId && shouldRetryWithFallback) {
        void retryPendingTurnWithFallback(failedThreadId)
      }
    } else if (completedTurn) {
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    const notificationErrorMessage = readNotificationErrorMessage(notification)
    if (notificationErrorMessage) {
      const errorThreadId = extractThreadIdFromNotification(notification)
      if (isTransientConnectionStatusMessage(notificationErrorMessage)) {
        if (errorThreadId) {
          clearTransientTurnErrorForThread(errorThreadId)
          if (isThreadExecutionActive(errorThreadId)) {
            markThreadLiveExecutionSignal(errorThreadId)
          }
        }
        if (error.value === notificationErrorMessage) {
          error.value = ''
        }
      } else {
        const terminalErrorThreadId =
          isTerminalExecutionError(notificationErrorMessage) && !errorThreadId
            ? selectedThreadId.value
            : errorThreadId
        if (terminalErrorThreadId && isTerminalExecutionError(notificationErrorMessage)) {
          settleTerminalExecutionError(terminalErrorThreadId, notificationErrorMessage)
          showAndroidTaskNotification(
            'error',
            '任务出错',
            notificationErrorMessage,
            terminalErrorThreadId,
          )
        } else if (errorThreadId) {
          setTurnErrorForThread(errorThreadId, notificationErrorMessage)
          showAndroidTaskNotification(
            'error',
            '任务出错',
            notificationErrorMessage,
            errorThreadId,
          )
        }
        error.value = notificationErrorMessage
        if (selectedModelId.value !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(new Error(notificationErrorMessage))) {
          if (errorThreadId) {
            void retryPendingTurnWithFallback(errorThreadId)
          } else {
            void applyFallbackModelSelection()
          }
        }
      }
    }

    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (!notificationThreadId || notificationThreadId !== selectedThreadId.value) return

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      markThreadLiveExecutionSignal(notificationThreadId)
      activeReasoningItemId = ''
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      markThreadLiveExecutionSignal(notificationThreadId)
      bufferLiveAgentDelta(notificationThreadId, liveAgentMessageDelta.messageId, liveAgentMessageDelta.delta)
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      markThreadLiveExecutionSignal(notificationThreadId)
      upsertLiveAgentMessage(notificationThreadId, completedAgentMessage)
    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      markThreadLiveExecutionSignal(notificationThreadId)
      activeReasoningItemId = startedReasoningItemId
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      markThreadLiveExecutionSignal(notificationThreadId)
      bufferLiveReasoningDelta(notificationThreadId, liveReasoningDelta.delta)
    }

    const sectionBreakMessageId = readReasoningSectionBreakMessageId(notification)
    if (sectionBreakMessageId) {
      markThreadLiveExecutionSignal(notificationThreadId)
      const current = liveReasoningTextByThreadId.value[notificationThreadId] ?? ''
      if (current.trim().length > 0 && !current.endsWith('\n\n')) {
        setLiveReasoningText(notificationThreadId, `${current}\n\n`)
      }
    }

    const completedReasoningMessageId = readReasoningCompletedId(notification)
    if (completedReasoningMessageId) {
      markThreadLiveExecutionSignal(notificationThreadId)
      if (completedReasoningMessageId === liveReasoningMessageId(activeReasoningItemId)) {
        activeReasoningItemId = ''
      }
    }

    const commandStarted = readCommandExecutionStarted(notification)
    if (commandStarted) {
      markThreadLiveExecutionSignal(notificationThreadId)
      upsertLiveCommand(notificationThreadId, commandStarted)
      setTurnActivityForThread(notificationThreadId, { label: 'Running command', details: [commandStarted.commandExecution?.command ?? ''] })
    }

    const commandDelta = readCommandOutputDelta(notification)
    if (commandDelta) {
      markThreadLiveExecutionSignal(notificationThreadId)
      bufferLiveCommandDelta(notificationThreadId, commandDelta.itemId, commandDelta.delta)
    }

    const commandCompleted = readCommandExecutionCompleted(notification)
    if (commandCompleted) {
      markThreadLiveExecutionSignal(notificationThreadId)
      upsertLiveCommand(notificationThreadId, commandCompleted)
    }

    if (isAgentContentEvent(notification)) {
      markThreadLiveExecutionSignal(notificationThreadId)
      if (shouldKeepThreadPinnedToBottom(selectedThreadId.value)) {
        setThreadScrollState(selectedThreadId.value, {
          scrollTop: 0,
          isAtBottom: true,
          scrollRatio: 1,
        })
      }
      activeReasoningItemId = ''
      clearLiveReasoningForThread(notificationThreadId)
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemId = ''
      shouldAutoScrollOnNextAgentEvent = false
      clearLiveReasoningForThread(notificationThreadId)
      if (liveCommandsByThreadId.value[notificationThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, notificationThreadId)
      }
      const completedThreadId = extractThreadIdFromNotification(notification)
      if (completedThreadId) {
        setThreadInProgress(completedThreadId, false)
        setTurnActivityForThread(completedThreadId, null)
        markThreadUnreadByEvent(completedThreadId)
        if (!shouldRetryWithFallback) {
          clearPendingTurnRequest(completedThreadId)
          void processQueuedMessages(completedThreadId)
        }
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    const threadId = extractThreadIdFromNotification(notification)
    const method = notification.method
    const urgentRefresh = shouldUrgentlyRefreshFromNotification(method)
    const shouldRefreshMessages =
      shouldRefreshMessagesFromNotification(method) &&
      !(
        threadId &&
        pendingTurnRequestByThreadId.value[threadId] &&
        loadedMessagesByThreadId.value[threadId] !== true &&
        (
          method === 'turn/started' ||
          method === 'thread/started' ||
          method === 'thread/status/changed'
        )
      )
    const shouldRefreshThreads = shouldRefreshThreadListFromNotification(method)

    if (threadId && shouldRefreshMessages) {
      pendingThreadMessageRefresh.add(threadId)
    }

    if (shouldRefreshThreads) {
      pendingThreadsRefresh = true
    }

    if (!shouldRefreshMessages && !shouldRefreshThreads) return
    if (urgentRefresh && isPolling.value) {
      abortCurrentSync()
    }
    scheduleEventSync(urgentRefresh ? 0 : EVENT_SYNC_DEBOUNCE_MS)
  }

  async function hydrateWorkspaceRootsStateIfNeeded(groups: UiProjectGroup[]): Promise<void> {
    if (hasHydratedWorkspaceRootsState) return
    hasHydratedWorkspaceRootsState = true

    try {
      const rootsState = await getWorkspaceRootsState()
      const hydratedOrder: string[] = []
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (hydratedOrder.includes(projectName)) continue
        hydratedOrder.push(projectName)
      }

      if (hydratedOrder.length > 0) {
        const mergedOrder = mergeProjectOrder(hydratedOrder, groups)
        if (!areStringArraysEqual(projectOrder.value, mergedOrder)) {
          projectOrder.value = mergedOrder
          saveProjectOrder(projectOrder.value)
        }
      }

      if (Object.keys(rootsState.labels).length > 0) {
        const nextLabels = { ...projectDisplayNameById.value }
        let changed = false
        for (const [rootPath, label] of Object.entries(rootsState.labels)) {
          const projectName = toProjectNameFromWorkspaceRoot(rootPath)
          if (nextLabels[projectName] === label) continue
          nextLabels[projectName] = label
          changed = true
        }
        if (changed) {
          projectDisplayNameById.value = nextLabels
          saveProjectDisplayNames(nextLabels)
        }
      }
    } catch {
      // Keep local storage fallback when global state is unavailable.
    }
  }

  async function loadThreadTitleCacheIfNeeded(): Promise<void> {
    if (Object.keys(threadTitleById.value).length > 0) return
    try {
      const cache = await getThreadTitleCache()
      if (Object.keys(cache.titles).length > 0) {
        threadTitleById.value = cache.titles
      }
    } catch {
      // Title cache is optional; keep UI functional.
    }
  }

  async function requestThreadTitleGeneration(threadId: string, prompt: string, cwd: string | null): Promise<void> {
    if (threadTitleById.value[threadId]) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    const truncated = trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed
    try {
      const title = await generateThreadTitle(truncated, cwd)
      if (!title || threadTitleById.value[threadId]) return
      threadTitleById.value = { ...threadTitleById.value, [threadId]: title }
      applyThreadFlags()
      void persistThreadTitle(threadId, title)
    } catch {
      // Title generation is best-effort.
    }
  }

  async function loadThreads(options: { signal?: AbortSignal; preserveMissingSelected?: boolean } = {}) {
    if (!hasLoadedThreads.value) {
      isLoadingThreads.value = true
    }

    try {
      const [groups] = await Promise.all([getThreadGroups({ signal: options.signal }), loadThreadTitleCacheIfNeeded()])
      const hiddenThreadIdSet = new Set(hiddenThreadIds.value)
      const visibleGroups = groups
        .map((group) => ({
          projectName: group.projectName,
          threads: group.threads.filter((thread) => !hiddenThreadIdSet.has(thread.id)),
        }))
        .filter((group) => group.threads.length > 0)
      await hydrateWorkspaceRootsStateIfNeeded(visibleGroups)

      const nextProjectOrder = mergeProjectOrder(projectOrder.value, visibleGroups)
      if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
        projectOrder.value = nextProjectOrder
        saveProjectOrder(projectOrder.value)
      }

      const orderedGroups = orderGroupsByProjectOrder(visibleGroups, projectOrder.value)
      const executionStateByThreadId = Object.fromEntries(
        sourceThreads.value.map((thread) => [thread.id, isThreadExecutionActive(thread.id)]),
      ) as Record<string, boolean>
      const mergedWithInProgress = mergeIncomingWithLocalInProgressThreads(
        sourceGroups.value,
        orderedGroups,
        executionStateByThreadId,
      )
      sourceGroups.value = mergeThreadGroups(sourceGroups.value, mergedWithInProgress)
      inProgressById.value = pruneThreadStateMap(
        inProgressById.value,
        new Set(flattenThreads(sourceGroups.value).map((thread) => thread.id)),
      )
      lastThreadListSyncAtMs = Date.now()
      noteSuccessfulSync()
      applyThreadFlags()
      hasLoadedThreads.value = true

      const flatThreads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(flatThreads)

      const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)

      if (!currentExists && options.preserveMissingSelected !== true) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
  }

  async function refreshSettledSnapshotMessagesFromRpc(
    threadId: string,
    snapshot: ThreadRuntimeSnapshot,
    previousMessages: UiMessage[],
    signal?: AbortSignal,
  ): Promise<ThreadRuntimeSnapshot> {
    const refreshKey = getSettledRuntimeMessageRefreshKey(snapshot)
    if (!refreshKey) return snapshot
    const nextMessageIds = new Set(snapshot.messages.map((message) => message.id))
    const snapshotMissesPreviousMessages = previousMessages.some((message) => !nextMessageIds.has(message.id))
    if (
      settledRuntimeRpcRefreshKeyByThreadId.get(threadId) === refreshKey &&
      !snapshotMissesPreviousMessages
    ) {
      return snapshot
    }
    if ((snapshot.pendingServerRequests ?? []).length > 0) return snapshot

    try {
      const detail = await getThreadDetail(threadId, { signal })
      if (detail.messages.length === 0 && snapshot.messages.length > 0) {
        return snapshot
      }
      settledRuntimeRpcRefreshKeyByThreadId.set(threadId, refreshKey)
      return {
        ...snapshot,
        messages: detail.messages,
        inProgress: detail.inProgress,
        activeTurnId: detail.activeTurnId,
        canStop: detail.inProgress,
        executionState: detail.inProgress ? 'running' : snapshot.executionState,
        messageState: 'fresh',
      }
    } catch {
      return snapshot
    }
  }

  function shouldPreserveMessagesAfterSettledRpcRefresh(
    threadId: string,
    snapshot: ThreadRuntimeSnapshot,
    previousMessages: UiMessage[],
    nextMessages: UiMessage[],
  ): boolean {
    const refreshKey = getSettledRuntimeMessageRefreshKey(snapshot)
    if (!refreshKey || settledRuntimeRpcRefreshKeyByThreadId.get(threadId) !== refreshKey) return false
    if (previousMessages.length === 0 || nextMessages.length >= previousMessages.length) return false

    const nextMessageIds = new Set(nextMessages.map((message) => message.id))
    return previousMessages.some((message) => !nextMessageIds.has(message.id))
  }

  async function loadMessages(threadId: string, options: { silent?: boolean; signal?: AbortSignal } = {}) {
    if (!threadId) {
      return
    }

    flushBufferedLiveDeltas()

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    const loadId = shouldShowLoading ? ++foregroundMessageLoadId : 0
    if (shouldShowLoading) {
      isLoadingMessages.value = true
    }

    const existingLoad = messageLoadInFlightByThreadId.get(threadId)
    if (existingLoad) {
      try {
        await existingLoad
      } finally {
        if (shouldShowLoading && foregroundMessageLoadId === loadId) {
          isLoadingMessages.value = false
        }
      }
      return
    }

    const runLoad = (async (): Promise<void> => {
      let snapshot: ThreadRuntimeSnapshot
      try {
        snapshot = await getThreadRuntimeSnapshot(threadId, { signal: options.signal })
      } catch (error) {
        if (resumedThreadById.value[threadId] === true || !isThreadMaterializingError(error)) {
          throw error
        }
        await ensureThreadResumed(threadId, { signal: options.signal })
        snapshot = await getThreadRuntimeSnapshot(threadId, { signal: options.signal })
      }
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      snapshot = await refreshSettledSnapshotMessagesFromRpc(threadId, snapshot, previousPersisted, options.signal)

      applyRuntimeSnapshotState(threadId, snapshot)
      const nextMessages = snapshot.messages
      const inProgress = snapshot.inProgress
      const activeTurnId = snapshot.activeTurnId
      setThreadTokenUsage(threadId, snapshot.tokenUsage)
      if (!snapshot.tokenUsage && typeof window !== 'undefined') {
        window.setTimeout(() => refreshThreadTokenUsageInBackground(threadId), 0)
      }
      const normalizedPendingRequests = snapshot.pendingServerRequests
        .map((row) => normalizeServerRequest(row))
        .filter((request): request is UiServerRequest => request !== null)
      setPendingServerRequestsForThread(threadId, normalizedPendingRequests)
      const shouldPreserveSettledRpcMessages = shouldPreserveMessagesAfterSettledRpcRefresh(
        threadId,
        snapshot,
        previousPersisted,
        nextMessages,
      )
      const shouldPreserveMissingMessages =
        shouldPreserveSettledRpcMessages ||
        (options.silent === true && inProgress) ||
        snapshot.messageState !== 'fresh'
      const mergedMessages = mergeMessages(previousPersisted, nextMessages, {
        // Preserve previous content when the server only returns partial or stale message state.
        preserveMissing: shouldPreserveMissingMessages,
      })
      setPersistedMessagesForThread(threadId, mergedMessages)
      if (inProgress && !snapshot.stale && hasPersistedRunningCommand(threadId)) {
        markThreadLiveExecutionSignal(threadId)
      }

      const previousLiveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
      const nextLiveAgent = inProgress
        ? removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages)
        : []
      setLiveAgentMessagesForThread(threadId, nextLiveAgent)
      removeLiveCommandsPersistedIn(threadId, nextMessages)

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }
      noteSuccessfulSync()
      lastThreadDetailSyncAtById.value = {
        ...lastThreadDetailSyncAtById.value,
        [threadId]: Date.now(),
      }

      const version = snapshot.updatedAtIso || currentThreadVersion(threadId)
      if (version && snapshot.messageState === 'fresh') {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      const resolvedExecutionState = resolveThreadReadExecutionState(threadId, inProgress, activeTurnId)
      setThreadInProgress(threadId, resolvedExecutionState.inProgress)
      reconcileLiveThreadState(threadId, resolvedExecutionState.inProgress)
      if (
        !resolvedExecutionState.inProgress &&
        !hasPersistedRunningCommand(threadId) &&
        !hasRunningLiveCommand(threadId)
      ) {
        clearPendingTurnRequest(threadId)
      }
      if (resolvedExecutionState.activeTurnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: resolvedExecutionState.activeTurnId,
        }
      } else if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      applyThreadFlags()
      markThreadAsRead(threadId)
      if (!resolvedExecutionState.inProgress && normalizedPendingRequests.length === 0) {
        void processQueuedMessages(threadId)
      }
    })()

    messageLoadInFlightByThreadId.set(threadId, runLoad)

    try {
      await runLoad
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error
      }
      if (isTerminalExecutionError(error)) {
        settleTerminalExecutionError(threadId, error)
        lastThreadDetailSyncAtById.value = {
          ...lastThreadDetailSyncAtById.value,
          [threadId]: Date.now(),
        }
        return
      }
      if (isThreadMaterializingError(error)) {
        lastThreadDetailSyncAtById.value = {
          ...lastThreadDetailSyncAtById.value,
          [threadId]: Date.now(),
        }
        if (pendingTurnRequestByThreadId.value[threadId]) {
          markThreadLiveExecutionSignal(threadId)
          pendingThreadMessageRefresh.add(threadId)
          scheduleEventSync(900)
        }
        return
      }
      setSyncErrorFromUnknown(error)
      throw error
    } finally {
      if (messageLoadInFlightByThreadId.get(threadId) === runLoad) {
        messageLoadInFlightByThreadId.delete(threadId)
      }
      if (shouldShowLoading && foregroundMessageLoadId === loadId) {
        isLoadingMessages.value = false
      }
    }
  }

  async function refreshSkills(): Promise<void> {
    try {
      const selectedCwd = selectedThread.value?.cwd?.trim() ?? ''
      installedSkills.value = await getSkillsList(selectedCwd ? [selectedCwd] : undefined)
    } catch {
      // keep previous skills on failure
    }
  }

  function scheduleSkillsRefreshFromNotification(): void {
    if (typeof window === 'undefined') {
      void refreshSkills()
      return
    }
    if (skillsChangedRefreshTimer !== null) {
      window.clearTimeout(skillsChangedRefreshTimer)
    }
    skillsChangedRefreshTimer = window.setTimeout(() => {
      skillsChangedRefreshTimer = null
      void refreshSkills()
    }, SKILLS_CHANGED_REFRESH_DEBOUNCE_MS)
  }

  async function refreshComposerPlugins(): Promise<void> {
    isLoadingComposerPlugins.value = true
    try {
      availableComposerPlugins.value = await getComposerPluginsList()
    } catch {
      // Keep previous plugins on failure; plugin state must not block chat.
    } finally {
      isLoadingComposerPlugins.value = false
    }
  }

  function scheduleComposerPluginsRefreshFromNotification(): void {
    if (typeof window === 'undefined') {
      void refreshComposerPlugins()
      return
    }
    if (composerPluginsRefreshTimer !== null) {
      window.clearTimeout(composerPluginsRefreshTimer)
    }
    composerPluginsRefreshTimer = window.setTimeout(() => {
      composerPluginsRefreshTimer = null
      void refreshComposerPlugins()
    }, COMPOSER_PLUGINS_REFRESH_DEBOUNCE_MS)
  }

  async function loginComposerPlugin(pluginId: string): Promise<string> {
    try {
      const authorizationUrl = await startComposerPluginOauthLogin(pluginId)
      if (authorizationUrl && typeof window !== 'undefined') {
        window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
      }
      return authorizationUrl
    } catch {
      return ''
    }
  }

  async function reloadAndRefreshComposerPlugins(): Promise<void> {
    try {
      await reloadComposerPlugins()
    } catch {
      // Reload failure should not break the composer; refresh keeps the latest known plugin list.
    } finally {
      await refreshComposerPlugins()
    }
  }

  async function refreshAll(
    options: { loadMessages?: boolean; loadSkills?: boolean; refreshModelPreferences?: boolean } = {},
  ) {
    error.value = ''

    try {
      await loadThreads()
      if (options.refreshModelPreferences !== false) {
        void refreshModelPreferences()
      }
      if (options.loadSkills !== false) {
        await refreshSkills()
        void refreshComposerPlugins()
      }
      if (options.loadMessages !== false) {
        await loadMessages(selectedThreadId.value)
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function refreshSelectedThreadContent(): Promise<void> {
    error.value = ''

    const threadId = selectedThreadId.value.trim()
    if (!threadId) {
      await refreshAll({ loadMessages: true, loadSkills: false })
      return
    }

    try {
      abortCurrentSync()
      clearBufferedLiveDeltas()
      pendingThreadMessageRefresh.delete(threadId)

      try {
        const reconciledSnapshot = await reconcileThreadRuntime(threadId)
        applyRuntimeSnapshotState(threadId, reconciledSnapshot)
        await loadMessages(threadId, { silent: true })
      } catch (unknownError) {
        if (!isAbortLikeError(unknownError)) throw unknownError
        await new Promise((resolve) => window.setTimeout(resolve, 50))
        const reconciledSnapshot = await reconcileThreadRuntime(threadId)
        applyRuntimeSnapshotState(threadId, reconciledSnapshot)
        await loadMessages(threadId, { silent: true })
      }

      await loadPendingServerRequestsFromBridge()
      await loadThreads({ preserveMissingSelected: true })

      if (selectedThreadId.value === threadId) {
        const resolvedExecutionState = resolveThreadReadExecutionState(
          threadId,
          inProgressById.value[threadId] === true,
          activeTurnIdByThreadId.value[threadId] ?? '',
        )
        setThreadInProgress(threadId, resolvedExecutionState.inProgress)
        reconcileLiveThreadState(threadId, resolvedExecutionState.inProgress)
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : '手动刷新当前会话失败'
      throw unknownError
    }
  }

  async function selectThread(threadId: string) {
    const normalizedThreadId = threadId.trim()
    setSelectedThreadId(normalizedThreadId)

    threadSelectionAbortController?.abort()
    threadSelectionAbortController = null
    if (isPolling.value) {
      abortCurrentSync()
    }

    if (!normalizedThreadId) {
      isLoadingMessages.value = false
      return
    }

    const abortController = new AbortController()
    threadSelectionAbortController = abortController

    const completeThreadSelection = (): void => {
      if (threadSelectionAbortController !== abortController) return
      void refreshSkills()
      if (normalizedThreadId && isThreadExecutionActive(normalizedThreadId)) {
        markActiveSyncBoost()
      }
    }

    const runThreadLoad = async (silent: boolean): Promise<void> => {
      try {
        await loadMessages(normalizedThreadId, {
          silent,
          signal: abortController.signal,
        })
        completeThreadSelection()
      } catch (unknownError) {
        if (isAbortLikeError(unknownError)) return
        error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      } finally {
        if (threadSelectionAbortController === abortController) {
          threadSelectionAbortController = null
        }
      }
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[normalizedThreadId] === true
    if (alreadyLoaded) {
      const currentVersion = currentThreadVersion(normalizedThreadId)
      const loadedVersion = loadedVersionByThreadId.value[normalizedThreadId] ?? ''
      const lastDetailSyncAt = lastThreadDetailSyncAtById.value[normalizedThreadId] ?? 0
      const shouldRefreshInBackground =
        pendingThreadMessageRefresh.has(normalizedThreadId) ||
        notificationStale.value ||
        syncLagging.value ||
        isThreadExecutionActive(normalizedThreadId) ||
        (currentVersion.length > 0 && currentVersion !== loadedVersion) ||
        lastDetailSyncAt <= 0 ||
        Date.now() - lastDetailSyncAt >= ACTIVE_THREAD_DETAIL_SYNC_IDLE_MS

      completeThreadSelection()
      if (shouldRefreshInBackground) {
        void runThreadLoad(true)
      } else if (threadSelectionAbortController === abortController) {
        threadSelectionAbortController = null
      }
      return
    }

    try {
      await runThreadLoad(false)
    } finally {
      if (threadSelectionAbortController === abortController) {
        threadSelectionAbortController = null
      }
    }
  }

  async function archiveThreadById(threadId: string) {
    try {
      await archiveThread(threadId)
      const normalizedThreadId = threadId.trim()
      if (normalizedThreadId && !hiddenThreadIds.value.includes(normalizedThreadId)) {
        hiddenThreadIds.value = [...hiddenThreadIds.value, normalizedThreadId]
        saveHiddenThreadIds(hiddenThreadIds.value)
      }
      const flatThreads = removeThreadFromSourceGroups(threadId)
      if (selectedThreadId.value === threadId) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
      await loadThreads()
    } catch (unknownError) {
      if (isThreadMaterializingError(unknownError)) {
        hideThreadLocally(threadId)
        return
      }
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  function dismissThreadLocally(threadId: string): void {
    hideThreadLocally(threadId)
  }

  async function renameThreadById(threadId: string, threadName: string) {
    const normalizedName = threadName.trim()
    if (!threadId || !normalizedName) return

    try {
      await renameThread(threadId, normalizedName)
      threadTitleById.value = { ...threadTitleById.value, [threadId]: normalizedName }
      applyThreadFlags()
      void persistThreadTitle(threadId, normalizedName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function forkThreadById(threadId: string): Promise<string> {
    const sourceThreadId = threadId.trim()
    if (!sourceThreadId) return ''

    const sourceThread = sourceThreadById.value[sourceThreadId]
    const sourceCwd = sourceThread?.cwd?.trim() ?? ''
    const sourceTitle = sourceThread?.title?.trim() ?? 'Forked chat'
    const selectedModel = selectedModelId.value.trim()
    error.value = ''

    try {
      const nextThreadId = await forkThread(sourceThreadId, sourceCwd || undefined, selectedModel || undefined)
      if (!nextThreadId) return ''

      insertOptimisticThread(nextThreadId, sourceCwd, sourceTitle)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [nextThreadId]: true,
      }
      setSelectedThreadId(nextThreadId)
      await loadThreads()
      await loadMessages(nextThreadId)
      return nextThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function sendMessageToSelectedThread(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
    queueInsertIndex?: number,
    collaborationMode: CollaborationMode = selectedCollaborationMode.value,
    turnOptions?: ComposerTurnOptions,
  ): Promise<void> {
    if (isUpdatingSpeedMode.value) return

    const threadId = selectedThreadId.value
    const nextText = text.trim()
    if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) return
    triggerAndroidHaptic(mode === 'queue' ? 'light' : 'medium')

    const optimisticMessageId = mode === 'queue'
      ? ''
      : addOptimisticUserMessage(threadId, nextText, imageUrls, fileAttachments)

    try {
      await recoverThreadExecutionState(threadId)
    } catch (unknownError) {
      removeOptimisticUserMessage(threadId, optimisticMessageId)
      throw unknownError
    }

    const isInProgress = inProgressById.value[threadId] === true

    if (isInProgress && mode === 'queue') {
      const queue = queuedMessagesByThreadId.value[threadId] ?? []
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const nextQueue = [...queue]
      const insertIndex = typeof queueInsertIndex === 'number'
        ? Math.max(0, Math.min(queueInsertIndex, nextQueue.length))
        : nextQueue.length
      nextQueue.splice(insertIndex, 0, {
        id,
        text: nextText,
        imageUrls,
        skills,
        fileAttachments,
        modelId: selectedModelId.value.trim(),
        reasoningEffort: selectedReasoningEffort.value,
        speedMode: selectedSpeedMode.value,
        collaborationMode,
        turnOptions: cloneTurnOptions(turnOptions),
      })
      setQueuedMessagesForThread(threadId, nextQueue)
      consumePlanModeAfterSubmit(collaborationMode)
      return
    }

    if (isInProgress) {
      shouldAutoScrollOnNextAgentEvent = true
      markActiveSyncBoost()
      try {
        await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, collaborationMode, turnOptions)
        consumePlanModeAfterSubmit(collaborationMode)
      } catch (unknownError) {
        removeOptimisticUserMessage(threadId, optimisticMessageId)
        const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        setTurnErrorForThread(threadId, errorMessage)
        error.value = errorMessage
        throw unknownError
      }
      return
    }

    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    markActiveSyncBoost()
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(
      threadId,
      {
        label: collaborationMode === 'plan' ? 'Planning' : 'Thinking',
        details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value, collaborationMode),
      },
    )
    setTurnErrorForThread(threadId, null)
    setThreadInProgress(threadId, true)

    try {
      await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, collaborationMode, turnOptions)
      consumePlanModeAfterSubmit(collaborationMode)
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      removeOptimisticUserMessage(threadId, optimisticMessageId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      throw unknownError
    }
  }

  async function sendMessageToNewThread(
    text: string,
    cwd: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationMode: CollaborationMode = selectedCollaborationMode.value,
    turnOptions?: ComposerTurnOptions,
  ): Promise<string> {
    if (isUpdatingSpeedMode.value) return ''

    const nextText = text.trim()
    const targetCwd = cwd.trim()
    const selectedModel = selectedModelId.value.trim()
    if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0) return ''
    const clientMessageId = createClientMessageId()
    triggerAndroidHaptic('medium')

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''
    let optimisticMessageId = ''

    const activateNewThreadUi = (nextThreadId: string, turnId = ''): void => {
      if (threadId === nextThreadId) return
      threadId = nextThreadId
      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      optimisticMessageId = addOptimisticUserMessage(threadId, nextText, imageUrls, fileAttachments)
      setPendingTurnRequest(threadId, {
        text: nextText,
        imageUrls: [...imageUrls],
        skills: skills.map((skill) => ({ name: skill.name, path: skill.path })),
        fileAttachments: fileAttachments.map((file) => ({ ...file })),
        effort: selectedReasoningEffort.value,
        collaborationMode,
        turnOptions: cloneTurnOptions(turnOptions),
        fallbackRetried: false,
        createdAtMs: Date.now(),
      })
      if (turnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    }

    const recoverRuntimeRequestByClientMessage = async (): Promise<boolean> => {
      try {
        const recovered = await getRuntimeRequestByClientMessageId(clientMessageId)
        if (!recovered?.threadId) return false
        activateNewThreadUi(recovered.threadId, recovered.turnId)
        shouldAutoScrollOnNextAgentEvent = true
        markActiveSyncBoost()
        setTurnSummaryForThread(recovered.threadId, null)
        setTurnErrorForThread(recovered.threadId, recovered.lastError)
        if (recovered.status === 'failed') {
          setThreadInProgress(recovered.threadId, false)
          setTurnActivityForThread(recovered.threadId, null)
          clearPendingTurnRequest(recovered.threadId)
          if (recovered.lastError) error.value = recovered.lastError
        } else if (recovered.status === 'start_uncertain') {
          setThreadInProgress(recovered.threadId, true)
          setRuntimeExecutionState(recovered.threadId, 'start_uncertain', { canStop: false, activeTurnId: recovered.turnId })
          setTurnActivityForThread(recovered.threadId, {
            label: 'Confirming status',
            details: ['发送结果未确认，正在由 7420 后台核验'],
          })
        } else {
          setThreadInProgress(recovered.threadId, true)
          setRuntimeExecutionState(recovered.threadId, 'running', { canStop: true, activeTurnId: recovered.turnId })
          setTurnActivityForThread(recovered.threadId, {
            label: collaborationMode === 'plan' ? 'Planning' : 'Thinking',
            details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value, collaborationMode),
          })
        }
        markThreadLiveExecutionSignal(recovered.threadId)
        markThreadResumed(recovered.threadId)
        pendingThreadMessageRefresh.add(recovered.threadId)
        pendingThreadsRefresh = true
        scheduleEventSync(700)
        return true
      } catch {
        return false
      }
    }

    try {
      if (!threadId) {
        const prestartedThreadId = await startThread(targetCwd || undefined, selectedModel || undefined)
        if (prestartedThreadId) {
          activateNewThreadUi(prestartedThreadId)
          shouldAutoScrollOnNextAgentEvent = true
          markActiveSyncBoost()
          setTurnSummaryForThread(prestartedThreadId, null)
          setTurnErrorForThread(prestartedThreadId, null)
          setThreadInProgress(prestartedThreadId, true)
          setRuntimeExecutionState(prestartedThreadId, 'starting', { canStop: false })
          setTurnActivityForThread(prestartedThreadId, {
            label: 'Sending',
            details: ['会话已创建，正在提交首条任务'],
          })
          markThreadLiveExecutionSignal(prestartedThreadId)
          markThreadResumed(prestartedThreadId)
        }
      }

      let runtimeResult = null as Awaited<ReturnType<typeof startRuntimeThreadTurn>> | null
      try {
        runtimeResult = await startRuntimeThreadTurn({
          threadId: threadId || undefined,
          cwd: targetCwd || undefined,
          text: nextText,
          imageUrls,
          model: selectedModel || undefined,
          effort: selectedReasoningEffort.value || undefined,
          skills: skills.length > 0 ? skills : undefined,
          fileAttachments,
          collaborationMode,
          turnOptions,
          clientMessageId,
        })
      } catch (unknownError) {
        if (selectedModel && selectedModel !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          runtimeResult = await startRuntimeThreadTurn({
            threadId: threadId || undefined,
            cwd: targetCwd || undefined,
            text: nextText,
            imageUrls,
            model: MODEL_FALLBACK_ID,
            effort: selectedReasoningEffort.value || undefined,
            skills: skills.length > 0 ? skills : undefined,
            fileAttachments,
            collaborationMode,
            turnOptions,
            clientMessageId,
          })
        } else {
          if (await recoverRuntimeRequestByClientMessage()) {
            isSendingMessage.value = false
            return threadId
          }
          throw unknownError
        }
      }
      const resultThreadId = runtimeResult?.threadId ?? ''
      if (!resultThreadId) {
        if (await recoverRuntimeRequestByClientMessage()) {
          isSendingMessage.value = false
          return threadId
        }
        throw new Error('runtime/send did not return a thread id')
      }

      activateNewThreadUi(resultThreadId, runtimeResult?.turnId ?? '')
      shouldAutoScrollOnNextAgentEvent = true
      markActiveSyncBoost()
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        {
          label: collaborationMode === 'plan' ? 'Planning' : 'Thinking',
          details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value, collaborationMode),
        },
      )
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)
      if (runtimeResult?.status === 'start_uncertain') {
        setRuntimeExecutionState(threadId, 'start_uncertain', { canStop: false, activeTurnId: runtimeResult.turnId })
        setTurnActivityForThread(threadId, {
          label: 'Confirming status',
          details: ['等待 7420 后台核验任务是否已开始'],
        })
      } else {
        setRuntimeExecutionState(threadId, 'running', { canStop: true, activeTurnId: runtimeResult?.turnId ?? '' })
      }
      markThreadLiveExecutionSignal(threadId)
      markThreadResumed(threadId)
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      scheduleEventSync(700)
      const capturedThreadId = threadId
      const capturedCwd = targetCwd || null
      const capturedPrompt = nextText
      isSendingMessage.value = false
      consumePlanModeAfterSubmit(collaborationMode)
      void requestThreadTitleGeneration(capturedThreadId, capturedPrompt, capturedCwd)
      return threadId
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      if (threadId) {
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
        clearPendingTurnRequest(threadId)
      }
      if (threadId && optimisticMessageId) {
        const threadExists = Boolean(sourceThreadById.value[threadId])
        if (!threadExists) {
          removeOptimisticUserMessage(threadId, optimisticMessageId)
        }
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      isSendingMessage.value = false
      throw unknownError
    }
  }

  async function startTurnForThread(
    threadId: string,
    nextText: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationMode: CollaborationMode = selectedCollaborationMode.value,
    turnOptions?: ComposerTurnOptions,
    runtimeOverrides: { modelId?: string; reasoningEffort?: ReasoningEffort | '' } = {},
  ): Promise<void> {
    const modelId = (runtimeOverrides.modelId ?? selectedModelId.value).trim()
    const reasoningEffort = runtimeOverrides.reasoningEffort ?? selectedReasoningEffort.value
    const normalizedText = nextText.trim()
    const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }))
    const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }))
    markActiveSyncBoost()

    setPendingTurnRequest(threadId, {
      text: normalizedText,
      imageUrls: [...imageUrls],
      skills: normalizedSkills,
      fileAttachments: normalizedFileAttachments,
      effort: reasoningEffort,
      collaborationMode,
      turnOptions: cloneTurnOptions(turnOptions),
      fallbackRetried: false,
      createdAtMs: Date.now(),
    })

    try {
      await ensureThreadResumed(threadId)

      let startedTurnId = ''
      let runtimeStartStatus: 'running' | 'start_uncertain' | '' = ''
      try {
        const runtimeResult = await startRuntimeThreadTurn({
          threadId,
          text: nextText,
          imageUrls,
          model: modelId || undefined,
          effort: reasoningEffort || undefined,
          skills: skills.length > 0 ? skills : undefined,
          fileAttachments,
          collaborationMode,
          turnOptions,
        })
        startedTurnId = runtimeResult.turnId
        runtimeStartStatus = runtimeResult.status === 'start_uncertain' ? 'start_uncertain' : 'running'
      } catch (unknownError) {
        if (modelId && modelId !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          setPendingTurnRequest(threadId, {
            text: normalizedText,
            imageUrls: [...imageUrls],
            skills: normalizedSkills,
            fileAttachments: normalizedFileAttachments,
            effort: reasoningEffort,
            collaborationMode,
            turnOptions: cloneTurnOptions(turnOptions),
            fallbackRetried: true,
            createdAtMs: Date.now(),
          })
          const runtimeFallbackResult = await startRuntimeThreadTurn({
            threadId,
            text: nextText,
            imageUrls,
            model: MODEL_FALLBACK_ID,
            effort: reasoningEffort || undefined,
            skills: skills.length > 0 ? skills : undefined,
            fileAttachments,
            collaborationMode,
            turnOptions,
          })
          startedTurnId = runtimeFallbackResult.turnId
          runtimeStartStatus = runtimeFallbackResult.status === 'start_uncertain' ? 'start_uncertain' : 'running'
        } else {
          throw unknownError
        }
      }

      if (runtimeStartStatus === 'start_uncertain') {
        setRuntimeExecutionState(threadId, 'start_uncertain', { canStop: false })
        setTurnActivityForThread(threadId, {
          label: 'Confirming status',
          details: ['等待 7420 后台核验任务是否已开始'],
        })
      }
      if (startedTurnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: startedTurnId,
        }
      }
      markThreadLiveExecutionSignal(threadId)

      markThreadResumed(threadId)

      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      scheduleEventSync(700)
    } catch (unknownError) {
      clearPendingTurnRequest(threadId)
      throw unknownError
    }
  }

  async function processQueuedMessages(threadId: string): Promise<void> {
    if (queueProcessingByThreadId.value[threadId] === true) return
    if (inProgressById.value[threadId] === true) return
    if (pendingTurnRequestByThreadId.value[threadId]) return
    if (hasPendingServerRequestSignal(threadId)) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue || queue.length === 0) return
    queueProcessingByThreadId.value = {
      ...queueProcessingByThreadId.value,
      [threadId]: true,
    }
    const [next] = queue
    isSendingMessage.value = true
    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    const queuedModelId = next.modelId.trim() || selectedModelId.value.trim()
    const queuedReasoningEffort = next.reasoningEffort || selectedReasoningEffort.value
    const queuedSpeedMode: SpeedMode = next.speedMode === 'fast' ? 'fast' : 'standard'
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(threadId, {
      label: next.collaborationMode === 'plan' ? 'Planning' : 'Thinking',
      details: buildPendingTurnDetails(queuedModelId, queuedReasoningEffort, next.collaborationMode),
    })
    setTurnErrorForThread(threadId, null)
    setThreadInProgress(threadId, true)
    markThreadLiveExecutionSignal(threadId)
    markActiveSyncBoost()
    const optimisticMessageId = addOptimisticUserMessage(threadId, next.text, next.imageUrls, next.fileAttachments)
    try {
      if (selectedSpeedMode.value !== queuedSpeedMode) {
        await updateSelectedSpeedMode(queuedSpeedMode)
        if (selectedSpeedMode.value !== queuedSpeedMode) {
          throw new Error('Failed to apply queued speed mode before sending')
        }
      }
      await startTurnForThread(
        threadId,
        next.text,
        next.imageUrls,
        next.skills,
        next.fileAttachments,
        next.collaborationMode,
        next.turnOptions,
        {
          modelId: queuedModelId,
          reasoningEffort: queuedReasoningEffort,
        },
      )
      removeQueuedMessageByThreadId(threadId, next.id)
    } catch {
      removeOptimisticUserMessage(threadId, optimisticMessageId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
    } finally {
      queueProcessingByThreadId.value = omitKey(queueProcessingByThreadId.value, threadId)
      isSendingMessage.value = false
    }
  }

  async function interruptSelectedThreadTurn(source: RuntimeInterruptSource = 'unknown'): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (inProgressById.value[threadId] !== true) return
    let turnId = activeTurnIdByThreadId.value[threadId]
    if (!turnId) {
      const { activeTurnId } = await getThreadDetail(threadId)
      turnId = activeTurnId
      if (turnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    }
    if (!turnId) {
      throw new Error('Could not determine active turn id for interrupt')
    }

    triggerAndroidHaptic('warning')
    isInterruptingTurn.value = true
    error.value = ''
    setRuntimeExecutionState(threadId, 'stopping', { canStop: false, activeTurnId: turnId })
    setTurnActivityForThread(threadId, { label: 'Stopping', details: [] })
    pendingThreadMessageRefresh.add(threadId)
    pendingThreadsRefresh = true
    try {
      const startedAtMs = parseIsoTimestamp(runtimeStatusSummaryByThreadId.value[threadId]?.lastStartedAtIso ?? '')
      const result = await interruptRuntimeThreadTurn(threadId, turnId, {
        source,
        requestedAtIso: new Date().toISOString(),
        clientElapsedMs: startedAtMs ? Math.max(0, Date.now() - startedAtMs) : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      })
      if (result.status === 'stop_uncertain') {
        setRuntimeExecutionState(threadId, 'stop_uncertain', { canStop: false, activeTurnId: turnId })
        setTurnActivityForThread(threadId, {
          label: 'Confirming stop',
          details: ['停止请求超时，正在核验任务是否已结束'],
        })
      } else if (result.status === 'still_running') {
        setRuntimeExecutionState(threadId, 'running', { canStop: true, activeTurnId: turnId })
      } else {
        settleInterruptedThreadState(threadId)
      }
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const staleInterrupt =
        isStaleInterruptError(unknownError) ||
        isTerminalExecutionError(unknownError) ||
        isRuntimeExecutionStale(threadId)
      if (staleInterrupt) {
        if (isTerminalExecutionError(unknownError)) {
          settleTerminalExecutionError(threadId, unknownError)
        } else {
          settleInterruptedThreadState(threadId)
        }
        try {
          await loadMessages(threadId, { silent: true })
        } catch {
          // The interrupt failure already indicates this may be stale local state.
        }
        if (!hasAuthoritativeExecutionSignal(threadId)) {
          clearRecoveredIdleThreadState(threadId)
          setTurnErrorForThread(threadId, null)
          error.value = ''
          pendingThreadMessageRefresh.add(threadId)
          pendingThreadsRefresh = true
          void syncFromNotifications()
          return
        }
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      error.value = errorMessage
      void refreshRuntimeStatusSnapshot(threadId)
    } finally {
      isInterruptingTurn.value = false
    }
  }

  async function rollbackSelectedThread(turnIndex: number): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (isRollingBack.value) return

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const maxTurnIndex = persisted.reduce((max, m) => (typeof m.turnIndex === 'number' && m.turnIndex > max ? m.turnIndex : max), -1)
    if (maxTurnIndex < 0 || turnIndex > maxTurnIndex) return
    const numTurns = maxTurnIndex - turnIndex + 1
    if (numTurns < 1) return

    isRollingBack.value = true
    error.value = ''
    try {
      await rollbackWorktreeGitToTurnMessage(threadId, turnIndex)
      const nextMessages = await rollbackThread(threadId, numTurns)
      setPersistedMessagesForThread(threadId, nextMessages)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      if (liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      }
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to rollback thread'
    } finally {
      isRollingBack.value = false
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (projectName.length === 0) return

    const currentValue = projectDisplayNameById.value[projectName] ?? ''
    if (currentValue === displayName) return

    projectDisplayNameById.value = {
      ...projectDisplayNameById.value,
      [projectName]: displayName,
    }
    saveProjectDisplayNames(projectDisplayNameById.value)
  }

  function removeProjectLocally(projectName: string): void {
    if (projectName.length === 0) return

    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }

    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)

    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }

    applyThreadFlags()

    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)

    const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)
    if (!currentExists) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }

  }

  async function removeProject(projectName: string): Promise<void> {
    const normalizedProjectName = projectName.trim()
    if (normalizedProjectName.length === 0) return

    const targetGroup = sourceGroups.value.find((group) => group.projectName === normalizedProjectName)
    const projectCwds = targetGroup?.threads
      .map((thread) => thread.cwd.trim())
      .filter((cwd) => cwd.length > 0) ?? []
    const threadIds = targetGroup?.threads
      .map((thread) => thread.id.trim())
      .filter((threadId) => threadId.length > 0) ?? []

    try {
      for (const threadId of threadIds) {
        await archiveThread(threadId)
      }
      await removeProjectFromWorkspaceRoots(normalizedProjectName, projectCwds)
      if (threadIds.length > 0) {
        const hiddenSet = new Set(hiddenThreadIds.value)
        for (const threadId of threadIds) hiddenSet.add(threadId)
        hiddenThreadIds.value = [...hiddenSet]
        saveHiddenThreadIds(hiddenThreadIds.value)
      }
      removeProjectLocally(normalizedProjectName)
      await loadThreads()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to remove project'
    }
  }

  async function removeProjectFromWorkspaceRoots(projectName: string, projectCwds: string[]): Promise<void> {
    const rootsState = await getWorkspaceRootsState()
    const shouldRemoveRoot = (rootPath: string): boolean => isWorkspaceRootForProject(rootPath, projectName, projectCwds)
    const nextOrder = rootsState.order.filter((rootPath) => !shouldRemoveRoot(rootPath))
    const nextActive = rootsState.active.filter((rootPath) => !shouldRemoveRoot(rootPath))
    const nextLabels: Record<string, string> = {}
    for (const [rootPath, label] of Object.entries(rootsState.labels)) {
      if (!shouldRemoveRoot(rootPath)) {
        nextLabels[rootPath] = label
      }
    }
    if (nextActive.length === 0 && nextOrder.length > 0) {
      nextActive.push(nextOrder[0])
    }

    await setWorkspaceRootsState({
      order: nextOrder,
      labels: nextLabels,
      active: nextActive,
    })
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (projectName.length === 0) return
    if (sourceGroups.value.length === 0) return

    const visibleOrder = sourceGroups.value.map((group) => group.projectName)
    const fromIndex = visibleOrder.indexOf(projectName)
    if (fromIndex === -1) return

    const clampedToIndex = Math.max(0, Math.min(toIndex, visibleOrder.length - 1))
    const reorderedVisibleOrder = reorderStringArray(visibleOrder, fromIndex, clampedToIndex)
    if (reorderedVisibleOrder === visibleOrder) return

    const normalizedProjectOrder = mergeProjectOrder(reorderedVisibleOrder, sourceGroups.value)
    projectOrder.value = normalizedProjectOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  function pinProjectToTop(projectName: string): void {
    const normalizedName = projectName.trim()
    if (!normalizedName) return
    const nextOrder = [normalizedName, ...projectOrder.value.filter((name) => name !== normalizedName)]
    if (areStringArraysEqual(projectOrder.value, nextOrder)) return
    projectOrder.value = nextOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  async function persistProjectOrderToWorkspaceRoots(): Promise<void> {
    try {
      const rootsState = await getWorkspaceRootsState()
      const rootByProjectName = new Map<string, string>()
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (!rootByProjectName.has(projectName)) {
          rootByProjectName.set(projectName, rootPath)
        }
      }
      for (const group of sourceGroups.value) {
        const cwd = group.threads[0]?.cwd?.trim() ?? ''
        if (!cwd) continue
        rootByProjectName.set(group.projectName, cwd)
      }

      const nextOrder: string[] = []
      for (const projectName of projectOrder.value) {
        const rootPath = rootByProjectName.get(projectName)
        if (rootPath && !nextOrder.includes(rootPath)) {
          nextOrder.push(rootPath)
        }
      }
      for (const rootPath of rootsState.order) {
        if (!nextOrder.includes(rootPath)) {
          nextOrder.push(rootPath)
        }
      }

      const nextActive = rootsState.active.filter((rootPath) => nextOrder.includes(rootPath))
      if (nextActive.length === 0 && nextOrder.length > 0) {
        nextActive.push(nextOrder[0])
      }

      await setWorkspaceRootsState({
        order: nextOrder,
        labels: rootsState.labels,
        active: nextActive,
      })
    } catch {
      // Keep local project order when global state persistence is unavailable.
    }
  }

  async function syncThreadStatus(
    options: { includeThreadList?: boolean; forceMessageRefresh?: boolean; urgent?: boolean } = {},
  ): Promise<void> {
    let forceMessageRefresh = options.forceMessageRefresh === true
    const includeThreadList = options.includeThreadList !== false
    const urgent = options.urgent === true

    if (isPolling.value) {
      queueSelectedThreadSync({
        includeThreadList,
        forceMessageRefresh,
      })
      if (urgent) {
        abortCurrentSync()
      }
      scheduleEventSync(urgent ? 0 : EVENT_SYNC_DEBOUNCE_MS)
      return
    }

    isPolling.value = true
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    syncAbortController = controller
    let wasAborted = false
    let refreshedMessageThreadId = ''

    const refreshSelectedMessagesNow = async (threadId: string): Promise<void> => {
      if (!threadId) return
      await loadMessages(threadId, { silent: true, signal: controller?.signal })
      pendingThreadMessageRefresh.delete(threadId)
      refreshedMessageThreadId = threadId
    }

    try {
      const initialThreadId = selectedThreadId.value
      let initialRuntimeSnapshot: ThreadRuntimeSnapshot | null = null
      if (initialThreadId) {
        const wasExecutionActive =
          isThreadExecutionActive(initialThreadId) ||
          Boolean(pendingTurnRequestByThreadId.value[initialThreadId]) ||
          Boolean(activeTurnIdByThreadId.value[initialThreadId])
        const snapshot = await refreshRuntimeStatusSnapshot(initialThreadId, controller?.signal)
        initialRuntimeSnapshot = snapshot
        if (
          snapshot &&
          wasExecutionActive &&
          isRuntimeExecutionSettledState(snapshot.executionState) &&
          (snapshot.pendingServerRequests ?? []).length === 0
        ) {
          forceMessageRefresh = true
        }
        if (shouldRefreshMessagesForSettledRuntime(initialThreadId, snapshot)) {
          forceMessageRefresh = true
        }
      }
      if (forceMessageRefresh && initialThreadId) {
        await refreshSelectedMessagesNow(initialThreadId)
        markSettledRuntimeMessagesRefreshed(initialThreadId, initialRuntimeSnapshot)
      }

      if (includeThreadList) {
        await loadThreads({
          signal: controller?.signal,
          preserveMissingSelected: Boolean(initialThreadId),
        })
      }

      if (
        includeThreadList ||
        (forceMessageRefresh && !refreshedMessageThreadId) ||
        Object.keys(pendingServerRequestsByThreadId.value).length > 0
      ) {
        await loadPendingServerRequestsFromBridge()
      }

      if (!selectedThreadId.value) return

      const threadId = selectedThreadId.value
      const currentVersion = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      if ((forceMessageRefresh || hasVersionChange) && refreshedMessageThreadId !== threadId) {
        await refreshSelectedMessagesNow(threadId)
      }
    } catch (error) {
      wasAborted = isAbortLikeError(error)
      if (!wasAborted) {
        setSyncErrorFromUnknown(error)
      }
    } finally {
      clearSyncAbortController(controller)
      isPolling.value = false
      if (wasAborted) {
        scheduleEventSync(0)
        return
      }
      if (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) {
        scheduleEventSync(0)
      }
    }
  }

  function scheduleBackgroundSync(): void {
    if (typeof window === 'undefined' || backgroundSyncTimer !== null) return
    backgroundSyncTimer = window.setInterval(() => {
      const now = Date.now()
      notificationHealthTick.value = now
      const activeThreadId = selectedThreadId.value
      const isInProgress = activeThreadId ? isThreadExecutionActive(activeThreadId) : false
      const lastDetailSyncAt = activeThreadId ? (lastThreadDetailSyncAtById.value[activeThreadId] ?? 0) : 0
      const notificationStale = now - lastNotificationAtMs >= NOTIFICATION_STALE_MS
      const shouldRefreshMessages =
        Boolean(activeThreadId) &&
        (
          isInProgress ||
          hasOptimisticOnlyExecutionState(activeThreadId) ||
          now - lastDetailSyncAt >= ACTIVE_THREAD_DETAIL_SYNC_IDLE_MS
        ) &&
        (
          hasOptimisticOnlyExecutionState(activeThreadId) ||
          notificationStale ||
          now - lastDetailSyncAt >= ACTIVE_THREAD_DETAIL_SYNC_INTERVAL_MS
        )
      const shouldRefreshThreads = shouldRefreshThreadListForBackground(now)

      if (!shouldRefreshThreads && !shouldRefreshMessages) {
        return
      }

      void syncThreadStatus({
        includeThreadList: shouldRefreshThreads,
        forceMessageRefresh: shouldRefreshMessages,
      })
    }, BACKGROUND_SYNC_INTERVAL_MS)
  }

  function runForegroundRecoverySync(
    options: { includeThreadList?: boolean; forceMessageRefresh?: boolean; urgent?: boolean } = {},
  ): void {
    const activeThreadId = selectedThreadId.value
    if (activeThreadId) {
      clearBufferedLiveDeltas()
      pendingThreadMessageRefresh.add(activeThreadId)
    }
    markActiveSyncBoost()
    void replayMissedNotifications()
      .finally(() => syncThreadStatus({
        includeThreadList: options.includeThreadList ?? false,
        forceMessageRefresh: options.forceMessageRefresh === true || Boolean(activeThreadId),
        urgent: options.urgent === true,
      }))
  }

  function scheduleVisibilitySync(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    if (stopVisibilitySync) {
      stopVisibilitySync()
    }

    const clearResumeSyncTimers = (): void => {
      for (const timer of resumeSyncTimers) {
        window.clearTimeout(timer)
      }
      resumeSyncTimers.clear()
    }

    const scheduleResumeSync = (force = false): void => {
      if (!force && document.hidden) return
      const now = Date.now()
      if (androidShellAvailable && now - lastAndroidResumeSyncScheduledAtMs < ANDROID_RESUME_SYNC_DEBOUNCE_MS) {
        return
      }
      if (androidShellAvailable) {
        lastAndroidResumeSyncScheduledAtMs = now
      }
      const shouldRestartNotifications =
        realtimeConnectionState.value !== 'connected' ||
        (notificationStale.value && (hasSyncDemand.value || Boolean(selectedThreadId.value)))
      if (shouldRestartNotifications) {
        restartNotificationStream()
      }
      clearVisibilitySyncTimer()
      clearResumeSyncTimers()
      const retryDelays = androidShellAvailable ? ANDROID_RESUME_SYNC_RETRY_DELAYS_MS : RESUME_SYNC_RETRY_DELAYS_MS
      for (const delayMs of retryDelays) {
        const timer = window.setTimeout(() => {
          resumeSyncTimers.delete(timer)
          if (!force && document.hidden) return
          const isFirstAttempt = delayMs === retryDelays[0]
          const attemptAtMs = Date.now()
          const activeThreadId = selectedThreadId.value
          const activeThreadNeedsMessages =
            Boolean(activeThreadId) &&
            (
              pendingThreadMessageRefresh.has(activeThreadId) ||
              eventUnreadByThreadId.value[activeThreadId] === true ||
              isThreadExecutionActive(activeThreadId) ||
              Boolean(activeThreadId && isRuntimeExecutionStale(activeThreadId)) ||
              !hasLoadedThreadDetail(activeThreadId)
            )
          const shouldForceMessageRefresh = androidShellAvailable
            ? (Boolean(activeThreadId) || activeThreadNeedsMessages || (!isFirstAttempt && hasSyncDemand.value))
            : (isFirstAttempt || hasSyncDemand.value)
          const shouldIncludeThreadList = shouldRefreshThreadListForResume(isFirstAttempt, attemptAtMs)
          runForegroundRecoverySync({
            includeThreadList: shouldIncludeThreadList,
            forceMessageRefresh: shouldForceMessageRefresh,
            urgent: isFirstAttempt,
          })
        }, delayMs)
        resumeSyncTimers.add(timer)
      }
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        clearVisibilitySyncTimer()
        clearResumeSyncTimers()
        stopActiveSyncBoost()
        return
      }
      scheduleResumeSync()
    }

    const onWindowFocus = (): void => {
      scheduleResumeSync()
    }

    const onPageShow = (event: PageTransitionEvent): void => {
      scheduleResumeSync(event.persisted === true)
    }

    const onPageHide = (): void => {
      clearVisibilitySyncTimer()
      clearResumeSyncTimers()
      stopActiveSyncBoost()
    }

    const onPageLifecycleResume = (): void => {
      scheduleResumeSync(true)
    }

    const onOnline = (): void => {
      scheduleResumeSync()
    }

    const onOffline = (): void => {
      clearVisibilitySyncTimer()
      clearResumeSyncTimers()
      stopActiveSyncBoost()
    }

    const onMobileResume = (): void => {
      androidAppPaused = false
      scheduleResumeSync(true)
    }

    const onMobilePause = (): void => {
      androidAppPaused = true
      clearVisibilitySyncTimer()
      clearResumeSyncTimers()
      stopActiveSyncBoost()
    }

    const onMobileOnline = (): void => {
      scheduleResumeSync(true)
    }

    const onMobileOffline = (): void => {
      clearVisibilitySyncTimer()
      clearResumeSyncTimers()
      stopActiveSyncBoost()
    }

    stopVisibilitySync = () => {
      clearResumeSyncTimers()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('freeze', onPageHide)
      document.removeEventListener('resume', onPageLifecycleResume)
      window.removeEventListener(MOBILE_APP_RESUME_EVENT, onMobileResume)
      window.removeEventListener(MOBILE_APP_PAUSE_EVENT, onMobilePause)
      window.removeEventListener(MOBILE_NETWORK_ONLINE_EVENT, onMobileOnline)
      window.removeEventListener(MOBILE_NETWORK_OFFLINE_EVENT, onMobileOffline)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('freeze', onPageHide)
    document.addEventListener('resume', onPageLifecycleResume)
    window.addEventListener(MOBILE_APP_RESUME_EVENT, onMobileResume)
    window.addEventListener(MOBILE_APP_PAUSE_EVENT, onMobilePause)
    window.addEventListener(MOBILE_NETWORK_ONLINE_EVENT, onMobileOnline)
    window.addEventListener(MOBILE_NETWORK_OFFLINE_EVENT, onMobileOffline)
  }

  function clearVisibilitySyncTimer(): void {
    if (visibilitySyncTimer !== null) {
      window.clearTimeout(visibilitySyncTimer)
      visibilitySyncTimer = null
    }
  }

  async function syncFromNotifications(): Promise<void> {
    if (isPolling.value) {
      scheduleEventSync()
      return
    }

    isPolling.value = true
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    syncAbortController = controller

    const shouldRefreshThreads = pendingThreadsRefresh
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    let wasAborted = false
    let refreshedMessageThreadId = ''

    const refreshActiveMessagesNow = async (threadId: string): Promise<void> => {
      if (!threadId) return
      await loadMessages(threadId, { silent: true, signal: controller?.signal })
      refreshedMessageThreadId = threadId
    }

    try {
      const initialActiveThreadId = selectedThreadId.value
      if (initialActiveThreadId) {
        await refreshRuntimeStatusSnapshot(initialActiveThreadId, controller?.signal)
      }
      if (initialActiveThreadId && threadIdsToRefresh.has(initialActiveThreadId)) {
        await refreshActiveMessagesNow(initialActiveThreadId)
      }

      if (shouldRefreshThreads) {
        await loadThreads({
          signal: controller?.signal,
          preserveMissingSelected: Boolean(initialActiveThreadId),
        })
      }

      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return

      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      if ((isActiveDirty || hasVersionChange || shouldRefreshThreads) && refreshedMessageThreadId !== activeThreadId) {
        await refreshActiveMessagesNow(activeThreadId)
      }
    } catch (error) {
      wasAborted = isAbortLikeError(error)
      if (!wasAborted) {
        setSyncErrorFromUnknown(error)
      }
    } finally {
      clearSyncAbortController(controller)
      isPolling.value = false

      if (wasAborted) {
        scheduleEventSync(0)
        return
      }

      if (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) {
        scheduleEventSync()
      }
    }
  }

  function openNotificationStream(): void {
    realtimeConnectionState.value = 'connecting'
    stopNotificationStream = subscribeCodexNotifications(
      (notification) => {
        processIncomingNotification(notification)
      },
      {
        onConnectionStateChange: (state) => {
          const previousState = realtimeConnectionState.value
          realtimeConnectionState.value = state
          notificationHealthTick.value = Date.now()
          if (state === 'connected') {
            clearSyncError()
          }
          if (!isDocumentVisible()) {
            return
          }
          if (state === 'reconnecting' || state === 'disconnected') {
            return
          }
          if (state === 'connected' && previousState !== 'connected') {
            if (androidShellAvailable) {
              runForegroundRecoverySync({
                includeThreadList: false,
                forceMessageRefresh: true,
                urgent: true,
              })
              return
            }
            if (hasSyncDemand.value) {
              runForegroundRecoverySync({
                includeThreadList: !hasLoadedThreads.value || pendingThreadsRefresh,
                forceMessageRefresh: true,
                urgent: true,
              })
              return
            }
            void replayMissedNotifications()
          }
        },
      },
    )
  }

  function restartNotificationStream(): void {
    if (typeof window === 'undefined') return
    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }
    openNotificationStream()
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    void loadPendingServerRequestsFromBridge()
    scheduleBackgroundSync()
    scheduleVisibilitySync()
    openNotificationStream()
  }

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    try {
      const rows = await getPendingServerRequests()
      const nextPending: Record<string, UiServerRequest[]> = {}
      for (const row of rows) {
        const request = normalizeServerRequest(row)
        if (request) {
          const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
          const current = nextPending[threadId] ?? []
          nextPending[threadId] = [...current, request]
        }
      }
      pendingServerRequestsByThreadId.value = nextPending
      applyThreadFlags()
    } catch {
      // The backend auto-resolves unsupported tool calls; stale local copies should not keep
      // the conversation in an artificial waiting state if pending request sync misses once.
      pruneAutoResolvedPendingServerRequests()
    }
  }

  function noteIncomingNotification(notification: RpcNotification): void {
    lastNotificationAtMs = Date.now()
    notificationHealthTick.value = lastNotificationAtMs
    if (typeof notification.seq === 'number' && Number.isFinite(notification.seq)) {
      const nextSeq = Math.max(lastNotificationSeq, Math.trunc(notification.seq))
      if (nextSeq !== lastNotificationSeq) {
        lastNotificationSeq = nextSeq
        saveLastNotificationSeq(lastNotificationSeq)
      }
    }
  }

  function processIncomingNotification(notification: RpcNotification): void {
    noteIncomingNotification(notification)
    if (notification.method === SKILLS_CHANGED_METHOD) {
      scheduleSkillsRefreshFromNotification()
    }
    applyRealtimeUpdates(notification)
    queueEventDrivenSync(notification)
  }

  async function replayMissedNotifications(): Promise<void> {
    if (replayNotificationsPromise) return replayNotificationsPromise

    const replayAfterSeq = Math.max(0, lastNotificationSeq)
    replayNotificationsPromise = getNotificationReplay(replayAfterSeq, 200)
      .then((result) => {
        if (replayAfterSeq > 0 && result.latestSeq < replayAfterSeq) {
          lastNotificationSeq = 0
          saveLastNotificationSeq(0)
          return getNotificationReplay(0, 200).then((resetResult) => {
            for (const notification of resetResult.notifications) {
              if (typeof notification.seq === 'number' && notification.seq <= lastNotificationSeq) continue
              processIncomingNotification(notification)
            }
            lastNotificationSeq = Math.max(lastNotificationSeq, resetResult.latestSeq)
            saveLastNotificationSeq(lastNotificationSeq)
          })
        }
        for (const notification of result.notifications) {
          if (typeof notification.seq === 'number' && notification.seq <= lastNotificationSeq) continue
          processIncomingNotification(notification)
        }
        lastNotificationSeq = Math.max(lastNotificationSeq, result.latestSeq)
        saveLastNotificationSeq(lastNotificationSeq)
      })
      .catch(() => {
        // Snapshot sync below still catches up when replay is unavailable.
      })
      .finally(() => {
        replayNotificationsPromise = null
      })
    return replayNotificationsPromise
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<void> {
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      removePendingServerRequestById(reply.id)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
    }
  }

  function stopPolling(): void {
    setAndroidKeepAwake(false)
    stopAndroidKeepAwakeWatch?.()
    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }
    if (backgroundSyncTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(backgroundSyncTimer)
      backgroundSyncTimer = null
    }
    stopActiveSyncBoost()
    clearBufferedLiveDeltas()

    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    clearEventSyncTimer()
    abortCurrentSync()
    isPolling.value = false
    if (rateLimitRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(rateLimitRefreshTimer)
      rateLimitRefreshTimer = null
    }
    if (composerPluginsRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(composerPluginsRefreshTimer)
      composerPluginsRefreshTimer = null
    }
    if (skillsChangedRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(skillsChangedRefreshTimer)
      skillsChangedRefreshTimer = null
    }
    clearVisibilitySyncTimer()
    stopVisibilitySync()
    for (const timer of resumeSyncTimers) {
      window.clearTimeout(timer)
    }
    resumeSyncTimers.clear()
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
    lastNotificationAtMs = Date.now()
    notificationHealthTick.value = lastNotificationAtMs
    realtimeConnectionState.value = 'disconnected'
    lastSuccessfulSyncAtMs.value = 0
    activeSyncBoostUntilMs = 0
    persistedMessagesByThreadId.value = {}
    optimisticUserMessagesByThreadId.value = {}
    liveAgentMessagesByThreadId.value = {}
    liveReasoningTextByThreadId.value = {}
    liveCommandsByThreadId.value = {}
    threadTokenUsageByThreadId.value = {}
    tokenUsageRefreshInFlightByThreadId.clear()
    tokenUsageRefreshAttemptedAtByThreadId.clear()
    messageLoadInFlightByThreadId.clear()
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    activeTurnIdByThreadId.value = {}
    runtimeExecutionStateByThreadId.value = {}
    runtimeCanStopByThreadId.value = {}
    runtimeStaleByThreadId.value = {}
    lastExecutionSignalAtByThreadId.value = {}
    threadReadActiveStateByThreadId.value = {}
    ignoredStaleActiveTurnByThreadId.value = {}
    lastThreadDetailSyncAtById.value = {}
    queueProcessingByThreadId.value = {}
  }

  const selectedThreadQueuedMessages = computed<QueuedMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []
    return queuedMessagesByThreadId.value[threadId] ?? []
  })

  const selectedThreadQueueProcessing = computed<boolean>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    return queueProcessingByThreadId.value[threadId] === true
  })

  function removeQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    removeQueuedMessageByThreadId(threadId, messageId)
  }

  async function quoteQueuedMessage(messageId: string): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const msg = queue.find((m) => m.id === messageId)
    if (!msg) return
    try {
      await sendMessageToSelectedThread(
        msg.text,
        msg.imageUrls,
        msg.skills,
        'steer',
        msg.fileAttachments,
        undefined,
        msg.collaborationMode,
        msg.turnOptions,
      )
      removeQueuedMessageByThreadId(threadId, messageId)
    } catch {
      // Keep the queued message so the user can retry or edit it.
    }
  }

  return {
    projectGroups,
    projectDisplayNameById,
    selectedThread,
    selectedThreadScrollState,
    selectedThreadServerRequests,
    selectedLiveOverlay,
    selectedThreadExecutionActive,
    selectedThreadCanStop,
    selectedThreadRuntimeStatus,
    selectedThreadTokenUsage,
    selectedThreadId,
    availableModelIds,
    selectedModelId,
    selectedReasoningEffort,
    selectedSpeedMode,
    selectedCollaborationMode,
    installedSkills,
    availableComposerPlugins,
    isLoadingComposerPlugins,
    accountRateLimitSnapshots,
    messages,
    isLoadingThreads,
    isLoadingMessages,
    isSendingMessage,
    isInterruptingTurn,
    isUpdatingSpeedMode,
    notificationStale,
    realtimeConnectionState,
    syncLagging,
    syncError,
    error,
    refreshAll,
    refreshSelectedThreadContent,
    refreshSkills,
    refreshComposerPlugins,
    loginComposerPlugin,
    reloadComposerPlugins: reloadAndRefreshComposerPlugins,
    refreshRateLimits,
    selectThread,
    setThreadScrollState,
    archiveThreadById,
    dismissThreadLocally,
    renameThreadById,
    forkThreadById,
    sendMessageToSelectedThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    rollbackSelectedThread,
    isRollingBack,
    selectedThreadQueuedMessages,
    selectedThreadQueueProcessing,
    removeQueuedMessage,
    quoteQueuedMessage,
    markAllThreadsAsRead,
    setSelectedModelId,
    setWorktreeGitAutomationEnabled,
    setSelectedCollaborationMode,
    setSelectedReasoningEffort,
    updateSelectedSpeedMode,
    respondToPendingServerRequest,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    startPolling,
    stopPolling,
  }
}
