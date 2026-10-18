import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { createRenderer, h, reactive, nextTick } from 'vue'

const filename = path.resolve('src/components/content/AssistantConversationEntry.vue')
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'assistant-entry-test', inlineTemplate: true })
const built = await build({ stdin: { contents: script.content, loader: 'ts', resolveDir: path.dirname(filename) }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [{ name: 'synthetic-mobile-auth', setup(b) { b.onResolve({ filter: /mobileAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const shouldAutoLoginForResponse=()=>false;export const tryMobileShellAutoLogin=async()=>false' })) } }] })
const out = fs.mkdtempSync(path.resolve('output/hermes-codex-upgrade-20261015/assistant-connect-20261017/entry-recovery-'))
const moduleFile = path.join(out, 'entry.mjs')
fs.writeFileSync(moduleFile, built.outputFiles[0].contents)
const { default: Entry } = await import(pathToFileURL(moduleFile).href)
const renderer = createRenderer({
  createElement: tag => ({ tag, tagName: tag.toUpperCase(), props: {}, children: [], parent: null, addEventListener() {}, removeEventListener() {} }), createText: text => ({ text, parent: null }), createComment: text => ({ comment: text, parent: null }),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, _before, value) => { node.props[key] = value },
  insert(node, parent, anchor) { if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1) } node.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, node) },
  remove(node) { const i = node.parent?.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1); node.parent = null }, parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})
const identity = { assistantId: 'synthetic-id', name: 'Synthetic coordinator', cwd: 'E:/Synthetic', revision: 1, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z', mainThreadId: null }
const pending = { clientMessageId: 'assistant-main:synthetic', status: 'pending_start', threadId: '' }
const state = (mainConversation, threadId = null) => ({ data: { ...identity, mainThreadId: threadId }, mainConversation, allowedWorkspaces: [identity.cwd], capabilities: { conversation: true, dispatch: false, backgroundExecution: false } })
const flush = async () => { for (let i = 0; i < 6; i++) { await nextTick(); await new Promise(resolve => setImmediate(resolve)) } }
const find = (node, id) => node.props?.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean)
function mount(props = {}) {
  const current = reactive({ identity: { ...identity }, connected: true, mainConversation: null, ...props })
  const root = { children: [] }
  const app = renderer.createApp({ render: () => h(Entry, { ...current, onState: received => { current.identity = received.data; current.mainConversation = received.mainConversation } }) })
  app.mount(root)
  return { current, root, app }
}
test('late authoritative reservation after parent load is reconciled without any POST', async () => {
  const original = globalThis.fetch; const calls = []
  globalThis.fetch = async (_url, options) => { calls.push(options.method); return Response.json(state({ ...pending, status: 'running', threadId: 'synthetic-main' }, 'synthetic-main')) }
  const { current, root, app } = mount()
  try {
    await flush()
    current.mainConversation = { ...pending }
    await flush()
    assert.deepEqual(calls, ['GET'])
    assert.ok(find(root, 'assistant-open-conversation'))
  } finally { app.unmount(); globalThis.fetch = original }
})
test('initial uncertain reservation reconciles once without starting another conversation', async () => {
  const original = globalThis.fetch; const calls = []
  globalThis.fetch = async (_url, options) => { calls.push(options.method); return Response.json(state({ ...pending, status: 'start_uncertain' })) }
  const { root, app } = mount({ mainConversation: { ...pending, status: 'start_uncertain' } })
  try {
    await flush()
    assert.deepEqual(calls, ['GET'])
    assert.ok(find(root, 'assistant-check-conversation'))
    assert.equal(find(root, 'assistant-start-conversation'), undefined)
  } finally { app.unmount(); globalThis.fetch = original }
})
