import type { IncomingMessage, ServerResponse } from 'node:http'

import { getErrorMessage } from './errorMessage.js'
import {
  fetchGithubTrending,
  normalizeGithubTrendingLimit,
  normalizeGithubTrendingSince,
  normalizeGithubTrendingTranslationDescriptions,
  translateGithubDescriptionsToChinese,
} from './githubTrending.js'
import { setJson } from './httpJsonResponse.js'

export type GithubTrendingRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  fetchGithubTrending?: typeof fetchGithubTrending
  translateGithubDescriptionsToChinese?: typeof translateGithubDescriptionsToChinese
  getErrorMessage?: typeof getErrorMessage
}

export async function handleGithubTrendingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: GithubTrendingRoutesDependencies,
): Promise<boolean> {
  const fetchTrending = dependencies.fetchGithubTrending ?? fetchGithubTrending
  const translateDescriptions = dependencies.translateGithubDescriptionsToChinese ?? translateGithubDescriptionsToChinese
  const readErrorMessage = dependencies.getErrorMessage ?? getErrorMessage

  if (req.method === 'GET' && url.pathname === '/codex-api/github-trending') {
    const since = normalizeGithubTrendingSince(url.searchParams.get('since'))
    const limit = normalizeGithubTrendingLimit(url.searchParams.get('limit'))
    try {
      const data = await fetchTrending(since, limit)
      setJson(res, 200, { data })
    } catch (error) {
      setJson(res, 502, { error: readErrorMessage(error, 'Failed to fetch GitHub trending') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/github-trending/translate') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const descriptions = normalizeGithubTrendingTranslationDescriptions(payload?.descriptions)

    try {
      const translations = await translateDescriptions(descriptions)
      setJson(res, 200, { data: { translations } })
    } catch {
      setJson(res, 200, { data: { translations: descriptions } })
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
