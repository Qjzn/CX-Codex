import { copyFile, mkdir, readdir, realpath, rename, rm, stat, unlink } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  getFileUploadDir,
  getFileUploadRequestBodyLimitBytes,
} from './fileUpload.js'

const SESSION_ATTACHMENT_CACHE_DIRECTORY = 'session-attachments'
const MAX_REGISTERED_SESSION_ATTACHMENTS = 1_024
const MAX_CACHED_SESSION_ATTACHMENTS = 1_024
const MAX_SESSION_ATTACHMENT_PREFETCH_CONCURRENCY = 4
const MAX_THREAD_READ_SCAN_NODES = 20_000
const CODEX_CLIPBOARD_IMAGE_PATTERN = /^codex-clipboard-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu
const SESSION_ATTACHMENT_CACHE_KEY_PATTERN = /^[0-9a-f]{64}$/u

export type SessionAttachmentAccessErrorCode =
  | 'not-registered'
  | 'not-found'
  | 'too-large'

export class SessionAttachmentAccessError extends Error {
  constructor(readonly code: SessionAttachmentAccessErrorCode) {
    super(
      code === 'not-found'
        ? 'Registered session attachment does not exist.'
        : code === 'too-large'
          ? 'Registered session attachment exceeds the configured upload limit.'
          : 'Local path is not a registered Codex session attachment.',
    )
    this.name = 'SessionAttachmentAccessError'
  }
}

