export type ThreadFirstScreenSource = 'local-cache' | 'memory' | 'network' | 'unknown'

const THREAD_FIRST_SCREEN_METRIC_LIMIT = 32

export type ThreadFirstScreenReadyMetric = {
  readyAtMs: number
  selectionStartedAtMs: number | null
  selectionLatencyMs: number | null
  source: ThreadFirstScreenSource
  itemCount: number
  userCount: number
  assistantCount: number
}

type ThreadFirstScreenStartMetric = {
  startedAtMs: number
  source: ThreadFirstScreenSource
}

export type ThreadFirstScreenMetricHost = {
  __cxCodexThreadFirstScreenStart?: Record<string, ThreadFirstScreenStartMetric>
  __cxCodexThreadFirstScreenReady?: Record<string, ThreadFirstScreenReadyMetric>
}

function metricNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function browserMetricHost(): ThreadFirstScreenMetricHost | null {
  return typeof window === 'undefined' ? null : window as unknown as ThreadFirstScreenMetricHost
}

function setBoundedThreadMetric<T>(
  current: Record<string, T> | undefined,
  threadId: string,
  value: T,
): Record<string, T> {
  return Object.fromEntries([
    ...Object.entries(current ?? {}).filter(([key]) => key !== threadId),
    [threadId, value] as [string, T],
  ].slice(-THREAD_FIRST_SCREEN_METRIC_LIMIT))
}

export function beginThreadFirstScreenMetric(
  threadId: string,
  startedAtMs = metricNow(),
  host = browserMetricHost(),
): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId || !host) return

  host.__cxCodexThreadFirstScreenStart = setBoundedThreadMetric(
    host.__cxCodexThreadFirstScreenStart,
    normalizedThreadId,
    {
      startedAtMs,
      source: 'unknown',
    },
  )
  if (host.__cxCodexThreadFirstScreenReady?.[normalizedThreadId]) {
    const nextReady = { ...host.__cxCodexThreadFirstScreenReady }
    delete nextReady[normalizedThreadId]
    host.__cxCodexThreadFirstScreenReady = nextReady
  }
}

export function setThreadFirstScreenSource(
  threadId: string,
  source: Exclude<ThreadFirstScreenSource, 'unknown'>,
  host = browserMetricHost(),
): void {
  const normalizedThreadId = threadId.trim()
  const current = host?.__cxCodexThreadFirstScreenStart?.[normalizedThreadId]
  if (!normalizedThreadId || !host || !current) return

  host.__cxCodexThreadFirstScreenStart = setBoundedThreadMetric(
    host.__cxCodexThreadFirstScreenStart,
    normalizedThreadId,
    {
      ...current,
      source,
    },
  )
}

export function markThreadFirstScreenReady(
  input: {
    threadId: string
    itemCount: number
    userCount: number
    assistantCount: number
  },
  readyAtMs = metricNow(),
  host = browserMetricHost(),
): ThreadFirstScreenReadyMetric | null {
  const threadId = input.threadId.trim()
  if (!threadId || !host) return null
  const existing = host.__cxCodexThreadFirstScreenReady?.[threadId]
  if (existing) return existing

  const start = host.__cxCodexThreadFirstScreenStart?.[threadId]
  const metric: ThreadFirstScreenReadyMetric = {
    readyAtMs: Math.round(readyAtMs),
    selectionStartedAtMs: start ? Math.round(start.startedAtMs) : null,
    selectionLatencyMs: start ? Math.max(0, Math.round(readyAtMs - start.startedAtMs)) : null,
    source: start?.source ?? 'unknown',
    itemCount: Math.max(0, Math.trunc(input.itemCount)),
    userCount: Math.max(0, Math.trunc(input.userCount)),
    assistantCount: Math.max(0, Math.trunc(input.assistantCount)),
  }
  host.__cxCodexThreadFirstScreenReady = setBoundedThreadMetric(
    host.__cxCodexThreadFirstScreenReady,
    threadId,
    metric,
  )
  return metric
}
