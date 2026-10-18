import { readThreadSessionPathFromThreadReadPayload } from './appServerThreadPayload.js'
import { isThreadVisibleInOrdinaryList } from '../shared/threadVisibility.js'

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

function deduplicateThreadRowsById(data: unknown[]): unknown[] {
  const seenThreadIds = new Set<string>()
  const deduplicated: unknown[] = []

  for (const row of data) {
    const record = asRecord(row)
    const threadId = typeof record?.id === 'string' ? record.id.trim() : ''
    if (threadId && seenThreadIds.has(threadId)) continue
    if (threadId) seenThreadIds.add(threadId)
    deduplicated.push(row)
  }

  return deduplicated.length === data.length ? data : deduplicated
}

/**
 * The default normal list: `sourceKinds` omitted or empty. Any non-empty `sourceKinds` is an
 * explicit diagnostics / sub-agent query and keeps its own contract.
 */
function isOrdinaryThreadListParams(params: Record<string, unknown> | null): boolean {
  const sourceKinds = params?.sourceKinds
  if (sourceKinds === undefined) return true
  return Array.isArray(sourceKinds) && sourceKinds.length === 0
}

/** Returns the same array when nothing had to be removed, so result identity stays intact. */
function filterOrdinaryListRows(data: unknown[]): unknown[] {
  let removed = false
  const visibleRows: unknown[] = []
  for (const row of data) {
    if (isThreadVisibleInOrdinaryList(row)) {
      visibleRows.push(row)
      continue
    }
    removed = true
  }
  return removed ? visibleRows : data
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

  delete(threadId: string): boolean {
    return this.cacheByThreadId.delete(threadId)
  }

  clear(): void {
    this.cacheByThreadId.clear()
  }

  async augmentThreadListRpcResult(options: ThreadListAugmentOptions): Promise<unknown> {
    const resultRecord = asRecord(options.result)
    const data = Array.isArray(resultRecord?.data) ? resultRecord.data : null
    if (!data) return options.result

    // Codex can expose different session files with the same thread id. The web
    // client keys pagination and selection by thread id, so keep the first
    // (highest-ranked) row and make every thread/list page stable before adding
    // local session-index supplements.
    const deduplicatedData = deduplicateThreadRowsById(data)
    const normalizedResult = deduplicatedData === data
      ? options.result
      : { ...resultRecord, data: deduplicatedData }

    const paramsRecord = asRecord(options.params)
    // The default normal list hides structured internal work threads, and archived / cursor pages
    // are still pages of that list, so they are filtered too. Those pages never take local
    // supplements and never trigger a thread/read.
    const ordinaryList = isOrdinaryThreadListParams(paramsRecord)
    const visibleData = ordinaryList ? filterOrdinaryListRows(deduplicatedData) : deduplicatedData
    const visibleResult = visibleData === deduplicatedData
      ? normalizedResult
      : { ...resultRecord, data: visibleData }

    if (paramsRecord?.archived === true) return visibleResult
    if (typeof paramsRecord?.cursor === 'string' && paramsRecord.cursor.length > 0) return visibleResult

    const supplementalThreadIds = await options.readSupplementalThreadIds()
    if (supplementalThreadIds.length === 0) return visibleResult

    const existingThreadIds = new Set<string>()
    for (const row of deduplicatedData) {
      const record = asRecord(row)
      const id = typeof record?.id === 'string' ? record.id : ''
      if (id) existingThreadIds.add(id)
    }

    const supplementalThreads = await this.loadThreadSummariesById(
      supplementalThreadIds,
      existingThreadIds,
      options.readThreadById,
      ordinaryList,
    )
    if (supplementalThreads.length === 0) return visibleResult

    const appendedThreadIds = supplementalThreads
      .map((thread) => {
        const id = asRecord(thread)?.id
        return typeof id === 'string' ? id.trim() : ''
      })
      .filter(Boolean)

    return {
      ...resultRecord,
      data: [...visibleData, ...supplementalThreads],
      supplementalThreadIds: appendedThreadIds,
    }
  }

  /**
   * `visibleOnly` is true for the default normal list and false for explicit diagnostics queries.
   * Hidden rows are dropped before they occupy a visible output slot, so a cached internal row can
   * never starve a later visible cached pin, while the raw summary stays in the bounded cache and
   * the read / budget / timeout accounting is untouched.
   */
  async loadThreadSummariesById(
    threadIds: string[],
    excludedThreadIds: Set<string>,
    readThreadById: (threadId: string) => Promise<unknown>,
    visibleOnly = false,
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
        if (!cached.failed && cached.value && (!visibleOnly || isThreadVisibleInOrdinaryList(cached.value))) {
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
      if (readResult.value && (!visibleOnly || isThreadVisibleInOrdinaryList(readResult.value))) {
        summaries.push(readResult.value)
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
