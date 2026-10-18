import type { AcknowledgedUserMessage } from '../types/codex'
import { userMessageSignature } from './messageIdentity'

// Cache-only delivery evidence for acknowledged user messages. Visible turns, assistant
// output, execution state, timing, and activities belong exclusively to ConversationProjection.

export type CachedThreadMessageMergeOptions = {
  preserveMissing?: boolean
  sortByTurnIndex?: boolean
  replaceOverlappingTurns?: boolean
  incomingAuthority?: 'higher' | 'lower' | 'older'
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

function areFileAttachmentsEqual(
  first?: AcknowledgedUserMessage['fileAttachments'],
  second?: AcknowledgedUserMessage['fileAttachments'],
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

function areCachedUserMessageFieldsEqual(first: AcknowledgedUserMessage, second: AcknowledgedUserMessage): boolean {
  return (
    first.id === second.id
    && first.role === second.role
    && first.text === second.text
    && areStringArraysEqual(first.images, second.images)
    && areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments)
    && first.messageType === second.messageType
    && first.turnIndex === second.turnIndex
    && first.turnId === second.turnId
    && first.clientMessageId === second.clientMessageId
    && first.displayMessageId === second.displayMessageId
  )
}

export function areMessageArraysEqual<T>(first: T[], second: T[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function readStrongUserIdentity(message: AcknowledgedUserMessage): string | null {
  const turnId = message.turnId?.trim() ?? ''
  if (!turnId || turnId.startsWith('fallback-turn-')) return null
  if (message.clientMessageId) return JSON.stringify([turnId, message.clientMessageId])
  return `${turnId}\u001d${userMessageSignature(message)}`
}

function readFallbackUserIdentity(message: AcknowledgedUserMessage): string {
  if (message.clientMessageId) return `client:${message.clientMessageId}`
  return userMessageSignature(message)
}

function countMessageIdentities(
  messages: AcknowledgedUserMessage[],
  readIdentity: (message: AcknowledgedUserMessage) => string | null,
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

function sortCachedMessagesByTurnIndex(messages: AcknowledgedUserMessage[]): AcknowledgedUserMessage[] {
  const originalIndexById = new Map(messages.map((message, index) => [message.id, index]))
  return [...messages].sort((first, second) => {
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

function findLastIncomingUserOverlap(previous: AcknowledgedUserMessage[], incoming: AcknowledgedUserMessage[]): number {
  const alignmentWindow = 256
  const previousEntries = previous.map((message, index) => ({
    identity: readFallbackUserIdentity(message),
    index,
  })).slice(-alignmentWindow)
  const incomingEntries = incoming.map((message, index) => ({
    identity: readFallbackUserIdentity(message),
    index,
  })).slice(-alignmentWindow)
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
            || (previousEntry.index === bestPreviousIndex && incomingEntry.index > bestIncomingIndex)
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

function mergeLowerAuthorityUsers(
  previous: AcknowledgedUserMessage[],
  incoming: AcknowledgedUserMessage[],
): AcknowledgedUserMessage[] {
  const lastOverlapIndex = findLastIncomingUserOverlap(previous, incoming)
  const startIndex = lastOverlapIndex >= 0 ? lastOverlapIndex + 1 : Math.max(0, incoming.length - 1)
  const previousIds = new Set(previous.map((message) => message.id))
  const appended = incoming.slice(startIndex).filter((message) => !previousIds.has(message.id))
  return appended.length === 0 ? previous : [...previous, ...appended]
}

export function mergeCachedThreadMessages(
  previousInput: AcknowledgedUserMessage[],
  incomingInput: AcknowledgedUserMessage[],
  options: CachedThreadMessageMergeOptions = {},
): AcknowledgedUserMessage[] {
  const previous = previousInput
  const incoming = incomingInput
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    return previousMessage && areCachedUserMessageFieldsEqual(previousMessage, incomingMessage)
      ? previousMessage
      : incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previousInput, mergedIncoming) ? previousInput : mergedIncoming
  }
  if (options.incomingAuthority === 'lower') {
    return mergeLowerAuthorityUsers(previous, mergedIncoming)
  }

  const incomingStrongIdentityCounts = countMessageIdentities(incoming, readStrongUserIdentity)
  const incomingFallbackIdentityCounts = countMessageIdentities(incoming, readFallbackUserIdentity)
  const incomingTurnIndexes = new Set(incoming.map((message) => message.turnIndex))
  const mergedFromPrevious = previous
    .filter((previousMessage) => {
      if (
        options.replaceOverlappingTurns === true
        && previousMessage.turnIndex !== undefined
        && incomingTurnIndexes.has(previousMessage.turnIndex)
        && !incomingById.has(previousMessage.id)
      ) {
        return false
      }
      if (options.incomingAuthority !== 'older' && !incomingById.has(previousMessage.id)) {
        const strongIdentity = readStrongUserIdentity(previousMessage)
        const fallbackIdentity = readFallbackUserIdentity(previousMessage)
        if (consumeMessageIdentity(incomingStrongIdentityCounts, strongIdentity)) {
          consumeMessageIdentity(incomingFallbackIdentityCounts, fallbackIdentity)
          return false
        }
        if (!strongIdentity && consumeMessageIdentity(incomingFallbackIdentityCounts, fallbackIdentity)) {
          return false
        }
      }
      return true
    })
    .map((previousMessage) => {
      const nextMessage = incomingById.get(previousMessage.id)
      if (!nextMessage || areCachedUserMessageFieldsEqual(previousMessage, nextMessage)) return previousMessage
      return nextMessage
    })

  const previousIds = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIds.has(message.id))
  const preservesMissingMessages = mergedFromPrevious.some((message) => !incomingById.has(message.id))
  if (options.incomingAuthority !== 'older' && !preservesMissingMessages) {
    return areMessageArraysEqual(previousInput, mergedIncoming) ? previousInput : mergedIncoming
  }

  const merged = options.sortByTurnIndex === true
    ? sortCachedMessagesByTurnIndex([...mergedFromPrevious, ...appended])
    : [...mergedFromPrevious, ...appended]
  return areMessageArraysEqual(previousInput, merged) ? previousInput : merged
}