export type SessionAttachmentAccessDependencies = {
  tempDir?: string
  uploadDir?: string
  realpath?: typeof realpath
  stat?: typeof stat
  mkdir?: typeof mkdir
  copyFile?: typeof copyFile
  maxBytes?: number
  maxCacheEntries?: number
  maxPrefetchConcurrency?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..\\`)
    && !relativePath.startsWith('../')
    && !isAbsolute(relativePath)
  )
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function readErrorCode(error: unknown): string {
  const record = asRecord(error)
  return typeof record?.code === 'string' ? record.code : ''
}

export class SessionAttachmentAccessStore {
  private readonly registeredPaths = new Map<string, string>()
  private readonly tempRoot: string
  private readonly uploadRoot: string
  private readonly resolveRealPath: typeof realpath
  private readonly readStat: typeof stat
  private readonly makeDirectory: typeof mkdir
  private readonly copyLocalFile: typeof copyFile
  private readonly maxBytes: number
  private readonly maxCacheEntries: number
  private readonly maxPrefetchConcurrency: number
  private activePrefetchCount = 0
  private readonly pendingPrefetchStarts: Array<() => void> = []

  constructor(dependencies: SessionAttachmentAccessDependencies = {}) {
    this.tempRoot = resolve(dependencies.tempDir ?? tmpdir())
    this.uploadRoot = resolve(dependencies.uploadDir ?? getFileUploadDir())
    this.resolveRealPath = dependencies.realpath ?? realpath
    this.readStat = dependencies.stat ?? stat
    this.makeDirectory = dependencies.mkdir ?? mkdir
    this.copyLocalFile = dependencies.copyFile ?? copyFile
    this.maxBytes = dependencies.maxBytes ?? getFileUploadRequestBodyLimitBytes()
    this.maxCacheEntries = Math.max(1, dependencies.maxCacheEntries ?? MAX_CACHED_SESSION_ATTACHMENTS)
    this.maxPrefetchConcurrency = Math.max(
      1,
      dependencies.maxPrefetchConcurrency ?? MAX_SESSION_ATTACHMENT_PREFETCH_CONCURRENCY,
    )
  }

  rememberFromThreadRead(value: unknown): string[] {
    const remembered: string[] = []
    const pending: unknown[] = [value]
    const visited = new Set<object>()
    let scannedNodes = 0

    while (pending.length > 0 && scannedNodes < MAX_THREAD_READ_SCAN_NODES) {
      const current = pending.pop()
      if (current === null || typeof current !== 'object') continue
      if (visited.has(current)) continue
      visited.add(current)
      scannedNodes += 1

      if (Array.isArray(current)) {
        for (const item of current) pending.push(item)
        continue
      }

      const record = current as Record<string, unknown>
      if (record.type === 'localImage' && typeof record.path === 'string') {
        const normalized = this.normalizeCandidate(record.path)
        if (normalized && !this.registeredPaths.has(pathKey(normalized))) {
          this.registeredPaths.set(pathKey(normalized), normalized)
          remembered.push(normalized)
          while (this.registeredPaths.size > MAX_REGISTERED_SESSION_ATTACHMENTS) {
            const oldestKey = this.registeredPaths.keys().next().value
            if (typeof oldestKey !== 'string') break
            this.registeredPaths.delete(oldestKey)
          }
        }
      }

      for (const child of Object.values(record)) pending.push(child)
    }

    return remembered
  }

  async cacheFromThreadRead(value: unknown): Promise<string[]> {
    const remembered = this.rememberFromThreadRead(value)
    await Promise.all(remembered.map((candidatePath) => this.prefetch(candidatePath)))
    await this.pruneCache()
    return remembered
  }

  private async prefetch(candidatePath: string): Promise<void> {
    await new Promise<void>((resolvePrefetch) => {
      const start = (): void => {
        this.activePrefetchCount += 1
        void this.resolve(candidatePath)
          .catch(() => {})
          .finally(() => {
            this.activePrefetchCount -= 1
            resolvePrefetch()
            this.pendingPrefetchStarts.shift()?.()
          })
      }
      if (this.activePrefetchCount < this.maxPrefetchConcurrency) start()
      else this.pendingPrefetchStarts.push(start)
    })
  }

  async resolve(candidatePath: string): Promise<string> {
    const normalized = this.normalizeCandidate(candidatePath)
    if (!normalized || !this.registeredPaths.has(pathKey(normalized))) {
      throw new SessionAttachmentAccessError('not-registered')
    }

    const cachedPath = this.getCachedPath(normalized)
    const cached = await this.resolveCachedFile(cachedPath)
    if (cached) return cached

    const sourcePath = await this.resolveSourceFile(normalized)
    const sourceStats = await this.readStat(sourcePath).catch(() => null)
    if (!sourceStats?.isFile()) throw new SessionAttachmentAccessError('not-found')
    if (sourceStats.size > this.maxBytes) throw new SessionAttachmentAccessError('too-large')

    const cacheDirectory = dirname(cachedPath)
    await this.makeDirectory(cacheDirectory, { recursive: true })
    const canonicalUploadRoot = await this.resolveRealPath(this.uploadRoot)
    const canonicalCacheDirectory = await this.resolveRealPath(cacheDirectory)
    if (!isPathWithinRoot(canonicalUploadRoot, canonicalCacheDirectory)) {
      throw new SessionAttachmentAccessError('not-registered')
    }

    const canonicalCachedPath = join(canonicalCacheDirectory, basename(cachedPath))
    const temporaryPath = `${canonicalCachedPath}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await this.copyLocalFile(sourcePath, temporaryPath)
      await rename(temporaryPath, canonicalCachedPath)
    } catch (error) {
      const code = readErrorCode(error)
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw new SessionAttachmentAccessError('not-found')
      }
    } finally {
      await unlink(temporaryPath).catch(() => {})
    }

    const copied = await this.resolveCachedFile(canonicalCachedPath)
    if (!copied) throw new SessionAttachmentAccessError('not-found')
    return copied
  }

  private normalizeCandidate(candidatePath: string): string | null {
    const trimmed = candidatePath.trim()
    if (!trimmed || !isAbsolute(trimmed)) return null
    const normalized = resolve(trimmed)
    if (!isPathWithinRoot(this.tempRoot, normalized)) return null
    if (!CODEX_CLIPBOARD_IMAGE_PATTERN.test(basename(normalized))) return null
    return normalized
  }

  private getCachedPath(sourcePath: string): string {
    const digest = createHash('sha256').update(pathKey(sourcePath)).digest('hex')
    return join(
      this.uploadRoot,
      SESSION_ATTACHMENT_CACHE_DIRECTORY,
      digest,
      `attachment${extname(sourcePath).toLowerCase()}`,
    )
  }

  private async resolveCachedFile(cachedPath: string): Promise<string | null> {
    try {
      const canonicalUploadRoot = await this.resolveRealPath(this.uploadRoot)
      const canonicalCachedPath = await this.resolveRealPath(cachedPath)
      if (!isPathWithinRoot(canonicalUploadRoot, canonicalCachedPath)) return null
      const cachedStats = await this.readStat(canonicalCachedPath)
      if (!cachedStats.isFile()) return null
      if (cachedStats.size > this.maxBytes) throw new SessionAttachmentAccessError('too-large')
      return canonicalCachedPath
    } catch {
      return null
    }
  }

  private async resolveSourceFile(sourcePath: string): Promise<string> {
    try {
      const canonicalTempRoot = await this.resolveRealPath(this.tempRoot)
      const canonicalSourcePath = await this.resolveRealPath(sourcePath)
      if (!isPathWithinRoot(canonicalTempRoot, canonicalSourcePath)) {
        throw new SessionAttachmentAccessError('not-registered')
      }
      return canonicalSourcePath
    } catch (error) {
      if (error instanceof SessionAttachmentAccessError) throw error
      throw new SessionAttachmentAccessError('not-found')
    }
  }

  private async pruneCache(): Promise<void> {
    const cacheRoot = join(this.uploadRoot, SESSION_ATTACHMENT_CACHE_DIRECTORY)
    try {
      await this.makeDirectory(cacheRoot, { recursive: true })
      const canonicalCacheRoot = await this.resolveRealPath(cacheRoot)
      const entries = await readdir(canonicalCacheRoot, { withFileTypes: true })
      const cacheDirectories = (await Promise.all(entries
        .filter((entry) => entry.isDirectory() && SESSION_ATTACHMENT_CACHE_KEY_PATTERN.test(entry.name))
        .map(async (entry) => {
          const candidatePath = join(canonicalCacheRoot, entry.name)
          const canonicalPath = await this.resolveRealPath(candidatePath)
          if (!isPathWithinRoot(canonicalCacheRoot, canonicalPath)) return null
          const stats = await this.readStat(canonicalPath)
          return stats.isDirectory() ? { path: canonicalPath, updatedAtMs: stats.mtimeMs } : null
        })))
        .filter((entry): entry is { path: string; updatedAtMs: number } => entry !== null)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs)

      for (const entry of cacheDirectories.slice(this.maxCacheEntries)) {
        await rm(entry.path, { recursive: true, force: true })
      }
    } catch {
      // Cache maintenance is best-effort and must not make thread/read fail.
    }
  }
}

const defaultSessionAttachmentAccessStore = new SessionAttachmentAccessStore()

export function rememberSessionAttachmentPaths(threadRead: unknown): string[] {
  return defaultSessionAttachmentAccessStore.rememberFromThreadRead(threadRead)
}

export async function cacheSessionAttachmentPaths(threadRead: unknown): Promise<string[]> {
  return await defaultSessionAttachmentAccessStore.cacheFromThreadRead(threadRead)
}

export async function resolveSessionAttachmentPath(candidatePath: string): Promise<string> {
  return await defaultSessionAttachmentAccessStore.resolve(candidatePath)
}
