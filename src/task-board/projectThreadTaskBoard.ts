import type { UiThread } from '../types/codex.js'

/**
 * K1-1 pure projection: thread -> four-column task board.
 *
 * Constraints (batch K1-1):
 * - Pure function. No Vue, no HTTP, no database, no Runtime executor, no clock, no module state.
 * - Reads only the already-filtered `threads` collection (G1 output boundary) plus minimal runtime
 *   snapshots supplied by the caller. Never fetches data, never re-filters by title or sourceKind,
 *   never mutates its input.
 * - The board never needs raw pending-server-request payloads: a lightweight count is enough.
 */

export type ThreadTaskBoardColumnId = 'pending' | 'running' | 'attention' | 'completed'

/**
 * Minimal runtime snapshot slice the board is allowed to consume.
 * Missing fields mean "unknown"; unknown execution states must stay visible, never be dropped.
 */
export type ThreadTaskBoardSnapshot = {
  threadId?: string
  executionState?: string | null
  inProgress?: boolean
  activeTurnId?: string | null
  updatedAtIso?: string | null
  lastEventSeq?: number | null
  stale?: boolean
  /**
   * Lightweight batch view: nonnegative finite integer count of currently pending server requests.
   * Any positive value means the thread is waiting for approval/input.
   */
  pendingServerRequestCount?: number | null
  /**
   * Retained only for compatibility with existing supplied snapshot shapes. The board reads at most
   * `length` of this list and never inspects request bodies.
   */
  pendingServerRequests?: unknown[] | null
}

export type ThreadTaskBoardSnapshots = Record<string, ThreadTaskBoardSnapshot | null | undefined>

export type ThreadTaskBoardProjectionInput = {
  threads: UiThread[]
  snapshotsByThreadId: ThreadTaskBoardSnapshots
  query?: string
  projectCwd?: string
}

export type ThreadTaskBoardCard = {
  threadId: string
  title: string
  projectName: string
  cwd: string
  stateLabel: string
  updatedAtIso: string
}

export type ThreadTaskBoardColumn = {
  id: ThreadTaskBoardColumnId
  title: string
  cards: ThreadTaskBoardCard[]
}

export type ThreadTaskBoardProjection = {
  columns: ThreadTaskBoardColumn[]
  total: number
}

export const THREAD_TASK_BOARD_COLUMNS: ReadonlyArray<{ id: ThreadTaskBoardColumnId; title: string }> = [
  { id: 'pending', title: '待处理' },
  { id: 'running', title: '执行中' },
  { id: 'attention', title: '需关注' },
  { id: 'completed', title: '已完成' },
]

/** Values of RuntimeExecutionState; anything else is an unknown state and stays visible. */
const KNOWN_EXECUTION_STATES = new Set<string>([
  'idle',
  'queued',
  'starting',
  'start_uncertain',
  'running',
  'waiting_permission',
  'stopping',
  'stop_uncertain',
  'completed_pending_sync',
  'completed',
  'failed',
  'interrupted',
  'stopped',
  'sync_degraded',
])

const STATE_LABELS = {
  unconfirmed: '状态未确认',
  pending: '待处理',
  running: '执行中',
  stopping: '停止中',
  waitingPermission: '等待审批',
  waitingInput: '等待输入',
  failed: '失败',
  interrupted: '中断',
  stopped: '已停止',
  startUncertain: '启动状态未知',
  stopUncertain: '停止状态未知',
  syncDegraded: '同步异常',
  pendingSync: '待同步',
  completed: '已完成',
} as const

type Classification = { column: ThreadTaskBoardColumnId; stateLabel: string }

function normalizeExecutionState(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Lightweight waiting signal. A positive, finite `pendingServerRequestCount` wins; the optional
 * legacy list is only measured by its length and never inspected.
 */
function readPendingServerRequestCount(snapshot: ThreadTaskBoardSnapshot | null | undefined): number {
  if (!snapshot) return 0
  const explicit = snapshot.pendingServerRequestCount
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit)
  }
  const legacy = snapshot.pendingServerRequests
  if (Array.isArray(legacy) && legacy.length > 0) return legacy.length
  return 0
}

function resolveUpdatedAtIso(thread: UiThread, snapshot: ThreadTaskBoardSnapshot | null | undefined): string {
  const fromSnapshot = snapshot ? snapshot.updatedAtIso : null
  if (typeof fromSnapshot === 'string' && fromSnapshot.length > 0) return fromSnapshot
  return thread.updatedAtIso
}

