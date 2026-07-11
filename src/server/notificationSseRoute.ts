import type { IncomingMessage, ServerResponse } from 'node:http'

import type { BridgeNotificationEvent } from './appServerRuntimeBridge.js'

export const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'
export const NOTIFICATION_SSE_MAX_BUFFERED_EVENTS = 256
export const NOTIFICATION_SSE_MAX_BUFFERED_BYTES = 512 * 1024
export const NOTIFICATION_SSE_MAX_EVENT_BYTES = 1024 * 1024

export type NotificationSseRouteDependencies = {
  latestSeq: number | (() => number)
  subscribeNotifications: (listener: (value: BridgeNotificationEvent) => void) => () => void
  heartbeatIntervalMs?: number
  nowIso?: () => string
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
  maxBufferedEvents?: number
  maxBufferedBytes?: number
  maxEventBytes?: number
}

export function handleNotificationSseRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: NotificationSseRouteDependencies,
): boolean {
  if (req.method !== 'GET' || url.pathname !== '/codex-api/events') {
    return false
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const setTimer = dependencies.setInterval ?? setInterval
  const clearTimer = dependencies.clearInterval ?? clearInterval
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString())
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 15000
  const maxBufferedEvents = normalizePositiveInteger(
    dependencies.maxBufferedEvents,
    NOTIFICATION_SSE_MAX_BUFFERED_EVENTS,
  )
  const maxBufferedBytes = normalizePositiveInteger(
    dependencies.maxBufferedBytes,
    NOTIFICATION_SSE_MAX_BUFFERED_BYTES,
  )
  const maxEventBytes = normalizePositiveInteger(
    dependencies.maxEventBytes,
    NOTIFICATION_SSE_MAX_EVENT_BYTES,
  )
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  let queuedChunks: Array<{ value: string; bytes: number }> = []
  let queuedBytes = 0
  let draining = false
  let closed = false

  function close(destroyResponse = false): void {
    if (closed) return
    closed = true
    if (keepAlive !== null) {
      clearTimer(keepAlive)
      keepAlive = null
    }
    unsubscribe?.()
    unsubscribe = null
    queuedChunks = []
    queuedBytes = 0
    res.off('drain', flushQueue)
    req.off('close', handleRequestClose)
    req.off('aborted', handleRequestClose)
    res.off('close', handleResponseClose)
    res.off('error', handleResponseError)
    if (destroyResponse) {
      if (!res.destroyed) res.destroy()
    } else if (!res.writableEnded && !res.destroyed) {
      res.end()
    }
  }

  function handleRequestClose(): void {
    close()
  }

  function handleResponseClose(): void {
    close()
  }

  function handleResponseError(): void {
    close(true)
  }

  function flushQueue(): void {
    if (closed || res.writableEnded || res.destroyed) {
      close()
      return
    }
    draining = false
    while (queuedChunks.length > 0) {
      const next = queuedChunks.shift()
      if (!next) break
      queuedBytes -= next.bytes
      try {
        if (!res.write(next.value)) {
          draining = true
          res.once('drain', flushQueue)
          return
        }
      } catch {
        close(true)
        return
      }
    }
  }

  function writeSse(chunk: string, options: { dropWhileDraining?: boolean } = {}): boolean {
    if (closed || res.writableEnded || res.destroyed) return false
    const bytes = Buffer.byteLength(chunk)
    if (bytes > maxEventBytes) {
      close(true)
      return false
    }
    if (draining) {
      if (options.dropWhileDraining === true) return true
      if (
        queuedChunks.length >= maxBufferedEvents ||
        queuedBytes + bytes > maxBufferedBytes
      ) {
        close(true)
        return false
      }
      queuedChunks.push({ value: chunk, bytes })
      queuedBytes += bytes
      return true
    }
    try {
      if (!res.write(chunk)) {
        draining = true
        res.once('drain', flushQueue)
      }
      return true
    } catch {
      close(true)
      return false
    }
  }

  req.on('close', handleRequestClose)
  req.on('aborted', handleRequestClose)
  res.on('close', handleResponseClose)
  res.on('error', handleResponseError)
  const nextUnsubscribe = dependencies.subscribeNotifications((notification) => {
    writeSse(`data: ${JSON.stringify(notification)}\n\n`)
  })
  unsubscribe = nextUnsubscribe
  if (closed) {
    unsubscribe()
    unsubscribe = null
  }

  const latestSeq = typeof dependencies.latestSeq === 'function'
    ? dependencies.latestSeq()
    : dependencies.latestSeq
  writeSse(`event: ready\ndata: ${JSON.stringify({ ok: true, latestSeq })}\n\n`)
  if (!closed) keepAlive = setTimer(() => {
    writeSse(`data: ${JSON.stringify({
      method: BRIDGE_HEARTBEAT_METHOD,
      params: { ok: true },
      atIso: nowIso(),
    })}\n\n`, { dropWhileDraining: true })
  }, heartbeatIntervalMs)

  return true
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
