import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

export type ThreadTitleCache = { titles: Record<string, string>; order: string[]; manualTitleIds?: string[] }

const MAX_THREAD_TITLES = 500
const EMPTY_THREAD_TITLE_CACHE: ThreadTitleCache = { titles: {}, order: [], manualTitleIds: [] }

type SessionIndexThreadTitleCacheState = {
  sessionIndexPath: string | null
  fileSignature: string | null
  cache: ThreadTitleCache
}

type SessionIndexThreadTitle = {
  id: string
  title: string
  updatedAtMs: number
}

let sessionIndexThreadTitleCacheState: SessionIndexThreadTitleCacheState = {
  sessionIndexPath: null,
  fileSignature: null,
  cache: EMPTY_THREAD_TITLE_CACHE,
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

function getSessionIndexFileSignature(stats: { mtimeMs: number; size: number }): string {
  return `${String(stats.mtimeMs)}:${String(stats.size)}`
}

export function normalizeThreadTitleCache(value: unknown): ThreadTitleCache {
  const record = asRecord(value)
  if (!record) return EMPTY_THREAD_TITLE_CACHE
  const rawTitles = asRecord(record.titles)
  const titles: Record<string, string> = {}
  if (rawTitles) {
    for (const [k, v] of Object.entries(rawTitles)) {
      if (typeof v === 'string' && v.length > 0) titles[k] = v
    }
  }
  const order = normalizeStringArray(record.order)
  const manualTitleIds = normalizeStringArray(record.manualTitleIds).filter((id) => Boolean(titles[id]))
  return { titles, order, manualTitleIds }
}

export function updateThreadTitleCache(
  cache: ThreadTitleCache,
  id: string,
  title: string,
  options: { manual?: boolean } = {},
): ThreadTitleCache {
  const manualTitleIds = cache.manualTitleIds ?? []
  if (options.manual !== true && manualTitleIds.includes(id) && cache.titles[id] !== title) {
    return cache
  }
  const titles = { ...cache.titles, [id]: title }
  const order = [id, ...cache.order.filter((o) => o !== id)]
  const nextManualTitleIds = options.manual === true
    ? [id, ...manualTitleIds.filter((candidate) => candidate !== id)]
    : [...manualTitleIds]
  while (order.length > MAX_THREAD_TITLES) {
    const removed = order.pop()
    if (removed) {
      delete titles[removed]
      const manualIndex = nextManualTitleIds.indexOf(removed)
      if (manualIndex >= 0) nextManualTitleIds.splice(manualIndex, 1)
    }
  }
  return { titles, order, manualTitleIds: nextManualTitleIds }
}

export function removeFromThreadTitleCache(cache: ThreadTitleCache, id: string): ThreadTitleCache {
  const { [id]: _, ...titles } = cache.titles
  return {
    titles,
    order: cache.order.filter((o) => o !== id),
    manualTitleIds: (cache.manualTitleIds ?? []).filter((candidate) => candidate !== id),
  }
}

function normalizeSessionIndexThreadTitle(value: unknown): SessionIndexThreadTitle | null {
  const record = asRecord(value)
  if (!record) return null

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.thread_name === 'string' ? record.thread_name.trim() : ''
  const updatedAtIso = typeof record.updated_at === 'string' ? record.updated_at.trim() : ''
  const updatedAtMs = updatedAtIso ? Date.parse(updatedAtIso) : Number.NaN

  if (!id || !title) return null
  return {
    id,
    title,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  }
}

function trimThreadTitleCache(cache: ThreadTitleCache): ThreadTitleCache {
  const titles = { ...cache.titles }
  const order = cache.order.filter((id) => {
    if (!titles[id]) return false
    return true
  }).slice(0, MAX_THREAD_TITLES)

  for (const id of Object.keys(titles)) {
    if (!order.includes(id)) {
      delete titles[id]
    }
  }

  return {
    titles,
    order,
    manualTitleIds: (cache.manualTitleIds ?? []).filter((id) => order.includes(id)),
  }
}

export function mergeThreadTitleCaches(base: ThreadTitleCache, overlay: ThreadTitleCache): ThreadTitleCache {
  const titles = { ...base.titles, ...overlay.titles }
  const manualTitleIds = [...(base.manualTitleIds ?? [])]
  for (const id of manualTitleIds) {
    if (base.titles[id]) titles[id] = base.titles[id]
  }
  const order: string[] = []

  for (const id of [...overlay.order, ...base.order]) {
    if (!titles[id] || order.includes(id)) continue
    order.push(id)
  }

  for (const id of Object.keys(titles)) {
    if (!order.includes(id)) {
      order.push(id)
    }
  }

  return trimThreadTitleCache({ titles, order, manualTitleIds })
}

export async function readThreadTitleCache(statePath: string): Promise<ThreadTitleCache> {
  try {
    const raw = await readFile(statePath, 'utf8')
    const payload = asRecord(JSON.parse(raw)) ?? {}
    return normalizeThreadTitleCache(payload['thread-titles'])
  } catch {
    return EMPTY_THREAD_TITLE_CACHE
  }
}

export async function writeThreadTitleCache(statePath: string, cache: ThreadTitleCache): Promise<void> {
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    payload = asRecord(JSON.parse(raw)) ?? {}
  } catch {
    payload = {}
  }
  payload['thread-titles'] = cache
  await writeFile(statePath, JSON.stringify(payload), 'utf8')
}

