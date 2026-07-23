import type { IncomingMessage, ServerResponse } from 'node:http'

import { setJson } from './httpJsonResponse.js'
import type { MobilePushCoordinator } from './mobilePush.js'

export type MobilePushRoutesDependencies = {
  readJsonBody(req: IncomingMessage): Promise<unknown>
  mobilePushCoordinator: Pick<MobilePushCoordinator, 'getStatus' | 'register' | 'unregister' | 'acknowledge'>
}

function writeInvalidPayload(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error && error.message ? error.message : 'Invalid mobile push request'
  setJson(res, 400, { error: message })
}

export async function handleMobilePushRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: MobilePushRoutesDependencies,
): Promise<boolean> {
  if (url.pathname === '/codex-api/mobile-push/status' && req.method === 'GET') {
    setJson(res, 200, { data: dependencies.mobilePushCoordinator.getStatus() })
    return true
  }

  if (url.pathname === '/codex-api/mobile-push/register' && req.method === 'POST') {
    try {
      const payload = await dependencies.readJsonBody(req)
      setJson(res, 200, { data: dependencies.mobilePushCoordinator.register(payload) })
    } catch (error) {
      writeInvalidPayload(res, error)
    }
    return true
  }

  if (url.pathname === '/codex-api/mobile-push/register' && req.method === 'DELETE') {
    try {
      const payload = await dependencies.readJsonBody(req)
      setJson(res, 200, { data: dependencies.mobilePushCoordinator.unregister(payload) })
    } catch (error) {
      writeInvalidPayload(res, error)
    }
    return true
  }

  if (url.pathname === '/codex-api/mobile-push/ack' && req.method === 'POST') {
    try {
      const payload = await dependencies.readJsonBody(req)
      setJson(res, 200, { data: dependencies.mobilePushCoordinator.acknowledge(payload) })
    } catch (error) {
      writeInvalidPayload(res, error)
    }
    return true
  }

  return false
}
