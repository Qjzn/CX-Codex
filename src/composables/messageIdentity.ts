import type { AcknowledgedUserMessage, OptimisticUserMessage } from '../types/codex'
import { findUserMessageIdentityMatch, userMessageDisplayId } from '../conversation-transcript/userMessageIdentity'

export const OPTIMISTIC_USER_MESSAGE_PREFIX = 'optimistic-user:'

export type OptimisticUserMessageMeta = {
  kind: 'optimisticUserMessage'
  signature: string
  baselineMatchCount: number
  baselineMessageCount: number
  baselineTailMessageId: string
  authoritativeTurnId?: string
  clientMessageId?: string
  displayMessageId?: string
  createdAtMs: number
}

export function createClientMessageId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12)
  return `cm-${Date.now()}-${randomPart}`
}

export function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function normalizeMessageSignatureList(values: string[] | undefined): string {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\u001f')
}

type UserMessageSignatureInput = Pick<
  AcknowledgedUserMessage,
  'text' | 'images' | 'fileAttachments'
>

export function userMessageSignature(message: UserMessageSignatureInput): string {
  const filePaths = (message.fileAttachments ?? []).map((file) => file.path)
  return [
    normalizeMessageText(message.text),
    normalizeMessageSignatureList(message.images),
    normalizeMessageSignatureList(filePaths),
  ].join('\u001e')
}

function parseOptimisticUserMessageMeta(
  message: OptimisticUserMessage,
  rememberedMeta?: OptimisticUserMessageMeta,
): OptimisticUserMessageMeta | null {
  if (!message.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX)) return null
  if (rememberedMeta) return rememberedMeta
  if (!message.rawPayload) return null

  try {
    const parsed = JSON.parse(message.rawPayload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.kind !== 'optimisticUserMessage') return null
    if (typeof record.signature !== 'string') return null
    if (typeof record.baselineMatchCount !== 'number' || !Number.isFinite(record.baselineMatchCount)) return null
    if (typeof record.createdAtMs !== 'number' || !Number.isFinite(record.createdAtMs)) return null
    return {
      kind: 'optimisticUserMessage',
      signature: record.signature,
      baselineMatchCount: Math.max(0, Math.floor(record.baselineMatchCount)),
      baselineMessageCount: typeof record.baselineMessageCount === 'number' && Number.isFinite(record.baselineMessageCount)
        ? Math.max(0, Math.floor(record.baselineMessageCount))
        : Number.MAX_SAFE_INTEGER,
      baselineTailMessageId: typeof record.baselineTailMessageId === 'string'
        ? record.baselineTailMessageId.trim()
        : '',
      authoritativeTurnId: typeof record.authoritativeTurnId === 'string'
        ? record.authoritativeTurnId.trim() || undefined
        : undefined,
      clientMessageId: typeof record.clientMessageId === 'string' ? record.clientMessageId.trim() || undefined : undefined,
      displayMessageId: typeof record.displayMessageId === 'string' ? record.displayMessageId.trim() || undefined : undefined,
      createdAtMs: record.createdAtMs,
    }
  } catch {
    return null
  }
}

export function mergeVisibleOptimisticUserMessages(
  persisted: AcknowledgedUserMessage[],
  optimistic: OptimisticUserMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): Array<AcknowledgedUserMessage | OptimisticUserMessage> {
  const detachedFailedIds = new Set(
    selectDetachedFailedOptimisticUserMessages(persisted, optimistic, rememberedMetaById)
      .map((message) => message.id),
  )
  const visible = filterVisibleOptimisticUserMessages(persisted, optimistic, rememberedMetaById)
    .filter((message) => !detachedFailedIds.has(message.id))
  if (visible.length === 0) return [...persisted]

  const insertionsByPersistedIndex = new Map<number, OptimisticUserMessage[]>()
  for (const message of visible) {
    const meta = parseOptimisticUserMessageMeta(message, rememberedMetaById?.get(message.id))
    const anchorId = meta?.baselineTailMessageId ?? ''
    const anchorIndex = anchorId ? persisted.findIndex((candidate) => candidate.id === anchorId) : -1
    const insertIndex = anchorIndex >= 0
      ? anchorIndex + 1
      : Math.min(meta?.baselineMessageCount ?? persisted.length, persisted.length)
    const insertions = insertionsByPersistedIndex.get(insertIndex) ?? []
    insertions.push(message)
    insertionsByPersistedIndex.set(insertIndex, insertions)
  }

  const combined: Array<AcknowledgedUserMessage | OptimisticUserMessage> = []
  for (let index = 0; index <= persisted.length; index += 1) {
    combined.push(...(insertionsByPersistedIndex.get(index) ?? []))
    if (index < persisted.length) combined.push(persisted[index]!)
  }
  return combined
}

export function selectDetachedFailedOptimisticUserMessages(
  persisted: AcknowledgedUserMessage[],
  optimistic: OptimisticUserMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): OptimisticUserMessage[] {
  if (optimistic.length === 0) return optimistic

  const persistedIds = new Set(persisted.map((message) => message.id))
  return optimistic.filter((message) => {
    if (message.deliveryState !== 'failed') return false
    const meta = parseOptimisticUserMessageMeta(message, rememberedMetaById?.get(message.id))
    if (!meta || meta.baselineMessageCount <= 0) return false

    const anchorId = meta.baselineTailMessageId.trim()
    if (anchorId) return !persistedIds.has(anchorId)

    return persisted.length < meta.baselineMessageCount
  })
}

export function countPersistedUserMessageSignatures(messages: AcknowledgedUserMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX)) continue
    const signature = userMessageSignature(message)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  return counts
}

