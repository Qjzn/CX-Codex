export const CONVERSATION_BOTTOM_THRESHOLD_PX = 24

export type ConversationViewportMetrics = {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function conversationDistanceFromBottom(metrics: ConversationViewportMetrics): number {
  const scrollHeight = normalizeViewportValue(metrics.scrollHeight)
  const scrollTop = normalizeViewportValue(metrics.scrollTop)
  const clientHeight = normalizeViewportValue(metrics.clientHeight)
  return Math.max(scrollHeight - scrollTop - clientHeight, 0)
}

export function isConversationViewportAtBottom(
  metrics: ConversationViewportMetrics,
  thresholdPx = CONVERSATION_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx) ? Math.max(0, thresholdPx) : CONVERSATION_BOTTOM_THRESHOLD_PX
  return conversationDistanceFromBottom(metrics) <= threshold
}

function normalizeViewportValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
