import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/summary-'))
const file=path.join(out,'summary.mjs')
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/api/assistantGateway.ts';export * from './src/api/normalizers/v2.ts';export * from './src/utils/projectGroupOrdering.ts';export * from './src/conversation-transcript/projectConversation.ts';"},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'})
const m=await import(pathToFileURL(file).href)
const task={taskId:'at-synthetic',title:'Synthetic task',permissions:'read-only',threadId:'worker',turnId:'turn',stopRequested:false,executionStatus:'completed',requiresReview:false,createdAt:'2026-10-18T00:00:00.000Z'}
const state={data:null,allowedWorkspaces:[],capabilities:{conversation:true,dispatch:true,backgroundExecution:true},tasks:[task]}
test('task DTO retains real status and dispatch capabilities, drops private fields, rejects invalid authority',async()=>{
 const original=globalThis.fetch
 try{
  globalThis.fetch=async()=>Response.json({...state,tasks:[{...task,sourceText:'private',host:'private'}]})
  const result=await m.getAssistantState();assert.deepEqual(result.tasks,[task]);assert.equal(result.capabilities.dispatch,true);assert.equal(result.capabilities.resultReturn,undefined)
  for(const patch of [{permissions:'write'},{executionStatus:null},{requiresReview:'false'},{taskId:''}]){
   globalThis.fetch=async()=>Response.json({...state,tasks:[{...task,...patch}]});await assert.rejects(m.getAssistantState())
  }
 }finally{globalThis.fetch=original}
})
test('backend worker metadata survives normalization and participates in merge equality',()=>{
 const groups=m.normalizeThreadGroupsV2({data:[{id:'worker',preview:'task',cwd:'E:/Synthetic',createdAt:1,updatedAt:2,source:'vscode',assistantManaged:true}],nextCursor:null})
 const thread=groups[0].threads[0];assert.equal(thread.assistantManaged,true);assert.equal(m.areUiThreadFieldsEqual(thread,{...thread,assistantManaged:undefined}),false)
})
test('internal report opener is hidden while explicit summary and ordinary quoted user text remain',()=>{
 const project=(clientId,text)=>m.projectConversation({nowMs:1,threadRead:{thread:{id:'main',turns:[{id:'report-turn',status:'completed',items:[{type:'userMessage',id:'user',clientId,content:[{type:'text',text}]},{type:'agentMessage',id:'final',phase:'final_answer',text:'USER_VISIBLE_SUMMARY'}]}]}}})
 const hidden=project('assistant-report:task','<codex_internal_context type="assistant_task_result">private payload</codex_internal_context>');assert.equal(hidden.turns[0].opener,null);assert.equal(hidden.turns[0].final.text,'USER_VISIBLE_SUMMARY')
 assert.ok(project('ordinary-user','<codex_internal_context>quoted by user</codex_internal_context>').turns[0].opener)
 assert.ok(project('assistant-report:task','plain user text').turns[0].opener)
})
