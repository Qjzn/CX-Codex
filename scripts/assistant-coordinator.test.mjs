import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {setImmediate as tick} from 'node:timers/promises'
import {build} from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/coordinator-'))
process.env.CODEX_HOME=path.join(out,'home');fs.mkdirSync(process.env.CODEX_HOME)
const bundle=path.join(out,'coordinator.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/server/assistantCoordinator.ts';export * from './src/server/assistantAssets.ts';export * from './src/server/assistantRuntime.ts';export * from './src/server/runtimeStore.ts';export * from './src/server/runtimeState.ts';export * from './src/server/appServerProcess.ts';export * from './src/server/appServerThreadReadCache.ts';export * from './src/server/codexBridgeRuntimeOperations.ts';export * from './src/server/runtimeMessageQueue.ts';"},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const m=await import(pathToFileURL(bundle).href)
const assets=m.readAssistantAssets(pathToFileURL(path.resolve('src/server/assistant-assets')+path.sep))
let seq=0
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick()}assert.fail('Expected bounded synthetic coordinator state did not settle')}
function fixture(enableReports=false){
 const file=path.join(out,`case-${seq++}.sqlite`),store=new m.RuntimeStore(file),app=new m.AppServerProcess(),state=new m.RuntimeStateStore(),cache=new m.AppServerThreadReadCacheStore()
 const native={generation:1,threads:new Map(),calls:[],replies:[],errors:[],readGate:null}
 app.ensureInitialized=async()=>{};app.assertSameInitializedChild=()=>{};app.start=()=>{};app.getActiveLaunchIdentity=()=>({generation:native.generation})
 app.sendLine=message=>{
  if(!message.method){native.replies.push(message);return}
  native.calls.push(message);const pending=app.pending.finalize(message.id)
  void(async()=>{
   const p=message.params||{}
   if(message.method==='config/read')return{config:{model:'synthetic-model',mcp_servers:{synthetic:{}}}}
   if(message.method==='thread/start'){const id='native-thread-'+native.threads.size;const thread={id,turns:[],cwd:p.cwd,model:p.model,toolNames:(p.dynamicTools||[]).map(t=>t.name)};native.threads.set(id,thread);return{thread:structuredClone(thread)}}
   if(message.method==='turn/start'){const thread=native.threads.get(p.threadId);const turn={id:'native-turn-'+thread.turns.length,status:'inProgress',items:[{type:'userMessage',content:p.input}]};thread.turns.push(turn);return{turn:structuredClone(turn)}}
   if(message.method==='thread/read'){if(native.readGate)await native.readGate;return{thread:structuredClone(native.threads.get(p.threadId))}}
   if(message.method==='thread/resume')return{thread:structuredClone(native.threads.get(p.threadId))}
   if(message.method==='turn/interrupt'){native.threads.get(p.threadId).turns.find(t=>t.id===p.turnId).status='interrupted';return{}}
   throw Error('unexpected native method '+message.method)
  })().then(pending.resolve,pending.reject)
 }
 let coordinator,queue=null
 const runtime=m.createCodexBridgeRuntimeOperations({
  appServer:app,runtimeStore:store,runtimeStateStore:state,threadReadCacheStore:cache,threadSearchIndexStore:{clear(){}},statusDiagnostics:{observeThreadRead(){}},getErrorMessage:(e,f)=>e?.message||f,writeWarning(){},writeReconcileFailure(){},
  isManagedThread:id=>m.readAssistantRoleBinding(store)?.threadId===id||!!coordinator?.isWorkerThread(id),readAssistantMainClientMessageId:()=>store.readAssistantMainConversation()?.clientMessageId??null,
  assistantMainSetup:{readInstructions:()=>coordinator.mainSetup.readInstructions(),readTools:()=>coordinator.mainSetup.readTools(),onThreadCreated:r=>coordinator.mainSetup.onThreadCreated(r)},resumeAssistantTask:p=>coordinator.resumePending(p),
 })
 native.reconciliations=[]
 coordinator=m.createAssistantCoordinator({appServer:app,store,runtime:{...runtime,reconcileRuntimeThread:async id=>{native.reconciliations.push(id);return runtime.reconcileRuntimeThread(id)}},readAssets:()=>assets,readReportQueue:()=>queue,onError:e=>native.errors.push(e)})
 if(enableReports)queue=new m.RuntimeMessageQueue({store,startRuntimeTurn:p=>coordinator.startReport(p)??runtime.startRuntimeTurnSettled(p),rpc:(method,p)=>app.rpc(method,p),shouldApplyQueuedSpeedMode:()=>false,publishNotification(){},getErrorMessage:(e,f)=>e?.message||f})
 app.setRpcPolicy(coordinator.policy);app.setRpcWriteGuard(coordinator.beforeWrite);app.setServerRequestInterceptor(coordinator.intercept)
 async function main(){const identity=store.writeAssistantIdentity({name:'Synthetic assistant',cwd:'E:/synthetic',revision:null}).identity;store.reserveAssistantMainConversation({assistantId:identity.assistantId,revision:1,clientMessageId:'assistant-main:synthetic',cwd:identity.cwd,promptHash:'reservation-hash'});await runtime.startAssistantConversation({clientMessageId:'assistant-main:synthetic',cwd:identity.cwd,model:'synthetic-model',input:[{type:'text',text:'Please delegate this supplied text analysis.'}]});await until(()=>store.getLatestRequestByClientMessageId('assistant-main:synthetic')?.status==='running');return store.getLatestRequestByClientMessageId('assistant-main:synthetic')}
 return{file,store,app,runtime,native,coordinator,queue,main,close(){queue?.dispose();coordinator.dispose();runtime.runtimeReconcileScheduler.dispose();store.close()}}
}

