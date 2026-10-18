export type AppServerSessionCleanupDependencies = {
  pendingServerRequests: {
    clear: () => void
  }
  rpcCache: {
    clearSharedReads: () => void
    invalidateThreadList: () => void
    clearModelList: () => void
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
  dependencies.rpcCache.clearModelList()
  dependencies.threadTokenUsage.clear()
  dependencies.planModeTurns.clearAll()
}
