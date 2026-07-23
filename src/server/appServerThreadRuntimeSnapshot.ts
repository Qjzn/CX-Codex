import { trimThreadTurnsInRpcResult } from './appServerRpcResult.js'
import {
  isCachedThreadReadStaleForRuntime,
  type CachedThreadRead,
  type ThreadReadCacheSource,
} from './appServerThreadReadCache.js'
import {
  readActiveTurnIdFromThreadReadPayload,
  readThreadInProgressFromThreadReadPayload,
  readThreadSessionPathFromThreadReadPayload,
  readThreadUpdatedAtIsoFromThreadReadPayload,
} from './appServerThreadPayload.js'
import { readThreadReadFromSessionLog } from './appServerSessionLogThreadRead.js'
import {
  isRpcTimeoutError,
  isThreadMaterializingError,
} from './appServerRpcErrors.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type {
  RuntimeSnapshotOverlay,
  ThreadRuntimeSnapshot,
} from './runtimeState.js'
import {
  readThreadTokenUsageFromThreadReadPayload,
  type ThreadTokenUsage,
} from './threadTokenUsage.js'

export type AppServerThreadRuntimeSnapshotDependencies = {
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
  readSessionLogThreadRead?: (sessionPath: string, fallbackThreadRead: unknown) => Promise<unknown | null>
  getErrorMessage(error: unknown, fallback: string): string
  writeWarning(message: string, details: Record<string, unknown>): void
}

export type ThreadRuntimeSnapshotReadOptions = {
  preferCachedMessages?: boolean
}

