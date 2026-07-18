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

type ChatFeedbackMetricHost = Window & {
  __cxCodexChatFeedbackMetrics?: ChatFeedbackMetric[]
}

const CHAT_FEEDBACK_METRIC_LIMIT = 20

function updateChatFeedbackMetric(
  predicate: (metric: ChatFeedbackMetric) => boolean,
  update: (metric: ChatFeedbackMetric, nowMs: number) => ChatFeedbackMetric,
): void {
  if (typeof window === 'undefined') return
  const host = window as ChatFeedbackMetricHost
  const metrics = host.__cxCodexChatFeedbackMetrics
  if (!metrics?.length) return
  let metricIndex = -1
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    if (predicate(metrics[index])) {
      metricIndex = index
      break
    }
  }
  if (metricIndex < 0) return
  const nowMs = chatFeedbackNow()
  host.__cxCodexChatFeedbackMetrics = metrics.map(
    (metric, index) => index === metricIndex ? update(metric, nowMs) : metric,
  )
}

export function chatFeedbackNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
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
  host.__cxCodexChatFeedbackMetrics = [
    ...(host.__cxCodexChatFeedbackMetrics ?? []).filter(
      (metric) => metric.clientMessageId !== args.clientMessageId,
    ),
    nextMetric,
  ].slice(-CHAT_FEEDBACK_METRIC_LIMIT)
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
  const metrics = host.__cxCodexChatFeedbackMetrics
  if (!metrics?.length) return
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
  host.__cxCodexChatFeedbackMetrics = metrics.map((metric, index) => index === metricIndex ? next : metric)
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
}): void {
  const turnId = args.turnId?.trim() ?? ''
  updateChatFeedbackMetric(
    (metric) => {
      if (args.clientMessageId && metric.clientMessageId !== args.clientMessageId) return false
      if (metric.threadId !== args.threadId) return false
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
        next.turnStartedAtMs = nowMs
        next.turnStartedLatencyMs = Math.max(0, Math.round(nowMs - next.submitStartedAtMs))
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
