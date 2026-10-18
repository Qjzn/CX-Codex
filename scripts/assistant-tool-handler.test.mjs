import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/tool-handler-'))
const bundle=path.join(out,'handler.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/server/assistantTaskLedger.ts';export * from './src/server/assistantToolHandler.ts';"},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const {AssistantTaskLedger,createAssistantToolHandler}=await import(pathToFileURL(bundle).href)
let index=0
function fixture(){
 const db=new Database(path.join(out,`case-${index++}.sqlite`));db.exec('CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');const ledger=new AssistantTaskLedger(db,{pid:process.pid,nonce:'host'},()=>true)
 const request={requestId:'trusted-source',clientMessageId:'user-message',threadId:'main-uuid',turnId:'native-turn',status:'running',payload:{model:'selected-model'}}
 const state={requests:[request],native:{thread:{id:'main-uuid',turns:[{id:'native-turn',status:'inProgress',items:[{type:'userMessage',content:[{type:'text',text:'Authoritative user original'}]}]}]}},changes:0}
 const deps={ledger,readIdentity:()=>({assistantId:'assistant',cwd:'E:/synthetic'}),readMainThreadId:()=> 'main-uuid',listMainRequests:()=>state.requests,readThread:async()=>state.native,readDefaultModel:async()=> 'fallback-model',assetsHash:'trusted-assets',workerBrief:'Read-only worker brief',getExecution:()=>null,onChanged:()=>state.changes++}
 return{db,ledger,state,deps,handler:createAssistantToolHandler(deps),params:{threadId:'main-uuid',turnId:'native-turn',callId:'real-call',namespace:null,tool:'assistant_dispatch_task',arguments:{title:'Task',instructions:'Produce analysis'}}}
}
test('native source, frozen model/workspace/assets and source-level idempotency are persisted',async()=>{
 const {db,ledger,state,handler,params}=fixture();const first=await handler.handle('item/tool/call',params);assert.equal(first.status,'accepted');const task=ledger.readTask(first.taskId);assert.equal(task.contract.sourceRequestId,'trusted-source');assert.equal(task.contract.sourceTurnId,'native-turn');assert.equal(task.contract.sourceText,'Authoritative user original');assert.equal(task.contract.model,'selected-model');assert.equal(task.contract.cwd,'E:/synthetic');assert.equal(task.contract.permissions,'read-only');assert.equal(task.contract.assetsHash,'trusted-assets');assert.ok(task.contract.instructions.includes('Read-only worker brief'));assert.ok(task.contract.instructions.includes('Authoritative user original'));assert.ok(task.contract.instructions.includes('Produce analysis'))
 const second=await handler.handle('item/tool/call',{...params,callId:'different-call'});assert.equal(second.taskId,first.taskId);assert.equal(ledger.listTasks('assistant').length,1);await assert.rejects(handler.handle('item/tool/call',{...params,arguments:{title:'Changed',instructions:'Different contract'}}));assert.equal(ledger.listTasks('assistant').length,1);assert.ok(state.changes>=1);db.close()
})
for(const kind of ['completed-native','wrong-native-turn','non-text-attachment','multiple-user-items'])test(`dispatch refuses ${kind}`,async()=>{
 const {db,ledger,state,handler,params}=fixture();const turn=state.native.thread.turns[0]
 if(kind==='completed-native')turn.status='completed';if(kind==='wrong-native-turn')turn.id='different';if(kind==='non-text-attachment')turn.items[0].content.push({type:'image',url:'synthetic'});if(kind==='multiple-user-items')turn.items.push({...turn.items[0]})
 await assert.rejects(handler.handle('item/tool/call',params));assert.equal(ledger.listTasks('assistant').length,0);db.close()
})
test('source is rechecked after awaited model lookup and cannot dispatch from stale turn',async()=>{
 const {db,ledger,state,deps,params}=fixture();state.requests[0].payload={};deps.readDefaultModel=async()=>{state.requests[0].status='completed';return 'fallback-model'};const handler=createAssistantToolHandler(deps);await assert.rejects(handler.handle('item/tool/call',params));assert.equal(ledger.listTasks('assistant').length,0);db.close()
})
test('unreadable identity or execution storage stays visible, never an empty/queued task list',async()=>{
 const {db,deps,params,handler}=fixture();await handler.handle('item/tool/call',params)
 deps.readIdentity=()=>{throw Error('identity unavailable')};assert.throws(()=>createAssistantToolHandler(deps).list(),/unavailable/)
 deps.readIdentity=()=>({assistantId:'assistant',cwd:'E:/synthetic'});deps.getExecution=()=>{throw Error('execution unavailable')};assert.throws(()=>createAssistantToolHandler(deps).list(),/unavailable/);db.close()
})
test('internal reports can read only; exposed task list excludes source/prompt/host internals',async()=>{
 const {db,ledger,state,handler,params}=fixture();const accepted=await handler.handle('item/tool/call',params);const shown=handler.list();assert.equal(shown.length,1);for(const value of ['Authoritative user original','Produce analysis','host','sourceText','contractHash'])assert.equal(JSON.stringify(shown).includes(value),false)
 state.requests[0].clientMessageId='assistant-report:trusted';await assert.rejects(handler.handle('item/tool/call',params));const read=await handler.handle('item/tool/call',{...params,tool:'assistant_read_tasks',arguments:{}});assert.equal(read.tasks.length,1);await assert.rejects(handler.handle('item/tool/call',{...params,tool:'assistant_stop_task',arguments:{taskId:accepted.taskId}}));assert.equal(ledger.readTask(accepted.taskId).stopRequested,false)
 state.requests[0].clientMessageId='user-message';const stopped=await handler.handle('item/tool/call',{...params,tool:'assistant_stop_task',arguments:{taskId:accepted.taskId}});assert.equal(stopped.stopRequested,true);assert.equal(stopped.status,undefined);assert.equal(ledger.readTask(accepted.taskId).stopRequested,true);db.close()
})
