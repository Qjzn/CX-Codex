export const SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS = 5 * 60_000
export const SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS = 20
export const SUPPLEMENTAL_THREAD_SUMMARY_MAX_CACHE_ENTRIES = 100

type ThreadListAugmentOptions = {
  params: unknown
  result: unknown
  readPinnedThreadIds: () => Promise<string[]>
  readThreadById: (threadId: string) => Promise<unknown>
}

export type AppServerThreadListRpcResultAugmenterDependencies = {
  augmenter: AppServerThreadListAugmenter
  readPinnedThreadIds: () => Promise<string[]>
  rpc(method: string, params: unknown): Promise<unknown>
}

type SupplementalThreadSummaryCacheEntry = {
  value: unknown | null
  cachedAtMs: number
  failed?: boolean
}

type AppServerThreadListAugmenterOptions = {
  ttlMs?: number
  maxReads?: number
  maxCacheEntries?: number
  nowMs?: () => number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export class AppServerThreadListAugmenter {
  private readonly cacheByThreadId = new Map<string, SupplementalThreadSummaryCacheEntry>()
  private readonly ttlMs: number
  private readonly maxReads: number
  private readonly maxCacheEntries: number
  private readonly nowMs: () => number

  constructor(options: AppServerThreadListAugmenterOptions = {}) {
    this.ttlMs = options.ttlMs ?? SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS
    this.maxReads = options.maxReads ?? SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS
    this.maxCacheEntries = options.maxCacheEntries ?? SUPPLEMENTAL_THREAD_SUMMARY_MAX_CACHE_ENTRIES
    this.nowMs = options.nowMs ?? (() => Date.now())
  }

  async augmentThreadListRpcResult(options: ThreadListAugmentOptions): Promise<unknown> {
    const paramsRecord = asRecord(options.params)
    if (paramsRecord?.archived !== true) return options.result
    if (typeof paramsRecord?.cursor === 'string' && paramsRecord.cursor.length > 0) return options.result

    const resultRecord = asRecord(options.result)
    const data = Array.isArray(resultRecord?.data) ? resultRecord.data : null
    if (!data) return options.result

    const pinnedThreadIds = await options.readPinnedThreadIds()
    if (pinnedThreadIds.length === 0) return options.result

    const existingThreadIds = new Set<string>()
    for (const row of data) {
      const record = asRecord(row)
      const id = typeof record?.id === 'string' ? record.id : ''
      if (id) existingThreadIds.add(id)
    }

    const supplementalThreads = await this.loadThreadSummariesById(
      pinnedThreadIds,
      existingThreadIds,
      options.readThreadById,
    )
    if (supplementalThreads.length === 0) return options.result

    return {
      ...resultRecord,
      data: [...data, ...supplementalThreads],
    }
  }

  async loadThreadSummariesById(
    threadIds: string[],
    excludedThreadIds: Set<string>,
    readThreadById: (threadId: string) => Promise<unknown>,
  ): Promise<unknown[]> {
    const summaries: unknown[] = []
    const seen = new Set<string>(excludedThreadIds)
    let uncachedReadCount = 0

    for (const rawThreadId of threadIds) {
      const threadId = rawThreadId.trim()
      if (!threadId || seen.has(threadId)) continue
      seen.add(threadId)

      const cached = this.cacheByThreadId.get(threadId)
      if (cached && this.nowMs() - cached.cachedAtMs <= this.ttlMs) {
        if (!cached.failed && cached.value) {
          summaries.push(cached.value)
        }
        continue
      }

      if (uncachedReadCount >= this.maxReads) continue
      uncachedReadCount += 1

      try {
        const response = asRecord(await readThreadById(threadId))
        const thread = asRecord(response?.thread)
        if (thread?.id === threadId) {
          this.cacheByThreadId.set(threadId, {
            value: thread,
            cachedAtMs: this.nowMs(),
          })
          summaries.push(thread)
        } else {
          this.cacheByThreadId.set(threadId, {
            value: null,
            cachedAtMs: this.nowMs(),
            failed: true,
          })
        }
      } catch {
        this.cacheByThreadId.set(threadId, {
          value: null,
          cachedAtMs: this.nowMs(),
          failed: true,
        })
        // Keep desktop/index parity best-effort; a missing historical thread must not break the list.
      }
    }

    this.trimCache()
    return summaries
  }

  private trimCache(): void {
    if (this.cacheByThreadId.size <= this.maxCacheEntries) return
    const overflow = this.cacheByThreadId.size - this.maxCacheEntries
    for (const key of Array.from(this.cacheByThreadId.keys()).slice(0, overflow)) {
      this.cacheByThreadId.delete(key)
    }
  }
}

export function createAppServerThreadListRpcResultAugmenter(
  dependencies: AppServerThreadListRpcResultAugmenterDependencies,
): (params: unknown, result: unknown) => Promise<unknown> {
  return async (params, result) => await dependencies.augmenter.augmentThreadListRpcResult({
    params,
    result,
    readPinnedThreadIds: dependencies.readPinnedThreadIds,
    readThreadById: (threadId) => dependencies.rpc('thread/read', {
      threadId,
      includeTurns: false,
    }),
  })
}
