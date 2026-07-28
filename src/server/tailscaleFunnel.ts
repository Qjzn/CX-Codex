import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { canRunCommand } from '../commandResolution.js'
import {
  verifyPublicAccess,
  type QuickTunnelVerification,
} from './quickTunnel.js'

const execFileAsync = promisify(execFile)
const TS_NET_URL_PATTERN = /https:\/\/[a-zA-Z0-9.-]+\.ts\.net(?::\d+)?/gu
const FUNNEL_HTTPS_PORT = 8443

export type StableAccessPhase =
  | 'unavailable'
  | 'needs-login'
  | 'idle'
  | 'starting'
  | 'verifying'
  | 'ready'
  | 'stopping'
  | 'error'

export type StableAccessSnapshot = {
  installed: boolean
  authenticated: boolean
  active: boolean
  phase: StableAccessPhase
  publicUrl: string
  command: string
  dnsName: string
  startedAtIso: string
  errorCode: string
  message: string
  verification: QuickTunnelVerification
}

type CommandResult = {
  stdout: string
  stderr: string
}

function createVerification(): QuickTunnelVerification {
  return {
    health: false,
    auth: false,
    websocketAuth: false,
  }
}

function createInitialSnapshot(): StableAccessSnapshot {
  return {
    installed: false,
    authenticated: false,
    active: false,
    phase: 'unavailable',
    publicUrl: '',
    command: '',
    dnsName: '',
    startedAtIso: '',
    errorCode: 'TAILSCALE_NOT_INSTALLED',
    message: '未检测到 Tailscale。安装并登录一次后，即可获得可在重启后继续使用的固定地址。',
    verification: createVerification(),
  }
}

let snapshot = createInitialSnapshot()
let startPromise: Promise<StableAccessSnapshot> | null = null

function cloneSnapshot(): StableAccessSnapshot {
  return {
    ...snapshot,
    verification: { ...snapshot.verification },
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || result.includes(normalized)) continue
    result.push(normalized)
  }
  return result
}

export function resolveTailscaleCommand(preferredCommand = ''): string {
  const candidates = uniqueStrings([
    preferredCommand,
    process.env.CX_CODEX_TAILSCALE_COMMAND,
    process.env.CODEXUI_TAILSCALE_COMMAND,
    'tailscale',
    process.platform === 'win32' && process.env.ProgramFiles
      ? join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe')
      : undefined,
    process.platform === 'win32' && process.env['ProgramFiles(x86)']
      ? join(process.env['ProgramFiles(x86)'], 'Tailscale', 'tailscale.exe')
      : undefined,
    process.platform !== 'win32' && existsSync('/usr/bin/tailscale')
      ? '/usr/bin/tailscale'
      : undefined,
    process.platform !== 'win32' && existsSync('/usr/local/bin/tailscale')
      ? '/usr/local/bin/tailscale'
      : undefined,
  ])

  for (const candidate of candidates) {
    if (canRunCommand(candidate, ['version'])) return candidate
  }
  return ''
}

async function runTailscale(
  command: string,
  args: string[],
  timeout = 15_000,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (error) {
    const record = error && typeof error === 'object'
      ? error as { stdout?: unknown; stderr?: unknown; message?: unknown }
      : {}
    const detail = [record.stderr, record.stdout, record.message]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .find(Boolean)
    throw new Error(detail || `Tailscale command failed: ${args.join(' ')}`)
  }
}

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeDnsName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\.$/u, '') : ''
}

function readStatusIdentity(record: Record<string, unknown>): {
  authenticated: boolean
  dnsName: string
} {
  const backendState = typeof record.BackendState === 'string' ? record.BackendState : ''
  const self = record.Self && typeof record.Self === 'object' && !Array.isArray(record.Self)
    ? record.Self as Record<string, unknown>
    : {}
  return {
    authenticated: backendState === 'Running',
    dnsName: normalizeDnsName(self.DNSName),
  }
}

function parseFunnelHostPort(value: string): { host: string; port: number } | null {
  const normalized = value.trim()
  const match = normalized.match(/^([a-zA-Z0-9.-]+\.ts\.net):(\d+)$/u)
  if (!match) return null
  const port = Number.parseInt(match[2], 10)
  return Number.isInteger(port) ? { host: match[1], port } : null
}

