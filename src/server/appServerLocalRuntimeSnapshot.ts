import { createLocalRuntimeSnapshot } from './appServerRuntimeSnapshotRecovery.js'
import type { ThreadRuntimeSnapshot } from './runtimeState.js'
import type { RuntimeSnapshotRecord } from './runtimeStore.js'

export type AppServerLocalRuntimeSnapshotDependencies = {
  getSnapshot(threadId: string): RuntimeSnapshotRecord | null
  listPendingServerRequestsForThread(threadId: string): ThreadRuntimeSnapshot['pendingServerRequests']
  getThreadTokenUsage(threadId: string): ThreadRuntimeSnapshot['tokenUsage']
  getAppServerStartedAtMs(): number
  snapshotRuntime(
    threadId: string,
    overlay: {
      pendingServerRequests: ThreadRuntimeSnapshot['pendingServerRequests']
      tokenUsage: ThreadRuntimeSnapshot['tokenUsage']
    },
  ): ThreadRuntimeSnapshot
  persistRuntimeSnapshot(threadId: string, snapshot: ThreadRuntimeSnapshot): ThreadRuntimeSnapshot
}

export function readAppServerLocalRuntimeSnapshot(
  threadId: string,
  dependencies: AppServerLocalRuntimeSnapshotDependencies,
): ThreadRuntimeSnapshot {
  const normalizedThreadId = threadId.trim()
  const pendingServerRequests = dependencies.listPendingServerRequestsForThread(normalizedThreadId)
  const tokenUsage = dependencies.getThreadTokenUsage(normalizedThreadId)
  return createLocalRuntimeSnapshot({
    persistedSnapshot: dependencies.getSnapshot(normalizedThreadId)?.snapshot,
    pendingServerRequests,
    tokenUsage,
    appServerStartedAtMs: dependencies.getAppServerStartedAtMs(),
    createCurrentSnapshot: (overlay) => dependencies.snapshotRuntime(normalizedThreadId, overlay),
    persistCurrentSnapshot: (snapshot) => dependencies.persistRuntimeSnapshot(normalizedThreadId, snapshot),
  })
}
