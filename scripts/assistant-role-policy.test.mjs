import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/server/assistantRolePolicy.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
const p = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`)
const binding = { threadId: 'main-native', cwd: 'E:/Synthetic/Assistant' }
const config = p.assistantHardeningConfig({ config: { model: 'private-model', api_key: 'SYNTHETIC-SECRET', mcp_servers: { privileged: { command: 'synthetic', env: { TOKEN: 'SYNTHETIC-SECRET' } } } } })

test('hardening only returns fixed flattened overrides, never host config or secrets', () => {
  assert.equal(config['features.shell_tool'], false)
  assert.equal(config['features.unified_exec'], false)
  assert.equal(config['agents.enabled'], false)
  assert.equal(config['mcp_servers.privileged.enabled'], false)
  assert.equal(config.web_search, 'disabled')
  assert.equal(JSON.stringify(config).includes('SYNTHETIC-SECRET'), false)
  assert.equal('model' in config, false)
})
test('bad MCP config fails closed', () => {
  for (const value of [null, {}, { config: null }, { config: { mcp_servers: [] } }, { config: { mcp_servers: { 'bad.name': {} } } }]) assert.throws(() => p.assistantHardeningConfig(value))
})
test('main thread is sandboxed with no dynamic execution tools', () => {
  const start = p.assistantThreadParams(binding.cwd, config)
  assert.equal(start.sandbox, 'read-only')
  assert.equal(start.approvalPolicy, 'never')
  assert.deepEqual(start.dynamicTools, [])
  assert.equal(start.developerInstructions, p.ASSISTANT_ROLE_INSTRUCTIONS)
})
test('ordinary calls remain untouched including null and absent parameters', () => {
  for (const args of [null, undefined, {}, { threadId: 'worker', permissions: ':danger' }]) assert.equal(p.protectAssistantRpc('model/list', args, binding, config), args)
})
test('no configured binding means no frontend role-prefix authorization', () => {
  const args = { threadId: binding.threadId, clientUserMessageId: 'assistant-main:forged' }
  assert.equal(p.protectAssistantRpc('thread/fork', args, null, config), args)
})
for (const method of ['config/value/write', 'config/batchWrite', 'config/write', 'config/mcpServer/reload']) test(`reject global policy mutation ${method}`, () => assert.throws(() => p.protectAssistantRpc(method, {}, binding, config)))
for (const method of ['thread/fork', 'thread/queue', 'turn/steer', 'thread/settings/update', 'future/unsafe']) test(`reject bound mutation ${method}`, () => assert.throws(() => p.protectAssistantRpc(method, { threadId: binding.threadId }, binding, config)))
test('conflicting target aliases cannot bypass main restriction', () => assert.throws(() => p.protectAssistantRpc('thread/fork', { threadId: 'worker', sourceThreadId: binding.threadId }, binding, config)))
test('main resume cannot replace identity using history or path', () => {
  assert.throws(() => p.protectAssistantRpc('thread/resume', { threadId: binding.threadId, path: 'elsewhere', history: [] }, binding, config))
  const result = p.protectAssistantRpc('thread/resume', { threadId: binding.threadId, permissions: ':danger', config: { dangerous: true } }, binding, config)
  assert.equal(result.threadId, binding.threadId)
  assert.equal(result.sandbox, 'read-only')
  assert.equal(result.cwd, binding.cwd)
  assert.equal('path' in result, false)
  assert.equal('history' in result, false)
  assert.deepEqual(result.config, config)
})
test('turn cannot inherit caller supplied permissions, extra context or roots', () => {
  const result = p.protectAssistantRpc('turn/start', { threadId: binding.threadId, input: [{ type: 'text', text: 'hi' }], permissions: ':danger', sandboxPolicy: { type: 'dangerFullAccess' }, cwd: 'X:/', additionalContext: { injected: true }, collaborationMode: { mode: 'default', settings: { model: 'synthetic', reasoning_effort: 'low', developer_instructions: 'escalate' } } }, binding, config)
  assert.deepEqual(result.sandboxPolicy, { type: 'readOnly', networkAccess: false })
  assert.equal(result.approvalPolicy, 'never')
  assert.equal(result.cwd, binding.cwd)
  assert.equal('permissions' in result, false)
  assert.equal('additionalContext' in result, false)
  assert.equal(result.collaborationMode.settings.developer_instructions, p.ASSISTANT_ROLE_INSTRUCTIONS)
  assert.equal(result.collaborationMode.settings.reasoning_effort, 'low')
})
test('turn with invalid input is rejected before native RPC', () => assert.throws(() => p.protectAssistantRpc('turn/start', { threadId: binding.threadId, input: 'not-array' }, binding, config)))
test('native path/history resume cannot load main through a different thread id', () => {
  for (const extra of [{ path: 'synthetic-rollout.jsonl' }, { history: [] }]) assert.throws(() => p.protectAssistantRpc('thread/resume', { threadId: 'worker', ...extra }, binding, config))
})
test('protected conversation can page its authoritative history', () => {
  for (const method of ['thread/turns/list', 'thread/items/list', 'thread/goal/get']) {
    const args = { threadId: binding.threadId, limit: 20 }
    assert.equal(p.protectAssistantRpc(method, args, binding, config), args)
  }
})
