import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

import WebSocket from 'ws'

import { canRunCommand } from '../commandResolution.js'

export type QuickTunnelPhase =
  | 'idle'
  | 'installing'
  | 'starting'
  | 'verifying'
  | 'ready'
  | 'stopping'
  | 'error'

export type QuickTunnelVerification = {
  health: boolean
  auth: boolean
  websocketAuth: boolean
}

export type QuickTunnelSnapshot = {
  phase: QuickTunnelPhase
  active: boolean
  publicUrl: string
  command: string
  installedByCxCodex: boolean
  networkMode: 'system-dns' | 'scoped-doh'
  startedAtIso: string
  errorCode: string
  message: string
  verification: QuickTunnelVerification
}

type CloudflaredRelease = {
  tag_name?: unknown
  body?: unknown
  assets?: Array<{
    name?: unknown
    browser_download_url?: unknown
  }>
}

type VerificationProbe = {
  ok: boolean
  status: number
}

const CLOUDFLARED_RELEASE_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/gu
const VERIFY_DELAYS_MS = [0, 1_000, 2_500, 5_000, 9_000]
const MAX_DIAGNOSTIC_CHARS = 12_000

let tunnelChild: ChildProcessByStdio<null, Readable, Readable> | null = null
let quickServiceServer: HttpServer | null = null
let startPromise: Promise<QuickTunnelSnapshot> | null = null
let snapshot: QuickTunnelSnapshot = createIdleSnapshot()

function createVerification(): QuickTunnelVerification {
  return {
    health: false,
    auth: false,
    websocketAuth: false,
  }
}

function createIdleSnapshot(): QuickTunnelSnapshot {
  return {
    phase: 'idle',
    active: false,
    publicUrl: '',
    command: '',
    installedByCxCodex: false,
    networkMode: 'system-dns',
    startedAtIso: '',
    errorCode: '',
    message: '手机访问尚未开启。',
    verification: createVerification(),
  }
}

function cloneSnapshot(): QuickTunnelSnapshot {
  return {
    ...snapshot,
    verification: { ...snapshot.verification },
  }
}

function getCloudflaredUserBinDir(): string {
  return join(homedir(), '.local', 'bin')
}

function getBundledCloudflaredPath(): string {
  return join(
    getCloudflaredUserBinDir(),
    process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
  )
}

function getVerifiedCloudflaredPath(checksum: string): string {
  const suffix = checksum.slice(0, 12)
  return join(
    getCloudflaredUserBinDir(),
    process.platform === 'win32'
      ? `cloudflared-${suffix}.exe`
      : `cloudflared-${suffix}`,
  )
}

function resolveCloudflaredAssetName(): string {
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'cloudflared-windows-amd64.exe'
    if (process.arch === 'ia32') return 'cloudflared-windows-386.exe'
    if (process.arch === 'arm64') return 'cloudflared-windows-arm64.exe'
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'cloudflared-linux-amd64'
    if (process.arch === 'arm64') return 'cloudflared-linux-arm64'
  }
  throw createTunnelError(
    'CLOUDFLARED_UNSUPPORTED_PLATFORM',
    `暂不支持自动安装 cloudflared：${process.platform}/${process.arch}`,
  )
}

function resolveRunnableCloudflared(preferredCommand = ''): string {
  const candidates = [
    preferredCommand,
    process.env.CX_CODEX_CLOUDFLARED_COMMAND?.trim() ?? '',
    process.env.CODEXUI_CLOUDFLARED_COMMAND?.trim() ?? '',
    'cloudflared',
    getBundledCloudflaredPath(),
  ]
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const command = candidate.trim()
    if (!command || seen.has(command)) continue
    seen.add(command)
    if (canRunCommand(command, ['--version'])) return command
  }
  return ''
}

