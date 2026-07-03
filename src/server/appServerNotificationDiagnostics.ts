export type UnknownNotificationRecord = {
  method: string
  count: number
  firstSeenAtIso: string
  lastSeenAtIso: string
  threadId: string
  turnId: string
}

export type AppServerNotificationDiagnosticsSnapshot = {
  unknownNotificationCount: number
  recentUnknownNotifications: UnknownNotificationRecord[]
}

type NotificationObservation = {
  method: string
  atIso: string
  threadId?: string
  turnId?: string
}

type AppServerNotificationDiagnosticsOptions = {
  maxRecentUnknown?: number
}

const KNOWN_NOTIFICATION_METHODS = new Set([
  'error',
  'item/completed',
  'item/delta',
  'item/started',
  'item/updated',
  'server/request',
  'server/request/resolved',
  'thread/completed',
  'thread/interrupted',
  'thread/name/updated',
  'thread/started',
  'thread/tokenUsage/updated',
  'turn/completed',
  'turn/interrupted',
  'turn/start',
  'turn/started',
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
  private readonly unknownByMethod = new Map<string, UnknownNotificationRecord>()
  private unknownNotificationCount = 0

  constructor(options: AppServerNotificationDiagnosticsOptions = {}) {
    this.maxRecentUnknown = Math.max(1, Math.min(100, Math.floor(options.maxRecentUnknown ?? 20)))
  }

  observe(observation: NotificationObservation): void {
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
    }
  }

  clear(): void {
    this.unknownByMethod.clear()
    this.unknownNotificationCount = 0
  }
}

function normalizeOptionalId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}
