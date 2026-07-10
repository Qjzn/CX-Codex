import type { RpcEnvelope, RpcMethodCatalog } from '../types/codex'
import { CodexApiError, extractErrorMessage, isAbortLikeError } from './codexErrors'
import { shouldAutoLoginForResponse, tryMobileShellAutoLogin } from '../mobile/mobileAuth'

type RpcRequestBody = {
  method: string
  params?: unknown
}

export type RpcNotification = {
  method: string
  params: unknown
  atIso: string
  seq?: number
}

export type RpcNotificationReplay = {
  notifications: RpcNotification[]
  latestSeq: number
  oldestSeq: number
}

export type RpcConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
type RpcRequestOptions = { signal?: AbortSignal }

type ServerRequestReplyBody = {
  id: number
  result?: unknown
  error?: {
    code?: number
    message: string
  }
}

const WS_OPEN_TIMEOUT_MS = 2500
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 8000
const TRANSPORT_STALE_CHECK_MS = 15000
const TRANSPORT_STALE_MS = 45000
const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'
const RPC_FETCH_TIMEOUT_MS = 20000
const RPC_INTERACTIVE_FETCH_TIMEOUT_MS = 90000
const RPC_LONG_FETCH_TIMEOUT_MS = 75000
const RPC_LIST_FETCH_TIMEOUT_MS = 15000
const RPC_LIGHT_READ_FETCH_TIMEOUT_MS = 40000
const META_FETCH_TIMEOUT_MS = 12000
const SERVER_REQUEST_FETCH_TIMEOUT_MS = 15000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getRpcFetchTimeoutMs(method: string, params: unknown): number {
  if (method === 'turn/start') return RPC_INTERACTIVE_FETCH_TIMEOUT_MS
  if (method === 'turn/interrupt') return RPC_LONG_FETCH_TIMEOUT_MS
  if (method === 'thread/start' || method === 'thread/resume') return RPC_LONG_FETCH_TIMEOUT_MS
  if (method === 'thread/fork' || method === 'thread/rollback') return RPC_LONG_FETCH_TIMEOUT_MS
  if (method === 'thread/read') {
    return asRecord(params)?.includeTurns === true
      ? RPC_LONG_FETCH_TIMEOUT_MS
      : RPC_LIGHT_READ_FETCH_TIMEOUT_MS
  }
  if (method === 'thread/list') return RPC_LIST_FETCH_TIMEOUT_MS
  if (method === 'skills/list') return RPC_LIGHT_READ_FETCH_TIMEOUT_MS
  if (method === 'account/rateLimits/read') return RPC_LIGHT_READ_FETCH_TIMEOUT_MS
  return RPC_FETCH_TIMEOUT_MS
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = RPC_FETCH_TIMEOUT_MS,
  timeoutLabel = 'Request',
): Promise<Response> {
  const controller = new AbortController()
  const upstreamSignal = init.signal
  let didTimeout = false
  const timeoutId = window.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)

  const abortFromUpstream = (): void => {
    controller.abort()
  }

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      window.clearTimeout(timeoutId)
      controller.abort()
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true })
    }
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    if (shouldAutoLoginForResponse(response) && await tryMobileShellAutoLogin()) {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      })
    }
    return response
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === 'AbortError' && !upstreamSignal?.aborted)) {
      throw new CodexApiError(`${timeoutLabel} timed out after ${Math.ceil(timeoutMs / 1000)}s`, {
        code: 'network_error',
      })
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}

