import { writeBridgeLog } from './bridgeLog.js'

export type RpcDiagnosticRecord = {
  method: string
  atIso: string
  durationMs: number
  includeTurns?: boolean
  outcome?: string
}

export type RpcDiagnostics = {
  activeRpcCalls: number
  pendingRpcCount: number
  queuedRpcCount: number
  queuePeakCount: number
  queuePeakAtIso: string | null
  recentSlowRpc: RpcDiagnosticRecord[]
  recentTimeouts: RpcDiagnosticRecord[]
}

type RpcParamsReader = {
  isHeavyThreadRead: (method: string, params: unknown) => boolean | undefined
}

type SlowRpcDetails = {
  outcome?: unknown
  [key: string]: unknown
}

const APP_SERVER_RPC_DIAGNOSTIC_LIMIT = 20

export class AppServerRpcDiagnostics {
  private activeRpcCalls = 0
  private lastRpcQueueWarnAtMs = 0
  private queuePeakCount = 0
  private queuePeakAtIso: string | null = null
  private recentTimeoutsAtMs: number[] = []
  private readonly recentSlowRpcRecords: RpcDiagnosticRecord[] = []
  private readonly recentTimeoutRecords: RpcDiagnosticRecord[] = []

  constructor(
    private readonly reader: RpcParamsReader,
    private readonly options: {
      slowWarnMs: number
      queueWarnSize: number
      queueWarnIntervalMs: number
      timeoutRestartWindowMs: number
      timeoutRestartThreshold: number
    },
  ) {}

  get activeCount(): number {
    return this.activeRpcCalls
  }

  resetTimeoutWindow(): void {
    this.recentTimeoutsAtMs = []
  }

  incrementActive(): void {
    this.activeRpcCalls += 1
  }

  decrementActive(): void {
    this.activeRpcCalls = Math.max(0, this.activeRpcCalls - 1)
  }

  recordQueueDepth(queuedRpcCount: number, queuedAtMs: number): void {
    if (queuedRpcCount <= this.queuePeakCount) return
    this.queuePeakCount = queuedRpcCount
    this.queuePeakAtIso = new Date(queuedAtMs).toISOString()
  }

  maybeWarnQueueBacklog(method: string, params: unknown, queuedRpcCount: number, queuedAtMs: number): void {
    const shouldWarn =
      queuedRpcCount >= this.options.queueWarnSize &&
      queuedAtMs - this.lastRpcQueueWarnAtMs >= this.options.queueWarnIntervalMs
    if (!shouldWarn) return

    this.lastRpcQueueWarnAtMs = queuedAtMs
    writeBridgeLog('warn', 'App-server RPC queue is backing up', {
      queuedRpcCount,
      activeRpcCalls: this.activeRpcCalls,
      method,
      includeTurns: this.reader.isHeavyThreadRead(method, params),
    })
  }

  logSlowRpc(method: string, startedAtMs: number, params: unknown, details: SlowRpcDetails = {}): void {
    const durationMs = Date.now() - startedAtMs
    if (durationMs < this.options.slowWarnMs) return

    this.recentSlowRpcRecords.unshift({
      method,
      atIso: new Date().toISOString(),
      durationMs,
      includeTurns: this.reader.isHeavyThreadRead(method, params),
      outcome: typeof details.outcome === 'string' ? details.outcome : undefined,
    })
    this.recentSlowRpcRecords.splice(APP_SERVER_RPC_DIAGNOSTIC_LIMIT)

    writeBridgeLog('warn', 'Slow app-server RPC', {
      method,
      durationMs,
      includeTurns: this.reader.isHeavyThreadRead(method, params),
      ...details,
    })
  }

  recordTimeout(method: string, params: unknown, timeoutMs: number, now = Date.now()): void {
    this.recentTimeoutRecords.unshift({
      method,
      atIso: new Date(now).toISOString(),
      durationMs: timeoutMs,
      includeTurns: this.reader.isHeavyThreadRead(method, params),
      outcome: 'timeout',
    })
    this.recentTimeoutRecords.splice(APP_SERVER_RPC_DIAGNOSTIC_LIMIT)
  }

  noteRestartableTimeout(method: string, now = Date.now()): { shouldRestart: boolean; timeoutCount: number } {
    if (method === 'thread/list' || method === 'thread/read') {
      return { shouldRestart: false, timeoutCount: this.recentTimeoutsAtMs.length }
    }

    this.recentTimeoutsAtMs = [
      ...this.recentTimeoutsAtMs.filter((timestamp) => now - timestamp <= this.options.timeoutRestartWindowMs),
      now,
    ]
    const shouldRestart =
      method === 'initialize' ||
      this.recentTimeoutsAtMs.length >= this.options.timeoutRestartThreshold
    return { shouldRestart, timeoutCount: this.recentTimeoutsAtMs.length }
  }

  snapshot(pendingRpcCount: number, queuedRpcCount: number): RpcDiagnostics {
    return {
      activeRpcCalls: this.activeRpcCalls,
      pendingRpcCount,
      queuedRpcCount,
      queuePeakCount: this.queuePeakCount,
      queuePeakAtIso: this.queuePeakAtIso,
      recentSlowRpc: [...this.recentSlowRpcRecords],
      recentTimeouts: [...this.recentTimeoutRecords],
    }
  }
}
