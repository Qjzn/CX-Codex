import type { IncomingMessage, ServerResponse } from 'node:http'

import type { BridgeNotificationEvent } from './appServerRuntimeBridge.js'

export const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'

export type NotificationSseRouteDependencies = {
  latestSeq: number | (() => number)
  subscribeNotifications: (listener: (value: BridgeNotificationEvent) => void) => () => void
  heartbeatIntervalMs?: number
  nowIso?: () => string
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
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
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const close = () => {
    if (keepAlive !== null) {
      clearTimer(keepAlive)
      keepAlive = null
    }
    unsubscribe?.()
    unsubscribe = null
    if (!res.writableEnded) {
      res.end()
    }
  }
  const writeSse = (chunk: string): void => {
    if (res.writableEnded || res.destroyed) return
    try {
      res.write(chunk)
    } catch {
      close()
    }
  }

  unsubscribe = dependencies.subscribeNotifications((notification) => {
    writeSse(`data: ${JSON.stringify(notification)}\n\n`)
  })

  const latestSeq = typeof dependencies.latestSeq === 'function'
    ? dependencies.latestSeq()
    : dependencies.latestSeq
  writeSse(`event: ready\ndata: ${JSON.stringify({ ok: true, latestSeq })}\n\n`)
  keepAlive = setTimer(() => {
    writeSse(`data: ${JSON.stringify({
      method: BRIDGE_HEARTBEAT_METHOD,
      params: { ok: true },
      atIso: nowIso(),
    })}\n\n`)
  }, heartbeatIntervalMs)

  req.on('close', close)
  req.on('aborted', close)
  return true
}
