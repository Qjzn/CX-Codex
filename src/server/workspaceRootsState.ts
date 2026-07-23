import { readFile, writeFile } from 'node:fs/promises'

export type WorkspaceRootsState = {
  order: string[]
  labels: Record<string, string>
  active: string[]
  projectOrder: string[]
  pinnedProjectIds: string[]
}

const EMPTY_WORKSPACE_ROOTS_STATE: WorkspaceRootsState = {
  order: [],
  labels: {},
  active: [],
  projectOrder: [],
  pinnedProjectIds: [],
}

type LocalProject = {
  id: string
  name: string
  rootPaths: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && !normalized.includes(item)) {
      normalized.push(item)
    }
  }
  return normalized
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key.length > 0 && typeof item === 'string') {
      next[key] = item
    }
  }
  return next
}

function normalizeComparablePath(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  return /^[a-z]:\//iu.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function isWorkspacePath(value: string): boolean {
  const normalized = value.trim()
  return /^[a-z]:[\\/]/iu.test(normalized) || normalized.startsWith('\\\\') || normalized.startsWith('/')
}

function normalizeLocalProjects(value: unknown): Map<string, LocalProject> {
  const record = asRecord(value)
  const projects = new Map<string, LocalProject>()
  if (!record) return projects

  for (const [key, item] of Object.entries(record)) {
    const projectRecord = asRecord(item)
    if (!projectRecord) continue
    const id = typeof projectRecord.id === 'string' && projectRecord.id.length > 0
      ? projectRecord.id
      : key
    const project: LocalProject = {
      id,
      name: typeof projectRecord.name === 'string' ? projectRecord.name.trim() : '',
      rootPaths: normalizeStringArray(projectRecord.rootPaths),
    }
    projects.set(key, project)
    projects.set(id, project)
  }

  return projects
}

function resolveWorkspaceProjectRefs(refs: unknown, projects: Map<string, LocalProject>): string[] {
  const resolved: string[] = []
  for (const ref of normalizeStringArray(refs)) {
    const projectRoot = projects.get(ref)?.rootPaths[0]
    const value = projectRoot || (isWorkspacePath(ref) ? ref : '')
    if (value && !resolved.includes(value)) {
      resolved.push(value)
    }
  }
  return resolved
}

function encodeWorkspaceProjectRefs(
  refs: string[],
  existingRefs: unknown,
  projects: Map<string, LocalProject>,
): string[] {
  if (projects.size === 0) return normalizeStringArray(refs)

  const projectIdByRoot = new Map<string, string>()
  for (const project of new Set(projects.values())) {
    for (const rootPath of project.rootPaths) {
      const comparablePath = normalizeComparablePath(rootPath)
      if (comparablePath && !projectIdByRoot.has(comparablePath)) {
        projectIdByRoot.set(comparablePath, project.id)
      }
    }
  }

  const encoded: string[] = []
  for (const ref of normalizeStringArray(refs)) {
    const project = projects.get(ref)
    const projectId = project?.id ?? projectIdByRoot.get(normalizeComparablePath(ref))
    const value = projectId || (isWorkspacePath(ref) ? ref : '')
    if (value && !encoded.includes(value)) {
      encoded.push(value)
    }
  }

  for (const existingRef of normalizeStringArray(existingRefs)) {
    if (!projects.has(existingRef) && !isWorkspacePath(existingRef) && !encoded.includes(existingRef)) {
      encoded.push(existingRef)
    }
  }
  return encoded
}

export function normalizeWorkspaceRootsState(value: unknown): WorkspaceRootsState {
  const record = asRecord(value)
  if (!record) return EMPTY_WORKSPACE_ROOTS_STATE

  return {
    order: normalizeStringArray(record.order),
    labels: normalizeStringRecord(record.labels),
    active: normalizeStringArray(record.active),
    projectOrder: normalizeStringArray(record.projectOrder),
    pinnedProjectIds: normalizeStringArray(record.pinnedProjectIds),
  }
}

export function readWorkspaceRootsStateFromPayload(payload: unknown): WorkspaceRootsState {
  const record = asRecord(payload) ?? {}
  const projects = normalizeLocalProjects(record['local-projects'])
  const labels = normalizeStringRecord(record['electron-workspace-root-labels'])
  for (const project of new Set(projects.values())) {
    const rootPath = project.rootPaths[0]
    if (rootPath && project.name) {
      labels[rootPath] = project.name
    }
  }

  return {
    order: normalizeStringArray(record['electron-saved-workspace-roots']),
    labels,
    active: normalizeStringArray(record['active-workspace-roots']),
    projectOrder: resolveWorkspaceProjectRefs(record['project-order'], projects),
    pinnedProjectIds: resolveWorkspaceProjectRefs(record['pinned-project-ids'], projects),
  }
}

export async function readWorkspaceRootsState(statePath: string): Promise<WorkspaceRootsState> {
  try {
    const raw = await readFile(statePath, 'utf8')
    return readWorkspaceRootsStateFromPayload(JSON.parse(raw) as unknown)
  } catch {
    return EMPTY_WORKSPACE_ROOTS_STATE
  }
}

export async function writeWorkspaceRootsState(
  statePath: string,
  nextState: WorkspaceRootsState,
): Promise<void> {
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }

  const projects = normalizeLocalProjects(payload['local-projects'])
  payload['electron-saved-workspace-roots'] = normalizeStringArray(nextState.order)
  payload['electron-workspace-root-labels'] = normalizeStringRecord(nextState.labels)
  payload['active-workspace-roots'] = normalizeStringArray(nextState.active)
  payload['project-order'] = encodeWorkspaceProjectRefs(
    nextState.projectOrder,
    payload['project-order'],
    projects,
  )
  payload['pinned-project-ids'] = encodeWorkspaceProjectRefs(
    nextState.pinnedProjectIds,
    payload['pinned-project-ids'],
    projects,
  )

  await writeFile(statePath, JSON.stringify(payload), 'utf8')
}

export function upsertWorkspaceRootState(
  state: WorkspaceRootsState,
  path: string,
  label: string,
): WorkspaceRootsState {
  const normalizedPath = path.trim()
  if (!normalizedPath) return normalizeWorkspaceRootsState(state)

  const order = [normalizedPath, ...state.order.filter((item) => item !== normalizedPath)]
  const projectOrder = [normalizedPath, ...(state.projectOrder ?? []).filter((item) => item !== normalizedPath)]
  const active = [normalizedPath, ...state.active.filter((item) => item !== normalizedPath)]
  const labels = { ...state.labels }
  const normalizedLabel = label.trim()
  if (normalizedLabel.length > 0) {
    labels[normalizedPath] = normalizedLabel
  }

  return { order, labels, active, projectOrder, pinnedProjectIds: [...(state.pinnedProjectIds ?? [])] }
}
