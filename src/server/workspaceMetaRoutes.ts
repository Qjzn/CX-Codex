import type { IncomingMessage, ServerResponse } from 'node:http'

import { getCodexGlobalStatePath } from './codexPaths.js'
import { setJson } from './httpJsonResponse.js'
import {
  normalizeWorkspaceRootsState,
  readWorkspaceRootsState,
  writeWorkspaceRootsState,
} from './workspaceRootsState.js'

type MethodCatalog = {
  listMethods: () => Promise<unknown>
  listNotificationMethods: () => Promise<unknown>
}

export type WorkspaceMetaRoutesDependencies = {
  methodCatalog: MethodCatalog
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  homeDirectory: () => string
  getCodexGlobalStatePath?: typeof getCodexGlobalStatePath
  readWorkspaceRootsState?: typeof readWorkspaceRootsState
  writeWorkspaceRootsState?: typeof writeWorkspaceRootsState
}

export async function handleWorkspaceMetaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: WorkspaceMetaRoutesDependencies,
): Promise<boolean> {
  const getStatePath = dependencies.getCodexGlobalStatePath ?? getCodexGlobalStatePath
  const readWorkspaceState = dependencies.readWorkspaceRootsState ?? readWorkspaceRootsState
  const writeWorkspaceState = dependencies.writeWorkspaceRootsState ?? writeWorkspaceRootsState

  if (req.method === 'GET' && url.pathname === '/codex-api/meta/methods') {
    const methods = await dependencies.methodCatalog.listMethods()
    setJson(res, 200, { data: methods })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/meta/notifications') {
    const methods = await dependencies.methodCatalog.listNotificationMethods()
    setJson(res, 200, { data: methods })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/workspace-roots-state') {
    const state = await readWorkspaceState(getStatePath())
    setJson(res, 200, { data: state })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/workspace-roots-state') {
    const payload = await dependencies.readJsonBody(req)
    const record = asRecord(payload)
    if (!record) {
      setJson(res, 400, { error: 'Invalid body: expected object' })
      return true
    }
    const nextState = normalizeWorkspaceRootsState(record)
    await writeWorkspaceState(getStatePath(), nextState)
    setJson(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
    setJson(res, 200, { data: { path: dependencies.homeDirectory() } })
    return true
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
