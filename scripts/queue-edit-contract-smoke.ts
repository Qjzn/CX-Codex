import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { build, transformSync } from 'esbuild'
import postcss from 'postcss'
import ts from 'typescript'
import * as Vue from 'vue'
import { ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { RuntimeQueuedMessage } from '../src/api/runtimeMessageQueue.js'

// Execute the real App.vue function bodies. Only their UI/state dependencies are
// controlled; there is no copied implementation of the editing policy here.
const appPath = resolve('src/App.vue')
const parsed = parse(readFileSync(appPath, 'utf8'), { filename: appPath })
assert.deepEqual(parsed.errors, [], 'App.vue must parse before extracting its real handlers')
assert.ok(parsed.descriptor.scriptSetup, 'the fixture expects the production script-setup entry')
const script = parsed.descriptor.scriptSetup.content
const source = ts.createSourceFile('App.script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const sourceConstants = Object.fromEntries(source.statements.filter(ts.isVariableStatement)
  .flatMap((statement) => statement.declarationList.declarations)
  .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.initializer
    && (ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer)))
  .map((declaration) => [(declaration.name as ts.Identifier).text, (declaration.initializer as ts.StringLiteral).text]))
const functions = new Map(source.statements
  .filter(ts.isFunctionDeclaration)
  .filter((statement) => Boolean(statement.name))
  .map((statement) => [statement.name!.text, statement.getText(source)]))
const requiredEntries = ['onEditQueuedMessage', 'confirmQueuedMessageEdit']
for (const name of requiredEntries) assert.ok(functions.has(name), `missing production queue-edit entry ${name}`)
const helperNames = ['hydrateQueuedMessageForEditing']
const realHandlers = [...requiredEntries, ...helperNames.filter((name) => functions.has(name))]
  .map((name) => functions.get(name)).join('\n')
const compiledHandlers = transformSync(realHandlers, { loader: 'ts', target: 'es2022', format: 'cjs' }).code

const threadId = 'queue-edit-contract-thread'
const messageId = 'queue-edit-contract-message'
function message(overrides: Partial<RuntimeQueuedMessage> = {}): RuntimeQueuedMessage {
  return {
    id: messageId, clientMessageId: 'queue-edit-contract-client', deliveryState: 'queued',
    text: 'Fixture queued work', imageUrls: [], skills: [], fileAttachments: [],
    modelId: '', reasoningEffort: '', speedMode: 'standard', collaborationMode: 'execute',
    ...overrides,
  }
}
function fixture(row: RuntimeQueuedMessage | null, options: { unsavedDraft?: boolean; processing?: boolean; composer?: boolean } = {}) {
  const hydrated: unknown[] = []
  const removed: string[] = []
  const deleted: string[] = []
  const failedEdited: string[] = []
  const notices: unknown[][] = []
  const selectedThreadQueuedMessages = ref(row ? [row] : [])
  const selectedThreadId = ref(threadId)
  const selectedThreadQueueProcessing = ref(options.processing === true)
  const pendingQueuedMessageEditId = ref('')
  const editingQueuedMessageState = ref<{ threadId: string; queueIndex: number } | null>(null)
  const composerDraft = ref<unknown>({ text: 'Existing composer contents' })
  const initialDraft = composerDraft.value
  const threadComposerRef = ref(options.composer === false ? null : {
    hasUnsavedDraft: () => options.unsavedDraft === true,
    hydrateDraft: (payload: unknown) => {
      hydrated.push(payload)
      composerDraft.value = payload
    },
  })
  const bindings = {
    ...sourceConstants,
    threadComposerRef, selectedThreadQueuedMessages, selectedThreadId, selectedThreadQueueProcessing,
    pendingQueuedMessageEditId, editingQueuedMessageState,
    blockingDialogShouldRestoreFocus: true,
    removeQueuedMessage: (id: string) => { removed.push(id) },
    deleteQueuedMessage: (id: string) => { deleted.push(id) },
    hydrateFailedMessageForEditing: (id: string) => { failedEdited.push(id) },
    showProductToast: (...args: unknown[]) => { notices.push(args) },
  }
  const entries = new Function(...Object.keys(bindings), `${compiledHandlers}\nreturn { onEditQueuedMessage, confirmQueuedMessageEdit };`)(
    ...Object.values(bindings),
  ) as { onEditQueuedMessage: (id: string) => void; confirmQueuedMessageEdit: () => void }
  return {
    ...entries, ...bindings, hydrated, removed, deleted, failedEdited, notices, composerDraft, initialDraft,
  }
}
type Fixture = ReturnType<typeof fixture>
function assertQueueUnchanged(h: Fixture): void {
  assert.equal(h.hydrated.length, 0,
    `queued editing must remain blocked (hydrate=${h.hydrated.length}, remove=${h.removed.length}, delete=${h.deleted.length}, revision=${Boolean(h.editingQueuedMessageState.value)})`)
  assert.deepEqual(h.removed, [], 'editing must not enter removeQueuedMessage and its server DELETE path')
  assert.deepEqual(h.deleted, [], 'editing must not enter deleteQueuedMessage')
  assert.equal(h.editingQueuedMessageState.value, null, 'blocked editing must not create a replacement queue submission context')
  assert.deepEqual(h.failedEdited, [], 'queue editing must not bypass the independent failed-message editor')
  assert.deepEqual(h.composerDraft.value, h.initialDraft, 'blocked editing must preserve the existing composer draft')
  assert.equal(h.pendingQueuedMessageEditId.value, '', 'blocked queue editing must not open a replace-draft dialog')
}