export function recoverOptimisticBaselineMatchCount(
  persisted: AcknowledgedUserMessage[],
  signature: string,
  storedBaselineMatchCount?: number,
  baselineMessageCount?: number,
  baselineTailMessageId = '',
): number {
  if (typeof storedBaselineMatchCount === 'number' && Number.isFinite(storedBaselineMatchCount)) {
    return Math.max(0, Math.floor(storedBaselineMatchCount))
  }

  const normalizedTailId = baselineTailMessageId.trim()
  const tailIndex = normalizedTailId
    ? persisted.findIndex((message) => message.id === normalizedTailId)
    : -1
  const boundary = tailIndex >= 0
    ? tailIndex + 1
    : typeof baselineMessageCount === 'number' && Number.isFinite(baselineMessageCount)
      ? Math.max(0, Math.min(Math.floor(baselineMessageCount), persisted.length))
      : 0
  const baselineCounts = countPersistedUserMessageSignatures(persisted.slice(0, boundary))
  return baselineCounts.get(signature) ?? 0
}

export function filterVisibleOptimisticUserMessages(
  persisted: AcknowledgedUserMessage[],
  optimistic: OptimisticUserMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): OptimisticUserMessage[] {
  if (optimistic.length === 0) return optimistic

  const persistedCounts = countPersistedUserMessageSignatures(persisted)
  const persistedUserTurnIds = new Set(
    persisted
      .filter((message) => message.role === 'user')
      .map((message) => message.turnId?.trim() ?? '')
      .filter((turnId) => turnId.length > 0),
  )
  const consumedAcknowledgements = new Map<string, number>()

  return optimistic.filter((message) => {
    const meta = parseOptimisticUserMessageMeta(message, rememberedMetaById?.get(message.id))
    if (meta?.clientMessageId) {
      return !findUserMessageIdentityMatch(persisted, {
        clientMessageId: meta.clientMessageId,
        turnId: meta.authoritativeTurnId,
      })
    }
    const signature = meta?.signature ?? userMessageSignature(message)
    const authoritativeTurnId = meta?.authoritativeTurnId?.trim() ?? ''
    if (authoritativeTurnId && persistedUserTurnIds.has(authoritativeTurnId)) {
      consumedAcknowledgements.set(signature, (consumedAcknowledgements.get(signature) ?? 0) + 1)
      return false
    }
    const baselineMatchCount = meta?.baselineMatchCount ?? 0
    const acknowledgedCount = Math.max((persistedCounts.get(signature) ?? 0) - baselineMatchCount, 0)
    const consumedCount = consumedAcknowledgements.get(signature) ?? 0

    if (acknowledgedCount > consumedCount) {
      consumedAcknowledgements.set(signature, consumedCount + 1)
      return false
    }

    return true
  })
}

/** Keep confirmed display bindings in the existing bounded user cache before
 * outbox cleanup removes the transient request-to-optimistic mapping. */
export function reconcileUserDisplayIdentities(
  previous: AcknowledgedUserMessage[],
  incoming: AcknowledgedUserMessage[],
  optimistic: OptimisticUserMessage[],
  metaById: ReadonlyMap<string, OptimisticUserMessageMeta>,
): AcknowledgedUserMessage[] {
  const previousByIdentity = new Map(previous.map((message) => [JSON.stringify([message.turnId, message.id]), message]))
  const groupByClient = (rows: AcknowledgedUserMessage[]): Map<string, AcknowledgedUserMessage[]> => {
    const groups = new Map<string, AcknowledgedUserMessage[]>()
    for (const row of rows) {
      if (!row.turnId || !row.clientMessageId) continue
      const key = JSON.stringify([row.turnId, row.clientMessageId])
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
    }
    return groups
  }
  const previousByClient = groupByClient(previous)
  const incomingByClient = groupByClient(incoming)
  const restoredBindings = new Set<AcknowledgedUserMessage>()
  const messages = incoming.map((message) => {
    let remembered = previousByIdentity.get(JSON.stringify([message.turnId, message.id]))
    // Native thread/read can replace a live UUID with item-1. Preserve the
    // display only for one-to-one client identity within this exact turn.
    if (!remembered && message.turnId && message.clientMessageId) {
      const key = JSON.stringify([message.turnId, message.clientMessageId])
      const previousMatches = previousByClient.get(key)
      if (previousMatches?.length === 1 && incomingByClient.get(key)?.length === 1) {
        remembered = previousMatches[0]
      }
    }
    if (!remembered?.displayMessageId || (message.clientMessageId && remembered.clientMessageId
      && message.clientMessageId !== remembered.clientMessageId)) return message
    const restored = { ...message, displayMessageId: remembered.displayMessageId,
      clientMessageId: message.clientMessageId || remembered.clientMessageId }
    restoredBindings.add(restored)
    return restored
  })
  for (const message of optimistic) {
    const meta = metaById.get(message.id)
    if (!meta?.clientMessageId) continue
    const match = findUserMessageIdentityMatch(messages, { clientMessageId: meta.clientMessageId,
      turnId: meta.authoritativeTurnId })
    if (!match || restoredBindings.has(match)) continue
    const index = messages.indexOf(match)
    const desiredDisplayId = userMessageDisplayId({ id: message.id, clientMessageId: meta.clientMessageId,
      displayMessageId: meta.displayMessageId })
    const displayIsLocked = messages.some((candidate) => restoredBindings.has(candidate)
      && candidate.displayMessageId === desiredDisplayId)
    messages[index] = { ...match, clientMessageId: match.clientMessageId || meta.clientMessageId,
      displayMessageId: displayIsLocked ? `${match.turnId ?? ''}:${match.id}` : desiredDisplayId }
  }
  return messages
}
