import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type AppServerClientInfo = {
  name: string
  title: string
  version: string
}

const APP_SERVER_CLIENT_NAME = 'codex-web-local'
const APP_SERVER_CLIENT_TITLE = 'CX-Codex'
const UNKNOWN_VERSION = 'unknown'
const moduleDir = dirname(fileURLToPath(import.meta.url))

export function createAppServerClientInfo(version = UNKNOWN_VERSION): AppServerClientInfo {
  return {
    name: APP_SERVER_CLIENT_NAME,
    title: APP_SERVER_CLIENT_TITLE,
    version: normalizePackageVersion(version),
  }
}

export async function readPackageVersion(packageJsonPath?: string): Promise<string> {
  const candidatePaths = packageJsonPath
    ? [packageJsonPath]
    : [
        join(moduleDir, '..', 'package.json'),
        join(moduleDir, '..', '..', 'package.json'),
        join(process.cwd(), 'package.json'),
      ]

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readFile(candidatePath, 'utf8')
      const parsed = JSON.parse(raw) as { version?: unknown }
      const version = normalizePackageVersion(parsed.version)
      if (version !== UNKNOWN_VERSION) {
        return version
      }
    } catch {}
  }

  return UNKNOWN_VERSION
}

export function normalizePackageVersion(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_VERSION
  const trimmed = value.trim()
  return trimmed || UNKNOWN_VERSION
}
