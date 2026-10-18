// Real gateway, synthetic HTTP transport only. Never reads auth or user data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const repo = path.resolve(import.meta.dirname, '..')
const out = fs.mkdtempSync(path.join((fs.mkdirSync(path.join(repo, 'output/assistant-gateway-smoke'), { recursive: true }), path.join(repo, 'output/assistant-gateway-smoke')), 'run-'))
const bundle = path.join(out, 'gateway.mjs')
await build({ entryPoints: [path.join(repo, 'src/api/assistantGateway.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'synthetic-auth', setup(b) { b.onResolve({ filter: /mobileAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const shouldAutoLoginForResponse = () => false; export const tryMobileShellAutoLogin = async () => false' })) } }] })
const api = await import(pathToFileURL(bundle).href)
const state = { data: null, allowedWorkspaces: ['E:/synthetic'], capabilities: { conversation: false, dispatch: false, backgroundExecution: false } }
const identity = { assistantId: 'synthetic-id', name: '小策', cwd: 'E:/synthetic', revision: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', mainThreadId: null }
const originalFetch = globalThis.fetch
const originalTimeout = globalThis.setTimeout
let calls = []
let handler
globalThis.fetch = (url, options) => { calls.push({ url, options }); return handler(url, options) }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })
const results = []
async function test(name, action) { calls = []; try { await action(); results.push({ name, passed: true }); console.log('PASS', name) } catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL', name, error) } }
try {
 await test('GET never writes and accepts empty configured identity', async () => { handler = async () => json(state); assert.deepEqual(await api.getAssistantState(), state); assert.equal(calls[0].url, '/codex-api/assistant'); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.body, undefined) })
 await test('save sends only identity fields and exact revision', async () => { handler = async () => json({ ...state, data: identity }); assert.deepEqual((await api.saveAssistantIdentity({ name: ' 小策 ', cwd: ' E:/synthetic ', revision: null, assistantId: 'forbidden' })).data, identity); assert.deepEqual(JSON.parse(calls[0].options.body), { name: '小策', cwd: 'E:/synthetic', revision: null }); assert.equal(calls[0].options.method, 'PUT') })
 await test('conflict preserves HTTP status for authority reread', async () => { handler = async () => json({ error: 'conflict' }, 409); await assert.rejects(api.saveAssistantIdentity({ name: '小策', cwd: 'E:/synthetic', revision: 1 }), e => e instanceof api.AssistantGatewayError && e.status === 409) })
 await test('invalid input never reaches network', async () => { for (const bad of [{ name: '', revision: null }, { name: 'a'.repeat(81), revision: null }, { name: 'x', revision: 0 }, { name: 'x', revision: Number.MAX_SAFE_INTEGER + 1 }]) await assert.rejects(api.saveAssistantIdentity({ cwd: 'E:/synthetic', ...bad })); assert.equal(calls.length, 0) })
 await test('pre-aborted request does not fetch', async () => { const c = new AbortController(); c.abort(); await assert.rejects(api.getAssistantState({ signal: c.signal }), { name: 'AbortError' }); assert.equal(calls.length, 0) })
 await test('malformed successful payload never pretends to be ready', async () => { for (const bad of [{}, { ...state, capabilities: { ...state.capabilities, dispatch: true } }, { ...state, data: { ...identity, revision: 0 } }, { ...state, data: { ...identity, mainThreadId: 17 } }, { ...state, allowedWorkspaces: [null] }]) { handler = async () => json(bad); await assert.rejects(api.getAssistantState(), api.AssistantGatewayError) } })
 await test('main-conversation contract retains explicit status and posts to dedicated route', async () => { const main = { ...state, data: { ...identity, mainThreadId: 'synthetic-thread' }, capabilities: { ...state.capabilities, conversation: true }, mainConversation: { clientMessageId: 'assistant-main:synthetic', status: 'running', threadId: 'synthetic-thread' } }; handler = async () => json(main); const received = await api.getAssistantState(); assert.deepEqual(received, main); const input = { revision: 1, clientMessageId: '7ed122f1-7588-4d79-a621-14c9037d208b', text: 'synthetic' }; await api.beginAssistantConversation(input); const last=calls.at(-1); assert.equal(last.url, '/codex-api/assistant/conversation'); assert.equal(last.options.method, 'POST'); assert.deepEqual(JSON.parse(last.options.body), input) })
 await test('HTTP failure and invalid JSON remain visible', async () => { handler = async () => new Response('<html>failure</html>', { status: 503 }); await assert.rejects(api.getAssistantState(), e => e.status === 503 && !e.message.includes('<html>')); handler = async () => new Response('{broken', { status: 200 }); await assert.rejects(api.getAssistantState(), api.AssistantGatewayError) })
 await test('abort remains active while parsing response body', async () => { const c = new AbortController(); handler = async (_, { signal }) => ({ ok: true, status: 200, text: () => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { name: 'AbortError' }))); queueMicrotask(() => c.abort()) }) }); await assert.rejects(api.getAssistantState({ signal: c.signal }), { name: 'AbortError' }) })
 await test('10 second deadline covers body and cleans up', async () => { globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 10_000 ? 15 : ms, ...args); handler = async (_, { signal }) => ({ ok: true, status: 200, text: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })))) }); await assert.rejects(api.getAssistantState(), e => e.status === 0 && /\u8d85\u65f6/.test(e.message)) })
} finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(results, null, 2)) }
console.log(JSON.stringify({ out, passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length }))
process.exitCode = results.some(x => !x.passed) ? 1 : 0