function createTunnelError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function readTunnelError(error: unknown, fallbackCode: string): { code: string; message: string } {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  return {
    code: typeof record.code === 'string' && record.code.trim() ? record.code.trim() : fallbackCode,
    message: typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : String(error),
  }
}

function parseReleaseChecksum(body: string, assetName: string): string {
  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${escapedName}\\s*:\\s*([a-fA-F0-9]{64})(?:\\s|$)`, 'u'))
  return match?.[1]?.toLowerCase() ?? ''
}

async function fetchCloudflaredRelease(): Promise<{
  downloadUrl: string
  checksum: string
  assetName: string
}> {
  const response = await fetch(CLOUDFLARED_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CX-Codex-quick-tunnel',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw createTunnelError(
      'CLOUDFLARED_RELEASE_UNAVAILABLE',
      `无法读取 cloudflared 官方发布信息（HTTP ${String(response.status)}）。`,
    )
  }

  const release = await response.json() as CloudflaredRelease
  const assetName = resolveCloudflaredAssetName()
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === assetName)
    : undefined
  const downloadUrl = typeof asset?.browser_download_url === 'string'
    ? asset.browser_download_url.trim()
    : ''
  const checksum = parseReleaseChecksum(
    typeof release.body === 'string' ? release.body : '',
    assetName,
  )
  if (!downloadUrl || !checksum) {
    throw createTunnelError(
      'DOWNLOAD_VERIFY_FAILED',
      `cloudflared ${String(release.tag_name ?? 'latest')} 缺少可校验的 ${assetName} 发布信息。`,
    )
  }
  return { downloadUrl, checksum, assetName }
}

async function installVerifiedCloudflared(
  release: Awaited<ReturnType<typeof fetchCloudflaredRelease>>,
): Promise<string> {
  const response = await fetch(release.downloadUrl, {
    headers: { 'User-Agent': 'CX-Codex-quick-tunnel' },
  })
  if (!response.ok) {
    throw createTunnelError(
      'CLOUDFLARED_DOWNLOAD_FAILED',
      `下载 cloudflared 失败（HTTP ${String(response.status)}）。`,
    )
  }

  const fileBytes = Buffer.from(await response.arrayBuffer())
  const actualChecksum = createHash('sha256').update(fileBytes).digest('hex')
  if (actualChecksum !== release.checksum) {
    throw createTunnelError(
      'DOWNLOAD_VERIFY_FAILED',
      `cloudflared SHA-256 校验失败：${release.assetName}`,
    )
  }

  const destination = getVerifiedCloudflaredPath(release.checksum)
  const temporaryPath = `${destination}.download-${String(process.pid)}`
  await mkdir(getCloudflaredUserBinDir(), { recursive: true })
  await writeFile(temporaryPath, fileBytes, { mode: 0o755 })
  if (process.platform !== 'win32') await chmod(temporaryPath, 0o755)
  await rm(destination, { force: true })
  await rename(temporaryPath, destination)
  if (!canRunCommand(destination, ['--version'])) {
    await rm(destination, { force: true })
    throw createTunnelError(
      'CLOUDFLARED_VERIFY_FAILED',
      'cloudflared 已下载并通过哈希校验，但无法在当前系统执行。',
    )
  }
  return destination
}

async function validateCachedCloudflared(candidate: string): Promise<boolean> {
  const leaf = candidate.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const match = leaf.match(/^cloudflared-([a-f0-9]{12,64})(?:\.exe)?$/iu)
  if (!match) return false
  try {
    const bytes = await readFile(candidate)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    return checksum.startsWith(match[1]!.toLowerCase())
      && canRunCommand(candidate, ['--version'])
  } catch {
    return false
  }
}

async function findVerifiedCachedCloudflared(preferred = ''): Promise<string> {
  if (preferred && await validateCachedCloudflared(preferred)) return preferred
  try {
    const entries = await readdir(getCloudflaredUserBinDir(), { withFileTypes: true })
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^cloudflared-[a-f0-9]{12,64}(?:\.exe)?$/iu.test(entry.name))
      .map(async (entry) => {
        const path = join(getCloudflaredUserBinDir(), entry.name)
        return { path, mtimeMs: (await stat(path)).mtimeMs }
      }))
    candidates.sort((first, second) => second.mtimeMs - first.mtimeMs)
    for (const candidate of candidates) {
      if (await validateCachedCloudflared(candidate.path)) return candidate.path
    }
  } catch {
    // Continue to an online verified install or an explicitly configured fallback.
  }
  return ''
}

export async function ensureVerifiedCloudflared(preferredCommand = ''): Promise<{
  command: string
  installed: boolean
}> {
  const preferred = preferredCommand.trim()
  const managedPath = getBundledCloudflaredPath()
  const normalizedPreferred = preferred.toLowerCase()
  const normalizedUserBinPrefix = `${getCloudflaredUserBinDir().toLowerCase()}${process.platform === 'win32' ? '\\' : '/'}cloudflared-`
  const isManagedCommand = normalizedPreferred === managedPath.toLowerCase()
    || normalizedPreferred.startsWith(normalizedUserBinPrefix)
  const isExplicitCustomCommand = preferred.length > 0
    && normalizedPreferred !== 'cloudflared'
    && !isManagedCommand
  if (isExplicitCustomCommand && canRunCommand(preferred, ['--version'])) {
    return { command: preferred, installed: false }
  }
  const cached = await findVerifiedCachedCloudflared(preferred)
  if (cached) return { command: cached, installed: false }

  try {
    const release = await fetchCloudflaredRelease()
    const verifiedPath = getVerifiedCloudflaredPath(release.checksum)
    try {
      const managedBytes = await readFile(verifiedPath)
      const managedChecksum = createHash('sha256').update(managedBytes).digest('hex')
      if (managedChecksum === release.checksum && canRunCommand(verifiedPath, ['--version'])) {
        return { command: verifiedPath, installed: false }
      }
    } catch {
      // Missing or stale managed binary: replace it atomically below.
    }
    return {
      command: await installVerifiedCloudflared(release),
      installed: true,
    }
  } catch (error) {
    const existing = resolveRunnableCloudflared(preferred)
    if (existing) return { command: existing, installed: false }
    throw error
  }
}

function parsePublicUrl(text: string): string {
  const matches = text.match(TRYCLOUDFLARE_URL_PATTERN)
  if (!matches) return ''
  for (const candidate of matches.reverse()) {
    try {
      const hostname = new URL(candidate).hostname.toLowerCase()
      if (hostname !== 'api.trycloudflare.com') return candidate.trim()
    } catch {
      // Ignore malformed log fragments.
    }
  }
  return ''
}

function readResponseBody(response: NodeJS.ReadableStream, maxBytes = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) {
        reject(createTunnelError('DNS_RESPONSE_TOO_LARGE', 'DNS 响应超过安全上限。'))
        return
      }
      chunks.push(buffer)
    })
    response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    response.once('error', reject)
  })
}

async function resolveAddressesWithCloudflareDoh(hostname: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const request = httpsRequest({
      hostname: '1.1.1.1',
      servername: 'cloudflare-dns.com',
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      method: 'GET',
      headers: {
        Accept: 'application/dns-json',
        Host: 'cloudflare-dns.com',
        'User-Agent': 'CX-Codex-quick-tunnel',
      },
      timeout: 8_000,
    }, (response) => {
      void readResponseBody(response).then((body) => {
        if (response.statusCode !== 200) {
          reject(new Error(`DoH HTTP ${String(response.statusCode ?? 0)}`))
          return
        }
        const payload = JSON.parse(body) as {
          Answer?: Array<{ type?: unknown; data?: unknown }>
        }
        const addresses = Array.isArray(payload.Answer)
          ? payload.Answer
              .filter((answer) => answer.type === 1 && typeof answer.data === 'string')
              .map((answer) => String(answer.data).trim())
              .filter((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address))
          : []
        resolve([...new Set(addresses)])
      }).catch(reject)
    })
    request.once('timeout', () => request.destroy(new Error('DoH timeout')))
    request.once('error', reject)
    request.end()
  })
}

async function shouldUseScopedDoh(): Promise<{
  useFallback: boolean
  apiAddresses: string[]
}> {
  try {
    const [systemRecords, apiAddresses] = await Promise.all([
      lookup('api.trycloudflare.com', { all: true, family: 4 }),
      resolveAddressesWithCloudflareDoh('api.trycloudflare.com'),
    ])
    const systemAddresses = new Set(systemRecords.map((record) => record.address))
    return {
      useFallback: apiAddresses.length > 0
        && !apiAddresses.some((address) => systemAddresses.has(address)),
      apiAddresses,
    }
  } catch {
    return { useFallback: false, apiAddresses: [] }
  }
}

async function startScopedQuickService(apiAddresses: string[]): Promise<string> {
  if (apiAddresses.length === 0) {
    throw createTunnelError('QUICK_TUNNEL_DNS_BLOCKED', '无法获取 Cloudflare 官方 DNS 结果。')
  }
  const secret = randomBytes(18).toString('hex')
  const expectedPath = `/${secret}/tunnel`
  const apiAddress = apiAddresses[0]!
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== expectedPath) {
      response.statusCode = 404
      response.end()
      return
    }
    const upstream = httpsRequest({
      hostname: apiAddress,
      servername: 'api.trycloudflare.com',
      path: '/tunnel',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CX-Codex-quick-tunnel',
        Host: 'api.trycloudflare.com',
      },
      timeout: 15_000,
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (typeof value === 'undefined') continue
        response.setHeader(name, value)
      }
      upstreamResponse.pipe(response)
    })
    upstream.once('timeout', () => upstream.destroy(new Error('Quick service timeout')))
    upstream.once('error', () => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.statusCode = 502
      response.end()
    })
    request.pipe(upstream)
  })
  quickServiceServer = server
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve scoped quick-service port'))
        return
      }
      resolve(address.port)
    })
  })
  return `http://127.0.0.1:${String(port)}/${secret}`
}

