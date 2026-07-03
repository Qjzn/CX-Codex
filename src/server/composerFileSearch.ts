import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { resolveRipgrepCommand } from '../commandResolution.js'

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
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        const rows = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        resolveRows(rows)
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      reject(new Error(details || 'rg --files failed'))
    })
  })
}

export async function searchComposerFiles(args: {
  cwd: string
  query: string
  limit: unknown
}): Promise<ComposerFileSearchResult[]> {
  const cwd = normalizeComposerFileSearchCwd(args.cwd)
  await assertComposerFileSearchCwd(cwd)
  const files = await listFilesWithRipgrep(cwd)
  return searchComposerFileCandidates(files, args.query, normalizeComposerFileSearchLimit(args.limit))
}
