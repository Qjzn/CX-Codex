import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/report-'))
process.env.CODEX_HOME=path.join(out,'home');fs.mkdirSync(process.env.CODEX_HOME)
const file=path.join(out,'report.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/server/assistantTaskLedger.ts';export * from './src/server/assistantReportDelivery.ts';export * from './src/server/runtimeStore.ts';export * from './src/server/appServerRuntimeRequestReconciliation.ts';"},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const m=await import(pathToFileURL(file).href)
let seq=0
test('old thread snapshot cannot settle managed request without native turn receipt',()=>{
 const f=fixture();try{
  for(const prefix of ['assistant-main:','assistant-task:','assistant-report:']){f.store.createRequest({requestId:prefix+'unsent',clientMessageId:prefix+'unsent',threadId:prefix+'main',status:'pending_start',promptHash:'hash',mode:'execute',payload:{durable:'keep'}});m.updateRuntimeRequestsFromSnapshot(prefix+'main',{executionState:'completed',inProgress:false,activeTurnId:'old-turn',lastError:null},f.store)}
  for(const prefix of ['assistant-main:','assistant-task:','assistant-report:']){const request=f.store.getRequest(prefix+'unsent');assert.equal(request.status,'pending_start');assert.equal(request.turnId,'');assert.deepEqual(request.payload,{durable:'keep'})}
 }finally{f.close()}
})
function fixture(){
 const store=new m.RuntimeStore(path.join(out,'case-'+seq+++'.sqlite')),ledger=new m.AssistantTaskLedger(store.db,{pid:process.pid,nonce:'synthetic-owner'},()=>true),native=new Map(),errors=[],sent=[],cancelled=[]
 ledger.claimHost('assistant');native.set('main',{thread:{id:'main',turns:[]}})
 const queue={enqueue(payload){sent.push(payload);store.createRequest({requestId:payload.requestId,clientMessageId:payload.clientMessageId,threadId:'main',status:'queued',promptHash:ledger.listTasks('assistant').find(t=>t.report?.requestId===payload.requestId).report.promptHash,mode:'execute',payload});return{status:'completed'}},async cancel(id){cancelled.push(id);const request=store.getRequest(id);if(!request||!['queued','queue_failed'].includes(request.status))return false;store.updateRequest(id,{status:'interrupted'});return true}}
 const deps={ledger,readAssistantId:()=> 'assistant',readMainThreadId:()=> 'main',readThread:async id=>structuredClone(native.get(id)),getExecution:id=>store.getLatestRequestByClientMessageId(id),readQueue:()=>queue,onError:e=>errors.push(e)}
 let delivery=m.createAssistantReportDelivery(deps)
 function task(source,final=true,status='completed'){
  let task=ledger.accept({assistantId:'assistant',sourceRequestId:source,sourceThreadId:'main',sourceTurnId:'source-'+source,sourceText:'supplied text',title:source,instructions:'analyze',cwd:'E:/Synthetic',model:'synthetic-model',permissions:'read-only',assetsHash:'hash',relatedTaskId:null});ledger.claimExecution(task.taskId);ledger.takeBoundary(task.taskId,'thread');ledger.bindNative(task.taskId,{threadId:'worker-'+source});ledger.takeBoundary(task.taskId,'turn');ledger.bindNative(task.taskId,{turnId:'turn-'+source});task=ledger.readTask(task.taskId);ledger.releaseExecution(task.taskId,{kind:'terminal',threadId:task.threadId,turnId:task.turnId,status});native.set(task.threadId,{thread:{id:task.threadId,turns:[{id:task.turnId,status,items:final?[{type:'agentMessage',phase:'final_answer',text:'result-'+source}]:[{type:'agentMessage',phase:'commentary',text:'not final'}]}]}});return task
 }
 return{store,ledger,native,errors,sent,cancelled,deps,task,get delivery(){return delivery},restart(){delivery.dispose();const takeover=new m.AssistantTaskLedger(store.db,{pid:process.pid,nonce:'synthetic-replacement'},()=>false);delivery=m.createAssistantReportDelivery({...deps,ledger:takeover});return takeover},close(){delivery.dispose();store.close()}}
}
test('missing final is revisited; unknown written report survives takeover without duplicate enqueue, newer result still freezes',async()=>{
 const f=fixture();try{
  const a=f.task('a',false);await f.delivery.kick();assert.equal(f.sent.length,0)
  f.native.get(a.threadId).thread.turns[0].items.push({type:'agentMessage',phase:'final_answer',text:'result-a'});await f.delivery.kick();assert.equal(f.sent.length,1)
  const report=f.ledger.readTask(a.taskId).report;assert.equal(report.status,'pending','enqueue return completed is not delivery')
  f.ledger.takeReportBoundary(a.taskId);f.store.updateRequest(report.requestId,{status:'queue_failed'});const b=f.task('b');await f.delivery.kick();assert.ok(f.ledger.readTask(b.taskId).report);assert.equal(f.sent.length,1);assert.equal(f.cancelled.length,0)
  const replacement=f.restart();await f.delivery.kick();await f.delivery.kick();assert.equal(f.sent.length,1);assert.equal(replacement.readCoordinator('assistant').activeReportTaskId,a.taskId);assert.equal(replacement.readTask(a.taskId).report.writeStarted,true)
 }finally{f.close()}
})
test('proven unwritten failed queue head releases only its report slot and allows next report',async()=>{
 const f=fixture();try{const a=f.task('a'),b=f.task('b');await f.delivery.kick();const report=f.ledger.readTask(a.taskId).report;f.store.updateRequest(report.requestId,{status:'queue_failed'});await f.delivery.kick();assert.deepEqual(f.cancelled,[report.requestId]);assert.equal(f.ledger.readTask(a.taskId).report.status,'attention');assert.equal(f.sent.length,2);assert.equal(f.ledger.readCoordinator('assistant').activeReportTaskId,b.taskId)
 }finally{f.close()}
})
test('exact report final after 100 main turns settles once; local completed and commentary remain pending',async()=>{
 const f=fixture();try{const a=f.task('a');await f.delivery.kick();const report=f.ledger.readTask(a.taskId).report;f.ledger.takeReportBoundary(a.taskId);f.ledger.bindReportTurn(a.taskId,'main','main-report');f.store.updateRequest(report.requestId,{status:'completed',turnId:'main-report'});const turns=Array.from({length:110},(_,i)=>({id:'old-'+i,status:'completed',items:[]}));turns.push({id:'main-report',status:'completed',items:[{type:'agentMessage',phase:'commentary',text:'commentary'}]});f.native.set('main',{thread:{id:'main',turns}});await f.delivery.kick();assert.equal(f.ledger.readTask(a.taskId).report.status,'pending');turns.at(-1).items.push({type:'agentMessage',phase:'final_answer',text:'user summary'});await f.delivery.kick();assert.equal(f.ledger.readTask(a.taskId).report.status,'delivered');await f.delivery.kick();assert.equal(f.sent.length,1)
 }finally{f.close()}
})