function classifyThread(thread: UiThread, snapshot: ThreadTaskBoardSnapshot | null | undefined): Classification {
  if (!snapshot) return { column: 'attention', stateLabel: STATE_LABELS.unconfirmed }

  // A nonempty supplied snapshot id must belong to this thread; another thread's snapshot is never
  // borrowed. A missing optional id stays compatible.
  const snapshotThreadId = typeof snapshot.threadId === 'string' ? snapshot.threadId.trim() : ''
  if (snapshotThreadId !== '' && snapshotThreadId !== thread.id) {
    return { column: 'attention', stateLabel: STATE_LABELS.unconfirmed }
  }

  const state = normalizeExecutionState(snapshot.executionState)
  if (state === '' || state === 'idle') {
    return { column: 'attention', stateLabel: STATE_LABELS.unconfirmed }
  }
  if (!KNOWN_EXECUTION_STATES.has(state)) {
    return { column: 'attention', stateLabel: STATE_LABELS.unconfirmed }
  }

  const stale = snapshot.stale === true
  const snapshotInProgress = snapshot.inProgress === true
  // Current thread facts are newer than an older completed snapshot and must not be overwritten.
  const threadInProgress = thread.inProgress === true
  const threadWaitingForInput = thread.waitingForInput === true
  const pendingServerRequestCount = readPendingServerRequestCount(snapshot)

  // A completed snapshot only counts as completed while nothing newer or unresolved contradicts it.
  if (state === 'completed') {
    if (pendingServerRequestCount > 0) return { column: 'attention', stateLabel: STATE_LABELS.waitingInput }
    if (threadWaitingForInput) return { column: 'attention', stateLabel: STATE_LABELS.waitingInput }
    if (snapshotInProgress || threadInProgress) {
      return { column: 'attention', stateLabel: STATE_LABELS.unconfirmed }
    }
    if (stale) return { column: 'attention', stateLabel: STATE_LABELS.pendingSync }
    return { column: 'completed', stateLabel: STATE_LABELS.completed }
  }

  if (state === 'completed_pending_sync') return { column: 'attention', stateLabel: STATE_LABELS.pendingSync }
  if (state === 'sync_degraded') return { column: 'attention', stateLabel: STATE_LABELS.syncDegraded }
  if (state === 'start_uncertain') return { column: 'attention', stateLabel: STATE_LABELS.startUncertain }
  if (state === 'stop_uncertain') return { column: 'attention', stateLabel: STATE_LABELS.stopUncertain }
  if (state === 'waiting_permission') return { column: 'attention', stateLabel: STATE_LABELS.waitingPermission }
  if (state === 'failed') return { column: 'attention', stateLabel: STATE_LABELS.failed }
  if (state === 'interrupted') return { column: 'attention', stateLabel: STATE_LABELS.interrupted }
  if (state === 'stopped') return { column: 'attention', stateLabel: STATE_LABELS.stopped }

  // Remaining known states: queued / starting / running / stopping. A current waiting-for-input fact
  // also keeps a thread out of the pending/running columns.
  if (threadWaitingForInput) return { column: 'attention', stateLabel: STATE_LABELS.waitingInput }
  if (pendingServerRequestCount > 0) return { column: 'attention', stateLabel: STATE_LABELS.waitingInput }
  if (stale) return { column: 'attention', stateLabel: STATE_LABELS.pendingSync }
  if (state === 'queued') return { column: 'pending', stateLabel: STATE_LABELS.pending }
  if (state === 'stopping') return { column: 'running', stateLabel: STATE_LABELS.stopping }
  return { column: 'running', stateLabel: STATE_LABELS.running }
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function matchesQuery(thread: UiThread, query: string): boolean {
  if (query === '') return true
  const title = typeof thread.title === 'string' ? thread.title.toLowerCase() : ''
  const projectName = typeof thread.projectName === 'string' ? thread.projectName.toLowerCase() : ''
  return title.includes(query) || projectName.includes(query)
}

function matchesProjectCwd(thread: UiThread, projectCwd: string): boolean {
  if (projectCwd === '') return true
  const cwd = typeof thread.cwd === 'string' ? thread.cwd : ''
  return normalizePathForCompare(cwd) === normalizePathForCompare(projectCwd)
}

/**
 * A snapshot that declares a different, nonempty threadId is not this thread's snapshot. Such a
 * snapshot is dropped once at the main-loop boundary so neither classification nor the timestamp can
 * be borrowed from another thread. A missing optional id stays compatible.
 */
function isForeignSnapshot(threadId: string, snapshot: ThreadTaskBoardSnapshot | null | undefined): boolean {
  if (!snapshot) return false
  const snapshotThreadId = typeof snapshot.threadId === 'string' ? snapshot.threadId.trim() : ''
  return snapshotThreadId !== '' && snapshotThreadId !== threadId
}

/**
 * Pure projection of the already-filtered thread list into the fixed four-column board.
 * Cards keep input order inside their column; `total` is the real number of visible cards.
 */
export function projectThreadTaskBoard(input: ThreadTaskBoardProjectionInput): ThreadTaskBoardProjection {
  const threads = Array.isArray(input.threads) ? input.threads : []
  const snapshotsByThreadId = input.snapshotsByThreadId || {}
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
  const projectCwd = typeof input.projectCwd === 'string' ? input.projectCwd.trim() : ''

  const cardsByColumn: Record<ThreadTaskBoardColumnId, ThreadTaskBoardCard[]> = {
    pending: [],
    running: [],
    attention: [],
    completed: [],
  }
  const seenThreadIds = new Set<string>()
  let total = 0

  for (const thread of threads) {
    if (!thread || typeof thread.id !== 'string' || thread.id === '') continue
    if (seenThreadIds.has(thread.id)) continue
    if (!matchesQuery(thread, query)) continue
    if (!matchesProjectCwd(thread, projectCwd)) continue
    seenThreadIds.add(thread.id)

    // Discard a foreign snapshot here: both the classification and the card timestamp must come from
    // this thread's own snapshot (or from the thread itself when no snapshot applies).
    const candidateSnapshot = snapshotsByThreadId[thread.id] || null
    const snapshot = isForeignSnapshot(thread.id, candidateSnapshot) ? null : candidateSnapshot
    const classification = classifyThread(thread, snapshot)
    cardsByColumn[classification.column].push({
      threadId: thread.id,
      title: thread.title,
      projectName: thread.projectName,
      cwd: thread.cwd,
      stateLabel: classification.stateLabel,
      updatedAtIso: resolveUpdatedAtIso(thread, snapshot),
    })
    total += 1
  }

  return {
    columns: THREAD_TASK_BOARD_COLUMNS.map((column) => ({
      id: column.id,
      title: column.title,
      cards: cardsByColumn[column.id],
    })),
    total,
  }
}
