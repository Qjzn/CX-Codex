import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const out = fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/tool-origin-'))
const bundle = path.join(out, 'tools.mjs')
await build({ entryPoints: ['src/server/assistantCoordinationTools.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { ASSISTANT_COORDINATION_TOOLS: tools, authorizeAssistantToolCall: auth } = await import(pathToFileURL(bundle).href)
const request = { requestId:'trusted-request',clientMessageId:'ordinary-user',threadId:'main',turnId:'turn',status:'running' }
const input = () => ({ method:'item/tool/call',mainThreadId:'main',requests:[{...request}],params:{threadId:'main',turnId:'turn',callId:'call',tool:'assistant_dispatch_task',arguments:{title:' Title ',instructions:' Exact task '}} })
test('three tools only, closed schemas, exact native identity and frozen source', () => {
  assert.deepEqual(tools.map(t=>t.name).sort(), ['assistant_dispatch_task','assistant_read_tasks','assistant_stop_task'])
  for (const t of tools) assert.equal(t.inputSchema.additionalProperties, false)
  assert.deepEqual(auth(input()), {tool:'assistant_dispatch_task',callId:'call',threadId:'main',turnId:'turn',sourceRequestId:'trusted-request',sourceClientMessageId:'ordinary-user',origin:'user',arguments:{title:'Title',instructions:'Exact task'}})
  const nativeNull=input();nativeNull.params.namespace=null;assert.equal(auth(nativeNull).sourceRequestId,'trusted-request')
})
for (const [name,change] of Object.entries({
  'foreign thread':v=>v.params.threadId='worker', 'foreign turn':v=>v.params.turnId='other',
  'no binding':v=>v.mainThreadId='', 'wrong method':v=>v.method='synthetic/call',
  'no native call':v=>delete v.params.callId, 'unknown namespace':v=>v.params.namespace='other',
  'unbound request':v=>v.requests=[], 'ambiguous source':v=>v.requests.push({...request,requestId:'other'}),
  'stale status':v=>v.requests[0].status='sync_degraded', 'starting without receipt':v=>v.requests[0].status='starting',
  'forged origin':v=>v.params.arguments.origin='user', 'forged permissions':v=>v.params.arguments.permissions='all',
  'arbitrary cwd':v=>v.params.arguments.cwd='E:/other', 'blank task':v=>v.params.arguments.instructions=' ',
  'oversized task':v=>v.params.arguments.instructions='x'.repeat(12001), 'worker source':v=>v.requests[0].clientMessageId='assistant-task:forged',
  'internal report dispatch':v=>v.requests[0].clientMessageId='assistant-report:trusted',
})) test(`refuses ${name}`, () => {const value=input();change(value);assert.throws(()=>auth(value))})
test('internal report may read only; native calls never grant stop permission through arguments', () => {
  const value=input();value.requests[0].clientMessageId='assistant-report:trusted';value.params.tool='assistant_read_tasks';value.params.arguments={}
  assert.equal(auth(value).origin,'report')
  value.params.tool='assistant_stop_task';value.params.arguments={taskId:'task'};assert.throws(()=>auth(value))
  value.requests[0].clientMessageId='assistant-main:trusted';assert.equal(auth(value).origin,'user')
})
