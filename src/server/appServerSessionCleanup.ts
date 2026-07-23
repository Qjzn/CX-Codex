export type AppServerSessionCleanupDependencies = {
  pendingServerRequests: {
    clear: () => void
  }
  rpcCache: {
    clearSharedReads: () => void
    invalidateThreadList: () => void
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
  dependencies.rpcCache.invalidateThreadList()
  dependencies.threadTokenUsage.clear()
  dependencies.planModeTurns.clearAll()
}
