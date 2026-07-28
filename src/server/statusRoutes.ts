import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  getDesktopAppRefreshStatus,
  requestDesktopAppRefresh,
} from './desktopAppRefresh.js'
import { getErrorMessage } from './errorMessage.js'
import { setJson } from './httpJsonResponse.js'
import {
  getTunnelStatus,
  updateTunnelConfig,
} from './tunnelStatus.js'
import {
  startQuickTunnel,
  startQuickTunnelWithTransientRetry,
  stopQuickTunnel,
} from './quickTunnel.js'
import {
  startStableAccess,
  stopStableAccess,
} from './tailscaleFunnel.js'

export type StatusRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  getDesktopAppRefreshStatus?: typeof getDesktopAppRefreshStatus
  requestDesktopAppRefresh?: typeof requestDesktopAppRefresh
  getTunnelStatus?: typeof getTunnelStatus
  updateTunnelConfig?: typeof updateTunnelConfig
  startQuickTunnel?: typeof startQuickTunnel
  stopQuickTunnel?: typeof stopQuickTunnel
  startStableAccess?: typeof startStableAccess
  stopStableAccess?: typeof stopStableAccess
  remoteAccessProtected?: boolean
  getErrorMessage?: typeof getErrorMessage
}

export async function handleStatusRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: StatusRoutesDependencies,
): Promise<boolean> {
  const readDesktopStatus = dependencies.getDesktopAppRefreshStatus ?? getDesktopAppRefreshStatus
  const requestDesktopRefresh = dependencies.requestDesktopAppRefresh ?? requestDesktopAppRefresh
  const readTunnelStatus = dependencies.getTunnelStatus ?? getTunnelStatus
  const writeTunnelConfig = dependencies.updateTunnelConfig ?? updateTunnelConfig
  const startManagedQuickTunnel = dependencies.startQuickTunnel ?? startQuickTunnel
  const stopManagedQuickTunnel = dependencies.stopQuickTunnel ?? stopQuickTunnel
  const startManagedStableAccess = dependencies.startStableAccess ?? startStableAccess
  const stopManagedStableAccess = dependencies.stopStableAccess ?? stopStableAccess
  const readErrorMessage = dependencies.getErrorMessage ?? getErrorMessage

  if (req.method === 'GET' && url.pathname === '/codex-api/desktop-app/status') {
    const status = await readDesktopStatus()
    setJson(res, 200, { data: status })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/desktop-app/refresh') {
    try {
      const result = await requestDesktopRefresh()
      setJson(res, 202, { data: result })
    } catch (error) {
      setJson(res, 409, { error: readErrorMessage(error, 'Failed to refresh the official Codex desktop app') })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/tunnel-status') {
    const status = await readTunnelStatus()
    setJson(res, 200, { data: status })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/codex-api/tunnel-status') {
    const payload = await dependencies.readJsonBody(req)
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {}
    const status = await writeTunnelConfig({
      enabled: typeof record.enabled === 'boolean' ? record.enabled : null,
      cloudflaredCommand: typeof record.cloudflaredCommand === 'string' ? record.cloudflaredCommand : undefined,
      preferredMode: record.preferredMode === 'stable' || record.preferredMode === 'quick'
        ? record.preferredMode
        : undefined,
      tailscaleCommand: typeof record.tailscaleCommand === 'string' ? record.tailscaleCommand : undefined,
    })
    setJson(res, 200, { data: status })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/tunnel-status/start') {
    if (dependencies.remoteAccessProtected !== true) {
      setJson(res, 409, {
        error: '开启手机访问前必须启用 CX-Codex 访问密码。',
        code: 'AUTH_REQUIRED',
      })
      return true
    }

    try {
      const payload = await dependencies.readJsonBody(req)
      const record =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {}
      const mode = record.mode === 'quick' ? 'quick' : 'stable'
      if (mode === 'stable') {
        const preferredCommand = typeof record.tailscaleCommand === 'string'
          ? record.tailscaleCommand.trim()
          : ''
        const runtime = await startManagedStableAccess({
          localPort: req.socket.localPort ?? 0,
          preferredCommand,
        })
        await stopManagedQuickTunnel()
        await writeTunnelConfig({
          enabled: true,
          preferredMode: 'stable',
          tailscaleCommand: runtime.command,
        })
      } else {
        const preferredCommand = typeof record.cloudflaredCommand === 'string'
          ? record.cloudflaredCommand.trim()
          : ''
        const runtime = await startQuickTunnelWithTransientRetry(
          {
            localPort: req.socket.localPort ?? 0,
            preferredCommand,
          },
          startManagedQuickTunnel,
        )
        const currentStatus = await readTunnelStatus()
        await stopManagedStableAccess(
          currentStatus.stable.command,
          req.socket.localPort ?? 0,
        )
        await writeTunnelConfig({
          enabled: true,
          preferredMode: record.fallback === true ? 'stable' : 'quick',
          cloudflaredCommand: runtime.command,
        })
      }
      setJson(res, 200, { data: await readTunnelStatus() })
    } catch (error) {
      const errorRecord = error && typeof error === 'object'
        ? error as { code?: unknown }
        : {}
      setJson(res, 409, {
        error: readErrorMessage(error, 'Failed to start remote access'),
        code: typeof errorRecord.code === 'string' ? errorRecord.code : 'REMOTE_ACCESS_FAILED',
      })
    }
    return true
  }

  if (req.method === 'DELETE' && url.pathname === '/codex-api/tunnel-status') {
    try {
      await stopManagedQuickTunnel()
      const currentStatus = await readTunnelStatus()
      await stopManagedStableAccess(
        currentStatus.stable.command,
        req.socket.localPort ?? 0,
      )
      await writeTunnelConfig({ enabled: false })
      setJson(res, 200, { data: await readTunnelStatus() })
    } catch (error) {
      setJson(res, 409, { error: readErrorMessage(error, 'Failed to stop quick tunnel') })
    }
    return true
  }

  return false
}