export async function parseThreadTitlesFromSessionIndex(sessionIndexPath: string): Promise<ThreadTitleCache> {
  const latestById = new Map<string, SessionIndexThreadTitle>()
  const input = createReadStream(sessionIndexPath, { encoding: 'utf8' })
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const entry = normalizeSessionIndexThreadTitle(JSON.parse(trimmed) as unknown)
        if (!entry) continue

        const previous = latestById.get(entry.id)
        if (!previous || entry.updatedAtMs >= previous.updatedAtMs) {
          latestById.set(entry.id, entry)
        }
      } catch {
        // Skip malformed lines and keep scanning the rest of the index.
      }
    }
  } finally {
    lines.close()
    input.close()
  }

  const entries = Array.from(latestById.values()).sort((first, second) => second.updatedAtMs - first.updatedAtMs)
  const titles: Record<string, string> = {}
  const order: string[] = []
  for (const entry of entries) {
    titles[entry.id] = entry.title
    order.push(entry.id)
  }

  return trimThreadTitleCache({ titles, order, manualTitleIds: [] })
}

export async function readThreadTitlesFromSessionIndex(sessionIndexPath: string): Promise<ThreadTitleCache> {
  try {
    const stats = await stat(sessionIndexPath)
    const fileSignature = getSessionIndexFileSignature(stats)
    if (
      sessionIndexThreadTitleCacheState.sessionIndexPath === sessionIndexPath &&
      sessionIndexThreadTitleCacheState.fileSignature === fileSignature
    ) {
      return sessionIndexThreadTitleCacheState.cache
    }

    const cache = await parseThreadTitlesFromSessionIndex(sessionIndexPath)
    sessionIndexThreadTitleCacheState = { sessionIndexPath, fileSignature, cache }
    return cache
  } catch {
    sessionIndexThreadTitleCacheState = {
      sessionIndexPath,
      fileSignature: 'missing',
      cache: EMPTY_THREAD_TITLE_CACHE,
    }
    return sessionIndexThreadTitleCacheState.cache
  }
}

export async function readMergedThreadTitleCache(
  statePath: string,
  sessionIndexPath: string,
): Promise<ThreadTitleCache> {
  const [sessionIndexCache, persistedCache] = await Promise.all([
    readThreadTitlesFromSessionIndex(sessionIndexPath),
    readThreadTitleCache(statePath),
  ])
  return mergeThreadTitleCaches(persistedCache, sessionIndexCache)
}
