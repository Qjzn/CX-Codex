import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AppServerRpcQueue } from '../src/server/appServerRpcQueue.js'
import { AppServerRpcDiagnostics } from '../src/server/appServerRpcDiagnostics.js'
import { APP_SERVER_OVERLOADED_ERROR_CODE, createAppServerJsonRpcError } from '../src/server/appServerRpcErrors.js'

function diagnostics(): AppServerRpcDiagnostics {
  return new AppServerRpcDiagnostics({ isHeavyThreadRead: () => undefined }, {
    slowWarnMs: 60_000, queueWarnSize: 100, queueWarnIntervalMs: 60_000,
    timeoutRestartWindowMs: 60_000, timeoutRestartThreshold: 10,
  })
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('conversation reads can start while slow plugin and MCP metadata are still pending', async () => {
  const metadata = deferred()
  const started: string[] = []
  let active = 0
  let peakActive = 0
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 2, diagnostics: diagnostics(),
    execute: async (method) => {
      started.push(method)
      active += 1
      peakActive = Math.max(peakActive, active)
      try {
        if (method !== 'thread/read') await metadata.promise
        return { method }
      } finally { active -= 1 }
    },
  })
  const requests = [queue.enqueue('plugin/list', {}), queue.enqueue('mcpServerStatus/list', {})]
  requests.push(queue.enqueue('thread/read', { threadId: 'foreground', includeTurns: true }))
  try {
    assert.ok(started.includes('thread/read'), 'a visible conversation must not wait for both unrelated metadata calls')
    assert.equal(started.filter((method) => method !== 'thread/read').length, 1)
    assert.ok(peakActive <= 2, 'foreground reservation must not raise total queued RPC concurrency')
  } finally {
    metadata.resolve()
    await Promise.allSettled(requests)
  }
})

test('pending metadata receives a turn even when conversation reads keep arriving', async () => {
  const firstMetadata = deferred()
  const reads = deferred()
  const started: string[] = []
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 2, diagnostics: diagnostics(),
    execute: async (method, params) => {
      const key = (params as { key: string }).key
      started.push(key)
      if (key === 'catalog-first') await firstMetadata.promise
      if (method === 'thread/read') await reads.promise
      return key
    },
  })
  const requests = [queue.enqueue('plugin/list', { key: 'catalog-first' })]
  for (let index = 0; index < 8; index += 1) {
    requests.push(queue.enqueue('thread/read', { key: `read-${index}` }))
  }
  requests.push(queue.enqueue('mcpServerStatus/list', { key: 'catalog-next' }))
  firstMetadata.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  reads.resolve()
  await Promise.all(requests)
  assert.ok(started.indexOf('catalog-next') <= 3, 'metadata progresses after a bounded foreground burst, not after the entire read backlog')
  assert.deepEqual(started.filter((key) => key.startsWith('read-')), Array.from({ length: 8 }, (_, index) => `read-${index}`), 'equal-priority reads remain FIFO')
})

test('a single-slot queue remains usable and equal-priority metadata remains FIFO', async () => {
  const started: number[] = []
  let active = 0
  let peakActive = 0
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 1, diagnostics: diagnostics(),
    execute: async (_method, params) => {
      active += 1
      peakActive = Math.max(peakActive, active)
      started.push((params as { index: number }).index)
      await Promise.resolve()
      active -= 1
      return params
    },
  })
  await Promise.all(Array.from({ length: 12 }, (_, index) => queue.enqueue('plugin/list', { index })))
  assert.equal(peakActive, 1)
  assert.deepEqual(started, Array.from({ length: 12 }, (_, index) => index))
  assert.equal(queue.count, 0)
})

test('urgent send and interrupt precede metadata even when the foreground fairness budget is exhausted', async () => {
  const blocked = deferred()
  const started: string[] = []
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 1, diagnostics: diagnostics(),
    execute: async (method, params) => {
      const key = (params as { key?: string }).key ?? method
      started.push(key)
      if (key === 'read-blocked') await blocked.promise
      return key
    },
  })
  await queue.enqueue('thread/read', { key: 'read-first' })
  await queue.enqueue('thread/read', { key: 'read-second' })
  const requests = [queue.enqueue('thread/read', { key: 'read-blocked' })]
  await new Promise<void>((resolve) => setImmediate(resolve))
  requests.push(queue.enqueue('plugin/list', {}))
  requests.push(queue.enqueue('turn/start', {}))
  requests.push(queue.enqueue('turn/interrupt', {}))
  blocked.resolve()
  await Promise.all(requests)
  assert.deepEqual(started.slice(3), ['turn/start', 'turn/interrupt', 'plugin/list'])
})

test('metadata failures release the reserved background slot without blocking later reads or catalogs', async () => {
  const state = diagnostics()
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 2, diagnostics: state,
    execute: async (method) => {
      if (method === 'plugin/list') throw new Error('metadata unavailable')
      return method
    },
  })
  const failed = assert.rejects(queue.enqueue('plugin/list', {}), /metadata unavailable/)
  const read = queue.enqueue('thread/read', {})
  const catalog = queue.enqueue('mcpServerStatus/list', {})
  await failed
  assert.equal(await read, 'thread/read')
  assert.equal(await catalog, 'mcpServerStatus/list')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(state.activeCount, 0)
  assert.equal(queue.count, 0)
  assert.equal(await queue.enqueue('skills/list', {}), 'skills/list')
})

test('metadata overload retries do not consume the foreground slot or leak capacity after exhaustion', async () => {
  let attempts = 0
  const started: string[] = []
  const queue = new AppServerRpcQueue({
    maxSize: 60, maxInFlight: 2, diagnostics: diagnostics(),
    overloadRetry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0 },
    execute: async (method) => {
      started.push(method)
      if (method === 'plugin/list') {
        attempts += 1
        throw createAppServerJsonRpcError({ code: APP_SERVER_OVERLOADED_ERROR_CODE, message: 'Server overloaded' })
      }
      return method
    },
  })
  const exhausted = assert.rejects(queue.enqueue('plugin/list', {}), /Server overloaded/)
  const read = queue.enqueue('thread/read', {})
  const catalog = queue.enqueue('mcpServerStatus/list', {})
  assert.ok(started.includes('thread/read'), 'overload backoff stays within its background lane')
  assert.equal(await read, 'thread/read')
  await exhausted
  assert.equal(attempts, 3)
  assert.equal(await catalog, 'mcpServerStatus/list')
  assert.equal(queue.count, 0)
})
