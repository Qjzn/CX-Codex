import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { logBridgeError } from './bridgeLog.js'
import { getWebThreadListCachePath } from './codexPaths.js'

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
type AppServerRpcCacheOptions = {
  threadListCachePath?: string
}
type PersistedThreadListCachePayload = {
  version?: number
  entries?: Array<{
    key?: unknown
    value?: unknown
    cachedAtMs?: unknown
  }>
}
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const APP_SERVER_THREAD_LIST_FRESH_CACHE_TTL_MS = 3 * 60_000
const APP_SERVER_THREAD_LIST_STALE_CACHE_TTL_MS = 20 * 60_000
const APP_SERVER_ARCHIVED_THREAD_LIST_STALE_CACHE_TTL_MS = 24 * 60 * 60_000
const APP_SERVER_THREAD_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 30_000
const APP_SERVER_MODEL_LIST_FRESH_CACHE_TTL_MS = 10 * 60_000
const APP_SERVER_MODEL_LIST_STALE_CACHE_TTL_MS = 60 * 60_000
const APP_SERVER_MODEL_LIST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 5 * 60_000

export function getShareableRpcKey(method: string, params: unknown): string | null {
  if (
    method !== 'thread/list'
    && method !== 'thread/read'
    && method !== 'model/list'
    && method !== 'plugin/list'
    && method !== 'mcpServerStatus/list'
  ) {
    return null
  }

  try {
    return `${method}:${stableJsonStringify(params ?? null)}`
  } catch {
    return null
  }
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value))
}

function toStableJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => toStableJsonValue(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol') continue
      normalized[key] = toStableJsonValue(item)
    }
    return normalized
  }
  return null
}

export function shouldInvalidateThreadListCacheForRpc(method: string): boolean {
  return (
    method === 'thread/start' ||
    method === 'thread/fork' ||
    method === 'thread/archive' ||
    method === 'thread/unarchive' ||
    method === 'thread/name/set' ||
    method === 'thread/metadata/update' ||
    method === 'thread/compact/start' ||
    method === 'thread/shellCommand' ||
    method === 'thread/inject_items'
  )
}

export function shouldInvalidateThreadListCacheForNotification(method: string): boolean {
  if (method === 'thread/name/updated') return true
  if (!method.startsWith('thread/')) return false
  return (
    method.endsWith('/created') ||
    method.endsWith('/archived') ||
    method.endsWith('/unarchived') ||
    method.endsWith('/deleted') ||
    method.endsWith('/removed') ||
    method.endsWith('/forked') ||
    method.endsWith('/moved')
  )
}

export function shouldInvalidateThreadReadCacheForRpc(method: string): boolean {
  return (
    method === 'turn/start' ||
    method === 'turn/interrupt' ||
    method === 'thread/resume' ||
    method === 'thread/rollback' ||
    method === 'thread/archive' ||
    method === 'thread/unarchive' ||
    method === 'thread/name/set' ||
    method === 'thread/metadata/update' ||
    method === 'thread/compact/start' ||
    method === 'thread/shellCommand' ||
    method === 'thread/approveGuardianDeniedAction' ||
    method === 'thread/inject_items' ||
    method === 'turn/steer'
  )
}

export function shouldInvalidateThreadReadCacheForNotification(method: string): boolean {
  if (
    method === 'thread/goal/updated' ||
    method === 'thread/goal/cleared' ||
    method === 'thread/compacted' ||
    method === 'turn/started' ||
    method === 'turn/start' ||
    method === 'turn/completed' ||
    method === 'turn/diff/updated' ||
    method === 'turn/plan/updated' ||
    method === 'thread/completed' ||
    method === 'turn/interrupted' ||
    method === 'thread/interrupted' ||
    method === 'error' ||
    method.endsWith('/failed')
  ) {
    return true
  }

  return (
    method === 'item/started' ||
    method === 'item/updated' ||
    method === 'item/completed' ||
    method === 'rawResponseItem/completed' ||
    method === 'item/agentMessage/delta' ||
    method === 'item/plan/delta' ||
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/summaryPartAdded' ||
    method === 'item/reasoning/textDelta' ||
    method === 'item/commandExecution/outputDelta' ||
    method === 'item/commandExecution/terminalInteraction' ||
    method === 'item/fileChange/outputDelta' ||
    method === 'item/fileChange/patchUpdated' ||
    method === 'item/mcpToolCall/progress' ||
    method === 'command/exec/outputDelta' ||
    method === 'process/outputDelta' ||
    method === 'process/exited'
  )
}

