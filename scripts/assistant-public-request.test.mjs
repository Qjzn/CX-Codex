import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const out = fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/public-requests-'))
const bundle = path.join(out, 'route.mjs')
process.env.CODEX_HOME = path.join(out, 'home'); fs.mkdirSync(process.env.CODEX_HOME)
await build({ stdin: { contents: `export {handleRuntimeActionRoutes} from './src/server/runtimeActionRoutes.ts'; export {handleRpcProxyRoute} from './src/server/rpcProxyRoute.ts'; export {createCodexBridgeRouteHandlers} from './src/server/codexBridgeRouteHandlers.ts'; export {isPublicAssistantRequestAllowed} from './src/server/assistantPublicRequestPolicy.ts';`, resolveDir: process.cwd() }, outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' })
const { handleRuntimeActionRoutes, handleRpcProxyRoute, createCodexBridgeRouteHandlers, isPublicAssistantRequestAllowed: allowed } = await import(pathToFileURL(bundle).href)
const cases = [
  ['POST', '/codex-api/runtime/send'], ['POST', '/codex-api/runtime/queue'], ['POST', '/codex-api/runtime/interrupt'],
  ['POST', '/codex-api/runtime/queue/reorder'], ['DELETE', '/codex-api/runtime/queue/host-owned'],
  ['POST', '/codex-api/runtime/queue/host-owned/retry'], ['POST', '/codex-api/runtime/queue/host-owned/restore'],
]
for (const [method, pathname] of cases) test(`public host-owned mutation refused before any side effect: ${method} ${pathname}`, async () => {
  let effects = 0
  let response = null
  const native = () => { effects++; return { status: 'running' } }
  const res = { statusCode: 200, setHeader() {}, end(body) { response = JSON.parse(body) } }
  const deps = { readJsonBody: async () => ({ clientMessageId: 'assistant-main:host-owned', requestId: 'host-owned', requestIds: ['host-owned'] }), isPublicRequestAllowed: () => false, startRuntimeTurn: native, interruptRuntimeTurn: native, enqueueRuntimeTurn: native, reorderQueuedRuntimeTurns: native, cancelQueuedRuntimeTurn: native, retryQueuedRuntimeTurn: native, restoreQueuedRuntimeTurn: native, getLatestRequestByClientMessageId: () => null }
  assert.equal(await handleRuntimeActionRoutes({ method }, res, new URL(pathname, 'http://synthetic'), deps), true)
  assert.equal(res.statusCode, 403)
  assert.equal(effects, 0)
  assert.equal(typeof response.error, 'string')
})
test('ordinary public sends remain supported without an assistant policy', async () => {
  let effects = 0
  const res = { statusCode: 200, setHeader() {}, end() {} }
  await handleRuntimeActionRoutes({ method: 'POST' }, res, new URL('http://synthetic/codex-api/runtime/send'), { readJsonBody: async () => ({}), startRuntimeTurn: async () => { effects++; return { status: 'running' } }, getLatestRequestByClientMessageId: () => null })
  assert.equal(effects, 1)
  assert.equal(res.statusCode, 200)
})
test('all host namespaces are reserved before a corresponding row exists', () => {
  for (const name of ['assistant-main', 'assistant-task', 'assistant-report']) assert.equal(allowed({ clientMessageId: `${name}:synthetic` }, () => null), false)
})
test('request ID or queue ID collision cannot overwrite an existing host request', () => {
  const read = id => id === 'frozen-id' ? { clientMessageId: 'assistant-main:synthetic' } : null
  assert.equal(allowed({ requestId: 'frozen-id', clientMessageId: 'ordinary' }, read), false)
  assert.equal(allowed({ requestIds: ['ordinary', 'frozen-id'] }, read), false)
  assert.equal(allowed({ requestId: 'ordinary', clientMessageId: 'ordinary' }, read), true)
})
test('ordinary user IDs do not acquire a role by arbitrary text', () => {
  assert.equal(allowed({ clientMessageId: 'ordinary', role: 'assistant', threadId: 'main' }, () => null), true)
})
test('storage failure never becomes an allowed host request', () => {
  assert.throws(() => allowed({ requestId: 'frozen-id' }, () => { throw new Error('synthetic unreadable store') }), /unreadable store/)
})
test('production bridge actually installs public namespace protection', async () => {
  let effects = 0
  const res = { statusCode: 200, setHeader() {}, end() {} }
  const deps = { statusDiagnostics: { observeThreadUnsubscribeResponse() {} }, readJsonBody: async () => ({ clientMessageId: 'assistant-main:frozen' }), runtimeStore: { getRequest: () => null }, startRuntimeTurn: async () => { effects++; return { status: 'running' } } }
  const handlers = createCodexBridgeRouteHandlers({ method: 'POST' }, res, new URL('http://synthetic/codex-api/runtime/send'), deps)
  for (const handle of handlers) if (await handle()) break
  assert.equal(res.statusCode, 403)
  assert.equal(effects, 0)
})
test('persisted workers cannot be mutated using ordinary IDs or conflicting thread aliases',()=>{
 const isWorker=id=>id==='worker';assert.equal(allowed({threadId:'worker',clientMessageId:'user'},()=>null,isWorker),false);assert.equal(allowed({thread_id:'worker'},()=>null,isWorker),false);assert.equal(allowed({threadId:'ordinary',thread_id:'worker'},()=>null,isWorker),false);assert.equal(allowed({requestId:'ordinary-record'},()=>({clientMessageId:'ordinary',threadId:'worker'}),isWorker),false);assert.equal(allowed({threadId:'ordinary'},()=>null,isWorker),true)
})
test('raw RPC refusal precedes both Runtime state writes and native execution',async()=>{
 let effects=0,reply;const res={statusCode:200,setHeader(){},end(value){reply=JSON.parse(value)}};const effect=()=>effects++
 const deps={readJsonBody:async()=>({method:'turn/start',params:{threadId:'worker',input:[{type:'text',text:'Do not execute'}]}}),isPublicRpcAllowed:()=>false,rpc:effect,runtimeStateStore:{markStarting:effect},persistRuntimeSnapshot:effect,deleteCachedThreadRead:effect}
 assert.equal(await handleRpcProxyRoute({method:'POST'},res,new URL('http://synthetic/codex-api/rpc'),deps),true);assert.equal(res.statusCode,403);assert.equal(effects,0);assert.equal(typeof reply.error,'string')
})