export async function rpcCall<T>(method: string, params?: unknown, options: RpcRequestOptions = {}): Promise<T> {
  const body: RpcRequestBody = { method, params: params ?? null }
  const timeoutMs = getRpcFetchTimeoutMs(method, params ?? null)

  let response: Response
  try {
    response = await fetchWithTimeout('/codex-api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    }, timeoutMs, `RPC ${method}`)
  } catch (error) {
    if (error instanceof CodexApiError || isAbortLikeError(error)) {
      throw error
    }
    throw new CodexApiError(
      error instanceof Error ? error.message : `RPC ${method} failed before request was sent`,
      { code: 'network_error', method },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `RPC ${method} failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method,
        status: response.status,
      },
    )
  }

  const envelope = payload as RpcEnvelope<T> | null
  if (!envelope || typeof envelope !== 'object' || !('result' in envelope)) {
    throw new CodexApiError(`RPC ${method} returned malformed envelope`, {
      code: 'invalid_response',
      method,
      status: response.status,
    })
  }
  return envelope.result
}

export async function fetchRpcMethodCatalog(): Promise<string[]> {
  const response = await fetchWithTimeout('/codex-api/meta/methods', {}, META_FETCH_TIMEOUT_MS, 'Method catalog request')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Method catalog failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'meta/methods',
        status: response.status,
      },
    )
  }

  const catalog = payload as RpcMethodCatalog
  return Array.isArray(catalog.data) ? catalog.data : []
}

export async function fetchRpcNotificationCatalog(): Promise<string[]> {
  const response = await fetchWithTimeout('/codex-api/meta/notifications', {}, META_FETCH_TIMEOUT_MS, 'Notification catalog request')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Notification catalog failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'meta/notifications',
        status: response.status,
      },
    )
  }

  const catalog = payload as RpcMethodCatalog
  return Array.isArray(catalog.data) ? catalog.data : []
}

function toNotification(value: unknown): RpcNotification | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.method !== 'string' || record.method.length === 0) return null

  const atIso = typeof record.atIso === 'string' && record.atIso.length > 0
    ? record.atIso
    : new Date().toISOString()

  return {
    method: record.method,
    params: record.params ?? null,
    atIso,
    seq: typeof record.seq === 'number' && Number.isFinite(record.seq) ? Math.max(0, Math.trunc(record.seq)) : undefined,
  }
}

export async function fetchRpcNotificationReplay(afterSeq: number, limit = 200): Promise<RpcNotificationReplay> {
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.trunc(afterSeq)) : 0
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 500)) : 200
  const response = await fetchWithTimeout(
    `/codex-api/events/replay?after=${encodeURIComponent(String(normalizedAfterSeq))}&limit=${encodeURIComponent(String(normalizedLimit))}`,
    {},
    META_FETCH_TIMEOUT_MS,
    'Notification replay request',
  )

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Notification replay failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'events/replay',
        status: response.status,
      },
    )
  }

  const record = asRecord(payload)
  const data = asRecord(record?.data)
  const rawNotifications = Array.isArray(data?.notifications) ? data.notifications : []
  return {
    notifications: rawNotifications
      .map((value) => toNotification(value))
      .filter((value): value is RpcNotification => value !== null),
    latestSeq: typeof data?.latestSeq === 'number' ? Math.max(0, Math.trunc(data.latestSeq)) : normalizedAfterSeq,
    oldestSeq: typeof data?.oldestSeq === 'number' ? Math.max(0, Math.trunc(data.oldestSeq)) : 0,
  }
}

export function subscribeRpcNotifications(
  onNotification: (value: RpcNotification) => void,
  options: { onConnectionStateChange?: (state: RpcConnectionState) => void } = {},
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  type Transport = 'ws' | 'sse'

  let cleanup: (() => void) | null = null
  let closed = false
  let reconnectTimer: number | null = null
  let reconnectAttempt = 0
  let activeAttempt = 0
  let hasEverConnected = false
  let authProbeInFlight = false
  let connectionState: RpcConnectionState = 'connecting'
  let transportWatchdogTimer: number | null = null
  let lastTransportActivityAtMs = Date.now()

  const preferredTransport = (): Transport => (typeof WebSocket !== 'undefined' ? 'ws' : 'sse')
  const transportIsStale = (): boolean => Date.now() - lastTransportActivityAtMs >= TRANSPORT_STALE_MS

  const setConnectionState = (nextState: RpcConnectionState) => {
    if (connectionState === nextState) return
    connectionState = nextState
    options.onConnectionStateChange?.(nextState)
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const clearTransportWatchdog = () => {
    if (transportWatchdogTimer !== null) {
      window.clearInterval(transportWatchdogTimer)
      transportWatchdogTimer = null
    }
  }

  const noteTransportActivity = () => {
    lastTransportActivityAtMs = Date.now()
  }

  const clearActiveTransport = () => {
    clearTransportWatchdog()
    const currentCleanup = cleanup
    cleanup = null
    currentCleanup?.()
  }

  const forceTransportReconnect = () => {
    if (closed) return
    activeAttempt += 1
    clearActiveTransport()
    scheduleReconnect(preferredTransport())
  }

  const recoverStaleForegroundTransport = () => {
    if (closed) return
    if (typeof document !== 'undefined' && document.hidden) return
    if (!hasEverConnected || !transportIsStale()) return
    forceTransportReconnect()
  }

  const startTransportWatchdog = () => {
    clearTransportWatchdog()
    transportWatchdogTimer = window.setInterval(() => {
      if (closed) {
        clearTransportWatchdog()
        return
      }
      if (typeof document !== 'undefined' && document.hidden) return
      if (!transportIsStale()) return
      forceTransportReconnect()
    }, TRANSPORT_STALE_CHECK_MS)
  }

  const probeAuthorization = () => {
    if (authProbeInFlight) return
    authProbeInFlight = true
    void fetchWithTimeout('/codex-api/meta/methods', {}, META_FETCH_TIMEOUT_MS, 'Authorization probe')
      .catch(() => {
        // The global fetch guard handles auth expiry redirects. Network failures can be ignored here.
      })
      .finally(() => {
        authProbeInFlight = false
      })
  }

  const isStaleAttempt = (attemptId: number): boolean => closed || attemptId !== activeAttempt

  const handleNotificationPayload = (payload: string): void => {
    try {
      const parsed = JSON.parse(payload) as unknown
      const notification = toNotification(parsed)
      if (notification) {
        if (notification.method === BRIDGE_HEARTBEAT_METHOD) {
          return
        }
        onNotification(notification)
      }
    } catch {
      // Ignore malformed event payloads and keep stream alive.
    }
  }

  const scheduleReconnect = (transport: Transport) => {
    if (closed || reconnectTimer !== null) return
    if (hasEverConnected) {
      probeAuthorization()
    }
    setConnectionState('reconnecting')
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * (2 ** Math.min(reconnectAttempt, 3)),
      RECONNECT_MAX_DELAY_MS,
    )
    reconnectAttempt += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect(transport)
    }, delay)
  }

  const attachSse = (attemptId: number) => {
    if (typeof EventSource === 'undefined' || isStaleAttempt(attemptId)) return
    const source = new EventSource('/codex-api/events')
    cleanup = () => source.close()

    source.onopen = () => {
      if (isStaleAttempt(attemptId)) return
      noteTransportActivity()
      hasEverConnected = true
      setConnectionState('connected')
      reconnectAttempt = 0
      startTransportWatchdog()
    }

    source.addEventListener('ready', () => {
      if (isStaleAttempt(attemptId)) return
      noteTransportActivity()
      hasEverConnected = true
      setConnectionState('connected')
      reconnectAttempt = 0
      startTransportWatchdog()
    })

    source.onmessage = (event) => {
      if (isStaleAttempt(attemptId)) return
      noteTransportActivity()
      handleNotificationPayload(event.data)
    }

    source.onerror = () => {
      if (isStaleAttempt(attemptId)) return
      setConnectionState('reconnecting')
      if (source.readyState !== EventSource.CLOSED) return
      source.close()
      scheduleReconnect(preferredTransport())
    }
  }

  const attachWebSocketTransport = (attemptId: number) => {
    if (typeof WebSocket === 'undefined') {
      attachSse(attemptId)
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/codex-api/ws`)
    let didOpen = false
    let fallbackTimer: number | null = window.setTimeout(() => {
      if (isStaleAttempt(attemptId) || didOpen) return
      if (socket.readyState < 2) {
        socket.close()
      }
      connect('sse')
    }, WS_OPEN_TIMEOUT_MS)

    const clearFallbackTimer = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
    }

    cleanup = () => {
      clearFallbackTimer()
      if (socket.readyState < 2) {
        socket.close()
      }
    }

    socket.onopen = () => {
      if (isStaleAttempt(attemptId)) {
        cleanup?.()
        return
      }
      noteTransportActivity()
      didOpen = true
      hasEverConnected = true
      setConnectionState('connected')
      reconnectAttempt = 0
      clearFallbackTimer()
      startTransportWatchdog()
    }

    socket.onmessage = (event) => {
      if (isStaleAttempt(attemptId)) return
      noteTransportActivity()
      handleNotificationPayload(String(event.data))
    }

    socket.onerror = () => {
      if (isStaleAttempt(attemptId)) return
      if (didOpen) {
        clearFallbackTimer()
        return
      }
      clearFallbackTimer()
      if (socket.readyState < 2) {
        socket.close()
      }
      connect('sse')
    }

    socket.onclose = () => {
      if (isStaleAttempt(attemptId)) return
      clearFallbackTimer()
      if (!didOpen) {
        connect('sse')
        return
      }
      scheduleReconnect('ws')
    }
  }

  const connect = (transport: Transport) => {
    if (closed) return
    clearReconnectTimer()
    activeAttempt += 1
    const attemptId = activeAttempt
    clearActiveTransport()
    noteTransportActivity()
    setConnectionState(hasEverConnected || reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    if (transport === 'ws') {
      attachWebSocketTransport(attemptId)
      return
    }

    attachSse(attemptId)
  }

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    recoverStaleForegroundTransport()
  }
  const onForegroundSignal = () => {
    recoverStaleForegroundTransport()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  window.addEventListener('focus', onForegroundSignal)
  window.addEventListener('pageshow', onForegroundSignal)
  window.addEventListener('online', onForegroundSignal)

  connect(preferredTransport())

  return () => {
    closed = true
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    window.removeEventListener('focus', onForegroundSignal)
    window.removeEventListener('pageshow', onForegroundSignal)
    window.removeEventListener('online', onForegroundSignal)
    clearReconnectTimer()
    clearTransportWatchdog()
    clearActiveTransport()
    setConnectionState('disconnected')
  }
}

export async function respondServerRequest(body: ServerRequestReplyBody): Promise<void> {
  let response: Response
  try {
    response = await fetchWithTimeout('/codex-api/server-requests/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, SERVER_REQUEST_FETCH_TIMEOUT_MS, 'Server request reply')
  } catch (error) {
    if (error instanceof CodexApiError) {
      throw error
    }
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Failed to reply to server request',
      { code: 'network_error', method: 'server-requests/respond' },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Server request reply failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/respond',
        status: response.status,
      },
    )
  }
}

export async function fetchPendingServerRequests(options: { signal?: AbortSignal } = {}): Promise<unknown[]> {
  const response = await fetchWithTimeout(
    '/codex-api/server-requests/pending',
    { signal: options.signal },
    SERVER_REQUEST_FETCH_TIMEOUT_MS,
    'Pending server requests',
  )

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Pending server requests failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/pending',
        status: response.status,
      },
    )
  }

  const record = asRecord(payload)
  const data = record?.data
  return Array.isArray(data) ? data : []
}
