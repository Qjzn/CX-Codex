import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/task-executor-'))
process.env.CODEX_HOME=path.join(out,'home');fs.mkdirSync(process.env.CODEX_HOME)
const bundle=path.join(out,'executor.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/server/runtimeStore.ts';export * from './src/server/appServerRuntimeStart.ts';export * from './src/server/appServerRuntimeInterrupt.ts';export * from './src/server/assistantWorkerBoundary.ts';export * from './src/server/assistantTaskExecutor.ts';"},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const {RuntimeStore,startRuntimeTurnWithAppServer,interruptRuntimeTurnWithAppServer,AssistantWorkerBoundary,AssistantTaskExecutor}=await import(pathToFileURL(bundle).href)
let sequence=0
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
function fixture(){
 const store=new RuntimeStore(path.join(out,`case-${sequence++}.sqlite`)),ledger=store.assistantTasks;ledger.claimHost('assistant')
 const state={calls:[],turns:new Map(),errors:[],threadGate:null,turnGate:null,onThread:deferred(),onTurn:deferred(),interruptUnknown:false,captured:[]}
 const boundary=new AssistantWorkerBoundary({ledger,readAssistantId:()=> 'assistant',readMainThreadId:()=> 'main',readConfig:async()=>({config:{}})})
 const native=async(method,p)=>{
  state.calls.push({method,params:p})
  if(method==='thread/start'){state.onThread.resolve();if(state.threadGate)await state.threadGate.promise;return{thread:{id:'worker-'+state.calls.filter(c=>c.method===method).length}}}
  if(method==='turn/start'){state.onTurn.resolve();if(state.turnGate)await state.turnGate.promise;const turn={id:'turn-'+state.calls.filter(c=>c.method===method).length,status:'inProgress',items:[]};state.turns.set(p.threadId,turn);return{turn}}
  if(method==='turn/interrupt'){if(state.interruptUnknown)throw Error('synthetic unknown interrupt');state.turns.get(p.threadId).status='interrupted';return{}}
  throw Error('Unexpected synthetic native method '+method)
 }
 const rpcFor=task=>{const context=boundary.contextFor(task.taskId);return async(method,params)=>{const frozen=await boundary.transform(method,params,context);boundary.beforeWrite(method,frozen,context);const result=await native(method,frozen);boundary.observeReply(method,result,context);return result}}
 const runtimeDeps=rpc=>({rpc,createRequest:r=>store.createRequest(r),updateRequest:(id,p)=>store.updateRequest(id,p),getRequest:id=>store.getRequest(id),getLatestRequestByClientMessageId:id=>store.getLatestRequestByClientMessageId(id),clearThreadSearchIndex(){},markQueued(){},markStarting(){},markRunning(){},markStartUncertain(){},markFailed(){},markStopping(){},markInterrupted(){},markStopUncertain(){},markPlanModeTurn(){},clearPlanModeTurn(){},persistRuntimeSnapshot:()=>({activeTurnId:''}),getErrorMessage:(e,f)=>e?.message||f})
 const deps={ledger,readAssistantId:()=> 'assistant',startWorker:(task,payload)=>startRuntimeTurnWithAppServer(payload,runtimeDeps(rpcFor(task))),interruptWorker:(task,payload)=>interruptRuntimeTurnWithAppServer(payload,runtimeDeps(rpcFor(task))),readThread:async task=>({thread:{id:task.threadId,turns:[state.turns.get(task.threadId)].filter(Boolean)}}),getExecution:id=>store.getLatestRequestByClientMessageId(id),updateExecution:(id,p)=>store.updateRequest(id,p),onTerminal:(task,turn)=>{assert.equal(ledger.readCoordinator('assistant').activeTaskId,task.taskId);state.captured.push({taskId:task.taskId,turn})},onError:e=>state.errors.push(e)}
 const executor=new AssistantTaskExecutor(deps)
 const accept=source=>ledger.accept({assistantId:'assistant',sourceRequestId:source,sourceThreadId:'main',sourceTurnId:'source-'+source,sourceText:'User request',title:source,instructions:'Frozen '+source,cwd:'E:/synthetic',model:'synthetic-model',permissions:'read-only',assetsHash:'hash',relatedTaskId:null})
 return{store,ledger,state,deps,executor,accept,close(){executor.dispose();store.close()}}
}
test('coalesced admission uses one existing Runtime request and one worker slot',async()=>{
 const f=fixture();try{const a=f.accept('a'),b=f.accept('b');await Promise.all([f.executor.kick(),f.executor.kick()]);assert.equal(f.state.calls.filter(c=>c.method==='thread/start').length,1);assert.equal(f.state.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId);assert.equal(f.store.getLatestRequestByClientMessageId(b.executionClientMessageId),null);assert.equal(f.state.errors.length,0)
 const running=f.store.getLatestRequestByClientMessageId(a.executionClientMessageId);f.store.updateRequest(running.requestId,{status:'completed'});await f.executor.kick();assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId,'local completed is not native terminal proof')
 f.state.turns.get('worker-1').status='completed';await f.executor.kick();assert.equal(f.state.captured[0].taskId,a.taskId);assert.equal(f.state.calls.filter(c=>c.method==='thread/start').length,2);assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,b.taskId)
 }finally{f.close()}
})
test('unknown creation survives repeat kicks and blocks replacement execution',async()=>{
 const f=fixture();try{const a=f.accept('a');f.accept('b');const original=f.deps.startWorker;f.deps.startWorker=async(task,payload)=>{f.ledger.takeBoundary(task.taskId,'thread');throw Error('synthetic response lost')};await f.executor.kick();await f.executor.kick();assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId);assert.equal(f.ledger.readTask(a.taskId).threadId,'');assert.equal(f.state.calls.length,0);assert.ok(f.state.errors.length>=1);f.deps.startWorker=original;await f.executor.kick();assert.equal(f.state.calls.length,0,'must not recreate unknown native thread')
 }finally{f.close()}
})
test('stop before late thread receipt prevents execution turn and safely frees slot',async()=>{
 const f=fixture();try{const a=f.accept('a');f.state.threadGate=deferred();const pending=f.executor.kick();await f.state.onThread.promise;f.ledger.requestStop(a.taskId);f.state.threadGate.resolve();await pending;assert.equal(f.state.calls.filter(c=>c.method==='turn/start').length,0);assert.equal(f.state.calls.filter(c=>c.method==='turn/interrupt').length,0);assert.equal(f.ledger.readTask(a.taskId).threadId,'worker-1');assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,null);assert.equal(f.ledger.readTask(a.taskId).stopRequested,true)
 }finally{f.close()}
})
test('late turn receipt fulfills first stop once; unknown interrupt is never replayed',async()=>{
 const f=fixture();try{const a=f.accept('a');f.accept('b');f.state.turnGate=deferred();f.state.interruptUnknown=true;const pending=f.executor.kick();await f.state.onTurn.promise;f.ledger.requestStop(a.taskId);f.state.turnGate.resolve();await pending;assert.equal(f.state.calls.filter(c=>c.method==='turn/interrupt').length,1,JSON.stringify({errors:f.state.errors.map(e=>e.message),calls:f.state.calls.map(c=>c.method),task:f.ledger.readTask(a.taskId),active:f.ledger.readCoordinator('assistant')}));await f.executor.kick();assert.equal(f.state.calls.filter(c=>c.method==='turn/interrupt').length,1);assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId);assert.equal(f.state.calls.filter(c=>c.method==='thread/start').length,1)
 f.state.turns.get('worker-1').status='interrupted';await f.executor.kick();assert.equal(f.state.calls.filter(c=>c.method==='thread/start').length,2);assert.equal(f.state.calls.filter(c=>c.method==='turn/interrupt').length,1)
 }finally{f.close()}
})
test('a proven pre-write request resumes with its exact original identity after executor recreation',async()=>{
 const f=fixture();try{const a=f.accept('a');f.ledger.claimExecution(a.taskId);const {createHash}=await import('node:crypto');const input=[{type:'text',text:a.contract.instructions}];f.store.createRequest({requestId:a.executionRequestId,clientMessageId:a.executionClientMessageId,threadId:'',status:'starting',promptHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),mode:'execute',payload:{}});f.executor.dispose();const restored=new AssistantTaskExecutor(f.deps);await restored.kick();assert.equal(f.state.calls.filter(c=>c.method==='thread/start').length,1);assert.equal(f.store.getLatestRequestByClientMessageId(a.executionClientMessageId).requestId,a.executionRequestId);assert.equal(f.ledger.listTasks('assistant').length,1);restored.dispose()
 }finally{f.close()}
})
