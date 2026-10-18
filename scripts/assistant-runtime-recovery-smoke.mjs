// Fault injection at the real Runtime starter's native boundary; all storage is task-owned.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'output/hermes-codex-upgrade-20261015/assistant-next-20261016'); fs.mkdirSync(root, { recursive: true });
const out = fs.mkdtempSync(path.join(root, 'a2-recovery-')); const home = path.join(out, 'home'); fs.mkdirSync(home);
process.env.CODEX_HOME = home; process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] = home;
const bundle = path.join(out, 'modules.mjs');
await build({ stdin: { contents: `export {RuntimeStore} from './src/server/runtimeStore.ts'; export {createAppServerRuntimeTurnStarter} from './src/server/appServerRuntimeStart.ts'; export {canResumeRuntimePendingStart} from './src/server/appServerRuntimeRequestReconciliation.ts'; export {createRpcTimeoutError,AppServerJsonRpcError} from './src/server/appServerRpcErrors.ts';`, resolveDir: repo }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
const { RuntimeStore, createAppServerRuntimeTurnStarter, canResumeRuntimePendingStart, createRpcTimeoutError, AppServerJsonRpcError } = await import(pathToFileURL(bundle));
const db = path.join(out, 'runtime.sqlite'); let store = new RuntimeStore(db); const evidence = [];
try {
  for (const kind of ['timeout', 'transport', 'malformed', 'definite-rejection']) {
    const clientMessageId = `assistant-main:${kind}`; let atBoundary;
    const starter = createAppServerRuntimeTurnStarter({
      createRequest: r => store.createRequest(r), updateRequest: (id, patch) => store.updateRequest(id, patch), getRequest: id => store.getRequest(id), getLatestRequestByClientMessageId: id => store.getLatestRequestByClientMessageId(id),
      rpc: async method => {
        assert.equal(method, 'thread/start'); atBoundary = store.getLatestRequestByClientMessageId(clientMessageId);
        if (kind === 'timeout') throw createRpcTimeoutError(method, 1000);
        if (kind === 'malformed') return {};
        if (kind === 'definite-rejection') throw new AppServerJsonRpcError(-32602, 'synthetic invalid params');
        const error = new Error('synthetic disconnect after remote create'); error.name = 'AppServerRpcTransportError'; throw error;
      }, clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {}, markStartUncertain() {}, markFailed() {}, persistRuntimeSnapshot: () => ({ activeTurnId: '' }), markPlanModeTurn() {}, getErrorMessage: (e, fallback) => e instanceof Error ? e.message : fallback,
    });
    try { await starter({ clientMessageId, cwd: 'E:/Synthetic/Alpha', input: [{ type: 'text', text: 'fault injection' }] }); } catch {}
    for (let i = 0; i < 20; i++) { const r = store.getLatestRequestByClientMessageId(clientMessageId); if (r && r.status !== 'pending_start' && r.status !== 'starting') break; await new Promise(r => setTimeout(r, 5)); }
    const after = store.getLatestRequestByClientMessageId(clientMessageId);
    evidence.push({ kind, atBoundary, after });
    assert.equal(canResumeRuntimePendingStart(atBoundary), false, 'external thread/start must have a durable no-replay marker BEFORE the RPC');
    assert.equal(after.status, kind === 'definite-rejection' ? 'failed' : 'start_uncertain', 'only an explicit rejection establishes a definite failure');
    store.close(); store = new RuntimeStore(db);
    assert.equal(canResumeRuntimePendingStart(store.getLatestRequestByClientMessageId(clientMessageId)), false);
    assert(store.getRestartBlockingRequestCount() >= 1, 'unknown external outcome remains a restart blocker');
  }
  for (const kind of ['missing-thread-marker', 'missing-turn-marker', 'lost-turn-receipt', 'missing-turn-id', 'managed-unsafe-resume']) {
    const clientMessageId = `assistant-task:${kind}`; let calls = 0;
    const knownThread = kind !== 'missing-thread-marker';
    const starter = createAppServerRuntimeTurnStarter({
      createRequest: r => store.createRequest(r), updateRequest: (id, patch) => {
        if (kind.startsWith('missing-') && kind.endsWith('-marker') && patch.status === 'starting') return null;
        return store.updateRequest(id, patch);
      }, getRequest: id => store.getRequest(id), getLatestRequestByClientMessageId: id => store.getLatestRequestByClientMessageId(id),
      rpc: async method => { calls++;
        if (kind === 'managed-unsafe-resume') {
          if (method === 'turn/start' && calls === 1) throw new Error('thread not found after transport disconnect');
          return method === 'thread/resume' ? { thread: { id: `synthetic-${kind}` } } : { turn: { id: 'duplicate-turn' } };
        }
        assert.equal(method, 'turn/start');
        if (kind === 'lost-turn-receipt') throw createRpcTimeoutError(method, 1000);
        return {};
      }, clearThreadSearchIndex() {}, markQueued() {}, markStarting() {}, markRunning() {}, markStartUncertain() {}, markFailed() {}, persistRuntimeSnapshot: () => ({ activeTurnId: '' }), markPlanModeTurn() {}, getErrorMessage: (e, fallback) => e instanceof Error ? e.message : fallback,
    });
    try { await starter({ clientMessageId, model: 'synthetic', ...(knownThread ? { threadId: `synthetic-${kind}` } : {}), cwd: 'E:/Synthetic/Alpha', input: [{ type: 'text', text: 'fault injection' }] }); } catch {}
    await new Promise(r => setTimeout(r, 20));
    const after = store.getLatestRequestByClientMessageId(clientMessageId); evidence.push({ kind, calls, after });
    if (kind.endsWith('-marker')) assert.equal(calls, 0, 'no external RPC may cross a missing durable marker');
    else { assert.equal(calls, 1); assert.equal(after.status, 'start_uncertain', 'a missing turn receipt is unknown, never running with an empty turn id'); }
    store.close(); store = new RuntimeStore(db);
    if (!kind.endsWith('-marker')) assert.equal(canResumeRuntimePendingStart(store.getLatestRequestByClientMessageId(clientMessageId)), false);
  }
  console.log(JSON.stringify({ passed: true, cases: evidence.length, realRuntimeStarter: true, nativeTransport: 'synthetic', out }));
} finally { fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); store.close(); }