export class AppServerRpcCache {
  private readonly sharedReadRpcByKey = new Map<string, Promise<unknown>>()
  private readonly cachedThreadListRpcByKey = new Map<string, CachedRpcResponse>()
  private readonly cachedModelListRpcByKey = new Map<string, CachedRpcResponse>()
  private readonly threadListCachePath: string

  constructor(options: AppServerRpcCacheOptions = {}) {
    this.threadListCachePath = options.threadListCachePath ?? getWebThreadListCachePath()
    this.loadPersistedThreadListCache()
  }

  clearSharedReads(): void {
    this.sharedReadRpcByKey.clear()
  }

  clearThreadList(): void {
    this.cachedThreadListRpcByKey.clear()
    this.persistThreadListCache()
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
    const staleTtlMs = shareableKey.includes('"archived":true')
      ? APP_SERVER_ARCHIVED_THREAD_LIST_STALE_CACHE_TTL_MS
      : APP_SERVER_THREAD_LIST_STALE_CACHE_TTL_MS
    return readCachedRpc(
      this.cachedThreadListRpcByKey,
      shareableKey,
      APP_SERVER_THREAD_LIST_FRESH_CACHE_TTL_MS,
      staleTtlMs,
      allowStale,
    )
  }

  writeThreadList(shareableKey: string, value: unknown): void {
    writeCachedRpc(this.cachedThreadListRpcByKey, shareableKey, value)
    this.persistThreadListCache()
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

  executeShareableRead(method: string, params: unknown, shareableKey: string, enqueueRpc: EnqueueRpc): Promise<unknown> {
    const cached = this.readShareableCache(method, shareableKey)
    if (cached) {
      if (cached.stale) {
        const existingRefresh = method === 'thread/list' ? this.getSharedRead(shareableKey) : null
        if (existingRefresh) {
          return existingRefresh
        }
        this.refreshShareableCacheInBackground(method, shareableKey, params, enqueueRpc)
      }
      return Promise.resolve(cached.value)
    }

    const existingRequest = this.getSharedRead(shareableKey)
    if (existingRequest) {
      return existingRequest
    }

    const request = enqueueRpc(method, params)
      .then((value) => {
        this.writeShareableCache(method, shareableKey, value)
        return value
      })
      .finally(() => {
        this.deleteSharedRead(shareableKey)
      })
    this.setSharedRead(shareableKey, request)
    return request
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

  private readShareableCache(method: string, shareableKey: string): CachedRpcRead | null {
    if (method === 'thread/list') {
      return this.readThreadList(shareableKey, true)
    }
    if (method === 'model/list') {
      return this.readModelList(shareableKey, true)
    }
    return null
  }

  private writeShareableCache(method: string, shareableKey: string, value: unknown): void {
    if (method === 'thread/list') {
      this.writeThreadList(shareableKey, value)
    } else if (method === 'model/list') {
      this.writeModelList(shareableKey, value)
    }
  }

  private refreshShareableCacheInBackground(method: string, shareableKey: string, params: unknown, enqueueRpc: EnqueueRpc): void {
    if (method === 'thread/list') {
      this.refreshThreadListInBackground(shareableKey, params, enqueueRpc)
    } else if (method === 'model/list') {
      this.refreshModelListInBackground(shareableKey, params, enqueueRpc)
    }
  }

  private loadPersistedThreadListCache(): void {
    if (!this.threadListCachePath) return
    try {
      const payload = JSON.parse(readFileSync(this.threadListCachePath, 'utf8')) as PersistedThreadListCachePayload
      if (payload?.version !== 1 || !Array.isArray(payload.entries)) return
      for (const entry of payload.entries) {
        if (!entry || typeof entry.key !== 'string') continue
        if (typeof entry.cachedAtMs !== 'number' || !Number.isFinite(entry.cachedAtMs)) continue
        this.cachedThreadListRpcByKey.set(entry.key, {
          value: entry.value,
          cachedAtMs: entry.cachedAtMs,
          refreshStartedAtMs: 0,
        })
      }
    } catch {
      // Persistent list cache is only a startup accelerator; malformed or missing files are ignored.
    }
  }

  private persistThreadListCache(): void {
    if (!this.threadListCachePath) return
    try {
      const entries = Array.from(this.cachedThreadListRpcByKey.entries()).map(([key, entry]) => ({
        key,
        value: entry.value,
        cachedAtMs: entry.cachedAtMs,
      }))
      mkdirSync(dirname(this.threadListCachePath), { recursive: true })
      writeFileSync(this.threadListCachePath, JSON.stringify({ version: 1, entries }), 'utf8')
    } catch {
      // List caching must never break app-server RPC handling.
    }
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
