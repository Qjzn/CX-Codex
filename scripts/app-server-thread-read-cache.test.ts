import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_SERVER_THREAD_READ_CACHE_LIMIT,
  AppServerThreadReadCacheStore,
} from '../src/server/appServerThreadReadCache.js'

const LIMIT = APP_SERVER_THREAD_READ_CACHE_LIMIT

function payload(id: string) {
  return {
    thread: {
      id,
      inProgress: true,
      activeTurnId: `turn-${id}`,
      updatedAt: 1_700_000_000,
      path: `/synthetic/sessions/${id}.jsonl`,
      turns: [{ id: `turn-${id}`, status: 'inProgress', items: [] }],
    },
  }
}

function fill(store: AppServerThreadReadCacheStore, count = LIMIT): void {
  for (let i = 0; i < count; i += 1) store.remember(`thread-${i}`, payload(`thread-${i}`))
}

test('opening 1000 threads retains only the latest 64 rebuildable copies', () => {
  assert.equal(LIMIT, 64)
  const store = new AppServerThreadReadCacheStore()
  fill(store, 1000)
  assert.equal(store.count, LIMIT)
  assert.equal(store.get('thread-935'), null)
  for (let i = 936; i < 1000; i += 1) assert.ok(store.get(`thread-${i}`))
})

test('reading a cached thread protects it from the next eviction', () => {
  const store = new AppServerThreadReadCacheStore()
  fill(store)
  const original = store.get('thread-0')
  store.remember('new', payload('new'))
  assert.strictEqual(store.get('thread-0'), original)
  assert.equal(store.get('thread-1'), null)
  assert.equal(store.count, LIMIT)
})

test('overwriting a thread replaces its payload and refreshes recency', () => {
  const store = new AppServerThreadReadCacheStore()
  fill(store)
  const replacement = payload('replacement')
  const updated = store.remember('thread-0', replacement, 'session-log')
  store.remember('new', payload('new'))
  assert.equal(store.get('thread-1'), null)
  assert.strictEqual(store.get('thread-0'), updated)
  assert.strictEqual(updated.threadRead, replacement)
  assert.equal(updated.source, 'session-log')
  assert.equal(store.count, LIMIT)
})

test('cache hits preserve the existing payload and metadata', () => {
  const store = new AppServerThreadReadCacheStore()
  const threadRead = payload('metadata')
  const cached = store.remember('metadata', threadRead, 'session-log')
  assert.strictEqual(cached.threadRead, threadRead)
  assert.equal(cached.inProgress, true)
  assert.equal(cached.activeTurnId, 'turn-metadata')
  assert.equal(cached.updatedAtIso, '2023-11-14T22:13:20.000Z')
  assert.equal(cached.sessionPath, '/synthetic/sessions/metadata.jsonl')
  assert.equal(cached.source, 'session-log')
  assert.ok(Number.isFinite(Date.parse(cached.cachedAtIso)))
  assert.strictEqual(store.get('metadata'), cached)
  assert.strictEqual(store.get('metadata'), cached)
  assert.equal(store.get('missing'), null)
})

test('deletion and clearing retain their existing semantics', () => {
  const store = new AppServerThreadReadCacheStore()
  fill(store)
  assert.equal(store.delete('thread-0'), true)
  assert.equal(store.delete('thread-0'), false)
  assert.equal(store.count, LIMIT - 1)
  assert.equal(store.get('thread-0'), null)
  store.clear()
  assert.equal(store.count, 0)
  assert.equal(store.get('thread-1'), null)
})

test('an evicted or cleared thread can be rebuilt from an external payload', () => {
  const sourcePayload = payload('thread-0')
  const store = new AppServerThreadReadCacheStore()
  store.remember('thread-0', sourcePayload)
  for (let i = 1; i <= LIMIT; i += 1) store.remember(`thread-${i}`, payload(`thread-${i}`))
  assert.equal(store.get('thread-0'), null)
  store.remember('thread-0', sourcePayload)
  assert.strictEqual(store.get('thread-0')?.threadRead, sourcePayload)
  store.clear()
  const restartedCache = new AppServerThreadReadCacheStore()
  restartedCache.remember('thread-0', sourcePayload)
  assert.strictEqual(restartedCache.get('thread-0')?.threadRead, sourcePayload)
  assert.equal(sourcePayload.thread.id, 'thread-0')
})
