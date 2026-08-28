import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

const port = Number.parseInt(readArg('--port', '17436'), 10)
const root = path.resolve(readArg('--root', 'dist'))
const apiUpstream = new URL(readArg('--api-upstream', 'http://127.0.0.1:17435'))
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${String(port)}`)
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`Frontend index not found under ${root}`)

const mimeByExtension = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

function proxyApi(request, response, upstreamPath = request.url) {
  const upstreamRequest = http.request({
    protocol: apiUpstream.protocol,
    hostname: apiUpstream.hostname,
    port: apiUpstream.port,
    method: request.method,
    path: upstreamPath,
    headers: { ...request.headers, host: apiUpstream.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstreamRequest.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: `candidate api proxy failed: ${error.message}` }))
  })
  request.pipe(upstreamRequest)
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (requestUrl.pathname === '/health') {
    proxyApi(request, response, '/codex-api/health')
    return
  }
  if (
    requestUrl.pathname.startsWith('/codex-api/')
    || requestUrl.pathname.startsWith('/codex-local-')
  ) {
    proxyApi(request, response)
    return
  }

  let relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
  if (!relativePath || !path.extname(relativePath)) relativePath = 'index.html'
  const filePath = path.resolve(root, relativePath)
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404)
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'content-type': mimeByExtension.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Quiet Workbench static candidate: http://127.0.0.1:${String(port)} -> ${root}\n`)
})
