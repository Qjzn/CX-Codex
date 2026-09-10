export type ConversationExecutionState =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'stopped'
  | 'sync-degraded'

export function isTerminalConversationExecutionState(
  state: ConversationExecutionState,
): boolean {
  return state === 'completed'
    || state === 'failed'
    || state === 'interrupted'
    || state === 'stopped'
}

export function latestConversationTurnIsTerminal(
  projection: { turns: ReadonlyArray<{ state: ConversationExecutionState }> },
): boolean {
  const latestTurn = projection.turns.at(-1)
  return latestTurn ? isTerminalConversationExecutionState(latestTurn.state) : false
}

export type ConversationItemStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'declined'

export type ConversationNotificationInput = {
  method: string
  params: unknown
  atIso: string
  seq?: number
}

export type ConversationRuntimeFacts = {
  executionState?: string
  activeTurnId?: string
  activeItemId?: string
  lastStartedAtIso?: string | null
  lastCompletedAtIso?: string | null
  lastError?: string | null
  stale?: boolean
  degradedReason?: string | null
  messageState?: 'fresh' | 'cached' | 'unavailable'
}

export type ConversationLocalUserMessage = {
  id: string
  text: string
  clientMessageId?: string
  displayMessageId?: string
  turnId?: string
  createdAtMs?: number
  imageUrls?: string[]
  attachmentNames?: string[]
  deliveryState?: 'sending' | 'confirmationPending' | 'waitingNetwork' | 'sent' | 'failed'
}

export type ConversationProjectionInput = {
  threadRead: unknown
  runtime?: ConversationRuntimeFacts | null
  notifications?: ConversationNotificationInput[]
  pendingRequests?: unknown[]
  localUserMessages?: ConversationLocalUserMessage[]
  userMessageIdentities?: Array<{
    itemId: string
    turnId: string
    clientMessageId?: string
    displayMessageId: string
  }>
  nowMs: number
}

export type ConversationHistoryWindow = {
  view: 'full' | 'recent' | 'older'
  startIndex: number
  originalTurnCount: number
  hasOlder: boolean
}

export type ConversationUserBlock = {
  kind: 'user'
  id: string
  displayMessageId: string
  text: string
  atMs: number | null
  images: string[]
  skills: Array<{ name: string; path: string }>
  mentions: Array<{ name: string; path: string }>
  clientMessageId: string | null
  deliveryState: ConversationLocalUserMessage['deliveryState'] | null
}

export type ConversationAssistantBlock = {
  kind: 'assistant'
  id: string
  phase: 'commentary' | 'final'
  text: string
  atMs: number | null
  completedAtMs: number | null
  streaming: boolean
}

export type ConversationPlanStep = {
  step: string
  status: 'pending' | 'in-progress' | 'completed'
}

export type ConversationCommandActivity = {
  kind: 'activity'
  activityType: 'command'
  id: string
  label: string
  status: ConversationItemStatus
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
  command: string
  cwd: string
  output: string
  exitCode: number | null
}

export type ConversationMcpActivity = {
  kind: 'activity'
  activityType: 'mcp'
  id: string
  label: string
  status: ConversationItemStatus
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
  server: string
  tool: string
  progress: string[]
  error: string
}

export type ConversationSearchActivity = {
  kind: 'activity'
  activityType: 'web-search'
  id: string
  label: string
  status: ConversationItemStatus
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
  query: string
}

export type ConversationPlanActivity = {
  kind: 'activity'
  activityType: 'plan'
  id: string
  label: string
  status: ConversationItemStatus
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
  text: string
  explanation: string
  steps: ConversationPlanStep[]
}

export type ConversationGenericActivity = {
  kind: 'activity'
  activityType: 'reasoning' | 'file-change' | 'dynamic-tool' | 'collaboration' | 'image-view' | 'image-generation' | 'review' | 'compaction' | 'unknown'
  id: string
  label: string
  status: ConversationItemStatus
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
  target: string
}

export type ConversationActivity =
  | ConversationCommandActivity
  | ConversationMcpActivity
  | ConversationSearchActivity
  | ConversationPlanActivity
  | ConversationGenericActivity

export type ConversationInteractionBlock = {
  kind: 'interaction'
  id: string
  requestId: number | string
  responseId: number | null
  interactionType: 'approval' | 'user-input' | 'mcp-approval' | 'mcp-input' | 'unsupported-tool' | 'generic'
  status: 'pending' | 'resolved' | 'void'
  label: string
  title: string
  detail: string
  context: Array<{ label: string; value: string }>
  questions: ConversationInteractionQuestion[]
  authorizationUrl: string
  allowForSession: boolean
  mcpPersistenceScopes: Array<'session' | 'always'>
  requestedAtMs: number | null
  resolvedAtMs: number | null
  itemId: string
}

export type ConversationInteractionQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

export type ConversationNoticeBlock = {
  kind: 'notice'
  id: string
  tone: 'neutral' | 'warning' | 'danger'
  text: string
  atMs: number | null
}

export type ConversationTurnBlock =
  | ConversationUserBlock
  | ConversationAssistantBlock
  | ConversationActivity
  | ConversationInteractionBlock
  | ConversationNoticeBlock

export type ConversationFileChange = {
  path: string
  kind: 'add' | 'delete' | 'update'
  additions: number
  removals: number
  diff: string
  status: ConversationItemStatus
  itemIds: string[]
}

export type ConversationActivityGroup = {
  id: string
  activityIds: string[]
  status: ConversationItemStatus
  label: string
  startedAtMs: number | null
  completedAtMs: number | null
  durationMs: number | null
}

export type ConversationFavoriteIntent = {
  messageId: string
  role: 'user' | 'assistant'
  text: string
  turnId: string
  turnIndex: number
}

export type ConversationPlanImplementationIntent = {
  activityId: string
  turnId: string
  turnIndex: number
}

export type ConversationTurn = {
  id: string
  renderKey: string
  index: number
  state: ConversationExecutionState
  startedAtMs: number | null
  completedAtMs: number | null
  activeElapsedMs: number | null
  waitedMs: number
  timingStatus: 'complete' | 'running' | 'unavailable'
  opener: ConversationUserBlock | null
  blocks: ConversationTurnBlock[]
  commentary: ConversationAssistantBlock[]
  activities: ConversationActivity[]
  activityGroups: ConversationActivityGroup[]
  fileChanges: ConversationFileChange[]
  interactions: ConversationInteractionBlock[]
  final: ConversationAssistantBlock | null
  finalStatus: 'available' | 'pending' | 'missing' | 'failed' | 'interrupted' | 'stopped'
  error: string
}

export type ConversationProjection = {
  threadId: string
  turns: ConversationTurn[]
  history: ConversationHistoryWindow
  sourceState: 'fresh' | 'cached' | 'unavailable'
  generatedAtMs: number
}
