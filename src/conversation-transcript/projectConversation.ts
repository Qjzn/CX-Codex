import type {
  ConversationActivity,
  ConversationActivityGroup,
  ConversationAssistantBlock,
  ConversationExecutionState,
  ConversationFileChange,
  ConversationGenericActivity,
  ConversationInteractionBlock,
  ConversationItemStatus,
  ConversationNotificationInput,
  ConversationPlanStep,
  ConversationProjection,
  ConversationProjectionInput,
  ConversationTurn,
  ConversationTurnBlock,
  ConversationUserBlock,
} from './types.js'
import { isTerminalConversationExecutionState } from './types.js'
import { deduplicateFileMentions, presentUserMessageText } from './userMessagePresentation.js'

const MAX_TEXT_LENGTH = 40_000
const MAX_OUTPUT_LENGTH = 24_000
const MAX_DIFF_LENGTH = 20_000
const MAX_PROGRESS_ENTRIES = 20
const stableItemProjectionCache = new WeakMap<UnknownRecord, {
  startedAtMs: number | null
  completedAtMs: number | null
  streamingText: string
  progressKey: string
  projection: ConversationTurnBlock | ConversationTurnBlock[] | null
}>()

type UnknownRecord = Record<string, unknown>

type MutableItem = {
  id: string
  raw: UnknownRecord
  startedAtMs: number | null
  completedAtMs: number | null
  streamingText: string
  progress: string[]
}

type MutableInteraction = {
  id: string
  requestId: number | string
  method: string
  params: unknown
  requestedAtMs: number | null
  resolvedAtMs: number | null
  status: 'pending' | 'resolved' | 'void'
  itemId: string
}

type MutableTurn = {
  id: string
  index: number
  rawStatus: string
  localOnly: boolean
  error: string
  startedAtMs: number | null
  completedAtMs: number | null
  itemOrder: string[]
  items: Map<string, MutableItem>
  interactions: Map<string, MutableInteraction>
}

type ProjectionState = {
  threadId: string
  turns: MutableTurn[]
  turnById: Map<string, MutableTurn>
  activeTurnId: string
}

export function projectConversation(input: ConversationProjectionInput): ConversationProjection {
  const state = readSnapshot(input.threadRead)
  applyNotifications(state, input.notifications ?? [])
  applyPendingRequests(state, input.pendingRequests ?? [], input.nowMs)
  applyRuntimeFacts(state, input.runtime ?? null)
  // A transport-only submission is not the previous runtime generation's turn.
  applyLocalUserMessages(state, input.localUserMessages ?? [])

  const history = readHistoryWindow(input.threadRead, state)

  return {
    threadId: state.threadId,
    turns: state.turns.map((turn) => projectTurn(turn, state, input)),
    history,
    sourceState: input.runtime?.messageState ?? (threadReadRoots(input.threadRead).length > 0 ? 'fresh' : 'unavailable'),
    generatedAtMs: input.nowMs,
  }
}

function readSnapshot(threadRead: unknown): ProjectionState {
  const roots = threadReadRoots(threadRead)
    .sort((first, second) => readThreadReadStartIndex(first) - readThreadReadStartIndex(second))
  let threadId = ''
  const turns: MutableTurn[] = []
  const turnById = new Map<string, MutableTurn>()

  for (const root of roots) {
    const thread = asRecord(root.thread)
    if (!thread) continue
    threadId ||= readString(thread.id)
    const rawTurns = Array.isArray(thread.turns) ? thread.turns : []
    const startIndex = readNonNegativeInteger(thread.turnsStartIndex) ?? 0
    for (let relativeIndex = 0; relativeIndex < rawTurns.length; relativeIndex += 1) {
      const rawTurn = asRecord(rawTurns[relativeIndex])
      if (!rawTurn) continue
      const index = startIndex + relativeIndex
      const id = readString(rawTurn.id) || `turn:${String(index)}`
      let turn = turnById.get(id)
      if (!turn) {
        turn = createTurn(id, index)
        turns.push(turn)
        turnById.set(id, turn)
      } else {
        turn.index = Math.min(turn.index, index)
      }
      turn.rawStatus = readString(rawTurn.status) || turn.rawStatus
      turn.error = readErrorMessage(rawTurn.error) || turn.error
      turn.startedAtMs = minTimestamp(
        turn.startedAtMs,
        readTimestampMs(rawTurn, ['startedAt', 'startedAtIso', 'createdAt', 'timestamp']),
      )
      turn.completedAtMs = maxTimestamp(
        turn.completedAtMs,
        readTimestampMs(rawTurn, ['completedAt', 'completedAtIso', 'finishedAt']),
      )
      const rawItems = Array.isArray(rawTurn.items) ? rawTurn.items : []
      for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex += 1) {
        const rawItem = asRecord(rawItems[itemIndex])
        if (!rawItem) continue
        const itemId = readString(rawItem.id) || `${id}:item:${String(itemIndex)}`
        upsertItem(turn, itemId, rawItem, {
          startedAtMs: readTimestampMs(rawItem, ['startedAt', 'startedAtIso', 'createdAt', 'timestamp']),
          completedAtMs: readTimestampMs(rawItem, ['completedAt', 'completedAtIso', 'finishedAt']),
        })
      }
    }
  }

  turns.sort((first, second) => first.index - second.index)
  return { threadId, turns, turnById, activeTurnId: '' }
}

function threadReadRoots(threadRead: unknown): UnknownRecord[] {
  const candidates = Array.isArray(threadRead) ? threadRead : [threadRead]
  return candidates
    .map((candidate) => asRecord(candidate))
    .filter((candidate): candidate is UnknownRecord => Boolean(asRecord(candidate?.thread)))
}

function readThreadReadStartIndex(root: UnknownRecord): number {
  const thread = asRecord(root.thread)
  return readNonNegativeInteger(thread?.turnsStartIndex) ?? 0
}

