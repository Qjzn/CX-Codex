import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ThreadTitleCache } from './threadTitleCache.js'
import { logBridgeError } from './bridgeLog.js'

const THREAD_SEARCH_INDEX_CACHE_VERSION = 1

export type ThreadSearchDocument = {
  id: string
  title: string
  preview: string
  messageText: string
  searchableText: string
}

export type ThreadSearchIndex = {
  docsById: Map<string, ThreadSearchDocument>
}

export type ThreadListParams = {
  archived: boolean
  limit: number
  sortKey: 'updated_at'
  cursor: string | null
}

export type ThreadListRpc = (params: ThreadListParams) => Promise<unknown>

export type ThreadSearchIndexStoreDependencies = {
  cachePath?: string
  listThreads: ThreadListRpc
  getSessionIndexPath: () => string
  readThreadTitlesFromSessionIndex: (sessionIndexPath: string) => Promise<ThreadTitleCache>
}

type ThreadSearchIndexStoreOptions = {
  initialIndex?: ThreadSearchIndex | null
  buildInitialIndex?: () => Promise<ThreadSearchIndex>
  persistIndex?: (index: ThreadSearchIndex) => void
}

type ThreadListRow = {
  id: string
  title: string
  preview: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function normalizeThreadSearchRow(value: unknown): ThreadListRow | null {
  const record = asRecord(value)
  const id = typeof record?.id === 'string' ? record.id : ''
  if (!id) return null

  const title = typeof record?.name === 'string' && record.name.trim().length > 0
    ? record.name.trim()
    : (typeof record?.preview === 'string' && record.preview.trim().length > 0 ? record.preview.trim() : 'Untitled thread')
  const preview = typeof record?.preview === 'string' ? record.preview : ''
  return { id, title, preview }
}

export function createThreadSearchDocument(thread: ThreadListRow): ThreadSearchDocument {
  return {
    id: thread.id,
    title: thread.title,
    preview: thread.preview,
    messageText: '',
    searchableText: thread.title,
  }
}

export function readThreadSearchIndexCache(cachePath: string): ThreadSearchIndex | null {
  try {
    const payload = asRecord(JSON.parse(readFileSync(cachePath, 'utf8')) as unknown)
    if (payload?.version !== THREAD_SEARCH_INDEX_CACHE_VERSION || !Array.isArray(payload.documents)) return null

    const docsById = new Map<string, ThreadSearchDocument>()
    for (const value of payload.documents) {
      const document = asRecord(value)
      const id = typeof document?.id === 'string' ? document.id.trim() : ''
      const title = typeof document?.title === 'string' ? document.title.trim() : ''
      if (!id || !title || docsById.has(id)) continue
      docsById.set(id, createThreadSearchDocument({ id, title, preview: '' }))
    }
    return { docsById }
  } catch {
    return null
  }
}

export async function writeThreadSearchIndexCache(
  cachePath: string,
  index: ThreadSearchIndex,
): Promise<void> {
  const documents = Array.from(index.docsById.values()).map((document) => ({
    id: document.id,
    title: document.title,
  }))
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify({
    version: THREAD_SEARCH_INDEX_CACHE_VERSION,
    documents,
  }), 'utf8')
}

export async function loadAllThreadsForSearch(
  listThreads: ThreadListRpc,
  sessionIndexCache: ThreadTitleCache,
): Promise<ThreadSearchDocument[]> {
  const threadsById = new Map<string, ThreadListRow>()

  for (const archived of [false, true]) {
    let cursor: string | null = null

    do {
      const response = asRecord(await listThreads({
        archived,
        limit: 100,
        sortKey: 'updated_at',
        cursor,
      }))
      const data = Array.isArray(response?.data) ? response.data : []
      for (const row of data) {
        const normalized = normalizeThreadSearchRow(row)
        if (!normalized || threadsById.has(normalized.id)) continue
        threadsById.set(normalized.id, normalized)
      }
      cursor = typeof response?.nextCursor === 'string' && response.nextCursor.length > 0 ? response.nextCursor : null
    } while (cursor)
  }

  for (const id of sessionIndexCache.order) {
    if (threadsById.has(id)) continue
    const title = sessionIndexCache.titles[id]?.trim() ?? ''
    if (!title) continue
    threadsById.set(id, { id, title, preview: '' })
  }

  return Array.from(threadsById.values()).map((thread) => createThreadSearchDocument(thread))
}

export async function buildThreadSearchIndex(
  listThreads: ThreadListRpc,
  sessionIndexCache: ThreadTitleCache,
): Promise<ThreadSearchIndex> {
  const docs = await loadAllThreadsForSearch(listThreads, sessionIndexCache)
  const docsById = new Map<string, ThreadSearchDocument>(docs.map((doc) => [doc.id, doc]))
  return { docsById }
}