async function stopScopedQuickService(): Promise<void> {
  const server = quickServiceServer
  quickServiceServer = null
  if (!server) return
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function resolveCurlCommand(): string {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl'
  return canRunCommand(command, ['--version']) ? command : ''
}

async function verifyStatusWithCurl(
  url: string,
  resolvedAddresses: string[],
): Promise<number> {
  const curlCommand = resolveCurlCommand()
  if (!curlCommand || resolvedAddresses.length === 0) return 0
  const parsedUrl = new URL(url)
  for (const address of resolvedAddresses) {
    const argumentsList = [
      '--silent',
      '--show-error',
      '--output',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      '--write-out',
      '%{http_code}',
      '--max-time',
      '8',
      '--resolve',
      `${parsedUrl.hostname}:443:${address}`,
      url,
    ]
    const status = await new Promise<number>((resolve) => {
      const child = spawn(curlCommand, argumentsList, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer | string) => {
        output = `${output}${String(chunk)}`.slice(-16)
      })
      child.once('error', () => resolve(0))
      child.once('exit', (code) => {
        const parsedStatus = Number.parseInt(output.trim(), 10)
        resolve(code === 0 && Number.isInteger(parsedStatus) ? parsedStatus : 0)
      })
    })
    if (status > 0) return status
  }
  return 0
}

