import type { AppServerLaunchPolicySnapshot } from './appServerLaunch.js'
import type { RpcDiagnostics } from './appServerRpcDiagnostics.js'

export type AppServerHealth = {
  running: boolean
  initialized: boolean
  stopping: boolean
  pid: number | null
  pendingRpcCount: number
  queuedRpcCount: number
  pendingServerRequestCount: number
  activePlanModeTurnCount: number
  launchPolicy: AppServerLaunchPolicySnapshot
  rpcDiagnostics?: RpcDiagnostics
}

export function createAppServerHealthSnapshot(input: AppServerHealth): AppServerHealth {
  return {
    running: input.running,
    initialized: input.initialized,
    stopping: input.stopping,
    pid: input.pid,
    pendingRpcCount: input.pendingRpcCount,
    queuedRpcCount: input.queuedRpcCount,
    pendingServerRequestCount: input.pendingServerRequestCount,
    activePlanModeTurnCount: input.activePlanModeTurnCount,
    launchPolicy: input.launchPolicy,
    rpcDiagnostics: input.rpcDiagnostics,
  }
}
