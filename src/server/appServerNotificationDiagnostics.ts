export type UnknownNotificationRecord = {
  method: string
  count: number
  firstSeenAtIso: string
  lastSeenAtIso: string
  threadId: string
  turnId: string
}

export type ModelNotificationRecord = {
  method: 'model/rerouted' | 'model/verification'
  atIso: string
  threadId: string
  turnId: string
  fromModel: string
  toModel: string
  reason: string
  verificationCount: number
  verifications: string[]
}

export type WindowsSandboxNotificationRecord = {
  method: 'windows/worldWritableWarning' | 'windowsSandbox/setupCompleted'
  atIso: string
  mode: string
  success: boolean | null
  error: string
  samplePathCount: number
  extraCount: number
  failedScan: boolean | null
}

export type AppServerNotificationDiagnosticsSnapshot = {
  unknownNotificationCount: number
  recentUnknownNotifications: UnknownNotificationRecord[]
  recentModelNotifications: ModelNotificationRecord[]
  recentWindowsSandboxNotifications: WindowsSandboxNotificationRecord[]
}

type NotificationObservation = {
  method: string
  atIso: string
  threadId?: string
  turnId?: string
  params?: unknown
}

type AppServerNotificationDiagnosticsOptions = {
  maxRecentUnknown?: number
  maxRecentModelNotifications?: number
  maxRecentWindowsSandboxNotifications?: number
}

const KNOWN_NOTIFICATION_METHODS = new Set([
  'error',
  'item/completed',
  'item/delta',
  'item/started',
  'item/updated',
  'account/rateLimits/updated',
  'app/list/updated',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'model/rerouted',
  'model/verification',
  'server/request',
  'server/request/resolved',
  'skills/changed',
  'thread/completed',
  'thread/interrupted',
  'thread/name/updated',
  'thread/started',
  'thread/tokenUsage/updated',
  'turn/completed',
  'turn/interrupted',
  'turn/start',
  'turn/started',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
])

const THREAD_LIST_INVALIDATING_SUFFIXES = [
  '/archived',
  '/created',
  '/deleted',
  '/forked',
  '/moved',
  '/removed',
  '/unarchived',
]

export function isKnownAppServerNotificationMethod(method: string): boolean {
  if (KNOWN_NOTIFICATION_METHODS.has(method)) return true
  if (method.endsWith('/failed')) return true
  if (method.includes('error')) return true
  if (!method.startsWith('thread/')) return false
  return THREAD_LIST_INVALIDATING_SUFFIXES.some((suffix) => method.endsWith(suffix))
}

export class AppServerNotificationDiagnostics {
  private readonly maxRecentUnknown: number
  private readonly maxRecentModelNotifications: number
  private readonly maxRecentWindowsSandboxNotifications: number
  private readonly unknownByMethod = new Map<string, UnknownNotificationRecord>()
  private readonly recentModelNotifications: ModelNotificationRecord[] = []
  private readonly recentWindowsSandboxNotifications: WindowsSandboxNotificationRecord[] = []
  private unknownNotificationCount = 0

  constructor(options: AppServerNotificationDiagnosticsOptions = {}) {
    this.maxRecentUnknown = Math.max(1, Math.min(100, Math.floor(options.maxRecentUnknown ?? 20)))
    this.maxRecentModelNotifications = Math.max(1, Math.min(100, Math.floor(options.maxRecentModelNotifications ?? 20)))
    this.maxRecentWindowsSandboxNotifications = Math.max(
      1,
      Math.min(100, Math.floor(options.maxRecentWindowsSandboxNotifications ?? 20)),
    )
  }

  observe(observation: NotificationObservation): void {
    this.observeModelNotification(observation)
    this.observeWindowsSandboxNotification(observation)
    if (isKnownAppServerNotificationMethod(observation.method)) return

    this.unknownNotificationCount += 1
    const existing = this.unknownByMethod.get(observation.method)
    if (existing) {
      existing.count += 1
      existing.lastSeenAtIso = observation.atIso
      existing.threadId = normalizeOptionalId(observation.threadId) || existing.threadId
      existing.turnId = normalizeOptionalId(observation.turnId) || existing.turnId
      return
    }

    this.unknownByMethod.set(observation.method, {
      method: observation.method,
      count: 1,
      firstSeenAtIso: observation.atIso,
      lastSeenAtIso: observation.atIso,
      threadId: normalizeOptionalId(observation.threadId),
      turnId: normalizeOptionalId(observation.turnId),
    })

    if (this.unknownByMethod.size > this.maxRecentUnknown) {
      const oldest = Array.from(this.unknownByMethod.values())
        .sort((left, right) => left.lastSeenAtIso.localeCompare(right.lastSeenAtIso))[0]
      if (oldest) {
        this.unknownByMethod.delete(oldest.method)
      }
    }
  }