async function verifyHttpStatus(
  url: string,
  expectedStatus: number,
  isTunnelAlive: () => boolean,
  resolvedAddresses: string[],
): Promise<VerificationProbe> {
  const parsedUrl = new URL(url)
  let lastStatus = 0
  for (const delayMs of VERIFY_DELAYS_MS) {
    await wait(delayMs)
    if (!isTunnelAlive()) return { ok: false, status: lastStatus }
    if (resolvedAddresses.length > 0) {
      lastStatus = await verifyStatusWithCurl(url, resolvedAddresses)
      if (lastStatus === expectedStatus) return { ok: true, status: lastStatus }
    }
    try {
      if (resolvedAddresses.length > 0) {
        lastStatus = await new Promise<number>((resolve, reject) => {
          const request = httpsRequest({
            hostname: resolvedAddresses[0],
            servername: parsedUrl.hostname,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: 'GET',
            headers: {
              Host: parsedUrl.host,
              'User-Agent': 'CX-Codex-quick-tunnel-verifier',
            },
            timeout: 5_000,
          }, (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          })
          request.once('timeout', () => request.destroy(new Error('Tunnel verification timeout')))
          request.once('error', reject)
          request.end()
        })
        if (lastStatus === expectedStatus) return { ok: true, status: lastStatus }
      } else {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(5_000),
        })
        lastStatus = response.status
        if (lastStatus === expectedStatus) return { ok: true, status: lastStatus }
      }
    } catch {
      // Quick Tunnels can take a few seconds to become reachable after printing the URL.
    }
  }
  return { ok: false, status: lastStatus }
}

