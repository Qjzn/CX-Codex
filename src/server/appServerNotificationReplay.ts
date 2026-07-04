import {
  normalizeRuntimeEventForReplay,
  type BridgeNotificationEvent,
} from './appServerRuntimeBridge.js'

export const NOTIFICATION_REPLAY_BUFFER_LIMIT = 500

type AppServerNotification = {
  method: string
  params: unknown
}

type RuntimeEventLike = {
  seq: number
  method: string
  params: unknown
  atIso: string
}

type PersistedNotificationReplay = {
  notifications: RuntimeEventLike[]
  latestSeq: number
  oldestSeq: number
}

export type AppServerNotificationReplayAccessors = {
  rememberNotificationEvent: (notification: AppServerNotification) => BridgeNotificationEvent
  listNotificationEventsAfter: (afterSeq: number, limit?: number) => {
    notifications: BridgeNotificationEvent[]
    latestSeq: number
    oldestSeq: number
  }
}

export type AppServerNotificationReplayOptions = {
  initialSeq: number
  appendEvent: (event: RuntimeEventLike & { threadId: string; turnId: string }) => void
  listEventsAfter: (afterSeq: number, limit: number) => PersistedNotificationReplay
  observeNotification: (observation: {
    method: string
    atIso: string
    threadId?: string
    turnId?: string
    params?: unknown
  }) => void
  readThreadIdFromPayload: (payload: unknown) => string
  readTurnIdFromPayload: (payload: unknown) => string
  nowIso?: () => string
  bufferLimit?: number
}

export type AppServerNotificationReplayBundle = AppServerNotificationReplayAccessors & {
  notificationReplay: AppServerNotificationReplay
}

export class AppServerNotificationReplay {
  private seq: number
  private readonly buffer: BridgeNotificationEvent[] = []
  private readonly appendEvent: AppServerNotificationReplayOptions['appendEvent']
  private readonly listEventsAfter: AppServerNotificationReplayOptions['listEventsAfter']
  private readonly observeNotification: AppServerNotificationReplayOptions['observeNotification']
  private readonly readThreadIdFromPayload: AppServerNotificationReplayOptions['readThreadIdFromPayload']
  private readonly readTurnIdFromPayload: AppServerNotificationReplayOptions['readTurnIdFromPayload']
  private readonly nowIso: () => string
  private readonly bufferLimit: number

  constructor(options: AppServerNotificationReplayOptions) {
    this.seq = Number.isFinite(options.initialSeq) ? Math.max(0, Math.trunc(options.initialSeq)) : 0
    this.appendEvent = options.appendEvent
    this.listEventsAfter = options.listEventsAfter
    this.observeNotification = options.observeNotification
    this.readThreadIdFromPayload = options.readThreadIdFromPayload
    this.readTurnIdFromPayload = options.readTurnIdFromPayload
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.bufferLimit = Math.max(1, Math.min(Math.trunc(options.bufferLimit ?? NOTIFICATION_REPLAY_BUFFER_LIMIT), 10_000))
  }

  get latestSeq(): number {
    return this.seq
  }

  remember(notification: AppServerNotification): BridgeNotificationEvent {
    this.seq += 1
    const threadId = this.readThreadIdFromPayload(notification.params)
    const turnId = this.readTurnIdFromPayload(notification.params)
    const event: BridgeNotificationEvent = {
      method: notification.method,
      params: notification.params,
      atIso: this.nowIso(),
      seq: this.seq,
    }
    this.observeNotification({
      method: event.method,
      atIso: event.atIso,
      threadId,
      turnId,
      params: event.params,
    })
    this.appendEvent({
      seq: event.seq,
      method: event.method,
      params: event.params,
      atIso: event.atIso,
      threadId,
      turnId,
    })
    this.buffer.push(event)
    if (this.buffer.length > this.bufferLimit) {
      this.buffer.splice(0, this.buffer.length - this.bufferLimit)
    }
    return event
  }

  listAfter(afterSeq: number, limit = 200): {
    notifications: BridgeNotificationEvent[]
    latestSeq: number
    oldestSeq: number
  } {
    const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.trunc(afterSeq)) : 0
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), this.bufferLimit)) : 200
    const persistedReplay = this.listEventsAfter(normalizedAfterSeq, normalizedLimit)
    if (persistedReplay.notifications.length > 0 || normalizedAfterSeq < persistedReplay.latestSeq) {
      return {
        notifications: persistedReplay.notifications.map(normalizeRuntimeEventForReplay),
        latestSeq: persistedReplay.latestSeq,
        oldestSeq: persistedReplay.oldestSeq,
      }
    }
    return {
      notifications: this.buffer
        .filter((notification) => notification.seq > normalizedAfterSeq)
        .slice(0, normalizedLimit),
      latestSeq: this.seq,
      oldestSeq: this.buffer[0]?.seq ?? this.seq,
    }
  }
}

export function createAppServerNotificationReplayAccessors(
  replay: AppServerNotificationReplay,
): AppServerNotificationReplayAccessors {
  return {
    rememberNotificationEvent: (notification) => replay.remember(notification),
    listNotificationEventsAfter: (afterSeq, limit = 200) => replay.listAfter(afterSeq, limit),
  }
}

export function createAppServerNotificationReplayBundle(
  options: AppServerNotificationReplayOptions,
): AppServerNotificationReplayBundle {
  const notificationReplay = new AppServerNotificationReplay(options)
  return {
    notificationReplay,
    ...createAppServerNotificationReplayAccessors(notificationReplay),
  }
}
