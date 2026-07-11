export const NOTIFICATION_WEBSOCKET_MAX_BUFFERED_BYTES = 1024 * 1024
export const NOTIFICATION_WEBSOCKET_MAX_INBOUND_BYTES = 16 * 1024

export type NotificationWebSocket = {
  readyState: number
  bufferedAmount: number
  send: (data: string, callback?: (error?: Error) => void) => void
  terminate: () => void
}

export function sendBoundedWebSocketJson(
  socket: NotificationWebSocket,
  payload: unknown,
  maxBufferedBytes = NOTIFICATION_WEBSOCKET_MAX_BUFFERED_BYTES,
): boolean {
  if (socket.readyState !== 1) return false

  try {
    const serialized = JSON.stringify(payload)
    if (typeof serialized !== 'string') throw new Error('WebSocket payload is not serializable')
    if (socket.bufferedAmount + Buffer.byteLength(serialized) > maxBufferedBytes) {
      socket.terminate()
      return false
    }
    socket.send(serialized, (error) => {
      if (error) socket.terminate()
    })
    return true
  } catch {
    socket.terminate()
    return false
  }
}

export function subscribeBoundedWebSocketNotifications<T>(
  socket: NotificationWebSocket,
  subscribe: (listener: (value: T) => void) => () => void,
  maxBufferedBytes = NOTIFICATION_WEBSOCKET_MAX_BUFFERED_BYTES,
): () => void {
  let active = true
  let unsubscribe: (() => void) | null = null
  const stop = () => {
    if (!active) return
    active = false
    unsubscribe?.()
    unsubscribe = null
  }

  unsubscribe = subscribe((value) => {
    if (!active) return
    if (!sendBoundedWebSocketJson(socket, value, maxBufferedBytes)) {
      stop()
    }
  })
  if (!active) {
    unsubscribe()
    unsubscribe = null
  }
  return stop
}