function verifyUnauthorizedWebSocketOnce(
  publicUrl: string,
  resolvedAddresses: string[],
): Promise<VerificationProbe> {
  const wsUrl = `${publicUrl.replace(/^https:/u, 'wss:')}/codex-api/ws`
  return new Promise((resolve) => {
    const client = new WebSocket(wsUrl, {
      handshakeTimeout: 5_000,
      ...(resolvedAddresses.length > 0
        ? {
            lookup: (
              _hostname: string,
              _options: unknown,
              callback: (error: Error | null, address: string, family: number) => void,
            ) => callback(null, resolvedAddresses[0]!, 4),
          }
        : {}),
    })
    const timeout = setTimeout(() => {
      client.terminate()
      resolve({ ok: false, status: 0 })
    }, 6_000)
    client.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      response.resume()
      resolve({ ok: response.statusCode === 401, status: response.statusCode ?? 0 })
    })
    client.once('open', () => {
      clearTimeout(timeout)
      client.terminate()
      resolve({ ok: false, status: 101 })
    })
    client.once('error', () => {
      clearTimeout(timeout)
      resolve({ ok: false, status: 0 })
    })
  })
}

async function verifyUnauthorizedWebSocket(
  publicUrl: string,
  isTunnelAlive: () => boolean,
  resolvedAddresses: string[],
  sharedAuthProbe: VerificationProbe,
): Promise<VerificationProbe> {
  if (!isTunnelAlive()) return { ok: false, status: 0 }
  const directProbe = await verifyUnauthorizedWebSocketOnce(publicUrl, resolvedAddresses)
  if (directProbe.ok || directProbe.status > 0) return directProbe
  // Some Windows TLS stacks reset Node WebSocket probes even while HTTPS
  // succeeds. The upgrade handler uses the same auth session, so an already
  // confirmed public 401 is the safe fallback only when no handshake response
  // was observable.
  return sharedAuthProbe
}

