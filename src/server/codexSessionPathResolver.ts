import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { getCodexHomeDir } from './codexPaths.js'
import {
  CODEX_SESSION_ROOTS,
  inspectCodexSessionPath,
  normalizeCodexThreadId,
  readCodexSessionLogIdentity,
} from './codexSessionIdentity.js'

export async function validateCodexSessionLogPath(
  absolutePath: string,
  threadId: string,
  codexHomeDir = getCodexHomeDir(),
): Promise<string> {
  const normalizedThreadId = normalizeCodexThreadId(threadId)
  if (!normalizedThreadId || !isAbsolute(absolutePath)) return ''
  const relativePath = relative(resolve(codexHomeDir), absolutePath)
  const identity = await readCodexSessionLogIdentity(relativePath, codexHomeDir)
  return identity?.threadId === normalizedThreadId ? identity.path : ''
}

export async function resolveCodexSessionLogPath(
  threadId: string,
  codexHomeDir = getCodexHomeDir(),
): Promise<string> {
  const normalizedThreadId = normalizeCodexThreadId(threadId)
  if (!normalizedThreadId) return ''
  const filenameHint = new RegExp(`(?:^|[^0-9a-f])${normalizedThreadId}(?=$|[^0-9a-f])`, 'iu')
  const candidates: Array<{ relativePath: string; modifiedAtMs: number }> = []
  const directories: string[] = [...CODEX_SESSION_ROOTS]
  while (directories.length > 0) {
    const relativeDirectory = directories.pop()!
    const directory = await inspectCodexSessionPath(relativeDirectory, codexHomeDir, 'directory')
    if (!directory) continue
    try {
      const entries = await readdir(directory.path, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const relativePath = `${relativeDirectory}/${entry.name}`
        if (entry.isDirectory()) {
          directories.push(relativePath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl') && filenameHint.test(entry.name)) {
          // Listing only ranks candidates. The selected file's entire path
          // and opened handle are checked again before any contents are read.
          const file = await lstat(join(directory.path, entry.name))
          if (file.isFile() && !file.isSymbolicLink()) candidates.push({ relativePath, modifiedAtMs: file.mtimeMs })
        }
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  // Supported rollout filenames contain the thread UUID, sometimes followed
  // by another UUID. The filename narrows discovery; metadata alone validates
  // identity. Do not scan every unrelated conversation header on each refresh.
  candidates.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || a.relativePath.localeCompare(b.relativePath))
  for (const candidate of candidates) {
    const identity = await readCodexSessionLogIdentity(candidate.relativePath, codexHomeDir)
    if (identity?.threadId === normalizedThreadId) return identity.path
  }
  return ''
}
