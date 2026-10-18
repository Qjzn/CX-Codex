import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { basename, dirname } from 'node:path'
import type { ReadableStream } from 'node:stream/web'
import { TextDecoder } from 'node:util'
import { RequestBodyTooLargeError, readJsonBody } from './httpBody.js'

// Compile-time constants injected by tsup (`define`). They are intentionally
// module-local declarations: nothing here reads package.json, Git metadata or
// the disk at request time. When a build does not inject them (for example a
// plain tsc build), the identity honestly resolves to `unknown`.
declare const __CX_CODEX_BACKEND_VERSION__: unknown
declare const __CX_CODEX_BACKEND_BUILD_ID__: unknown

export const BACKEND_UPDATE_INTENT_HEADER = 'X-CX-Codex-Intent'
export const BACKEND_UPDATE_INTENT_VALUE = 'backend-update-check'
export const BACKEND_UPDATE_ROUTE_PREFIX = '/codex-api/updates/backend'
export const BACKEND_UPDATE_STATUS_PATH = BACKEND_UPDATE_ROUTE_PREFIX
export const BACKEND_UPDATE_CHECK_PATH = `${BACKEND_UPDATE_ROUTE_PREFIX}/check`
export const BACKEND_UPDATE_APPLY_PATH = `${BACKEND_UPDATE_ROUTE_PREFIX}/apply`
export const OFFICIAL_BACKEND_RELEASE_METADATA_URL = 'https://api.github.com/repos/Qjzn/CX-Codex/releases/latest'
export const BACKEND_UPDATE_METADATA_TIMEOUT_MS = 10_000
export const BACKEND_UPDATE_METADATA_MAX_BYTES = 256 * 1024
export const BACKEND_UPDATE_CHECK_BODY_LIMIT_BYTES = 1024
// User-visible copy states the actual product capability: this build can only
// detect releases. It must not describe internal process/batch wording.
export const BACKEND_UPDATE_UNAVAILABLE_REASON = '仅提供版本检测，当前安装方式暂不支持自动更新。'
export const BACKEND_UPDATE_ORIGIN_UNAVAILABLE_MESSAGE = '本实例尚未确定可信来源（可信来源只来自真实启动绑定/返回端点），已拒绝更新检测。'
export const BACKEND_UPDATE_DISPOSED_MESSAGE = '更新检测已停止，未执行任何请求。'
export const BACKEND_UPDATE_APPLY_UNSUPPORTED_MESSAGE = '当前安装方式不提供自动更新：没有下载、安装、重启或回滚能力，已拒绝且未产生任何副作用。'
export const BACKEND_UPDATE_BODY_UNREADABLE_MESSAGE = '官方元数据响应缺少可流式读取的响应体，已拒绝读取。'

export type BackendBuildKind = 'compiled-cli' | 'candidate-entry' | 'unknown'

export type BackendPublicIdentity = {
  version: string
  buildId: string
  entrySha256: string
  instanceId: string
  buildKind: BackendBuildKind
  officialSourceVerified: false
}

export type FrozenBackendIdentity = BackendPublicIdentity & {
  readonly entryPath: string | null
  readonly pid: number
}

export type BackendUpdateApplicability = {
  automaticUpdateSupported: false
  reason: string
}

export type BackendUpdateComparison = 'newer' | 'equal' | 'ahead' | 'unknown'
export type BackendUpdateCheckStatus = BackendUpdateComparison | 'error'

export type BackendUpdateErrorCode =
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'http-status'
  | 'redirect'
  | 'content-type'
  | 'too-large'
  | 'invalid-json'
  | 'invalid-release'
  | 'invalid-tag'
  | 'apply-unsupported'
  | 'unavailable'

export type BackendUpdateCheckResult = {
  checkedAtIso: string
  instanceId: string
  releaseSource: 'official-release-metadata' | 'unknown'
  status: BackendUpdateCheckStatus
  comparison: BackendUpdateComparison
  current: { version: string; buildId: string }
  latest: { tag: string; version: string } | null
  error: { code: BackendUpdateErrorCode; message: string } | null
}

