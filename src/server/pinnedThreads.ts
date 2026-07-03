import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  getCodexGlobalStatePath,
  getCodexHomeDir,
} from './codexPaths.js'
import {
  readPinnedThreadIds,
  writePinnedThreadIds,
} from './webUiState.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normalizePinnedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const nextValue = item.trim()
    if (!nextValue || normalized.includes(nextValue)) continue
    normalized.push(nextValue)
  }
  return normalized
}

export async function readDesktopPinnedThreadIds(): Promise<string[]> {
  try {
    const raw = await readFile(getCodexGlobalStatePath(), 'utf8')
    const payload = asRecord(JSON.parse(raw)) ?? {}
    return normalizePinnedThreadIds(payload['pinned-thread-ids'])
  } catch {
    return []
  }
}

export async function writeDesktopPinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const normalized = normalizePinnedThreadIds(pinnedThreadIds)
  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }
  payload['pinned-thread-ids'] = normalized
  await mkdir(getCodexHomeDir(), { recursive: true })
  await writeFile(statePath, JSON.stringify(payload), 'utf8')
  return normalized
}

export async function readMergedPinnedThreadIds(): Promise<string[]> {
  const [webPinnedIds, desktopPinnedIds] = await Promise.all([
    readPinnedThreadIds(),
    readDesktopPinnedThreadIds(),
  ])
  return normalizePinnedThreadIds([...webPinnedIds, ...desktopPinnedIds])
}

export async function writeMergedPinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const normalized = normalizePinnedThreadIds(pinnedThreadIds)
  const [webPinnedIds, desktopPinnedIds] = await Promise.all([
    writePinnedThreadIds(normalized),
    writeDesktopPinnedThreadIds(normalized),
  ])
  return normalizePinnedThreadIds([...webPinnedIds, ...desktopPinnedIds])
}
