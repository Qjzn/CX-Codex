import type { RpcNotification, RpcNotificationReplay } from '../api/codexRpcClient'

export type NotificationReplaySource = 'live' | 'replay'

export type NotificationReplayRecoveryResult = {
  completed: boolean
  cursor: number
  replayedCount: number
  snapshotRecovered: boolean
}

type NotificationReplayCoordinatorOptions = {
  initialCursor: number
  fetchPage: (afterSeq: number, limit: number) => Promise<RpcNotificationReplay>
  applyNotification: (notification: RpcNotification, source: NotificationReplaySource) => void
  recoverSnapshot: (signal: AbortSignal) => Promise<void>
  persistCursor: (cursor: number) => void
  onRecoveryError?: (error: unknown) => void
  pageSize?: number
  maxPages?: number
}

export type NotificationReplayCoordinator = {
  receiveLive: (notification: RpcNotification) => void
  recover: () => Promise<NotificationReplayRecoveryResult>
  stop: () => void
  getCursor: () => number
}

const DEFAULT_PAGE_SIZE = 200
const DEFAULT_MAX_PAGES = 32

export function createNotificationReplayCoordinator(
  options: NotificationReplayCoordinatorOptions,
): NotificationReplayCoordinator {
  const pageSize = normalizeBoundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, 1, 500)
  const maxPages = normalizeBoundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, 100)
  const bufferedLiveBySeq = new Map<number, RpcNotification>()
  let cursor = normalizeSequence(options.initialCursor)
  let generation = 0
  let stopped = false
  let recoveryPromise: Promise<NotificationReplayRecoveryResult> | null = null
  let activeRecoveryController: AbortController | null = null

  const persistCurrentCursor = (): void => {
    options.persistCursor(cursor)
  }

  const isCurrentRun = (runGeneration: number): boolean => {
    return !stopped && generation === runGeneration
  }

  const applyLiveNotification = (notification: RpcNotification, seq: number): void => {
    options.applyNotification(notification, 'live')
    cursor = seq
    persistCurrentCursor()
  }

  const bufferLiveNotification = (notification: RpcNotification, seq: number): void => {
    if (seq <= cursor) return
    bufferedLiveBySeq.set(seq, notification)
  }

  const flushBufferedLive = (): boolean => {
    if (bufferedLiveBySeq.size === 0) return true
    const ordered = [...bufferedLiveBySeq.entries()].sort(([left], [right]) => left - right)
    bufferedLiveBySeq.clear()
    let advanced = false

    for (let index = 0; index < ordered.length; index += 1) {
      const [seq, notification] = ordered[index]
      if (seq <= cursor) continue
      if (seq !== cursor + 1) {
        for (let remainingIndex = index; remainingIndex < ordered.length; remainingIndex += 1) {
          const [remainingSeq, remainingNotification] = ordered[remainingIndex]
          if (remainingSeq > cursor) {
            bufferedLiveBySeq.set(remainingSeq, remainingNotification)
          }
        }
        break
      }
      options.applyNotification(notification, 'live')
      cursor = seq
      advanced = true
    }

    if (advanced) persistCurrentCursor()
    return bufferedLiveBySeq.size === 0
  }

  const recoverFromSnapshot = async (
    highWater: number,
    runGeneration: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    await options.recoverSnapshot(signal)
    if (!isCurrentRun(runGeneration)) return false
    cursor = highWater
    persistCurrentCursor()
    return true
  }

  const performRecovery = async (
    runGeneration: number,
    signal: AbortSignal,
  ): Promise<NotificationReplayRecoveryResult> => {
    let replayedCount = 0
    let snapshotRecovered = false

    try {
      let page = await options.fetchPage(cursor, pageSize)
      if (!isCurrentRun(runGeneration)) {
        return { completed: false, cursor, replayedCount, snapshotRecovered }
      }

      let highWater = normalizeSequence(page.latestSeq)
      const oldestSeq = normalizeSequence(page.oldestSeq)
      const needsInitialSnapshot =
        cursor === 0 ||
        highWater < cursor ||
        (highWater > cursor && oldestSeq > cursor + 1)

      if (needsInitialSnapshot) {
        snapshotRecovered = await recoverFromSnapshot(highWater, runGeneration, signal)
      } else {
        let pageCount = 0
        while (cursor < highWater && isCurrentRun(runGeneration)) {
          pageCount += 1
          const pageLatestSeq = normalizeSequence(page.latestSeq)
          const pageOldestSeq = normalizeSequence(page.oldestSeq)

          if (pageLatestSeq < cursor || (pageLatestSeq > cursor && pageOldestSeq > cursor + 1)) {
            highWater = pageLatestSeq
            snapshotRecovered = await recoverFromSnapshot(highWater, runGeneration, signal)
            break
          }

          const orderedNotifications = readOrderedNotifications(page.notifications, cursor, highWater)
          let pageAdvanced = false
          let foundSequenceGap = false

          for (const notification of orderedNotifications) {
            const seq = readNotificationSequence(notification)
            if (seq === null || seq <= cursor) continue
            if (seq !== cursor + 1) {
              foundSequenceGap = true
              break
            }
            options.applyNotification(notification, 'replay')
            cursor = seq
            replayedCount += 1
            pageAdvanced = true
          }

          if (pageAdvanced) persistCurrentCursor()
          if (cursor >= highWater) break

          if (foundSequenceGap || !pageAdvanced || pageCount >= maxPages) {
            snapshotRecovered = await recoverFromSnapshot(highWater, runGeneration, signal)
            break
          }

          page = await options.fetchPage(cursor, pageSize)
          if (!isCurrentRun(runGeneration)) {
            return { completed: false, cursor, replayedCount, snapshotRecovered }
          }
        }
      }

      if (!isCurrentRun(runGeneration)) {
        return { completed: false, cursor, replayedCount, snapshotRecovered }
      }

      flushBufferedLive()
      return {
        completed: snapshotRecovered || cursor >= highWater,
        cursor,
        replayedCount,
        snapshotRecovered,
      }
    } catch (error) {
      if (isCurrentRun(runGeneration) && !signal.aborted) {
        options.onRecoveryError?.(error)
      }
      return { completed: false, cursor, replayedCount, snapshotRecovered }
    }
  }

  const recover = (): Promise<NotificationReplayRecoveryResult> => {
    if (stopped) {
      return Promise.resolve({
        completed: false,
        cursor,
        replayedCount: 0,
        snapshotRecovered: false,
      })
    }
    if (recoveryPromise) return recoveryPromise

    const runGeneration = generation
    const controller = new AbortController()
    activeRecoveryController = controller
    const currentPromise = performRecovery(runGeneration, controller.signal)
    recoveryPromise = currentPromise
    void currentPromise.then((result) => {
      if (recoveryPromise === currentPromise) {
        recoveryPromise = null
      }
      if (activeRecoveryController === controller) {
        activeRecoveryController = null
      }
      if (!stopped && result.completed && bufferedLiveBySeq.size > 0) {
        void recover()
      }
    })
    return currentPromise
  }

  const receiveLive = (notification: RpcNotification): void => {
    if (stopped) return
    const seq = readNotificationSequence(notification)
    if (seq === null) {
      options.applyNotification(notification, 'live')
      return
    }
    if (recoveryPromise) {
      bufferedLiveBySeq.set(seq, notification)
      return
    }
    if (seq <= cursor) return
    if (cursor === 0 || seq !== cursor + 1) {
      bufferLiveNotification(notification, seq)
      void recover()
      return
    }
    applyLiveNotification(notification, seq)
  }

  return {
    receiveLive,
    recover,
    stop: () => {
      stopped = true
      generation += 1
      activeRecoveryController?.abort()
      activeRecoveryController = null
      recoveryPromise = null
      bufferedLiveBySeq.clear()
    },
    getCursor: () => cursor,
  }
}

function readOrderedNotifications(
  notifications: RpcNotification[],
  afterSeq: number,
  highWater: number,
): RpcNotification[] {
  const bySeq = new Map<number, RpcNotification>()
  for (const notification of notifications) {
    const seq = readNotificationSequence(notification)
    if (seq === null || seq <= afterSeq || seq > highWater) continue
    bySeq.set(seq, notification)
  }
  return [...bySeq.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, notification]) => notification)
}

function readNotificationSequence(notification: RpcNotification): number | null {
  if (typeof notification.seq !== 'number' || !Number.isFinite(notification.seq)) return null
  return Math.max(0, Math.trunc(notification.seq))
}

function normalizeSequence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}
