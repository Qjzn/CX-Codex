import type { PendingServerRequest } from './pendingServerRequests.js'

export type RuntimeExecutionState =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'start_uncertain'
  | 'running'
  | 'waiting_permission'
  | 'stopping'
  | 'stop_uncertain'
  | 'completed_pending_sync'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'stopped'
  | 'sync_degraded'

export type RuntimeSnapshotSource = 'events' | 'thread-read' | 'cache' | 'unknown'

export type ThreadRuntimeSnapshot = {
  threadId: string
  executionState: RuntimeExecutionState
  inProgress: boolean
  activeTurnId: string
  activeItemId: string
  canStop: boolean
  stopRequested: boolean
  updatedAtIso: string
  lastEventSeq: number
  lastEventAtIso: string | null
  lastStartedAtIso: string | null
  lastCompletedAtIso: string | null
  lastError: string | null
  stale: boolean
  degradedReason: string | null
  source: RuntimeSnapshotSource
  threadRead: unknown
  messageState: 'fresh' | 'cached' | 'unavailable'
  pendingServerRequests: PendingServerRequest[]
  tokenUsage: unknown | null
}

export type RuntimeSnapshotOverlay = {
  threadRead?: unknown
  messageState?: ThreadRuntimeSnapshot['messageState']
  pendingServerRequests?: PendingServerRequest[]
  tokenUsage?: unknown | null
}

export type RuntimeNotificationEvent = {
  method: string
  params: unknown
  atIso: string
  seq: number
}

type ThreadRuntimeState = {
  threadId: string
  executionState: RuntimeExecutionState
  activeTurnId: string
  activeItemId: string
  stopRequested: boolean
  updatedAtIso: string
  lastEventSeq: number
  lastEventAtIso: string | null
  lastStartedAtIso: string | null
  lastCompletedAtIso: string | null
  lastError: string | null
  degradedReason: string | null
  source: RuntimeSnapshotSource
}

type RuntimeStateStoreReaders = {
  readThreadIdFromPayload: (payload: unknown) => string
  readTurnIdFromPayload: (payload: unknown) => string
  readItemIdFromPayload: (payload: unknown) => string
  readThreadInProgressFromThreadReadPayload: (payload: unknown) => boolean
  getErrorMessage: (payload: unknown, fallback: string) => string
}

export const RUNTIME_SNAPSHOT_STALE_MS = 90_000

export function isRuntimeActiveState(state: RuntimeExecutionState): boolean {
  return (
    state === 'queued'
    || state === 'starting'
    || state === 'start_uncertain'
    || state === 'running'
    || state === 'waiting_permission'
    || state === 'stopping'
    || state === 'stop_uncertain'
  )
}

function isRuntimeSettledState(state: RuntimeExecutionState): boolean {
  return (
    state === 'completed_pending_sync' ||
    state === 'completed' ||
    state === 'failed' ||
    state === 'interrupted' ||
    state === 'stopped' ||
    state === 'idle'
  )
}

function createInitialRuntimeState(threadId: string): ThreadRuntimeState {
  const nowIso = new Date().toISOString()
  return {
    threadId,
    executionState: 'idle',
    activeTurnId: '',
    activeItemId: '',
    stopRequested: false,
    updatedAtIso: nowIso,
    lastEventSeq: 0,
    lastEventAtIso: null,
    lastStartedAtIso: null,
    lastCompletedAtIso: null,
    lastError: null,
    degradedReason: null,
    source: 'unknown',
  }
}