function readHistoryWindow(threadRead: unknown, state: ProjectionState): ConversationProjection['history'] {
  const roots = threadReadRoots(threadRead)
  if (roots.length === 0) {
    return { view: 'full', startIndex: 0, originalTurnCount: state.turns.length, hasOlder: false }
  }
  const startIndex = Math.min(...roots.map((root) => readThreadReadStartIndex(root)))
  const originalTurnCount = Math.max(
    startIndex + state.turns.length,
    ...roots.map((root) => {
      const thread = asRecord(root.thread)
      const turns = Array.isArray(thread?.turns) ? thread.turns.length : 0
      return Math.max(
        readThreadReadStartIndex(root) + turns,
        readNonNegativeInteger(thread?.originalTurnsCount) ?? 0,
      )
    }),
  )
  const hasOlder = startIndex > 0
  const singleView = roots.length === 1 ? readString(asRecord(roots[0]?.thread)?.turnsView) : ''
  const view = !hasOlder && state.turns.length >= originalTurnCount
    ? 'full'
    : singleView === 'older'
      ? 'older'
      : 'recent'
  return { view, startIndex, originalTurnCount, hasOlder }
}

function createTurn(id: string, index: number): MutableTurn {
  return {
    id,
    index,
    rawStatus: '',
    localOnly: false,
    error: '',
    startedAtMs: null,
    completedAtMs: null,
    itemOrder: [],
    items: new Map(),
    interactions: new Map(),
  }
}

function ensureTurn(state: ProjectionState, turnId: string): MutableTurn {
  const normalizedId = turnId.trim() || `turn:live:${String(state.turns.length)}`
  const existing = state.turnById.get(normalizedId)
  if (existing) return existing
  const nextIndex = (state.turns.at(-1)?.index ?? -1) + 1
  const turn = createTurn(normalizedId, nextIndex)
  state.turns.push(turn)
  state.turnById.set(normalizedId, turn)
  return turn
}

function upsertItem(
  turn: MutableTurn,
  itemId: string,
  raw: UnknownRecord,
  timing: { startedAtMs?: number | null; completedAtMs?: number | null } = {},
): MutableItem {
  const existing = turn.items.get(itemId)
  if (existing) {
    const nextText = readString(raw.text)
    existing.raw = {
      ...existing.raw,
      ...raw,
      ...(nextText || !existing.streamingText ? {} : { text: existing.streamingText }),
    }
    existing.startedAtMs = minTimestamp(existing.startedAtMs, timing.startedAtMs ?? null)
    existing.completedAtMs = maxTimestamp(existing.completedAtMs, timing.completedAtMs ?? null)
    if (nextText) existing.streamingText = boundText(nextText, MAX_TEXT_LENGTH)
    return existing
  }

  const created: MutableItem = {
    id: itemId,
    raw: readString(raw.id) === itemId ? raw : { ...raw, id: itemId },
    startedAtMs: timing.startedAtMs ?? null,
    completedAtMs: timing.completedAtMs ?? null,
    streamingText: boundText(readString(raw.text), MAX_TEXT_LENGTH),
    progress: [],
  }
  turn.items.set(itemId, created)
  turn.itemOrder.push(itemId)
  return created
}

