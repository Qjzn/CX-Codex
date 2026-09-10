// Static candidate verification only. No bridge, Codex process, or user-state writes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.argv[2] ?? 17423)
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535)
let imageAttempts = 0
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') { res.writeHead(405).end(); return }
  if (url.pathname === '/codex-api/favorites') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[]}'); return
  }
  if (url.pathname.startsWith('/codex-api/')) { res.writeHead(503).end('No bridge in this fixture'); return }
  if (url.pathname === '/codex-local-image') {
    if (url.searchParams.get('path') !== 'C:/fixture/test-image.png') { res.writeHead(403).end(); return }
    imageAttempts += 1
    // A deterministic first failure exercises the real component retry path.
    if (imageAttempts === 1) { res.writeHead(503).end('Fixture image unavailable'); return }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="150"><rect width="360" height="150" fill="#f3f3f2"/><text x="24" y="62" font-size="22" fill="#1f1f1f">CX-Codex</text><text x="24" y="102" font-size="16" fill="#0f766e">Attachment preview OK</text></svg>'); return
  }
  if (url.pathname === '/__fixture/image-attempts') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ imageAttempts })); return
  }
  try {
    const requested = decodeURIComponent(url.pathname)
    const target = path.resolve(root, requested === '/' ? 'index.html' : `.${requested}`)
    const relative = path.relative(root, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403).end(); return }
    if (!(await stat(target)).isFile()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream' })
    createReadStream(target).pipe(res)
  } catch { res.writeHead(404).end() }
})
server.listen(port, '127.0.0.1', () => console.log(`REPLY_QUALITY_FIXTURE http://127.0.0.1:${port}`))
