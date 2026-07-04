import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  ComposerFileSearchError,
  searchComposerFiles,
} from './composerFileSearch.js'
import { getErrorMessage } from './errorMessage.js'
import { setJson } from './httpJsonResponse.js'

export type ComposerFileSearchRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  searchComposerFiles?: typeof searchComposerFiles
  getErrorMessage?: typeof getErrorMessage
}

export async function handleComposerFileSearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: ComposerFileSearchRoutesDependencies,
): Promise<boolean> {
  if (req.method !== 'POST' || url.pathname !== '/codex-api/composer-file-search') {
    return false
  }

  const runSearch = dependencies.searchComposerFiles ?? searchComposerFiles
  const readErrorMessage = dependencies.getErrorMessage ?? getErrorMessage
  const payload = asRecord(await dependencies.readJsonBody(req))
  const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  try {
    const data = await runSearch({
      cwd: rawCwd,
      query,
      limit: payload?.limit,
    })
    setJson(res, 200, { data })
  } catch (error) {
    if (error instanceof ComposerFileSearchError) {
      setJson(res, error.statusCode, { error: error.message })
      return true
    }
    setJson(res, 500, { error: readErrorMessage(error, 'Failed to search files') })
  }
  return true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
