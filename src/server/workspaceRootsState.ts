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
  return {
    order: normalizeStringArray(record['electron-saved-workspace-roots']),
    labels: normalizeStringRecord(record['electron-workspace-root-labels']),
    active: normalizeStringArray(record['active-workspace-roots']),
    projectOrder: normalizeStringArray(record['project-order']),
    pinnedProjectIds: normalizeStringArray(record['pinned-project-ids']),
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

  payload['electron-saved-workspace-roots'] = normalizeStringArray(nextState.order)
  payload['electron-workspace-root-labels'] = normalizeStringRecord(nextState.labels)
  payload['active-workspace-roots'] = normalizeStringArray(nextState.active)
  payload['project-order'] = normalizeStringArray(nextState.projectOrder)
  payload['pinned-project-ids'] = normalizeStringArray(nextState.pinnedProjectIds)

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
