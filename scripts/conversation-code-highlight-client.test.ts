import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_HIGHLIGHT_CHARACTERS } from '../src/components/content/conversationCodeHighlight.js'
import { requestCodeHighlight } from '../src/components/content/conversationCodeHighlightClient.js'

type Request = { id: number; code: string; language: string }

class FakeWorker {
  static instances: FakeWorker[] = []
  readonly requests: Request[] = []
  terminated = false
  onmessage: ((event: { data: { id: number; html: unknown } }) => void) | null = null
  onerror: ((event: { preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(readonly url: URL, readonly options: { type: string }) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: Request): void { this.requests.push(request) }
  terminate(): void { this.terminated = true }
  reply(id: number, html: unknown): void { this.onmessage?.({ data: { id, html } }) }
}

// The client intentionally owns a page-wide worker and terminal failure state.
// Keep its lifecycle in one sequential suite rather than add production reset APIs.
test('code highlight client is serial, bounded, cancellable and optional', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
    else Reflect.deleteProperty(globalThis, 'Worker')
  })

  const currentWorker = () => FakeWorker.instances.at(-1)!
  const highlight = (code: string, controller = new AbortController()) => requestCodeHighlight(code, 'ts', controller.signal)

  await t.test('empty, unknown, oversized and pre-aborted input never starts a worker', async () => {
    const aborted = new AbortController()
    aborted.abort()
    assert.equal(await highlight(''), null)
    assert.equal(await requestCodeHighlight('hello', 'unrecognized', new AbortController().signal), null)
    assert.equal(await highlight('a'.repeat(MAX_HIGHLIGHT_CHARACTERS + 1)), null)
    assert.equal(await highlight('const value = 1', aborted), null)
    assert.equal(FakeWorker.instances.length, 0)
  })

  await t.test('one worker processes FIFO jobs and ignores responses for other IDs', async () => {
    const first = highlight('const first = 1')
    const second = highlight('const second = 2')
    const third = highlight('const third = 3')
    const worker = currentWorker()
    assert.equal(FakeWorker.instances.length, 1)
    assert.equal(worker.options.type, 'module')
    assert.match(worker.url.pathname, /conversationCodeHighlight\.worker\.ts$/u)
    assert.equal(worker.requests.length, 1)
    assert.equal(worker.requests[0]!.language, 'typescript')
    worker.reply(worker.requests[0]!.id + 999, '<span>wrong job</span>')
    assert.equal(worker.requests.length, 1)
    worker.reply(worker.requests[0]!.id, '<span>first</span>')
    assert.equal(await first, '<span>first</span>')
    assert.equal(worker.requests[1]!.code, 'const second = 2')
    worker.reply(worker.requests[1]!.id, 123)
    assert.equal(await second, null)
    assert.equal(worker.requests[2]!.code, 'const third = 3')
    worker.reply(worker.requests[2]!.id, '<span>third</span>')
    assert.equal(await third, '<span>third</span>')
    assert.equal(new Set(worker.requests.map(({ id }) => id)).size, 3)
  })

  await t.test('queued cancellation settles immediately and never reaches the worker', async () => {
    const worker = currentWorker()
    const before = worker.requests.length
    const active = highlight('const active = 1')
    const controller = new AbortController()
    const cancelled = highlight('const cancelled = 2', controller)
    const next = highlight('const next = 3')
    controller.abort()
    assert.equal(await cancelled, null)
    worker.reply(worker.requests[before]!.id, 'active')
    assert.equal(await active, 'active')
    assert.equal(worker.requests[before + 1]!.code, 'const next = 3')
    worker.reply(worker.requests[before + 1]!.id, 'next')
    assert.equal(await next, 'next')
    assert.equal(worker.requests.length, before + 2)
  })

  await t.test('active cancellation discards its result without overlapping worker jobs', async () => {
    const worker = currentWorker()
    const before = worker.requests.length
    const controller = new AbortController()
    const cancelled = highlight('const cancelledActive = 1', controller)
    const next = highlight('const afterAbort = 2')
    controller.abort()
    assert.equal(await cancelled, null)
    assert.equal(worker.requests.length, before + 1)
    worker.reply(worker.requests[before]!.id, 'stale result')
    assert.equal(worker.requests[before + 1]!.code, 'const afterAbort = 2')
    worker.reply(worker.requests[before + 1]!.id, 'current result')
    assert.equal(await next, 'current result')
    assert.equal(await cancelled, null)
  })

  await t.test('at most 64 pending jobs retain code and aborted queued jobs free capacity', async () => {
    const worker = currentWorker()
    const before = worker.requests.length
    const controllers = Array.from({ length: 65 }, () => new AbortController())
    const jobs = controllers.map((controller, index) => highlight(`const queued${index} = ${index}`, controller))
    assert.equal(worker.requests.length, before + 1)
    assert.equal(await highlight('const overflow = 1'), null)
    controllers[1]!.abort()
    assert.equal(await jobs[1], null)
    const replacementController = new AbortController()
    const replacement = highlight('const replacement = 1', replacementController)
    let replacementSettled = false
    void replacement.then(() => { replacementSettled = true })
    await Promise.resolve()
    assert.equal(replacementSettled, false, 'The freed queue slot accepts a replacement')
    for (const controller of controllers) controller.abort()
    replacementController.abort()
    assert.deepEqual(await Promise.all(jobs), Array(65).fill(null))
    assert.equal(await replacement, null)
    worker.reply(worker.requests[before]!.id, 'discarded active result')
    assert.equal(worker.requests.length, before + 1)
  })

  await t.test('idle work is terminated after 10 seconds and recreated only on demand', async () => {
    const worker = currentWorker()
    t.mock.timers.tick(9_999)
    assert.equal(worker.terminated, false)
    const request = highlight('const cancelIdle = true')
    const latest = worker.requests.at(-1)!
    t.mock.timers.tick(1)
    assert.equal(worker.terminated, false, 'A new request cancels the old idle deadline')
    worker.reply(latest.id, 'ready')
    assert.equal(await request, 'ready')
    t.mock.timers.tick(10_000)
    assert.equal(worker.terminated, true)
    const count = FakeWorker.instances.length
    const restarted = highlight('const restarted = true')
    assert.equal(FakeWorker.instances.length, count + 1)
    const replacement = currentWorker()
    replacement.reply(replacement.requests[0]!.id, 'restarted')
    assert.equal(await restarted, 'restarted')
  })

  await t.test('a 3-second worker deadline resolves all jobs to plain text without retries', async () => {
    const worker = currentWorker()
    const active = highlight('const slow = 1')
    const pending = highlight('const pending = 2')
    t.mock.timers.tick(2_999)
    assert.equal(worker.terminated, false)
    t.mock.timers.tick(1)
    assert.equal(worker.terminated, true)
    assert.deepEqual(await Promise.all([active, pending]), [null, null])
    const count = FakeWorker.instances.length
    assert.equal(await highlight('const afterFailure = 3'), null)
    t.mock.timers.tick(30_000)
    assert.equal(FakeWorker.instances.length, count, 'No background retry or new worker is started')
  })
})
