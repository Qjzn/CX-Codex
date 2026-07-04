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

export type HookNotificationRecord = {
  method: 'hook/started' | 'hook/completed'
  atIso: string
  threadId: string
  turnId: string
  runId: string
  eventName: string
  handlerType: string
  status: string
  durationMs: number | null
  source: string
  outputEntryCount: number
}

export type GuardianReviewNotificationRecord = {
  method: 'item/autoApprovalReview/started' | 'item/autoApprovalReview/completed'
  atIso: string
  threadId: string
  turnId: string
  reviewId: string
  targetItemId: string
  status: string
  riskLevel: string
  userAuthorization: string
  actionType: string
  decisionSource: string
  durationMs: number | null
  hasRationale: boolean
  actionArgCount: number
  actionFileCount: number
  permissionNetworkRequested: boolean
  permissionFileSystemRequested: boolean
}

export type ProtocolAlertNotificationRecord = {
  method:
    | 'warning'
    | 'guardianWarning'
    | 'deprecationNotice'
    | 'configWarning'
    | 'fs/changed'
    | 'externalAgentConfig/import/completed'
  atIso: string
  threadId: string
  summary: string
  details: string
  hasPath: boolean
  changedPathCount: number
  watchId: string
}

export type RealtimeNotificationRecord = {
  method:
    | 'thread/realtime/started'
    | 'thread/realtime/itemAdded'
    | 'thread/realtime/transcript/delta'
    | 'thread/realtime/transcript/done'
    | 'thread/realtime/outputAudio/delta'
    | 'thread/realtime/sdp'
    | 'thread/realtime/error'
    | 'thread/realtime/closed'
  atIso: string
  threadId: string
  itemId: string
  messageId: string
  eventCount: number
  byteCount: number
  errorCode: string
  errorMessage: string
}

export type RemoteControlNotificationRecord = {
  method: 'remoteControl/status/changed'
  atIso: string
  status: string
  environmentId: string
  hasEnvironmentId: boolean
}

export type AppServerNotificationDiagnosticsSnapshot = {
  unknownNotificationCount: number
  recentUnknownNotifications: UnknownNotificationRecord[]
  recentModelNotifications: ModelNotificationRecord[]
  recentWindowsSandboxNotifications: WindowsSandboxNotificationRecord[]
  recentHookNotifications: HookNotificationRecord[]
  recentGuardianReviewNotifications: GuardianReviewNotificationRecord[]
  recentProtocolAlerts: ProtocolAlertNotificationRecord[]
  recentRealtimeNotifications: RealtimeNotificationRecord[]
  recentRemoteControlNotifications: RemoteControlNotificationRecord[]
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
  maxRecentHookNotifications?: number
  maxRecentGuardianReviewNotifications?: number
  maxRecentProtocolAlerts?: number
  maxRecentRealtimeNotifications?: number
  maxRecentRemoteControlNotifications?: number
}

const REALTIME_NOTIFICATION_METHODS = new Set<RealtimeNotificationRecord['method']>([
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
])

