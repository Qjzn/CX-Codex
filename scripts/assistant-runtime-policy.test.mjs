import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/runtime-policy-'))
process.env.CODEX_HOME = path.join(root, 'home')
fs.mkdirSync(process.env.CODEX_HOME)
const bundle = path.join(root, 'modules.mjs')
await build({ stdin: { resolveDir: process.cwd(), contents: `export {RuntimeStore} from './src/server/runtimeStore.ts'; export {AppServerProcess} from './src/server/appServerProcess.ts'; export {createAppServerRuntimeTurnStarter} from './src/server/appServerRuntimeStart.ts'; export * from './src/server/assistantRuntime.ts'; export * from './src/server/assistantRolePolicy.ts';` }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent' })
const m = await import(pathToFileURL(bundle).href)

test('RuntimeStore attaches task ledger without creating tasks and excludes a second live host', () => {
  const database=path.join(root,'host-owned-runtime.sqlite')
  const first=new m.RuntimeStore(database), second=new m.RuntimeStore(database)
  try {
    assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM runtime_metadata WHERE key LIKE 'assistant_%'").get().n,0)
    first.assistantTasks.claimHost('synthetic-assistant')
    assert.throws(()=>second.assistantTasks.claimHost('synthetic-assistant'),/another live process/)
    assert.equal(first.assistantTasks.listTasks('synthetic-assistant').length,0)
  } finally {second.close();first.close()}
})

test('actual native write guard rechecks after initialization and rejects before pending/native effects', async () => {
  const process = new m.AppServerProcess()
  let release
  const initialized = new Promise(resolve => { release=resolve })
  process.ensureInitialized = async () => { await initialized }
  process.assertSameInitializedChild = () => {}
  process.start = () => {}
  let writes=0, stopped=false
  process.sendLine=() => { writes++ }
  process.setRpcWriteGuard(() => { if(stopped) throw new Error('STOP_BEFORE_NATIVE_WRITE') })
  const pending=process.rpc('thread/start', {})
  stopped=true;release()
  await assert.rejects(pending,/STOP_BEFORE_NATIVE_WRITE/)
  assert.equal(writes,0)
  assert.equal(process.pending.count,0)
})

test('private native context reaches the write guard and is neither serialized nor shared', async () => {
  const process = new m.AppServerProcess()
  process.ensureInitialized=async()=>{}
  process.assertSameInitializedChild=()=>{}
  process.start=()=>{}
  const seen=[],lines=[]
  process.setRpcPolicy(async (method,params,context)=>{seen.push(['policy',context]);return params})
  process.setRpcWriteGuard((method,params,context)=>seen.push(['write',context]))
  process.sendLine=message=>{lines.push(message);const pending=process.pending.finalize(message.id);pending.resolve({ok:true})}
  const contexts=[{},{}]
  await Promise.all(contexts.map(context=>process.rpc('thread/read',{threadId:'synthetic'},context)))
  assert.equal(lines.length,2)
  assert.deepEqual(lines.map(line=>Object.keys(line).sort()),[['id','method','params'],['id','method','params']])
  for(const context of contexts)assert.equal(seen.filter(([kind,got])=>got===context).length,2)
})
test('deferred native tool replies cannot be sent into a replacement process generation',()=>{
 const process=new m.AppServerProcess(),replies=[];process.getActiveLaunchIdentity=()=>({generation:2});process.sendServerRequestReply=(id,reply)=>replies.push({id,reply});assert.equal(process.replyToInterceptedServerRequest(17,{success:true},1),false);assert.equal(replies.length,0);assert.equal(process.replyToInterceptedServerRequest(17,{success:true},2),true);assert.deepEqual(replies,[{id:17,reply:{result:{success:true}}}]);process.getActiveLaunchIdentity=()=>null;assert.equal(process.replyToInterceptedServerRequest(18,{},2),false)
})

test('central RPC policy runs before initialization, even on cold protected access', async () => {
  let resolves = 0
  const process = new m.AppServerProcess({ resolveCodexCommand: () => { resolves++; return null } })
  process.setRpcPolicy(async () => { throw new Error('SYNTHETIC_ROLE_REFUSAL') })
  await assert.rejects(process.rpc('thread/fork', { threadId: 'synthetic-main' }), /SYNTHETIC_ROLE_REFUSAL/)
  assert.equal(resolves, 0)
})
test('server request guard precedes permissive global approvals and fails closed', () => {
  const process = new m.AppServerProcess()
  const denied = []
  process.rejectServerRequest = id => denied.push(id)
  process.setServerRequestInterceptor(id => { process.rejectServerRequest(id); return true })
  process.handleServerRequest(100, 'item/permissions/requestApproval', { threadId: 'synthetic-main' })
  process.setServerRequestInterceptor(() => { throw new Error('SYNTHETIC_STORAGE_UNREADABLE') })
  process.handleServerRequest(101, 'item/tool/call', {})
  assert.deepEqual(denied, [100, 101])
  assert.deepEqual(process.listPendingServerRequests(), [])
})
test('persisted reservation drives real starter role restrictions, replay and cold lookup', async () => {
  const database = path.join(root, 'runtime.sqlite')
  let store = new m.RuntimeStore(database)
  const cwd = 'E:/Synthetic/Assistant'
  const identity = store.writeAssistantIdentity({ name: 'Synthetic coordinator', cwd, revision: null }).identity
  const clientMessageId = 'assistant-main:00000000-0000-4000-8000-000000000001'
  store.reserveAssistantMainConversation({ assistantId: identity.assistantId, revision: 1, cwd, clientMessageId, promptHash: 'synthetic' })
  assert.deepEqual(m.readAssistantRoleBinding(store), { threadId: '', cwd })
  const calls = []
  const deps = {
    createRequest: r => store.createRequest(r), updateRequest: (id, patch) => store.updateRequest(id, patch),
    getRequest: id => store.getRequest(id), getLatestRequestByClientMessageId: id => store.getLatestRequestByClientMessageId(id),
    rpc: async (method, params) => {
      const binding = m.readAssistantRoleBinding(store)
      params = m.protectAssistantRpc(method, params, binding, {})
      calls.push({ method, params })
      if (method === 'config/read') return { config: { model: 'synthetic', api_key: 'SYNTHETIC_SECRET', mcp_servers: { syntheticWriter: { env: { TOKEN: 'SYNTHETIC_SECRET' } } } } }
      if (method === 'thread/start') return { thread: { id: 'synthetic-main' } }
      if (method === 'turn/start') return { turn: { id: 'synthetic-turn' } }
      throw new Error('Unexpected synthetic native call')
    },
    clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {}, markStartUncertain() {}, markFailed() {},
    persistRuntimeSnapshot: () => ({ activeTurnId: '' }), markPlanModeTurn() {}, getErrorMessage: (e, fallback) => e instanceof Error ? e.message : fallback,
  }
  try {
    const start = m.createAssistantRuntimeTurnStarter(deps)
    const payload = { cwd, clientMessageId, model: 'synthetic', input: [{ type: 'text', text: 'synthetic main question' }] }
    await start(payload)
    for (let i = 0; i < 100 && store.getLatestRequestByClientMessageId(clientMessageId)?.status !== 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5))
    const request = store.getLatestRequestByClientMessageId(clientMessageId)
    assert.equal(request.status, 'running')
    const thread = calls.find(c => c.method === 'thread/start').params
    assert.equal(thread.sandbox, 'read-only')
    assert.equal(thread.approvalPolicy, 'never')
    assert.equal(thread.config['mcp_servers.syntheticWriter.enabled'], false)
    assert.equal(JSON.stringify(thread).includes('SYNTHETIC_SECRET'), false)
    const turn = calls.find(c => c.method === 'turn/start').params
    assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false })
    assert.equal(turn.collaborationMode.settings.developer_instructions, m.ASSISTANT_ROLE_INSTRUCTIONS)
    await start(payload)
    assert.equal(calls.filter(c => c.method === 'thread/start').length, 1)
    assert.equal(calls.filter(c => c.method === 'turn/start').length, 1)
    store.close(); store = new m.RuntimeStore(database)
    assert.deepEqual(m.readAssistantRoleBinding(store), { threadId: 'synthetic-main', cwd })
    assert.throws(() => m.protectAssistantRpc('thread/fork', { threadId: 'synthetic-main' }, m.readAssistantRoleBinding(store), {}))
    const brokenStore = { ...store, readAssistantMainConversation: () => ({ assistantId: 'foreign', cwd, clientMessageId }), readAssistantIdentity: () => identity }
    assert.throws(() => m.readAssistantRoleBinding(brokenStore))
  } finally { store.close() }
})
test('ordinary-ID assistant follow-ups cannot replay an uncertain native turn; ordinary behavior stays intact', async () => {
  for (const managed of [true, false]) {
    const store = new m.RuntimeStore(path.join(root, `followup-${managed}.sqlite`))
    let calls = 0
    const id = `ordinary-user-id-${managed}`
    const starter = m.createAppServerRuntimeTurnStarter({
      createRequest: r => store.createRequest(r), updateRequest: (key, patch) => store.updateRequest(key, patch), getRequest: key => store.getRequest(key), getLatestRequestByClientMessageId: key => store.getLatestRequestByClientMessageId(key),
      isManagedThread: threadId => managed && threadId === 'synthetic-main',
      rpc: async method => { calls++; if (calls === 1) throw new Error('thread not found after synthetic transport disconnect'); return method === 'thread/resume' ? { thread: { id: 'synthetic-main' } } : { turn: { id: 'synthetic-followup-turn' } } },
      clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {}, markStartUncertain() {}, markFailed() {}, persistRuntimeSnapshot: () => ({ activeTurnId: '' }), markPlanModeTurn() {}, getErrorMessage: (e, fallback) => e instanceof Error ? e.message : fallback,
    })
    try {
      await starter({ clientMessageId: id, model: 'synthetic', threadId: 'synthetic-main', input: [{ type: 'text', text: 'Follow-up' }] })
      for (let i = 0; i < 100 && ['pending_start', 'starting'].includes(store.getLatestRequestByClientMessageId(id)?.status); i++) await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(calls, managed ? 1 : 3)
      assert.equal(store.getLatestRequestByClientMessageId(id).status, managed ? 'start_uncertain' : 'running')
    } finally { store.close() }
  }
})
test('pending-start recovery routes only the persisted main identity through the restricted starter', async () => {
  const calls = []
  const resume = m.createAssistantPendingStartResumer({
    readMainClientMessageId: () => 'assistant-main:persisted',
    startAssistantConversation: async payload => { calls.push(['assistant', payload]); return { status: 'pending_start' } },
    startRuntimeTurn: async payload => { calls.push(['ordinary', payload]); return { status: 'pending_start' } },
  })
  await resume({ clientMessageId: 'assistant-main:persisted' })
  await resume({ clientMessageId: 'assistant-main:unreserved' })
  await resume({ clientMessageId: 'ordinary-id' })
  assert.deepEqual(calls.map(c => c[0]), ['assistant', 'ordinary', 'ordinary'])
  const broken = m.createAssistantPendingStartResumer({ readMainClientMessageId() { throw new Error('storage unreadable') }, startAssistantConversation: () => assert.fail(), startRuntimeTurn: () => assert.fail() })
  await assert.rejects(broken({ clientMessageId: 'assistant-main:persisted' }), /storage unreadable/)
})