export type BackendUpdateStatus = {
  backend: BackendPublicIdentity
  applicability: BackendUpdateApplicability
  result: BackendUpdateCheckResult | null
  trustedOriginConfigured: boolean
}

export type StableSemver = { major: number; minor: number; patch: number; buildMetadata: string | null }

const STABLE_SEMVER_PATTERN = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

/**
 * Strict stable semver for the official release tag. Accepts an optional `v`
 * prefix and ignores build metadata for precedence. Prereleases, partial
 * versions, leading zeroes and numbers that cannot be represented safely are
 * rejected rather than guessed.
 */
export function parseStableSemver(value: unknown): StableSemver | null {
  if (typeof value !== 'string') return null
  const match = STABLE_SEMVER_PATTERN.exec(value.trim())
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  return { major, minor, patch, buildMetadata: match[4] ? match[4].slice(1) : null }
}

/** Numeric major/minor/patch comparison; never string ordering. */
export function compareStableSemver(current: unknown, latest: unknown): BackendUpdateComparison {
  const installed = parseStableSemver(current)
  const released = parseStableSemver(latest)
  if (!installed || !released) return 'unknown'
  if (released.major !== installed.major) return released.major > installed.major ? 'newer' : 'ahead'
  if (released.minor !== installed.minor) return released.minor > installed.minor ? 'newer' : 'ahead'
  if (released.patch !== installed.patch) return released.patch > installed.patch ? 'newer' : 'ahead'
  return 'equal'
}

