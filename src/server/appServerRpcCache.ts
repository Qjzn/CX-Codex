import { logBridgeError } from './bridgeLog.js'

type CachedRpcResponse = {
  value: unknown
  cachedAtMs: number
  refreshStartedAtMs: number
}

export type CachedRpcRead = {
  value: unknown
  stale: boolean
}

type EnqueueRpc = (method: string, params: unknown) => Promise<unknown>

const APP_SERVER_THREAD_LIST_FRESH_CACHE_TTL_MS = 3 * 60_000
const APP_SERVER_THREAD_LIST_STALE_CACHE_TTL_MS = 20 * 60_000
const APP_SERVER_THREAD_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 30_000
const APP_SERVER_MODEL_LIST_FRESH_CACHE_TTL_MS = 10 * 60_000
const APP_SERVER_MODEL_LIST_STALE_CACHE_TTL_MS = 60 * 60_000
const APP_SERVER_MODEL_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 5 * 60_000

export function getShareableRpcKey(method: string, params: unknown): string | null {
  if (method !== 'thread/list' && method !== 'thread/read' && method !== 'model/list') {
    return null
  }

  try {
    return `${method}:${JSON.stringify(params ?? null)}`
  } catch {
    return null
  }
}

export function shouldInvalidateThreadListCacheForRpc(method: string): boolean {
  return (
    method === 'thread/start' ||
    method === 'thread/fork' ||
    method === 'thread/archive' ||
    method === 'thread/name/set'
  )
}

export class AppServerRpcCache {
  private readonly sharedReadRpcByKey = new Map<string, Promise<unknown>>()
  private readonly cachedThreadListRpcByKey = new Map<string, CachedRpcResponse>()
  private readonly cachedModelListRpcByKey = new Map<string, CachedRpcResponse>()

  clearSharedReads(): void {
    this.sharedReadRpcByKey.clear()
  }

  clearThreadList(): void {
    this.cachedThreadListRpcByKey.clear()
  }

  getSharedRead(shareableKey: string): Promise<unknown> | null {
    return this.sharedReadRpcByKey.get(shareableKey) ?? null
  }

  setSharedRead(shareableKey: string, request: Promise<unknown>): void {
    this.sharedReadRpcByKey.set(shareableKey, request)
  }

  deleteSharedRead(shareableKey: string): void {
    this.sharedReadRpcByKey.delete(shareableKey)
  }

  readThreadList(shareableKey: string, allowStale = false): CachedRpcRead | null {
    return readCachedRpc(
      this.cachedThreadListRpcByKey,
      shareableKey,
      APP_SERVER_THREAD_LIST_FRESH_CACHE_TTL_MS,
      APP_SERVER_THREAD_LIST_STALE_CACHE_TTL_MS,
      allowStale,
    )
  }

  writeThreadList(shareableKey: string, value: unknown): void {
    writeCachedRpc(this.cachedThreadListRpcByKey, shareableKey, value)
  }

  readModelList(shareableKey: string, allowStale = false): CachedRpcRead | null {
    return readCachedRpc(
      this.cachedModelListRpcByKey,
      shareableKey,
      APP_SERVER_MODEL_LIST_FRESH_CACHE_TTL_MS,
      APP_SERVER_MODEL_LIST_STALE_CACHE_TTL_MS,
      allowStale,
    )
  }

  writeModelList(shareableKey: string, value: unknown): void {
    writeCachedRpc(this.cachedModelListRpcByKey, shareableKey, value, 4)
  }

  refreshThreadListInBackground(shareableKey: string, params: unknown, enqueueRpc: EnqueueRpc): void {
    if (this.sharedReadRpcByKey.has(shareableKey)) return

    const cached = this.cachedThreadListRpcByKey.get(shareableKey)
    const now = Date.now()
    if (
      cached?.refreshStartedAtMs &&
      now - cached.refreshStartedAtMs < APP_SERVER_THREAD_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS
    ) {
      return
    }
    if (cached) {
      cached.refreshStartedAtMs = now
    }

    const request = enqueueRpc('thread/list', params)
      .then((value) => {
        this.writeThreadList(shareableKey, value)
        return value
      })
      .catch((error) => {
        logBridgeError('Background thread/list refresh failed', error)
        const current = this.cachedThreadListRpcByKey.get(shareableKey)
        if (current) {
          current.refreshStartedAtMs = 0
        }
        return null
      })
      .finally(() => {
        this.sharedReadRpcByKey.delete(shareableKey)
      })

    this.sharedReadRpcByKey.set(shareableKey, request)
  }

  refreshModelListInBackground(shareableKey: string, params: unknown, enqueueRpc: EnqueueRpc): void {
    if (this.sharedReadRpcByKey.has(shareableKey)) return

    const cached = this.cachedModelListRpcByKey.get(shareableKey)
    const now = Date.now()
    if (
      cached?.refreshStartedAtMs &&
      now - cached.refreshStartedAtMs < APP_SERVER_MODEL_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS
    ) {
      return
    }
    if (cached) {
      cached.refreshStartedAtMs = now
    }

    const request = enqueueRpc('model/list', params)
      .then((value) => {
        this.writeModelList(shareableKey, value)
        return value
      })
      .catch((error) => {
        logBridgeError('Background model/list refresh failed', error)
        const current = this.cachedModelListRpcByKey.get(shareableKey)
        if (current) {
          current.refreshStartedAtMs = 0
        }
        return null
      })
      .finally(() => {
        this.sharedReadRpcByKey.delete(shareableKey)
      })

    this.sharedReadRpcByKey.set(shareableKey, request)
  }
}

function readCachedRpc(
  cache: Map<string, CachedRpcResponse>,
  shareableKey: string,
  ttlMs: number,
  staleTtlMs: number,
  allowStale = false,
): CachedRpcRead | null {
  const cached = cache.get(shareableKey)
  if (!cached) return null
  const ageMs = Date.now() - cached.cachedAtMs
  if (ageMs <= ttlMs) {
    return { value: cached.value, stale: false }
  }
  if (allowStale && ageMs <= staleTtlMs) {
    return { value: cached.value, stale: true }
  }
  if (ageMs > staleTtlMs) {
    cache.delete(shareableKey)
  }
  return null
}

function writeCachedRpc(cache: Map<string, CachedRpcResponse>, shareableKey: string, value: unknown, maxEntries = 20): void {
  cache.set(shareableKey, {
    value,
    cachedAtMs: Date.now(),
    refreshStartedAtMs: 0,
  })
  if (cache.size <= maxEntries) return
  const oldestKey = cache.keys().next().value
  if (typeof oldestKey === 'string') {
    cache.delete(oldestKey)
  }
}
