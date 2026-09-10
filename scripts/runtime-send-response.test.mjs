import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Exercise the production HTTP boundary without a bridge or real model request.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/api/codexGateway.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
})
const gateway = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const request = { requestId: 'request-fixture', clientMessageId: 'client-fixture', threadId: 'thread-fixture', turnId: 'turn-fixture', status: 'running' }
const args = { threadId: request.threadId, text: 'Fixture only', clientMessageId: request.clientMessageId }

async function withResponse(response, run) {
  const original = globalThis.fetch
  globalThis.fetch = async () => response
  try { await run() } finally { globalThis.fetch = original }
}

for (const [name, body, status] of [
  ['HTML proxy error', '<html>Bad gateway</html>', 502],
  ['truncated JSON', '{"data":', 200],
  ['empty acknowledgement', '{}', 200],
  ['unknown status', JSON.stringify({ data: { ...request, status: 'future-status' } }), 202],
  ['running without a thread', JSON.stringify({ data: { requestId: request.requestId, status: 'running' } }), 200],
  ['foreign send identity', JSON.stringify({ data: { ...request, request: { ...request, clientMessageId: 'foreign-client' }, threadId: 'foreign-thread' } }), 200],
]) {
  test(`${name} is unknown delivery, not a rejection`, async () => {
    await withResponse(new Response(body, { status }), async () => {
      await assert.rejects(gateway.startRuntimeThreadTurn(args), (error) => {
        assert.equal(error.code, 'invalid_response')
        assert.equal(error.method, 'runtime/send')
        return true
      })
    })
  })
}

test('JSON 503 retains HTTP status so it cannot be mistaken for a definite rejection', async () => {
  await withResponse(new Response('{"error":"Temporarily unavailable"}', { status: 503 }), async () => {
    await assert.rejects(gateway.startRuntimeThreadTurn(args), (error) => error.code === 'http_error' && error.status === 503)
  })
})

test('explicit parameter rejection retains its actionable error', async () => {
  await withResponse(new Response('{"error":"Invalid input"}', { status: 400 }), async () => {
    await assert.rejects(gateway.startRuntimeThreadTurn(args), (error) => error.code === 'http_error' && error.status === 400 && error.message === 'Invalid input')
  })
})

test('nested durable acceptance remains supported before a turn exists', async () => {
  await withResponse(Response.json({ data: { request: { ...request, status: 'pending_start' }, threadId: '', turnId: '', status: 'pending_start' } }, { status: 202 }), async () => {
    assert.deepEqual(await gateway.startRuntimeThreadTurn({ ...args, threadId: undefined }), {
      requestId: request.requestId, threadId: '', turnId: '', status: 'pending_start',
    })
  })
})

test('a send acknowledgement for another thread cannot bind the current message', async () => {
  await withResponse(Response.json({ data: { ...request, threadId: 'foreign-thread' } }), async () => {
    await assert.rejects(gateway.startRuntimeThreadTurn(args), (error) => error.code === 'invalid_response')
  })
})

for (const [name, data] of [
  ['empty lookup', {}],
  ['foreign client identity', { ...request, clientMessageId: 'another-message' }],
  ['unknown lookup status', { ...request, status: 'unrecognized' }],
]) {
  test(`${name} cannot settle the current message`, async () => {
    await withResponse(Response.json({ data }), async () => {
      await assert.rejects(gateway.getRuntimeRequestByClientMessageId(request.clientMessageId), (error) => error.code === 'invalid_response')
    })
  })
}

test('404 lookup remains not-found evidence only; a later matching result is accepted', async () => {
  await withResponse(new Response('{"data":null}', { status: 404 }), async () => {
    assert.equal(await gateway.getRuntimeRequestByClientMessageId(request.clientMessageId), null)
  })
  await withResponse(Response.json({ data: request }), async () => {
    assert.equal((await gateway.getRuntimeRequestByClientMessageId(request.clientMessageId)).turnId, request.turnId)
  })
})
