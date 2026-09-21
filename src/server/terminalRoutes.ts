import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { setJson } from './httpJsonResponse.js'
import {
  LocalFileAccessError,
  resolveWorkspaceLocalPath,
} from './localFileAccessPolicy.js'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 300_000
const MAX_COMMAND_LENGTH = 20_000

type TerminalRouteDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  rpc: (method: string, params: unknown) => Promise<unknown>
  platform?: NodeJS.Platform
  resolveWorkspaceLocalPath?: (candidatePath: string) => Promise<string>
  stat?: typeof stat
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.trunc(value)))
}

function createShellCommand(command: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
  }
  return ['/bin/sh', '-lc', command]
}

function readCommandResult(value: unknown): { exitCode: number; stdout: string; stderr: string } {
  const record = asRecord(value)
  const exitCode = typeof record?.exitCode === 'number' && Number.isFinite(record.exitCode)
    ? Math.trunc(record.exitCode)
    : -1
  return {
    exitCode,
    stdout: typeof record?.stdout === 'string' ? record.stdout : '',
    stderr: typeof record?.stderr === 'string' ? record.stderr : '',
  }
}

export async function handleTerminalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: TerminalRouteDependencies,
): Promise<boolean> {
  if (req.method !== 'POST' || url.pathname !== '/codex-api/terminal/exec') return false

  const payload = asRecord(await dependencies.readJsonBody(req))
  const command = readNonEmptyString(payload?.command)
  if (!command) {
    setJson(res, 400, { error: 'Invalid body: command must be a non-empty string' })
    return true
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    setJson(res, 400, { error: `Command is too long; maximum length is ${MAX_COMMAND_LENGTH} characters` })
    return true
  }

  const cwd = readNonEmptyString(payload?.cwd)
  if (cwd && !isAbsolute(cwd)) {
    setJson(res, 400, { error: 'cwd must be an absolute path' })
    return true
  }

  if (!cwd) {
    setJson(res, 400, { error: 'Please select or enter a registered workspace directory' })
    return true
  }

  let executionCwd: string
  try {
    const resolveWorkspacePath = dependencies.resolveWorkspaceLocalPath ?? resolveWorkspaceLocalPath
    executionCwd = await resolveWorkspacePath(cwd)
    const readStat = dependencies.stat ?? stat
    if (!(await readStat(executionCwd)).isDirectory()) {
      setJson(res, 400, { error: 'cwd must be a workspace directory' })
      return true
    }
  } catch (error) {
    if (error instanceof LocalFileAccessError && error.code === 'not-found') {
      setJson(res, 404, { error: 'Workspace directory does not exist' })
      return true
    }
    if (error instanceof LocalFileAccessError) {
      setJson(res, 403, { error: 'cwd must be inside a registered workspace' })
      return true
    }
    throw error
  }

  const platform = dependencies.platform ?? process.platform
  const timeoutMs = normalizeTimeout(payload?.timeoutMs)
  const result = readCommandResult(await dependencies.rpc('command/exec', {
    command: createShellCommand(command, platform),
    cwd: executionCwd,
    timeoutMs,
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [executionCwd],
      networkAccess: false,
      readOnlyAccess: {
        type: 'restricted',
        includePlatformDefaults: true,
        readableRoots: [executionCwd],
      },
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  }))

  setJson(res, 200, {
    data: {
      ...result,
      command,
      cwd: executionCwd,
      platform,
      shell: platform === 'win32' ? 'PowerShell' : '/bin/sh',
      timeoutMs,
    },
  })
  return true
}
