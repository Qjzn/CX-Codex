export type AppServerProcessCleanupDependencies = {
  pendingRpcStore: {
    rejectAll: (error: Error) => void
  }
  rejectQueuedRpcCalls: (error: Error) => void
  clearSessionStores: () => void
}

export type AppServerProcessCleanupOptions = {
  rejectQueuedRpcCalls?: boolean
}

export function cleanupAppServerProcessRuntime(
  error: Error,
  dependencies: AppServerProcessCleanupDependencies,
  options: AppServerProcessCleanupOptions = {},
): void {
  dependencies.pendingRpcStore.rejectAll(error)
  if (options.rejectQueuedRpcCalls !== false) {
    dependencies.rejectQueuedRpcCalls(error)
  }
  dependencies.clearSessionStores()
}
