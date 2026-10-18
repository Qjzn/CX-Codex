// Actual HTTP route + RuntimeStore + existing Runtime starter; synthetic native transport only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'output/hermes-codex-upgrade-20261015/assistant-next-20261016');
fs.mkdirSync(root, { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'a2-http-'));
const home = path.join(out, 'home'); fs.mkdirSync(home);
process.env.CODEX_HOME = home;
process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] = home;
const bundle = path.join(out, 'modules.mjs');
await build({ stdin: { contents: `export {RuntimeStore} from './src/server/runtimeStore.ts'; export {handleAssistantRoutes} from './src/server/assistantRoutes.ts'; export {createAppServerRuntimeTurnStarter} from './src/server/appServerRuntimeStart.ts';`, resolveDir: repo }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
const { RuntimeStore, handleAssistantRoutes, createAppServerRuntimeTurnStarter } = await import(pathToFileURL(bundle));
let store = new RuntimeStore(path.join(out, 'test.sqlite'));
let enabled = true, fail = false, calls = 0, nativeStarts = 0, nativeTurns = 0;
let readFailure = false, foreignBinding = false;
const roots = ['E:/Synthetic/Alpha', 'E:/Synthetic/Beta'];
const dependencies = {
  createRequest: r => store.createRequest(r), updateRequest: (id, patch) => store.updateRequest(id, patch),
  getRequest: id => store.getRequest(id), getLatestRequestByClientMessageId: id => store.getLatestRequestByClientMessageId(id),
  rpc: async method => { if (method === 'thread/start') { nativeStarts++; await new Promise(r => setTimeout(r, 35)); return { thread: { id: 'synthetic-main-thread' } }; } if (method === 'thread/read') return { thread: { model: 'synthetic-model' } }; assert.equal(method, 'turn/start'); nativeTurns++; return { turn: { id: 'synthetic-main-turn' } }; },
  clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {}, markStartUncertain() {}, markFailed() {},
  persistRuntimeSnapshot: () => ({ activeTurnId: '' }), markPlanModeTurn() {}, getErrorMessage: (_e, fallback) => fallback,
};
const starter = createAppServerRuntimeTurnStarter(dependencies);
const audit = [];
const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleAssistantRoutes(req, res, new URL(req.url, 'http://localhost'), {
      runtimeStore: new Proxy(store, { get(target, key) {
        if (key === 'readAssistantMainConversation') return () => {
          if (readFailure) throw new Error('secret storage sentinel');
          const record = target.readAssistantMainConversation();
          return foreignBinding && record ? { ...record, assistantId: 'foreign' } : record;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } }), readAllowedWorkspaces: async () => roots,
      readJsonBody: async () => { let s = ''; for await (const b of req) s += b; return JSON.parse(s); },
      // Synthetic integration hook only: production has no verified restricted starter.
      ...(enabled ? { startAssistantConversation: async payload => { calls++; if (fail) throw new Error('secret sentinel'); return starter(payload); } } : {}),
      // A leftover ordinary dependency must not enable the assistant.
      startRuntimeTurn: async () => { throw new Error('ordinary starter must never be used'); },
    });
    if (!handled) { res.writeHead(404); res.end('{}'); }
  } catch (e) { res.writeHead(599); res.end(JSON.stringify({ unexpected: String(e) })); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/codex-api/assistant`;
async function request(method = 'GET', body, suffix = '') {
  const response = await fetch(base + suffix, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); audit.push({ method, suffix, status: response.status, data });
  assert.notEqual(response.status, 599, JSON.stringify(data));
  return { status: response.status, ...data };
}
const post = body => request('POST', body, '/conversation');
const valid = { revision: 1, clientMessageId: randomUUID(), text: '请介绍当前助手的工作方式。' };
try {
  const unit = new RuntimeStore(path.join(out, 'store-unit.sqlite'));
  try {
    const identity = unit.writeAssistantIdentity({ name: 'Unit', cwd: roots[0], revision: null }).identity;
    const reservation = { assistantId: identity.assistantId, revision: 1, cwd: roots[0], clientMessageId: 'assistant-main:unit', promptHash: 'unit-hash' };
    assert.equal(unit.reserveAssistantMainConversation(reservation).status, 'claimed');
    assert.equal(unit.reserveAssistantMainConversation(reservation).status, 'existing');
    assert.equal(unit.reserveAssistantMainConversation({ ...reservation, assistantId: 'forged-assistant' }).status, 'conflict');
    assert.equal(unit.writeAssistantIdentity({ name: 'Moved', cwd: roots[1], revision: 1 }).status, 'conflict');
  } finally { unit.close(); }
  let r = await request(); assert.equal(r.status, 200); assert.equal(r.data, null); assert.equal(calls, 0);
  r = await post(valid); assert.equal(r.status, 409, 'main conversation must require saved identity');
  r = await request('PUT', { name: 'A2 synthetic assistant', cwd: roots[0], revision: null }); assert.equal(r.status, 200);
  for (const bad of [null, [], { ...valid, threadId: 'attacker' }, { ...valid, revision: 0 }, { ...valid, revision: '1' }, { ...valid, clientMessageId: 'x' }, { ...valid, text: ' ' }, { ...valid, text: 'x'.repeat(16001) }]) assert.equal((await post(bad)).status, 400);
  assert.equal(calls, 0);
  enabled = false; r = await request(); assert.equal(r.capabilities.conversation, false);
  r = await post(valid); assert.equal(r.status, 503); assert.equal(store.readAssistantMainConversation(), null); enabled = true;
  r = await post({ ...valid, revision: 2 }); assert.equal(r.status, 409); assert.equal(calls, 0);
  const parallel = await Promise.all(Array.from({ length: 12 }, () => post(valid)));
  assert(parallel.every(x => x.status === 200 || x.status === 202)); assert.equal(calls, 1, 'one reservation winner owns external send');
  for (let i = 0; i < 50 && nativeTurns === 0; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(nativeStarts, 1); assert.equal(nativeTurns, 1);
  r = await request(); assert.equal(r.data.mainThreadId, 'synthetic-main-thread');
  assert(!JSON.stringify(r).includes('请介绍'), 'new coordination record must not duplicate prompt plaintext');
  readFailure = true; r = await request(); assert.equal(r.status, 500);
  r = await post(valid); assert.equal(r.status, 500); assert.equal(calls, 1); assert(!JSON.stringify(r).includes('secret'));
  readFailure = false; foreignBinding = true; r = await request(); assert.equal(r.status, 500); foreignBinding = false;
  r = await post({ ...valid, text: 'changed' }); assert.equal(r.status, 409); assert.equal(calls, 1);
  r = await post({ ...valid, clientMessageId: randomUUID(), text: 'different first message' }); assert.equal(r.status, 409); assert.equal(calls, 1);
  r = await request('PUT', { name: 'Moved?', cwd: roots[1], revision: 1 }); assert.equal(r.status, 409);
  r = await request('PUT', { name: 'Renamed', cwd: roots[0], revision: 1 }); assert.equal(r.status, 200);
  store.close(); store = new RuntimeStore(path.join(out, 'test.sqlite'));
  r = await request(); assert.equal(r.data.mainThreadId, 'synthetic-main-thread'); assert.equal(r.data.name, 'Renamed');
  await post({ ...valid, revision: 2 }); assert.equal(calls, 1, 'reopen and replay must not create another thread');
  store.close(); store = new RuntimeStore(path.join(out, 'uncertain.sqlite')); fail = true;
  await request('PUT', { name: 'Uncertain', cwd: roots[0], revision: null });
  r = await post(valid); assert.equal(r.status, 202); assert.equal(r.data.mainThreadId, null); assert.equal(r.mainConversation.status, 'start_uncertain');
  assert(!JSON.stringify(r).includes('secret sentinel'));
  const callCount = calls; store.close(); store = new RuntimeStore(path.join(out, 'uncertain.sqlite'));
  r = await post(valid); assert(r.status === 200 || r.status === 202); assert.equal(calls, callCount);
  r = await request(); assert.equal(r.mainConversation.status, 'start_uncertain');
  const result = { passed: true, httpRequests: audit.length, oneNativeStart: nativeStarts, oneNativeTurn: nativeTurns, reopen: true, uncertainNoResend: true, actualModel: false, out };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (e) {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ message: String(e), audit }, null, 2)); throw e;
} finally { store.close(); await new Promise(r => server.close(r)); }