export function toPersistableRuntimeSnapshot(snapshot: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot {
  return {
    ...snapshot,
    threadRead: null,
    pendingServerRequests: [],
    tokenUsage: null,
  }
}

export class RuntimeStateStore {
  private readonly stateByThreadId = new Map<string, ThreadRuntimeState>()
  private readonly staleMs: number

  constructor(private readonly readers: RuntimeStateStoreReaders, options: { staleMs?: number } = {}) {
    this.staleMs = options.staleMs ?? RUNTIME_SNAPSHOT_STALE_MS
  }

  private getMutable(threadId: string): ThreadRuntimeState {
    const normalizedThreadId = threadId.trim()
    const existing = this.stateByThreadId.get(normalizedThreadId)
    if (existing) return existing
    const created = createInitialRuntimeState(normalizedThreadId)
    this.stateByThreadId.set(normalizedThreadId, created)
    return created
  }

  private touch(
    threadId: string,
    patch: Partial<ThreadRuntimeState>,
    source: RuntimeSnapshotSource,
    event?: RuntimeNotificationEvent,
  ): ThreadRuntimeState {
    const state = this.getMutable(threadId)
    const atIso = event?.atIso ?? new Date().toISOString()
    Object.assign(state, patch, {
      source,
      updatedAtIso: patch.updatedAtIso ?? atIso,
      lastEventSeq: event?.seq ?? state.lastEventSeq,
      lastEventAtIso: event?.atIso ?? state.lastEventAtIso,
    })
    return state
  }

  markQueued(threadId: string): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'queued',
      stopRequested: false,
      degradedReason: null,
    }, 'events')
  }

  markStarting(threadId: string, turnId = ''): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'starting',
      activeTurnId: turnId,
      stopRequested: false,
      degradedReason: null,
      lastError: null,
    }, 'events')
  }

  markStartUncertain(threadId: string, lastError: string | null = null): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'start_uncertain',
      stopRequested: false,
      degradedReason: 'turn start requires verification',
      lastError,
    }, 'events')
  }

  markRunning(threadId: string, turnId = ''): void {
    if (!threadId.trim()) return
    const current = this.getMutable(threadId)
    this.touch(threadId, {
      executionState: 'running',
      activeTurnId: turnId || current.activeTurnId,
      stopRequested: false,
      degradedReason: null,
      lastError: null,
      lastStartedAtIso: current.lastStartedAtIso ?? new Date().toISOString(),
    }, 'events')
  }

  markStopping(threadId: string): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'stopping',
      stopRequested: true,
    }, 'events')
  }

  markStopUncertain(threadId: string, lastError: string | null = null): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'stop_uncertain',
      stopRequested: true,
      degradedReason: 'turn interrupt requires verification',
      lastError,
    }, 'events')
  }

  markInterrupted(threadId: string, lastError: string | null = null): void {
    if (!threadId.trim()) return
    this.touch(threadId, {
      executionState: 'interrupted',
      activeTurnId: '',
      activeItemId: '',
      stopRequested: false,
      lastCompletedAtIso: new Date().toISOString(),
      lastError,
      degradedReason: null,
    }, 'events')
  }

  observeEvent(event: RuntimeNotificationEvent): void {
    const threadId = this.readers.readThreadIdFromPayload(event.params)
    if (!threadId) return

    const method = event.method
    const turnId = this.readers.readTurnIdFromPayload(event.params)
    const itemId = this.readers.readItemIdFromPayload(event.params)

    if (method === 'turn/started' || method === 'turn/start' || method === 'thread/started') {
      this.touch(threadId, {
        executionState: 'running',
        activeTurnId: turnId,
        activeItemId: itemId,
        stopRequested: false,
        degradedReason: null,
        lastStartedAtIso: event.atIso,
        lastError: null,
      }, 'events', event)
      return
    }

    if (method === 'item/started' || method === 'item/delta' || method === 'item/updated') {
      const state = this.getMutable(threadId)
      if (!isRuntimeSettledState(state.executionState) || state.executionState === 'idle') {
        this.touch(threadId, {
          executionState: 'running',
          activeTurnId: turnId || state.activeTurnId,
          activeItemId: itemId || state.activeItemId,
          degradedReason: null,
        }, 'events', event)
      }
      return
    }

    if (method === 'server/request') {
      this.touch(threadId, {
        executionState: 'waiting_permission',
        activeTurnId: turnId,
        activeItemId: itemId,
        degradedReason: null,
      }, 'events', event)
      return
    }

    if (method === 'server/request/resolved') {
      this.touch(threadId, {
        executionState: 'running',
        stopRequested: false,
        degradedReason: null,
      }, 'events', event)
      return
    }

    if (method === 'turn/completed' || method === 'thread/completed') {
      this.touch(threadId, {
        executionState: 'completed_pending_sync',
        activeTurnId: '',
        activeItemId: '',
        stopRequested: false,
        lastCompletedAtIso: event.atIso,
        degradedReason: null,
      }, 'events', event)
      return
    }

    if (method === 'turn/interrupted' || method === 'thread/interrupted') {
      this.touch(threadId, {
        executionState: 'interrupted',
        activeTurnId: '',
        activeItemId: '',
        stopRequested: false,
        lastCompletedAtIso: event.atIso,
        degradedReason: null,
      }, 'events', event)
      return
    }

    if (method.includes('error') || method.endsWith('/failed')) {
      this.touch(threadId, {
        executionState: 'failed',
        activeTurnId: '',
        activeItemId: '',
        stopRequested: false,
        lastCompletedAtIso: event.atIso,
        lastError: this.readers.getErrorMessage(event.params, method),
      }, 'events', event)
    }
  }

  observeThreadRead(
    threadId: string,
    inProgress: boolean,
    activeTurnId: string,
    updatedAtIso: string,
    source: RuntimeSnapshotSource,
  ): void {
    if (!threadId.trim()) return
    const current = this.getMutable(threadId)
    const nextState: RuntimeExecutionState = inProgress
      ? (current.executionState === 'waiting_permission' ? 'waiting_permission' : 'running')
      : (isRuntimeActiveState(current.executionState) || current.executionState === 'completed_pending_sync')
        ? 'completed'
        : current.executionState === 'idle'
          ? 'completed'
          : current.executionState
    this.touch(threadId, {
      executionState: nextState,
      activeTurnId: activeTurnId || (inProgress ? current.activeTurnId : ''),
      activeItemId: inProgress ? current.activeItemId : '',
      stopRequested: inProgress ? current.stopRequested : false,
      updatedAtIso: updatedAtIso || new Date().toISOString(),
      lastCompletedAtIso: !inProgress && (isRuntimeActiveState(current.executionState) || current.executionState === 'completed_pending_sync')
        ? new Date().toISOString()
        : current.lastCompletedAtIso,
      degradedReason: null,
    }, source)
  }

  markDegraded(threadId: string, reason: string): void {
    if (!threadId.trim()) return
    const current = this.getMutable(threadId)
    this.touch(threadId, {
      executionState: current.executionState === 'idle' ? 'sync_degraded' : current.executionState,
      degradedReason: reason,
    }, current.source === 'unknown' ? 'unknown' : current.source)
  }

  snapshot(threadId: string, overlay: RuntimeSnapshotOverlay = {}): ThreadRuntimeSnapshot {
    const state = this.getMutable(threadId)
    const pendingServerRequests = overlay.pendingServerRequests ?? []
    const overlayThreadReadInProgress = overlay.threadRead
      ? this.readers.readThreadInProgressFromThreadReadPayload(overlay.threadRead)
      : false
    const rawExecutionState = pendingServerRequests.length > 0
      ? 'waiting_permission'
      : state.executionState
    const lastAt = state.lastEventAtIso ? Date.parse(state.lastEventAtIso) : 0
    const stale = lastAt > 0 && isRuntimeActiveState(rawExecutionState) && Date.now() - lastAt > this.staleMs
    const executionState =
      stale && pendingServerRequests.length === 0 && !overlayThreadReadInProgress
        ? 'sync_degraded'
        : rawExecutionState

    return {
      threadId: state.threadId,
      executionState,
      inProgress: isRuntimeActiveState(executionState),
      activeTurnId: state.activeTurnId,
      activeItemId: state.activeItemId,
      canStop: isRuntimeActiveState(executionState) && executionState !== 'start_uncertain' && executionState !== 'stop_uncertain' && !state.stopRequested,
      stopRequested: state.stopRequested,
      updatedAtIso: state.updatedAtIso,
      lastEventSeq: state.lastEventSeq,
      lastEventAtIso: state.lastEventAtIso,
      lastStartedAtIso: state.lastStartedAtIso,
      lastCompletedAtIso: state.lastCompletedAtIso,
      lastError: state.lastError,
      stale,
      degradedReason: state.degradedReason,
      source: state.source,
      threadRead: overlay.threadRead ?? null,
      messageState: overlay.messageState ?? 'unavailable',
      pendingServerRequests,
      tokenUsage: overlay.tokenUsage ?? null,
    }
  }

  snapshots(threadIds: string[], overlaysByThreadId: Map<string, RuntimeSnapshotOverlay> = new Map()): ThreadRuntimeSnapshot[] {
    return threadIds
      .map((threadId) => threadId.trim())
      .filter((threadId) => threadId.length > 0)
      .map((threadId) => this.snapshot(threadId, overlaysByThreadId.get(threadId) ?? {}))
  }
}