function applyNotifications(state: ProjectionState, notifications: ConversationNotificationInput[]): void {
  const seen = new Set<string>()
  const ordered = notifications
    .map((notification, index) => ({ notification, index }))
    .filter(({ notification }) => {
      const identity = notificationIdentity(notification)
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .sort((first, second) => compareNotifications(first.notification, second.notification, first.index, second.index))

  for (const { notification } of ordered) {
    applyNotification(state, notification)
  }
}

function notificationIdentity(notification: ConversationNotificationInput): string {
  if (typeof notification.seq === 'number' && Number.isFinite(notification.seq)) {
    return `seq:${String(Math.trunc(notification.seq))}`
  }
  const params = asRecord(notification.params)
  const item = asRecord(params?.item)
  return [
    notification.method,
    notification.atIso,
    readString(params?.turnId) || readString(asRecord(params?.turn)?.id),
    readString(params?.itemId) || readString(item?.id),
    readRawString(params?.delta),
    readString(params?.message),
  ].join('\u0000')
}

function compareNotifications(
  first: ConversationNotificationInput,
  second: ConversationNotificationInput,
  firstIndex: number,
  secondIndex: number,
): number {
  const firstSeq = typeof first.seq === 'number' && Number.isFinite(first.seq) ? first.seq : null
  const secondSeq = typeof second.seq === 'number' && Number.isFinite(second.seq) ? second.seq : null
  if (firstSeq !== null && secondSeq !== null && firstSeq !== secondSeq) return firstSeq - secondSeq
  const firstAt = parseTimestamp(first.atIso)
  const secondAt = parseTimestamp(second.atIso)
  if (firstAt !== null && secondAt !== null && firstAt !== secondAt) return firstAt - secondAt
  return firstIndex - secondIndex
}

function applyNotification(state: ProjectionState, notification: ConversationNotificationInput): void {
  const params = asRecord(notification.params)
  const atMs = parseTimestamp(notification.atIso)
  const threadId = readThreadId(params)
  if (!state.threadId && threadId) state.threadId = threadId
  const turnId = readTurnId(params) || state.activeTurnId

  if (notification.method === 'thread/started') return

  if (notification.method === 'turn/started') {
    const id = turnId || `turn:live:${String(state.turns.length)}`
    const turn = ensureTurn(state, id)
    turn.rawStatus = 'inProgress'
    turn.startedAtMs = minTimestamp(turn.startedAtMs, readTurnTimestamp(params, 'startedAt') ?? atMs)
    state.activeTurnId = turn.id
    return
  }

  if (notification.method === 'turn/completed' || notification.method === 'thread/completed') {
    const turn = ensureTurn(state, turnId || state.turns.at(-1)?.id || '')
    const turnPayload = asRecord(params?.turn)
    turn.rawStatus = readString(turnPayload?.status) || (notification.method === 'turn/completed' ? 'completed' : turn.rawStatus)
    turn.error = readErrorMessage(turnPayload?.error) || turn.error
    turn.startedAtMs = minTimestamp(turn.startedAtMs, readTurnTimestamp(params, 'startedAt'))
    turn.completedAtMs = maxTimestamp(turn.completedAtMs, readTurnTimestamp(params, 'completedAt') ?? atMs)
    if (state.activeTurnId === turn.id) state.activeTurnId = ''
    return
  }

  if (notification.method === 'turn/interrupted' || notification.method === 'thread/interrupted') {
    const turn = ensureTurn(state, turnId || state.turns.at(-1)?.id || '')
    turn.rawStatus = 'interrupted'
    turn.completedAtMs = maxTimestamp(turn.completedAtMs, atMs)
    if (state.activeTurnId === turn.id) state.activeTurnId = ''
    return
  }

  if (notification.method === 'error' || notification.method.endsWith('/failed')) {
    const turn = ensureTurn(state, turnId || state.activeTurnId || state.turns.at(-1)?.id || '')
    turn.rawStatus = 'failed'
    turn.error = readString(params?.message) || readString(asRecord(params?.error)?.message) || turn.error
    turn.completedAtMs = maxTimestamp(turn.completedAtMs, atMs)
    return
  }

  if (notification.method === 'server/request') {
    applyServerRequest(state, notification)
    return
  }

  if (notification.method === 'server/request/resolved') {
    resolveServerRequest(state, notification)
    return
  }

  if (notification.method === 'turn/plan/updated') {
    const turn = ensureTurn(state, turnId)
    const itemId = `plan:${turn.id}`
    upsertItem(turn, itemId, {
      type: 'plan',
      id: itemId,
      explanation: readString(params?.explanation),
      plan: Array.isArray(params?.plan) ? params.plan : [],
      status: 'inProgress',
    }, { startedAtMs: atMs })
    return
  }

  const item = asRecord(params?.item)
  const itemId = readString(params?.itemId) || readString(item?.id)
  if (!turnId || !itemId) return
  const turn = ensureTurn(state, turnId)

  if (notification.method === 'item/started' && item) {
    upsertItem(turn, itemId, item, { startedAtMs: atMs })
    return
  }

  if (notification.method === 'item/completed' && item) {
    const mutable = upsertItem(turn, itemId, item, { completedAtMs: atMs })
    if (!mutable.startedAtMs) mutable.startedAtMs = atMs
    return
  }

  if (notification.method === 'item/agentMessage/delta') {
    const mutable = upsertItem(turn, itemId, { type: 'agentMessage', id: itemId }, { startedAtMs: atMs })
    mutable.streamingText = appendBounded(mutable.streamingText, readRawString(params?.delta), MAX_TEXT_LENGTH)
    mutable.raw.text = mutable.streamingText
    return
  }

  if (notification.method === 'item/plan/delta') {
    const mutable = upsertItem(turn, itemId, { type: 'plan', id: itemId, status: 'inProgress' }, { startedAtMs: atMs })
    const nextText = appendBounded(readRawString(mutable.raw.text), readRawString(params?.delta), MAX_TEXT_LENGTH)
    mutable.raw.text = nextText
    return
  }

  if (notification.method === 'item/commandExecution/outputDelta') {
    const mutable = upsertItem(turn, itemId, { type: 'commandExecution', id: itemId, status: 'inProgress' }, { startedAtMs: atMs })
    mutable.raw.aggregatedOutput = appendBounded(
      readRawString(mutable.raw.aggregatedOutput),
      readRawString(params?.delta),
      MAX_OUTPUT_LENGTH,
    )
    return
  }

  if (notification.method === 'item/fileChange/outputDelta' || notification.method === 'item/fileChange/patchUpdated') {
    const mutable = upsertItem(turn, itemId, { type: 'fileChange', id: itemId, status: 'inProgress', changes: [] }, { startedAtMs: atMs })
    mutable.raw.output = appendBounded(readRawString(mutable.raw.output), readRawString(params?.delta), MAX_OUTPUT_LENGTH)
    const changes = Array.isArray(params?.changes) ? params.changes : null
    if (changes) mutable.raw.changes = changes
    return
  }

  if (notification.method === 'item/mcpToolCall/progress') {
    const mutable = upsertItem(turn, itemId, { type: 'mcpToolCall', id: itemId, status: 'inProgress' }, { startedAtMs: atMs })
    const message = boundText(readString(params?.message), 2_000)
    if (message && mutable.progress.at(-1) !== message) {
      mutable.progress = [...mutable.progress, message].slice(-MAX_PROGRESS_ENTRIES)
    }
  }
}

function applyServerRequest(state: ProjectionState, notification: ConversationNotificationInput): void {
  const row = asRecord(notification.params)
  if (!row) return
  const requestParams = asRecord(row.params)
  const turnId = readString(requestParams?.turnId) || state.activeTurnId || state.turns.at(-1)?.id || ''
  const turn = ensureTurn(state, turnId)
  turn.rawStatus = 'waiting'
  const requestId = typeof row.id === 'number' || typeof row.id === 'string' ? row.id : `request:${turn.interactions.size}`
  const id = `request:${String(requestId)}`
  turn.interactions.set(id, {
    id,
    requestId,
    method: readString(row.method) || 'server/request',
    params: row.params ?? null,
    requestedAtMs: parseTimestamp(readString(row.receivedAtIso)) ?? parseTimestamp(notification.atIso),
    resolvedAtMs: null,
    status: 'pending',
    itemId: readString(requestParams?.itemId),
  })
}

function resolveServerRequest(state: ProjectionState, notification: ConversationNotificationInput): void {
  const row = asRecord(notification.params)
  if (!row) return
  const requestId = typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null
  if (requestId === null) return
  const id = `request:${String(requestId)}`
  for (const turn of state.turns) {
    const interaction = turn.interactions.get(id)
    if (!interaction) continue
    interaction.status = 'resolved'
    interaction.resolvedAtMs = parseTimestamp(readString(row.resolvedAtIso)) ?? parseTimestamp(notification.atIso)
    return
  }
}

function applyPendingRequests(state: ProjectionState, pendingRequests: unknown[], nowMs: number): void {
  for (const rawRequest of pendingRequests) {
    const row = asRecord(rawRequest)
    if (!row) continue
    const params = asRecord(row.params)
    const turnId = readString(row.turnId) || readString(params?.turnId) || state.activeTurnId || state.turns.at(-1)?.id || ''
    const turn = ensureTurn(state, turnId)
    turn.rawStatus = 'waiting'
    const requestId = typeof row.id === 'number' || typeof row.id === 'string' ? row.id : `pending:${turn.interactions.size}`
    const id = `request:${String(requestId)}`
    const existing = turn.interactions.get(id)
    if (existing?.status === 'resolved') continue
    turn.interactions.set(id, {
      id,
      requestId,
      method: readString(row.method) || 'server/request',
      params: row.params ?? null,
      requestedAtMs: parseTimestamp(readString(row.receivedAtIso)) ?? existing?.requestedAtMs ?? nowMs,
      resolvedAtMs: null,
      status: 'pending',
      itemId: readString(row.itemId) || readString(params?.itemId),
    })
  }
}

function applyLocalUserMessages(state: ProjectionState, messages: ProjectionInputLocalMessages): void {
  for (const message of messages) {
    if (!message.id.trim()) continue
    let turn = message.turnId ? state.turnById.get(message.turnId) : null
    if (!turn) {
      turn = ensureTurn(state, message.turnId || `local:${message.id}`)
      turn.localOnly = true
      turn.rawStatus = message.deliveryState === 'failed' ? 'failed' : 'submitting'
    }
    if (turn.items.has(message.id)) continue
    upsertItem(turn, message.id, {
      type: 'userMessage',
      id: message.id,
      content: [
        ...(message.text ? [{ type: 'text', text: message.text }] : []),
        ...(message.imageUrls ?? []).map((url) => ({ type: 'image', url })),
        ...(message.attachmentNames ?? []).map((name) => ({ type: 'mention', name, path: name })),
      ],
      clientMessageId: message.clientMessageId ?? '',
      deliveryState: message.deliveryState ?? null,
    }, { startedAtMs: message.createdAtMs ?? null })
  }
}

type ProjectionInputLocalMessages = NonNullable<ConversationProjectionInput['localUserMessages']>

function applyRuntimeFacts(state: ProjectionState, runtime: ConversationProjectionInput['runtime']): void {
  if (!runtime) return
  const activeTurnId = readString(runtime.activeTurnId)
  if (activeTurnId) {
    const runtimeStartedAtMs = parseTimestamp(runtime.lastStartedAtIso ?? '')
    const observedActiveTurn = state.turnById.get(state.activeTurnId)
    if (observedActiveTurn && observedActiveTurn.id !== activeTurnId && (
      runtimeStartedAtMs === null || (observedActiveTurn.startedAtMs !== null && observedActiveTurn.startedAtMs >= runtimeStartedAtMs)
    )) return
    const activeTurn = ensureTurn(state, activeTurnId)
    if (activeTurn.completedAtMs !== null || ['completed', 'failed', 'interrupted', 'stopped'].includes(activeTurn.rawStatus.toLowerCase())) return
    state.activeTurnId = activeTurnId
    const hasPendingInteraction = [...activeTurn.interactions.values()]
      .some((interaction) => interaction.status === 'pending')
    activeTurn.rawStatus = hasPendingInteraction || isWaitingRuntimeState(runtime.executionState)
      ? 'waiting'
      : 'inProgress'
    activeTurn.startedAtMs = minTimestamp(activeTurn.startedAtMs, runtimeStartedAtMs)
  }

  const lastTurn = state.turns.at(-1)
  if (!lastTurn) return
  if (!activeTurnId && isTerminalRuntimeState(runtime.executionState)) {
    const runtimeCompletedAtMs = parseTimestamp(runtime.lastCompletedAtIso ?? '')
    if (runtimeCompletedAtMs !== null && lastTurn.startedAtMs !== null && runtimeCompletedAtMs < lastTurn.startedAtMs) return
    const hasActiveEvidence = lastTurn.id === state.activeTurnId
      || ['inprogress', 'running', 'waiting'].includes(lastTurn.rawStatus.toLowerCase())
      || [...lastTurn.interactions.values()].some((interaction) => interaction.status === 'pending')
    if (hasActiveEvidence && (
      runtimeCompletedAtMs === null || lastTurn.startedAtMs === null
    )) return
    lastTurn.rawStatus = runtimeStateToTurnStatus(runtime.executionState, lastTurn.rawStatus)
    // Runtime reconciliation clocks may include time spent waiting for a fresh read.
    // Bound turn lifecycle timestamps are authoritative; runtime only fills gaps.
    lastTurn.completedAtMs ??= runtimeCompletedAtMs
    lastTurn.startedAtMs ??= parseTimestamp(runtime.lastStartedAtIso ?? '')
    if (runtime.lastError) lastTurn.error = runtime.lastError
  }
}

function projectTurn(
  turn: MutableTurn,
  state: ProjectionState,
  input: ConversationProjectionInput,
): ConversationTurn {
  const blocks: ConversationTurnBlock[] = []
  const activities: ConversationActivity[] = []
  const fileChangesByPath = new Map<string, ConversationFileChange>()
  const stateValue = resolveTurnState(turn, state, input)

  for (const itemId of turn.itemOrder) {
    const item = turn.items.get(itemId)
    if (!item) continue
    const rawProjection = projectItem(item, fileChangesByPath)
    const projected = stateValue === 'completed'
      ? settleCompletedTurnActivity(rawProjection)
      : rawProjection
    if (!projected) continue
    if (Array.isArray(projected)) {
      for (const block of projected) {
        blocks.push(block)
        if (block.kind === 'activity') activities.push(block)
      }
    } else {
      blocks.push(projected)
      if (projected.kind === 'activity') activities.push(projected)
    }
  }

  const interactions = Array.from(turn.interactions.values())
    .map((interaction) => projectInteraction(interaction))
    .sort((first, second) => compareNullableNumbers(first.requestedAtMs, second.requestedAtMs))
  for (const interaction of interactions) blocks.push(interaction)

  const completedAtMs = resolveCompletedAtMs(turn, stateValue)
  const startedAtMs = resolveStartedAtMs(turn)
  for (const interaction of interactions) {
    if (interaction.status === 'pending' && isTerminalConversationExecutionState(stateValue)) {
      interaction.status = 'void'
      interaction.resolvedAtMs = completedAtMs
    }
  }
  const waitedMs = calculateWaitedMs(interactions, startedAtMs, completedAtMs ?? input.nowMs)
  const terminalTimingUnavailable = isTerminalConversationExecutionState(stateValue) && completedAtMs === null
  const activeElapsedMs = startedAtMs === null || terminalTimingUnavailable
    ? null
    : Math.max(0, (completedAtMs ?? input.nowMs) - startedAtMs - waitedMs)

  const finals = blocks.filter((block): block is ConversationAssistantBlock => (
    block.kind === 'assistant' && block.phase === 'final'
  ))
  const projectedFinal = finals.length === 1 ? finals[0] ?? null : null
  const final = projectedFinal && isTerminalConversationExecutionState(stateValue) && projectedFinal.streaming
    ? { ...projectedFinal, streaming: false }
    : projectedFinal
  let error = turn.error
  if (finals.length > 1) {
    error = error || '检测到多个显式 final，无法确定唯一最终回复。'
    blocks.push({
      kind: 'notice',
      id: `${turn.id}:multiple-finals`,
      tone: 'danger',
      text: '检测到多个显式最终回复，已停止自动选择。',
      atMs: completedAtMs,
    })
  }
  const finalStatus = resolveFinalStatus(stateValue, final)

  const commentary = blocks.filter((block): block is ConversationAssistantBlock => (
    block.kind === 'assistant' && block.phase === 'commentary'
  ))
  const opener = blocks.find((block): block is ConversationUserBlock => block.kind === 'user') ?? null

  return {
    id: turn.id,
    index: turn.index,
    state: stateValue,
    startedAtMs,
    completedAtMs,
    activeElapsedMs,
    waitedMs,
    timingStatus: startedAtMs === null || terminalTimingUnavailable
      ? 'unavailable'
      : completedAtMs === null
        ? 'running'
        : 'complete',
    opener,
    blocks,
    commentary,
    activities,
    activityGroups: groupActivities(blocks),
    fileChanges: Array.from(fileChangesByPath.values()),
    interactions,
    final,
    finalStatus,
    error,
  }
}

function settleCompletedTurnActivity(
  projection: ConversationTurnBlock | ConversationTurnBlock[] | null,
): ConversationTurnBlock | ConversationTurnBlock[] | null {
  if (Array.isArray(projection)) {
    return projection.map((block) => settleCompletedTurnActivityBlock(block))
  }
  return projection ? settleCompletedTurnActivityBlock(projection) : null
}

function settleCompletedTurnActivityBlock(block: ConversationTurnBlock): ConversationTurnBlock {
  if (block.kind !== 'activity') return block
  // Native plan snapshots contain text but no item status. Retained plan/delta
  // events can leave them in-progress after the authoritative turn has ended.
  if (block.status !== 'pending' && !(block.activityType === 'plan' && block.status === 'in-progress')) return block
  return { ...block, status: 'completed' }
}

function projectItem(
  item: MutableItem,
  fileChangesByPath: Map<string, ConversationFileChange>,
): ConversationTurnBlock | ConversationTurnBlock[] | null {
  const type = readString(item.raw.type)
  const progressKey = item.progress.join('\u001f')
  if (type !== 'fileChange') {
    const cached = stableItemProjectionCache.get(item.raw)
    if (
      cached
      && cached.startedAtMs === item.startedAtMs
      && cached.completedAtMs === item.completedAtMs
      && cached.streamingText === item.streamingText
      && cached.progressKey === progressKey
    ) {
      return cached.projection
    }
  }

  let projection: ConversationTurnBlock | ConversationTurnBlock[] | null
  if (type === 'userMessage') projection = projectUserItem(item)
  else if (type === 'agentMessage') projection = projectAssistantItem(item)
  else if (type === 'commandExecution') projection = projectCommandItem(item)
  else if (type === 'mcpToolCall') projection = projectMcpItem(item)
  else if (type === 'dynamicToolCall') projection = projectDynamicToolItem(item)
  else if (type === 'webSearch') projection = projectSearchItem(item)
  else if (type === 'plan') projection = projectPlanItem(item)
  else if (type === 'fileChange') {
    mergeFileChanges(fileChangesByPath, item)
    return projectGenericActivity(item, 'file-change', '修改文件', '')
  }
  else if (type === 'reasoning') projection = projectGenericActivity(item, 'reasoning', '分析问题', '')
  else if (type === 'collabAgentToolCall') projection = projectCollaborationItem(item)
  else if (type === 'imageView') projection = projectGenericActivity(item, 'image-view', '查看图片', readString(item.raw.path))
  else if (type === 'imageGeneration') projection = projectGenericActivity(item, 'image-generation', '生成图片', readString(item.raw.savedPath))
  else if (type === 'enteredReviewMode' || type === 'exitedReviewMode') projection = projectGenericActivity(item, 'review', type === 'enteredReviewMode' ? '进入审查模式' : '退出审查模式', '')
  else if (type === 'contextCompaction') projection = projectGenericActivity(item, 'compaction', '整理上下文', '')
  else if (type === 'hookPrompt') projection = null
  else if (!type) projection = null
  else projection = projectGenericActivity(item, 'unknown', '执行活动', type)

  stableItemProjectionCache.set(item.raw, {
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    streamingText: item.streamingText,
    progressKey,
    projection,
  })
  return projection
}

function projectUserItem(item: MutableItem): ConversationUserBlock | null {
  const content = Array.isArray(item.raw.content) ? item.raw.content : []
  const text: string[] = []
  const images: string[] = []
  const skills: Array<{ name: string; path: string }> = []
  const mentions: Array<{ name: string; path: string }> = []
  for (const rawBlock of content) {
    const block = asRecord(rawBlock)
    if (!block) continue
    const type = readString(block.type)
    if (type === 'text') {
      const value = readRawString(block.text)
      if (value.trim()) text.push(value)
    } else if (type === 'image') {
      const value = readString(block.url)
      if (value) images.push(value)
    } else if (type === 'localImage') {
      const value = readString(block.path)
      if (value) images.push(value)
    } else if (type === 'skill') {
      skills.push({ name: readString(block.name), path: readString(block.path) })
    } else if (type === 'mention') {
      mentions.push({ name: readString(block.name), path: readString(block.path) })
    }
  }
  if (text.length === 0 && images.length === 0 && skills.length === 0 && mentions.length === 0) return null
  const presentation = presentUserMessageText(text.join('\n'))
  return {
    kind: 'user',
    id: item.id,
    text: boundText(presentation.mentions.length > 0
      ? presentation.text.trim()
      : text.map((chunk) => chunk.trim()).join('\n'), MAX_TEXT_LENGTH),
    atMs: item.startedAtMs,
    images,
    skills,
    mentions: deduplicateFileMentions([...mentions, ...presentation.mentions]),
    clientMessageId: readString(item.raw.clientMessageId) || null,
    deliveryState: readDeliveryState(item.raw.deliveryState),
  }
}

function projectAssistantItem(item: MutableItem): ConversationAssistantBlock | null {
  const text = boundText(readString(item.raw.text) || item.streamingText, MAX_TEXT_LENGTH)
  if (!text) return null
  return {
    kind: 'assistant',
    id: item.id,
    phase: readString(item.raw.phase) === 'final_answer' ? 'final' : 'commentary',
    text,
    atMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    streaming: item.completedAtMs === null,
  }
}

function projectCommandItem(item: MutableItem): ConversationActivity {
  const command = readString(item.raw.command)
  return {
    kind: 'activity',
    activityType: 'command',
    id: item.id,
    label: command ? '执行命令' : '执行操作',
    status: readItemStatus(item.raw.status, item.completedAtMs),
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    durationMs: readDurationMs(item),
    command,
    cwd: readString(item.raw.cwd),
    output: boundText(readString(item.raw.aggregatedOutput), MAX_OUTPUT_LENGTH),
    exitCode: readFiniteNumber(item.raw.exitCode),
  }
}

function projectMcpItem(item: MutableItem): ConversationActivity {
  const server = readString(item.raw.server)
  const tool = readString(item.raw.tool)
  return {
    kind: 'activity',
    activityType: 'mcp',
    id: item.id,
    label: tool ? `调用 ${tool}` : '调用 MCP 工具',
    status: readItemStatus(item.raw.status, item.completedAtMs),
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    durationMs: readDurationMs(item),
    server,
    tool,
    progress: item.progress,
    error: readString(asRecord(item.raw.error)?.message),
  }
}

function projectDynamicToolItem(item: MutableItem): ConversationGenericActivity {
  const tool = readString(item.raw.tool)
  const label = tool === 'create_thread'
    ? '创建任务'
    : tool === 'read_task_terminal'
      ? '读取任务终端'
      : tool
        ? `调用 ${boundText(tool, 120)}`
        : '调用动态工具'
  return projectGenericActivity(
    item,
    'dynamic-tool',
    label,
    boundText(readString(item.raw.namespace), 120),
  )
}

function projectSearchItem(item: MutableItem): ConversationActivity {
  const query = readString(item.raw.query)
  return {
    kind: 'activity',
    activityType: 'web-search',
    id: item.id,
    label: query ? '搜索网页' : '执行网页搜索',
    status: readItemStatus(item.raw.status, item.completedAtMs),
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    durationMs: readDurationMs(item),
    query,
  }
}

function projectPlanItem(item: MutableItem): ConversationActivity {
  const rawSteps = Array.isArray(item.raw.plan) ? item.raw.plan : []
  const steps: ConversationPlanStep[] = rawSteps.flatMap((value) => {
    const row = asRecord(value)
    const step = readString(row?.step)
    if (!step) return []
    const status = readString(row?.status)
    return [{
      step,
      status: status === 'completed' ? 'completed' : status === 'inProgress' ? 'in-progress' : 'pending',
    }]
  })
  return {
    kind: 'activity',
    activityType: 'plan',
    id: item.id,
    label: '更新计划',
    status: readItemStatus(item.raw.status, item.completedAtMs),
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    durationMs: readDurationMs(item),
    text: boundText(readString(item.raw.text), MAX_TEXT_LENGTH),
    explanation: boundText(readString(item.raw.explanation), 8_000),
    steps,
  }
}

function projectCollaborationItem(item: MutableItem): ConversationGenericActivity {
  const tool = readString(item.raw.tool)
  const label = (() => {
    switch (tool) {
      case 'spawnAgent': return '创建协同子任务'
      case 'sendInput': return '补充协同指令'
      case 'resumeAgent': return '继续协同子任务'
      case 'wait': return '等待协同子任务'
      case 'closeAgent': return '结束协同子任务'
      default: return '协同子任务'
    }
  })()
  return projectGenericActivity(
    item,
    'collaboration',
    label,
    boundText(readString(item.raw.prompt).trim(), 800),
  )
}

function projectGenericActivity(
  item: MutableItem,
  activityType: ConversationGenericActivity['activityType'],
  label: string,
  target: string,
): ConversationGenericActivity {
  return {
    kind: 'activity',
    activityType,
    id: item.id,
    label,
    status: readItemStatus(item.raw.status, item.completedAtMs),
    startedAtMs: item.startedAtMs,
    completedAtMs: item.completedAtMs,
    durationMs: readDurationMs(item),
    target,
  }
}

function mergeFileChanges(target: Map<string, ConversationFileChange>, item: MutableItem): void {
  const changes = Array.isArray(item.raw.changes) ? item.raw.changes : []
  for (const rawChange of changes) {
    const change = asRecord(rawChange)
    const path = readString(change?.path)
    if (!path) continue
    const diff = boundText(readString(change?.diff), MAX_DIFF_LENGTH)
    const stats = countDiff(diff)
    const existing = target.get(path)
    const nextKind = readFileChangeKind(change?.kind)
    if (existing) {
      existing.kind = nextKind
      existing.additions += stats.additions
      existing.removals += stats.removals
      existing.diff = appendBounded(existing.diff, diff ? `\n${diff}` : '', MAX_DIFF_LENGTH)
      existing.status = mergeStatuses(existing.status, readItemStatus(item.raw.status, item.completedAtMs))
      if (!existing.itemIds.includes(item.id)) existing.itemIds.push(item.id)
    } else {
      target.set(path, {
        path,
        kind: nextKind,
        additions: stats.additions,
        removals: stats.removals,
        diff,
        status: readItemStatus(item.raw.status, item.completedAtMs),
        itemIds: [item.id],
      })
    }
  }
}

function projectInteraction(interaction: MutableInteraction): ConversationInteractionBlock {
  const params = asRecord(interaction.params)
  const method = interaction.method
  const normalizedMethod = method.trim().toLowerCase()
  const nested = asRecord(params?.params) ?? asRecord(params?.request) ?? params
  const payload = asRecord(asRecord(params?.request)?.params) ?? nested
  const metadata = asRecord(payload?._meta)
  const isMcpElicitation = normalizedMethod === 'mcpserver/elicitation/request'
    || normalizedMethod === 'mcpserver/elication/request'
    || normalizedMethod === 'elicitation/create'
  const isMcpPermission = isMcpElicitation && (
    metadata?.codex_approval_kind === 'mcp_tool_call'
    || /^Allow\s+/iu.test(readFirstString([payload, nested, params], ['message']))
  )
  let interactionType: ConversationInteractionBlock['interactionType'] = 'generic'
  let label = '需要处理'
  let title = '任务等待你的处理'
  if (method === 'item/commandExecution/requestApproval') {
    interactionType = 'approval'
    label = '确认命令执行'
    title = '命令执行需要批准'
  } else if (method === 'item/fileChange/requestApproval') {
    interactionType = 'approval'
    label = '确认文件变更'
    title = '文件变更需要批准'
  } else if (method === 'item/tool/requestUserInput') {
    interactionType = 'user-input'
    label = '补充输入'
    title = '需要你的补充'
  } else if (method === 'item/tool/call') {
    interactionType = 'unsupported-tool'
    label = '工具调用'
    title = '工具调用不可用'
  } else if (isMcpPermission) {
    interactionType = 'mcp-approval'
    label = '确认 MCP 工具'
    title = 'MCP 工具权限确认'
  } else if (isMcpElicitation) {
    interactionType = 'mcp-input'
    label = '补充 MCP 信息'
    title = 'MCP 服务需要补充信息'
  }
  if (isMcpPermission) {
    const connectorName = readFirstString([metadata, payload, nested, params], ['connector_name', 'serverName', 'server'])
    const toolName = readFirstString([metadata, payload, nested, params], ['tool_title', 'toolName', 'tool'])
    const identity = [connectorName, toolName].filter(Boolean).join(' · ')
    if (identity) title = identity
  }
  const summary = isMcpElicitation
    ? readFirstString([payload, nested, params], ['message', 'summary', 'reason'])
    : readFirstString([nested, params, payload], ['reason', 'summary', 'command'])
  const authorizationUrl = readFirstString([payload, nested, params], ['url'])
  const mcpPersistenceScopes = interactionType === 'mcp-approval'
    ? readMcpPersistenceScopes(metadata?.persist)
    : []
  return {
    kind: 'interaction',
    id: interaction.id,
    requestId: interaction.requestId,
    responseId: typeof interaction.requestId === 'number' ? interaction.requestId : null,
    interactionType,
    status: interaction.status,
    label,
    title,
    detail: boundText(summary || (isMcpPermission
      ? '外部 MCP 服务希望运行工具；允许后任务会继续。'
      : '处理此请求后，当前任务会从等待状态继续。'), 4_000),
    context: readInteractionContext(method, interactionType, [payload, nested, params], metadata),
    questions: readInteractionQuestions(params, payload),
    authorizationUrl: /^https?:\/\//iu.test(authorizationUrl) ? authorizationUrl : '',
    allowForSession: interactionType === 'approval',
    mcpPersistenceScopes,
    requestedAtMs: interaction.requestedAtMs,
    resolvedAtMs: interaction.resolvedAtMs,
    itemId: interaction.itemId,
  }
}

function readInteractionContext(
  method: string,
  interactionType: ConversationInteractionBlock['interactionType'],
  records: Array<UnknownRecord | null>,
  metadata: UnknownRecord | null,
): ConversationInteractionBlock['context'] {
  const context: ConversationInteractionBlock['context'] = []
  const add = (label: string, value: string): void => {
    const normalized = boundText(value.trim(), 800)
    if (!normalized || context.some((entry) => entry.label === label && entry.value === normalized)) return
    context.push({ label, value: normalized })
  }
  if (method === 'item/commandExecution/requestApproval') {
    add('命令', readFirstString(records, ['command']))
    add('目录', readFirstString(records, ['cwd']))
  }
  if (interactionType === 'mcp-approval') {
    const rawDetails = Array.isArray(metadata?.tool_params_display) ? metadata.tool_params_display : []
    for (const rawDetail of rawDetails.slice(0, 8)) {
      const detail = asRecord(rawDetail)
      const label = readString(detail?.display_name) || readString(detail?.name)
      const value = stringifyInteractionContextValue(detail?.value)
      if (label && value) add(label, value)
    }
  }
  return context
}

function stringifyInteractionContextValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function readMcpPersistenceScopes(value: unknown): Array<'session' | 'always'> {
  const values = Array.isArray(value) ? value : [value]
  const scopes: Array<'session' | 'always'> = []
  for (const candidate of values) {
    if ((candidate === 'session' || candidate === 'always') && !scopes.includes(candidate)) {
      scopes.push(candidate)
    }
  }
  return scopes
}

function readInteractionQuestions(
  params: UnknownRecord | null,
  payload: UnknownRecord | null,
): ConversationInteractionBlock['questions'] {
  const rawQuestions = Array.isArray(params?.questions)
    ? params.questions
    : Array.isArray(payload?.questions)
      ? payload.questions
      : []
  return rawQuestions.flatMap((rawQuestion) => {
    const question = asRecord(rawQuestion)
    const id = readString(question?.id)
    if (!id) return []
    const options = Array.isArray(question?.options)
      ? question.options.flatMap((rawOption) => {
          const label = readString(asRecord(rawOption)?.label)
          return label ? [label] : []
        })
      : []
    return [{
      id,
      header: readString(question?.header),
      question: readString(question?.question),
      isOther: question?.isOther === true,
      options,
    }]
  })
}

function readFirstString(records: Array<UnknownRecord | null>, keys: string[]): string {
  for (const record of records) {
    for (const key of keys) {
      const value = readString(record?.[key])
      if (value) return value
    }
  }
  return ''
}

function groupActivities(blocks: ConversationTurnBlock[]): ConversationActivityGroup[] {
  const groups: ConversationActivityGroup[] = []
  let current: ConversationActivity[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    const last = current.at(-1)
    if (!first || !last) return
    const startedAtMs = minOf(current.map((activity) => activity.startedAtMs))
    const completedAtMs = current.some((activity) => activity.completedAtMs === null)
      ? null
      : maxOf(current.map((activity) => activity.completedAtMs))
    groups.push({
      id: `activities:${first.id}:${last.id}`,
      activityIds: current.map((activity) => activity.id),
      status: current.reduce((status, activity) => mergeStatuses(status, activity.status), 'completed' as ConversationItemStatus),
      label: current.length === 1 ? first.label : `${String(current.length)} 个操作 · ${last.label}`,
      startedAtMs,
      completedAtMs,
      durationMs: startedAtMs !== null && completedAtMs !== null ? Math.max(0, completedAtMs - startedAtMs) : null,
    })
    current = []
  }
  for (const block of blocks) {
    if (block.kind === 'activity') {
      current.push(block)
    } else {
      flush()
    }
  }
  flush()
  return groups
}

function resolveTurnState(
  turn: MutableTurn,
  state: ProjectionState,
  input: ConversationProjectionInput,
): ConversationExecutionState {
  if (Array.from(turn.interactions.values()).some((interaction) => interaction.status === 'pending')) return 'waiting'
  const status = turn.rawStatus.toLowerCase()
  if (status === 'failed') return 'failed'
  if (status === 'interrupted') return 'interrupted'
  if (status === 'stopped') return 'stopped'
  if (status === 'queued') return 'queued'
  if (status === 'submitting') return 'submitting'
  if (status === 'inprogress' || status === 'running' || turn.id === state.activeTurnId) {
    return input.runtime?.stale ? 'sync-degraded' : 'running'
  }
  if (status === 'waiting') return 'waiting'
  if (input.runtime?.stale && turn === state.turns.at(-1) && !isTerminalRuntimeState(input.runtime.executionState)) {
    return 'sync-degraded'
  }
  return 'completed'
}

function resolveStartedAtMs(
  turn: MutableTurn,
): number | null {
  if (turn.localOnly) return null
  if (turn.startedAtMs !== null) return turn.startedAtMs
  // A locally echoed user message has a delivery timestamp, not an execution clock.
  // Runtime timing was already applied above with generation checks; never reapply it here.
  return minOf(Array.from(turn.items.values())
    .filter((item) => item.raw.deliveryState === undefined)
    .map((item) => item.startedAtMs))
}

function resolveCompletedAtMs(
  turn: MutableTurn,
  turnState: ConversationExecutionState,
): number | null {
  if (turn.localOnly) return null
  if (turn.completedAtMs !== null) return turn.completedAtMs
  if (!isTerminalConversationExecutionState(turnState)) return null
  return maxOf(Array.from(turn.items.values()).map((item) => item.completedAtMs))
}

function calculateWaitedMs(
  interactions: ConversationInteractionBlock[],
  turnStartMs: number | null,
  turnEndMs: number,
): number {
  if (turnStartMs === null || turnEndMs <= turnStartMs) return 0
  const intervals = interactions.flatMap((interaction) => {
    if (interaction.requestedAtMs === null) return []
    const start = Math.max(turnStartMs, interaction.requestedAtMs)
    const end = Math.min(turnEndMs, interaction.resolvedAtMs ?? turnEndMs)
    return end > start ? [[start, end] as const] : []
  }).sort((first, second) => first[0] - second[0])
  let total = 0
  let currentStart: number | null = null
  let currentEnd: number | null = null
  for (const [start, end] of intervals) {
    if (currentStart === null || currentEnd === null) {
      currentStart = start
      currentEnd = end
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end)
    } else {
      total += currentEnd - currentStart
      currentStart = start
      currentEnd = end
    }
  }
  if (currentStart !== null && currentEnd !== null) total += currentEnd - currentStart
  return total
}

function resolveFinalStatus(
  state: ConversationExecutionState,
  final: ConversationAssistantBlock | null,
): ConversationTurn['finalStatus'] {
  if (final) return 'available'
  if (state === 'submitting' || state === 'queued' || state === 'running' || state === 'waiting' || state === 'sync-degraded') return 'pending'
  if (state === 'failed') return 'failed'
  if (state === 'interrupted') return 'interrupted'
  if (state === 'stopped') return 'stopped'
  return 'missing'
}

function isWaitingRuntimeState(value: unknown): boolean {
  return value === 'waiting_permission'
}

function isTerminalRuntimeState(value: unknown): boolean {
  return value === 'completed' || value === 'failed' || value === 'interrupted' || value === 'stopped' || value === 'idle'
}

function runtimeStateToTurnStatus(value: unknown, fallback: string): string {
  if (value === 'failed' || value === 'interrupted' || value === 'stopped') return value
  if (value === 'completed' || value === 'idle') return 'completed'
  return fallback
}

function readItemStatus(value: unknown, completedAtMs: number | null): ConversationItemStatus {
  if (value === 'inProgress' || value === 'running') return 'in-progress'
  if (value === 'failed') return 'failed'
  if (value === 'declined') return 'declined'
  if (value === 'completed' || completedAtMs !== null) return 'completed'
  return 'pending'
}

function mergeStatuses(first: ConversationItemStatus, second: ConversationItemStatus): ConversationItemStatus {
  if (first === 'failed' || second === 'failed') return 'failed'
  if (first === 'in-progress' || second === 'in-progress') return 'in-progress'
  if (first === 'pending' || second === 'pending') return 'pending'
  if (first === 'declined' || second === 'declined') return 'declined'
  return 'completed'
}

function readDurationMs(item: MutableItem): number | null {
  const direct = readFiniteNumber(item.raw.durationMs)
  if (direct !== null) return Math.max(0, direct)
  if (item.startedAtMs !== null && item.completedAtMs !== null) {
    return Math.max(0, item.completedAtMs - item.startedAtMs)
  }
  return null
}

function readFileChangeKind(value: unknown): ConversationFileChange['kind'] {
  const row = asRecord(value)
  const type = readString(row?.type)
  return type === 'add' || type === 'delete' ? type : 'update'
}

function countDiff(diff: string): { additions: number; removals: number } {
  let additions = 0
  let removals = 0
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) removals += 1
  }
  return { additions, removals }
}

