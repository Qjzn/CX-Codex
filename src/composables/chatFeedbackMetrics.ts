export type ChatFeedbackMetric = {
  threadId: string
  clientMessageId: string
  optimisticMessageId: string
  submitStartedAtMs: number
  stateCommittedAtMs: number
  stateCommitLatencyMs: number
  bubbleVisibleAtMs?: number
  bubbleVisibleLatencyMs?: number
  runningVisibleAtMs?: number
  runningVisibleLatencyMs?: number
  requestDispatchedAtMs?: number
  requestDispatchedLatencyMs?: number
  serverAcknowledgedAtMs?: number
  serverAcknowledgedLatencyMs?: number
  turnId?: string
  turnStartedAtMs?: number
  turnStartedLatencyMs?: number
  firstAssistantDataAtMs?: number
  firstAssistantDataLatencyMs?: number
  firstAssistantMessageId?: string
  firstAssistantVisibleAtMs?: number
  firstAssistantVisibleLatencyMs?: number
}

export type ChatFeedbackStageName =
  | 'stateCommit'
  | 'bubbleVisible'
  | 'runningVisible'
  | 'requestDispatched'
  | 'serverAcknowledged'
  | 'turnStarted'
  | 'firstAssistantData'
  | 'firstAssistantVisible'
  | 'assistantRenderOverhead'

export type ChatFeedbackStageSummary = {
  count: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

export type ChatFeedbackMetricSummary = {
  sampleCount: number
  generatedAtMs: number
  oldestSubmitStartedAtMs: number | null
  newestSubmitStartedAtMs: number | null
  stages: Record<ChatFeedbackStageName, ChatFeedbackStageSummary>
}

type ChatFeedbackMetricHost = Window & {
  __cxCodexChatFeedbackMetrics?: ChatFeedbackMetric[]
  __cxCodexChatFeedbackSummary?: ChatFeedbackMetricSummary
}

type StoredChatFeedbackMetrics = {
  version: 1
  metrics: ChatFeedbackMetric[]
}

export const CHAT_FEEDBACK_METRIC_STORAGE_KEY = 'codex-web-local.chat-feedback-metrics.v1'

const CHAT_FEEDBACK_METRIC_LIMIT = 50
const CHAT_FEEDBACK_METRIC_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const CHAT_FEEDBACK_STAGE_READERS: Record<
  ChatFeedbackStageName,
  (metric: ChatFeedbackMetric) => number | undefined
> = {
  stateCommit: (metric) => metric.stateCommitLatencyMs,
  bubbleVisible: (metric) => metric.bubbleVisibleLatencyMs,
  runningVisible: (metric) => metric.runningVisibleLatencyMs,
  requestDispatched: (metric) => metric.requestDispatchedLatencyMs,
  serverAcknowledged: (metric) => metric.serverAcknowledgedLatencyMs,
  turnStarted: (metric) => metric.turnStartedLatencyMs,
  firstAssistantData: (metric) => metric.firstAssistantDataLatencyMs,
  firstAssistantVisible: (metric) => metric.firstAssistantVisibleLatencyMs,
  assistantRenderOverhead: (metric) => {
    if (
      metric.firstAssistantDataLatencyMs === undefined
      || metric.firstAssistantVisibleLatencyMs === undefined
    ) return undefined
    return Math.max(0, metric.firstAssistantVisibleLatencyMs - metric.firstAssistantDataLatencyMs)
  },
}

function readMetricString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 256) : ''
}

function readMetricNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function normalizeStoredMetric(value: unknown): ChatFeedbackMetric | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const threadId = readMetricString(candidate.threadId)
  const clientMessageId = readMetricString(candidate.clientMessageId)
  const optimisticMessageId = readMetricString(candidate.optimisticMessageId)
  const submitStartedAtMs = readMetricNumber(candidate.submitStartedAtMs)
  const stateCommittedAtMs = readMetricNumber(candidate.stateCommittedAtMs)
  const stateCommitLatencyMs = readMetricNumber(candidate.stateCommitLatencyMs)
  if (
    !threadId
    || !clientMessageId
    || !optimisticMessageId
    || submitStartedAtMs === undefined
    || stateCommittedAtMs === undefined
    || stateCommitLatencyMs === undefined
  ) return null

  const metric: ChatFeedbackMetric = {
    threadId,
    clientMessageId,
    optimisticMessageId,
    submitStartedAtMs,
    stateCommittedAtMs,
    stateCommitLatencyMs,
  }
  const optionalNumberKeys = [
    'bubbleVisibleAtMs',
    'bubbleVisibleLatencyMs',
    'runningVisibleAtMs',
    'runningVisibleLatencyMs',
    'requestDispatchedAtMs',
    'requestDispatchedLatencyMs',
    'serverAcknowledgedAtMs',
    'serverAcknowledgedLatencyMs',
    'turnStartedAtMs',
    'turnStartedLatencyMs',
    'firstAssistantDataAtMs',
    'firstAssistantDataLatencyMs',
    'firstAssistantVisibleAtMs',
    'firstAssistantVisibleLatencyMs',
  ] as const
  for (const key of optionalNumberKeys) {
    const numericValue = readMetricNumber(candidate[key])
    if (numericValue !== undefined) metric[key] = numericValue
  }
  const turnId = readMetricString(candidate.turnId)
  if (turnId) metric.turnId = turnId
  const firstAssistantMessageId = readMetricString(candidate.firstAssistantMessageId)
  if (firstAssistantMessageId) metric.firstAssistantMessageId = firstAssistantMessageId
  return metric
}

function retainChatFeedbackMetrics(metrics: unknown[]): ChatFeedbackMetric[] {
  const oldestAllowedAtMs = Date.now() - CHAT_FEEDBACK_METRIC_TTL_MS
  return metrics
    .map(normalizeStoredMetric)
    .filter((metric): metric is ChatFeedbackMetric => (
      metric !== null && metric.submitStartedAtMs >= oldestAllowedAtMs
    ))
    .slice(-CHAT_FEEDBACK_METRIC_LIMIT)
}

function readStoredChatFeedbackMetrics(): ChatFeedbackMetric[] {
  try {
    const rawValue = window.localStorage.getItem(CHAT_FEEDBACK_METRIC_STORAGE_KEY)
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue) as Partial<StoredChatFeedbackMetrics>
    return parsed.version === 1 && Array.isArray(parsed.metrics)
      ? retainChatFeedbackMetrics(parsed.metrics)
      : []
  } catch {
    return []
  }
}

function percentile(values: number[], proportion: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1)
  return sorted[index] ?? null
}

function summarizeStage(values: number[]): ChatFeedbackStageSummary {
  const normalized = values.filter((value) => Number.isFinite(value) && value >= 0)
  return {
    count: normalized.length,
    p50Ms: percentile(normalized, 0.5),
    p95Ms: percentile(normalized, 0.95),
    maxMs: normalized.length > 0 ? Math.max(...normalized) : null,
  }
}

function summarizeChatFeedbackMetrics(metrics: ChatFeedbackMetric[]): ChatFeedbackMetricSummary {
  const submitTimes = metrics.map((metric) => metric.submitStartedAtMs)
  const stages = Object.fromEntries(
    Object.entries(CHAT_FEEDBACK_STAGE_READERS).map(([stage, readValue]) => [
      stage,
      summarizeStage(metrics.map(readValue).filter((value): value is number => value !== undefined)),
    ]),
  ) as Record<ChatFeedbackStageName, ChatFeedbackStageSummary>
  return {
    sampleCount: metrics.length,
    generatedAtMs: Date.now(),
    oldestSubmitStartedAtMs: submitTimes.length > 0 ? Math.min(...submitTimes) : null,
    newestSubmitStartedAtMs: submitTimes.length > 0 ? Math.max(...submitTimes) : null,
    stages,
  }
}

function commitChatFeedbackMetrics(host: ChatFeedbackMetricHost, metrics: unknown[]): void {
  const retainedMetrics = retainChatFeedbackMetrics(metrics)
  host.__cxCodexChatFeedbackMetrics = retainedMetrics
  host.__cxCodexChatFeedbackSummary = summarizeChatFeedbackMetrics(retainedMetrics)
  try {
    const stored: StoredChatFeedbackMetrics = { version: 1, metrics: retainedMetrics }
    window.localStorage.setItem(CHAT_FEEDBACK_METRIC_STORAGE_KEY, JSON.stringify(stored))
  } catch {}
}

function getChatFeedbackMetrics(host: ChatFeedbackMetricHost): ChatFeedbackMetric[] {
  if (Array.isArray(host.__cxCodexChatFeedbackMetrics)) {
    return host.__cxCodexChatFeedbackMetrics
  }
  const storedMetrics = readStoredChatFeedbackMetrics()
  commitChatFeedbackMetrics(host, storedMetrics)
  return storedMetrics
}