const KNOWN_NOTIFICATION_METHODS = new Set([
  'error',
  'item/completed',
  'item/delta',
  'item/started',
  'item/updated',
  'account/rateLimits/updated',
  'app/list/updated',
  'configWarning',
  'deprecationNotice',
  'externalAgentConfig/import/completed',
  'fs/changed',
  'guardianWarning',
  'hook/completed',
  'hook/started',
  'item/autoApprovalReview/completed',
  'item/autoApprovalReview/started',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'model/rerouted',
  'model/verification',
  'remoteControl/status/changed',
  'server/request',
  'server/request/resolved',
  'skills/changed',
  'thread/completed',
  'thread/interrupted',
  'thread/name/updated',
  'thread/realtime/closed',
  'thread/realtime/error',
  'thread/realtime/itemAdded',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/started',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/started',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'turn/completed',
  'turn/interrupted',
  'turn/start',
  'turn/started',
  'warning',
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
  private readonly maxRecentHookNotifications: number
  private readonly maxRecentGuardianReviewNotifications: number
  private readonly maxRecentProtocolAlerts: number
  private readonly maxRecentRealtimeNotifications: number
  private readonly maxRecentRemoteControlNotifications: number
  private readonly unknownByMethod = new Map<string, UnknownNotificationRecord>()
  private readonly recentModelNotifications: ModelNotificationRecord[] = []
  private readonly recentWindowsSandboxNotifications: WindowsSandboxNotificationRecord[] = []
  private readonly recentHookNotifications: HookNotificationRecord[] = []
  private readonly recentGuardianReviewNotifications: GuardianReviewNotificationRecord[] = []
  private readonly recentProtocolAlerts: ProtocolAlertNotificationRecord[] = []
  private readonly recentRealtimeNotifications: RealtimeNotificationRecord[] = []
  private readonly recentRemoteControlNotifications: RemoteControlNotificationRecord[] = []
  private unknownNotificationCount = 0

  constructor(options: AppServerNotificationDiagnosticsOptions = {}) {
    this.maxRecentUnknown = Math.max(1, Math.min(100, Math.floor(options.maxRecentUnknown ?? 20)))
    this.maxRecentModelNotifications = Math.max(1, Math.min(100, Math.floor(options.maxRecentModelNotifications ?? 20)))
    this.maxRecentWindowsSandboxNotifications = Math.max(
      1,
      Math.min(100, Math.floor(options.maxRecentWindowsSandboxNotifications ?? 20)),
    )
    this.maxRecentHookNotifications = Math.max(1, Math.min(100, Math.floor(options.maxRecentHookNotifications ?? 20)))
    this.maxRecentGuardianReviewNotifications = Math.max(
      1,
      Math.min(100, Math.floor(options.maxRecentGuardianReviewNotifications ?? 20)),
    )
    this.maxRecentProtocolAlerts = Math.max(1, Math.min(100, Math.floor(options.maxRecentProtocolAlerts ?? 20)))
    this.maxRecentRealtimeNotifications = Math.max(
      1,
      Math.min(100, Math.floor(options.maxRecentRealtimeNotifications ?? 20)),
    )
    this.maxRecentRemoteControlNotifications = Math.max(
      1,
      Math.min(100, Math.floor(options.maxRecentRemoteControlNotifications ?? 20)),
    )
  }

  observe(observation: NotificationObservation): void {
    this.observeModelNotification(observation)
    this.observeWindowsSandboxNotification(observation)
    this.observeHookNotification(observation)
    this.observeGuardianReviewNotification(observation)
    this.observeProtocolAlertNotification(observation)
    this.observeRealtimeNotification(observation)
    this.observeRemoteControlNotification(observation)
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
      recentHookNotifications: [...this.recentHookNotifications],
      recentGuardianReviewNotifications: [...this.recentGuardianReviewNotifications],
      recentProtocolAlerts: [...this.recentProtocolAlerts],
      recentRealtimeNotifications: [...this.recentRealtimeNotifications],
      recentRemoteControlNotifications: [...this.recentRemoteControlNotifications],
    }
  }

  clear(): void {
    this.unknownByMethod.clear()
    this.recentModelNotifications.splice(0, this.recentModelNotifications.length)
    this.recentWindowsSandboxNotifications.splice(0, this.recentWindowsSandboxNotifications.length)
    this.recentHookNotifications.splice(0, this.recentHookNotifications.length)
    this.recentGuardianReviewNotifications.splice(0, this.recentGuardianReviewNotifications.length)
    this.recentProtocolAlerts.splice(0, this.recentProtocolAlerts.length)
    this.recentRealtimeNotifications.splice(0, this.recentRealtimeNotifications.length)
    this.recentRemoteControlNotifications.splice(0, this.recentRemoteControlNotifications.length)
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

  private observeHookNotification(observation: NotificationObservation): void {
    const record = createHookNotificationRecord(observation)
    if (!record) return
    this.recentHookNotifications.unshift(record)
    if (this.recentHookNotifications.length > this.maxRecentHookNotifications) {
      this.recentHookNotifications.splice(this.maxRecentHookNotifications)
    }
  }

  private observeGuardianReviewNotification(observation: NotificationObservation): void {
    const record = createGuardianReviewNotificationRecord(observation)
    if (!record) return
    this.recentGuardianReviewNotifications.unshift(record)
    if (this.recentGuardianReviewNotifications.length > this.maxRecentGuardianReviewNotifications) {
      this.recentGuardianReviewNotifications.splice(this.maxRecentGuardianReviewNotifications)
    }
  }

  private observeProtocolAlertNotification(observation: NotificationObservation): void {
    const record = createProtocolAlertNotificationRecord(observation)
    if (!record) return
    this.recentProtocolAlerts.unshift(record)
    if (this.recentProtocolAlerts.length > this.maxRecentProtocolAlerts) {
      this.recentProtocolAlerts.splice(this.maxRecentProtocolAlerts)
    }
  }

  private observeRealtimeNotification(observation: NotificationObservation): void {
    const record = createRealtimeNotificationRecord(observation)
    if (!record) return
    this.recentRealtimeNotifications.unshift(record)
    if (this.recentRealtimeNotifications.length > this.maxRecentRealtimeNotifications) {
      this.recentRealtimeNotifications.splice(this.maxRecentRealtimeNotifications)
    }
  }

  private observeRemoteControlNotification(observation: NotificationObservation): void {
    const record = createRemoteControlNotificationRecord(observation)
    if (!record) return
    this.recentRemoteControlNotifications.unshift(record)
    if (this.recentRemoteControlNotifications.length > this.maxRecentRemoteControlNotifications) {
      this.recentRemoteControlNotifications.splice(this.maxRecentRemoteControlNotifications)
    }
  }
}

function normalizeOptionalId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createGuardianReviewNotificationRecord(observation: NotificationObservation): GuardianReviewNotificationRecord | null {
  if (
    observation.method !== 'item/autoApprovalReview/started' &&
    observation.method !== 'item/autoApprovalReview/completed'
  ) {
    return null
  }

  const params = asRecord(observation.params)
  const review = asRecord(params?.review)
  const action = asRecord(params?.action)
  const permissions = asRecord(action?.permissions)
  const network = asRecord(permissions?.network)
  const fileSystem = asRecord(permissions?.fileSystem)
  const actionType = readString(action, 'type', 60)
  const startedAtMs = readNullableNumber(params, 'startedAtMs')
  const completedAtMs = readNullableNumber(params, 'completedAtMs')
  return {
    method: observation.method,
    atIso: observation.atIso,
    threadId: normalizeOptionalId(observation.threadId) || readString(params, 'threadId'),
    turnId: normalizeOptionalId(observation.turnId) || readString(params, 'turnId'),
    reviewId: readString(params, 'reviewId', 80),
    targetItemId: readString(params, 'targetItemId', 80),
    status: readString(review, 'status', 40),
    riskLevel: readString(review, 'riskLevel', 40),
    userAuthorization: readString(review, 'userAuthorization', 40),
    actionType,
    decisionSource: readString(params, 'decisionSource', 60),
    durationMs: typeof startedAtMs === 'number' && typeof completedAtMs === 'number' && completedAtMs >= startedAtMs
      ? completedAtMs - startedAtMs
      : null,
    hasRationale: readString(review, 'rationale', 1).length > 0,
    actionArgCount: Array.isArray(action?.argv) ? action.argv.length : 0,
    actionFileCount: Array.isArray(action?.files) ? action.files.length : 0,
    permissionNetworkRequested: actionType === 'networkAccess' || network !== null,
    permissionFileSystemRequested: actionType === 'applyPatch' || fileSystem !== null,
  }
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

function createHookNotificationRecord(observation: NotificationObservation): HookNotificationRecord | null {
  if (observation.method !== 'hook/started' && observation.method !== 'hook/completed') return null
  const params = asRecord(observation.params)
  const run = asRecord(params?.run)
  return {
    method: observation.method,
    atIso: observation.atIso,
    threadId: normalizeOptionalId(observation.threadId) || readString(params, 'threadId'),
    turnId: normalizeOptionalId(observation.turnId) || readString(params, 'turnId'),
    runId: readString(run, 'id'),
    eventName: readString(run, 'eventName'),
    handlerType: readString(run, 'handlerType'),
    status: readString(run, 'status'),
    durationMs: readNullableNumber(run, 'durationMs'),
    source: readString(run, 'source'),
    outputEntryCount: Array.isArray(run?.entries) ? run.entries.length : 0,
  }
}

function createProtocolAlertNotificationRecord(observation: NotificationObservation): ProtocolAlertNotificationRecord | null {
  if (
    observation.method !== 'warning' &&
    observation.method !== 'guardianWarning' &&
    observation.method !== 'deprecationNotice' &&
    observation.method !== 'configWarning' &&
    observation.method !== 'fs/changed' &&
    observation.method !== 'externalAgentConfig/import/completed'
  ) {
    return null
  }

  const params = asRecord(observation.params)
  if (observation.method === 'fs/changed') {
    return {
      method: 'fs/changed',
      atIso: observation.atIso,
      threadId: normalizeOptionalId(observation.threadId),
      summary: 'Filesystem watch changed',
      details: '',
      hasPath: Array.isArray(params?.changedPaths) && params.changedPaths.length > 0,
      changedPathCount: Array.isArray(params?.changedPaths) ? params.changedPaths.length : 0,
      watchId: readString(params, 'watchId', 48),
    }
  }

  if (observation.method === 'externalAgentConfig/import/completed') {
    return {
      method: 'externalAgentConfig/import/completed',
      atIso: observation.atIso,
      threadId: normalizeOptionalId(observation.threadId),
      summary: 'External agent config import completed',
      details: '',
      hasPath: false,
      changedPathCount: 0,
      watchId: '',
    }
  }

  const summary = observation.method === 'warning' || observation.method === 'guardianWarning'
    ? readString(params, 'message', 160)
    : readString(params, 'summary', 160)
  return {
    method: observation.method,
    atIso: observation.atIso,
    threadId: normalizeOptionalId(observation.threadId) || readString(params, 'threadId'),
    summary,
    details: readString(params, 'details', 160),
    hasPath: typeof params?.path === 'string' && params.path.trim().length > 0,
    changedPathCount: 0,
    watchId: '',
  }
}

function createRealtimeNotificationRecord(observation: NotificationObservation): RealtimeNotificationRecord | null {
  if (!REALTIME_NOTIFICATION_METHODS.has(observation.method as RealtimeNotificationRecord['method'])) return null
  const method = observation.method as RealtimeNotificationRecord['method']
  const params = asRecord(observation.params)
  const item = asRecord(params?.item)
  const audio = asRecord(params?.audio)
  const error = asRecord(params?.error)

  return {
    method,
    atIso: observation.atIso,
    threadId: normalizeOptionalId(observation.threadId)
      || readFirstString(params, ['threadId', 'thread_id']),
    itemId: readFirstString(params, ['itemId', 'item_id'])
      || readFirstString(audio, ['itemId', 'item_id'])
      || readFirstString(item, ['id', 'itemId', 'item_id']),
    messageId: readFirstString(params, ['messageId', 'message_id', 'id'])
      || readFirstString(item, ['messageId', 'message_id']),
    eventCount: readRealtimeEventCount(params, item),
    byteCount: readRealtimeByteCount(method, params, item, audio),
    errorCode: method === 'thread/realtime/error' ? readFirstString(params, ['code'], 80) || readFirstString(error, ['code'], 80) : '',
    errorMessage: method === 'thread/realtime/error'
      ? readFirstString(params, ['message'], 160) || readFirstString(error, ['message'], 160)
      : '',
  }
}

function createRemoteControlNotificationRecord(observation: NotificationObservation): RemoteControlNotificationRecord | null {
  if (observation.method !== 'remoteControl/status/changed') return null
  const params = asRecord(observation.params)
  const environmentId = readString(params, 'environmentId', 80)
  return {
    method: 'remoteControl/status/changed',
    atIso: observation.atIso,
    status: readString(params, 'status', 40),
    environmentId,
    hasEnvironmentId: environmentId.length > 0,
  }
}

function readString(record: Record<string, unknown> | null, key: string, maxLength = 120): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim().slice(0, Math.max(1, maxLength)) : ''
}

function readFirstString(record: Record<string, unknown> | null, keys: string[], maxLength = 120): string {
  for (const key of keys) {
    const value = readString(record, key, maxLength)
    if (value) return value
  }
  return ''
}

function readNumber(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function readNullableNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null
}

function readRealtimeEventCount(
  params: Record<string, unknown> | null,
  item: Record<string, unknown> | null,
): number {
  if (Array.isArray(params?.events)) return params.events.length
  if (Array.isArray(params?.items)) return params.items.length
  if (Array.isArray(item?.content)) return item.content.length
  if (Array.isArray(item?.events)) return item.events.length
  return 1
}

function readRealtimeByteCount(
  method: RealtimeNotificationRecord['method'],
  params: Record<string, unknown> | null,
  item: Record<string, unknown> | null,
  audio: Record<string, unknown> | null,
): number {
  if (method === 'thread/realtime/transcript/delta') return readStringByteCount(params, 'delta')
  if (method === 'thread/realtime/transcript/done') return readStringByteCount(params, 'text')
  if (method === 'thread/realtime/outputAudio/delta') return readStringByteCount(audio, 'data')
  if (method === 'thread/realtime/sdp') return readStringByteCount(params, 'sdp')
  if (method === 'thread/realtime/itemAdded') return byteLength(JSON.stringify(item ?? {}))
  return 0
}

function readStringByteCount(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key]
  return typeof value === 'string' ? byteLength(value) : 0
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
