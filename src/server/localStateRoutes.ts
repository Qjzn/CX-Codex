import type { IncomingMessage, ServerResponse } from 'node:http'

import { getWebBridgeSettingsPath } from './codexPaths.js'
import { setJson } from './httpJsonResponse.js'
import {
  readFavoriteRecords,
  writeFavoriteRecords,
} from './webUiState.js'
import {
  readMergedPinnedThreadIds,
  writeMergedPinnedThreadIds,
} from './pinnedThreads.js'
import {
  readWebBridgeSettings,
  writeWebBridgeSettings,
} from './webBridgeSettings.js'
import type { WebBridgeSettings } from './serverRequestPolicy.js'

export type LocalStateRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  setWebBridgeSettings: (settings: WebBridgeSettings) => void
  getWebBridgeSettingsPath?: typeof getWebBridgeSettingsPath
  readWebBridgeSettings?: typeof readWebBridgeSettings
  writeWebBridgeSettings?: typeof writeWebBridgeSettings
  readFavoriteRecords?: typeof readFavoriteRecords
  writeFavoriteRecords?: typeof writeFavoriteRecords
  readMergedPinnedThreadIds?: typeof readMergedPinnedThreadIds
  writeMergedPinnedThreadIds?: typeof writeMergedPinnedThreadIds
}

export async function handleLocalStateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: LocalStateRoutesDependencies,
): Promise<boolean> {
  const getSettingsPath = dependencies.getWebBridgeSettingsPath ?? getWebBridgeSettingsPath
  const readSettings = dependencies.readWebBridgeSettings ?? readWebBridgeSettings
  const writeSettings = dependencies.writeWebBridgeSettings ?? writeWebBridgeSettings
  const readFavorites = dependencies.readFavoriteRecords ?? readFavoriteRecords
  const writeFavorites = dependencies.writeFavoriteRecords ?? writeFavoriteRecords
  const readPinnedThreads = dependencies.readMergedPinnedThreadIds ?? readMergedPinnedThreadIds
  const writePinnedThreads = dependencies.writeMergedPinnedThreadIds ?? writeMergedPinnedThreadIds

  if (req.method === 'GET' && url.pathname === '/codex-api/web-settings') {
    const settings = await readSettings(getSettingsPath())
    dependencies.setWebBridgeSettings(settings)
    setJson(res, 200, { data: settings })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/web-settings') {
    const payload = await dependencies.readJsonBody(req)
    const settings = await writeSettings(getSettingsPath(), payload)
    dependencies.setWebBridgeSettings(settings)
    setJson(res, 200, { data: settings })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/favorites') {
    const favorites = await readFavorites()
    setJson(res, 200, { data: favorites })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/favorites') {
    const payload = await dependencies.readJsonBody(req)
    const record = asRecord(payload) ?? {}
    const favorites = await writeFavorites(Array.isArray(record.favorites) ? record.favorites as never[] : [])
    setJson(res, 200, { data: favorites })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/pinned-threads') {
    const pinnedThreadIds = await readPinnedThreads()
    setJson(res, 200, { data: pinnedThreadIds })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/pinned-threads') {
    const payload = await dependencies.readJsonBody(req)
    const record = asRecord(payload) ?? {}
    const pinnedThreadIds = await writePinnedThreads(
      Array.isArray(record.pinnedThreadIds) ? record.pinnedThreadIds as never[] : [],
    )
    setJson(res, 200, { data: pinnedThreadIds })
    return true
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