function updateChatFeedbackMetric(
  predicate: (metric: ChatFeedbackMetric) => boolean,
  update: (metric: ChatFeedbackMetric, nowMs: number) => ChatFeedbackMetric,
): void {
  if (typeof window === 'undefined') return
  const host = window as ChatFeedbackMetricHost
  const metrics = getChatFeedbackMetrics(host)
  if (!metrics.length) return
  let metricIndex = -1
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    if (predicate(metrics[index])) {
      metricIndex = index
      break
    }
  }
  if (metricIndex < 0) return
  const nowMs = chatFeedbackNow()
  commitChatFeedbackMetrics(
    host,
    metrics.map((metric, index) => index === metricIndex ? update(metric, nowMs) : metric),
  )
}

export function chatFeedbackNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    const timeOrigin = Number.isFinite(performance.timeOrigin)
      ? performance.timeOrigin
      : Date.now() - performance.now()
    return timeOrigin + performance.now()
  }
  return Date.now()
}

export function readChatFeedbackMetricSummary(): ChatFeedbackMetricSummary | null {
  if (typeof window === 'undefined') return null
  const host = window as ChatFeedbackMetricHost
  const metrics = getChatFeedbackMetrics(host)
  if (!host.__cxCodexChatFeedbackSummary) {
    host.__cxCodexChatFeedbackSummary = summarizeChatFeedbackMetrics(metrics)
  }
  return host.__cxCodexChatFeedbackSummary
}

export function beginChatFeedbackMetric(args: {
  threadId: string
  clientMessageId: string
  optimisticMessageId: string
  submitStartedAtMs: number
}): void {
  if (typeof window === 'undefined') return
  const stateCommittedAtMs = chatFeedbackNow()
  const host = window as ChatFeedbackMetricHost
  const nextMetric: ChatFeedbackMetric = {
    threadId: args.threadId,
    clientMessageId: args.clientMessageId,
    optimisticMessageId: args.optimisticMessageId,
    submitStartedAtMs: args.submitStartedAtMs,
    stateCommittedAtMs,
    stateCommitLatencyMs: Math.max(0, Math.round(stateCommittedAtMs - args.submitStartedAtMs)),
  }
  commitChatFeedbackMetrics(host, [
    ...getChatFeedbackMetrics(host).filter(
      (metric) => metric.clientMessageId !== args.clientMessageId,
    ),
    nextMetric,
  ])
}

export function rebindChatFeedbackMetric(args: {
  optimisticMessageId: string
  threadId?: string
  clientMessageId?: string
}): void {
  updateChatFeedbackMetric(
    (metric) => metric.optimisticMessageId === args.optimisticMessageId,
    (metric) => ({
      ...metric,
      ...(args.threadId?.trim() ? { threadId: args.threadId.trim() } : {}),
      ...(args.clientMessageId?.trim() ? { clientMessageId: args.clientMessageId.trim() } : {}),
    }),
  )
}

export function markChatFeedbackRendered(args: {
  threadId: string
  optimisticMessageId: string
  runningVisible: boolean
}): void {
  if (typeof window === 'undefined') return
  const host = window as ChatFeedbackMetricHost
  const metrics = getChatFeedbackMetrics(host)
  if (!metrics.length) return
  let metricIndex = -1
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    const metric = metrics[index]
    if (
      metric.threadId === args.threadId
      && metric.optimisticMessageId === args.optimisticMessageId
      && (metric.bubbleVisibleAtMs === undefined || (args.runningVisible && metric.runningVisibleAtMs === undefined))
    ) {
      metricIndex = index
      break
    }
  }
  if (metricIndex < 0) return

  const nowMs = chatFeedbackNow()
  const current = metrics[metricIndex]
  const next: ChatFeedbackMetric = { ...current }
  if (next.bubbleVisibleAtMs === undefined) {
    next.bubbleVisibleAtMs = nowMs
    next.bubbleVisibleLatencyMs = Math.max(0, Math.round(nowMs - next.submitStartedAtMs))
  }
  if (args.runningVisible && next.runningVisibleAtMs === undefined) {
    next.runningVisibleAtMs = nowMs
    next.runningVisibleLatencyMs = Math.max(0, Math.round(nowMs - next.submitStartedAtMs))
  }
  commitChatFeedbackMetrics(
    host,
    metrics.map((metric, index) => index === metricIndex ? next : metric),
  )
}

