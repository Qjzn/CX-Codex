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

type CodexBridgeMiddlewareStateAppServer = {
  rpc(method: string, params: unknown): Promise<unknown>
}

export function createCodexBridgeMiddlewareState(
  appServer: CodexBridgeMiddlewareStateAppServer,
) {
  const threadSearchIndexStore = createThreadSearchIndexStore({
    listThreads: (params) => appServer.rpc('thread/list', params),
    getSessionIndexPath: getCodexSessionIndexPath,
    readThreadTitlesFromSessionIndex,
  })
  const threadReadCacheStore = new AppServerThreadReadCacheStore()
  const augmentThreadListRpcResult = createAppServerThreadListRpcResultAugmenter({
    augmenter: supplementalThreadListAugmenter,
    readPinnedThreadIds: readMergedPinnedThreadIds,
    rpc: (method, params) => appServer.rpc(method, params),
  })
  const runtimeStateStore = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload,
    getErrorMessage,
  })

  return {
    threadSearchIndexStore,
    threadReadCacheStore,
    augmentThreadListRpcResult,
    runtimeStateStore,
    runtimeStore: new RuntimeStore(),
    notificationDiagnostics: new AppServerNotificationDiagnostics(),
    statusDiagnostics: new AppServerStatusDiagnostics(),
    hookDiagnosticsCache: new AppServerHookDiagnosticsCache(),
    windowsSandboxReadinessCache: new WindowsSandboxReadinessCache(),
  }
}
