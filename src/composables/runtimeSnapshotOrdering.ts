export type RuntimeSnapshotVersion = {
  lastEventSeq: number
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
