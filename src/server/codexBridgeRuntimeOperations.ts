import {
  createAppServerRuntimeActions,
  type AppServerRuntimeActions,
  type AppServerRuntimeActionsDependencies,
} from './appServerRuntimeActions.js'
import {
  createAppServerRuntimeReaders,
  type AppServerRuntimeReaders,
} from './appServerRuntimeReaders.js'
import {
  createAppServerRuntimeReconciliation,
  type AppServerRuntimeReconciliation,
} from './appServerRuntimeReconciliation.js'
import { createAppServerRuntimeSnapshotPersister } from './appServerRuntimeSnapshotPersistence.js'
import type { CachedThreadRead } from './appServerThreadReadCache.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type {
  RuntimeSnapshotOverlay,
  ThreadRuntimeSnapshot,
} from './runtimeState.js'
import type { RuntimeRequestRecord, RuntimeSnapshotRecord } from './runtimeStore.js'
import type { ThreadTokenUsage } from './threadTokenUsage.js'

type CodexBridgeRuntimeAppServer = {
  rpc(method: string, params: unknown): Promise<unknown>
  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[]
  getThreadTokenUsage(threadId: string): ThreadTokenUsage | null
  getStartedAtMs(): number
  markPlanModeTurn(threadId: string, turnId?: string): void
  clearPlanModeTurn(threadId: string, turnId?: string): void
}

type RuntimeStoreForOperations = {
  createRequest(record: Parameters<AppServerRuntimeActionsDependencies['createRequest']>[0]): RuntimeRequestRecord
  updateRequest(
    requestId: string,
    patch: Parameters<AppServerRuntimeActionsDependencies['updateRequest']>[1],
  ): RuntimeRequestRecord | null
  getRequest(requestId: string): RuntimeRequestRecord | null
  getSnapshot(threadId: string): RuntimeSnapshotRecord | null
  upsertSnapshot(snapshot: RuntimeSnapshotRecord): RuntimeSnapshotRecord
} & Parameters<typeof createAppServerRuntimeReconciliation>[0]['runtimeStore']

type RuntimeStateStoreForOperations = {
  snapshot(threadId: string, overlay?: RuntimeSnapshotOverlay): ThreadRuntimeSnapshot
  observeThreadRead(
    threadId: string,
    inProgress: boolean,
    activeTurnId: string,
    updatedAtIso: string,
    source: 'thread-read' | 'cache',
  ): void
  markDegraded(threadId: string, reason: string): void
  markStarting(threadId: string): void
  markRunning(threadId: string, turnId?: string): void
  markStartUncertain(threadId: string, lastError?: string | null): void
  markStopping(threadId: string): void
  markInterrupted(threadId: string, lastError?: string | null): void
  markStopUncertain(threadId: string, lastError?: string | null): void
}

type ThreadReadCacheStoreForOperations = {
  get(threadId: string): CachedThreadRead | null
  remember(threadId: string, threadRead: unknown): CachedThreadRead
}

export type CodexBridgeRuntimeOperationsDependencies = {
  appServer: CodexBridgeRuntimeAppServer
  runtimeStore: RuntimeStoreForOperations
  runtimeStateStore: RuntimeStateStoreForOperations
  threadReadCacheStore: ThreadReadCacheStoreForOperations
  threadSearchIndexStore: {
    clear(): void
  }
  statusDiagnostics: {
    observeThreadRead(details: { threadId: string; payload: unknown }): void
  }
  getErrorMessage(error: unknown, fallback: string): string
  writeWarning(message: string, details: Record<string, unknown>): void
  writeReconcileFailure(details: {
    threadId: string
    requestId: string
    status: RuntimeRequestRecord['status']
    error: string
  }): void
}

