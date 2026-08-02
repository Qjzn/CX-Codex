import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { resolveRipgrepCommand } from '../commandResolution.js'

export const COMPOSER_FILE_SEARCH_CACHE_TTL_MS = 2000
export const COMPOSER_FILE_SEARCH_CACHE_MAX_ROOTS = 4
export const COMPOSER_FILE_SEARCH_TIMEOUT_MS = 10_000
export const COMPOSER_FILE_SEARCH_MAX_OUTPUT_BYTES = 32 * 1024 * 1024

type ComposerFileSearchCacheEntry = {
  files: string[]
  expiresAtMs: number
}

const composerFileSearchCache = new Map<string, ComposerFileSearchCacheEntry>()
const composerFileSearchInFlight = new Map<string, Promise<string[]>>()

export type ComposerFileSearchResult = {
  path: string
}

export class ComposerFileSearchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ComposerFileSearchError'
  }
}

export function normalizeComposerFileSearchLimit(value: unknown): number {
  const limitRaw = typeof value === 'number' ? value : 20
  return Math.max(1, Math.min(100, Math.floor(limitRaw)))
}

export function normalizeComposerFileSearchCwd(rawCwd: string): string {
  const trimmed = rawCwd.trim()
  if (!trimmed) throw new ComposerFileSearchError('Missing cwd', 400)
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed)
}

export async function assertComposerFileSearchCwd(cwd: string): Promise<void> {
  try {
    const info = await stat(cwd)
    if (!info.isDirectory()) {
      throw new ComposerFileSearchError('cwd is not a directory', 400)
    }
  } catch (error) {
    if (error instanceof ComposerFileSearchError) throw error
    throw new ComposerFileSearchError('cwd does not exist', 404)
  }
}

export function scoreFileCandidate(path: string, query: string): number {
  if (!query) return 0
  const lowerPath = path.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const baseName = lowerPath.slice(lowerPath.lastIndexOf('/') + 1)
  if (baseName === lowerQuery) return 0
  if (baseName.startsWith(lowerQuery)) return 1
  if (baseName.includes(lowerQuery)) return 2
  if (lowerPath.includes(`/${lowerQuery}`)) return 3
  if (lowerPath.includes(lowerQuery)) return 4
  return 10
}

export function searchComposerFileCandidates(
  files: string[],
  query: string,
  limit: number,
): ComposerFileSearchResult[] {
  const normalizedQuery = query.trim()
  const normalizedLimit = normalizeComposerFileSearchLimit(limit)
  return files
    .map((path) => ({ path, score: scoreFileCandidate(path, normalizedQuery) }))
    .filter((row) => normalizedQuery.length === 0 || row.score < 10)
    .sort((a, b) => (a.score - b.score) || a.path.localeCompare(b.path))
    .slice(0, normalizedLimit)
    .map((row) => ({ path: row.path }))
}

export function clearComposerFileSearchCache(): void {
  composerFileSearchCache.clear()
  composerFileSearchInFlight.clear()
}

export async function getComposerFileSearchFiles(
  cwd: string,
  loadFiles: (cwd: string) => Promise<string[]> = listFilesWithRipgrep,
): Promise<string[]> {
  const now = Date.now()
  for (const [cacheKey, entry] of composerFileSearchCache) {
    if (entry.expiresAtMs <= now) composerFileSearchCache.delete(cacheKey)
  }

  const cached = composerFileSearchCache.get(cwd)
  if (cached) {
    composerFileSearchCache.delete(cwd)
    composerFileSearchCache.set(cwd, cached)
    return cached.files
  }

  const pending = composerFileSearchInFlight.get(cwd)
  if (pending) return await pending

  const loadPromise = loadFiles(cwd)
    .then((files) => {
      composerFileSearchCache.set(cwd, {
        files,
        expiresAtMs: Date.now() + COMPOSER_FILE_SEARCH_CACHE_TTL_MS,
      })
      while (composerFileSearchCache.size > COMPOSER_FILE_SEARCH_CACHE_MAX_ROOTS) {
        const oldestKey = composerFileSearchCache.keys().next().value
        if (typeof oldestKey !== 'string') break
        composerFileSearchCache.delete(oldestKey)
      }
      return files
    })
    .finally(() => {
      if (composerFileSearchInFlight.get(cwd) === loadPromise) {
        composerFileSearchInFlight.delete(cwd)
      }
    })

  composerFileSearchInFlight.set(cwd, loadPromise)
  return await loadPromise
}

export async function listFilesWithRipgrep(cwd: string): Promise<string[]> {
  return await new Promise<string[]>((resolveRows, reject) => {
    const ripgrepCommand = resolveRipgrepCommand()
    if (!ripgrepCommand) {
      reject(new Error('ripgrep (rg) is not available'))
      return
    }

    const proc = spawn(ripgrepCommand, ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let settled = false

    const finish = (error?: Error, rows?: string[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      proc.stdout.off('data', handleStdout)
      proc.stderr.off('data', handleStderr)
      proc.off('error', handleError)
      proc.off('close', handleClose)
      if (error) reject(error)
      else resolveRows(rows ?? [])
    }
    const stopWithError = (error: Error): void => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill()
      finish(error)
    }
    const handleStdout = (chunk: Buffer): void => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > COMPOSER_FILE_SEARCH_MAX_OUTPUT_BYTES) {
        stopWithError(new ComposerFileSearchError('Workspace file list is too large to search safely', 503))
        return
      }
      stdout += chunk.toString()
    }
    const handleStderr = (chunk: Buffer): void => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString()
    }
    const handleError = (error: Error): void => finish(error)
    const handleClose = (code: number | null): void => {
      if (code === 0) {
        const rows = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        finish(undefined, rows)
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      finish(new Error(details || 'rg --files failed'))
    }

    proc.stdout.on('data', handleStdout)
    proc.stderr.on('data', handleStderr)
    proc.on('error', handleError)
    proc.on('close', handleClose)
    const timeout = setTimeout(() => {
      stopWithError(new ComposerFileSearchError('Workspace file search timed out', 503))
    }, COMPOSER_FILE_SEARCH_TIMEOUT_MS)
    timeout.unref?.()
  })
}

export async function searchComposerFiles(args: {
  cwd: string
  query: string
  limit: unknown
}): Promise<ComposerFileSearchResult[]> {
  const cwd = normalizeComposerFileSearchCwd(args.cwd)
  await assertComposerFileSearchCwd(cwd)
  const files = await getComposerFileSearchFiles(cwd)
  return searchComposerFileCandidates(files, args.query, normalizeComposerFileSearchLimit(args.limit))
}