function readCompiledConstant(accessor: () => unknown): string {
  try {
    const value = accessor()
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

export const COMPILED_BACKEND_VERSION = readCompiledConstant(
  () => (typeof __CX_CODEX_BACKEND_VERSION__ === 'undefined' ? undefined : __CX_CODEX_BACKEND_VERSION__),
)
export const COMPILED_BACKEND_BUILD_ID = readCompiledConstant(
  () => (typeof __CX_CODEX_BACKEND_BUILD_ID__ === 'undefined' ? undefined : __CX_CODEX_BACKEND_BUILD_ID__),
)

export const UNIDENTIFIED_BACKEND_IDENTITY: FrozenBackendIdentity = Object.freeze({
  version: 'unknown',
  buildId: 'unknown',
  entrySha256: 'unknown',
  instanceId: 'unknown',
  buildKind: 'unknown' as BackendBuildKind,
  officialSourceVerified: false as const,
  entryPath: null,
  pid: -1,
})

export function readPublicBackendIdentity(identity: FrozenBackendIdentity | null | undefined): BackendPublicIdentity {
  const source = identity ?? UNIDENTIFIED_BACKEND_IDENTITY
  return {
    version: source.version,
    buildId: source.buildId,
    entrySha256: source.entrySha256,
    instanceId: source.instanceId,
    buildKind: source.buildKind,
    officialSourceVerified: false,
  }
}

export type CaptureBackendIdentityOptions = {
  entryPath?: string | null
  compiledVersion?: string
  compiledBuildId?: string
  instanceId?: string
  pid?: number
  readEntrySha256?: (entryPath: string) => Promise<string>
}

async function readFileSha256(entryPath: string): Promise<string> {
  const bytes = await readFile(entryPath)
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Freezes the running backend identity once at startup. Nothing here is
 * re-read later: the entry bytes are hashed a single time and the compiled
 * version/buildId are compile-time constants. A missing compiled identity or an
 * unreadable entry degrades to `unknown` and never blocks startup.
 */
export async function captureFrozenBackendIdentity(options: CaptureBackendIdentityOptions = {}): Promise<FrozenBackendIdentity> {
  const version = readCompiledConstant(() => options.compiledVersion ?? COMPILED_BACKEND_VERSION)
  const buildId = readCompiledConstant(() => options.compiledBuildId ?? COMPILED_BACKEND_BUILD_ID)
  const entryPath = typeof options.entryPath === 'string' && options.entryPath.trim().length > 0 ? options.entryPath : null

  let entrySha256 = 'unknown'
  if (entryPath) {
    try {
      entrySha256 = await (options.readEntrySha256 ?? readFileSha256)(entryPath)
    } catch {
      entrySha256 = 'unknown'
    }
  }

  const buildKind: BackendBuildKind = version === 'unknown'
    ? 'unknown'
    : entryPath && basename(dirname(entryPath)) === 'dist-cli'
      ? 'compiled-cli'
      : 'candidate-entry'

  return Object.freeze({
    version,
    buildId,
    entrySha256: /^[0-9a-f]{64}$/u.test(entrySha256) ? entrySha256 : 'unknown',
    instanceId: options.instanceId ?? `instance-${randomUUID()}`,
    buildKind,
    officialSourceVerified: false as const,
    entryPath,
    pid: typeof options.pid === 'number' ? options.pid : process.pid,
  })
}

/**
 * The metadata transport exposes the real `Response` shape. The body must be a
 * readable byte stream: the checker reads it incrementally and enforces the
 * byte bound while reading. There is deliberately no whole-body `text()`
 * shortcut, because that would buffer an unbounded chunked/decompressed body
 * before any limit could be applied.
 */
export type BackendMetadataTransportResponse = {
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}

export type BackendMetadataTransport = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<BackendMetadataTransportResponse>

const defaultMetadataTransport: BackendMetadataTransport = (url, init) => globalThis.fetch(url, {
  method: 'GET',
  redirect: 'manual',
  signal: init.signal,
  headers: {
    accept: 'application/vnd.github+json',
    'user-agent': 'cx-codex-readonly-update-check',
  },
}) as Promise<BackendMetadataTransportResponse>

export class BackendReleaseValidationError extends Error {
  constructor(readonly code: BackendUpdateErrorCode, message: string) {
    super(message)
    this.name = 'BackendReleaseValidationError'
  }
}

/**
 * The check settled without the transport cooperating: the timer fired or the
 * controller was disposed. It is thrown by the settle path (and by the reader
 * once the abort is observed), so an injected transport that ignores
 * `AbortSignal` still cannot keep a check pending or publish a late result.
 */
class BackendUpdateSettledError extends Error {
  constructor(readonly reason: 'timeout' | 'dispose') {
    super(reason === 'timeout' ? '官方元数据请求超时。' : '更新检测已停止。')
    this.name = 'BackendUpdateSettledError'
  }
}

type MetadataReadScope = {
  signal: AbortSignal
  settleReason: () => 'timeout' | 'dispose' | null
}

function isReadableStreamBody(value: unknown): value is ReadableStream<Uint8Array> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { getReader?: unknown }).getReader === 'function'
}

/**
 * Reads the metadata body incrementally, decoding as it arrives and cancelling
 * the stream as soon as the byte bound is exceeded or the check settles.
 * `content-length` is only an early guard applied by the caller; the enforced
 * limit is the number of bytes actually received from the stream, so a chunked
 * or decompressed body can never be buffered past the bound.
 */
async function readBoundedMetadataText(
  response: BackendMetadataTransportResponse,
  maxBytes: number,
  scope: MetadataReadScope,
): Promise<string> {
  const body = response?.body ?? null
  if (!isReadableStreamBody(body)) {
    throw new BackendReleaseValidationError('network', BACKEND_UPDATE_BODY_UNREADABLE_MESSAGE)
  }
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let receivedBytes = 0
  let text = ''
  let cancelRequested = false
  const cancelReader = (reason: string): Promise<void> => {
    if (cancelRequested) return Promise.resolve()
    cancelRequested = true
    try {
      return Promise.resolve(reader.cancel(reason)).then(() => undefined, () => undefined)
    } catch {
      // A released reader cannot cancel; the check itself already settled.
      return Promise.resolve()
    }
  }
  const onAbort = (): void => {
    // A settled check must not keep draining the network; failing to cancel is
    // not fatal because the race below already settled the check.
    void cancelReader('backend update check settled')
  }
  const settledAtEntry = scope.settleReason()
  if (settledAtEntry !== null) {
    await cancelReader('backend update check settled')
    throw new BackendUpdateSettledError(settledAtEntry)
  }
  scope.signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      const settledReason = scope.settleReason()
      if (settledReason !== null) throw new BackendUpdateSettledError(settledReason)
      const chunk = await reader.read()
      if (chunk.done) break
      const value = chunk.value
      if (!value || value.byteLength === 0) continue
      receivedBytes += value.byteLength
      if (receivedBytes > maxBytes) {
        await cancelReader('官方元数据响应超过允许大小。')
        throw new BackendReleaseValidationError('too-large', '官方元数据响应超过允许大小。')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    scope.signal.removeEventListener('abort', onAbort)
    try {
      // Release the lock after settlement (success, rejection or abort) so the
      // caller can still cancel a body that was never read to completion.
      reader.releaseLock()
    } catch {
      // A released or errored reader needs no further cleanup.
    }
  }
  return text
}

/**
 * Cancels an acquired response body that will not be read (early HTTP/type or
 * declared-length rejection, or a response that arrived after the check
 * settled). The cancel promise is deliberately not awaited: an uncooperative
 * transport must not be able to keep a bounded check pending.
 */
function cancelUnreadResponseBody(
  response: BackendMetadataTransportResponse | null | undefined,
  reason: string,
): void {
  try {
    void response?.body?.cancel(reason)?.catch(() => {})
  } catch {
    // A locked or already-cancelled stream is not an error for a rejected response.
  }
}

export type BackendReleaseMetadata = { tag: string; version: string }

function parseReleaseMetadata(text: string): BackendReleaseMetadata {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new BackendReleaseValidationError('invalid-json', '官方发行元数据不是合法 JSON。')
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BackendReleaseValidationError('invalid-release', '官方发行元数据结构不可识别。')
  }
  const record = payload as Record<string, unknown>
  // A fixed endpoint is still untrusted input: only an explicit, boolean
  // `draft === false`/`prerelease === false` pair marks a released stable
  // version. Missing or non-boolean flags are not treated as released.
  if (record.draft !== false) {
    throw new BackendReleaseValidationError('invalid-release', '官方发行未显式标记为已发布（draft 必须为 false）。')
  }
  if (record.prerelease !== false) {
    throw new BackendReleaseValidationError('invalid-release', '官方发行未显式标记为正式版（prerelease 必须为 false）。')
  }
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
  if (!tag) throw new BackendReleaseValidationError('invalid-release', '官方发行缺少 tag_name。')
  const parsed = parseStableSemver(tag)
  if (!parsed) {
    throw new BackendReleaseValidationError('invalid-tag', `官方发行 tag 不是稳定的正式版本号：${tag.slice(0, 60)}`)
  }
  return { tag, version: `${parsed.major}.${parsed.minor}.${parsed.patch}` }
}

