/** Delivery evidence only. Never pair user messages by their text or timestamps. */
export function readUserMessageClientId(message: Record<string, unknown>): string {
  for (const value of [message.clientId, message.clientMessageId, message.clientUserMessageId]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export type UserMessageIdentityCandidate = {
  id: string
  turnId?: string
  clientMessageId?: string | null
  itemAliases?: readonly string[]
}

export type UserMessageIdentityEvidence = {
  itemId?: string
  turnId?: string
  clientMessageId?: string | null
}

export function userMessageDisplayId(message: {
  id: string
  clientMessageId?: string | null
  displayMessageId?: string
}): string {
  return message.displayMessageId || (message.clientMessageId ? `client:${message.clientMessageId}` : message.id)
}

export function findUserMessageIdentityMatch<T extends UserMessageIdentityCandidate>(
  candidates: readonly T[],
  evidence: UserMessageIdentityEvidence,
): T | undefined {
  const compatible = (candidate: T): boolean => !candidate.clientMessageId
    || !evidence.clientMessageId || candidate.clientMessageId === evidence.clientMessageId
  if (evidence.itemId) {
    const items = candidates.filter((candidate) => (candidate.id === evidence.itemId || candidate.itemAliases?.includes(evidence.itemId!))
      && (!evidence.turnId || candidate.turnId === evidence.turnId) && compatible(candidate))
    return items.length === 1 ? items[0] : undefined
  }
  // turn/start can also steer an active turn. A returned turn ID does not
  // identify its first user, particularly in a partial snapshot.
  if (evidence.clientMessageId) {
    const items = candidates.filter((candidate) => candidate.clientMessageId === evidence.clientMessageId)
    return items.length === 1 ? items[0] : undefined
  }
  return undefined
}
