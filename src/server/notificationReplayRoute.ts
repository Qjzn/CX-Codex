import type { IncomingMessage, ServerResponse } from 'node:http'

import { setJson } from './httpJsonResponse.js'

export type NotificationReplayListAfter = (afterSeq: number, limit: number) => unknown

export type NotificationReplayQuery = {
  afterSeq: number
  limit: number
}

export function readNotificationReplayQuery(url: URL): NotificationReplayQuery {
  return {
    afterSeq: readIntegerSearchParam(
      url.searchParams.get('afterSeq') ?? url.searchParams.get('after'),
      0,
    ),
    limit: readIntegerSearchParam(url.searchParams.get('limit'), 200),
  }
}

export function handleNotificationReplayRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  listAfter: NotificationReplayListAfter,
): boolean {
  if (
    req.method !== 'GET' ||
    (url.pathname !== '/codex-api/events/replay' && url.pathname !== '/codex-api/runtime/events')
  ) {
    return false
  }

  const query = readNotificationReplayQuery(url)
  setJson(res, 200, { data: listAfter(query.afterSeq, query.limit) })
  return true
}

function readIntegerSearchParam(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
