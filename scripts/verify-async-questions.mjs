import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'output/async-questions/verification.mjs')
mkdirSync(resolve(root, 'output/async-questions'), { recursive: true })
await build({
  stdin: { contents: `
    export * from './src/asyncQuestions.ts'
    export * from './src/server/asyncQuestionTool.ts'
    export * from './src/server/appServerProcessServerRequests.ts'
    export * from './src/server/appServerRuntimeStart.ts'
    export * from './src/api/normalizers/v2.ts'
    export * from './src/composables/conversationProjection.ts'
  `, resolveDir: root, loader: 'ts' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22',
})
const api = await import(pathToFileURL(output).href)
const args = { questions: [{ title: 'Which output?', options: ['Summary', 'Details'] }, { title: 'Any constraints?' }] }
const item = { type: 'dynamicToolCall', id: 'call-example', namespace: null, tool: api.ASYNC_QUESTION_TOOL,
  arguments: args, status: 'completed', success: true, contentItems: [] }
const call = { threadId: 'thread-example', turnId: 'turn-example', callId: item.id, namespace: null, tool: item.tool, arguments: args }
const previous = process.env.CX_CODEX_ASYNC_QUESTIONS
let checks = 0
function check(name, run) { run(); checks++; console.log(`PASS ${name}`) }
try {
  check('opt-in leaves existing starts and unsupported tools unchanged', () => {
    delete process.env.CX_CODEX_ASYNC_QUESTIONS
    assert.equal(api.createRuntimeThreadStartParams({ cwd: '/workspace/example', model: '' }, 'linux').dynamicTools, undefined)
    assert.equal(api.asyncQuestionReply('item/tool/call', call), null)
    process.env.CX_CODEX_ASYNC_QUESTIONS = '1'
    assert.equal(api.createRuntimeThreadStartParams({ cwd: '', model: '' }, 'linux').dynamicTools[0].name, item.tool)
    assert.equal(api.asyncQuestionReply('item/tool/call', { ...call, tool: 'unknown' }), null)
    assert.equal(api.asyncQuestionReply('item/tool/requestUserInput', call), null)
    assert.equal(api.asyncQuestionReply('item/tool/call', { ...call, namespace: 'another-tool' }), null)
  })
  check('real request dispatcher immediately replies without a pending permission', () => {
    const handler = new api.AppServerProcessServerRequests()
    const replies = [], notifications = []
    const dependencies = {
      permissions: { allowAllPermissionRequests: false, commandExecution: 'ask', fileChange: 'ask', mcpTools: 'ask' },
      sendServerRequestReply: (id, reply) => replies.push({ id, ...reply }),
      emitNotification: (event) => notifications.push(event), writeUnsupportedRequestWarning: () => {},
    }
    handler.handleServerRequest(1, 'item/tool/call', call, dependencies)
    assert.equal(replies[0].result.success, true)
    assert.equal(JSON.parse(replies[0].result.contentItems[0].text).status, 'awaiting_user')
    assert.equal(handler.pendingCount, 0)
    assert.equal(notifications.length, 0)
    handler.handleServerRequest(2, 'item/tool/call', { ...call, tool: 'unknown' }, dependencies)
    assert.equal(replies[1].result.success, false)
    handler.handleServerRequest(3, 'item/tool/requestUserInput', { threadId: call.threadId, questions: [] }, dependencies)
    assert.equal(handler.pendingCount, 1)
  })
  check('malformed and oversized requests return failure', () => {
    for (const questions of [[], Array(4).fill({ title: 'x' }), [{ title: ' ' }], [{ title: 'x'.repeat(2001) }],
      [{ title: 'x', options: ['a', ' a'] }], [{ title: 'x', options: [null] }]]) {
      assert.equal(api.readAsyncQuestions({ questions }), null)
      assert.equal(api.asyncQuestionReply('item/tool/call', { ...call, arguments: { questions } }).result.success, false)
    }
  })
  check('only successful completed items become answerable cards', () => {
    assert.equal(api.readAsyncQuestionItem(item).questions.length, 2)
    for (const change of [{ status: 'inProgress' }, { success: false }, { tool: 'unknown' }, { namespace: 'other' }]) {
      assert.equal(api.readAsyncQuestionItem({ ...item, ...change }), null)
    }
  })
  const batch = api.readAsyncQuestionItem(item)
  const text = api.encodeAsyncAnswer(batch, ['Details', 'Keyboard access and 手机布局'])
  check('answer validation, free text and readable presentation', () => {
    assert.equal(api.readAsyncAnswer(text).callId, item.id)
    assert.match(api.displayAsyncAnswer(text), /Keyboard access and 手机布局/)
    assert.doesNotMatch(api.displayAsyncAnswer(text), /cx_async_answer/)
    assert.throws(() => api.encodeAsyncAnswer(batch, ['Details', ' ']))
    assert.equal(api.readAsyncAnswer('quoted: ' + text), null)
    assert.equal(api.readAsyncAnswer('<cx_async_answer>\n{}\n</cx_async_answer>'), null)
  })
  check('reloaded history reconstructs questions and confirmed answers', () => {
    const messages = api.normalizeThreadMessagesV2({ thread: { id: call.threadId, turns: [{ id: call.turnId, status: 'completed', items: [
      item, { type: 'userMessage', id: 'answer-example', content: [{ type: 'text', text }] },
    ] }] } })
    assert.equal(messages[0].asyncQuestion.callId, item.id)
    assert.equal(api.findAsyncAnswerMessage(batch, messages).id, 'answer-example')
    assert.equal(messages[1].text, text) // Preserve authoritative message identity and outbox matching.
    assert.equal(api.areMessageFieldsEqual(messages[0], { ...messages[0], asyncQuestion: { ...batch, questions: [{ title: 'changed' }] } }), false)
    assert.equal(api.areMessageFieldsEqual(messages[0], structuredClone(messages[0])), true)
  })
  check('pending, failed and unrelated messages never become confirmed answers', () => {
    const pending = { id: 'local', role: 'user', text, deliveryState: 'confirming' }
    assert.equal(api.findAsyncAnswerMessage(batch, [pending]).deliveryState, 'confirming')
    assert.equal(api.findAsyncAnswerMessage(batch, [{ ...pending, deliveryState: 'failed' }]).deliveryState, 'failed')
    assert.equal(api.findAsyncAnswerMessage(batch, [{ ...pending, role: 'assistant' }]), undefined)
    assert.equal(api.findAsyncAnswerMessage({ ...batch, callId: 'another-call' }, [pending]), undefined)
    assert.equal(api.findAsyncAnswerMessage({ ...batch, questions: [{ title: 'unrelated' }] }, [pending]), undefined)
  })
  console.log(`Async questions: ${checks} checks passed`)
} finally {
  if (previous === undefined) delete process.env.CX_CODEX_ASYNC_QUESTIONS
  else process.env.CX_CODEX_ASYNC_QUESTIONS = previous
}
