import type { CommandExecutionData, UiMessage } from '../types/codex'
import { normalizeMessageText } from './messageIdentity'

export const PLAN_IMPLEMENTATION_CONFIRMATION = '是的，执行此计划'

export function hasPlanImplementationConfirmation(messages: UiMessage[], planMessageId: string): boolean {
  const planIndex = messages.findIndex((message) => message.id === planMessageId)
  if (planIndex < 0) return false

  for (let index = planIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue
    if (message.messageType === 'plan') return false
    if (message.role !== 'user') continue
    return normalizeMessageText(message.text) === PLAN_IMPLEMENTATION_CONFIRMATION
  }

  return false
}

export function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.command === second.command &&
    first.cwd === second.cwd &&
    first.status === second.status &&
    first.aggregatedOutput === second.aggregatedOutput &&
    first.exitCode === second.exitCode &&
    first.durationMs === second.durationMs &&
    first.startedAtMs === second.startedAtMs
  )
}

function areFileAttachmentsEqual(
  first?: UiMessage['fileAttachments'],
  second?: UiMessage['fileAttachments'],
): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.label !== right[index]?.label || left[index]?.path !== right[index]?.path) {
      return false
    }
  }
  return true
}

function arePlansEqual(first?: UiMessage['plan'], second?: UiMessage['plan']): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (
    first.turnId !== second.turnId
    || first.explanation !== second.explanation
    || first.rawText !== second.rawText
    || first.isStreaming !== second.isStreaming
    || first.steps.length !== second.steps.length
  ) {
    return false
  }
  for (let index = 0; index < first.steps.length; index += 1) {
    if (
      first.steps[index]?.step !== second.steps[index]?.step
      || first.steps[index]?.status !== second.steps[index]?.status
    ) {
      return false
    }
  }
  return true
}

export function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments) &&
    first.messageType === second.messageType &&
    first.phase === second.phase &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    arePlansEqual(first.plan, second.plan) &&
    first.turnIndex === second.turnIndex &&
    first.deliveryState === second.deliveryState &&
    first.deliveryError === second.deliveryError &&
    first.deliveryAttempt === second.deliveryAttempt &&
    first.deliveryAttemptMax === second.deliveryAttemptMax
  )
}

export function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

export function sortMessagesByTurnIndex(messages: UiMessage[]): UiMessage[] {
  const originalIndexById = new Map(messages.map((message, index) => [message.id, index]))
  return [...messages].sort((first, second) => {
    if (first.messageType === 'history.notice' && second.messageType !== 'history.notice') return -1
    if (second.messageType === 'history.notice' && first.messageType !== 'history.notice') return 1

    const firstTurnIndex = typeof first.turnIndex === 'number' ? first.turnIndex : null
    const secondTurnIndex = typeof second.turnIndex === 'number' ? second.turnIndex : null
    if (firstTurnIndex !== null && secondTurnIndex !== null && firstTurnIndex !== secondTurnIndex) {
      return firstTurnIndex - secondTurnIndex
    }
    if (firstTurnIndex !== null && secondTurnIndex === null) return -1
    if (firstTurnIndex === null && secondTurnIndex !== null) return 1

    return (originalIndexById.get(first.id) ?? 0) - (originalIndexById.get(second.id) ?? 0)
  })
}

export function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  preserveMissing = false,
  sortByTurnIndex = false,
  replaceHistoryNotice = false,
  replaceOverlappingTurns = false,
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const incomingHasHistoryNotice = incoming.some((message) => message.messageType === 'history.notice')
  const incomingTurnIndexes = new Set(incoming.map((message) => message.turnIndex))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (!preserveMissing) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous
    .filter((previousMessage) => {
      if (
        replaceOverlappingTurns &&
        previousMessage.turnIndex !== undefined &&
        incomingTurnIndexes.has(previousMessage.turnIndex) &&
        !incomingById.has(previousMessage.id)
      ) {
        return false
      }
      return !(
        replaceHistoryNotice &&
        previousMessage.messageType === 'history.notice' &&
        !incomingHasHistoryNotice
      )
    })
    .map((previousMessage) => {
      const nextMessage = incomingById.get(previousMessage.id)
      if (!nextMessage) return previousMessage
      if (areMessageFieldsEqual(previousMessage, nextMessage)) return previousMessage
      return nextMessage
    })

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const dedupedFromPrevious = dedupeProjectionAgainstIncoming(
    mergedFromPrevious,
    appended,
    incomingById,
  )
  const merged = sortByTurnIndex
    ? sortMessagesByTurnIndex([...dedupedFromPrevious, ...appended])
    : [...dedupedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function messageContentIdentity(message: UiMessage): string {
  const turnIndex = typeof message.turnIndex === 'number' ? String(message.turnIndex) : ''
  const text = normalizeMessageText(message.text)
  const images = (message.images ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\u001f')
  const filePaths = (message.fileAttachments ?? [])
    .map((file) => `${file.label.trim()}\u001e${file.path.trim()}`)
    .join('\u001f')
  const phase = message.phase ?? ''
  return [message.role, message.messageType ?? '', phase, turnIndex, text, images, filePaths].join('\u001d')
}

/**
 * The same logical message can be delivered under different ids by different
 * sources (e.g. App Server response-item ids like "item-1" versus session-log
 * message ids like "msg_..."). When the incoming array fully represents a
 * content identity, drop the stale previous copy so the message does not
 * render twice. Copies at distinct turns are never collapsed because their
 * turnIndex differs, and partially-synced incoming arrays keep previous extras.
 */
function dedupeProjectionAgainstIncoming(
  previous: UiMessage[],
  appended: UiMessage[],
  incomingById: ReadonlyMap<string, UiMessage>,
): UiMessage[] {
  const previousIdentityCounts = new Map<string, number>()
  for (const message of previous) {
    if (incomingById.has(message.id)) continue
    const key = messageContentIdentity(message)
    previousIdentityCounts.set(key, (previousIdentityCounts.get(key) ?? 0) + 1)
  }
  const appendedIdentityCounts = new Map<string, number>()
  for (const message of appended) {
    const key = messageContentIdentity(message)
    appendedIdentityCounts.set(key, (appendedIdentityCounts.get(key) ?? 0) + 1)
  }
  return previous.filter((message) => {
    if (incomingById.has(message.id)) return true
    const key = messageContentIdentity(message)
    const previousCount = previousIdentityCounts.get(key) ?? 0
    const appendedCount = appendedIdentityCounts.get(key) ?? 0
    return appendedCount < previousCount
  })
}

export function earliestTurnIndexFromMessages(messages: UiMessage[]): number | null {
  let earliest: number | null = null
  for (const message of messages) {
    if (message.messageType === 'history.notice') continue
    if (typeof message.turnIndex !== 'number' || !Number.isFinite(message.turnIndex)) continue
    earliest = earliest === null ? message.turnIndex : Math.min(earliest, message.turnIndex)
  }
  return earliest
}

export function removeStaleHistoryNoticeAfterOlderMerge(messages: UiMessage[]): UiMessage[] {
  const earliest = earliestTurnIndexFromMessages(messages)
  if (earliest === null || earliest > 0) return messages
  const nextMessages = messages.filter((message) => message.messageType !== 'history.notice')
  return nextMessages.length === messages.length ? messages : nextMessages
}

export function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantTexts.size === 0) return previous

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

export function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) return [...previous, nextMessage]

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) return previous

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}