function formatFunnelUrl(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${String(port)}`
}

function proxyMatchesLocalPort(proxy: unknown, expectedLocalPort: number): boolean {
  if (typeof proxy !== 'string' || !expectedLocalPort) return !expectedLocalPort
  try {
    const url = new URL(proxy)
    const host = url.hostname.toLowerCase()
    const port = Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10)
    return (host === '127.0.0.1' || host === 'localhost' || host === '::1')
      && port === expectedLocalPort
  } catch {
    return false
  }
}

function webConfigMatchesLocalPort(
  record: Record<string, unknown>,
  hostPort: string,
  expectedLocalPort: number,
): boolean {
  if (!expectedLocalPort) return true
  const web = record.Web && typeof record.Web === 'object' && !Array.isArray(record.Web)
    ? record.Web as Record<string, unknown>
    : {}
  const server = web[hostPort] && typeof web[hostPort] === 'object' && !Array.isArray(web[hostPort])
    ? web[hostPort] as Record<string, unknown>
    : {}
  const handlers = server.Handlers && typeof server.Handlers === 'object' && !Array.isArray(server.Handlers)
    ? server.Handlers as Record<string, unknown>
    : {}
  return Object.values(handlers).some((handler) => {
    const handlerRecord = handler && typeof handler === 'object' && !Array.isArray(handler)
      ? handler as Record<string, unknown>
      : {}
    return proxyMatchesLocalPort(handlerRecord.Proxy, expectedLocalPort)
  })
}

function readFunnelEndpoint(text: string, expectedLocalPort = 0): {
  publicUrl: string
  occupiedByOtherService: boolean
} {
  const record = parseJsonRecord(text)
  const allowFunnel = record.AllowFunnel
    && typeof record.AllowFunnel === 'object'
    && !Array.isArray(record.AllowFunnel)
    ? record.AllowFunnel as Record<string, unknown>
    : {}
  for (const [hostPort, enabled] of Object.entries(allowFunnel)) {
    if (enabled !== true) continue
    const endpoint = parseFunnelHostPort(hostPort)
    if (!endpoint || endpoint.port !== FUNNEL_HTTPS_PORT) continue
    if (!webConfigMatchesLocalPort(record, hostPort, expectedLocalPort)) {
      return { publicUrl: '', occupiedByOtherService: true }
    }
    return {
      publicUrl: formatFunnelUrl(endpoint.host, endpoint.port),
      occupiedByOtherService: false,
    }
  }

  for (const match of text.match(TS_NET_URL_PATTERN) ?? []) {
    try {
      const url = new URL(match)
      const port = Number.parseInt(url.port || '443', 10)
      if (port !== FUNNEL_HTTPS_PORT) continue
      if (
        expectedLocalPort
        && !text.includes(`127.0.0.1:${String(expectedLocalPort)}`)
        && !text.includes(`localhost:${String(expectedLocalPort)}`)
      ) {
        continue
      }
      return { publicUrl: match.replace(/\/$/u, ''), occupiedByOtherService: false }
    } catch {
      // Ignore malformed status output and continue.
    }
  }
  return { publicUrl: '', occupiedByOtherService: false }
}

export function readTailscaleFunnelPublicUrl(text: string, expectedLocalPort = 0): string {
  return readFunnelEndpoint(text, expectedLocalPort).publicUrl
}

export async function inspectStableAccess(
  preferredCommand = '',
  expectedLocalPort = 0,
): Promise<StableAccessSnapshot> {
  const command = resolveTailscaleCommand(preferredCommand)
  if (!command) {
    snapshot = createInitialSnapshot()
    return cloneSnapshot()
  }

  try {
    const statusResult = await runTailscale(command, ['status', '--json'])
    const identity = readStatusIdentity(parseJsonRecord(statusResult.stdout))
    if (!identity.authenticated) {
      snapshot = {
        ...createInitialSnapshot(),
        installed: true,
        command,
        dnsName: identity.dnsName,
        phase: 'needs-login',
        errorCode: 'TAILSCALE_LOGIN_REQUIRED',
        message: 'Tailscale 已安装但尚未登录。登录一次后，CX-Codex 会继续配置固定地址。',
      }
      return cloneSnapshot()
    }

    let funnelText = ''
    try {
      const funnelResult = await runTailscale(command, ['funnel', 'status', '--json'])
      funnelText = `${funnelResult.stdout}\n${funnelResult.stderr}`
    } catch {
      const funnelResult = await runTailscale(command, ['funnel', 'status'])
      funnelText = `${funnelResult.stdout}\n${funnelResult.stderr}`
    }
    const endpoint = readFunnelEndpoint(funnelText, expectedLocalPort)
    if (endpoint.occupiedByOtherService) {
      snapshot = {
        ...createInitialSnapshot(),
        installed: true,
        authenticated: true,
        command,
        dnsName: identity.dnsName,
        phase: 'error',
        errorCode: 'TAILSCALE_PORT_IN_USE',
        message: `Tailscale 的 ${String(FUNNEL_HTTPS_PORT)} 端口已由其他服务使用；CX-Codex 未覆盖该配置。`,
      }
      return cloneSnapshot()
    }
    const publicUrl = endpoint.publicUrl
    snapshot = {
      ...createInitialSnapshot(),
      installed: true,
      authenticated: true,
      active: Boolean(publicUrl),
      phase: publicUrl ? 'ready' : 'idle',
      publicUrl,
      command,
      dnsName: identity.dnsName,
      startedAtIso: publicUrl ? snapshot.startedAtIso : '',
      errorCode: '',
      message: publicUrl
        ? '固定地址已启用；电脑和 Tailscale 在线时，升级或重启后仍使用同一地址。'
        : 'Tailscale 已登录，可以启用固定手机访问地址。',
      verification: publicUrl && snapshot.publicUrl === publicUrl
        ? { ...snapshot.verification }
        : createVerification(),
    }
    return cloneSnapshot()
  } catch (error) {
    snapshot = {
      ...createInitialSnapshot(),
      installed: true,
      command,
      phase: 'error',
      errorCode: 'TAILSCALE_STATUS_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
    return cloneSnapshot()
  }
}

export async function startStableAccess(options: {
  localPort: number
  preferredCommand?: string
}): Promise<StableAccessSnapshot> {
  if (!Number.isInteger(options.localPort) || options.localPort < 1 || options.localPort > 65535) {
    throw Object.assign(new Error('无法确定 CX-Codex 当前监听端口。'), {
      code: 'INVALID_LOCAL_PORT',
    })
  }
  if (startPromise) return await startPromise

  startPromise = (async () => {
    const inspected = await inspectStableAccess(options.preferredCommand, options.localPort)
    if (!inspected.installed) {
      throw Object.assign(new Error(inspected.message), {
        code: 'TAILSCALE_NOT_INSTALLED',
      })
    }
    if (!inspected.authenticated) {
      throw Object.assign(new Error(inspected.message), {
        code: 'TAILSCALE_LOGIN_REQUIRED',
      })
    }
    if (inspected.errorCode === 'TAILSCALE_PORT_IN_USE') {
      throw Object.assign(new Error(inspected.message), {
        code: inspected.errorCode,
      })
    }

    snapshot = {
      ...inspected,
      active: false,
      phase: 'starting',
      publicUrl: '',
      errorCode: '',
      message: '正在启用可在重启后恢复的固定地址…',
      verification: createVerification(),
    }

    try {
      const result = await runTailscale(
        inspected.command,
        ['funnel', '--bg', '--yes', `--https=${String(FUNNEL_HTTPS_PORT)}`, String(options.localPort)],
        60_000,
      )
      const refreshed = await inspectStableAccess(inspected.command, options.localPort)
      const publicUrl = refreshed.publicUrl
        || readTailscaleFunnelPublicUrl(`${result.stdout}\n${result.stderr}`, options.localPort)
      if (!publicUrl) {
        throw Object.assign(new Error('Tailscale Funnel 已启动，但没有返回固定公网地址。'), {
          code: 'TAILSCALE_URL_NOT_FOUND',
        })
      }

      snapshot = {
        ...refreshed,
        active: true,
        phase: 'verifying',
        publicUrl,
        startedAtIso: new Date().toISOString(),
        message: '正在验证固定地址、访问密码和消息连接…',
        verification: createVerification(),
      }
      const verificationResult = await verifyPublicAccess(publicUrl, () => true)
      const { verification } = verificationResult
      if (!verification.auth) {
        throw Object.assign(new Error('固定地址的密码保护验证失败，已拒绝标记为可用。'), {
          code: 'PUBLIC_AUTH_VERIFY_FAILED',
        })
      }
      if (!verification.websocketAuth) {
        throw Object.assign(new Error('固定地址的消息连接鉴权验证失败，已拒绝标记为可用。'), {
          code: 'PUBLIC_WEBSOCKET_AUTH_VERIFY_FAILED',
        })
      }
      if (!verification.health) {
        throw Object.assign(new Error('固定地址的公网健康检查未通过。'), {
          code: 'PUBLIC_HEALTH_VERIFY_FAILED',
        })
      }

      snapshot = {
        ...snapshot,
        phase: 'ready',
        errorCode: '',
        message: '固定地址已启用；升级或重启后会自动恢复。',
        verification,
      }
      return cloneSnapshot()
    } catch (error) {
      const record = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : {}
      snapshot = {
        ...snapshot,
        active: false,
        phase: 'error',
        errorCode: typeof record.code === 'string' ? record.code : 'TAILSCALE_FUNNEL_FAILED',
        message: typeof record.message === 'string' ? record.message : String(error),
        verification: createVerification(),
      }
      throw Object.assign(new Error(snapshot.message), { code: snapshot.errorCode })
    }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}

export async function stopStableAccess(
  preferredCommand = '',
  expectedLocalPort = 0,
): Promise<StableAccessSnapshot> {
  const inspected = await inspectStableAccess(preferredCommand, expectedLocalPort)
  if (!inspected.installed || !inspected.authenticated || !inspected.command) {
    snapshot = {
      ...inspected,
      active: false,
      phase: inspected.installed ? inspected.phase : 'unavailable',
      publicUrl: '',
      verification: createVerification(),
    }
    return cloneSnapshot()
  }
  if (inspected.errorCode === 'TAILSCALE_PORT_IN_USE') {
    return cloneSnapshot()
  }

  snapshot = {
    ...inspected,
    phase: 'stopping',
    message: '正在关闭固定手机访问…',
  }
  await runTailscale(inspected.command, ['funnel', `--https=${String(FUNNEL_HTTPS_PORT)}`, 'off'])
  snapshot = {
    ...inspected,
    active: false,
    phase: 'idle',
    publicUrl: '',
    startedAtIso: '',
    errorCode: '',
    message: '固定手机访问已停止；再次开启仍会使用同一设备域名。',
    verification: createVerification(),
  }
  return cloneSnapshot()
}

export function getStableAccessSnapshot(): StableAccessSnapshot {
  return cloneSnapshot()
}