async function terminateTunnelChild(): Promise<void> {
  await stopScopedQuickService()
  const child = tunnelChild
  tunnelChild = null
  if (!child || child.killed || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (process.platform !== 'win32' || typeof child.pid !== 'number') {
        child.kill('SIGKILL')
        resolve()
        return
      }
      const taskkill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      taskkill.once('exit', () => resolve())
      taskkill.once('error', () => {
        child.kill('SIGKILL')
        resolve()
      })
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function verifyQuickTunnel(
  publicUrl: string,
  isTunnelAlive: () => boolean,
): Promise<{
  verification: QuickTunnelVerification
  statuses: { health: number; auth: number; websocketAuth: number }
}> {
  let resolvedAddresses: string[] = []
  for (const delayMs of VERIFY_DELAYS_MS) {
    await wait(delayMs)
    try {
      resolvedAddresses = await resolveAddressesWithCloudflareDoh(new URL(publicUrl).hostname)
      if (resolvedAddresses.length > 0) break
    } catch {
      // Quick Tunnel records can take a few seconds to appear in public DNS.
    }
  }
  const health = await verifyHttpStatus(
    `${publicUrl}/health`,
    200,
    isTunnelAlive,
    resolvedAddresses,
  )
  const auth = await verifyHttpStatus(
    `${publicUrl}/codex-api/tunnel-status`,
    401,
    isTunnelAlive,
    resolvedAddresses,
  )
  const websocketAuth = await verifyUnauthorizedWebSocket(
    publicUrl,
    isTunnelAlive,
    resolvedAddresses,
    auth,
  )
  return {
    verification: {
      health: health.ok,
      auth: auth.ok,
      websocketAuth: websocketAuth.ok,
    },
    statuses: {
      health: health.status,
      auth: auth.status,
      websocketAuth: websocketAuth.status,
    },
  }
}

export function getQuickTunnelSnapshot(): QuickTunnelSnapshot {
  return cloneSnapshot()
}

export async function startQuickTunnel(options: {
  localPort: number
  preferredCommand?: string
}): Promise<QuickTunnelSnapshot> {
  if (!Number.isInteger(options.localPort) || options.localPort < 1 || options.localPort > 65535) {
    throw createTunnelError('INVALID_LOCAL_PORT', '无法确定 CX-Codex 当前监听端口。')
  }
  if (snapshot.active && tunnelChild && tunnelChild.exitCode === null) return cloneSnapshot()
  if (startPromise) return await startPromise

  startPromise = (async () => {
    snapshot = {
      ...createIdleSnapshot(),
      phase: 'installing',
      message: '正在检查 cloudflared 并校验官方发布文件…',
    }
    let diagnostics = ''
    try {
      const cloudflared = await ensureVerifiedCloudflared(options.preferredCommand)
      snapshot = {
        ...snapshot,
        phase: 'starting',
        command: cloudflared.command,
        installedByCxCodex: cloudflared.installed,
        message: '正在建立临时加密通道…',
      }

      const configPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const dnsPlan = await shouldUseScopedDoh()
      const quickServiceUrl = dnsPlan.useFallback
        ? await startScopedQuickService(dnsPlan.apiAddresses)
        : ''
      snapshot = {
        ...snapshot,
        networkMode: quickServiceUrl ? 'scoped-doh' : 'system-dns',
      }
      const tunnelArguments = [
        'tunnel',
        '--config',
        configPath,
        '--no-autoupdate',
      ]
      if (quickServiceUrl) {
        tunnelArguments.push('--quick-service', quickServiceUrl)
      }
      tunnelArguments.push(
        '--http-host-header',
        'cx-codex-quick-tunnel.invalid',
        '--url',
        `http://127.0.0.1:${String(options.localPort)}`,
      )
      const child = spawn(
        cloudflared.command,
        tunnelArguments,
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      tunnelChild = child
      let childExited = false
      child.once('exit', () => {
        childExited = true
      })

      const publicUrl = await new Promise<string>((resolve, reject) => {
        let settled = false
        let detectedPublicUrl = ''
        let registered = false
        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          reject(createTunnelError(
            diagnostics.includes('api.trycloudflare.com')
              ? 'QUICK_TUNNEL_DNS_BLOCKED'
              : 'QUICK_TUNNEL_TIMEOUT',
            '等待 Cloudflare 临时地址超时，请检查 DNS 和网络连接。',
          ))
        }, 70_000)
        const handleData = (value: Buffer | string) => {
          const text = String(value)
          diagnostics = `${diagnostics}${text}`.slice(-MAX_DIAGNOSTIC_CHARS)
          detectedPublicUrl = parsePublicUrl(text) || detectedPublicUrl
          registered = registered || /Registered tunnel connection/iu.test(text)
          if (!detectedPublicUrl || !registered || settled) return
          settled = true
          clearTimeout(timeout)
          resolve(detectedPublicUrl)
        }
        child.stdout.on('data', handleData)
        child.stderr.on('data', handleData)
        child.once('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(createTunnelError('QUICK_TUNNEL_START_FAILED', error.message))
        })
        child.once('exit', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(createTunnelError(
            'QUICK_TUNNEL_START_FAILED',
            `cloudflared 在生成公网地址前退出（${String(code ?? 'unknown')}）。`,
          ))
        })
      })
      snapshot = {
        ...snapshot,
        phase: 'verifying',
        publicUrl,
        startedAtIso: new Date().toISOString(),
        message: '正在验证公网健康状态和鉴权边界…',
      }
      if (childExited || child.exitCode !== null) {
        throw createTunnelError('QUICK_TUNNEL_EXITED', '临时通道在公网验证前退出。')
      }
      const verificationResult = await verifyQuickTunnel(
        publicUrl,
        () => !childExited && child.exitCode === null,
      )
      const { verification } = verificationResult
      snapshot = {
        ...snapshot,
        verification,
      }
      if (childExited || child.exitCode !== null) {
        throw createTunnelError('QUICK_TUNNEL_EXITED', '临时通道在公网验证期间退出。')
      }
      if (!verification.auth) {
        throw createTunnelError(
          'PUBLIC_AUTH_VERIFY_FAILED',
          `公网鉴权验证失败（HTTP ${String(verificationResult.statuses.auth || 'unreachable')}），已拒绝开放手机访问。`,
        )
      }
      if (!verification.websocketAuth) {
        throw createTunnelError(
          'PUBLIC_WEBSOCKET_AUTH_VERIFY_FAILED',
          `公网消息连接鉴权验证失败（HTTP ${String(verificationResult.statuses.websocketAuth || 'unreachable')}），已拒绝开放手机访问。`,
        )
      }
      if (!verification.health) {
        throw createTunnelError(
          'PUBLIC_HEALTH_VERIFY_FAILED',
          `公网健康检查未通过（HTTP ${String(verificationResult.statuses.health || 'unreachable')}），已关闭临时通道。`,
        )
      }

      snapshot = {
        ...snapshot,
        phase: 'ready',
        active: true,
        verification,
        message: '手机访问已开启，关闭程序或手动停止后地址失效。',
      }
      child.once('exit', (code) => {
        if (tunnelChild !== child) return
        tunnelChild = null
        snapshot = {
          ...snapshot,
          phase: code === 0 ? 'idle' : 'error',
          active: false,
          publicUrl: '',
          errorCode: code === 0 ? '' : 'QUICK_TUNNEL_EXITED',
          message: code === 0 ? '手机访问已停止。' : '临时通道意外退出，请重新开启。',
          verification: createVerification(),
        }
      })
      return cloneSnapshot()
    } catch (error) {
      await terminateTunnelChild()
      const failure = readTunnelError(error, 'QUICK_TUNNEL_FAILED')
      snapshot = {
        ...snapshot,
        phase: 'error',
        active: false,
        publicUrl: '',
        errorCode: failure.code,
        message: failure.message,
        verification: { ...snapshot.verification },
      }
      throw createTunnelError(failure.code, failure.message)
    } finally {
      startPromise = null
    }
  })()

  return await startPromise
}

export async function stopQuickTunnel(): Promise<QuickTunnelSnapshot> {
  snapshot = {
    ...snapshot,
    phase: 'stopping',
    message: '正在关闭手机访问…',
  }
  await terminateTunnelChild()
  snapshot = {
    ...createIdleSnapshot(),
    message: '手机访问已停止。',
  }
  return cloneSnapshot()
}