export type BackendUpdateControllerOptions = {
  identity?: FrozenBackendIdentity | null
  nowIso?: () => string
}

export type BackendUpdateDependencies = {
  fetchMetadata?: BackendMetadataTransport
  timeoutMs?: number
  maxResponseBytes?: number
}

type InFlightBackendUpdateCheck = {
  timer: ReturnType<typeof setTimeout>
  settle: (reason: 'timeout' | 'dispose') => void
}

export type BackendUpdateHttpResponse = {
  statusCode: number
  headersSent?: boolean
  setHeader(name: string, value: string): void
  end(payload?: string): void
}

export type BackendUpdateController = {
  readPublicIdentity: () => BackendPublicIdentity
  readStatus: () => BackendUpdateStatus
  addTrustedOrigin: (origin: string) => void
  handleHttp: (req: IncomingMessage, res: BackendUpdateHttpResponse) => Promise<boolean>
  check: () => Promise<BackendUpdateStatus>
  dispose: () => void
}

type TrustedContextResult = { ok: true } | { ok: false; status: number; code: string; message: string }

function readRequestHeader(req: IncomingMessage, name: string): string {
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers
  const raw = headers?.[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] ?? ''
  return typeof raw === 'string' ? raw : ''
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    if (!url.hostname || url.hostname === '0.0.0.0' || url.hostname === '[::]' || url.hostname === '::') return null
    return url.origin === 'null' ? null : url.origin
  } catch {
    return null
  }
}

