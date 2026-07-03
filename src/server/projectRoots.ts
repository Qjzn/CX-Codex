import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { upsertWorkspaceRootState, type WorkspaceRootsState } from './workspaceRootsState.js'

export type ProjectRootResult = {
  path: string
  workspaceState: WorkspaceRootsState
}

export type ProjectRootSuggestion = {
  name: string
  path: string
}

export class ProjectRootError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ProjectRootError'
  }
}

export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim()
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed)
}

async function assertDirectory(path: string, missingMessage: string, notDirectoryMessage: string): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      throw new ProjectRootError(notDirectoryMessage, 400)
    }
  } catch (error) {
    if (error instanceof ProjectRootError) throw error
    throw new ProjectRootError(missingMessage, 404)
  }
}

export async function resolveProjectRoot(
  path: string,
  options: {
    createIfMissing?: boolean
    label?: string
    existingState: WorkspaceRootsState
  },
): Promise<ProjectRootResult> {
  if (!path.trim()) {
    throw new ProjectRootError('Missing path', 400)
  }

  const normalizedPath = normalizeProjectPath(path)
  let pathExists = true
  try {
    const info = await stat(normalizedPath)
    if (!info.isDirectory()) {
      throw new ProjectRootError('Path exists but is not a directory', 400)
    }
  } catch (error) {
    if (error instanceof ProjectRootError) throw error
    pathExists = false
  }

  if (!pathExists && options.createIfMissing === true) {
    await mkdir(normalizedPath, { recursive: true })
  } else if (!pathExists) {
    throw new ProjectRootError('Directory does not exist', 404)
  }

  return {
    path: normalizedPath,
    workspaceState: upsertWorkspaceRootState(options.existingState, normalizedPath, options.label ?? ''),
  }
}

export async function suggestProjectRoot(basePath: string): Promise<ProjectRootSuggestion> {
  if (!basePath.trim()) {
    throw new ProjectRootError('Missing basePath', 400)
  }

  const normalizedBasePath = normalizeProjectPath(basePath)
  await assertDirectory(normalizedBasePath, 'basePath does not exist', 'basePath is not a directory')

  let index = 1
  while (index < 100000) {
    const candidateName = `New Project (${String(index)})`
    const candidatePath = join(normalizedBasePath, candidateName)
    try {
      await stat(candidatePath)
      index += 1
    } catch {
      return { name: candidateName, path: candidatePath }
    }
  }

  throw new ProjectRootError('Failed to compute project name suggestion', 500)
}
