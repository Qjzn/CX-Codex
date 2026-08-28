export type QueuedMessageTransferSnapshot<T> = {
  index: number
  message: T
}

export type QueuedMessageTransferOutcome = 'delivered' | 'restored' | 'failed'

export function restoreQueuedMessageAtIndex<T extends { id: string }>(
  currentQueue: T[],
  snapshot: QueuedMessageTransferSnapshot<T>,
): T[] {
  if (currentQueue.some((message) => message.id === snapshot.message.id)) return currentQueue
  const restoreIndex = Math.max(0, Math.min(snapshot.index, currentQueue.length))
  const restoredQueue = [...currentQueue]
  restoredQueue.splice(restoreIndex, 0, snapshot.message)
  return restoredQueue
}

export async function transferQueuedMessageWithRecovery<T>(args: {
  snapshot: QueuedMessageTransferSnapshot<T>
  deliver: (message: T) => Promise<void>
  restore: (snapshot: QueuedMessageTransferSnapshot<T>, error: unknown) => boolean | Promise<boolean>
}): Promise<QueuedMessageTransferOutcome> {
  try {
    await args.deliver(args.snapshot.message)
    return 'delivered'
  } catch (error) {
    return await args.restore(args.snapshot, error) ? 'restored' : 'failed'
  }
}