export type CodexBridgeRuntimeOperations = AppServerRuntimeReaders
  & AppServerRuntimeReconciliation
  & AppServerRuntimeActions
  & {
    persistRuntimeSnapshot(threadId: string, snapshot?: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot
  }

export function createCodexBridgeRuntimeOperations(
  dependencies: CodexBridgeRuntimeOperationsDependencies,
): CodexBridgeRuntimeOperations {
  const { appServer, runtimeStore, runtimeStateStore, threadReadCacheStore } = dependencies

  const persistRuntimeSnapshot = createAppServerRuntimeSnapshotPersister({
    snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
    listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
    getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
    upsertSnapshot: (nextSnapshot) => runtimeStore.upsertSnapshot(nextSnapshot),
  })

  const runtimeReaders = createAppServerRuntimeReaders({
    rpc: (method, params) => appServer.rpc(method, params),
    observeThreadRead: (details) => dependencies.statusDiagnostics.observeThreadRead(details),
    getCachedThreadRead: (normalizedThreadId) => threadReadCacheStore.get(normalizedThreadId),
    rememberCachedThreadRead: (normalizedThreadId, threadRead) => threadReadCacheStore.remember(normalizedThreadId, threadRead),
    snapshotRuntime: (normalizedThreadId, overlay) => runtimeStateStore.snapshot(normalizedThreadId, overlay),
    observeRuntimeThreadRead: (normalizedThreadId, inProgress, activeTurnId, updatedAtIso, source) => {
      runtimeStateStore.observeThreadRead(normalizedThreadId, inProgress, activeTurnId, updatedAtIso, source)
    },
    markRuntimeDegraded: (normalizedThreadId, reason) => runtimeStateStore.markDegraded(normalizedThreadId, reason),
    persistRuntimeSnapshot,
    listPendingServerRequestsForThread: (normalizedThreadId) => appServer.listPendingServerRequestsForThread(normalizedThreadId),
    getThreadTokenUsage: (normalizedThreadId) => appServer.getThreadTokenUsage(normalizedThreadId),
    getErrorMessage: dependencies.getErrorMessage,
    writeWarning: dependencies.writeWarning,
    getSnapshot: (normalizedThreadId) => runtimeStore.getSnapshot(normalizedThreadId),
    getAppServerStartedAtMs: () => appServer.getStartedAtMs(),
  })

  const runtimeReconciliation = createAppServerRuntimeReconciliation({
    readThreadRuntimeSnapshot: runtimeReaders.readThreadRuntimeSnapshot,
    runtimeStore,
    getErrorMessage: dependencies.getErrorMessage,
    writeReconcileFailure: dependencies.writeReconcileFailure,
  })

  const runtimeActions = createAppServerRuntimeActions({
    createRequest: (record) => runtimeStore.createRequest(record),
    updateRequest: (requestId, patch) => runtimeStore.updateRequest(requestId, patch),
    getRequest: (requestId) => runtimeStore.getRequest(requestId),
    rpc: (method, params) => appServer.rpc(method, params),
    clearThreadSearchIndex: () => dependencies.threadSearchIndexStore.clear(),
    markStarting: (threadId) => runtimeStateStore.markStarting(threadId),
    markRunning: (threadId, turnId = '') => runtimeStateStore.markRunning(threadId, turnId),
    markStartUncertain: (threadId, lastError = null) => runtimeStateStore.markStartUncertain(threadId, lastError),
    persistRuntimeSnapshot,
    markPlanModeTurn: (threadId, turnId = '') => appServer.markPlanModeTurn(threadId, turnId),
    markStopping: (threadId) => runtimeStateStore.markStopping(threadId),
    markInterrupted: (threadId, lastError = null) => runtimeStateStore.markInterrupted(threadId, lastError),
    markStopUncertain: (threadId, lastError = null) => runtimeStateStore.markStopUncertain(threadId, lastError),
    clearPlanModeTurn: (threadId, turnId = '') => appServer.clearPlanModeTurn(threadId, turnId),
    getErrorMessage: dependencies.getErrorMessage,
  })

  return {
    persistRuntimeSnapshot,
    ...runtimeReaders,
    ...runtimeReconciliation,
    ...runtimeActions,
  }
}
