import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { getCodexGlobalStatePath } from './codexPaths.js'
import { readWorkspaceRootsState } from './workspaceRootsState.js'

export type LocalFileAccessErrorCode = 'not-found' | 'outside-workspace'

export class LocalFileAccessError extends Error {
  readonly code: LocalFileAccessErrorCode

  constructor(code: LocalFileAccessErrorCode) {
    super(code === 'outside-workspace'
      ? 'Local path is outside the configured workspace roots.'
      : 'Local path does not exist.')
    this.name = 'LocalFileAccessError'
    this.code = code
  }
}

export type LocalFileAccessDependencies = {
  getWorkspaceRoots?: () => Promise<string[]>
  realpath?: typeof realpath
  stat?: typeof stat
}

async function readConfiguredWorkspaceRoots(): Promise<string[]> {
  const state = await readWorkspaceRootsState(getCodexGlobalStatePath())
  return [
    ...state.order,
    ...state.active,
    ...state.projectOrder,
    ...state.pinnedProjectIds,
  ]
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

function normalizeWorkspaceRoots(values: string[]): string[] {
  const roots: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || !isAbsolute(trimmed)) continue
    const normalized = resolve(trimmed)
    if (!roots.includes(normalized)) roots.push(normalized)
  }
  return roots
}

export async function resolveWorkspaceLocalPath(
  candidatePath: string,
  dependencies: LocalFileAccessDependencies = {},
): Promise<string> {
  if (!isAbsolute(candidatePath)) {
    throw new LocalFileAccessError('outside-workspace')
  }
  const normalizedCandidate = resolve(candidatePath)
  const getWorkspaceRoots = dependencies.getWorkspaceRoots ?? readConfiguredWorkspaceRoots
  const resolveRealPath = dependencies.realpath ?? realpath
  const readStat = dependencies.stat ?? stat
  const roots = normalizeWorkspaceRoots(await getWorkspaceRoots())
  const lexicalRoots = roots.filter((rootPath) => isPathWithinRoot(rootPath, normalizedCandidate))

  if (lexicalRoots.length === 0) {
    throw new LocalFileAccessError('outside-workspace')
  }

  let canonicalCandidate: string
  try {
    canonicalCandidate = await resolveRealPath(normalizedCandidate)
  } catch {
    throw new LocalFileAccessError('not-found')
  }

  for (const rootPath of lexicalRoots) {
    try {
      const rootStat = await readStat(rootPath)
      if (!rootStat.isDirectory()) continue
      const canonicalRoot = await resolveRealPath(rootPath)
      if (isPathWithinRoot(canonicalRoot, canonicalCandidate)) {
        return canonicalCandidate
      }
    } catch {
      // Stale or unavailable roots grant no access.
    }
  }

  throw new LocalFileAccessError('outside-workspace')
}
