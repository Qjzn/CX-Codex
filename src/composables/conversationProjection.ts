import type { CommandExecutionData, UiMessage } from '../types/codex'
import { normalizeMessageText } from './messageIdentity'

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

export function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments) &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
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
  options: { preserveMissing?: boolean; sortByTurnIndex?: boolean; replaceHistoryNotice?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const incomingHasHistoryNotice = incoming.some((message) => message.messageType === 'history.notice')

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous
    .filter((previousMessage) => {
      return !(
        options.replaceHistoryNotice === true &&
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
  const merged = options.sortByTurnIndex === true
    ? sortMessagesByTurnIndex([...mergedFromPrevious, ...appended])
    : [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
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