function readDeliveryState(value: unknown): ConversationUserBlock['deliveryState'] {
  return value === 'sending' || value === 'confirmationPending' || value === 'waitingNetwork' || value === 'sent' || value === 'failed'
    ? value
    : null
}

function readThreadId(params: UnknownRecord | null): string {
  return readString(params?.threadId) || readString(asRecord(params?.thread)?.id)
}

function readTurnId(params: UnknownRecord | null): string {
  return readString(params?.turnId) || readString(asRecord(params?.turn)?.id)
}

function readTurnTimestamp(params: UnknownRecord | null, key: 'startedAt' | 'completedAt'): number | null {
  return parseTimestamp(readString(params?.[key])) ?? parseTimestamp(readString(asRecord(params?.turn)?.[key]))
}

function readTimestampMs(record: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = parseTimestamp(record[key])
    if (parsed !== null) return parsed
  }
  return null
}

function readErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  return readString(asRecord(value)?.message)
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value)
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = readFiniteNumber(value)
  return number !== null && number >= 0 ? Math.trunc(number) : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRawString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function appendBounded(current: string, delta: string, maxLength: number): string {
  return boundText(`${current}${delta}`, maxLength)
}

function boundText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n\n[内容已由 CX-Codex 有界截断]`
}

function minTimestamp(first: number | null, second: number | null): number | null {
  if (first === null) return second
  if (second === null) return first
  return Math.min(first, second)
}

function maxTimestamp(first: number | null, second: number | null): number | null {
  if (first === null) return second
  if (second === null) return first
  return Math.max(first, second)
}

function minOf(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? Math.min(...present) : null
}

function maxOf(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? Math.max(...present) : null
}

function compareNullableNumbers(first: number | null, second: number | null): number {
  if (first === null && second === null) return 0
  if (first === null) return 1
  if (second === null) return -1
  return first - second
}
