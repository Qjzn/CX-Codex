import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as payload from '../src/server/runtimePayload.js'
import { createAppServerJsonRpcError, createRpcTimeoutError } from '../src/server/appServerRpcErrors.js'

const input = [{ type: 'text', text: 'Draft a plan' }]

test('Plan uses the current native collaboration object, without rewriting user text', () => {
  const result = payload.normalizePlanModeTurnStartParams({ threadId: 't', collaborationMode: 'plan', model: 'model-a', effort: ' high ', input }) as any
  assert.deepEqual(result.collaborationMode, {
    mode: 'plan', settings: { model: 'model-a', reasoning_effort: 'high', developer_instructions: null },
  })
  assert.equal(result.mode, undefined)
  assert.deepEqual(result.input, input)
})

test('Execute explicitly resets a sticky Plan mode to native default', () => {
  const result = payload.normalizePlanModeTurnStartParams({ collaborationMode: 'execute', model: 'model-a', input }) as any
  assert.deepEqual(result.collaborationMode, {
    mode: 'default', settings: { model: 'model-a', reasoning_effort: null, developer_instructions: null },
  })
  assert.equal(result.mode, undefined)
})

test('a caller already using the native protocol keeps its explicit settings', () => {
  const params = { threadId: 't', input, collaborationMode: {
    mode: 'plan', settings: { model: 'model-native', reasoning_effort: 'low', developer_instructions: 'native instructions' },
  } }
  assert.equal(payload.readCollaborationModeFromPayload(params), 'plan')
  assert.deepEqual(payload.normalizePlanModeTurnStartParams(params), params)
})

test('legacy Plan fallback removes native mode and wraps only the first text', () => {
  const result = payload.normalizePlanModeTurnStartParams({ mode: 'plan', model: 'model-a', input: [...input, { type: 'text', text: 'second' }] }, { includeNativeMode: false }) as any
  assert.equal(result.collaborationMode, undefined)
  assert.equal(result.mode, undefined)
  assert.match(result.input[0].text, /Do not edit, create, delete/)
  assert.equal(result.input[1].text, 'second')
})

test('only a definite unsupported native-field rejection permits a second start', () => {
  assert.equal(payload.shouldRetryPlanModeWithoutNativeMode(createAppServerJsonRpcError({ code: -32602, message: 'unknown field `collaborationMode`' })), true)
  for (const error of [
    new Error('unknown model during generation'),
    new Error('unknown mode after model execution'),
    createRpcTimeoutError('turn/start', 1000),
    createAppServerJsonRpcError({ code: -32000, message: 'invalid collaborationMode during execution' }),
    createAppServerJsonRpcError({ code: -32602, message: 'invalid model' }),
  ]) assert.equal(payload.shouldRetryPlanModeWithoutNativeMode(error), false)
})

test('explicit model avoids any lookup on the send critical path', async () => {
  const result = await payload.prepareNativeCollaborationTurnStartParams({ collaborationMode: 'execute', model: 'model-a', input }, async () => {
    assert.fail('no metadata lookup for an explicit model')
  }) as any
  assert.equal(result.collaborationMode.mode, 'default')
})

test('an omitted model is resolved from its actual thread, preserving effort', async () => {
  const calls: string[] = []
  const result = await payload.prepareNativeCollaborationTurnStartParams({ threadId: 't', collaborationMode: 'plan', input }, async (method, params) => {
    calls.push(method)
    assert.deepEqual(params, { threadId: 't', includeTurns: false })
    return { thread: { model: 'thread-model', reasoningEffort: 'medium' } }
  }) as any
  assert.deepEqual(calls, ['thread/read'])
  assert.deepEqual(result.collaborationMode.settings, { model: 'thread-model', reasoning_effort: 'medium', developer_instructions: null })
})

test('missing thread model uses effective config, never an invented model', async () => {
  const calls: string[] = []
  const result = await payload.prepareNativeCollaborationTurnStartParams({ threadId: 't', collaborationMode: 'execute', input }, async (method) => {
    calls.push(method)
    return method === 'thread/read' ? { thread: {} } : { config: { model: 'config-model', model_reasoning_effort: 'high' } }
  }) as any
  assert.deepEqual(calls, ['thread/read', 'config/read'])
  assert.equal(result.collaborationMode.settings.model, 'config-model')
  assert.equal(result.collaborationMode.mode, 'default')
})

test('pre-send lookup timeout stays a definite failure, never uncertain turn/start', async () => {
  await assert.rejects(() => payload.prepareNativeCollaborationTurnStartParams({ threadId: 't', collaborationMode: 'plan', input }, async () => {
    throw createRpcTimeoutError('thread/read', 1000)
  }), (error: any) => {
    assert.equal(error.name, 'Error')
    assert.match(error.message, /before turn\/start/)
    return true
  })
})
