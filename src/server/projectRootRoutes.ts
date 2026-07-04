import type { IncomingMessage, ServerResponse } from 'node:http'

import { getCodexGlobalStatePath } from './codexPaths.js'
import { setJson } from './httpJsonResponse.js'
import {
  ProjectRootError,
  resolveProjectRoot,
  suggestProjectRoot,
} from './projectRoots.js'
import {
  readWorkspaceRootsState,
  writeWorkspaceRootsState,
} from './workspaceRootsState.js'

export type ProjectRootRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  getCodexGlobalStatePath?: typeof getCodexGlobalStatePath
  readWorkspaceRootsState?: typeof readWorkspaceRootsState
  writeWorkspaceRootsState?: typeof writeWorkspaceRootsState
  resolveProjectRoot?: typeof resolveProjectRoot
  suggestProjectRoot?: typeof suggestProjectRoot
}

export async function handleProjectRootRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: ProjectRootRoutesDependencies,
): Promise<boolean> {
  const getStatePath = dependencies.getCodexGlobalStatePath ?? getCodexGlobalStatePath
  const readWorkspaceState = dependencies.readWorkspaceRootsState ?? readWorkspaceRootsState
  const writeWorkspaceState = dependencies.writeWorkspaceRootsState ?? writeWorkspaceRootsState
  const resolveRoot = dependencies.resolveProjectRoot ?? resolveProjectRoot
  const suggestRoot = dependencies.suggestProjectRoot ?? suggestProjectRoot

  if (req.method === 'POST' && url.pathname === '/codex-api/project-root') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const rawPath = typeof payload?.path === 'string' ? payload.path.trim() : ''
    const createIfMissing = payload?.createIfMissing === true
    const label = typeof payload?.label === 'string' ? payload.label : ''
    const statePath = getStatePath()
    try {
      const existingState = await readWorkspaceState(statePath)
      const result = await resolveRoot(rawPath, {
        createIfMissing,
        label,
        existingState,
      })
      await writeWorkspaceState(statePath, result.workspaceState)
      setJson(res, 200, { data: { path: result.path } })
    } catch (error) {
      if (error instanceof ProjectRootError) {
        setJson(res, error.statusCode, { error: error.message })
        return true
      }
      throw error
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/project-root-suggestion') {
    const basePath = url.searchParams.get('basePath')?.trim() ?? ''
    try {
      const suggestion = await suggestRoot(basePath)
      setJson(res, 200, { data: suggestion })
    } catch (error) {
      if (error instanceof ProjectRootError) {
        setJson(res, error.statusCode, { error: error.message })
        return true
      }
      throw error
    }
    return true
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
