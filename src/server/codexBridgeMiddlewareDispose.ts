export type CodexBridgeMiddlewareDisposeDependencies = {
  runtimeReconcileScheduler: {
    dispose: () => void
  }
  threadSearchIndexStore: {
    clear: () => void
  }
  bridgeNotificationListeners: {
    clear: () => void
  }
  unsubscribeAppServerNotifications: () => void
  notificationDiagnostics: {
    clear: () => void
  }
  statusDiagnostics: {
    clear: () => void
  }
  hookDiagnosticsCache: {
    clear: () => void
  }
  windowsSandboxReadinessCache: {
    clear: () => void
  }
  mobilePushCoordinator: {
    dispose: () => void
  }
  runtimeStore: {
    close: () => void
  }
  appServer: {
    dispose: () => void
  }
}

export function disposeCodexBridgeMiddlewareResources(
  dependencies: CodexBridgeMiddlewareDisposeDependencies,
): void {
  dependencies.runtimeReconcileScheduler.dispose()
  dependencies.threadSearchIndexStore.clear()
  dependencies.bridgeNotificationListeners.clear()
  dependencies.unsubscribeAppServerNotifications()
  dependencies.notificationDiagnostics.clear()
  dependencies.statusDiagnostics.clear()
  dependencies.hookDiagnosticsCache.clear()
  dependencies.windowsSandboxReadinessCache.clear()
  dependencies.mobilePushCoordinator.dispose()
  dependencies.runtimeStore.close()
  dependencies.appServer.dispose()
}