const rows = [
  ['accepted native queue', message({ serverRequestId: 'native-request', backgroundPersisted: true, waitReason: 'native_writer' })],
  ['accepted external queue', message({ serverRequestId: 'external-request', backgroundPersisted: true, waitReason: 'external_writer' })],
  ['accepted queue failure', message({ serverRequestId: 'failed-request', backgroundPersisted: true, deliveryState: 'failed' })],
  ['persisted without request identity', message({ backgroundPersisted: true })],
  ['local synchronization in progress', message({ backgroundPersisted: false })],
  ['local failure with uncertain acceptance', message({ backgroundPersisted: false, deliveryState: 'failed' })],
  ['legacy row with missing acceptance flags', message()],
  ['legacy failed row with missing acceptance flags', message({ deliveryState: 'failed' })],
] as const

let checks = 0
const failures: string[] = []
function check(name: string, run: () => void): void {
  checks += 1
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// A queue row's failed flag does not prove non-acceptance: malformed persistence
// acknowledgements can produce the same flag after server acceptance.
for (const [name, row] of rows) {
  check(`edit blocks ${name}`, () => {
    const h = fixture(row)
    h.onEditQueuedMessage(messageId)
    assertQueueUnchanged(h)
  })
  check(`edit with unsaved draft blocks ${name} without a replacement dialog`, () => {
    const h = fixture(row, { unsavedDraft: true })
    h.onEditQueuedMessage(messageId)
    assertQueueUnchanged(h)
  })
  check(`draft confirmation rechecks ${name}`, () => {
    const h = fixture(message({ backgroundPersisted: false, deliveryState: 'failed' }), { unsavedDraft: true })
    h.onEditQueuedMessage(messageId)
    // Simulate a confirmation already displayed before queue ownership changed.
    h.pendingQueuedMessageEditId.value = messageId
    h.selectedThreadQueuedMessages.value = [{ ...row }]
    h.confirmQueuedMessageEdit()
    assertQueueUnchanged(h)
    assert.equal(h.pendingQueuedMessageEditId.value, '', 'confirmation must release the stale dialog target')
  })
}
check('processing queue cannot be edited', () => {
  const h = fixture(message({ backgroundPersisted: false, deliveryState: 'failed' }), { processing: true })
  h.onEditQueuedMessage(messageId)
  assertQueueUnchanged(h)
})
check('queue begins processing while replacement confirmation is open', () => {
  const h = fixture(message({ backgroundPersisted: false, deliveryState: 'failed' }), { unsavedDraft: true })
  h.onEditQueuedMessage(messageId)
  h.pendingQueuedMessageEditId.value = messageId
  h.selectedThreadQueueProcessing.value = true
  h.confirmQueuedMessageEdit()
  assertQueueUnchanged(h)
})
check('queued row disappears while replacement confirmation is open', () => {
  const h = fixture(message(), { unsavedDraft: true })
  h.onEditQueuedMessage(messageId)
  h.pendingQueuedMessageEditId.value = messageId
  h.selectedThreadQueuedMessages.value = []
  h.confirmQueuedMessageEdit()
  assertQueueUnchanged(h)
})
check('task changes while replacement confirmation is open', () => {
  const h = fixture(message(), { unsavedDraft: true })
  h.onEditQueuedMessage(messageId)
  h.pendingQueuedMessageEditId.value = messageId
  h.selectedThreadId.value = 'another-fixture-thread'
  h.selectedThreadQueuedMessages.value = [message({ serverRequestId: 'another-accepted-request', backgroundPersisted: true })]
  h.confirmQueuedMessageEdit()
  assertQueueUnchanged(h)
})
check('missing queue row is harmless', () => {
  const h = fixture(null)
  h.onEditQueuedMessage(messageId)
  assertQueueUnchanged(h)
})
check('missing composer is harmless', () => {
  const h = fixture(message(), { composer: false })
  h.onEditQueuedMessage(messageId)
  assertQueueUnchanged(h)
})
check('independent failed-message confirmation still reaches its existing editor', () => {
  const h = fixture(null)
  assert.equal(typeof sourceConstants.FAILED_MESSAGE_EDIT_TARGET_PREFIX, 'string')
  h.pendingQueuedMessageEditId.value = `${sourceConstants.FAILED_MESSAGE_EDIT_TARGET_PREFIX}failed-message-fixture`
  h.confirmQueuedMessageEdit()
  assert.deepEqual(h.failedEdited, ['failed-message-fixture'])
  assert.deepEqual(h.hydrated, [])
  assert.deepEqual(h.removed, [])
  assert.deepEqual(h.deleted, [])
  assert.equal(h.pendingQueuedMessageEditId.value, '')
})

const queuePath = resolve('src/components/content/QueuedMessages.vue')
const queueDescriptor = parse(readFileSync(queuePath, 'utf8'), { filename: queuePath }).descriptor
function compileComponent(filename: string): string {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiledScript = compileScript(descriptor, { id: 'queue-contract', genDefaultAs: 'fixtureComponent' })
  const template = compileTemplate({
    source: descriptor.template!.content, filename, id: 'queue-contract', ssr: true, ssrCssVars: descriptor.cssVars,
    compilerOptions: { bindingMetadata: compiledScript.bindings },
  })
  assert.deepEqual(template.errors, [])
  return `${compiledScript.content}\n${template.code}\nfixtureComponent.ssrRender = ssrRender; export default fixtureComponent;`
}
const componentBundle = await build({
  stdin: { contents: compileComponent(queuePath), resolveDir: dirname(queuePath), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'production-vue-fixtures', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, (args) => ({
      contents: compileComponent(args.path), loader: 'ts', resolveDir: dirname(args.path),
    }))
  } }],
})
const componentModule = { exports: {} as { default?: Vue.Component & { setup: (...args: unknown[]) => unknown } } }
new Function('require', 'module', 'exports', componentBundle.outputFiles[0]!.text)(
  createRequire(import.meta.url), componentModule, componentModule.exports,
)
const queueComponent = componentModule.exports.default!
const vnodeRender = new Function('Vue', compile(queueDescriptor.template!.content, {
  mode: 'function', prefixIdentifiers: true,
  bindingMetadata: compileScript(queueDescriptor, { id: 'queue-contract' }).bindings,
}).code)(Vue)
function renderQueueNodes(messages: RuntimeQueuedMessage[]) {
  const props = { messages, isProcessing: false }
  const emitted: unknown[][] = []
  const setup = queueComponent.setup(props, { expose() {} }) as Record<string, unknown>
  const context = Vue.proxyRefs({ ...setup, ...props, $emit: (...args: unknown[]) => emitted.push(args) })
  const nodes: Vue.VNode[] = []
  function collect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(collect); return }
    if (!Vue.isVNode(value)) return
    nodes.push(value)
    collect(value.children)
  }
  collect(vnodeRender(context, [], props, Vue.proxyRefs(setup), {}, context))
  return { nodes, emitted }
}
function hasClass(node: Vue.VNode, className: string): boolean {
  return String(node.props?.class ?? '').split(/\s+/u).includes(className)
}
check('real queue template has no edit/quote action and retains accessible reorder/delete bindings', () => {
  const { nodes, emitted } = renderQueueNodes([
    message({ backgroundPersisted: true }), message({ id: 'second-queue-row', backgroundPersisted: true }),
  ])
  const bodies = nodes.filter((node) => hasClass(node, 'queued-row-main'))
  assert.equal(bodies.length, 2)
  assert.ok(bodies.every((node) => node.type === 'div' && !Object.keys(node.props ?? {}).some((key) => /^on[A-Z]/u.test(key))))
  assert.equal(nodes.filter((node) => hasClass(node, 'queued-row-quote')).length, 0)
  for (const node of nodes.filter((node) => node.type === 'button')) {
    assert.ok(node.props?.['aria-label'], 'icon-only queue buttons need an accessible action name')
    node.props!.onClick({ stopPropagation() {} })
  }
  assert.deepEqual(emitted, [
    ['move', messageId, 'down'], ['delete', messageId],
    ['move', 'second-queue-row', 'up'], ['delete', 'second-queue-row'],
  ])
})
check('real failed queue template retains retry/delete without an editing bypass', () => {
  const { nodes, emitted } = renderQueueNodes([message({ deliveryState: 'failed', backgroundPersisted: true })])
  for (const node of nodes.filter((node) => node.type === 'button')) node.props!.onClick({ stopPropagation() {} })
  assert.deepEqual(emitted, [['retry', messageId], ['delete', messageId]])
})
const longText = `Fixture first line\n${'long-queue-instruction-'.repeat(80)}\nQUEUE_FULL_TEXT_END`
const renderedHtml = await renderToString(Vue.createSSRApp(queueComponent, {
  messages: [message({ text: longText, backgroundPersisted: true })], isProcessing: false,
}))
check('real queue SSR preserves complete multiline text and explains the temporary restriction', () => {
  assert.ok(renderedHtml.includes(longText), 'the actual component must retain the complete queue body')
  assert.match(renderedHtml, /暂不支持直接修改或立即引用/u)
  assert.match(renderedHtml, /原内容已保留/u)
})

