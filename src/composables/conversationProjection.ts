import type { CommandExecutionData, UiMessage } from '../types/codex'
import { normalizeMessageText, userMessageSignature } from './messageIdentity'

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
    first.turnId === second.turnId &&
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

export type MessageMergeAuthority = 'higher' | 'lower' | 'older'

const TRAILING_MEMORY_CITATION_PATTERN = /\s*<oai-mem-citation>[\s\S]*<\/oai-mem-citation>\s*$/u

function readPersistedMessageContentIdentity(message: UiMessage): string | null {
  if (message.role === 'user' && message.messageType === 'userMessage') {
    return `user\u001d${userMessageSignature(message)}`
  }
  if (message.role !== 'assistant' || message.messageType !== 'agentMessage') return null

  const text = normalizeMessageText(message.text.replace(TRAILING_MEMORY_CITATION_PATTERN, ''))
  if (!text) return null
  const phase = message.phase === 'commentary' ? 'commentary' : 'response'
  return `assistant\u001d${phase}\u001d${text}`
}

function readPersistedMessageTurnIdentity(message: UiMessage): string | null {
  const contentIdentity = readPersistedMessageContentIdentity(message)
  if (!contentIdentity) return null

  const turnId = message.turnId?.trim() ?? ''
  if (!turnId || turnId.startsWith('fallback-turn-')) return null
  return `${turnId}\u001d${contentIdentity}`
}

function countMessageIdentities(
  messages: UiMessage[],
  readIdentity: (message: UiMessage) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const identity = readIdentity(message)
    if (!identity) continue
    counts.set(identity, (counts.get(identity) ?? 0) + 1)
  }
  return counts
}

function consumeMessageIdentity(counts: Map<string, number>, identity: string | null): boolean {
  if (!identity) return false
  const count = counts.get(identity) ?? 0
  if (count <= 0) return false
  if (count === 1) counts.delete(identity)
  else counts.set(identity, count - 1)
  return true
}

function findLastIncomingContentOverlap(previous: UiMessage[], incoming: UiMessage[]): number {
  const alignmentWindow = 256
  const previousEntries = previous.flatMap((message, index) => {
    const identity = readPersistedMessageContentIdentity(message)
    return identity ? [{ identity, index }] : []
  }).slice(-alignmentWindow)
  const incomingEntries = incoming.flatMap((message, index) => {
    const identity = readPersistedMessageContentIdentity(message)
    return identity ? [{ identity, index }] : []
  }).slice(-alignmentWindow)
  if (previousEntries.length === 0 || incomingEntries.length === 0) return -1

  let precedingLengths = new Uint16Array(incomingEntries.length + 1)
  let bestLength = 0
  let bestPreviousIndex = -1
  let bestIncomingIndex = -1
  for (const previousEntry of previousEntries) {
    const currentLengths = new Uint16Array(incomingEntries.length + 1)
    for (let incomingOffset = 1; incomingOffset <= incomingEntries.length; incomingOffset += 1) {
      const incomingEntry = incomingEntries[incomingOffset - 1]!
      if (previousEntry.identity !== incomingEntry.identity) continue
      const length = precedingLengths[incomingOffset - 1]! + 1
      currentLengths[incomingOffset] = length
      const isBetterAlignment =
        length > bestLength
        || (
          length === bestLength
          && (
            previousEntry.index > bestPreviousIndex
            || (
              previousEntry.index === bestPreviousIndex
              && incomingEntry.index > bestIncomingIndex
            )
          )
        )
      if (!isBetterAlignment) continue
      bestLength = length
      bestPreviousIndex = previousEntry.index
      bestIncomingIndex = incomingEntry.index
    }
    precedingLengths = currentLengths
  }
  return bestIncomingIndex
}

function mergeLowerAuthorityMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const lastOverlapIndex = findLastIncomingContentOverlap(previous, incoming)
  let fallbackStartIndex = -1
  for (let index = incoming.length - 1; index >= 0; index -= 1) {
    if (incoming[index]?.messageType !== 'userMessage') continue
    fallbackStartIndex = index
    break
  }
  const startIndex = lastOverlapIndex >= 0
    ? lastOverlapIndex + 1
    : fallbackStartIndex >= 0
      ? fallbackStartIndex
      : Math.max(0, incoming.length - 1)
  const previousIds = new Set(previous.map((message) => message.id))
  const appended = incoming.slice(startIndex).filter((message) => !previousIds.has(message.id))
  if (appended.length === 0) return previous
  return [...previous, ...appended]
}

export function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  preserveMissing = false,
  sortByTurnIndex = false,
  replaceHistoryNotice = false,
  replaceOverlappingTurns = false,
  incomingAuthority: MessageMergeAuthority = 'higher',
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const incomingTurnIdentityCounts = countMessageIdentities(incoming, readPersistedMessageTurnIdentity)
  const incomingFallbackIdentityCounts = countMessageIdentities(incoming, readPersistedMessageContentIdentity)
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
  if (incomingAuthority === 'lower') {
    return mergeLowerAuthorityMessages(previous, mergedIncoming)
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
      if (incomingAuthority !== 'older' && !incomingById.has(previousMessage.id)) {
        const turnIdentity = readPersistedMessageTurnIdentity(previousMessage)
        const contentIdentity = readPersistedMessageContentIdentity(previousMessage)
        if (consumeMessageIdentity(incomingTurnIdentityCounts, turnIdentity)) {
          consumeMessageIdentity(incomingFallbackIdentityCounts, contentIdentity)
          return false
        }
        if (!turnIdentity) {
          if (consumeMessageIdentity(incomingFallbackIdentityCounts, contentIdentity)) return false
        }
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
  const preservesMessagesMissingFromIncoming = mergedFromPrevious.some(
    (message) => !incomingById.has(message.id),
  )
  if (incomingAuthority === 'higher' && !preservesMessagesMissingFromIncoming) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }
  const merged = sortByTurnIndex
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
  const incomingMessageIds = new Set(incoming.map((message) => message.id))
  let activeTailStartIndex = -1
  for (let index = incoming.length - 1; index >= 0; index -= 1) {
    if (incoming[index]?.role !== 'user') continue
    activeTailStartIndex = index
    break
  }
  const incomingActiveTailAssistantTexts = new Set(
    (activeTailStartIndex >= 0 ? incoming.slice(activeTailStartIndex + 1) : incoming)
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingMessageIds.size === 0 && incomingActiveTailAssistantTexts.size === 0) return previous

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    if (incomingMessageIds.has(message.id)) return false
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingActiveTailAssistantTexts.has(normalized)
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
