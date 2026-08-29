export const FOREGROUND_RECOVERY_METRICS_STORAGE_KEY = 'codex-web-local.foreground-recovery-metrics.v1'

const FOREGROUND_RECOVERY_METRICS_VERSION = 2
const FOREGROUND_RECOVERY_METRICS_MAX_SAMPLES = 50
const FOREGROUND_RECOVERY_METRICS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type ForegroundRecoveryMetricSample = {
  startedAtMs: number
  settledAtMs: number
  latencyMs: number
}

export type ForegroundRecoveryMetricSummary = {
  sampleCount: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  latestMs: number | null
}

type ForegroundRecoveryMetricHost = {
  __cxCodexForegroundRecoveryActive?: Record<string, { startedAtMs: number }>
  __cxCodexForegroundRecoveryMetricSummary?: ForegroundRecoveryMetricSummary
  __cxCodexForegroundRecoveryMetricLatest?: ForegroundRecoveryMetricSample
  __cxCodexForegroundRecoveryMetricGeneration?: number
}

type ForegroundRecoveryMetricStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredForegroundRecoveryMetrics = {
  version: number
  samples: ForegroundRecoveryMetricSample[]
}

function browserMetricHost(): ForegroundRecoveryMetricHost | null {
  return typeof window === 'undefined' ? null : window as unknown as ForegroundRecoveryMetricHost
}

function browserMetricStorage(): ForegroundRecoveryMetricStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function normalizeSample(value: unknown, nowMs: number): ForegroundRecoveryMetricSample | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<ForegroundRecoveryMetricSample>
  if (
    typeof row.startedAtMs !== 'number' || !Number.isFinite(row.startedAtMs) ||
    typeof row.settledAtMs !== 'number' || !Number.isFinite(row.settledAtMs) ||
    typeof row.latencyMs !== 'number' || !Number.isFinite(row.latencyMs)
  ) return null
  if (row.settledAtMs < row.startedAtMs || row.latencyMs < 0) return null
  if (nowMs - row.settledAtMs > FOREGROUND_RECOVERY_METRICS_MAX_AGE_MS) return null
  return {
    startedAtMs: Math.trunc(row.startedAtMs),
    settledAtMs: Math.trunc(row.settledAtMs),
    latencyMs: Math.trunc(row.latencyMs),
  }
}

function loadSamples(
  storage: ForegroundRecoveryMetricStorage | null,
  nowMs: number,
): ForegroundRecoveryMetricSample[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(FOREGROUND_RECOVERY_METRICS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<StoredForegroundRecoveryMetrics>
    if (parsed.version !== FOREGROUND_RECOVERY_METRICS_VERSION || !Array.isArray(parsed.samples)) {
      storage.removeItem(FOREGROUND_RECOVERY_METRICS_STORAGE_KEY)
      return []
    }
    return parsed.samples
      .map((sample) => normalizeSample(sample, nowMs))
      .filter((sample): sample is ForegroundRecoveryMetricSample => sample !== null)
      .slice(-FOREGROUND_RECOVERY_METRICS_MAX_SAMPLES)
  } catch {
    try {
      storage.removeItem(FOREGROUND_RECOVERY_METRICS_STORAGE_KEY)
    } catch {
      // Diagnostics must never affect foreground recovery.
    }
    return []
  }
}

function saveSamples(
  storage: ForegroundRecoveryMetricStorage | null,
  samples: ForegroundRecoveryMetricSample[],
): void {
  if (!storage) return
  try {
    storage.setItem(FOREGROUND_RECOVERY_METRICS_STORAGE_KEY, JSON.stringify({
      version: FOREGROUND_RECOVERY_METRICS_VERSION,
      samples: samples.slice(-FOREGROUND_RECOVERY_METRICS_MAX_SAMPLES),
    } satisfies StoredForegroundRecoveryMetrics))
  } catch {
    // Metrics are best-effort and contain no message or thread content.
  }
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null
  const index = Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)
  return sortedValues[Math.min(index, sortedValues.length - 1)] ?? null
}

export function summarizeForegroundRecoveryMetrics(
  samples: ForegroundRecoveryMetricSample[],
): ForegroundRecoveryMetricSummary {
  const latencies = samples.map((sample) => sample.latencyMs).sort((first, second) => first - second)
  return {
    sampleCount: samples.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.at(-1) ?? null,
    latestMs: samples.at(-1)?.latencyMs ?? null,
  }
}

export function beginForegroundRecoveryMetric(
  threadId: string,
  startedAtMs = Date.now(),
  host = browserMetricHost(),
): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId || !host) return
  const current = host.__cxCodexForegroundRecoveryActive?.[normalizedThreadId]
  host.__cxCodexForegroundRecoveryActive = {
    ...(current ? { [normalizedThreadId]: current } : { [normalizedThreadId]: { startedAtMs } }),
  }
}

export function cancelForegroundRecoveryMetric(
  threadId = '',
  host = browserMetricHost(),
): void {
  if (!host?.__cxCodexForegroundRecoveryActive) return
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    host.__cxCodexForegroundRecoveryActive = {}
    return
  }
  const next = { ...host.__cxCodexForegroundRecoveryActive }
  delete next[normalizedThreadId]
  host.__cxCodexForegroundRecoveryActive = next
}

export function settleForegroundRecoveryMetric(
  threadId: string,
  settledAtMs = Date.now(),
  host = browserMetricHost(),
  storage = browserMetricStorage(),
): ForegroundRecoveryMetricSample | null {
  const normalizedThreadId = threadId.trim()
  const active = host?.__cxCodexForegroundRecoveryActive?.[normalizedThreadId]
  if (!normalizedThreadId || !host || !active) return null

  cancelForegroundRecoveryMetric(normalizedThreadId, host)
  const sample: ForegroundRecoveryMetricSample = {
    startedAtMs: Math.trunc(active.startedAtMs),
    settledAtMs: Math.trunc(settledAtMs),
    latencyMs: Math.max(0, Math.trunc(settledAtMs - active.startedAtMs)),
  }
  const samples = [...loadSamples(storage, settledAtMs), sample]
    .slice(-FOREGROUND_RECOVERY_METRICS_MAX_SAMPLES)
  saveSamples(storage, samples)
  host.__cxCodexForegroundRecoveryMetricLatest = sample
  host.__cxCodexForegroundRecoveryMetricSummary = summarizeForegroundRecoveryMetrics(samples)
  host.__cxCodexForegroundRecoveryMetricGeneration =
    (host.__cxCodexForegroundRecoveryMetricGeneration ?? 0) + 1
  return sample
}

export function readForegroundRecoveryMetricSummary(
  nowMs = Date.now(),
  storage = browserMetricStorage(),
): ForegroundRecoveryMetricSummary {
  return summarizeForegroundRecoveryMetrics(loadSamples(storage, nowMs))
}
