export type UnknownStatusRecord = {
  source: string
  value: string
  normalizedValue: string
  count: number
  firstSeenAtIso: string
  lastSeenAtIso: string
  threadId: string
}

export type AppServerStatusDiagnosticsSnapshot = {
  unknownStatusCount: number
  recentUnknownStatuses: UnknownStatusRecord[]
}

type StatusObservation = {
  threadId?: string
  payload: unknown
  atIso?: string
}

type StatusCandidate = {
  source: string
  value: string
}

type AppServerStatusDiagnosticsOptions = {
  maxRecentUnknown?: number
}

const KNOWN_THREAD_STATUSES = new Set([
  'active',
  'awaiting_approval',
  'blocked',
  'canceled',
  'cancelled',
  'complete',
  'completed',
  'created',
  'error',
  'failed',
  'idle',
  'in_progress',
  'inprogress',
  'interrupted',
  'materializing',
  'paused',
  'pending',
  'processing',
  'queued',
  'requires_action',
  'running',
  'started',
  'starting',
  'stopped',
  'stopping',
  'waiting',
  'waiting_permission',
])

export function normalizeAppServerStatusValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isKnownAppServerThreadStatus(value: unknown): boolean {
  const normalized = normalizeAppServerStatusValue(value)
  return normalized.length === 0 || KNOWN_THREAD_STATUSES.has(normalized)
}

export class AppServerStatusDiagnostics {
  private readonly maxRecentUnknown: number
  private readonly unknownBySourceAndStatus = new Map<string, UnknownStatusRecord>()
  private unknownStatusCount = 0

  constructor(options: AppServerStatusDiagnosticsOptions = {}) {
    this.maxRecentUnknown = Math.max(1, Math.min(100, Math.floor(options.maxRecentUnknown ?? 20)))
  }

  observeThreadRead(observation: StatusObservation): void {
    const atIso = observation.atIso || new Date().toISOString()
    const threadId = normalizeOptionalId(observation.threadId)
    for (const candidate of readThreadStatusCandidates(observation.payload)) {
      const normalizedValue = normalizeAppServerStatusValue(candidate.value)
      if (!normalizedValue || isKnownAppServerThreadStatus(normalizedValue)) continue
      this.recordUnknown({
        source: candidate.source,
        value: candidate.value,
        normalizedValue,
        threadId,
        atIso,
      })
    }
  }

  snapshot(): AppServerStatusDiagnosticsSnapshot {
    return {
      unknownStatusCount: this.unknownStatusCount,
      recentUnknownStatuses: Array.from(this.unknownBySourceAndStatus.values())
        .sort((left, right) => right.lastSeenAtIso.localeCompare(left.lastSeenAtIso)),
    }
  }

  clear(): void {
    this.unknownBySourceAndStatus.clear()
    this.unknownStatusCount = 0
  }

  private recordUnknown(record: {
    source: string
    value: string
    normalizedValue: string
    threadId: string
    atIso: string
  }): void {
    this.unknownStatusCount += 1
    const key = `${record.source}:${record.normalizedValue}`
    const existing = this.unknownBySourceAndStatus.get(key)
    if (existing) {
      existing.count += 1
      existing.value = record.value
      existing.lastSeenAtIso = record.atIso
      existing.threadId = record.threadId || existing.threadId
      return
    }

    this.unknownBySourceAndStatus.set(key, {
      source: record.source,
      value: record.value,
      normalizedValue: record.normalizedValue,
      count: 1,
      firstSeenAtIso: record.atIso,
      lastSeenAtIso: record.atIso,
      threadId: record.threadId,
    })

    if (this.unknownBySourceAndStatus.size > this.maxRecentUnknown) {
      const oldest = Array.from(this.unknownBySourceAndStatus.values())
        .sort((left, right) => left.lastSeenAtIso.localeCompare(right.lastSeenAtIso))[0]
      if (oldest) {
        this.unknownBySourceAndStatus.delete(`${oldest.source}:${oldest.normalizedValue}`)
      }
    }
  }
}

export function readThreadStatusCandidates(payload: unknown): StatusCandidate[] {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  if (!thread) return []

  const candidates: StatusCandidate[] = []
  if (typeof thread.status === 'string') {
    candidates.push({ source: 'thread.status', value: thread.status })
  } else {
    const statusRecord = asRecord(thread.status)
    if (typeof statusRecord?.type === 'string') {
      candidates.push({ source: 'thread.status.type', value: statusRecord.type })
    }
  }

  if (typeof thread.turnStatus === 'string') {
    candidates.push({ source: 'thread.turnStatus', value: thread.turnStatus })
  }

  const turns = Array.isArray(thread.turns) ? thread.turns : []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index])
    if (typeof turn?.status === 'string') {
      candidates.push({ source: 'thread.turns.status', value: turn.status })
      break
    }
  }

  return candidates
}

function normalizeOptionalId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
