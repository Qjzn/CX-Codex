import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/worker-boundary-'))
const bundle=path.join(out,'boundary.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/server/assistantTaskLedger.ts'; export * from './src/server/assistantWorkerBoundary.ts';"},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const {AssistantTaskLedger,AssistantWorkerBoundary}=await import(pathToFileURL(bundle).href)
let count=0
function fixture(permissions='read-only'){
 const db=new Database(path.join(out,`fixture-${count++}.sqlite`));db.exec('CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');const ledger=new AssistantTaskLedger(db,{pid:process.pid,nonce:'owner'},()=>true);ledger.claimHost('assistant')
 const task=ledger.accept({assistantId:'assistant',sourceRequestId:'user',sourceThreadId:'main',sourceTurnId:'turn',sourceText:'Original user request',title:'Task',instructions:'Frozen worker instructions',cwd:'E:/synthetic',model:'synthetic-model',permissions,assetsHash:'hash',relatedTaskId:null});ledger.claimExecution(task.taskId)
 const boundary=new AssistantWorkerBoundary({ledger,readAssistantId:()=> 'assistant',readMainThreadId:()=> 'main',readConfig:async()=>({config:{mcp_servers:{synthetic:{token:'DO_NOT_LEAK'}}}})})
 try { return {db,ledger,task,boundary,context:boundary.contextFor(task.taskId)} } catch(error) { db.close();throw error }
}
test('private context fixes worker scope/input/model; external boundaries atomically claim once',async()=>{
 const {db,ledger,task,boundary,context}=fixture()
 const thread=await boundary.transform('thread/start',{cwd:'E:/foreign',sandbox:'danger-full-access',dynamicTools:[{name:'evil'}]},context)
 assert.equal(thread.cwd,'E:/synthetic');assert.equal(thread.sandbox,'read-only');assert.equal(thread.model,'synthetic-model');assert.deepEqual(thread.dynamicTools,[]);assert.equal(JSON.stringify(thread).includes('DO_NOT_LEAK'),false)
 boundary.beforeWrite('thread/start',thread,context);assert.throws(()=>boundary.beforeWrite('thread/start',thread,context));boundary.observeReply('thread/start',{thread:{id:'worker'}},context)
 const turn=await boundary.transform('turn/start',{threadId:'foreign',input:[{type:'text',text:'altered'}],model:'other'},context)
 assert.equal(turn.threadId,'worker');assert.equal(turn.model,'synthetic-model');assert.deepEqual(turn.input,[{type:'text',text:'Frozen worker instructions'}]);assert.deepEqual(turn.sandboxPolicy,{type:'readOnly',networkAccess:false})
 boundary.beforeWrite('turn/start',turn,context);boundary.observeReply('turn/start',{turn:{id:'native-turn'}},context);assert.equal(ledger.readTask(task.taskId).turnId,'native-turn');assert.throws(()=>boundary.beforeWrite('turn/start',turn,context));db.close()
})
test('stop arriving after async transform still blocks actual write and survives late native ID',async()=>{
 const {db,ledger,task,boundary,context}=fixture();const thread=await boundary.transform('thread/start',{},context);boundary.beforeWrite('thread/start',thread,context);ledger.requestStop(task.taskId);boundary.observeReply('thread/start',{thread:{id:'late-worker'}},context)
 const turn=await boundary.transform('turn/start',{},context);assert.throws(()=>boundary.beforeWrite('turn/start',turn,context));assert.equal(ledger.readTask(task.taskId).boundaries.turn,false);assert.equal(ledger.releaseExecution(task.taskId,{kind:'not-sent'}),true);db.close()
})
test('unbound ID leak, public worker mutation and fake context are rejected before native effect',async()=>{
 const {db,ledger,task,boundary,context}=fixture();const thread=await boundary.transform('thread/start',{},context);boundary.beforeWrite('thread/start',thread,context)
 await assert.rejects(boundary.transform('turn/start',{threadId:'leaked-worker'}));assert.throws(()=>boundary.beforeWrite('thread/resume',{threadId:'leaked-worker'}))
 boundary.observeReply('thread/start',{thread:{id:'worker'}},context)
 for(const method of ['turn/start','turn/interrupt','thread/fork','thread/resume','thread/shellCommand','thread/queue/add']){await assert.rejects(boundary.transform(method,{threadId:'worker'}));assert.throws(()=>boundary.beforeWrite(method,{threadId:'worker'}))}
 await assert.rejects(boundary.transform('thread/start',{},{}));await assert.rejects(boundary.transform('thread/resume',{threadId:'foreign',path:'rollout'}))
 assert.deepEqual(await boundary.transform('thread/read',{threadId:'worker'}),{threadId:'worker'});assert.deepEqual(await boundary.transform('turn/start',{threadId:'ordinary'}),{threadId:'ordinary'});db.close()
})
test('only once-only scoped interrupt is possible; no host tools or unsupported write permissions',async()=>{
 const {db,ledger,task,boundary,context}=fixture();boundary.beforeWrite('thread/start',{},context);boundary.observeReply('thread/start',{thread:{id:'worker'}},context);boundary.beforeWrite('turn/start',{},context);boundary.observeReply('turn/start',{turn:{id:'turn'}},context);ledger.requestStop(task.taskId)
 const p=await boundary.transform('turn/interrupt',{threadId:'foreign',turnId:'foreign'},context);assert.deepEqual(p,{threadId:'worker',turnId:'turn'});boundary.beforeWrite('turn/interrupt',p,context);assert.throws(()=>boundary.beforeWrite('turn/interrupt',p,context));await assert.rejects(boundary.transform('config/value/write',{},context));db.close()
 assert.throws(()=>fixture('workspace-write'))
})
test('an occupied slot whose task record is missing cannot disable native mutation protection',()=>{
 const {db,ledger,task,boundary}=fixture();ledger.takeBoundary(task.taskId,'thread');db.prepare('DELETE FROM runtime_metadata WHERE key=?').run('assistant_task:'+task.taskId);assert.throws(()=>boundary.beforeWrite('turn/start',{threadId:'unknown-worker'}));db.close()
})
