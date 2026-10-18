#!/usr/bin/env node
// K1-2 standalone smoke test for getThreadTaskBoardSnapshots (src/api/codexGateway.ts).
//
// No framework, no browser, no server, no native calls: bundles the real gateway source with
// esbuild, dynamically imports the bundle, and drives it with a fake globalThis.fetch.
// Exit code 0 = GREEN, 1 = at least one failing case.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const entryPoint = path.join(repoRoot, 'src', 'api', 'codexGateway.ts')

const outRoot = (
  process.env.K1_GATEWAY_SMOKE_OUT || path.join(process.env.TMPDIR || os.tmpdir(), 'k1-gateway-smoke')
).trim()
fs.mkdirSync(outRoot, { recursive: true })
const runDir = fs.mkdtempSync(path.join(outRoot, 'run-'))
const bundlePath = path.join(runDir, 'codexGateway.bundle.mjs')
const logPath = path.join(runDir, 'thread-task-board-gateway-smoke.log')

const lines = []
const log = (line = '') => {
  lines.push(line)
  console.log(line)
}
const flushLog = () => {
  lines.push('')
  lines.push(`output dir: ${runDir}`)
  lines.push(`bundle: ${bundlePath}`)
  fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8')
}

log(`K1-2 thread task board gateway smoke`)
log(`repo: ${repoRoot}`)
log(`output dir: ${runDir}`)
log('')

const originalFetch = globalThis.fetch
const calls = []

const installFetch = (handler) => {
  calls.length = 0
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input && input.url ? input.url : input)
    const record = { url, method: (init.method || 'GET').toUpperCase(), init }
    calls.push(record)
    if (init.signal && init.signal.aborted) {
      const abortError = new Error('The operation was aborted.')
      abortError.name = 'AbortError'
      return Promise.reject(abortError)
    }
    return Promise.resolve(handler(record))
  }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const validRow = (threadId, overrides = {}) => ({
  threadId,
  executionState: 'running',
  inProgress: true,
  activeTurnId: `turn-${threadId}`,
  updatedAtIso: '2026-10-16T10:00:00.000Z',
  lastEventSeq: 7,
  stale: false,
  pendingServerRequestCount: 2,
  // Noise the projection must never receive.
  transcript: [{ role: 'user', content: 'secret transcript' }],
  pendingServerRequests: [{ id: 'req-1', params: { secret: true } }],
  ...overrides,
})

let passes = 0
let failures = 0
const test = async (name, fn) => {
  try {
    await fn()
    passes += 1
    log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    log(`FAIL ${name}`)
    log(`     ${error && error.message ? error.message : String(error)}`)
  }
}

let buildError = null
try {
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: bundlePath,
    absWorkingDir: repoRoot,
    logLevel: 'warning',
  })
} catch (error) {
  buildError = error
}

