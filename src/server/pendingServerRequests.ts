export type PendingServerRequest = {
  id: number
  method: string
  params: unknown
  receivedAtIso: string
}

export class PendingServerRequestStore {
  private readonly pendingById = new Map<number, PendingServerRequest>()

  get count(): number {
    return this.pendingById.size
  }

  clear(): void {
    this.pendingById.clear()
  }

  record(requestId: number, method: string, params: unknown): PendingServerRequest {
    const request: PendingServerRequest = {
      id: requestId,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
    }
    this.pendingById.set(requestId, request)
    return request
  }

  consume(requestId: number): PendingServerRequest | null {
    const request = this.pendingById.get(requestId) ?? null
    if (!request) return null
    this.pendingById.delete(requestId)
    return request
  }

  list(): PendingServerRequest[] {
    return Array.from(this.pendingById.values())
  }

  listForThread(threadId: string, readThreadIdFromPayload: (payload: unknown) => string): PendingServerRequest[] {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    return this.list().filter((request) => (
      readThreadIdFromPayload(request.params) === normalizedThreadId
    ))
  }
}
