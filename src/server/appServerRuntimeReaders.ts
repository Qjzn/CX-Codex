import {
  createAppServerLocalRuntimeSnapshotReader,
} from './appServerLocalRuntimeSnapshot.js'
import {
  createAppServerThreadRuntimeSnapshotReader,
} from './appServerThreadRuntimeSnapshot.js'
import type { CachedThreadRead } from './appServerThreadReadCache.js'
import type { ThreadReadCacheSource } from './appServerThreadReadCache.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type {
  RuntimeSnapshotOverlay,
  ThreadRuntimeSnapshot,
} from './runtimeState.js'
import type { RuntimeSnapshotRecord } from './runtimeStore.js'
import {
  createThreadTokenUsageResolver,
  type ThreadTokenUsage,
} from './threadTokenUsage.js'

export type AppServerRuntimeReadersDependencies = {
  rpc(method: string, params: unknown): Promise<unknown>
  observeThreadRead(details: { threadId: string; payload: unknown }): void
  getCachedThreadRead(threadId: string): CachedThreadRead | null
  rememberCachedThreadRead(threadId: string, threadRead: unknown, source?: ThreadReadCacheSource): CachedThreadRead
  snapshotRuntime(threadId: string, overlay?: RuntimeSnapshotOverlay): ThreadRuntimeSnapshot
  observeRuntimeThreadRead(
    threadId: string,
    inProgress: boolean,
    activeTurnId: string,
    updatedAtIso: string,
    source: 'thread-read' | 'cache',
  ): void
  markRuntimeDegraded(threadId: string, reason: string): void
  persistRuntimeSnapshot(threadId: string, snapshot: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot
  listPendingServerRequestsForThread(threadId: string): PendingServerRequest[]
  getThreadTokenUsage(threadId: string): ThreadTokenUsage | null
  getErrorMessage(error: unknown, fallback: string): string
  writeWarning(message: string, details: Record<string, unknown>): void
  getSnapshot(threadId: string): RuntimeSnapshotRecord | null
  getAppServerStartedAtMs(): number
}

export type AppServerRuntimeReaders = {
  readThreadRuntimeSnapshot(threadId: string): Promise<ThreadRuntimeSnapshot>
  readLocalRuntimeSnapshot(threadId: string): ThreadRuntimeSnapshot
  readCachedThreadTokenUsage(threadId: string): Promise<ThreadTokenUsage | null>
}

export function createAppServerRuntimeReaders(
  dependencies: AppServerRuntimeReadersDependencies,
): AppServerRuntimeReaders {
  return {
    readThreadRuntimeSnapshot: createAppServerThreadRuntimeSnapshotReader({
      rpc: dependencies.rpc,
      observeThreadRead: dependencies.observeThreadRead,
      getCachedThreadRead: dependencies.getCachedThreadRead,
      rememberCachedThreadRead: dependencies.rememberCachedThreadRead,
      snapshotRuntime: dependencies.snapshotRuntime,
      observeRuntimeThreadRead: dependencies.observeRuntimeThreadRead,
      markRuntimeDegraded: dependencies.markRuntimeDegraded,
      persistRuntimeSnapshot: dependencies.persistRuntimeSnapshot,
      listPendingServerRequestsForThread: dependencies.listPendingServerRequestsForThread,
      getThreadTokenUsage: dependencies.getThreadTokenUsage,
      getErrorMessage: dependencies.getErrorMessage,
      writeWarning: dependencies.writeWarning,
    }),
    readLocalRuntimeSnapshot: createAppServerLocalRuntimeSnapshotReader({
      getSnapshot: dependencies.getSnapshot,
      listPendingServerRequestsForThread: dependencies.listPendingServerRequestsForThread,
      getThreadTokenUsage: dependencies.getThreadTokenUsage,
      getAppServerStartedAtMs: dependencies.getAppServerStartedAtMs,
      snapshotRuntime: dependencies.snapshotRuntime,
      persistRuntimeSnapshot: dependencies.persistRuntimeSnapshot,
    }),
    readCachedThreadTokenUsage: createThreadTokenUsageResolver({
      getCachedTokenUsage: dependencies.getThreadTokenUsage,
      getCachedThreadRead: dependencies.getCachedThreadRead,
    }),
  }
}
