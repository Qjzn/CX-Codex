import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Socket } from 'node:net'
import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import * as pty from 'node-pty'
import { WebSocketServer, type WebSocket } from 'ws'

import {
  LocalFileAccessError,
  resolveWorkspaceLocalPath,
} from './localFileAccessPolicy.js'

export const TERMINAL_PTY_WEBSOCKET_PATH = '/codex-api/terminal/ws'

const MAX_TERMINAL_PTY_INPUT_BYTES = 64 * 1024
const MAX_TERMINAL_PTY_COLUMNS = 240
const MAX_TERMINAL_PTY_ROWS = 100
const DEFAULT_TERMINAL_PTY_COLUMNS = 120
const DEFAULT_TERMINAL_PTY_ROWS = 32

type TerminalPtyMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'signal'; signal: 'SIGINT' | 'SIGTERM' | 'EOF' }

type TerminalPtyWebSocketOptions = {
  isRequestAuthorized?: (req: IncomingMessage) => boolean
}

type TerminalPtySession = {
  terminal: pty.IPty
  socket: WebSocket
  closed: boolean
}

function sendJson(socket: WebSocket, payload: unknown): boolean {
  if (socket.readyState !== socket.OPEN) return false
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function readPositiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(maximum, Math.trunc(parsed)))
}

function terminalShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const commandShell = process.env.ComSpec?.trim() || 'cmd.exe'
    return {
      file: commandShell,
      args: basename(commandShell).toLowerCase().startsWith('powershell')
        ? ['-NoLogo', '-NoProfile']
        : ['/Q'],
    }
  }

  const shell = process.env.SHELL?.trim() || '/bin/bash'
  return { file: shell, args: ['-i'] }
}

function parseMessage(value: unknown): TerminalPtyMessage | null {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_TERMINAL_PTY_INPUT_BYTES) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.type === 'input' && typeof record.data === 'string') {
      return { type: 'input', data: record.data }
    }
    if (record.type === 'resize') {
      const cols = Number(record.cols)
      const rows = Number(record.rows)
      if (Number.isFinite(cols) && Number.isFinite(rows)) {
        return {
          type: 'resize',
          cols: Math.max(1, Math.min(MAX_TERMINAL_PTY_COLUMNS, Math.trunc(cols))),
          rows: Math.max(1, Math.min(MAX_TERMINAL_PTY_ROWS, Math.trunc(rows))),
        }
      }
    }
    if (
      record.type === 'signal'
      && (record.signal === 'SIGINT' || record.signal === 'SIGTERM' || record.signal === 'EOF')
    ) {
      return { type: 'signal', signal: record.signal }
    }
  } catch {
    return null
  }
  return null
}

async function resolveTerminalCwd(candidate: string): Promise<string> {
  const cwd = candidate.trim()
  if (!cwd || !isAbsolute(cwd)) {
    throw new Error('Please select or enter a registered workspace directory')
  }

  let resolved: string
  try {
    resolved = await resolveWorkspaceLocalPath(cwd)
  } catch (error) {
    if (error instanceof LocalFileAccessError && error.code === 'not-found') {
      throw new Error('Workspace directory does not exist')
    }
    if (error instanceof LocalFileAccessError) {
      throw new Error('cwd must be inside a registered workspace')
    }
    throw error
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new Error('cwd must be a workspace directory')
  }
  return resolved
}

async function attachTerminalPty(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const requestUrl = new URL(request.url ?? '', 'http://localhost')
  try {
    const cwd = await resolveTerminalCwd(requestUrl.searchParams.get('cwd') ?? '')
    const dimensions = {
      cols: readPositiveInteger(requestUrl.searchParams.get('cols'), DEFAULT_TERMINAL_PTY_COLUMNS, MAX_TERMINAL_PTY_COLUMNS),
      rows: readPositiveInteger(requestUrl.searchParams.get('rows'), DEFAULT_TERMINAL_PTY_ROWS, MAX_TERMINAL_PTY_ROWS),
    }
    const shell = terminalShell()
    const environment = {
      ...process.env,
      TERM: process.platform === 'win32' ? process.env.TERM : 'xterm-256color',
      COLORTERM: 'truecolor',
    }
    const terminal = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: dimensions.cols,
      rows: dimensions.rows,
      cwd,
      env: environment,
      useConpty: process.platform === 'win32',
    })
    const session: TerminalPtySession = { terminal, socket, closed: false }
    let closeSocket: () => void = () => {}

    const closeTerminal = (): void => {
      if (session.closed) return
      session.closed = true
      try {
        terminal.kill()
      } catch {
        // The process may have already exited.
      }
    }
    closeSocket = () => {
      closeTerminal()
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close()
    }

    terminal.onData((data) => {
      if (!session.closed && !sendJson(socket, { type: 'output', data })) closeTerminal()
    })
    terminal.onExit(({ exitCode, signal }) => {
      if (session.closed) return
      session.closed = true
      sendJson(socket, { type: 'exit', exitCode, signal })
      if (socket.readyState === socket.OPEN) socket.close()
    })

    socket.on('message', (raw) => {
      const message = parseMessage(raw.toString())
      if (!message) {
        sendJson(socket, { type: 'error', message: 'Invalid terminal message' })
        return
      }
      try {
        if (message.type === 'input') terminal.write(message.data)
        else if (message.type === 'resize') terminal.resize(message.cols, message.rows)
        else if (message.signal === 'SIGINT') terminal.write('\u0003')
        else if (message.signal === 'EOF') terminal.write('\u0004')
        else closeSocket()
      } catch (error) {
        sendJson(socket, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Terminal input failed',
        })
      }
    })
    socket.once('close', closeTerminal)
    socket.once('error', closeTerminal)
    sendJson(socket, {
      type: 'ready',
      cwd,
      shell: shell.file,
      platform: process.platform,
      cols: dimensions.cols,
      rows: dimensions.rows,
    })
  } catch (error) {
    sendJson(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unable to start terminal',
    })
    socket.close(1011, 'Unable to start terminal')
  }
}

export function attachTerminalPtyWebSocket(
  server: HttpServer,
  options: TerminalPtyWebSocketOptions = {},
): () => void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_TERMINAL_PTY_INPUT_BYTES,
  })
  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const url = new URL(request.url ?? '', 'http://localhost')
    if (url.pathname !== TERMINAL_PTY_WEBSOCKET_PATH) return
    if (options.isRequestAuthorized && !options.isRequestAuthorized(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request)
    })
  }
  server.on('upgrade', onUpgrade)
  wss.on('connection', (socket, request) => {
    void attachTerminalPty(socket, request)
  })
  return () => {
    server.off('upgrade', onUpgrade)
    for (const socket of wss.clients) socket.terminate()
    wss.close()
  }
}
