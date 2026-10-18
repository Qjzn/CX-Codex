// Empty-thread first-read compatibility: the App Server and Codex CLI word the
// "thread has no rollout yet" condition differently across versions. A missed
// wording turns an empty thread's first open into a hard error, which is the
// gate recorded in docs/release-notes-2.8.1.zh-CN.md. No service, model or user
// database is touched: only the classification predicate is exercised.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: `
      export { isThreadMaterializingError, isThreadNotLoadedError } from './src/server/appServerRpcErrors.ts'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { isThreadMaterializingError, isThreadNotLoadedError } = compiled.exports

// Wording observed in the shipped Codex CLI binary and App Server messages.
const materializing = [
  'thread 019abc is not materialized yet; includeTurns is unavailable before first user message',
  'thread 019abc is not materialized yet; thread/turns/list is unavailable before first user message',
  'includeTurns is unavailable before first user message',
  'thread/turns/list is unavailable before first user message',
  'no rollout found for thread id 019abc',
  'no rollout found for conversation id 019abc',
  'rollout file is empty',
  'thread rollout does not start with session metadata',
  'thread-store internal error: failed to read thread 019abc',
]

for (const message of materializing) {
  test(`materializing: ${message.slice(0, 48)}`, () => {
    assert.equal(isThreadMaterializingError(new Error(message)), true)
  })
}

// A genuinely missing thread must stay a hard error: masking it would turn a
// wrong id into a silent empty conversation.
test('a missing thread is not treated as materializing', () => {
  assert.equal(isThreadMaterializingError(new Error('thread not found: 019abc')), false)
  assert.equal(isThreadMaterializingError(new Error('boom')), false)
  assert.equal(isThreadMaterializingError(undefined), false)
  assert.equal(isThreadMaterializingError(new Error('')), false)
})

test('thread-not-loaded stays its own recoverable class', () => {
  assert.equal(isThreadMaterializingError(new Error('thread not loaded: 019abc')), false)
  assert.equal(isThreadNotLoadedError(new Error('thread not loaded: 019abc')), true)
})
