import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  beginChatFeedbackMetric,
  chatFeedbackNow,
  markChatFeedbackDomVisible,
  markChatFeedbackFirstAssistantData,
  markChatFeedbackServerAcknowledged,
  readChatFeedbackMetricSummary,
} from '../src/composables/chatFeedbackMetrics.js'
import { isChatFeedbackElementVisible, measureChatFeedbackDomMetrics } from '../src/composables/useChatFeedbackDomMetrics.js'

test('a mounted user bubble records feedback only for its exact pending message identity', () => {
  let writes = 0
  const host = {
    localStorage: { getItem: () => null, setItem: () => { writes += 1 } },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } })
  beginChatFeedbackMetric({
    threadId: 'thread-live', clientMessageId: 'client-live', optimisticMessageId: 'optimistic-live',
    submitStartedAtMs: chatFeedbackNow() - 20,
  })
  markChatFeedbackDomVisible({
    kind: 'user', threadId: 'thread-history', optimisticMessageId: 'optimistic-live',
  })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 0)
  markChatFeedbackDomVisible({
    kind: 'user', threadId: 'thread-live', optimisticMessageId: 'optimistic-live',
  })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 1)
  const settledWrites = writes
  for (let index = 0; index < 100; index += 1) {
    markChatFeedbackDomVisible({
      kind: 'user', threadId: 'thread-live', optimisticMessageId: 'optimistic-live',
    })
  }
  assert.equal(writes, settledWrites, 'later render frames must not repeat persistent milestone writes')
  assert.equal(readChatFeedbackMetricSummary()?.stages.runningVisible.count, 0, 'sending is not running')
})

test('visible running and assistant milestones belong to the exact acknowledged turn and item', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {} },
  } })
  beginChatFeedbackMetric({
    threadId: 'thread-owned', clientMessageId: 'client-owned', optimisticMessageId: 'optimistic-owned',
    submitStartedAtMs: chatFeedbackNow() - 20,
  })
  markChatFeedbackServerAcknowledged({ threadId: 'thread-owned', clientMessageId: 'client-owned', turnId: 'turn-owned' })
  markChatFeedbackFirstAssistantData({ threadId: 'thread-owned', turnId: 'turn-owned', messageId: 'item-owned' })
  markChatFeedbackDomVisible({ kind: 'running', threadId: 'thread-owned', turnId: 'turn-previous' })
  markChatFeedbackDomVisible({ kind: 'assistant', threadId: 'thread-owned', turnId: 'turn-previous', itemId: 'item-owned' })
  markChatFeedbackDomVisible({ kind: 'assistant', threadId: 'thread-owned', turnId: 'turn-owned', itemId: 'item-other' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.runningVisible.count, 0)
  assert.equal(readChatFeedbackMetricSummary()?.stages.firstAssistantVisible.count, 0)
  markChatFeedbackDomVisible({ kind: 'running', threadId: 'thread-owned', turnId: 'turn-owned' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.runningVisible.count, 1)
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 0, 'a visible status does not imply the user bubble is visible')
  markChatFeedbackDomVisible({ kind: 'assistant', threadId: 'thread-owned', turnId: 'turn-owned', itemId: 'item-owned' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.firstAssistantVisible.count, 1)
})

test('restored history and hidden documents never create visible milestones', () => {
  const restored = {
    threadId: 'thread-restored', clientMessageId: 'client-restored', optimisticMessageId: 'optimistic-restored',
    submitStartedAtMs: chatFeedbackNow() - 500, stateCommittedAtMs: chatFeedbackNow() - 490, stateCommitLatencyMs: 10,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => JSON.stringify({ version: 1, metrics: [restored] }), setItem: () => {} },
  } })
  markChatFeedbackDomVisible({ kind: 'user', threadId: restored.threadId, optimisticMessageId: restored.optimisticMessageId })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 0, 'restoring past measurements is not a fresh user interaction')
  beginChatFeedbackMetric({ ...restored, clientMessageId: 'client-fresh', optimisticMessageId: 'optimistic-fresh' })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'hidden' } })
  markChatFeedbackDomVisible({ kind: 'user', threadId: restored.threadId, optimisticMessageId: 'optimistic-fresh' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 0)
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } })
  markChatFeedbackDomVisible({ kind: 'user', threadId: restored.threadId, optimisticMessageId: 'optimistic-fresh', clientMessageId: 'client-other' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 0)
  markChatFeedbackDomVisible({ kind: 'user', threadId: restored.threadId, optimisticMessageId: 'optimistic-fresh', clientMessageId: 'client-fresh' })
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 1)
})

