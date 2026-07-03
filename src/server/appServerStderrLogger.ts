import { writeBridgeLog } from './bridgeLog.js'

export type AppServerStderrLogEntry = {
  message: string
  suppressedCount?: number
}

type AppServerStderrLoggerOptions = {
  intervalMs?: number
  maxMessageLength?: number
  now?: () => number
  writeLog?: (entry: AppServerStderrLogEntry) => void
}

export class AppServerStderrLogger {
  private readonly intervalMs: number
  private readonly maxMessageLength: number
  private readonly now: () => number
  private readonly writeLog: (entry: AppServerStderrLogEntry) => void
  private lastLogAtMs = 0
  private suppressedCount = 0

  constructor(options: AppServerStderrLoggerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30_000
    this.maxMessageLength = options.maxMessageLength ?? 1200
    this.now = options.now ?? Date.now
    this.writeLog = options.writeLog ?? ((entry) => {
      writeBridgeLog('warn', 'Codex app-server stderr', entry)
    })
  }

  log(message: string): boolean {
    const now = this.now()
    if (now - this.lastLogAtMs < this.intervalMs) {
      this.suppressedCount += 1
      return false
    }

    const suppressedCount = this.suppressedCount
    this.lastLogAtMs = now
    this.suppressedCount = 0
    const entry: AppServerStderrLogEntry = {
      message: message.slice(0, this.maxMessageLength),
    }
    if (suppressedCount > 0) {
      entry.suppressedCount = suppressedCount
    }
    this.writeLog(entry)
    return true
  }

  get pendingSuppressedCount(): number {
    return this.suppressedCount
  }
}
