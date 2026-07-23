import type { UiMessage } from '../types/codex'

export const OPTIMISTIC_USER_MESSAGE_PREFIX = 'optimistic-user:'

export type OptimisticUserMessageMeta = {
  kind: 'optimisticUserMessage'
  signature: string
  baselineMatchCount: number
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
      createdAtMs: record.createdAtMs,
    }
  } catch {
    return null
  }
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

export function filterVisibleOptimisticUserMessages(
  persisted: UiMessage[],
  optimistic: UiMessage[],
  rememberedMetaById?: ReadonlyMap<string, OptimisticUserMessageMeta>,
): UiMessage[] {
  if (optimistic.length === 0) return optimistic

  const persistedCounts = countPersistedUserMessageSignatures(persisted)
  const consumedAcknowledgements = new Map<string, number>()

  return optimistic.filter((message) => {
    const meta = parseOptimisticUserMessageMeta(message, rememberedMetaById?.get(message.id))
    const signature = meta?.signature ?? userMessageSignature(message)
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
