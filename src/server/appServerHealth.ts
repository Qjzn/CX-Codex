import type { AppServerLaunchPolicySnapshot } from './appServerLaunch.js'
import type { RpcDiagnostics } from './appServerRpcDiagnostics.js'

export type AppServerHealth = {
  running: boolean
  initialized: boolean
  stopping: boolean
  pid: number | null
  command?: string
  startedAtIso?: string
  pendingRpcCount: number
  queuedRpcCount: number
  pendingServerRequestCount: number
  activePlanModeTurnCount: number
  restartProtection?: {
    blockingRequestCount: number
  }
  launchPolicy: AppServerLaunchPolicySnapshot
  rpcDiagnostics?: RpcDiagnostics
}

export function createAppServerHealthSnapshot(input: AppServerHealth): AppServerHealth {
  return {
    running: input.running,
    initialized: input.initialized,
    stopping: input.stopping,
    pid: input.pid,
    ...(input.command ? { command: input.command } : {}),
    ...(input.startedAtIso ? { startedAtIso: input.startedAtIso } : {}),
    pendingRpcCount: input.pendingRpcCount,
    queuedRpcCount: input.queuedRpcCount,
    pendingServerRequestCount: input.pendingServerRequestCount,
    activePlanModeTurnCount: input.activePlanModeTurnCount,
    ...(input.restartProtection ? { restartProtection: input.restartProtection } : {}),
    launchPolicy: input.launchPolicy,
    rpcDiagnostics: input.rpcDiagnostics,
  }
}
