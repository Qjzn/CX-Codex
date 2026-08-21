import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { networkInterfaces } from 'node:os'
import { existsSync } from 'node:fs'
import { writeFile, stat } from 'node:fs/promises'
import express, { type Express } from 'express'
import { createCodexBridgeMiddleware } from './codexAppServerBridge.js'
import { createAuthSession, isLoopbackRequest } from './authMiddleware.js'
import { readJsonBody, RequestBodyTooLargeError } from './httpBody.js'
import { persistAccessPassword } from './localAccessConfig.js'
import {
  resolveUploadedFilePath,
  UploadedFileAccessError,
} from './fileUpload.js'
import {
  LocalFileAccessError,
  resolveWorkspaceLocalPath,
} from './localFileAccessPolicy.js'
import { getTunnelStatus } from './tunnelStatus.js'
import { renderLocalSetupHtml } from './localPairingPage.js'
import { generatePassword } from './password.js'
import { createDirectoryListingHtml, createLocalFileActionHtml, createTextEditorHtml, decodeBrowsePath, isPreviewableLocalPath, isTextEditableFile, normalizeLocalPath, toLocalFilePreviewHref } from './localBrowseUi.js'
import {
  NOTIFICATION_WEBSOCKET_MAX_INBOUND_BYTES,
  sendBoundedWebSocketJson,
  subscribeBoundedWebSocketNotifications,
} from './notificationWebSocketBackpressure.js'
import { WebSocketServer, type WebSocket } from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const spaEntryFile = join(distDir, 'index.html')
const localPreviewContentSecurityPolicy = "default-src 'none'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'

export type ServerOptions = {
  password?: string
  configPath?: string
  host?: string
  createBridgeMiddleware?: typeof createCodexBridgeMiddleware
  resolveLocalFilePath?: typeof resolveWorkspaceLocalPath
  resolveUploadedFilePath?: typeof resolveUploadedFilePath
  runtimeDatabasePath?: string
}

export type ServerInstance = {
  app: Express
  dispose: () => void
  attachWebSocket: (server: HttpServer) => void
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const LOCAL_FILE_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_CONTENT_TYPES,
  '.csv': 'text/csv; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.ts': 'text/typescript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
}

const LOCAL_SETUP_BODY_LIMIT_BYTES = 16 * 1024

