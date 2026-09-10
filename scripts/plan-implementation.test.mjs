import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as plans from '../src/conversation-transcript/planImplementation.ts'

function proposal(id = 'plan') {
  return { kind: 'activity', activityType: 'plan', id, status: 'completed', text: '## 方案\n- 验证接口', steps: [] }
}
function turn(id, activities = [], opener = null, state = 'completed') {
  return { id, activities, opener, state }
}
function confirmation(deliveryState = null) {
  return { text: plans.PLAN_IMPLEMENTATION_CONFIRMATION, deliveryState }
}
const derive = (turns, threadId = 'thread-a') => plans.derivePlanImplementationState({ threadId, turns })

test('a completed proposal is actionable, but a progress checklist is not', () => {
  assert.equal(derive([turn('t1', [proposal()])]).actionablePlanKey, plans.planImplementationKey('t1', 'plan'))
  assert.equal(derive([turn('t1', [{ ...proposal(), text: '', steps: [{ step: 'done', status: 'completed' }] }])]).actionablePlanKey, null)
})
test('reload derives submission from the immediately following accepted confirmation', () => {
  const history = [turn('t1', [proposal()]), turn('t2', [], confirmation())]
  const state = derive(history)
  assert.deepEqual(state.implementedPlanKeys, [plans.planImplementationKey('t1', 'plan')])
  assert.deepEqual(derive(JSON.parse(JSON.stringify(history))), state)
  assert.equal(state.actionablePlanKey, null)
})
test('a pending confirmation is not success, and a failed confirmation permits retry', () => {
  for (const status of ['sending', 'confirmationPending', 'waitingNetwork']) {
    const state = derive([turn('t1', [proposal()]), turn('t2', [], confirmation(status), 'submitting')])
    assert.deepEqual(state.implementedPlanKeys, [])
    assert.equal(state.actionablePlanKey, null)
  }
  const failed = derive([turn('t1', [proposal()]), turn('local-failed', [], confirmation('failed'), 'failed')])
  assert.equal(failed.actionablePlanKey, plans.planImplementationKey('t1', 'plan'))
})
test('unrelated follow-up invalidates old proposal; only the latest proposal is actionable', () => {
  assert.equal(derive([turn('t1', [proposal()]), turn('t2', [], { text: '新的问题', deliveryState: null })]).actionablePlanKey, null)
  const state = derive([turn('t1', [proposal('old')]), turn('t2', [proposal('new')])])
  assert.equal(state.actionablePlanKey, plans.planImplementationKey('t2', 'new'))
  assert.deepEqual(derive([turn('t1', [proposal()]), turn('t2', [], { text: '新的问题' }), turn('t3', [], confirmation())]).implementedPlanKeys, [])
})
test('plan identity is turn-scoped and projections do not leak between threads', () => {
  const a = derive([turn('t1', [proposal()]), turn('t2', [proposal()], confirmation())])
  assert.deepEqual(a.implementedPlanKeys, [plans.planImplementationKey('t1', 'plan')])
  assert.equal(a.actionablePlanKey, plans.planImplementationKey('t2', 'plan'))
  assert.deepEqual(derive([turn('t1', [proposal()])], 'thread-b').implementedPlanKeys, [])
})
test('streaming, failed and interrupted proposals cannot be submitted', () => {
  for (const state of ['running', 'failed', 'interrupted', 'stopped']) {
    assert.equal(derive([turn('t1', [proposal()], null, state)]).actionablePlanKey, null)
  }
  assert.equal(derive([turn('t1', [{ ...proposal(), status: 'in-progress' }])]).actionablePlanKey, null)
})
