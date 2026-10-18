import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const out = fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/disabled-goal-'))
const bundle = path.join(out, 'gateway.mjs')
await build({ entryPoints: ['src/api/codexGateway.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' })
const { getThreadGoal } = await import(pathToFileURL(bundle).href)
test('explicitly disabled native goal reads mean no goal; other failures stay visible', async () => {
  const original = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = { setTimeout, clearTimeout, performance, location: { protocol: 'http:', host: 'synthetic.invalid' } }
  try {
    for (const message of ['goals feature is disabled', ' Goals feature is disabled ']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: message }), { status: 502 })
      assert.equal(await getThreadGoal('synthetic-main'), null)
    }
    for (const message of ['timeout', 'Assistant request rejected.', 'unreadable store', 'goals feature is disabled unexpectedly']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: message }), { status: 502 })
      await assert.rejects(getThreadGoal('synthetic-main'), e => e.message.includes(message))
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ result: { goal: null } }), { status: 200 })
    assert.equal(await getThreadGoal('synthetic-main'), null)
  } finally { globalThis.fetch = original; globalThis.window = originalWindow }
})
