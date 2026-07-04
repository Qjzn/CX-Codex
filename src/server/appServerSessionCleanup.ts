export type AppServerSessionCleanupDependencies = {
  pendingServerRequests: {
    clear: () => void
  }
  rpcCache: {
    clearSharedReads: () => void
    clearThreadList: () => void
  }
  threadTokenUsage: {
    clear: () => void
  }
  planModeTurns: {
    clearAll: () => void
  }
}

export function clearAppServerSessionStores(dependencies: AppServerSessionCleanupDependencies): void {
  dependencies.pendingServerRequests.clear()
  dependencies.rpcCache.clearSharedReads()
  dependencies.rpcCache.clearThreadList()
  dependencies.threadTokenUsage.clear()
  dependencies.planModeTurns.clearAll()
}
