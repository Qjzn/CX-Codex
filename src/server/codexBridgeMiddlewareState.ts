import { AppServerHookDiagnosticsCache } from './appServerHookDiagnostics.js'
import { AppServerNotificationDiagnostics } from './appServerNotificationDiagnostics.js'
import { AppServerStatusDiagnostics } from './appServerStatusDiagnostics.js'
import {
  AppServerThreadListAugmenter,
  createAppServerThreadListRpcResultAugmenter,
} from './appServerThreadListAugment.js'
import { AppServerThreadReadCacheStore } from './appServerThreadReadCache.js'
import {
  getCodexSessionIndexPath,
} from './codexPaths.js'
import { readMergedPinnedThreadIds } from './pinnedThreads.js'
import {
  readItemIdFromPayload,
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import { readThreadInProgressFromThreadReadPayload } from './appServerThreadPayload.js'
import { getErrorMessage } from './errorMessage.js'
import { RuntimeStateStore } from './runtimeState.js'
import { RuntimeStore } from './runtimeStore.js'
import { createThreadSearchIndexStore } from './threadSearchIndex.js'
import { readThreadTitlesFromSessionIndex } from './threadTitleCache.js'
import { WindowsSandboxReadinessCache } from './windowsSandboxDiagnostics.js'

const supplementalThreadListAugmenter = new AppServerThreadListAugmenter()
const SIDEBAR_SESSION_INDEX_SUPPLEMENT_LIMIT = 80

type CodexBridgeMiddlewareStateAppServer = {
  rpc(method: string, params: unknown): Promise<unknown>
}

export function createCodexBridgeMiddlewareState(
  appServer: CodexBridgeMiddlewareStateAppServer,
  options: { runtimeDatabasePath?: string } = {},
) {
  const readSupplementalThreadIds = async (): Promise<string[]> => {
    const [sessionIndexCache, pinnedThreadIds] = await Promise.all([
      readThreadTitlesFromSessionIndex(getCodexSessionIndexPath()),
      readMergedPinnedThreadIds(),
    ])

    const seen = new Set<string>()
    const result: string[] = []
    for (const rawThreadId of [
      ...pinnedThreadIds,
      ...sessionIndexCache.order.slice(0, SIDEBAR_SESSION_INDEX_SUPPLEMENT_LIMIT),
    ]) {
      const threadId = rawThreadId.trim()
      if (!threadId || seen.has(threadId)) continue
      seen.add(threadId)
      result.push(threadId)
    }
    return result
  }

  const threadSearchIndexStore = createThreadSearchIndexStore({
    listThreads: (params) => appServer.rpc('thread/list', params),
    getSessionIndexPath: getCodexSessionIndexPath,
    readThreadTitlesFromSessionIndex,
  })
  const threadReadCacheStore = new AppServerThreadReadCacheStore()
  const augmentThreadListRpcResult = createAppServerThreadListRpcResultAugmenter({
    augmenter: supplementalThreadListAugmenter,
    readSupplementalThreadIds,
    rpc: (method, params) => appServer.rpc(method, params),
  })
  const runtimeStore = new RuntimeStore(options.runtimeDatabasePath)
  const runtimeStateStore = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload,
    getErrorMessage,
  }, {
    loadPersistedSnapshot: (threadId) => runtimeStore.getSnapshot(threadId)?.snapshot ?? null,
  })

  return {
    threadSearchIndexStore,
    threadReadCacheStore,
    augmentThreadListRpcResult,
    runtimeStateStore,
    runtimeStore,
    notificationDiagnostics: new AppServerNotificationDiagnostics(),
    statusDiagnostics: new AppServerStatusDiagnostics(),
    hookDiagnosticsCache: new AppServerHookDiagnosticsCache(),
    windowsSandboxReadinessCache: new WindowsSandboxReadinessCache(),
  }
}