export async function readAppServerThreadRuntimeSnapshot(
  threadId: string,
  dependencies: AppServerThreadRuntimeSnapshotDependencies,
  options: ThreadRuntimeSnapshotReadOptions = {},
): Promise<ThreadRuntimeSnapshot> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    throw new Error('Missing thread id')
  }

  const cachedThreadRead = dependencies.getCachedThreadRead(normalizedThreadId)
  let lightThreadRead: unknown = null
  try {
    lightThreadRead = await dependencies.rpc('thread/read', {
      threadId: normalizedThreadId,
      includeTurns: false,
    })
    dependencies.observeThreadRead({
      threadId: normalizedThreadId,
      payload: lightThreadRead,
    })
  } catch (error) {
    if (!isRecoverableThreadReadError(error)) {
      throw error
    }
    dependencies.writeWarning('Light thread snapshot unavailable', {
      threadId: normalizedThreadId,
      error: dependencies.getErrorMessage(error, 'Light thread snapshot failed'),
    })
  }

  const lightUpdatedAtIso = lightThreadRead ? readThreadUpdatedAtIsoFromThreadReadPayload(lightThreadRead) : ''
  const lightInProgress = lightThreadRead ? readThreadInProgressFromThreadReadPayload(lightThreadRead) : false
  const runtimeSnapshotBeforeMessageRead = dependencies.snapshotRuntime(normalizedThreadId, {
    pendingServerRequests: dependencies.listPendingServerRequestsForThread(normalizedThreadId),
    tokenUsage: dependencies.getThreadTokenUsage(normalizedThreadId),
  })
  const sessionPath = lightThreadRead ? readThreadSessionPathFromThreadReadPayload(lightThreadRead) : ''
  let sessionLogReadAttempted = false
  let threadRead: unknown = null
  let messageState: ThreadRuntimeSnapshot['messageState'] = 'unavailable'

  if (
    cachedThreadRead &&
    lightUpdatedAtIso &&
    cachedThreadRead.updatedAtIso === lightUpdatedAtIso &&
    !isCachedThreadReadStaleForRuntime(cachedThreadRead, runtimeSnapshotBeforeMessageRead, lightInProgress)
  ) {
    threadRead = cachedThreadRead.threadRead
    messageState = cachedThreadRead.source === 'session-log' ? 'cached' : 'fresh'
  } else {
    if (options.preferCachedMessages === true && lightThreadRead && sessionPath) {
      sessionLogReadAttempted = true
      const recoveredThreadRead = await (dependencies.readSessionLogThreadRead ?? readThreadReadFromSessionLog)(sessionPath, lightThreadRead)
      if (recoveredThreadRead) {
        threadRead = trimThreadTurnsInRpcResult('thread/read', recoveredThreadRead)
        messageState = 'cached'
        dependencies.rememberCachedThreadRead(normalizedThreadId, threadRead, 'session-log')
      }
    }
    if (!threadRead && options.preferCachedMessages === true && cachedThreadRead) {
      threadRead = cachedThreadRead.threadRead
      messageState = 'cached'
    }
    if (!threadRead) {
      try {
        const rawThreadRead = await dependencies.rpc('thread/read', {
          threadId: normalizedThreadId,
          includeTurns: true,
        })
        threadRead = trimThreadTurnsInRpcResult('thread/read', rawThreadRead)
        dependencies.observeThreadRead({
          threadId: normalizedThreadId,
          payload: threadRead,
        })
        dependencies.rememberCachedThreadRead(normalizedThreadId, threadRead)
        messageState = 'fresh'
      } catch (error) {
        if (!isRecoverableThreadReadError(error)) {
          throw error
        }
        if (cachedThreadRead) {
          threadRead = cachedThreadRead.threadRead
          messageState = 'cached'
          dependencies.writeWarning('Heavy thread snapshot fell back to cached messages', {
            threadId: normalizedThreadId,
            lightUpdatedAtIso,
            cachedUpdatedAtIso: cachedThreadRead.updatedAtIso,
            error: dependencies.getErrorMessage(error, 'Heavy thread snapshot failed'),
          })
        } else {
          const recoveredThreadRead = !sessionLogReadAttempted && sessionPath
            ? await (dependencies.readSessionLogThreadRead ?? readThreadReadFromSessionLog)(sessionPath, lightThreadRead)
            : null
          if (recoveredThreadRead) {
            threadRead = trimThreadTurnsInRpcResult('thread/read', recoveredThreadRead)
            messageState = 'cached'
            dependencies.rememberCachedThreadRead(normalizedThreadId, threadRead, 'session-log')
            dependencies.writeWarning('Heavy thread snapshot fell back to session log messages', {
              threadId: normalizedThreadId,
              lightUpdatedAtIso,
              sessionPath,
              error: dependencies.getErrorMessage(error, 'Heavy thread snapshot failed'),
            })
          } else {
            dependencies.writeWarning('Heavy thread snapshot unavailable with no cache', {
              threadId: normalizedThreadId,
              lightUpdatedAtIso,
              sessionPath,
              error: dependencies.getErrorMessage(error, 'Heavy thread snapshot failed'),
            })
          }
        }
      }
    }
  }

  const tokenUsage = dependencies.getThreadTokenUsage(normalizedThreadId)
    ?? (threadRead ? readThreadTokenUsageFromThreadReadPayload(threadRead) : null)
    ?? (lightThreadRead ? readThreadTokenUsageFromThreadReadPayload(lightThreadRead) : null)

  const updatedAtIso =
    messageState === 'cached'
      ? (threadRead
        ? readThreadUpdatedAtIsoFromThreadReadPayload(threadRead)
        : cachedThreadRead?.updatedAtIso ?? lightUpdatedAtIso)
      : lightThreadRead
        ? readThreadUpdatedAtIsoFromThreadReadPayload(lightThreadRead)
        : threadRead
          ? readThreadUpdatedAtIsoFromThreadReadPayload(threadRead)
          : ''
  const freshThreadInProgress =
    threadRead && messageState === 'fresh'
      ? readThreadInProgressFromThreadReadPayload(threadRead)
      : false
  const cachedThreadInProgress =
    threadRead && messageState === 'cached'
      ? readThreadInProgressFromThreadReadPayload(threadRead)
      : (cachedThreadRead?.inProgress ?? false)
  const inProgress =
    lightInProgress
    || freshThreadInProgress
    || (!lightThreadRead && messageState === 'cached' ? cachedThreadInProgress : false)
  const activeTurnId =
    (lightThreadRead ? readActiveTurnIdFromThreadReadPayload(lightThreadRead) : '')
    || (threadRead && messageState === 'fresh' ? readActiveTurnIdFromThreadReadPayload(threadRead) : '')
    || (!lightThreadRead && messageState === 'cached' ? (cachedThreadRead?.activeTurnId ?? readActiveTurnIdFromThreadReadPayload(threadRead)) : '')

  if (lightThreadRead || threadRead || cachedThreadRead) {
    dependencies.observeRuntimeThreadRead(
      normalizedThreadId,
      inProgress,
      activeTurnId,
      updatedAtIso,
      messageState === 'cached' ? 'cache' : 'thread-read',
    )
    if (messageState === 'unavailable' && !threadRead) {
      dependencies.markRuntimeDegraded(normalizedThreadId, 'thread messages unavailable')
    }
  } else {
    dependencies.markRuntimeDegraded(normalizedThreadId, 'thread snapshot unavailable')
  }

  return dependencies.persistRuntimeSnapshot(normalizedThreadId, dependencies.snapshotRuntime(normalizedThreadId, {
    threadRead,
    messageState,
    pendingServerRequests: dependencies.listPendingServerRequestsForThread(normalizedThreadId),
    tokenUsage,
  }))
}

export function createAppServerThreadRuntimeSnapshotReader(
  dependencies: AppServerThreadRuntimeSnapshotDependencies,
): (threadId: string, options?: ThreadRuntimeSnapshotReadOptions) => Promise<ThreadRuntimeSnapshot> {
  return async (threadId, options = {}) => await readAppServerThreadRuntimeSnapshot(threadId, dependencies, options)
}

function isRecoverableThreadReadError(error: unknown): boolean {
  return isThreadMaterializingError(error) || isRpcTimeoutError(error)
}
