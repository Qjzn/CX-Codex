import type { IncomingMessage, ServerResponse } from 'node:http'

import { setJson } from './httpJsonResponse.js'
import type { RuntimeRequestRecord } from './runtimeStore.js'

type RuntimeActionResult = {
  status: string
}

export type RuntimeActionRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  startRuntimeTurn: (payload: unknown) => Promise<RuntimeActionResult>
  interruptRuntimeTurn: (payload: unknown) => Promise<RuntimeActionResult>
  getLatestRequestByClientMessageId: (clientMessageId: string) => RuntimeRequestRecord | null
}

export async function handleRuntimeActionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: RuntimeActionRoutesDependencies,
): Promise<boolean> {
  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/send') {
    const payload = await dependencies.readJsonBody(req)
    const result = await dependencies.startRuntimeTurn(payload)
    setJson(res, result.status === 'start_uncertain' ? 202 : 200, { data: result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/runtime/request') {
    const clientMessageId = url.searchParams.get('clientMessageId')?.trim() ?? ''
    if (!clientMessageId) {
      setJson(res, 400, { error: 'Missing clientMessageId' })
      return true
    }
    const request = dependencies.getLatestRequestByClientMessageId(clientMessageId)
    if (!request) {
      setJson(res, 404, { data: null })
      return true
    }
    setJson(res, 200, { data: request })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/runtime/interrupt') {
    const payload = await dependencies.readJsonBody(req)
    const result = await dependencies.interruptRuntimeTurn(payload)
    setJson(res, result.status === 'stop_uncertain' ? 202 : 200, { data: result })
    return true
  }

  return false
}
