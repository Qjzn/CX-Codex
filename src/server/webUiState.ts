import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  getCodexHomeDir,
  getWebFavoritesPath,
  getWebPinnedThreadIdsPath,
  getWebUiStatePath,
} from './codexPaths.js'

export type FavoriteRecord = {
  id: string
  threadId: string
  messageId: string
  threadTitle: string
  threadCwd: string
  role: 'user' | 'assistant' | 'system'
  text: string
  preview: string
  turnIndex: number | null
  favoritedAtIso: string
}

type WebUiState = {
  favorites: FavoriteRecord[]
  pinnedThreadIds: string[]
}

const DEFAULT_WEB_UI_STATE: WebUiState = {
  favorites: [],
  pinnedThreadIds: [],
}

function normalizeStringArray(value: unknown): string[] {
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

function buildFavoritePreview(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 140 ? `${normalized.slice(0, 140).trimEnd()}...` : normalized
}

function normalizeFavoriteRecord(value: unknown): FavoriteRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : ''
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : ''
  const text = typeof record.text === 'string' ? record.text : ''
  if (!threadId || !messageId || !text.trim()) return null

  const role = record.role === 'user' || record.role === 'assistant' || record.role === 'system'
    ? record.role
    : 'assistant'

  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${threadId}:${messageId}`,
    threadId,
    messageId,
    threadTitle: typeof record.threadTitle === 'string' ? record.threadTitle : '',
    threadCwd: typeof record.threadCwd === 'string' ? record.threadCwd : '',
    role,
    text,
    preview: typeof record.preview === 'string' && record.preview.trim()
      ? record.preview
      : buildFavoritePreview(text),
    turnIndex: typeof record.turnIndex === 'number' ? record.turnIndex : null,
    favoritedAtIso: typeof record.favoritedAtIso === 'string' && record.favoritedAtIso.trim()
      ? record.favoritedAtIso
      : new Date().toISOString(),
  }
}

function normalizeFavoriteRecords(value: unknown): FavoriteRecord[] {
  if (!Array.isArray(value)) return []

  const normalized: FavoriteRecord[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    const record = normalizeFavoriteRecord(item)
    if (!record || seenIds.has(record.id)) continue
    seenIds.add(record.id)
    normalized.push(record)
  }

  return normalized.sort((first, second) => second.favoritedAtIso.localeCompare(first.favoritedAtIso))
}

function normalizeWebUiState(value: unknown): WebUiState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_WEB_UI_STATE
  }

  const record = value as Record<string, unknown>
  return {
    favorites: normalizeFavoriteRecords(record.favorites),
    pinnedThreadIds: normalizeStringArray(record.pinnedThreadIds),
  }
}

async function readWebUiState(): Promise<WebUiState> {
  try {
    const raw = await readFile(getWebUiStatePath(), 'utf8')
    return normalizeWebUiState(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_WEB_UI_STATE
  }
}

async function syncLegacyCombinedWebUiState(): Promise<void> {
  const [favorites, pinnedThreadIds] = await Promise.all([
    readFavoriteRecords(),
    readPinnedThreadIds(),
  ])
  await mkdir(getCodexHomeDir(), { recursive: true })
  await writeFile(getWebUiStatePath(), JSON.stringify({
    favorites,
    pinnedThreadIds,
  }, null, 2), 'utf8')
}

export async function readFavoriteRecords(): Promise<FavoriteRecord[]> {
  try {
    const raw = await readFile(getWebFavoritesPath(), 'utf8')
    return normalizeFavoriteRecords(JSON.parse(raw) as unknown)
  } catch {
    const state = await readWebUiState()
    return state.favorites
  }
}

export async function writeFavoriteRecords(favorites: FavoriteRecord[]): Promise<FavoriteRecord[]> {
  const normalized = normalizeFavoriteRecords(favorites)
  await mkdir(getCodexHomeDir(), { recursive: true })
  await writeFile(getWebFavoritesPath(), JSON.stringify(normalized, null, 2), 'utf8')
  await syncLegacyCombinedWebUiState()
  return normalized
}

export async function readPinnedThreadIds(): Promise<string[]> {
  try {
    const raw = await readFile(getWebPinnedThreadIdsPath(), 'utf8')
    return normalizeStringArray(JSON.parse(raw) as unknown)
  } catch {
    const state = await readWebUiState()
    return state.pinnedThreadIds
  }
}

export async function writePinnedThreadIds(pinnedThreadIds: string[]): Promise<string[]> {
  const normalized = normalizeStringArray(pinnedThreadIds)
  await mkdir(getCodexHomeDir(), { recursive: true })
  await writeFile(getWebPinnedThreadIdsPath(), JSON.stringify(normalized, null, 2), 'utf8')
  await syncLegacyCombinedWebUiState()
  return normalized
}
