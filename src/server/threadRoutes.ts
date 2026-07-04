import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  getCodexGlobalStatePath,
  getCodexSessionIndexPath,
} from './codexPaths.js'
import { setJson } from './httpJsonResponse.js'
import {
  readMergedThreadTitleCache,
  readThreadTitleCache,
  removeFromThreadTitleCache,
  updateThreadTitleCache,
  writeThreadTitleCache,
} from './threadTitleCache.js'

type ThreadSearchStore = {
  search: (query: string, limit: number) => Promise<{ threadIds: string[]; indexedThreadCount: number }>
}

export type ThreadRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  threadSearchIndexStore: ThreadSearchStore
  getCodexGlobalStatePath?: typeof getCodexGlobalStatePath
  getCodexSessionIndexPath?: typeof getCodexSessionIndexPath
  readMergedThreadTitleCache?: typeof readMergedThreadTitleCache
  readThreadTitleCache?: typeof readThreadTitleCache
  writeThreadTitleCache?: typeof writeThreadTitleCache
  updateThreadTitleCache?: typeof updateThreadTitleCache
  removeFromThreadTitleCache?: typeof removeFromThreadTitleCache
}

export async function handleThreadRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: ThreadRoutesDependencies,
): Promise<boolean> {
  const getStatePath = dependencies.getCodexGlobalStatePath ?? getCodexGlobalStatePath
  const getSessionIndexPath = dependencies.getCodexSessionIndexPath ?? getCodexSessionIndexPath
  const readMergedTitles = dependencies.readMergedThreadTitleCache ?? readMergedThreadTitleCache
  const readTitles = dependencies.readThreadTitleCache ?? readThreadTitleCache
  const writeTitles = dependencies.writeThreadTitleCache ?? writeThreadTitleCache
  const updateTitles = dependencies.updateThreadTitleCache ?? updateThreadTitleCache
  const removeTitle = dependencies.removeFromThreadTitleCache ?? removeFromThreadTitleCache

  if (req.method === 'GET' && url.pathname === '/codex-api/thread-titles') {
    const cache = await readMergedTitles(getStatePath(), getSessionIndexPath())
    setJson(res, 200, { data: cache })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/thread-search') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
    const limitRaw = typeof payload?.limit === 'number' ? payload.limit : 200
    const limit = Math.max(1, Math.min(1000, Math.floor(limitRaw)))
    if (!query) {
      setJson(res, 200, { data: { threadIds: [], indexedThreadCount: 0 } })
      return true
    }

    const searchResult = await dependencies.threadSearchIndexStore.search(query, limit)
    setJson(res, 200, { data: searchResult })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/thread-titles') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const id = typeof payload?.id === 'string' ? payload.id : ''
    const title = typeof payload?.title === 'string' ? payload.title : ''
    if (!id) {
      setJson(res, 400, { error: 'Missing id' })
      return true
    }
    const statePath = getStatePath()
    const cache = await readTitles(statePath)
    const next = title ? updateTitles(cache, id, title) : removeTitle(cache, id)
    await writeTitles(statePath, next)
    setJson(res, 200, { ok: true })
    return true
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