test('worker final queues behind busy main, then exactly one private report reaches explicit final',async()=>{
 const f=fixture(true);try{
  const main=await f.main();f.app.handleServerRequest(3001,'item/tool/call',{threadId:main.threadId,turnId:main.turnId,callId:'dispatch-report',namespace:null,tool:'assistant_dispatch_task',arguments:{title:'Report task',instructions:'Analyze supplied text'}})
  await until(()=>f.coordinator.listTasks()[0]?.executionStatus==='running');const dto=f.coordinator.listTasks()[0],task=f.store.assistantTasks.listTasks(f.store.readAssistantIdentity().assistantId)[0]
  const worker=f.native.threads.get(dto.threadId).turns[0];worker.status='completed';worker.items.push({type:'agentMessage',phase:'commentary',text:'not final'})
  await f.coordinator.kick();assert.equal(f.store.assistantTasks.readTask(task.taskId).report,undefined,'commentary cannot freeze result');assert.ok(f.native.reconciliations.includes(dto.threadId),'authoritative worker terminal must also converge existing Runtime/board state')
  worker.items.push({type:'agentMessage',phase:'final_answer',text:'WORKER_FINAL'});await f.coordinator.kick();await tick()
  const frozen=f.store.assistantTasks.readTask(task.taskId).report;assert.equal(frozen.status,'pending');assert.equal(f.store.getRequest(frozen.requestId).status,'queued');assert.equal(f.native.calls.filter(c=>c.method==='turn/start').length,2,'busy main keeps report queued')
  const mainTurn=f.native.threads.get(main.threadId).turns[0];mainTurn.status='completed';mainTurn.items.push({type:'agentMessage',phase:'final_answer',text:'Accepted'})
  f.store.updateRequest(main.requestId,{status:'completed'});f.queue.handleRuntimeEvent('turn/completed',main.threadId)
  try{await until(()=>f.store.getRequest(frozen.requestId)?.status==='running')}catch(e){const r=f.store.getRequest(frozen.requestId);assert.fail(JSON.stringify({status:r?.status,error:r?.lastError,errors:f.native.errors.map(e=>e.message),calls:f.native.calls.map(c=>c.method),payloadKeys:Object.keys(r?.payload||{})}))}const report=f.store.assistantTasks.readTask(task.taskId).report;assert.equal(report.writeStarted,true);assert.ok(report.turnId)
  await Promise.all([f.coordinator.kick(),f.coordinator.kick()]);assert.equal(f.native.calls.filter(c=>c.method==='turn/start').length,3)
  const reportTurn=f.native.threads.get(main.threadId).turns.find(t=>t.id===report.turnId);f.store.updateRequest(report.requestId,{status:'completed'});await f.coordinator.kick();assert.equal(f.store.assistantTasks.readTask(task.taskId).report.status,'pending','local completed is not delivery')
  reportTurn.status='completed';reportTurn.items.push({type:'agentMessage',phase:'commentary',text:'still not final'});await f.coordinator.kick();assert.equal(f.store.assistantTasks.readTask(task.taskId).report.status,'pending')
  reportTurn.items.push({type:'agentMessage',phase:'final_answer',text:'USER_SUMMARY'});await f.coordinator.kick();assert.equal(f.store.assistantTasks.readTask(task.taskId).report.status,'delivered')
  await f.coordinator.kick();assert.equal(f.native.calls.filter(c=>c.method==='turn/start').length,3);assert.equal(f.native.calls.filter(c=>c.method==='config/batchWrite').length,0)
  const restored=[];const cold=m.createAssistantCoordinator({appServer:f.app,store:f.store,runtime:{...f.runtime,reconcileRuntimeThread:async id=>{restored.push(id);return f.runtime.reconcileRuntimeThread(id)}},readAssets:()=>assets,onError:e=>f.native.errors.push(e)})
  await cold.kick();assert.deepEqual(restored,[dto.threadId],'cold startup converges already delivered workers through existing Runtime');assert.equal(f.native.calls.filter(c=>c.method==='turn/start').length,3);cold.dispose()
 }finally{f.close()}
})
test('real bridge primitives register main tools and route trusted native dispatch into one read-only worker',async()=>{
 const f=fixture();try{const main=await f.main();assert.equal(f.coordinator.canDispatch(),true);assert.equal(f.native.threads.get(main.threadId).toolNames.length,3)
 const params={threadId:main.threadId,turnId:main.turnId,callId:'native-call',namespace:null,tool:'assistant_dispatch_task',arguments:{title:'Analyze text',instructions:'Return a brief analysis of the supplied text.'}}
 f.app.handleServerRequest(1001,'item/tool/call',params);await until(()=>f.coordinator.listTasks().some(t=>t.executionStatus==='running')&&f.native.replies.some(r=>r.id===1001));const task=f.coordinator.listTasks()[0];assert.notEqual(task.threadId,main.threadId);assert.equal(task.permissions,'read-only');const workerStart=f.native.calls.filter(c=>c.method==='thread/start')[1];assert.equal(workerStart.params.sandbox,'read-only');assert.deepEqual(workerStart.params.dynamicTools,[])
 f.app.handleServerRequest(1002,'item/tool/call',{...params,callId:'native-call-again'});await until(()=>f.native.replies.some(r=>r.id===1002));assert.equal(f.coordinator.listTasks().length,1);assert.equal(f.native.calls.filter(c=>c.method==='thread/start').length,2)
 assert.equal(f.coordinator.isPublicRpcAllowed('turn/start',{threadId:task.threadId,input:[]}),false);await assert.rejects(f.app.rpc('turn/start',{threadId:task.threadId,input:[]}));assert.equal(f.native.calls.filter(c=>c.method==='turn/start').length,2);assert.equal(f.coordinator.isPublicRpcAllowed('turn/start',{threadId:main.threadId,clientUserMessageId:'assistant-report:forged'}),false)
 assert.equal(f.native.errors.length,0)
 }finally{f.close()}
})
test('main binding survives Runtime request retention and conflicting native binding fails closed',async()=>{
 const f=fixture();try{const main=await f.main();f.store.db.prepare('DELETE FROM runtime_requests WHERE request_id=?').run(main.requestId);assert.equal(m.readAssistantRoleBinding(f.store).threadId,main.threadId);assert.equal(f.coordinator.mainThreadId(),main.threadId);assert.equal(f.coordinator.canDispatch(),true)
 f.store.createRequest({requestId:'conflicting',clientMessageId:'assistant-main:synthetic',threadId:'other-native-id',status:'completed',promptHash:'synthetic',mode:'execute',payload:{}});assert.throws(()=>m.readAssistantRoleBinding(f.store))
 }finally{f.close()}
})
test('a second host sharing Runtime cannot advertise or register automatic execution ownership',async()=>{
 const f=fixture();let second;try{await f.main();second=new m.RuntimeStore(f.file);assert.equal(second.assistantTasks.isHostOwner(second.readAssistantIdentity().assistantId),false);assert.throws(()=>second.assistantTasks.claimHost(second.readAssistantIdentity().assistantId));assert.equal(f.coordinator.canDispatch(),true)
 }finally{second?.close();f.close()}
})
test('a stale native generation cannot admit work or reply into its replacement after an async read',async()=>{
 const f=fixture();try{const main=await f.main();let release;f.native.readGate=new Promise(r=>release=r);const params={threadId:main.threadId,turnId:main.turnId,callId:'old-native-call',namespace:null,tool:'assistant_dispatch_task',arguments:{title:'Stale',instructions:'Do not admit after native replacement'}};f.app.handleServerRequest(2001,'item/tool/call',params);await tick();f.native.generation++;release();await tick();await tick();assert.equal(f.coordinator.listTasks().length,0);assert.equal(f.native.replies.filter(r=>r.id===2001).length,0)
 }finally{f.close()}
})