  snapshot(): AppServerNotificationDiagnosticsSnapshot {
    return {
      unknownNotificationCount: this.unknownNotificationCount,
      recentUnknownNotifications: Array.from(this.unknownByMethod.values())
        .sort((left, right) => right.lastSeenAtIso.localeCompare(left.lastSeenAtIso)),
      recentModelNotifications: [...this.recentModelNotifications],
      recentWindowsSandboxNotifications: [...this.recentWindowsSandboxNotifications],
    }
  }

  clear(): void {
    this.unknownByMethod.clear()
    this.recentModelNotifications.splice(0, this.recentModelNotifications.length)
    this.recentWindowsSandboxNotifications.splice(0, this.recentWindowsSandboxNotifications.length)
    this.unknownNotificationCount = 0
  }

  private observeModelNotification(observation: NotificationObservation): void {
    const record = createModelNotificationRecord(observation)
    if (!record) return
    this.recentModelNotifications.unshift(record)
    if (this.recentModelNotifications.length > this.maxRecentModelNotifications) {
      this.recentModelNotifications.splice(this.maxRecentModelNotifications)
    }
  }

  private observeWindowsSandboxNotification(observation: NotificationObservation): void {
    const record = createWindowsSandboxNotificationRecord(observation)
    if (!record) return
    this.recentWindowsSandboxNotifications.unshift(record)
    if (this.recentWindowsSandboxNotifications.length > this.maxRecentWindowsSandboxNotifications) {
      this.recentWindowsSandboxNotifications.splice(this.maxRecentWindowsSandboxNotifications)
    }
  }
}

function normalizeOptionalId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createModelNotificationRecord(observation: NotificationObservation): ModelNotificationRecord | null {
  if (observation.method !== 'model/rerouted' && observation.method !== 'model/verification') return null
  const params = asRecord(observation.params)
  if (observation.method === 'model/rerouted') {
    return {
      method: 'model/rerouted',
      atIso: observation.atIso,
      threadId: normalizeOptionalId(observation.threadId) || readString(params, 'threadId'),
      turnId: normalizeOptionalId(observation.turnId) || readString(params, 'turnId'),
      fromModel: readString(params, 'fromModel'),
      toModel: readString(params, 'toModel'),
      reason: readString(params, 'reason'),
      verificationCount: 0,
      verifications: [],
    }
  }

  const verifications = Array.isArray(params?.verifications)
    ? params.verifications
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5)
    : []
  return {
    method: 'model/verification',
    atIso: observation.atIso,
    threadId: normalizeOptionalId(observation.threadId) || readString(params, 'threadId'),
    turnId: normalizeOptionalId(observation.turnId) || readString(params, 'turnId'),
    fromModel: '',
    toModel: '',
    reason: '',
    verificationCount: Array.isArray(params?.verifications) ? params.verifications.length : 0,
    verifications,
  }
}

function createWindowsSandboxNotificationRecord(observation: NotificationObservation): WindowsSandboxNotificationRecord | null {
  if (observation.method !== 'windows/worldWritableWarning' && observation.method !== 'windowsSandbox/setupCompleted') {
    return null
  }
  const params = asRecord(observation.params)
  if (observation.method === 'windowsSandbox/setupCompleted') {
    return {
      method: 'windowsSandbox/setupCompleted',
      atIso: observation.atIso,
      mode: readString(params, 'mode'),
      success: typeof params?.success === 'boolean' ? params.success : null,
      error: readString(params, 'error'),
      samplePathCount: 0,
      extraCount: 0,
      failedScan: null,
    }
  }
  return {
    method: 'windows/worldWritableWarning',
    atIso: observation.atIso,
    mode: '',
    success: null,
    error: '',
    samplePathCount: Array.isArray(params?.samplePaths) ? params.samplePaths.length : 0,
    extraCount: readNumber(params, 'extraCount'),
    failedScan: typeof params?.failedScan === 'boolean' ? params.failedScan : null,
  }
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim().slice(0, 120) : ''
}

function readNumber(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