test('visibility excludes disconnected, folded, transparent and clipped content', () => {
  const doc = { visibilityState: 'visible', defaultView: {
    innerWidth: 400, innerHeight: 800,
    getComputedStyle: (element: { style: object }) => element.style,
  } }
  const element = (top: number, bottom: number, parent: unknown = null) => ({
    isConnected: true, ownerDocument: doc, parentElement: parent, hidden: false,
    style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top }),
  })
  const root = element(100, 600)
  const visible = element(200, 240, root)
  const check = (target: ReturnType<typeof element>) => isChatFeedbackElementVisible(target as unknown as HTMLElement, root as unknown as HTMLElement)
  assert.equal(check(visible), true)
  assert.equal(check(element(700, 740, root)), false, 'outside the conversation scrollport')
  assert.equal(check({ ...visible, isConnected: false }), false)
  assert.equal(check({ ...visible, style: { ...visible.style, opacity: '0' } }), false)
  assert.equal(check({ ...visible, style: { ...visible.style, display: 'none' } }), false)
  const foldedParent = { ...root, style: { ...root.style, visibility: 'hidden' } }
  assert.equal(check(element(200, 240, foldedParent)), false)
  doc.visibilityState = 'hidden'
  assert.equal(check(visible), false)
})

test('completed DOM milestones stop layout reads and persistent writes on later token renders', () => {
  let layoutReads = 0
  let writes = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => { writes += 1 } },
  } })
  beginChatFeedbackMetric({ threadId: 'thread-budget', clientMessageId: 'client-budget', optimisticMessageId: 'optimistic-budget', submitStartedAtMs: chatFeedbackNow() - 20 })
  const doc = { visibilityState: 'visible', defaultView: {
    innerWidth: 400, innerHeight: 800,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' }),
  } }
  const bounds = () => { layoutReads += 1; return { top: 10, bottom: 100, left: 0, right: 300 } }
  const root = { isConnected: true, ownerDocument: doc, parentElement: null, getBoundingClientRect: bounds, querySelectorAll: () => [bubble] }
  const bubble = {
    isConnected: true, ownerDocument: doc, parentElement: root,
    getBoundingClientRect: bounds, getClientRects: () => [{}],
    dataset: { chatFeedbackKind: 'user', chatFeedbackThreadId: 'thread-budget', chatFeedbackOptimisticMessageId: 'optimistic-budget' },
  }
  const measure = () => measureChatFeedbackDomMetrics(root as unknown as HTMLElement, 'thread-budget')
  assert.equal(measure().length, 0, 'a completed visible node no longer needs intersection observation')
  assert.equal(readChatFeedbackMetricSummary()?.stages.bubbleVisible.count, 1)
  const completedReads = layoutReads
  const completedWrites = writes
  assert.ok(completedReads > 0)
  for (let index = 0; index < 100; index += 1) measure()
  assert.equal(layoutReads, completedReads, 'settled milestones do not force layout on streaming renders')
  assert.equal(writes, completedWrites)
})

test('expanded historical markers cannot crowd a pending visible tail reply out of the measurement budget', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {} },
  } })
  beginChatFeedbackMetric({
    threadId: 'thread-tail', clientMessageId: 'client-tail', optimisticMessageId: 'optimistic-tail',
    submitStartedAtMs: chatFeedbackNow() - 20,
  })
  markChatFeedbackServerAcknowledged({ threadId: 'thread-tail', clientMessageId: 'client-tail', turnId: 'turn-tail' })
  markChatFeedbackFirstAssistantData({ threadId: 'thread-tail', turnId: 'turn-tail', messageId: 'item-tail' })
  let historicalLayoutReads = 0
  const doc = { visibilityState: 'visible', defaultView: {
    innerWidth: 400, innerHeight: 800,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' }),
  } }
  const bounds = () => ({ top: 10, bottom: 100, left: 0, right: 300 })
  const root = { isConnected: true, ownerDocument: doc, parentElement: null, getBoundingClientRect: bounds, querySelectorAll: () => [...history, tail] }
  const history = Array.from({ length: 170 }, (_, index) => ({
    isConnected: true, ownerDocument: doc, parentElement: root,
    getBoundingClientRect: () => { historicalLayoutReads += 1; return bounds() }, getClientRects: () => [{}],
    dataset: { chatFeedbackKind: 'assistant', chatFeedbackThreadId: 'thread-tail', chatFeedbackTurnId: `turn-history-${index}`, chatFeedbackItemId: `item-history-${index}` },
  }))
  const tail = {
    isConnected: true, ownerDocument: doc, parentElement: root,
    getBoundingClientRect: bounds, getClientRects: () => [{}],
    dataset: { chatFeedbackKind: 'assistant', chatFeedbackThreadId: 'thread-tail', chatFeedbackTurnId: 'turn-tail', chatFeedbackItemId: 'item-tail' },
  }
  assert.equal(measureChatFeedbackDomMetrics(root as unknown as HTMLElement, 'thread-tail').length, 0)
  assert.equal(readChatFeedbackMetricSummary()?.stages.firstAssistantVisible.count, 1, 'the current visible reply is measured after more than 128 historical markers')
  assert.equal(historicalLayoutReads, 0, 'historical markers consume neither layout nor observer budget')
})