let queueStyle = queueDescriptor.styles.map((style) => style.content).join('\n')
if (process.argv.includes('--baseline-clamped-css')) {
  // In-memory reconstruction of the previous production rule; never writes the SFC.
  const previous = postcss.parse(queueStyle)
  previous.walkRules('.queued-row-text', (rule) => {
    rule.walkDecls((declaration) => {
      if (declaration.prop === 'white-space' || declaration.prop === 'overflow-wrap') declaration.remove()
    })
    rule.append({ prop: 'display', value: '-webkit-box' }, { prop: '-webkit-line-clamp', value: '2' },
      { prop: '-webkit-box-orient', value: 'vertical' }, { prop: 'overflow', value: 'hidden' })
  })
  queueStyle = previous.toString()
}
const compiledStyle = compileStyle({ source: queueStyle, filename: queuePath, id: 'data-v-queue-contract', scoped: true })
assert.deepEqual(compiledStyle.errors, [])
const css = postcss.parse(compiledStyle.code)
check('compiled queue body CSS keeps every line readable and wraps long tokens', () => {
  const declarations = new Map<string, string>()
  css.walkRules((rule) => {
    if (rule.selector.startsWith('.queued-row-text[')) rule.walkDecls((declaration) => { declarations.set(declaration.prop, declaration.value) })
  })
  assert.equal(declarations.has('-webkit-line-clamp'), false, 'read-only queue text must not retain the previous two-line clamp')
  assert.notEqual(declarations.get('overflow'), 'hidden', 'read-only queue text must not hide its only reading surface')
  assert.equal(declarations.get('white-space'), 'pre-wrap')
  assert.equal(declarations.get('overflow-wrap'), 'anywhere')
})
check('compiled queue CSS preserves text selection and coarse-pointer action targets', () => {
  let selectable = false
  const controls = ['queued-row-retry', 'queued-row-move', 'queued-row-delete']
  const targetSizes = new Map(controls.map((control) => [control, { height: '', width: '' }]))
  css.walkRules((rule) => {
    if (rule.selector.startsWith('.queued-row-main[')) rule.walkDecls('user-select', (decl) => { selectable = decl.value === 'text' })
  })
  css.walkAtRules('media', (media) => {
    if (!media.params.includes('(pointer: coarse)')) return
    media.walkRules((rule) => {
      for (const control of controls) {
        if (!rule.selector.includes(`.${control}[`)) continue
        const size = targetSizes.get(control)!
        rule.walkDecls('min-height', (decl) => { size.height = decl.value })
        rule.walkDecls('min-width', (decl) => { size.width = decl.value })
      }
    })
  })
  assert.ok(selectable, 'read-only queue text must remain selectable')
  for (const [control, size] of targetSizes) {
    assert.deepEqual(size, { height: '44px', width: '44px' }, `${control} must retain a 44 by 44 px coarse-pointer target`)
  }
})
check('compiled dark queue tokens stay on the scoped component beneath an unscoped dark ancestor', () => {
  const tokenNames = [
    '--ui-bg-surface', '--ui-bg-surface-muted', '--ui-bg-row-hover',
    '--ui-border-subtle', '--ui-border-strong', '--ui-accent',
  ]
  const transcriptPath = resolve('src/components/content/ThreadConversation.vue')
  const transcript = parse(readFileSync(transcriptPath, 'utf8'), { filename: transcriptPath }).descriptor
  const transcriptCss = postcss.parse(transcript.styles.map((style) => style.content).join('\n'))
  const expectedTokens = new Map<string, string>()
  transcriptCss.walkRules('.dark .transcript-root', (rule) => {
    rule.walkDecls((declaration) => {
      if (tokenNames.includes(declaration.prop)) expectedTokens.set(declaration.prop, declaration.value)
    })
  })
  assert.equal(expectedTokens.size, tokenNames.length, 'the existing transcript palette must define every required token')
  const actualTokens = new Map<string, string>()
  css.walkRules((rule) => {
    rule.walkDecls((declaration) => {
      if (!tokenNames.includes(declaration.prop)) return
      // Vue's :global(.dark) prefix can compile to just .dark and leak tokens to
      // siblings; a scope on the ancestor would instead fail to match the app root.
      assert.equal(rule.selector, '.dark .queued-messages[data-v-queue-contract]',
        'dark token overrides must require an unscoped .dark ancestor and scope only the queue; light queues must not match')
      actualTokens.set(declaration.prop, declaration.value)
    })
  })
  assert.deepEqual(actualTokens, expectedTokens, 'the queue must define the existing dark palette on its own component scope')
})

console.log(`${checks - failures.length}/${checks} queue-edit contract checks passed.`)
console.log('These checks execute App.vue handlers with boundary spies; real HTTP DELETE/queue execution counts remain separate.')
if (failures.length) process.exitCode = 1
