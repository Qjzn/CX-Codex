import type { AppServerRpcDiagnostics } from './appServerRpcDiagnostics.js'

type QueuedRpcTask = {
  method: string
  params: unknown
  priority: number
  queuedAtMs: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type RpcQueueOptions = {
  maxSize: number
  maxInFlight: number
  diagnostics: AppServerRpcDiagnostics
  execute: (method: string, params: unknown) => Promise<unknown>
}

export function getAppServerRpcQueuePriority(method: string, _params: unknown): number {
  if (
    method === 'turn/start' ||
    method === 'turn/interrupt' ||
    method === 'thread/start' ||
    method === 'thread/resume' ||
    method === 'server/request/respond'
  ) {
    return 0
  }

  if (method === 'thread/read') {
    return 1
  }

  if (method === 'thread/list') {
    return 4
  }

  if (method === 'model/list' || method === 'skills/list' || method === 'account/rateLimits/read') {
    return 5
  }

  return 1
}

export class AppServerRpcQueue {
  private readonly queuedRpcCalls: QueuedRpcTask[] = []

  constructor(private readonly options: RpcQueueOptions) {}

  get count(): number {
    return this.queuedRpcCalls.length
  }

  enqueue(method: string, params: unknown): Promise<unknown> {
    if (this.queuedRpcCalls.length >= this.options.maxSize) {
      return Promise.reject(new Error(`codex app-server RPC queue is full (${this.options.maxSize})`))
    }

    return new Promise((resolve, reject) => {
      const queuedAtMs = Date.now()
      this.queuedRpcCalls.push({
        method,
        params,
        priority: getAppServerRpcQueuePriority(method, params),
        queuedAtMs,
        resolve,
        reject,
      })
      this.queuedRpcCalls.sort((left, right) => {
        if (left.priority !== right.priority) return left.priority - right.priority
        return left.queuedAtMs - right.queuedAtMs
      })
      this.options.diagnostics.recordQueueDepth(this.queuedRpcCalls.length, queuedAtMs)
      this.options.diagnostics.maybeWarnQueueBacklog(method, params, this.queuedRpcCalls.length, queuedAtMs)

      this.drain()
    })
  }

  rejectAll(error: Error): void {
    for (const request of this.queuedRpcCalls.splice(0)) {
      request.reject(error)
    }
  }

  private drain(): void {
    while (this.options.diagnostics.activeCount < this.options.maxInFlight && this.queuedRpcCalls.length > 0) {
      const request = this.queuedRpcCalls.shift()
      if (!request) return

      this.options.diagnostics.incrementActive()
      let execution: Promise<unknown>
      try {
        execution = this.options.execute(request.method, request.params)
      } catch (error) {
        execution = Promise.reject(error)
      }

      void execution
        .then(request.resolve, request.reject)
        .finally(() => {
          this.options.diagnostics.decrementActive()
          this.drain()
        })
    }
  }
}
