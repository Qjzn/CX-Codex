import { randomBytes } from 'node:crypto'
import http from 'node:http'
import WebSocket from 'ws'

const port = Number.parseInt(process.argv[2] ?? '', 10)
const currentPassword = process.env.CX_CODEX_ROTATION_TEST_PASSWORD ?? ''
if (!Number.isInteger(port) || port < 1 || port > 65535 || !currentPassword) {
  throw new Error('Usage: set CX_CODEX_ROTATION_TEST_PASSWORD and pass the server port.')
}

function request(method, path, host, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        Host: host,
        ...headers,
      },
    }, (res) => {
      let responseBody = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        responseBody += chunk
      })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: responseBody,
        })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function jsonRequest(method, path, host, payload, headers = {}) {
  const body = JSON.stringify(payload)
  return request(method, path, host, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  }, body)
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

const remoteHost = 'remote-rotation-check.invalid'
const nextPassword = `rotated-${randomBytes(16).toString('hex')}`
const login = await jsonRequest('POST', '/auth/login', remoteHost, { password: currentPassword })
if (login.status !== 200) {
  throw new Error(`Initial login failed with HTTP ${login.status}.`)
}
const cookie = (login.headers['set-cookie'] ?? [])[0]?.split(';')[0] ?? ''
if (!cookie) {
  throw new Error('Initial login did not return a session cookie.')
}

const ws = new WebSocket(`ws://127.0.0.1:${port}/codex-api/ws`, {
  headers: {
    Host: remoteHost,
    Cookie: cookie,
  },
})
await withTimeout(
  new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  }),
  5000,
  'Authenticated WebSocket did not open.',
)
const socketClosed = new Promise((resolve) => {
  ws.once('close', resolve)
})

const setup = await request('GET', '/local-setup', `127.0.0.1:${port}`)
const managementToken = setup.body.match(/const managementToken="([a-f0-9]+)"/u)?.[1] ?? ''
if (setup.status !== 200 || !managementToken) {
  ws.terminate()
  throw new Error('Local management token was not available.')
}

const rotate = await jsonRequest(
  'POST',
  '/local-setup/password',
  `127.0.0.1:${port}`,
  { password: nextPassword },
  { 'X-CX-Codex-Local-Setup': managementToken },
)
if (rotate.status !== 200) {
  ws.terminate()
  throw new Error(`Password rotation failed with HTTP ${rotate.status}.`)
}
await withTimeout(socketClosed, 3000, 'Existing WebSocket remained connected after password rotation.')

const oldSession = await request('GET', '/codex-api/health', remoteHost, { Cookie: cookie })
const oldLogin = await jsonRequest('POST', '/auth/login', remoteHost, { password: currentPassword })
const newLogin = await jsonRequest('POST', '/auth/login', remoteHost, { password: nextPassword })
if (oldSession.status !== 401 || oldLogin.status !== 401 || newLogin.status !== 200) {
  throw new Error(
    `Rotation auth checks failed: oldSession=${oldSession.status}, oldLogin=${oldLogin.status}, newLogin=${newLogin.status}.`,
  )
}

process.stdout.write(JSON.stringify({
  rotated: true,
  previousWebSocketClosed: true,
  previousSessionStatus: oldSession.status,
  previousPasswordStatus: oldLogin.status,
  newPasswordStatus: newLogin.status,
}))