if (buildError) {
  log(`FAIL esbuild bundle of ${entryPoint}`)
  log(`     ${buildError && buildError.message ? buildError.message : String(buildError)}`)
  flushLog()
  process.exitCode = 1
} else {
  const gateway = await import(pathToFileURL(bundlePath).href)
  const { getThreadTaskBoardSnapshots } = gateway
  const SNAPSHOT_KEYS = [
    'activeTurnId',
    'executionState',
    'inProgress',
    'lastEventSeq',
    'pendingServerRequestCount',
    'stale',
    'threadId',
    'updatedAtIso',
  ]

  try {
    await test('export exists', async () => {
      assert.equal(typeof getThreadTaskBoardSnapshots, 'function')
    })

    await test('requested ids are trimmed+deduped, rows map by id, foreign ids ignored', async () => {
      installFetch(() =>
        jsonResponse({
          data: [
            validRow('t-a'),
            validRow('t-foreign', { executionState: 'failed' }),
            validRow('t-b', {
              executionState: 'waiting_permission',
              inProgress: false,
              stale: true,
              activeTurnId: '',
              lastEventSeq: 0,
              pendingServerRequestCount: 0,
            }),
          ],
        }),
      )
      const snapshots = await getThreadTaskBoardSnapshots(['  t-b  ', 't-a', 't-b', ' t-a '])
      assert.deepEqual(Object.keys(snapshots).sort(), ['t-a', 't-b'])
      assert.equal(snapshots['t-a'].threadId, 't-a')
      assert.equal(snapshots['t-a'].executionState, 'running')
      assert.equal(snapshots['t-a'].inProgress, true)
      assert.equal(snapshots['t-a'].activeTurnId, 'turn-t-a')
      assert.equal(snapshots['t-a'].updatedAtIso, '2026-10-16T10:00:00.000Z')
      assert.equal(snapshots['t-a'].lastEventSeq, 7)
      assert.equal(snapshots['t-a'].stale, false)
      assert.equal(snapshots['t-a'].pendingServerRequestCount, 2)
      assert.equal(snapshots['t-b'].executionState, 'waiting_permission')
      assert.equal(snapshots['t-b'].inProgress, false)
      assert.equal(snapshots['t-b'].stale, true)
      assert.equal(snapshots['t-b'].activeTurnId, '')
      assert.equal(snapshots['t-b'].lastEventSeq, 0)
      assert.equal(snapshots['t-b'].pendingServerRequestCount, 0)
      assert.deepEqual(Object.keys(snapshots['t-a']).sort(), SNAPSHOT_KEYS)
      assert.deepEqual(Object.keys(snapshots['t-b']).sort(), SNAPSHOT_KEYS)
      assert.equal('transcript' in snapshots['t-a'], false)
      assert.equal('pendingServerRequests' in snapshots['t-a'], false)
      assert.equal(JSON.stringify(snapshots).includes('secret'), false)
    })

    await test('single GET request with explicit view=task-board and no extra query params', async () => {
      installFetch(() => jsonResponse({ data: [validRow('t-a')] }))
      await getThreadTaskBoardSnapshots(['t-a'])
      assert.equal(calls.length, 1)
      assert.equal(calls[0].method, 'GET')
      assert.equal(
        calls[0].url,
        '/codex-api/runtime/snapshots?view=task-board&threadIds=' + encodeURIComponent('t-a'),
      )
      assert.deepEqual(calls[0].url.split('?')[1].split('&'), [
        'view=task-board',
        'threadIds=' + encodeURIComponent('t-a'),
      ])
      assert.equal(calls[0].init.body, undefined)
    })

    await test('unknown non-empty executionState is kept, never defaulted to completed', async () => {
      installFetch(() => jsonResponse({ data: [validRow('t-unknown', { executionState: '  sync_quarantine  ' })] }))
      const snapshots = await getThreadTaskBoardSnapshots(['t-unknown'])
      assert.equal(snapshots['t-unknown'].executionState, 'sync_quarantine')
      assert.notEqual(snapshots['t-unknown'].executionState, 'completed')
    })

    await test('missing/invalid rows are omitted (attention), valid sibling survives', async () => {
      const noState = validRow('t-no-state', { executionState: '   ' })
      const noBool = validRow('t-no-bool', { inProgress: 'true' })
      const noStale = validRow('t-no-stale', { stale: 1 })
      const badTurnId = validRow('t-bad-turn', { activeTurnId: null })
      const badTimestamp = validRow('t-bad-ts', { updatedAtIso: 'not-a-date' })
      const emptyTimestamp = validRow('t-empty-ts', { updatedAtIso: '   ' })
      const negativeSeq = validRow('t-negative-seq', { lastEventSeq: -3 })
      const floatSeq = validRow('t-float-seq', { lastEventSeq: 1.5 })
      const stringCount = validRow('t-string-count', { pendingServerRequestCount: '2' })
      const nanSeq = validRow('t-nan-seq', { lastEventSeq: Number.NaN })
      const infiniteCount = validRow('t-inf-count', { pendingServerRequestCount: Number.POSITIVE_INFINITY })
      const missingSeq = validRow('t-missing-seq')
      delete missingSeq.lastEventSeq
      const missingCount = validRow('t-missing-count')
      delete missingCount.pendingServerRequestCount
      const missingId = validRow('t-missing-id')
      delete missingId.threadId

      installFetch(() =>
        jsonResponse({
          data: [
            validRow('t-ok'),
            noState,
            noBool,
            noStale,
            badTurnId,
            badTimestamp,
            emptyTimestamp,
            negativeSeq,
            floatSeq,
            stringCount,
            nanSeq,
            infiniteCount,
            missingSeq,
            missingCount,
            missingId,
            'not-an-object',
            null,
            [],
          ],
        }),
      )
      const requested = [
        't-ok',
        't-no-state',
        't-no-bool',
        't-no-stale',
        't-bad-turn',
        't-bad-ts',
        't-empty-ts',
        't-negative-seq',
        't-float-seq',
        't-string-count',
        't-nan-seq',
        't-inf-count',
        't-missing-seq',
        't-missing-count',
        't-missing-id',
      ]
      const snapshots = await getThreadTaskBoardSnapshots(requested)
      assert.deepEqual(Object.keys(snapshots), ['t-ok'])
      assert.equal(calls.length, 1)
    })

    await test('ambiguous duplicate threadId rows are omitted, not resolved arbitrarily', async () => {
      installFetch(() =>
        jsonResponse({
          data: [
            validRow('t-dup'),
            validRow('t-dup', { executionState: 'failed', inProgress: false, lastEventSeq: 99 }),
            validRow('t-solo'),
          ],
        }),
      )
      const snapshots = await getThreadTaskBoardSnapshots(['t-dup', 't-solo'])
      assert.deepEqual(Object.keys(snapshots), ['t-solo'])
      assert.equal('t-dup' in snapshots, false)
    })

    await test('empty or whitespace-only ids resolve to {} with zero requests', async () => {
      installFetch(() => {
        throw new Error('fetch must not be called for an empty id list')
      })
      assert.deepEqual(await getThreadTaskBoardSnapshots([]), {})
      assert.deepEqual(await getThreadTaskBoardSnapshots(['', '   ', '\t']), {})
      assert.equal(calls.length, 0)
    })

    await test('more than 100 unique ids rejects with RangeError before any request', async () => {
      const tooMany = Array.from({ length: 101 }, (_, index) => `t-${index}`)
      installFetch(() => {
        throw new Error('fetch must not be called for an over-limit id list')
      })
      await assert.rejects(
        () => getThreadTaskBoardSnapshots(tooMany),
        (error) => {
          assert.ok(error instanceof RangeError, `expected RangeError, received ${error && error.name}`)
          return true
        },
      )
      assert.equal(calls.length, 0)
    })

    await test('exactly 100 unique ids is allowed and issues one request', async () => {
      const maxIds = Array.from({ length: 100 }, (_, index) => `t-${index}`)
      installFetch(() => jsonResponse({ data: maxIds.map((id) => validRow(id)) }))
      const snapshots = await getThreadTaskBoardSnapshots(maxIds)
      assert.equal(Object.keys(snapshots).length, 100)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url.includes(encodeURIComponent(maxIds.join(','))), true)
    })

    await test('non-ok response throws a meaningful error', async () => {
      installFetch(() => jsonResponse({ error: { message: 'task board unavailable' } }, 503))
      await assert.rejects(
        () => getThreadTaskBoardSnapshots(['t-a']),
        (error) => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.trim().length > 0)
          return true
        },
      )
    })

    await test('invalid envelope (non-JSON body, non-object payload, non-array data) throws', async () => {
      installFetch(() => new Response('not json', { status: 200 }))
      await assert.rejects(() => getThreadTaskBoardSnapshots(['t-a']), (error) => error instanceof Error)

      installFetch(() => jsonResponse([validRow('t-a')]))
      await assert.rejects(() => getThreadTaskBoardSnapshots(['t-a']), (error) => error instanceof Error)

      installFetch(() => jsonResponse({ data: { 't-a': validRow('t-a') } }))
      await assert.rejects(() => getThreadTaskBoardSnapshots(['t-a']), (error) => error instanceof Error)

      installFetch(() => jsonResponse({}))
      await assert.rejects(() => getThreadTaskBoardSnapshots(['t-a']), (error) => error instanceof Error)
    })

    await test('upstream signal is respected', async () => {
      installFetch(() => {
        throw new Error('fetch must not resolve when the signal is already aborted')
      })
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(() => getThreadTaskBoardSnapshots(['t-a'], { signal: controller.signal }))
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  log('')
  log(`passes: ${passes}`)
  log(`failures: ${failures}`)
  flushLog()
  process.exitCode = failures > 0 ? 1 : 0
}
