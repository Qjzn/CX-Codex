import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'
const out=fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/assets-'))
const bundle=path.join(out,'assets.mjs')
await build({entryPoints:['src/server/assistantAssets.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
const {readAssistantAssets}=await import(pathToFileURL(bundle).href)
const source=pathToFileURL(path.resolve('src/server/assistant-assets')+path.sep)
test('two trusted static files load deterministically and are copied byte-for-byte into CLI bundle',()=>{
 const first=readAssistantAssets(source);assert.equal(Object.isFrozen(first),true);assert.equal(first.version,'1');for(const name of ['assistant_dispatch_task','assistant_read_tasks','assistant_stop_task'])assert.ok(first.core.includes(name));assert.ok(first.workerBrief.length>20);assert.equal(first.hash,createHash('sha256').update(JSON.stringify([first.core,first.workerBrief])).digest('hex'))
 const copied=spawnSync(process.execPath,['scripts/copy-assistant-assets.mjs'],{encoding:'utf8'});assert.equal(copied.status,0,copied.stderr)
 const packaged=readAssistantAssets(pathToFileURL(path.resolve('dist-cli/assistant-assets')+path.sep));assert.deepEqual(packaged,first)
 for(const file of ['cxcodex-assistant-core/SKILL.md','worker-brief.md'])assert.deepEqual(fs.readFileSync(new URL(file,source)),fs.readFileSync(path.resolve('dist-cli/assistant-assets',file)))
})
test('missing or malformed instruction assets fail visibly with no path/content leak',()=>{
 const empty=pathToFileURL(path.join(out,'missing')+path.sep);assert.throws(()=>readAssistantAssets(empty),e=>e.message==='助手静态资源不可用')
 const bad=path.join(out,'bad');fs.mkdirSync(path.join(bad,'cxcodex-assistant-core'),{recursive:true});fs.writeFileSync(path.join(bad,'cxcodex-assistant-core/SKILL.md'),'');fs.writeFileSync(path.join(bad,'worker-brief.md'),'brief');assert.throws(()=>readAssistantAssets(pathToFileURL(bad+path.sep)),e=>e.message==='助手静态资源不可用')
})
