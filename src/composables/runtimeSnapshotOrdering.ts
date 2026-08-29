export type RuntimeSnapshotVersion = {
  lastEventSeq: number
}

export type RuntimeSnapshotSummaryVersion = RuntimeSnapshotVersion & {
  latestReplyEventSeq?: number
}

export function shouldApplyRuntimeSnapshotVersion(
  current: RuntimeSnapshotVersion | null | undefined,
  incoming: RuntimeSnapshotVersion,
): boolean {
  const currentSeq = Number.isFinite(current?.lastEventSeq) ? Math.max(0, Math.trunc(current?.lastEventSeq ?? 0)) : 0
  const incomingSeq = Number.isFinite(incoming.lastEventSeq) ? Math.max(0, Math.trunc(incoming.lastEventSeq)) : 0
  if (currentSeq === 0 || incomingSeq === 0) return true
  return incomingSeq >= currentSeq
}

export function resetRuntimeSnapshotVersionMap<T extends RuntimeSnapshotSummaryVersion>(
  summaries: Record<string, T>,
): Record<string, T> {
  if (Object.keys(summaries).length === 0) return summaries
  return Object.fromEntries(
    Object.entries(summaries).map(([threadId, summary]) => [threadId, {
      ...summary,
      lastEventSeq: 0,
      ...('latestReplyEventSeq' in summary ? { latestReplyEventSeq: 0 } : {}),
    }]),
  ) as Record<string, T>
}

export function shouldApplyRuntimeTerminalTurn(
  currentTurnId: string | null | undefined,
  eventTurnId: string | null | undefined,
): boolean {
  const current = currentTurnId?.trim() ?? ''
  const incoming = eventTurnId?.trim() ?? ''
  return !current || !incoming || current === incoming
}