function buildThreadSearchIndexFromTitleCache(sessionIndexCache: ThreadTitleCache): ThreadSearchIndex {
  const docsById = new Map<string, ThreadSearchDocument>()
  for (const id of sessionIndexCache.order) {
    const title = sessionIndexCache.titles[id]?.trim() ?? ''
    if (!id || !title || docsById.has(id)) continue
    docsById.set(id, createThreadSearchDocument({ id, title, preview: '' }))
  }
  return { docsById }
}

export function isExactPhraseMatch(query: string, doc: ThreadSearchDocument): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return doc.title.toLowerCase().includes(q)
}

export function searchThreadIndex(
  index: ThreadSearchIndex,
  query: string,
  limit: number,
): { threadIds: string[]; indexedThreadCount: number } {
  const normalizedLimit = Math.max(1, Math.min(1000, Math.floor(limit)))
  const threadIds = Array.from(index.docsById.entries())
    .filter(([, doc]) => isExactPhraseMatch(query, doc))
    .slice(0, normalizedLimit)
    .map(([id]) => id)

  return { threadIds, indexedThreadCount: index.docsById.size }
}

export class ThreadSearchIndexStore {
  private index: ThreadSearchIndex | null
  private indexPromise: Promise<ThreadSearchIndex> | null = null
  private refreshPromise: Promise<void> | null = null
  private stale: boolean
  private version = 0

  constructor(
    private readonly buildIndex: () => Promise<ThreadSearchIndex>,
    private readonly options: ThreadSearchIndexStoreOptions = {},
  ) {
    this.index = options.initialIndex ?? null
    this.stale = this.index !== null
  }

  clear(): void {
    // Keep in-flight work joined; its generation will stay stale and trigger one trailing refresh.
    this.stale = true
    this.version += 1
  }

  async search(
    query: string,
    limit: number,
  ): Promise<{ threadIds: string[]; indexedThreadCount: number; partial?: true }> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return { threadIds: [], indexedThreadCount: 0 }

    const index = await this.getIndex()
    const result = searchThreadIndex(index, normalizedQuery, limit)
    const partial = this.stale
    if (partial) this.refreshInBackground()
    return partial ? { ...result, partial: true } : result
  }

  private async getIndex(): Promise<ThreadSearchIndex> {
    if (this.index) return this.index

    if (!this.indexPromise) {
      const version = this.version
      const shouldRemainStale = Boolean(this.options.buildInitialIndex)
      const indexPromise = (this.options.buildInitialIndex ?? this.buildIndex)()
        .then((index) => {
          const isCurrent = this.version === version
          if (isCurrent || !this.index) {
            this.index = index
            this.stale = shouldRemainStale || !isCurrent
          }
          this.persistIndex(index)
          return index
        })
        .finally(() => {
          if (this.indexPromise === indexPromise) {
            this.indexPromise = null
          }
        })
      this.indexPromise = indexPromise
    }

    return this.indexPromise
  }

  private refreshInBackground(): void {
    if (this.refreshPromise) return
    const version = this.version
    const refreshPromise = this.buildIndex()
      .then((index) => {
        if (this.version !== version) {
          this.persistIndex(index)
          return
        }
        this.index = index
        this.stale = false
        this.persistIndex(index)
      })
      .catch((error) => {
        if (this.version === version) {
          logBridgeError('Background thread search index refresh failed', error)
        }
      })
      .finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null
        }
      })
    this.refreshPromise = refreshPromise
  }

  private persistIndex(index: ThreadSearchIndex): void {
    try {
      this.options.persistIndex?.(index)
    } catch (error) {
      logBridgeError('Thread search index cache persistence failed', error)
    }
  }
}

export function createThreadSearchIndexStore(
  dependencies: ThreadSearchIndexStoreDependencies,
): ThreadSearchIndexStore {
  const cachePath = dependencies.cachePath?.trim() ?? ''
  let cacheWrite = Promise.resolve()
  const persistIndex = cachePath
    ? (index: ThreadSearchIndex): void => {
        cacheWrite = cacheWrite
          .then(() => writeThreadSearchIndexCache(cachePath, index))
          .catch((error) => {
            logBridgeError('Thread search index cache persistence failed', error)
          })
      }
    : undefined

  return new ThreadSearchIndexStore(
    async () => buildThreadSearchIndex(
      dependencies.listThreads,
      await dependencies.readThreadTitlesFromSessionIndex(dependencies.getSessionIndexPath()),
    ),
    {
      initialIndex: cachePath ? readThreadSearchIndexCache(cachePath) : null,
      buildInitialIndex: async () => buildThreadSearchIndexFromTitleCache(
        await dependencies.readThreadTitlesFromSessionIndex(dependencies.getSessionIndexPath()),
      ),
      persistIndex,
    },
  )
}
