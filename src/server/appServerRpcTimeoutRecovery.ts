export type AppServerRpcTimeoutRecoveryDecision =
  | {
    kind: 'startup-grace'
    processAgeMs: number
    includeTurns: boolean | undefined
  }
  | {
    kind: 'restart'
    timeoutCount: number
    includeTurns: boolean | undefined
  }
  | {
    kind: 'none'
  }

export type AppServerRpcTimeoutRecoveryDependencies = {
  now: () => number
  recordTimeout: (method: string, params: unknown, timeoutMs: number, nowMs: number) => void
  noteRestartableTimeout: (method: string, nowMs: number) => {
    shouldRestart: boolean
    timeoutCount: number
  }
}

export type AppServerRpcTimeoutRecoveryOptions = {
  method: string
  params: unknown
  timeoutMs: number
  startedAtMs: number
  coldStartGraceMs: number
  dependencies: AppServerRpcTimeoutRecoveryDependencies
}

export function createAppServerRpcTimeoutRecoveryDecision({
  method,
  params,
  timeoutMs,
  startedAtMs,
  coldStartGraceMs,
  dependencies,
}: AppServerRpcTimeoutRecoveryOptions): AppServerRpcTimeoutRecoveryDecision {
  const nowMs = dependencies.now()
  dependencies.recordTimeout(method, params, timeoutMs, nowMs)

  const processAgeMs = startedAtMs > 0 ? nowMs - startedAtMs : 0
  const includeTurns = readThreadReadIncludeTurns(method, params)
  if (method !== 'initialize' && processAgeMs < coldStartGraceMs) {
    return {
      kind: 'startup-grace',
      processAgeMs,
      includeTurns,
    }
  }

  const { shouldRestart, timeoutCount } = dependencies.noteRestartableTimeout(method, nowMs)
  if (!shouldRestart) {
    return {
      kind: 'none',
    }
  }

  return {
    kind: 'restart',
    timeoutCount,
    includeTurns,
  }
}

function readThreadReadIncludeTurns(method: string, params: unknown): boolean | undefined {
  if (method !== 'thread/read') return undefined
  const record = params !== null && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : null
  return record?.includeTurns === true
}
