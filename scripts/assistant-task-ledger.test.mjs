import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/task-ledger-'))
const bundle=path.join(out,'ledger.mjs')
await build({entryPoints:['src/server/assistantTaskLedger.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const {AssistantTaskLedger}=await import(pathToFileURL(bundle).href)
const contract=(source='source')=>({assistantId:'assistant',sourceRequestId:source,sourceThreadId:'main',sourceTurnId:'turn-'+source,sourceText:'User original request',title:'Task',instructions:'Do exact task',cwd:'E:/synthetic',model:'synthetic-model',permissions:'read-only',assetsHash:'hash',relatedTaskId:null})
function completedTask(f,source='report') { const task=f.ledger.accept(contract(source));f.ledger.claimExecution(task.taskId);f.ledger.takeBoundary(task.taskId,'thread');f.ledger.bindNative(task.taskId,{threadId:'worker-'+source});f.ledger.takeBoundary(task.taskId,'turn');f.ledger.bindNative(task.taskId,{turnId:'worker-turn-'+source});return f.ledger.readTask(task.taskId) }
test('report freezes exact result and payload atomically, serializes reports independently of execution',()=>{
 const f=fixture('report-freeze');try{
  const a=completedTask(f),e={threadId:a.threadId,turnId:a.turnId,status:'completed',text:'Explicit worker final'}
  assert.throws(()=>f.ledger.freezeReport(a.taskId,{...e,text:''},'main'))
  const report=f.ledger.freezeReport(a.taskId,e,'main');assert.equal(report.requestId,'assistant-report:'+a.taskId);assert.match(report.prompt,/^<codex_internal_context /)
  assert.deepEqual(f.ledger.freezeReport(a.taskId,e,'main'),report);assert.throws(()=>f.ledger.freezeReport(a.taskId,{...e,text:'different'},'main'))
  assert.equal(f.ledger.claimReport(a.taskId),true);assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId)
  assert.equal(f.ledger.takeReportBoundary(a.taskId),true);assert.equal(f.ledger.takeReportBoundary(a.taskId),false);assert.throws(()=>f.ledger.failReportBeforeWrite(a.taskId))
  f.ledger.bindReportTurn(a.taskId,'main','report-turn');assert.throws(()=>f.ledger.bindReportTurn(a.taskId,'main','other-turn'))
  assert.throws(()=>f.ledger.finishReport(a.taskId,{threadId:'main',turnId:'report-turn',status:'completed',text:''}))
  assert.throws(()=>f.ledger.finishReport(a.taskId,{threadId:'other',turnId:'report-turn',status:'completed',text:'summary'}))
  f.ledger.finishReport(a.taskId,{threadId:'main',turnId:'report-turn',status:'completed',text:'summary'})
  assert.equal(f.ledger.readTask(a.taskId).report.status,'delivered');assert.equal(f.ledger.readCoordinator('assistant').activeReportTaskId,null);assert.equal(f.ledger.readCoordinator('assistant').activeTaskId,a.taskId)
  f.ledger.finishReport(a.taskId,{threadId:'main',turnId:'report-turn',status:'completed',text:'summary'})
 }finally{f.db.close()}
})
test('unwritten report failure releases report slot; corrupt frozen hash is not accepted after reopen',()=>{
 const f=fixture('report-failure');try{
  const a=completedTask(f),e={threadId:a.threadId,turnId:a.turnId,status:'failed',text:''}
  f.ledger.freezeReport(a.taskId,e,'main');f.ledger.claimReport(a.taskId);f.ledger.failReportBeforeWrite(a.taskId)
  assert.equal(f.ledger.readTask(a.taskId).report.status,'attention');assert.equal(f.ledger.readCoordinator('assistant').activeReportTaskId,null)
  const row=f.db.prepare('SELECT value FROM runtime_metadata WHERE key=?').get('assistant_task:'+a.taskId);const value=JSON.parse(row.value);value.report.prompt+='changed';f.db.prepare('UPDATE runtime_metadata SET value=? WHERE key=?').run(JSON.stringify(value),'assistant_task:'+a.taskId)
  assert.throws(()=>f.ledger.readTask(a.taskId))
 }finally{f.db.close()}
})
function fixture(name){const file=path.join(out,name+'.sqlite');const db=new Database(file);db.pragma('busy_timeout=5000');db.exec('CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');const owner={pid:process.pid,nonce:'host'};const ledger=new AssistantTaskLedger(db,owner,()=>true);ledger.claimHost('assistant');return{db,file,ledger,owner}}
test('frozen contract is idempotent, source conflict rejected, stable IDs survive reopen; no table added',()=>{
 const {db,file,ledger}=fixture('identity');const first=ledger.accept(contract());assert.equal(first.executionClientMessageId,'assistant-task:'+first.taskId);assert.equal(first.executionRequestId,first.executionClientMessageId)
 assert.deepEqual(ledger.accept(contract()),first);assert.throws(()=>ledger.accept({...contract(),instructions:'changed'}));assert.throws(()=>ledger.accept({...contract('bad'),origin:'user'}));assert.throws(()=>ledger.accept({...contract('related'),relatedTaskId:'foreign'}))
 assert.equal(ledger.claimExecution(first.taskId),true);assert.equal(ledger.takeBoundary(first.taskId,'thread'),true);db.close()
 const reopened=new Database(file);const restored=new AssistantTaskLedger(reopened,{pid:process.pid,nonce:'host'},()=>true);assert.deepEqual(restored.readTask(first.taskId),{...first,boundaries:{thread:true,turn:false,interrupt:false}});assert.equal(restored.takeBoundary(first.taskId,'thread'),false);assert.deepEqual(reopened.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['runtime_metadata']);reopened.close()
})
test('only dead host permits takeover; unknown process liveness and corrupt metadata fail closed',()=>{
 const {db,ledger}=fixture('owner');const task=ledger.accept(contract());ledger.claimExecution(task.taskId);ledger.takeBoundary(task.taskId,'thread')
 const other=new AssistantTaskLedger(db,{pid:1234,nonce:'other'},()=>true);assert.throws(()=>other.claimHost('assistant'));assert.throws(()=>other.requestStop(task.taskId))
 const unknown=new AssistantTaskLedger(db,{pid:1234,nonce:'other'},()=>{throw Error('unknown process')});assert.throws(()=>unknown.claimHost('assistant'))
 const dead=new AssistantTaskLedger(db,{pid:1234,nonce:'other'},()=>false);dead.claimHost('assistant');assert.equal(dead.readCoordinator('assistant').activeTaskId,task.taskId);assert.equal(dead.takeBoundary(task.taskId,'thread'),false);assert.throws(()=>ledger.requestStop(task.taskId))
 db.prepare('UPDATE runtime_metadata SET value=? WHERE key=?').run('{broken','assistant_task:'+task.taskId);assert.throws(()=>dead.readTask(task.taskId));db.close()
})
test('stop intent before IDs, late binding, once-only interrupt, unknown holds slot',()=>{
 const {db,ledger}=fixture('stop');const a=ledger.accept(contract('a'));const b=ledger.accept(contract('b'));assert.equal(ledger.claimExecution(a.taskId),true);assert.equal(ledger.takeBoundary(a.taskId,'thread'),true);ledger.requestStop(a.taskId);ledger.bindNative(a.taskId,{threadId:'worker'});assert.equal(ledger.takeBoundary(a.taskId,'turn'),false);assert.equal(ledger.claimExecution(b.taskId),false)
 // Simulates a stop racing a previously sent turn: receipt arrives after intent.
 ledger.bindNative(a.taskId,{turnId:'native-turn'});assert.equal(ledger.readTask(a.taskId).stopRequested,true);assert.equal(ledger.takeBoundary(a.taskId,'interrupt'),true);assert.equal(ledger.takeBoundary(a.taskId,'interrupt'),false);assert.equal(ledger.releaseExecution(a.taskId,{kind:'not-sent'}),false);assert.equal(ledger.claimExecution(b.taskId),false)
 assert.throws(()=>ledger.releaseExecution(a.taskId,{kind:'terminal',threadId:'other',turnId:'native-turn',status:'completed'}));assert.equal(ledger.releaseExecution(a.taskId,{kind:'terminal',threadId:'worker',turnId:'native-turn',status:'completed'}),true);assert.equal(ledger.claimExecution(a.taskId),false);assert.equal(ledger.claimExecution(b.taskId),true);db.close()
})
test('same task recovery reuses slot; no false terminal or duplicate native identity',()=>{
 const {db,ledger}=fixture('recovery');const a=ledger.accept(contract());ledger.claimExecution(a.taskId);ledger.takeBoundary(a.taskId,'thread');ledger.bindNative(a.taskId,{threadId:'worker'});assert.throws(()=>ledger.bindNative(a.taskId,{threadId:'other'}));assert.equal(ledger.claimExecution(a.taskId),true);assert.equal(ledger.takeBoundary(a.taskId,'thread'),false);assert.equal(ledger.takeBoundary(a.taskId,'turn'),true);ledger.bindNative(a.taskId,{turnId:'turn'});assert.equal(ledger.takeBoundary(a.taskId,'turn'),false)
 assert.throws(()=>ledger.releaseExecution(a.taskId,{kind:'terminal',threadId:'worker',turnId:'turn',status:'sync_degraded'}));assert.equal(ledger.readCoordinator('assistant').activeTaskId,a.taskId);db.close()
})
test('late thread after stop safely withdraws before any execution turn; unknown creation holds',()=>{
 const {db,ledger}=fixture('late-thread');const a=ledger.accept(contract('a')),b=ledger.accept(contract('b'));ledger.claimExecution(a.taskId);ledger.takeBoundary(a.taskId,'thread');ledger.requestStop(a.taskId);assert.equal(ledger.releaseExecution(a.taskId,{kind:'not-sent'}),false);ledger.bindNative(a.taskId,{threadId:'late-worker'});assert.equal(ledger.takeBoundary(a.taskId,'turn'),false);assert.equal(ledger.releaseExecution(a.taskId,{kind:'not-sent'}),true);assert.equal(ledger.claimExecution(b.taskId),true);db.close()
})
test('two independent SQLite connections contend on the one slot before any external call',async()=>{
 const {db,file,ledger,owner}=fixture('concurrent');const a=ledger.accept(contract('a')),b=ledger.accept(contract('b'))
 const race=taskId=>new Promise((resolve,reject)=>{const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const Database=require('better-sqlite3');const {AssistantTaskLedger}=await import(workerData.bundle);const db=new Database(workerData.file);db.pragma('busy_timeout=5000');const ledger=new AssistantTaskLedger(db,workerData.owner,()=>true);const won=ledger.claimExecution(workerData.taskId)&&ledger.takeBoundary(workerData.taskId,'thread');db.close();parentPort.postMessage(won)})().catch(e=>{throw e})`,{eval:true,workerData:{bundle:pathToFileURL(bundle).href,file,owner,taskId}});worker.once('message',resolve);worker.once('error',reject)})
 const results=await Promise.all([race(a.taskId),race(b.taskId)]);assert.equal(results.filter(Boolean).length,1);assert.ok([a.taskId,b.taskId].includes(ledger.readCoordinator('assistant').activeTaskId));db.close()
})
test('verified main tools registration is owned, immutable and preserves active execution slot',()=>{
 const {db,ledger}=fixture('registration');const task=ledger.accept(contract());ledger.claimExecution(task.taskId);ledger.registerMainTools('assistant','main-native-uuid','trusted-assets');ledger.registerMainTools('assistant','main-native-uuid','trusted-assets');const value=ledger.readCoordinator('assistant');assert.equal(value.mainToolsThreadId,'main-native-uuid');assert.equal(value.assetsHash,'trusted-assets');assert.equal(value.activeTaskId,task.taskId);assert.throws(()=>ledger.registerMainTools('assistant','other','trusted-assets'));assert.throws(()=>ledger.registerMainTools('assistant','main-native-uuid','changed-assets'));const other=new AssistantTaskLedger(db,{pid:1234,nonce:'other'},()=>true);assert.throws(()=>other.registerMainTools('assistant','main-native-uuid','trusted-assets'));db.close()
})
