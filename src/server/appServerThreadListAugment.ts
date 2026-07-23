import { readThreadSessionPathFromThreadReadPayload } from './appServerThreadPayload.js'

export const SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS = 5 * 60_000
export const SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS = 20
export const SUPPLEMENTAL_THREAD_SUMMARY_MAX_OUTPUT = 20
export const SUPPLEMENTAL_THREAD_SUMMARY_MAX_CACHE_ENTRIES = 100
export const SUPPLEMENTAL_THREAD_SUMMARY_BUDGET_MS = 1_200
export const SUPPLEMENTAL_THREAD_SUMMARY_READ_TIMEOUT_MS = 600

type ThreadListAugmentOptions = {
  params: unknown
  result: unknown
  readSupplementalThreadIds: () => Promise<string[]>
  readThreadById: (threadId: string) => Promise<unknown>
}

export type AppServerThreadListRpcResultAugmenterDependencies = {
  augmenter: AppServerThreadListAugmenter
  readSupplementalThreadIds: () => Promise<string[]>
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
  maxOutput?: number
  maxCacheEntries?: number
  budgetMs?: number
  readTimeoutMs?: number
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
  private readonly maxOutput: number
  private readonly maxCacheEntries: number
  private readonly budgetMs: number
  private readonly readTimeoutMs: number
  private readonly nowMs: () => number

  constructor(options: AppServerThreadListAugmenterOptions = {}) {
    this.ttlMs = options.ttlMs ?? SUPPLEMENTAL_THREAD_SUMMARY_CACHE_TTL_MS
    this.maxReads = options.maxReads ?? SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS
    this.maxOutput = options.maxOutput ?? SUPPLEMENTAL_THREAD_SUMMARY_MAX_OUTPUT
    this.maxCacheEntries = options.maxCacheEntries ?? SUPPLEMENTAL_THREAD_SUMMARY_MAX_CACHE_ENTRIES
    this.budgetMs = options.budgetMs ?? SUPPLEMENTAL_THREAD_SUMMARY_BUDGET_MS
    this.readTimeoutMs = options.readTimeoutMs ?? SUPPLEMENTAL_THREAD_SUMMARY_READ_TIMEOUT_MS
    this.nowMs = options.nowMs ?? (() => Date.now())
  }

  async augmentThreadListRpcResult(options: ThreadListAugmentOptions): Promise<unknown> {
    const paramsRecord = asRecord(options.params)
    if (paramsRecord?.archived === true) return options.result
    if (typeof paramsRecord?.cursor === 'string' && paramsRecord.cursor.length > 0) return options.result

    const resultRecord = asRecord(options.result)
    const data = Array.isArray(resultRecord?.data) ? resultRecord.data : null
    if (!data) return options.result

    const supplementalThreadIds = await options.readSupplementalThreadIds()
    if (supplementalThreadIds.length === 0) return options.result

    const existingThreadIds = new Set<string>()
    for (const row of data) {
      const record = asRecord(row)
      const id = typeof record?.id === 'string' ? record.id : ''
      if (id) existingThreadIds.add(id)
    }

    const supplementalThreads = await this.loadThreadSummariesById(
      supplementalThreadIds,
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
    const startedAtMs = this.nowMs()
    let uncachedReadCount = 0

    for (const rawThreadId of threadIds) {
      if (summaries.length >= this.maxOutput) break
      if (this.nowMs() - startedAtMs >= this.budgetMs) break
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

      const remainingBudgetMs = Math.max(0, this.budgetMs - (this.nowMs() - startedAtMs))
      const readResult = await this.readThreadSummaryWithinBudget(
        threadId,
        readThreadById,
        Math.min(this.readTimeoutMs, remainingBudgetMs),
      )
      if (readResult.timedOut) break
      if (readResult.value) summaries.push(readResult.value)
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

  private async readThreadSummaryWithinBudget(
    threadId: string,
    readThreadById: (threadId: string) => Promise<unknown>,
    timeoutMs: number,
  ): Promise<{ value: unknown | null; timedOut: boolean }> {
    if (timeoutMs <= 0) return { value: null, timedOut: true }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<{ value: null; timedOut: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ value: null, timedOut: true }), timeoutMs)
    })

    const read = Promise.resolve()
      .then(() => readThreadById(threadId))
      .then((response) => {
        const thread = this.cacheThreadSummaryResponse(threadId, response)
        return { value: thread, timedOut: false as const }
      })
      .catch(() => {
        this.cacheByThreadId.set(threadId, {
          value: null,
          cachedAtMs: this.nowMs(),
          failed: true,
        })
        // Keep desktop/index parity best-effort; a missing historical thread must not break the list.
        return { value: null, timedOut: false as const }
      })

    const result = await Promise.race([read, timeout])
    if (timeoutId !== null) clearTimeout(timeoutId)
    return result
  }

  private cacheThreadSummaryResponse(threadId: string, response: unknown): unknown | null {
    const responseRecord = asRecord(response)
    const thread = asRecord(responseRecord?.thread)
    const sessionPath = readThreadSessionPathFromThreadReadPayload(response)
    const isArchived = sessionPath
      .replace(/\\/g, '/')
      .split('/')
      .some((segment) => segment.toLowerCase() === 'archived_sessions')
    if (thread?.id === threadId && !isArchived) {
      this.cacheByThreadId.set(threadId, {
        value: thread,
        cachedAtMs: this.nowMs(),
      })
      return thread
    }

    this.cacheByThreadId.set(threadId, {
      value: null,
      cachedAtMs: this.nowMs(),
      failed: true,
    })
    return null
  }
}

export function createAppServerThreadListRpcResultAugmenter(
  dependencies: AppServerThreadListRpcResultAugmenterDependencies,
): (params: unknown, result: unknown) => Promise<unknown> {
  return async (params, result) => await dependencies.augmenter.augmentThreadListRpcResult({
    params,
    result,
    readSupplementalThreadIds: dependencies.readSupplementalThreadIds,
    readThreadById: (threadId) => dependencies.rpc('thread/read', {
      threadId,
      includeTurns: false,
    }),
  })
}
