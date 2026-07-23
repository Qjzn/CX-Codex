import type { RpcConnectionState } from '../api/codexRpcClient'

export type ConnectionStreamHandlers = {
  onConnectionStateChange: (state: RpcConnectionState) => void
  onTransportActivity: () => void
}

export type ConnectionStreamSubscriber<TNotification> = (
  onNotification: (notification: TNotification) => void,
  handlers: ConnectionStreamHandlers,
) => () => void

type ConnectionManagerOptions<TNotification> = {
  subscribe: ConnectionStreamSubscriber<TNotification>
  onNotification: (notification: TNotification) => void
  onTransportActivity: () => void
  onConnectionStateChange: (
    state: RpcConnectionState,
    previousState: RpcConnectionState,
  ) => void
}

export type ConnectionManager = {
  start: () => void
  restart: () => void
  stop: () => void
  isStarted: () => boolean
  getState: () => RpcConnectionState
}

export type ConnectedRecoveryDecision =
  | { kind: 'none' }
  | { kind: 'replay' }
  | {
      kind: 'foreground'
      includeThreadList: boolean
      forceMessageRefresh: true
      urgent: true
    }

export type ConnectedRecoveryContext = {
  previousState: RpcConnectionState
  nextState: RpcConnectionState
  documentVisible: boolean
  androidShellAvailable: boolean
  hasSyncDemand: boolean
  activeThreadId: string
  suppressActiveThreadRecovery: boolean
  pendingThreadsRefresh: boolean
  hasLoadedThreads: boolean
}

export function createConnectionManager<TNotification>(
  options: ConnectionManagerOptions<TNotification>,
): ConnectionManager {
  let state: RpcConnectionState = 'disconnected'
  let generation = 0
  let started = false
  let stopStream: (() => void) | null = null

  const setState = (nextState: RpcConnectionState): void => {
    if (state === nextState) return
    const previousState = state
    state = nextState
    options.onConnectionStateChange(nextState, previousState)
  }

  const detachCurrentStream = (): void => {
    const stopCurrentStream = stopStream
    stopStream = null
    stopCurrentStream?.()
  }

  const open = (): void => {
    started = true
    generation += 1
    const currentGeneration = generation
    detachCurrentStream()
    setState('connecting')

    try {
      stopStream = options.subscribe(
        (notification) => {
          if (!started || generation !== currentGeneration) return
          options.onNotification(notification)
        },
        {
          onConnectionStateChange: (nextState) => {
            if (!started || generation !== currentGeneration) return
            setState(nextState)
          },
          onTransportActivity: () => {
            if (!started || generation !== currentGeneration) return
            options.onTransportActivity()
          },
        },
      )
    } catch (error) {
      if (generation === currentGeneration) {
        started = false
        setState('disconnected')
      }
      throw error
    }
  }

  return {
    start: () => {
      if (started) return
      open()
    },
    restart: open,
    stop: () => {
      if (!started && !stopStream) {
        setState('disconnected')
        return
      }
      started = false
      generation += 1
      detachCurrentStream()
      setState('disconnected')
    },
    isStarted: () => started,
    getState: () => state,
  }
}

export function shouldRestartNotificationStreamOnForeground(input: {
  connectionState: RpcConnectionState
  notificationStale: boolean
  hasSyncDemand: boolean
  hasSelectedThread: boolean
}): boolean {
  if (input.connectionState === 'reconnecting' || input.connectionState === 'disconnected') {
    return true
  }
  return (
    input.connectionState === 'connected' &&
    input.notificationStale &&
    (input.hasSyncDemand || input.hasSelectedThread)
  )
}

export function decideConnectedRecovery(
  context: ConnectedRecoveryContext,
): ConnectedRecoveryDecision {
  if (
    context.nextState !== 'connected' ||
    context.previousState === 'connected' ||
    !context.documentVisible
  ) {
    return { kind: 'none' }
  }

  if (context.androidShellAvailable) {
    if (context.activeThreadId && context.suppressActiveThreadRecovery) {
      return { kind: 'replay' }
    }
    return {
      kind: 'foreground',
      includeThreadList: context.pendingThreadsRefresh
        || (!context.activeThreadId && !context.hasLoadedThreads),
      forceMessageRefresh: true,
      urgent: true,
    }
  }

  if (!context.hasSyncDemand) {
    return { kind: 'replay' }
  }
  if (context.activeThreadId && context.suppressActiveThreadRecovery) {
    return { kind: 'replay' }
  }
  return {
    kind: 'foreground',
    includeThreadList: context.pendingThreadsRefresh || (!context.activeThreadId && !context.hasLoadedThreads),
    forceMessageRefresh: true,
    urgent: true,
  }
}
