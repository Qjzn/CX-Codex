import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { existsSync } from 'node:fs'
import { writeFile, stat } from 'node:fs/promises'
import express, { type Express } from 'express'
import { createCodexBridgeMiddleware } from './codexAppServerBridge.js'
import { createAuthSession } from './authMiddleware.js'
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
const BRIDGE_HEARTBEAT_METHOD = 'bridge/heartbeat'

export type ServerOptions = {
  password?: string
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
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join('/')
  return ''
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

export function createServer(options: ServerOptions = {}): ServerInstance {
  const app = express()
  const bridge = createCodexBridgeMiddleware()
  const authSession = options.password ? createAuthSession(options.password) : null

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'cx-codex',
      atIso: new Date().toISOString(),
    })
  })

  // 1. Auth middleware (if password is set)
  if (authSession) {
    app.use(authSession.middleware)
  }

  // 2. Bridge middleware for /codex-api/*
  app.use(bridge)

  // 3. Serve local images referenced in markdown (desktop parity for absolute image paths)
  app.get('/codex-local-image', (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
    const localPath = normalizeLocalImagePath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }

    const contentType = IMAGE_CONTENT_TYPES[extname(localPath).toLowerCase()]
    if (!contentType) {
      res.status(415).json({ error: '不支持的图片类型。' })
      return
    }

    res.type(contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.sendFile(localPath, { dotfiles: 'allow' }, (error) => {
      if (!error) return
      if (!res.headersSent) res.status(404).json({ error: '图片文件不存在。' })
    })
  })

  // 4. Serve local files for direct file open/download.
  app.get('/codex-local-file', (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
    const localPath = normalizeLocalPath(rawPath)
    if (!localPath || !isAbsolute(localPath)) {
      res.status(400).json({ error: '需要提供绝对本地文件路径。' })
      return
    }

    res.setHeader('Cache-Control', 'private, no-store')
    const dispositionMode = req.query.inline === '1'
      ? 'inline'
      : req.query.download === '1'
        ? 'attachment'
        : undefined
    setLocalFileContentType(res, localPath)
    setLocalFileDisposition(res, localPath, dispositionMode)
    res.sendFile(localPath, { dotfiles: 'allow' }, (error) => {
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

    try {
      const fileStat = await stat(localPath)
      res.setHeader('Cache-Control', 'private, no-store')
      if (fileStat.isDirectory()) {
        const html = await createDirectoryListingHtml(localPath)
        res.status(200).type('text/html; charset=utf-8').send(html)
        return
      }

      if (isPreviewableLocalPath(localPath)) {
        res.redirect(302, toLocalFilePreviewHref(localPath))
        return
      }

      if (shouldDownloadLocalFile(localPath)) {
        const html = createLocalFileActionHtml(localPath, {
          sizeBytes: fileStat.size,
          contentType: getLocalFileContentType(localPath),
        })
        res.status(200).type('text/html; charset=utf-8').send(html)
        return
      }

      setLocalFileContentType(res, localPath)
      setLocalFileDisposition(res, localPath)
      res.sendFile(localPath, { dotfiles: 'allow' }, (error) => {
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
    try {
      const fileStat = await stat(localPath)
      if (!fileStat.isFile()) {
        res.status(400).json({ error: '需要提供文件路径。' })
        return
      }
      const html = await createTextEditorHtml(localPath)
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
    if (!(await isTextEditableFile(localPath))) {
      res.status(415).json({ error: '仅支持编辑文本类文件。' })
      return
    }
    const body = typeof req.body === 'string' ? req.body : ''
    try {
      await writeFile(localPath, body, 'utf8')
      res.status(200).json({ ok: true })
    } catch {
      res.status(404).json({ error: '文件不存在。' })
    }
  })

  const hasFrontendAssets = existsSync(spaEntryFile)

  // 7. Static files from Vue build
  if (hasFrontendAssets) {
    app.use(express.static(distDir))
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
        if (!sendBoundedWebSocketJson(ws, {
          method: 'ready',
          params: { ok: true },
          atIso: new Date().toISOString(),
        })) return
        unsubscribe = subscribeBoundedWebSocketNotifications(ws, bridge.subscribeNotifications)
      })

      server.on('close', () => {
        clearInterval(heartbeat)
        for (const ws of wss.clients) {
          ws.terminate()
        }
        wss.close()
      })
    },
  }
}