export function markChatFeedbackRequestDispatched(clientMessageId: string): void {
  updateChatFeedbackMetric(
    (metric) => metric.clientMessageId === clientMessageId && metric.requestDispatchedAtMs === undefined,
    (metric, nowMs) => ({
      ...metric,
      requestDispatchedAtMs: nowMs,
      requestDispatchedLatencyMs: Math.max(0, Math.round(nowMs - metric.submitStartedAtMs)),
    }),
  )
}

export function markChatFeedbackServerAcknowledged(args: {
  clientMessageId?: string
  threadId: string
  turnId?: string
  turnStarted?: boolean
  turnStartedAtMs?: number
}): void {
  const turnId = args.turnId?.trim() ?? ''
  const authoritativeTurnStartedAtMs = typeof args.turnStartedAtMs === 'number' && Number.isFinite(args.turnStartedAtMs)
    ? args.turnStartedAtMs
    : undefined
  updateChatFeedbackMetric(
    (metric) => {
      if (args.clientMessageId && metric.clientMessageId !== args.clientMessageId) return false
      if (metric.threadId !== args.threadId) return false
      if (
        args.turnStarted
        && authoritativeTurnStartedAtMs !== undefined
        && authoritativeTurnStartedAtMs < metric.submitStartedAtMs
      ) return false
      return (
        metric.serverAcknowledgedAtMs === undefined
        || Boolean(turnId && !metric.turnId)
        || Boolean(
          args.turnStarted
          && metric.turnStartedAtMs === undefined
          && (!turnId || !metric.turnId || metric.turnId === turnId),
        )
      )
    },
    (metric, nowMs) => {
      const acknowledgedAtMs = metric.serverAcknowledgedAtMs ?? nowMs
      const next: ChatFeedbackMetric = {
        ...metric,
        serverAcknowledgedAtMs: acknowledgedAtMs,
        serverAcknowledgedLatencyMs: Math.max(0, Math.round(acknowledgedAtMs - metric.submitStartedAtMs)),
        ...(turnId ? { turnId } : {}),
      }
      if (args.turnStarted && next.turnStartedAtMs === undefined) {
        const turnStartedAtMs = authoritativeTurnStartedAtMs ?? nowMs
        next.turnStartedAtMs = turnStartedAtMs
        next.turnStartedLatencyMs = Math.max(0, Math.round(turnStartedAtMs - next.submitStartedAtMs))
      }
      return next
    },
  )
}

export function markChatFeedbackFirstAssistantData(args: {
  threadId: string
  turnId?: string
  messageId?: string
}): void {
  const turnId = args.turnId?.trim() ?? ''
  const messageId = args.messageId?.trim() ?? ''
  updateChatFeedbackMetric(
    (metric) => (
      metric.threadId === args.threadId
      && metric.firstAssistantDataAtMs === undefined
      && (!turnId || !metric.turnId || metric.turnId === turnId)
    ),
    (metric, nowMs) => ({
      ...metric,
      ...(turnId && !metric.turnId ? { turnId } : {}),
      ...(messageId ? { firstAssistantMessageId: messageId } : {}),
      firstAssistantDataAtMs: nowMs,
      firstAssistantDataLatencyMs: Math.max(0, Math.round(nowMs - metric.submitStartedAtMs)),
    }),
  )
}

export function markChatFeedbackFirstAssistantVisible(args: {
  threadId: string
  visibleMessageIds: ReadonlySet<string>
}): void {
  updateChatFeedbackMetric(
    (metric) => (
      metric.threadId === args.threadId
      && metric.firstAssistantDataAtMs !== undefined
      && Boolean(
        metric.firstAssistantMessageId
        && args.visibleMessageIds.has(metric.firstAssistantMessageId),
      )
      && metric.firstAssistantVisibleAtMs === undefined
    ),
    (metric, nowMs) => ({
      ...metric,
      firstAssistantVisibleAtMs: nowMs,
      firstAssistantVisibleLatencyMs: Math.max(0, Math.round(nowMs - metric.submitStartedAtMs)),
    }),
  )
}

if (typeof window !== 'undefined') {
  getChatFeedbackMetrics(window as ChatFeedbackMetricHost)
}
