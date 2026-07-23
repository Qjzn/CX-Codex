import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  createRuntimeThreadStatePayload,
} from './appServerRuntimeRequestReconciliation.js'
import { setJson } from './httpJsonResponse.js'
import type {
  RuntimeSnapshotOverlay,
  ThreadRuntimeSnapshot,
} from './runtimeState.js'
import type { ThreadRuntimeSnapshotReadOptions } from './appServerThreadRuntimeSnapshot.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type { ThreadTokenUsage } from './threadTokenUsage.js'

type RuntimeThreadStateStore = Parameters<typeof createRuntimeThreadStatePayload>[2]

type RuntimeStateSnapshotStore = {
  snapshot(threadId: string, overlay?: RuntimeSnapshotOverlay): ThreadRuntimeSnapshot
  snapshots(threadIds: string[], overlaysByThreadId?: Map<string, RuntimeSnapshotOverlay>): ThreadRuntimeSnapshot[]
}

export type RuntimeStateRoutesDependencies = {
  runtimeRequestStore: RuntimeThreadStateStore
  runtimeStateStore: RuntimeStateSnapshotStore
  reconcileRuntimeThread: (threadId: string) => Promise<ThreadRuntimeSnapshot>
  readLocalRuntimeSnapshot: (threadId: string) => ThreadRuntimeSnapshot
  persistRuntimeSnapshot: (threadId: string, snapshot: ThreadRuntimeSnapshot) => ThreadRuntimeSnapshot
  readThreadRuntimeSnapshot: (
    threadId: string,
    options?: ThreadRuntimeSnapshotReadOptions,
  ) => Promise<ThreadRuntimeSnapshot | null>
  readCachedThreadTokenUsage: (threadId: string) => Promise<ThreadTokenUsage | null>
  listPendingServerRequestsForThread: (threadId: string) => PendingServerRequest[]
  getThreadTokenUsage: (threadId: string) => ThreadTokenUsage | null
}

export async function handleRuntimeStateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: RuntimeStateRoutesDependencies,
): Promise<boolean> {
  if (url.pathname.startsWith('/codex-api/runtime/thread/')) {
    const suffix = url.pathname.slice('/codex-api/runtime/thread/'.length)
    const isReconcile = suffix.endsWith('/reconcile')
    const encodedThreadId = isReconcile ? suffix.slice(0, -'/reconcile'.length) : suffix
    const threadId = decodeURIComponent(encodedThreadId).trim()
    if (!threadId) {
      setJson(res, 400, { error: 'Missing threadId' })
      return true
    }
    if (req.method === 'POST' && isReconcile) {
      const snapshot = await dependencies.reconcileRuntimeThread(threadId)
      setJson(res, 200, {
        data: createRuntimeThreadStatePayload(threadId, snapshot, dependencies.runtimeRequestStore),
      })
      return true
    }
    if (req.method === 'GET' && !isReconcile) {
      const snapshot = dependencies.readLocalRuntimeSnapshot(threadId)
      setJson(res, 200, {
        data: createRuntimeThreadStatePayload(threadId, snapshot, dependencies.runtimeRequestStore),
      })
      return true
    }
    return false
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/runtime/snapshot') {
    const threadId = (url.searchParams.get('threadId') ?? '').trim()
    if (!threadId) {
      setJson(res, 400, { error: 'Missing threadId' })
      return true
    }
    const snapshot = dependencies.readLocalRuntimeSnapshot(threadId)
    setJson(res, 200, { data: snapshot })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/runtime/snapshots') {
    const threadIds = (url.searchParams.get('threadIds') ?? '')
      .split(',')
      .map((threadId) => threadId.trim())
      .filter((threadId) => threadId.length > 0)
      .slice(0, 100)
    setJson(res, 200, { data: threadIds.map((threadId) => dependencies.readLocalRuntimeSnapshot(threadId)) })
    return true
  }

  if (req.method === 'GET' && url.pathname.startsWith('/codex-api/state/thread/')) {
    const encodedThreadId = url.pathname.slice('/codex-api/state/thread/'.length)
    const threadId = decodeURIComponent(encodedThreadId).trim()
    if (!threadId) {
      setJson(res, 400, { error: 'Missing thread id' })
      return true
    }

    const snapshot = await dependencies.readThreadRuntimeSnapshot(threadId, {
      preferCachedMessages: url.searchParams.get('preferCachedMessages') === '1',
    })
    setJson(res, 200, { data: snapshot })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/thread-token-usage') {
    const threadId = (url.searchParams.get('threadId') ?? '').trim()
    if (!threadId) {
      setJson(res, 400, { error: 'Missing threadId' })
      return true
    }
    const tokenUsage = await dependencies.readCachedThreadTokenUsage(threadId)
    setJson(res, 200, { data: { tokenUsage } })
    return true
  }

  return false
}

function createRuntimeSnapshotOverlay(
  threadId: string,
  dependencies: Pick<RuntimeStateRoutesDependencies, 'listPendingServerRequestsForThread' | 'getThreadTokenUsage'>,
): RuntimeSnapshotOverlay {
  return {
    pendingServerRequests: dependencies.listPendingServerRequestsForThread(threadId),
    tokenUsage: dependencies.getThreadTokenUsage(threadId),
  }
}
