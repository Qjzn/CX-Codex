export type RpcEnvelope<T> = {
  result: T
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type SpeedMode = 'standard' | 'fast'
export type CollaborationMode = 'execute' | 'plan'
export type PluginAuthStatus = 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth' | 'unknown'
export type ComposerPluginSource = 'plugin' | 'mcp' | 'app'

export type ComposerModelInfo = {
  id: string
  model: string
  displayName: string
  description: string
  hidden: boolean
  isDefault: boolean
  defaultReasoningEffort: ReasoningEffort
  supportedReasoningEfforts: Array<{
    value: ReasoningEffort
    description: string
  }>
}

export type ComposerPluginSelection = {
  id: string
  name: string
  path?: string
  source?: ComposerPluginSource
}

export type TurnGoalSelection = {
  enabled: boolean
  text: string
}

export type ComposerTurnOptions = {
  plugins?: ComposerPluginSelection[]
  goal?: TurnGoalSelection
}

export type ComposerPluginInfo = {
  id: string
  name: string
  description: string
  source: ComposerPluginSource
  mentionPath: string
  authStatus: PluginAuthStatus
  isAccessible?: boolean
  isEnabled?: boolean
  distributionChannel?: string | null
  installUrl?: string | null
  toolCount: number
  resourceCount: number
  resourceTemplateCount: number
  tools: Array<{
    name: string
    title: string
    description: string
  }>
}

export type RpcMethodCatalog = {
  data: string[]
}

export type ThreadListResult = {
  data: ThreadSummary[]
  nextCursor?: string | null
}

export type ThreadSummary = {
  id: string
  preview: string
  title?: string
  name?: string
  cwd: string
  updatedAt: number
  createdAt: number
  source?: unknown
}

export type ThreadReadResult = {
  thread: ThreadDetail
}

export type ThreadDetail = {
  id: string
  cwd: string
  preview: string
  turns: ThreadTurn[]
  updatedAt: number
  createdAt: number
}

export type ThreadTurn = {
  id: string
  status: string
  items: ThreadItem[]
}

export type ThreadItem = {
  id: string
  type: string
  text?: string
  content?: unknown
  summary?: string[]
}

export type UserInput = {
  type: string
  text?: string
  path?: string
  url?: string
}

export type UiThread = {
  id: string
  title: string
  projectName: string
  cwd: string
  sourceKind?: string
  hasWorktree: boolean
  createdAtIso: string
  updatedAtIso: string
  preview: string
  unread: boolean
  inProgress: boolean
}

export type UiTaskPetItem = {
  threadId: string
  title: string
  projectName: string
  detail: string
  latestActivity: string
  state: 'running' | 'waiting'
  updatedAtIso: string
}

export type CommandExecutionData = {
  command: string
  cwd: string | null
  status: 'inProgress' | 'completed' | 'failed' | 'declined' | 'interrupted'
  aggregatedOutput: string
  exitCode: number | null
  durationMs: number | null
  startedAtMs: number | null
}

export type UiFileAttachment = { label: string; path: string }

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  images?: string[]
  fileAttachments?: UiFileAttachment[]
  messageType?: string
  rawPayload?: string
  isUnhandled?: boolean
  commandExecution?: CommandExecutionData
  turnIndex?: number
}

export type UiServerRequest = {
  id: number
  method: string
  threadId: string
  turnId: string
  itemId: string
  receivedAtIso: string
  params: unknown
}

export type UiServerRequestReply = {
  id: number
  result?: unknown
  error?: {
    code?: number
    message: string
  }
}

export type UiLiveOverlay = {
  activityLabel: string
  activityDetails: string[]
  reasoningText: string
  errorText: string
}

export type UiRuntimeStatusSummary = {
  threadId: string
  executionState: string
  canStop: boolean
  stale: boolean
  stopRequested: boolean
  activeTurnId: string
  lastError: string | null
  degradedReason: string | null
  messageState: 'fresh' | 'cached' | 'unavailable'
  updatedAtIso: string
  lastEventSeq: number
  lastStartedAtIso: string | null
  lastCompletedAtIso: string | null
}

export type UiCreditsSnapshot = {
  hasCredits: boolean
  unlimited: boolean
  balance: string | null
}

export type UiRateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export type UiRateLimitSnapshot = {
  limitId: string | null
  limitName: string | null
  primary: UiRateLimitWindow | null
  secondary: UiRateLimitWindow | null
  credits: UiCreditsSnapshot | null
  planType: string | null
}

export type UiTokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type UiThreadTokenUsage = {
  total: UiTokenUsageBreakdown
  last: UiTokenUsageBreakdown
  modelContextWindow: number | null
  usedPercent: number | null
  remainingTokens: number | null
}

export type UiProjectGroup = {
  projectName: string
  workspaceRoot?: string
  isPinnedProject?: boolean
  pinnedProjectRank?: number
  threads: UiThread[]
}

export type ThreadScrollState = {
  scrollTop: number
  isAtBottom: boolean
  scrollRatio?: number
}

export type ChatMessage = {
  id: string
  role: string
  text: string
  createdAt: string | null
}

export type ChatThread = {
  id: string
  title: string
  projectName: string
  updatedAt: string | null
  messages: ChatMessage[]
}
