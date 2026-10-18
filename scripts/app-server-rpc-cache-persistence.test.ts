import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { AppServerRpcCache } from '../src/server/appServerRpcCache.js'

const outputBase = join(process.cwd(), 'output', 'rpc-cache-persistence-tests')
mkdirSync(outputBase, { recursive: true })
const output = mkdtempSync(join(outputBase, 'rpc-cache-'))
const key = 'thread/list:{}'
const fixture = (id: string) => ({ data: [{ id, title: id }], nextCursor: null })
const disk = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

test('a burst invalidates memory immediately but serializes the latest cache only once', async () => {
  const path = join(output, 'burst.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  let serializations = 0
  cache.writeThreadList(key, { ...fixture('retained'), toJSON() { serializations++; return fixture('retained') } })
  for (let index = 0; index < 20; index++) cache.invalidateThreadList()
  assert.equal(cache.readThreadList(key), null, 'invalidation must remain synchronous')
  assert.equal(cache.readThreadList(key, true)?.stale, true)
  const beforeWait = serializations
  await cache.waitForPendingThreadListCacheWrites()
  assert.equal(beforeWait, 0, 'serialization must wait until the coalesced flush')
  assert.equal(serializations, 1, '21 dirty notifications should serialize one current snapshot')
  assert.equal(disk(path).entries[0].invalidated, true)
  assert.equal(new AppServerRpcCache({ threadListCachePath: path }).readThreadList(key, true)?.stale, true)
})

test('the first flush snapshots mutations made later in the same synchronous burst', async () => {
  const path = join(output, 'latest.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  let supersededSerializations = 0
  cache.writeThreadList(key, { ...fixture('old'), toJSON() { supersededSerializations++; return fixture('old') } })
  cache.writeThreadList(key, fixture('latest'))
  await cache.waitForPendingThreadListCacheWrites()
  assert.equal(supersededSerializations, 0)
  assert.deepEqual(disk(path).entries[0].value, fixture('latest'))
})

test('mutations while the writer yields are drained before shutdown wait resolves', async () => {
  const path = join(output, 'during-write.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  let firstSnapshotCount = 0
  cache.writeThreadList(key, {
    ...fixture('before-yield'),
    toJSON() {
      firstSnapshotCount++
      queueMicrotask(() => cache.writeThreadList(key, fixture('after-yield')))
      return fixture('before-yield')
    },
  })
  await cache.waitForPendingThreadListCacheWrites()
  assert.equal(firstSnapshotCount, 1)
  assert.deepEqual(disk(path).entries[0].value, fixture('after-yield'))
  assert.deepEqual(new AppServerRpcCache({ threadListCachePath: path }).readThreadList(key)?.value, fixture('after-yield'))
})

test('an RPC accepted before invalidation cannot repopulate the new generation', async () => {
  const path = join(output, 'generation.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  let resolveOld!: (value: unknown) => void
  const oldResult = new Promise<unknown>(resolve => { resolveOld = resolve })
  const read = cache.executeShareableRead('thread/list', {}, key, () => oldResult)
  cache.invalidateThreadList()
  cache.writeThreadList(key, fixture('current-generation'))
  resolveOld(fixture('old-generation'))
  await read
  await cache.waitForPendingThreadListCacheWrites()
  assert.deepEqual(cache.readThreadList(key)?.value, fixture('current-generation'))
  assert.deepEqual(disk(path).entries[0].value, fixture('current-generation'))
})

test('clear is immediately visible and flush leaves no startup entries', async () => {
  const path = join(output, 'clear.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  cache.writeThreadList(key, fixture('removed'))
  await cache.waitForPendingThreadListCacheWrites()
  cache.clearThreadList()
  assert.equal(cache.readThreadList(key, true), null)
  await cache.waitForPendingThreadListCacheWrites()
  assert.deepEqual(disk(path).entries, [])
  assert.equal(new AppServerRpcCache({ threadListCachePath: path }).readThreadList(key, true), null)
})

test('serialization failure neither rejects flush nor prevents a later successful flush', async () => {
  const path = join(output, 'serialization-failure.json')
  const cache = new AppServerRpcCache({ threadListCachePath: path })
  assert.doesNotThrow(() => cache.writeThreadList(key, { ...fixture('bad'), toJSON() { throw new Error('synthetic serialization failure') } }))
  await cache.waitForPendingThreadListCacheWrites()
  cache.writeThreadList(key, fixture('recovered'))
  await cache.waitForPendingThreadListCacheWrites()
  assert.deepEqual(disk(path).entries[0].value, fixture('recovered'))
})

test('a disk failure is contained and memory still returns the current list', async () => {
  const blockedParent = join(output, 'parent-is-file')
  writeFileSync(blockedParent, 'synthetic blocker')
  const cache = new AppServerRpcCache({ threadListCachePath: join(blockedParent, 'cache.json') })
  cache.writeThreadList(key, fixture('memory-survives'))
  await cache.waitForPendingThreadListCacheWrites()
  assert.deepEqual(cache.readThreadList(key)?.value, fixture('memory-survives'))
})

test('disabled disk caching never serializes a memory-only value', async () => {
  const cache = new AppServerRpcCache({ threadListCachePath: '' })
  let serializations = 0
  cache.writeThreadList(key, { ...fixture('memory-only'), toJSON() { serializations++; return fixture('memory-only') } })
  await cache.waitForPendingThreadListCacheWrites()
  assert.equal(serializations, 0)
  assert.ok(cache.readThreadList(key))
})
