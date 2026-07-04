export type PendingAppServerRpc = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  method: string
  params: unknown
  startedAtMs: number
  timeoutId: ReturnType<typeof setTimeout>
}

export class AppServerPendingRpcStore {
  private readonly pending = new Map<number, PendingAppServerRpc>()

  get count(): number {
    return this.pending.size
  }

  has(id: number): boolean {
    return this.pending.has(id)
  }

  record(id: number, request: PendingAppServerRpc): void {
    this.pending.set(id, request)
  }

  finalize(id: number): PendingAppServerRpc | null {
    const pendingRequest = this.pending.get(id) ?? null
    if (!pendingRequest) return null
    this.pending.delete(id)
    clearTimeout(pendingRequest.timeoutId)
    return pendingRequest
  }

  rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeoutId)
      request.reject(error)
    }
    this.pending.clear()
  }
}
