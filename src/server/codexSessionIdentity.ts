import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const CODEX_SESSION_ROOTS = ['sessions', 'archived_sessions'] as const
export const MAX_SESSION_METADATA_BYTES = 256 * 1024
const METADATA_READ_CHUNK_BYTES = 64 * 1024
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function normalizeCodexThreadId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toLowerCase()
  return THREAD_ID_PATTERN.test(normalized) ? normalized : ''
}

export function normalizeCodexSessionRelativePath(value: string): string {
  const path = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (!path || isAbsolute(path) || path.includes(':') || path.includes('\0')) return ''
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment.endsWith('.') || segment.endsWith(' '))) return ''
  if (!CODEX_SESSION_ROOTS.some((root) => root === segments[0]?.toLowerCase())) return ''
  return path
}

export function isCodexSessionLogRelativePath(value: string): boolean {
  const path = normalizeCodexSessionRelativePath(value)
  return path.includes('/') && path.toLowerCase().endsWith('.jsonl')
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path.length > 0 && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path)
}

function isUnavailablePath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code))
}

export type CheckedCodexSessionPath = { path: string; stats: Stats }

// Check every component before opening: a valid relative filename must not
// turn a junction, directory symlink, or file symlink into an outside read.
export async function inspectCodexSessionPath(
  relativePath: string,
  codexHomeDir: string,
  kind: 'file' | 'directory',
): Promise<CheckedCodexSessionPath | null> {
  const normalized = normalizeCodexSessionRelativePath(relativePath)
  if (!normalized) return null
  const home = resolve(codexHomeDir)
  const path = resolve(home, normalized)
  if (!isInside(home, path)) return null
  try {
    const segments = normalized.split('/')
    let current = home
    let stats = await lstat(current)
    if (stats.isSymbolicLink() || !stats.isDirectory()) return null
    for (let index = 0; index < segments.length; index += 1) {
      current = resolve(current, segments[index]!)
      stats = await lstat(current)
      if (stats.isSymbolicLink()) return null
      if (index < segments.length - 1 && !stats.isDirectory()) return null
    }
    if (kind === 'file' ? !stats.isFile() : !stats.isDirectory()) return null
    const [actualHome, actualPath] = await Promise.all([realpath(home), realpath(path)])
    return isInside(actualHome, actualPath) ? { path, stats } : null
  } catch (error) {
    if (isUnavailablePath(error)) return null
    throw error
  }
}

function readMetadataThreadId(line: string): string {
  try {
    const entry = JSON.parse(line.replace(/^\uFEFF/u, '')) as unknown
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
    const record = entry as Record<string, unknown>
    if (record.type !== 'session_meta') return ''
    if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) return ''
    const payload = record.payload as Record<string, unknown>
    const threadId = normalizeCodexThreadId(payload.id)
    if (!threadId) return ''
    // These aliases describe the same identity in supported metadata. Do not
    // guess a different meaning when a producer supplies conflicting IDs.
    for (const alias of ['thread_id', 'threadId', 'session_id', 'sessionId']) {
      if (alias in payload && normalizeCodexThreadId(payload[alias]) !== threadId) return ''
    }
    return threadId
  } catch {
    return ''
  }
}

export type CodexSessionLogIdentity = {
  threadId: string
  path: string
  modifiedAtMs: number
}

export async function readCodexSessionLogIdentity(
  relativePath: string,
  codexHomeDir: string,
): Promise<CodexSessionLogIdentity | null> {
  if (!isCodexSessionLogRelativePath(relativePath)) return null
  const checked = await inspectCodexSessionPath(relativePath, codexHomeDir, 'file')
  if (!checked) return null
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(checked.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== checked.stats.dev || opened.ino !== checked.stats.ino) return null
    const chunks: Buffer[] = []
    let offset = 0
    while (offset < MAX_SESSION_METADATA_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(METADATA_READ_CHUNK_BYTES, MAX_SESSION_METADATA_BYTES - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      if (bytesRead === 0) return null
      const content = buffer.subarray(0, bytesRead)
      const newline = content.indexOf(0x0a)
      chunks.push(newline < 0 ? content : content.subarray(0, newline))
      if (newline >= 0) {
        const line = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
        const threadId = readMetadataThreadId(line)
        return threadId ? { threadId, path: checked.path, modifiedAtMs: opened.mtimeMs } : null
      }
      offset += bytesRead
    }
    // A partial/oversized first line is not identity evidence. A subsequent
    // append will be retried; never read the rest of a large conversation.
    return null
  } catch (error) {
    if (isUnavailablePath(error) || error instanceof TypeError) return null
    throw error
  } finally {
    await handle?.close()
  }
}