function normalizeRequestPath(req: IncomingMessage): string {
  const raw = typeof req.url === 'string' ? req.url : ''
  const separatorIndex = raw.search(/[?#]/u)
  const pathOnly = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw
  if (pathOnly.length <= 1) return pathOnly || '/'
  const trimmed = pathOnly.replace(/\/+$/u, '')
  return trimmed.length > 0 ? trimmed : '/'
}

/**
 * Trusted origins come only from the real startup binding / returned endpoint
 * and are injected by the CLI after the trusted bind is known. They are never
 * derived from request headers, and a wildcard bind is never a trusted
 * authority. Without any trusted origin, an explicit check fails closed.
 */
export function resolveTrustedUpdateOrigins(options: {
  bindHost: string
  port: number
  advertisedUrls?: string[]
  publicTunnelUrl?: string | null
}): string[] {
  const origins = new Set<string>()
  const bindHost = options.bindHost.trim().toLowerCase()
  const port = options.port
  const loopbackForms = [`http://127.0.0.1:${String(port)}`, `http://localhost:${String(port)}`, `http://[::1]:${String(port)}`]
  const isWildcardBind = !bindHost || bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '[::]'
  const isLoopbackBind = bindHost === 'localhost' || bindHost.startsWith('127.') || bindHost === '::1' || bindHost === '[::1]'

  if (isWildcardBind || isLoopbackBind) {
    // A wildcard bind itself is not a browseable authority; the concrete local
    // endpoints are (this process always serves loopback when bound locally).
    for (const form of loopbackForms) origins.add(form)
  } else {
    origins.add(`http://${bindHost.includes(':') ? `[${bindHost}]` : bindHost}:${String(port)}`)
  }

  for (const advertised of options.advertisedUrls ?? []) {
    const normalized = normalizeOrigin(advertised)
    if (normalized) origins.add(normalized)
  }
  if (options.publicTunnelUrl) {
    const normalized = normalizeOrigin(options.publicTunnelUrl)
    if (normalized) origins.add(normalized)
  }

  return Array.from(origins)
}

function cloneResult(result: BackendUpdateCheckResult): BackendUpdateCheckResult {
  return {
    checkedAtIso: result.checkedAtIso,
    instanceId: result.instanceId,
    releaseSource: result.releaseSource,
    status: result.status,
    comparison: result.comparison,
    current: { version: result.current.version, buildId: result.current.buildId },
    latest: result.latest ? { tag: result.latest.tag, version: result.latest.version } : null,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
  }
}

function sendJson(
  res: BackendUpdateHttpResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.end(body)
}

export function createBackendUpdateController(
  options: BackendUpdateControllerOptions = {},
  dependencies: BackendUpdateDependencies = {},
): BackendUpdateController {
  const identity = options.identity ?? UNIDENTIFIED_BACKEND_IDENTITY
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const transport = dependencies.fetchMetadata ?? defaultMetadataTransport
  const timeoutMs = typeof dependencies.timeoutMs === 'number' && dependencies.timeoutMs > 0
    ? dependencies.timeoutMs
    : BACKEND_UPDATE_METADATA_TIMEOUT_MS
  const maxResponseBytes = typeof dependencies.maxResponseBytes === 'number' && dependencies.maxResponseBytes > 0
    ? dependencies.maxResponseBytes
    : BACKEND_UPDATE_METADATA_MAX_BYTES
  const applicability: BackendUpdateApplicability = {
    automaticUpdateSupported: false,
    reason: BACKEND_UPDATE_UNAVAILABLE_REASON,
  }

  const trustedOrigins = new Set<string>()
  const allowedAuthorities = new Set<string>()
  const inFlight = new Set<InFlightBackendUpdateCheck>()
  let lastResult: BackendUpdateCheckResult | null = null
  let checkGeneration = 0
  let disposed = false

  function errorResult(code: BackendUpdateErrorCode, message: string, checkedAtIso: string): BackendUpdateCheckResult {
    return {
      checkedAtIso,
      instanceId: identity.instanceId,
      releaseSource: 'unknown',
      status: 'error',
      comparison: 'unknown',
      current: { version: identity.version, buildId: identity.buildId },
      latest: null,
      error: { code, message },
    }
  }

  function readStatus(): BackendUpdateStatus {
    return {
      backend: readPublicBackendIdentity(identity),
      applicability: { automaticUpdateSupported: false, reason: applicability.reason },
      result: lastResult ? cloneResult(lastResult) : null,
      trustedOriginConfigured: trustedOrigins.size > 0,
    }
  }

  function addTrustedOrigin(origin: string): void {
    const normalized = normalizeOrigin(origin)
    if (!normalized) return
    trustedOrigins.add(normalized)
    const url = new URL(normalized)
    const explicitPort = url.port
    const hostname = url.hostname.toLowerCase()
    const isLoopbackAuthority = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
    const authorities = isLoopbackAuthority ? ['127.0.0.1', 'localhost', '[::1]'] : [hostname]
    for (const authority of authorities) {
      allowedAuthorities.add(explicitPort ? `${authority}:${explicitPort}` : authority)
    }
  }

  function validateTrustedContext(req: IncomingMessage): TrustedContextResult {
    const fetchSite = readRequestHeader(req, 'sec-fetch-site').trim().toLowerCase()
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
      return { ok: false, status: 403, code: 'cross-site-blocked', message: '跨站来源的更新请求已被拒绝。' }
    }
    const originHeader = readRequestHeader(req, 'origin').trim()
    if (originHeader.length > 0) {
      const normalized = normalizeOrigin(originHeader)
      if (!normalized || !trustedOrigins.has(normalized)) {
        return { ok: false, status: 403, code: 'origin-not-trusted', message: '请求来源不在本实例的可信来源内，已拒绝。' }
      }
    }
    if (allowedAuthorities.size > 0) {
      const host = readRequestHeader(req, 'host').trim().toLowerCase()
      if (!host || !allowedAuthorities.has(host)) {
        return { ok: false, status: 403, code: 'host-not-trusted', message: '请求 Host 不在本实例的可信 authority 内，已拒绝。' }
      }
    }
    return { ok: true }
  }

  async function evaluateMetadataResponse(
    response: BackendMetadataTransportResponse,
    checkedAtIso: string,
    scope: MetadataReadScope,
  ): Promise<BackendUpdateCheckResult> {
    try {
      const status = typeof response?.status === 'number' ? response.status : 0
      if (status >= 300 && status < 400) {
        throw new BackendReleaseValidationError('redirect', `官方元数据端点返回了重定向（HTTP ${String(status)}），已拒绝。`)
      }
      if (status !== 200) {
        throw new BackendReleaseValidationError('http-status', `官方元数据端点返回 HTTP ${String(status)}。`)
      }
      const contentType = String(response.headers?.get('content-type') ?? '').toLowerCase()
      if (!contentType.includes('application/json')) {
        throw new BackendReleaseValidationError('content-type', `官方元数据响应不是 JSON（${contentType || '缺少 content-type'}）。`)
      }
      // `content-length` only rejects obvious oversized bodies early; it is
      // neither required nor trusted. The real cap is enforced while streaming
      // the body below.
      const declaredLength = Number.parseInt(String(response.headers?.get('content-length') ?? ''), 10)
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        throw new BackendReleaseValidationError('too-large', '官方元数据响应超过允许大小。')
      }
      const text = await readBoundedMetadataText(response, maxResponseBytes, scope)
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
        throw new BackendReleaseValidationError('too-large', '官方元数据响应超过允许大小。')
      }
      const release = parseReleaseMetadata(text)
      const comparison = compareStableSemver(identity.version, release.version)
      return {
        checkedAtIso,
        instanceId: identity.instanceId,
        releaseSource: 'official-release-metadata',
        status: comparison,
        comparison,
        current: { version: identity.version, buildId: identity.buildId },
        latest: release,
        error: null,
      }
    } catch (error) {
      // Whatever rejects this response, its body may still be unread: cancel it
      // so a rejected metadata stream is never left draining in the background.
      cancelUnreadResponseBody(response, 'backend update metadata rejected')
      throw error
    }
  }

  async function runCheck(): Promise<BackendUpdateCheckResult> {
    const checkedAtIso = nowIso()
    if (disposed) {
      const unavailable = errorResult('unavailable', BACKEND_UPDATE_DISPOSED_MESSAGE, checkedAtIso)
      lastResult = unavailable
      return unavailable
    }

    const generation = ++checkGeneration
    const abortController = new AbortController()
    const signal = abortController.signal
    let settleReason: 'timeout' | 'dispose' | null = null
    const readSettleReason = (): 'timeout' | 'dispose' | null => settleReason ?? (disposed ? 'dispose' : null)
    let rejectSettlement: ((error: unknown) => void) | null = null
    // Settles the check itself (independent of whether the transport honours
    // the abort signal), so a timeout/dispose can never leave a check pending.
    const settlement = new Promise<never>((_resolve, reject) => {
      rejectSettlement = reject
    })
    const onAbort = (): void => {
      rejectSettlement?.(new BackendUpdateSettledError(readSettleReason() ?? 'dispose'))
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const settle = (reason: 'timeout' | 'dispose'): void => {
      if (settleReason === null) settleReason = reason
      try {
        abortController.abort()
      } catch {
        // Aborting is best effort: the settlement promise still bounds the check.
      }
    }
    const timer = setTimeout(() => { settle('timeout') }, timeoutMs)
    const record: InFlightBackendUpdateCheck = { timer, settle }
    inFlight.add(record)

    const scope: MetadataReadScope = { signal, settleReason: readSettleReason }

    let result: BackendUpdateCheckResult
    try {
      const operation = (async (): Promise<BackendUpdateCheckResult> => {
        const response = await transport(OFFICIAL_BACKEND_RELEASE_METADATA_URL, { signal })
        const settledReason = readSettleReason()
        // A response that arrives after the check settled (timeout/dispose) is
        // never evaluated or published, even if the transport ignored the signal.
        if (settledReason !== null || signal.aborted) {
          // The check already settled: cancel the unread body instead of
          // evaluating or draining a late response.
          cancelUnreadResponseBody(response, 'backend update check settled')
          throw new BackendUpdateSettledError(settledReason ?? 'dispose')
        }
        return evaluateMetadataResponse(response, checkedAtIso, scope)
      })()
      result = await Promise.race([operation, settlement])
    } catch (error) {
      if (error instanceof BackendUpdateSettledError) {
        result = error.reason === 'timeout'
          ? errorResult('timeout', '官方元数据请求超时，未完成检测。', checkedAtIso)
          : errorResult('aborted', '更新检测已中止，未完成检测。', checkedAtIso)
      } else if (error instanceof BackendReleaseValidationError) {
        result = errorResult(error.code, error.message, checkedAtIso)
      } else if (readSettleReason() === 'timeout') {
        result = errorResult('timeout', '官方元数据请求超时，未完成检测。', checkedAtIso)
      } else if (signal.aborted || disposed) {
        result = errorResult('aborted', '更新检测已中止，未完成检测。', checkedAtIso)
      } else {
        result = errorResult('network', '官方元数据请求失败（网络或协议错误），未完成检测。', checkedAtIso)
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      inFlight.delete(record)
    }

    // Only the newest check may publish, and never after dispose: a late
    // response must not look like the current backend result.
    if (generation === checkGeneration && !disposed) lastResult = result
    return result
  }

  function statusWithResult(result: BackendUpdateCheckResult): BackendUpdateStatus {
    return {
      backend: readPublicBackendIdentity(identity),
      applicability: { automaticUpdateSupported: false, reason: applicability.reason },
      result: cloneResult(result),
      trustedOriginConfigured: trustedOrigins.size > 0,
    }
  }

  async function check(): Promise<BackendUpdateStatus> {
    if (disposed) {
      return statusWithResult(await runCheck())
    }
    if (trustedOrigins.size === 0) {
      const unavailable = errorResult('unavailable', BACKEND_UPDATE_ORIGIN_UNAVAILABLE_MESSAGE, nowIso())
      lastResult = unavailable
      return statusWithResult(unavailable)
    }
    // The returned status always reports this check's own outcome; a superseded
    // or disposed check cannot be mistaken for the published current state.
    return statusWithResult(await runCheck())
  }

  async function handleHttp(req: IncomingMessage, res: BackendUpdateHttpResponse): Promise<boolean> {
    const path = normalizeRequestPath(req)
    if (path !== BACKEND_UPDATE_ROUTE_PREFIX && !path.startsWith(`${BACKEND_UPDATE_ROUTE_PREFIX}/`)) return false
    const method = String(req.method ?? 'GET').toUpperCase()

    if (path === BACKEND_UPDATE_STATUS_PATH) {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { error: { code: 'method-not-allowed', message: '更新状态只支持只读 GET。' } }, { Allow: 'GET' })
        return true
      }
      const guard = validateTrustedContext(req)
      if (!guard.ok) {
        sendJson(res, guard.status, { error: { code: guard.code, message: guard.message } })
        return true
      }
      sendJson(res, 200, readStatus())
      return true
    }

    if (path === BACKEND_UPDATE_CHECK_PATH) {
      if (method !== 'POST') {
        sendJson(res, 405, { error: { code: 'method-not-allowed', message: '更新检测只支持显式 POST。' } }, { Allow: 'POST' })
        return true
      }
      // Every rejection below happens before any metadata request.
      const guard = validateTrustedContext(req)
      if (!guard.ok) {
        sendJson(res, guard.status, { error: { code: guard.code, message: guard.message } })
        return true
      }
      if (readRequestHeader(req, BACKEND_UPDATE_INTENT_HEADER).trim() !== BACKEND_UPDATE_INTENT_VALUE) {
        sendJson(res, 403, {
          error: {
            code: 'intent-required',
            message: `显式更新检测需要请求头 ${BACKEND_UPDATE_INTENT_HEADER}: ${BACKEND_UPDATE_INTENT_VALUE}。`,
          },
        })
        return true
      }
      if (!readRequestHeader(req, 'content-type').toLowerCase().includes('application/json')) {
        sendJson(res, 415, { error: { code: 'unsupported-media-type', message: '更新检测请求体必须是 JSON。' } })
        return true
      }
      let payload: unknown
      try {
        payload = await readJsonBody(req, { maxBytes: BACKEND_UPDATE_CHECK_BODY_LIMIT_BYTES })
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(res, 413, { error: { code: 'body-too-large', message: '更新检测请求体过大。' } })
          return true
        }
        sendJson(res, 400, { error: { code: 'invalid-body', message: '更新检测请求体必须是空 JSON 对象 {}。' } })
        return true
      }
      const bodyKeys = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>)
        : null
      if (!bodyKeys || bodyKeys.length > 0) {
        sendJson(res, 400, {
          error: {
            code: 'invalid-body',
            message: '更新检测请求体必须是空 JSON 对象 {}；不接受字段、URL、仓库、路径、force 或命令。',
          },
        })
        return true
      }
      if (trustedOrigins.size === 0) {
        sendJson(res, 503, {
          error: { code: 'trusted-origin-unavailable', message: BACKEND_UPDATE_ORIGIN_UNAVAILABLE_MESSAGE },
        })
        return true
      }
      sendJson(res, 200, await check())
      return true
    }

    if (path === BACKEND_UPDATE_APPLY_PATH) {
      const guard = validateTrustedContext(req)
      if (!guard.ok) {
        sendJson(res, guard.status, { error: { code: guard.code, message: guard.message } })
        return true
      }
      sendJson(res, 409, {
        error: {
          code: 'apply-unsupported',
          message: BACKEND_UPDATE_APPLY_UNSUPPORTED_MESSAGE,
        },
        applicability,
      })
      return true
    }

    sendJson(res, 404, { error: { code: 'not-found', message: '未知的更新端点。' } })
    return true
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    // Synchronously invalidate the in-flight generation and record an honest
    // stopped state: no late success may become the current backend result.
    checkGeneration += 1
    lastResult = errorResult('unavailable', BACKEND_UPDATE_DISPOSED_MESSAGE, nowIso())
    for (const record of inFlight) {
      clearTimeout(record.timer)
      try {
        record.settle('dispose')
      } catch {
        // Settling is best effort; the check settles through its own race.
      }
    }
    inFlight.clear()
  }

  return {
    readPublicIdentity: () => readPublicBackendIdentity(identity),
    readStatus,
    addTrustedOrigin,
    handleHttp,
    check,
    dispose,
  }
}