function formatHttpUrl(host: string, port: number): string {
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${normalizedHost}:${String(port)}`
}

function getLanAccessUrls(host: string | undefined, port: number): string[] {
  const normalizedHost = host?.trim().toLowerCase() ?? ''
  if (
    !normalizedHost
    || normalizedHost === '127.0.0.1'
    || normalizedHost === 'localhost'
    || normalizedHost === '::1'
  ) {
    return []
  }
  if (normalizedHost !== '0.0.0.0' && normalizedHost !== '::') {
    return [formatHttpUrl(host!.trim(), port)]
  }

  const urls = new Set<string>()
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== 'IPv4' || address.address.startsWith('169.254.')) continue
      urls.add(formatHttpUrl(address.address, port))
    }
  }
  return [...urls]
}

const DOWNLOAD_ONLY_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf',
  '.odt', '.ods', '.odp', '.rtf',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso',
  '.exe', '.msi', '.dmg', '.apk',
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
  '.parquet', '.feather',
  '.ttf', '.otf', '.woff', '.woff2',
  '.psd', '.ai', '.sketch', '.fig',
  '.onnx', '.pt', '.pth', '.safetensors',
  '.dll', '.so', '.dylib',
])

function renderFrontendMissingHtml(message: string, details?: string[]): string {
  const lines = details && details.length > 0 ? `<pre>${details.join('\n')}</pre>` : ''
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>CX-Codex 界面错误</title></head>',
    '<body>',
    `<h1>${message}</h1>`,
    lines,
    '<p><a href="/">返回聊天页</a></p>',
    '</body>',
    '</html>',
  ].join('')
}

function normalizeLocalImagePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      try {
        return decodeURIComponent(trimmed.replace(/^file:\/\/\/?/u, ''))
      } catch {
        return trimmed.replace(/^file:\/\/\/?/u, '')
      }
    }
  }
  return trimmed
}

function readWildcardPathParam(value: unknown): string {
  const pathValue = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.join('/')
      : ''
  if (!pathValue || pathValue.startsWith('/')) return pathValue
  return `/${pathValue}`
}

function encodeContentDispositionFileName(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/gu, '_').replace(/["\\]/gu, '_') || 'download'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function shouldDownloadLocalFile(localPath: string): boolean {
  return DOWNLOAD_ONLY_EXTENSIONS.has(extname(localPath).toLowerCase())
}

function getLocalFileContentType(localPath: string): string {
  return LOCAL_FILE_CONTENT_TYPES[extname(localPath).toLowerCase()] ?? 'application/octet-stream'
}

function setLocalFileContentType(res: express.Response, localPath: string): void {
  res.setHeader('Content-Type', getLocalFileContentType(localPath))
}

function setLocalFileDisposition(
  res: express.Response,
  localPath: string,
  mode: 'inline' | 'attachment' | undefined = undefined,
): void {
  if (mode === 'inline') {
    res.setHeader('Content-Disposition', 'inline')
    return
  }
  if (mode === 'attachment' || shouldDownloadLocalFile(localPath)) {
    res.setHeader('Content-Disposition', encodeContentDispositionFileName(basename(localPath) || 'download'))
    return
  }
  res.setHeader('Content-Disposition', 'inline')
}

async function resolveAuthorizedLocalPath(
  res: express.Response,
  localPath: string,
  resolveLocalFilePath: typeof resolveWorkspaceLocalPath,
  notFoundMessage: string,
): Promise<string | null> {
  try {
    return await resolveLocalFilePath(localPath)
  } catch (error) {
    if (error instanceof LocalFileAccessError) {
      if (error.code === 'outside-workspace') {
        res.status(403).json({ error: '该路径不在已登记的工作区目录内。' })
        return null
      }
      res.status(404).json({ error: notFoundMessage })
      return null
    }
    res.status(500).json({ error: '本地文件访问校验失败。' })
    return null
  }
}

type AuthorizedLocalPath = {
  path: string
  source: 'workspace' | 'upload'
}

async function resolveAuthorizedReadableLocalPath(
  res: express.Response,
  localPath: string,
  resolveLocalFilePath: typeof resolveWorkspaceLocalPath,
  resolveUploadedLocalFilePath: typeof resolveUploadedFilePath,
  notFoundMessage: string,
): Promise<AuthorizedLocalPath | null> {
  try {
    return { path: await resolveLocalFilePath(localPath), source: 'workspace' }
  } catch (error) {
    if (!(error instanceof LocalFileAccessError)) {
      res.status(500).json({ error: '本地文件访问校验失败。' })
      return null
    }
    if (error.code === 'not-found') {
      res.status(404).json({ error: notFoundMessage })
      return null
    }
  }

  try {
    return { path: await resolveUploadedLocalFilePath(localPath), source: 'upload' }
  } catch (error) {
    if (error instanceof UploadedFileAccessError && error.code === 'not-found') {
      res.status(404).json({ error: notFoundMessage })
      return null
    }
    if (error instanceof UploadedFileAccessError) {
      res.status(403).json({ error: '该路径不在已登记的工作区目录或 CX-Codex 上传缓存内。' })
      return null
    }
    res.status(500).json({ error: '本地文件访问校验失败。' })
    return null
  }
}

export function createServer(options: ServerOptions = {}): ServerInstance {
  const app = express()
  const createBridgeMiddleware = options.createBridgeMiddleware ?? createCodexBridgeMiddleware
  const bridge = createBridgeMiddleware({
    remoteAccessProtected: Boolean(options.password),
    runtimeDatabasePath: options.runtimeDatabasePath,
  })
  const authSession = options.password ? createAuthSession(options.password) : null
  const resolveLocalFilePath = options.resolveLocalFilePath ?? resolveWorkspaceLocalPath
  const resolveUploadedLocalFilePath = options.resolveUploadedFilePath ?? resolveUploadedFilePath
  const localSetupToken = randomBytes(24).toString('hex')
  let invalidateWebSocketSessions = () => {}

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'cx-codex',
      atIso: new Date().toISOString(),
    })
  })

  app.get('/local-setup', async (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end()
      return
    }
    const tunnel = await getTunnelStatus()
    const localPort = req.socket.localPort ?? 7420
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    res.status(200).type('text/html; charset=utf-8').send(renderLocalSetupHtml({
      password: authSession?.getPassword() ?? '',
      publicUrl: tunnel.active ? tunnel.publicUrl : '',
      publicAddressType: tunnel.activeMode === 'stable'
        ? 'fixed'
        : tunnel.activeMode === 'quick'
          ? 'temporary'
          : '',
      localUrl: formatHttpUrl('127.0.0.1', localPort),
      lanUrls: getLanAccessUrls(options.host, localPort),
      managementToken: localSetupToken,
      canChangePassword: Boolean(authSession && options.configPath),
    }))
  })

  app.post('/local-setup/password', (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end()
      return
    }
    if (req.get('X-CX-Codex-Local-Setup') !== localSetupToken) {
      res.status(403).json({ error: '管理页面校验已失效，请刷新后重试。' })
      return
    }
    if (!authSession || !options.configPath) {
      res.status(409).json({ error: '当前启动方式无法保存密码，请使用配置文件启动 CX-Codex。' })
      return
    }

    void (async () => {
      try {
        const payload = await readJsonBody(req, { maxBytes: LOCAL_SETUP_BODY_LIMIT_BYTES })
        const body = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {}
        const nextPassword = body.generate === true
          ? generatePassword()
          : typeof body.password === 'string'
            ? body.password.trim()
            : ''
        if (nextPassword.length < 8 || nextPassword.length > 128) {
          res.status(400).json({ error: '新密码必须为 8–128 个字符。' })
          return
        }
        await persistAccessPassword(options.configPath!, nextPassword)
        authSession.rotatePassword(nextPassword)
        invalidateWebSocketSessions()
        res.setHeader('Cache-Control', 'no-store')
        res.status(200).json({ ok: true, password: nextPassword })
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          res.status(413).json({ error: '请求内容过大。' })
          return
        }
        const message = error instanceof Error ? error.message : '密码保存失败。'
        res.status(500).json({ error: message })
      }
    })()
  })

  // 1. Auth middleware (if password is set)
  if (authSession) {
    app.use(authSession.middleware)
  }

  // 2. Bridge middleware for /codex-api/*
  app.use(bridge)

  // 3. Serve local images referenced in markdown (desktop parity for absolute image paths)
  app.get('/codex-local-image', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
    const localPath = normalizeLocalImagePath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }

    const authorized = await resolveAuthorizedReadableLocalPath(
      res,
      localPath,
      resolveLocalFilePath,
      resolveUploadedLocalFilePath,
      '图片文件不存在。',
    )
    if (!authorized) return
    const authorizedPath = authorized.path

    const contentType = IMAGE_CONTENT_TYPES[extname(authorizedPath).toLowerCase()]
    if (!contentType) {
      res.status(415).json({ error: '不支持的图片类型。' })
      return
    }

    res.type(contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.sendFile(authorizedPath, { dotfiles: 'allow' }, (error) => {
      if (!error) return
      if (!res.headersSent) res.status(404).json({ error: '图片文件不存在。' })
    })
  })

  // 4. Serve local files for direct file open/download.
  app.get('/codex-local-file', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
    const localPath = normalizeLocalPath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }

    const authorized = await resolveAuthorizedReadableLocalPath(
      res,
      localPath,
      resolveLocalFilePath,
      resolveUploadedLocalFilePath,
      '文件不存在。',
    )
    if (!authorized) return
    const authorizedPath = authorized.path

    res.setHeader('Cache-Control', 'private, no-store')
    const dispositionMode = req.query.inline === '1'
      ? 'inline'
      : req.query.download === '1'
        ? 'attachment'
        : undefined
    setLocalFileContentType(res, authorizedPath)
    setLocalFileDisposition(res, authorizedPath, dispositionMode)
    res.sendFile(authorizedPath, { dotfiles: 'allow' }, (error) => {
      if (!error) return
      if (!res.headersSent) res.status(404).json({ error: '文件不存在。' })
    })
  })

  // 5. Serve local files by path to preserve relative asset loading for HTML.
  app.get('/codex-local-browse/*path', async (req, res) => {
    const rawPath = readWildcardPathParam(req.params.path)
    const localPath = decodeBrowsePath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }

    const authorized = await resolveAuthorizedReadableLocalPath(
      res,
      localPath,
      resolveLocalFilePath,
      resolveUploadedLocalFilePath,
      '文件不存在。',
    )
    if (!authorized) return
    const authorizedPath = authorized.path

    try {
      const fileStat = await stat(authorizedPath)
      res.setHeader('Cache-Control', 'private, no-store')
      if (fileStat.isDirectory()) {
        if (authorized.source === 'upload') {
          res.status(403).json({ error: '上传缓存只支持打开已上传文件。' })
          return
        }
        const html = await createDirectoryListingHtml(authorizedPath)
        res.status(200).type('text/html; charset=utf-8').send(html)
        return
      }

      if (isPreviewableLocalPath(authorizedPath)) {
        res.redirect(302, toLocalFilePreviewHref(authorizedPath))
        return
      }

      if (shouldDownloadLocalFile(authorizedPath)) {
        const html = createLocalFileActionHtml(authorizedPath, {
          sizeBytes: fileStat.size,
          contentType: getLocalFileContentType(authorizedPath),
        })
        res.status(200).type('text/html; charset=utf-8').send(html)
        return
      }

      setLocalFileContentType(res, authorizedPath)
      setLocalFileDisposition(res, authorizedPath)
      res.sendFile(authorizedPath, { dotfiles: 'allow' }, (error) => {
        if (!error) return
        if (!res.headersSent) res.status(404).json({ error: '文件不存在。' })
      })
    } catch {
      res.status(404).json({ error: '文件不存在。' })
    }
  })

  // 6. Edit text-like local files.
  app.get('/codex-local-edit/*path', async (req, res) => {
    const rawPath = readWildcardPathParam(req.params.path)
    const localPath = decodeBrowsePath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }
    const authorizedPath = await resolveAuthorizedLocalPath(
      res,
      localPath,
      resolveLocalFilePath,
      '文件不存在。',
    )
    if (!authorizedPath) return
    try {
      const fileStat = await stat(authorizedPath)
      if (!fileStat.isFile()) {
        res.status(400).json({ error: '需要提供文件路径。' })
        return
      }
      const html = await createTextEditorHtml(authorizedPath)
      res.status(200).type('text/html; charset=utf-8').send(html)
    } catch {
      res.status(404).json({ error: '文件不存在。' })
    }
  })

  app.put('/codex-local-edit/*path', express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
    const rawPath = readWildcardPathParam(req.params.path)
    const localPath = decodeBrowsePath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }
    const authorizedPath = await resolveAuthorizedLocalPath(
      res,
      localPath,
      resolveLocalFilePath,
      '文件不存在。',
    )
    if (!authorizedPath) return
    if (!(await isTextEditableFile(authorizedPath))) {
      res.status(415).json({ error: '仅支持编辑文本类文件。' })
      return
    }
    const body = typeof req.body === 'string' ? req.body : ''
    try {
      await writeFile(authorizedPath, body, 'utf8')
      res.status(200).json({ ok: true })
    } catch {
      res.status(404).json({ error: '文件不存在。' })
    }
  })

  const hasFrontendAssets = existsSync(spaEntryFile)

  // 7. Static files from Vue build
  if (hasFrontendAssets) {
    app.use('/assets', (req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.headers.range) {
        next()
        return
      }
      if (!String(req.headers['accept-encoding'] ?? '').toLowerCase().includes('br')) {
        next()
        return
      }
      const assetName = req.path.replace(/^\/+/u, '')
      if (!assetName || assetName !== basename(assetName)) {
        next()
        return
      }
      const sourcePath = join(distDir, 'assets', assetName)
      const compressedPath = `${sourcePath}.br`
      if (!existsSync(sourcePath) || !existsSync(compressedPath)) {
        next()
        return
      }
      res.type(sourcePath)
      res.setHeader('Content-Encoding', 'br')
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.vary('Accept-Encoding')
      res.sendFile(compressedPath, (error) => {
        if (!error || res.headersSent) return
        next(error)
      })
    })
    app.use(express.static(distDir, {
      setHeaders: (res, filePath) => {
        const normalizedPath = filePath.replace(/\\/g, '/')
        if (normalizedPath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          return
        }
        if (basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache')
          return
        }
        if (basename(filePath) === 'local-preview.html') {
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Content-Security-Policy', localPreviewContentSecurityPolicy)
        }
      },
    }))
  }

  // 8. SPA fallback
  app.use((_req, res) => {
    if (!hasFrontendAssets) {
      res
        .status(503)
        .type('text/html; charset=utf-8')
        .send(
          renderFrontendMissingHtml('CX-Codex 前端资源缺失。', [
            `期望文件：${spaEntryFile}`,
            '如果是源码运行，请先执行：npm run build:frontend',
            '如果使用发布包，请重新解压完整产物；不要单独复制 CLI。',
          ]),
        )
      return
    }

    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(spaEntryFile, (error) => {
      if (!error) return
      if (!res.headersSent) {
        res.status(404).type('text/html; charset=utf-8').send(renderFrontendMissingHtml('前端入口文件不存在。'))
      }
    })
  })

  return {
    app,
    dispose: () => bridge.dispose(),
    attachWebSocket: (server: HttpServer) => {
      const wss = new WebSocketServer({
        noServer: true,
        maxPayload: NOTIFICATION_WEBSOCKET_MAX_INBOUND_BYTES,
      })
      invalidateWebSocketSessions = () => {
        for (const ws of wss.clients) {
          ws.terminate()
        }
      }
      const heartbeatState = new WeakMap<WebSocket, boolean>()
      const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (heartbeatState.get(ws) === false) {
            ws.terminate()
            continue
          }

          heartbeatState.set(ws, false)
          if (ws.readyState === 1) {
            try {
              ws.ping()
              sendBoundedWebSocketJson(ws, {
                method: BRIDGE_HEARTBEAT_METHOD,
                params: { ok: true },
                atIso: new Date().toISOString(),
              })
            } catch {
              ws.terminate()
            }
          }
        }
      }, 15000)

      server.on('upgrade', (req: IncomingMessage, socket, head) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        if (url.pathname !== '/codex-api/ws') {
          return
        }

        if (authSession && !authSession.isRequestAuthorized(req)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
          socket.destroy()
          return
        }

        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          wss.emit('connection', ws, req)
        })
      })

      wss.on('connection', (ws: WebSocket) => {
        heartbeatState.set(ws, true)
        let unsubscribe = () => {}

        ws.on('pong', () => {
          heartbeatState.set(ws, true)
        })
        ws.on('close', () => {
          heartbeatState.delete(ws)
          unsubscribe()
        })
        ws.on('error', () => {
          heartbeatState.delete(ws)
          unsubscribe()
        })
        const replayStatus = bridge.listNotificationEventsAfter(Number.MAX_SAFE_INTEGER, 1)
        if (!sendBoundedWebSocketJson(ws, {
          method: 'ready',
          params: {
            ok: true,
            latestSeq: replayStatus.latestSeq,
            ...(replayStatus.streamId ? { streamId: replayStatus.streamId } : {}),
          },
          atIso: new Date().toISOString(),
        })) return
        unsubscribe = subscribeBoundedWebSocketNotifications(ws, bridge.subscribeNotifications)
      })

      server.on('close', () => {
        clearInterval(heartbeat)
        invalidateWebSocketSessions()
        invalidateWebSocketSessions = () => {}
        wss.close()
      })
    },
  }
}
