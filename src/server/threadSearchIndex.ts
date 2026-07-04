import type { ThreadTitleCache } from './threadTitleCache.js'

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
  listThreads: ThreadListRpc
  getSessionIndexPath: () => string
  readThreadTitlesFromSessionIndex: (sessionIndexPath: string) => Promise<ThreadTitleCache>
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
  private index: ThreadSearchIndex | null = null
  private indexPromise: Promise<ThreadSearchIndex> | null = null
  private version = 0

  constructor(private readonly buildIndex: () => Promise<ThreadSearchIndex>) {}

  clear(): void {
    this.index = null
    this.indexPromise = null
    this.version += 1
  }

  async search(query: string, limit: number): Promise<{ threadIds: string[]; indexedThreadCount: number }> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return { threadIds: [], indexedThreadCount: 0 }

    const index = await this.getIndex()
    return searchThreadIndex(index, normalizedQuery, limit)
  }

  private async getIndex(): Promise<ThreadSearchIndex> {
    if (this.index) return this.index

    if (!this.indexPromise) {
      const version = this.version
      this.indexPromise = this.buildIndex()
        .then((index) => {
          if (this.version === version) {
            this.index = index
          }
          return index
        })
        .finally(() => {
          if (this.version === version) {
            this.indexPromise = null
          }
        })
    }

    return this.indexPromise
  }
}

export function createThreadSearchIndexStore(
  dependencies: ThreadSearchIndexStoreDependencies,
): ThreadSearchIndexStore {
  return new ThreadSearchIndexStore(async () => buildThreadSearchIndex(
    dependencies.listThreads,
    await dependencies.readThreadTitlesFromSessionIndex(dependencies.getSessionIndexPath()),
  ))
}
