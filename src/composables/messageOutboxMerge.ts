export type MessageOutboxMergeEntry = {
  clientMessageId: string
  createdAtMs: number
  updatedAtMs: number
}

export type MessageOutboxRemoval = {
  clientMessageId: string
  removedAtMs: number
}

export type MessageOutboxMergeState<T extends MessageOutboxMergeEntry> = {
  entries: T[]
  removals: MessageOutboxRemoval[]
}

export function mergeMessageOutboxEntries<T extends MessageOutboxMergeEntry>(
  currentEntries: readonly T[],
  persistedEntries: readonly T[],
): T[] {
  const mergedByClientId = new Map<string, T>()
  for (const entry of [...persistedEntries, ...currentEntries]) {
    const current = mergedByClientId.get(entry.clientMessageId)
    if (!current || entry.updatedAtMs >= current.updatedAtMs) {
      mergedByClientId.set(entry.clientMessageId, entry)
    }
  }
  return [...mergedByClientId.values()].sort((left, right) => left.createdAtMs - right.createdAtMs)
}

export function mergeMessageOutboxState<T extends MessageOutboxMergeEntry>(
  currentEntries: readonly T[],
  persistedEntries: readonly T[],
  currentRemovals: readonly MessageOutboxRemoval[],
  persistedRemovals: readonly MessageOutboxRemoval[],
): MessageOutboxMergeState<T> {
  const removedAtByClientId = new Map<string, number>()
  for (const removal of [...persistedRemovals, ...currentRemovals]) {
    const currentRemovedAtMs = removedAtByClientId.get(removal.clientMessageId) ?? 0
    if (removal.removedAtMs >= currentRemovedAtMs) {
      removedAtByClientId.set(removal.clientMessageId, removal.removedAtMs)
    }
  }

  const entries = mergeMessageOutboxEntries(currentEntries, persistedEntries)
    .filter((entry) => (removedAtByClientId.get(entry.clientMessageId) ?? 0) < entry.updatedAtMs)

  return {
    entries,
    removals: [...removedAtByClientId.entries()]
      .map(([clientMessageId, removedAtMs]) => ({ clientMessageId, removedAtMs }))
      .sort((left, right) => left.removedAtMs - right.removedAtMs),
  }
}
