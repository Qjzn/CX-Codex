import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { startQuickTunnel, stopQuickTunnel } from '../src/server/quickTunnel.js'

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end('{"status":"ok"}')
    return
  }
  response.statusCode = 401
  response.end()
})

server.on('upgrade', (_request, socket) => {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
  socket.destroy()
})

try {
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve smoke server port'))
        return
      }
      resolve(address.port)
    })
  })
  const started = await startQuickTunnel({ localPort: port })
  assert.equal(started.active, true)
  assert.equal(started.phase, 'ready')
  assert.equal(started.publicUrl.startsWith('https://'), true)
  assert.deepEqual(started.verification, {
    health: true,
    auth: true,
    websocketAuth: true,
  })
  const stopped = await stopQuickTunnel()
  assert.equal(stopped.active, false)
  assert.equal(stopped.phase, 'idle')
  console.log(JSON.stringify({
    active: started.active,
    phase: started.phase,
    publicUrlReturned: Boolean(started.publicUrl),
    networkMode: started.networkMode,
    verification: started.verification,
    stopped: !stopped.active,
  }))
} finally {
  await stopQuickTunnel()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}
