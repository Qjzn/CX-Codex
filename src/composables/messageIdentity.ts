import type { UiMessage } from '../types/codex'

export const OPTIMISTIC_USER_MESSAGE_PREFIX = 'optimistic-user:'

export type OptimisticUserMessageMeta = {
  kind: 'optimisticUserMessage'
  signature: string
  baselineMatchCount: number
  baselineMessageCount: number
  baselineTailMessageId: string
  authoritativeTurnId?: string
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

export function userMessageSignature(message: UiMessage): string {
  const filePaths = (message.fileAttachments ?? []).map((file) => file.path)
  return [
    normalizeMessageText(message.text),
    normalizeMessageSignatureList(message.images),
    normalizeMessageSignatureList(filePaths),
  ].join('\u001e')
}

function parseOptimisticUserMessageMeta(
  message: UiMessage,
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
      createdAtMs: record.createdAtMs,
    }
  } catch {
    return null
  }
}

export function mergeVisibleOptimisticUserMessages(
  persisted: UiMessage[],
  optimistic: UiMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): UiMessage[] {
  const detachedFailedIds = new Set(
    selectDetachedFailedOptimisticUserMessages(persisted, optimistic, rememberedMetaById)
      .map((message) => message.id),
  )
  const visible = filterVisibleOptimisticUserMessages(persisted, optimistic, rememberedMetaById)
    .filter((message) => !detachedFailedIds.has(message.id))
  if (visible.length === 0) return [...persisted]

  const insertionsByPersistedIndex = new Map<number, UiMessage[]>()
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

  const combined: UiMessage[] = []
  for (let index = 0; index <= persisted.length; index += 1) {
    combined.push(...(insertionsByPersistedIndex.get(index) ?? []))
    if (index < persisted.length) combined.push(persisted[index]!)
  }
  return combined
}

export function selectDetachedFailedOptimisticUserMessages(
  persisted: UiMessage[],
  optimistic: UiMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): UiMessage[] {
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

export function countPersistedUserMessageSignatures(messages: UiMessage[]): Map<string, number> {
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
  persisted: UiMessage[],
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
  persisted: UiMessage[],
  optimistic: UiMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): UiMessage[] {
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
