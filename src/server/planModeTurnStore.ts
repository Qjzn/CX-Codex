export type PlanModeTurnRecord = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type PlanModeTurnStoreOptions = {
  now?: () => number
}

export class PlanModeTurnStore {
  private readonly now: () => number
  private readonly recordsByThreadId = new Map<string, PlanModeTurnRecord>()

  constructor(options: PlanModeTurnStoreOptions = {}) {
    this.now = options.now ?? Date.now
  }

  mark(threadId: string, turnId = ''): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    this.recordsByThreadId.set(normalizedThreadId, {
      threadId: normalizedThreadId,
      turnId: turnId.trim(),
      startedAtMs: this.now(),
    })
  }

  clear(threadId: string, turnId = ''): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    const current = this.recordsByThreadId.get(normalizedThreadId)
    if (!current) return
    const normalizedTurnId = turnId.trim()
    if (normalizedTurnId && current.turnId && current.turnId !== normalizedTurnId) return
    this.recordsByThreadId.delete(normalizedThreadId)
  }

  clearByThreadOrTurn(threadId: string, turnId = ''): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    if (normalizedThreadId) {
      this.clear(normalizedThreadId, normalizedTurnId)
      return
    }
    if (!normalizedTurnId) return

    for (const [activeThreadId, activePlan] of this.recordsByThreadId.entries()) {
      if (activePlan.turnId && activePlan.turnId === normalizedTurnId) {
        this.recordsByThreadId.delete(activeThreadId)
      }
    }
  }

  isActiveRequest(threadId: string, turnId = ''): boolean {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return false
    const activePlan = this.recordsByThreadId.get(normalizedThreadId)
    if (!activePlan) return false
    const normalizedTurnId = turnId.trim()
    if (activePlan.turnId && normalizedTurnId && activePlan.turnId !== normalizedTurnId) return false
    return true
  }

  clearAll(): void {
    this.recordsByThreadId.clear()
  }

  get count(): number {
    return this.recordsByThreadId.size
  }

  list(): PlanModeTurnRecord[] {
    return Array.from(this.recordsByThreadId.values())
  }
}
