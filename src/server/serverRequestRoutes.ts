import type { IncomingMessage, ServerResponse } from 'node:http'

import type { PendingServerRequest } from './pendingServerRequests.js'
import { createServerRequestDiagnosticsSnapshot } from './serverRequestDiagnostics.js'
import { setJson } from './httpJsonResponse.js'

export type ServerRequestRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  respondToServerRequest: (payload: unknown) => Promise<void>
  listPendingServerRequests: () => PendingServerRequest[]
}

export async function handleServerRequestRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: ServerRequestRoutesDependencies,
): Promise<boolean> {
  if (req.method === 'POST' && url.pathname === '/codex-api/server-requests/respond') {
    const payload = await dependencies.readJsonBody(req)
    await dependencies.respondToServerRequest(payload)
    setJson(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending') {
    setJson(res, 200, { data: dependencies.listPendingServerRequests() })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending/diagnostics') {
    setJson(res, 200, {
      data: createServerRequestDiagnosticsSnapshot(dependencies.listPendingServerRequests()),
    })
    return true
  }

  return false
}
