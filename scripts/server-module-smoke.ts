import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppServerLineBuffer } from '../src/server/appServerLineBuffer.js'
import { AppServerRpcCache, getShareableRpcKey, shouldInvalidateThreadListCacheForRpc } from '../src/server/appServerRpcCache.js'
import { AppServerRpcDiagnostics } from '../src/server/appServerRpcDiagnostics.js'
import { AppServerRpcQueue, getAppServerRpcQueuePriority } from '../src/server/appServerRpcQueue.js'
import { AppServerStderrLogger, type AppServerStderrLogEntry } from '../src/server/appServerStderrLogger.js'
import { PendingServerRequestStore } from '../src/server/pendingServerRequests.js'
import { PlanModeTurnStore } from '../src/server/planModeTurnStore.js'
import {
  buildAutoApprovalResult,
  buildPlanModeDeclineResult,
  buildUnsupportedServerRequestResult,
  evaluateServerRequestPolicy,
  isMcpToolPermissionRequest,
  shouldAutoApproveServerRequest,
} from '../src/server/serverRequestPolicy.js'
import {
  DEFAULT_WEB_BRIDGE_SETTINGS,
  normalizePermissionDecision,
  normalizeWebBridgeSettings,
  readWebBridgeSettings,
  writeWebBridgeSettings,
} from '../src/server/webBridgeSettings.js'
import {
  normalizeThreadTokenUsage,
  normalizeThreadTokenUsageFromSessionLogEntry,
  parseThreadTokenUsageFromSessionLog,
  readThreadTokenUsageFromSessionLog,
  readThreadTokenUsageFromThreadReadPayload,
  ThreadTokenUsageStore,
} from '../src/server/threadTokenUsage.js'
import {
  mergeThreadTitleCaches,
  normalizeThreadTitleCache,
  parseThreadTitlesFromSessionIndex,
  readMergedThreadTitleCache,
  readThreadTitleCache,
  readThreadTitlesFromSessionIndex,
  removeFromThreadTitleCache,
  updateThreadTitleCache,
  writeThreadTitleCache,
} from '../src/server/threadTitleCache.js'
import {
  isRuntimeActiveState,
  RuntimeStateStore,
  toPersistableRuntimeSnapshot,
} from '../src/server/runtimeState.js'

const originalNow = Date.now

try {
  smokePendingServerRequests()
  await smokeAppServerRpcCache()
  smokeAppServerRpcDiagnostics()
  await smokeAppServerRpcQueue()
  smokeAppServerLineBuffer()
  smokeAppServerStderrLogger()
  smokePlanModeTurnStore()
  smokeServerRequestPolicy()
  await smokeWebBridgeSettings()
  await smokeThreadTokenUsage()
  await smokeThreadTitleCache()
  smokeRuntimeStateStore()
  console.log('server module smoke ok')
} finally {
  Date.now = originalNow
}

function smokePendingServerRequests(): void {
  const store = new PendingServerRequestStore()
  const first = store.record(7, 'item/commandExecution/requestApproval', { threadId: 'thread-a' })
  const second = store.record(8, 'item/fileChange/requestApproval', { thread: { id: 'thread-b' } })

  assert.equal(store.count, 2)
  assert.equal(first.id, 7)
  assert.equal(second.method, 'item/fileChange/requestApproval')
  assert.deepEqual(store.listForThread('thread-a', readThreadIdFromPayload).map((row) => row.id), [7])
  assert.equal(store.consume(7)?.method, 'item/commandExecution/requestApproval')
  assert.equal(store.consume(7), null)
  assert.equal(store.count, 1)
  store.clear()
  assert.equal(store.count, 0)
}

async function smokeAppServerRpcCache(): Promise<void> {
  assert.equal(getShareableRpcKey('thread/start', {}), null)
  assert.equal(getShareableRpcKey('thread/list', { limit: 1 }), 'thread/list:{"limit":1}')
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/name/set'), true)
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/read'), false)

  let now = 1_000
  Date.now = () => now
  const cache = new AppServerRpcCache()
  const key = getShareableRpcKey('thread/list', {}) ?? ''

  cache.writeThreadList(key, { rows: ['fresh'] })
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['fresh'] }, stale: false })

  now += 4 * 60_000
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['fresh'] }, stale: true })

  let refreshCalls = 0
  cache.refreshThreadListInBackground(key, {}, async () => {
    refreshCalls += 1
    return { rows: ['refreshed'] }
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(refreshCalls, 1)
  assert.deepEqual(cache.readThreadList(key, true), { value: { rows: ['refreshed'] }, stale: false })

  now += 21 * 60_000
  assert.equal(cache.readThreadList(key, false), null)
}

function smokeAppServerRpcDiagnostics(): void {
  let now = 5_000
  Date.now = () => now
  const diagnostics = new AppServerRpcDiagnostics(
    {
      isHeavyThreadRead: (method, params) => method === 'thread/read' && readIncludeTurns(params) === true,
    },
    {
      slowWarnMs: 100,
      queueWarnSize: 2,
      queueWarnIntervalMs: 1_000,
      timeoutRestartWindowMs: 10_000,
      timeoutRestartThreshold: 2,
    },
  )

  diagnostics.incrementActive()
  diagnostics.recordQueueDepth(2, now)
  diagnostics.maybeWarnQueueBacklog('thread/read', { includeTurns: true }, 2, now)
  diagnostics.logSlowRpc('thread/read', now - 150, { includeTurns: true }, { outcome: 'success' })
  diagnostics.recordTimeout('thread/read', { includeTurns: true }, 30_000, now)

  const threadReadTimeout = diagnostics.noteRestartableTimeout('thread/read', now)
  assert.equal(threadReadTimeout.shouldRestart, false)

  const firstTimeout = diagnostics.noteRestartableTimeout('thread/start', now)
  assert.equal(firstTimeout.shouldRestart, false)
  const secondTimeout = diagnostics.noteRestartableTimeout('thread/start', now + 1)
  assert.equal(secondTimeout.shouldRestart, true)
  assert.equal(secondTimeout.timeoutCount, 2)

  diagnostics.decrementActive()
  const snapshot = diagnostics.snapshot(1, 2)
  assert.equal(snapshot.activeRpcCalls, 0)
  assert.equal(snapshot.pendingRpcCount, 1)
  assert.equal(snapshot.queuedRpcCount, 2)
  assert.equal(snapshot.queuePeakCount, 2)
  assert.equal(snapshot.recentSlowRpc[0]?.includeTurns, true)
  assert.equal(snapshot.recentTimeouts[0]?.outcome, 'timeout')

  diagnostics.resetTimeoutWindow()
  assert.equal(diagnostics.noteRestartableTimeout('thread/start', now + 20_000).shouldRestart, false)
}

async function smokeAppServerRpcQueue(): Promise<void> {
  assert.equal(getAppServerRpcQueuePriority('turn/start', {}), 0)
  assert.equal(getAppServerRpcQueuePriority('thread/read', {}), 1)
  assert.equal(getAppServerRpcQueuePriority('thread/list', {}), 4)
  assert.equal(getAppServerRpcQueuePriority('model/list', {}), 5)

  let now = 9_000
  Date.now = () => now++
  const diagnostics = new AppServerRpcDiagnostics(
    {
      isHeavyThreadRead: (method, params) => method === 'thread/read' && readIncludeTurns(params) === true,
    },
    {
      slowWarnMs: 100,
      queueWarnSize: 10,
      queueWarnIntervalMs: 1_000,
      timeoutRestartWindowMs: 10_000,
      timeoutRestartThreshold: 2,
    },
  )

  const startedMethods: string[] = []
  const releaseCurrent: Array<() => void> = []
  const queue = new AppServerRpcQueue({
    maxSize: 3,
    maxInFlight: 1,
    diagnostics,
    execute: async (method) => {
      startedMethods.push(method)
      await new Promise<void>((resolve) => {
        releaseCurrent.push(resolve)
      })
      return `${method}:done`
    },
  })

  const first = queue.enqueue('thread/read', { includeTurns: false })
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read'])

  const lowPriority = queue.enqueue('model/list', {})
  const highPriority = queue.enqueue('thread/read', { includeTurns: false })
  assert.equal(queue.count, 2)

  releaseCurrent.shift()?.()
  assert.equal(await first, 'thread/read:done')
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read', 'thread/read'])

  releaseCurrent.shift()?.()
  assert.equal(await highPriority, 'thread/read:done')
  await flushMicrotasks()
  assert.deepEqual(startedMethods, ['thread/read', 'thread/read', 'model/list'])

  releaseCurrent.shift()?.()
  assert.equal(await lowPriority, 'model/list:done')
  assert.equal(queue.count, 0)

  const stalledQueue = new AppServerRpcQueue({
    maxSize: 1,
    maxInFlight: 0,
    diagnostics,
    execute: async () => 'unreachable',
  })
  const pending = stalledQueue.enqueue('thread/read', {})
  await assert.rejects(
    stalledQueue.enqueue('thread/read', {}),
    /codex app-server RPC queue is full \(1\)/,
  )
  stalledQueue.rejectAll(new Error('queue stopped'))
  await assert.rejects(pending, /queue stopped/)
}

function smokeAppServerLineBuffer(): void {
  const captured = { lines: [] as string[] }
  const captureLine = (line: string): void => {
    captured.lines.push(line)
  }
  const buffer = new AppServerLineBuffer()

  buffer.push('{"jsonrpc":"2.0"', captureLine)
  assert.equal(buffer.pendingLength, 16)
  assert.deepEqual(captured.lines, [])

  buffer.push(',"id":1}\n\n  {"method":"notify"}\n{"pending":', captureLine)
  assert.deepEqual(captured.lines, ['{"jsonrpc":"2.0","id":1}', '{"method":"notify"}'])
  assert.equal(buffer.pendingLength, 11)

  buffer.push('true}\n', captureLine)
  assert.deepEqual(captured.lines, ['{"jsonrpc":"2.0","id":1}', '{"method":"notify"}', '{"pending":true}'])
  assert.equal(buffer.pendingLength, 0)

  buffer.push('partial', captureLine)
  assert.equal(buffer.pendingLength, 7)
  buffer.clear()
  assert.equal(buffer.pendingLength, 0)
}

function smokeAppServerStderrLogger(): void {
  let now = 60_000
  const entries: AppServerStderrLogEntry[] = []
  const logger = new AppServerStderrLogger({
    intervalMs: 30_000,
    maxMessageLength: 12,
    now: () => now,
    writeLog: (entry) => entries.push(entry),
  })

  assert.equal(logger.log('first warning message'), true)
  assert.deepEqual(entries, [{ message: 'first warnin' }])
  assert.equal(logger.pendingSuppressedCount, 0)

  now += 1_000
  assert.equal(logger.log('second warning message'), false)
  assert.equal(logger.log('third warning message'), false)
  assert.equal(logger.pendingSuppressedCount, 2)
  assert.equal(entries.length, 1)

  now += 30_000
  assert.equal(logger.log('fourth warning message'), true)
  assert.deepEqual(entries[1], { message: 'fourth warni', suppressedCount: 2 })
  assert.equal(logger.pendingSuppressedCount, 0)
}

function smokePlanModeTurnStore(): void {
  let now = 10_000
  const store = new PlanModeTurnStore({ now: () => now })

  store.mark(' thread-a ', ' turn-a ')
  assert.equal(store.count, 1)
  assert.deepEqual(store.list(), [{ threadId: 'thread-a', turnId: 'turn-a', startedAtMs: 10_000 }])
  assert.equal(store.isActiveRequest('thread-a', ''), true)
  assert.equal(store.isActiveRequest('thread-a', 'turn-a'), true)
  assert.equal(store.isActiveRequest('thread-a', 'other-turn'), false)

  store.clear('thread-a', 'other-turn')
  assert.equal(store.count, 1)
  store.clear('thread-a', 'turn-a')
  assert.equal(store.count, 0)

  now += 1
  store.mark('thread-b', 'turn-b')
  store.mark('thread-c', 'turn-c')
  store.clearByThreadOrTurn('', 'turn-b')
  assert.equal(store.isActiveRequest('thread-b', 'turn-b'), false)
  assert.equal(store.isActiveRequest('thread-c', 'turn-c'), true)

  store.clearByThreadOrTurn('thread-c', 'wrong-turn')
  assert.equal(store.count, 1)
  store.clearAll()
  assert.equal(store.count, 0)
}

function smokeServerRequestPolicy(): void {
  const askPermissions = {
    allowAllPermissionRequests: false,
    commandExecution: 'ask' as const,
    fileChange: 'ask' as const,
    mcpTools: 'ask' as const,
  }
  const allowSessionPermissions = {
    allowAllPermissionRequests: false,
    commandExecution: 'allowForSession' as const,
    fileChange: 'allowForSession' as const,
    mcpTools: 'allowForSession' as const,
  }

  const mcpParams = {
    request: {
      params: {
        message: 'Allow the demo MCP server to run tool "lookup"?',
      },
    },
  }
  assert.equal(isMcpToolPermissionRequest('mcpserver/elicitation/request', mcpParams), true)
  assert.equal(isMcpToolPermissionRequest('mcpserver/elication/request', {
    serverName: 'demo',
    toolName: 'lookup',
  }), true)
  assert.equal(isMcpToolPermissionRequest('elicitation/create', { params: { message: 'Choose a value' } }), false)

  assert.equal(shouldAutoApproveServerRequest('item/commandExecution/requestApproval', {}, askPermissions), false)
  assert.equal(shouldAutoApproveServerRequest('item/commandExecution/requestApproval', {}, allowSessionPermissions), true)
  assert.deepEqual(buildAutoApprovalResult('item/commandExecution/requestApproval', {}), { decision: 'acceptForSession' })
  assert.deepEqual(buildAutoApprovalResult('mcpserver/elicitation/request', mcpParams), { action: 'accept' })

  assert.deepEqual(buildPlanModeDeclineResult('item/fileChange/requestApproval', {}), { decision: 'decline' })
  assert.deepEqual(buildPlanModeDeclineResult('mcpserver/elicitation/request', mcpParams), { action: 'decline' })
  assert.equal(evaluateServerRequestPolicy({
    method: 'item/fileChange/requestApproval',
    params: {},
    permissions: allowSessionPermissions,
    isPlanModeRequest: true,
  }).kind, 'plan-decline')
  assert.equal(evaluateServerRequestPolicy({
    method: 'mcpserver/elicitation/request',
    params: mcpParams,
    permissions: askPermissions,
    isPlanModeRequest: false,
  }).kind, 'queue')
  assert.equal(evaluateServerRequestPolicy({
    method: 'mcpserver/elicitation/request',
    params: mcpParams,
    permissions: allowSessionPermissions,
    isPlanModeRequest: false,
  }).kind, 'auto-approve')
  const unsupported = evaluateServerRequestPolicy({
    method: 'item/tool/call',
    params: {},
    permissions: allowSessionPermissions,
    isPlanModeRequest: false,
  })
  assert.equal(unsupported.kind, 'reject-unsupported')
  assert.match(JSON.stringify(buildUnsupportedServerRequestResult('item/tool/call')), /不能代执行这个工具/)
}

async function smokeWebBridgeSettings(): Promise<void> {
  assert.equal(normalizePermissionDecision('ask', 'allowForSession'), 'ask')
  assert.equal(normalizePermissionDecision('deny', 'allowForSession'), 'allowForSession')
  assert.deepEqual(normalizeWebBridgeSettings({
    permissions: {
      allowAllPermissionRequests: true,
      commandExecution: 'ask',
      fileChange: 'invalid',
      mcpTools: 'allowForSession',
    },
  }), {
    permissions: {
      allowAllPermissionRequests: true,
      commandExecution: 'ask',
      fileChange: 'allowForSession',
      mcpTools: 'allowForSession',
    },
  })
  assert.deepEqual(normalizeWebBridgeSettings(null), DEFAULT_WEB_BRIDGE_SETTINGS)

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-web-settings-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')
    assert.deepEqual(await readWebBridgeSettings(settingsPath), DEFAULT_WEB_BRIDGE_SETTINGS)

    await writeFile(settingsPath, '{invalid', 'utf8')
    assert.deepEqual(await readWebBridgeSettings(settingsPath), DEFAULT_WEB_BRIDGE_SETTINGS)

    const written = await writeWebBridgeSettings(settingsPath, {
      permissions: {
        allowAllPermissionRequests: true,
        commandExecution: 'ask',
        fileChange: 'ask',
        mcpTools: 'bad',
      },
    })
    assert.deepEqual(written, {
      permissions: {
        allowAllPermissionRequests: true,
        commandExecution: 'ask',
        fileChange: 'ask',
        mcpTools: 'ask',
      },
    })
    assert.deepEqual(await readWebBridgeSettings(settingsPath), written)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokeThreadTokenUsage(): Promise<void> {
  const usage = normalizeThreadTokenUsage({
    total_token_usage: {
      total_tokens: -1,
      input_tokens: 300,
      cached_input_tokens: 25,
      output_tokens: 70,
      reasoning_output_tokens: 9,
    },
    last: {
      totalTokens: 250,
      inputTokens: 180,
      cachedInputTokens: 10,
      outputTokens: 60,
      reasoningOutputTokens: 8,
    },
    model_context_window: 1000,
  })
  assert.ok(usage)
  assert.equal(usage?.total.totalTokens, 0)
  assert.equal(usage?.total.inputTokens, 300)
  assert.equal(usage?.last.totalTokens, 250)
  assert.equal(usage?.usedPercent, 25)
  assert.equal(usage?.remainingTokens, 750)

  const fromThreadRead = readThreadTokenUsageFromThreadReadPayload({
    thread: {
      tokenUsage: {
        total: usage?.total,
        last: usage?.last,
        used_percent: 101,
        remaining_tokens: -10,
      },
    },
  })
  assert.equal(fromThreadRead?.usedPercent, 100)
  assert.equal(fromThreadRead?.remainingTokens, 0)

  const fromSessionEntry = normalizeThreadTokenUsageFromSessionLogEntry({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: usage?.total,
        last_token_usage: usage?.last,
        model_context_window: 500,
      },
    },
  })
  assert.equal(fromSessionEntry?.modelContextWindow, 500)
  assert.equal(fromSessionEntry?.usedPercent, 50)

  const store = new ThreadTokenUsageStore()
  store.observeUpdate({ threadId: ' thread-a ', tokenUsage: { total: usage?.total, last: usage?.last } })
  assert.equal(store.count, 1)
  assert.equal(store.get('thread-a')?.last.outputTokens, 60)
  store.observeUpdate({ threadId: 'thread-a', tokenUsage: { invalid: true } })
  assert.equal(store.get('thread-a'), null)
  assert.equal(store.count, 0)

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-token-usage-'))
  try {
    const sessionPath = join(tempDir, 'session.jsonl')
    await writeFile(sessionPath, [
      '{malformed',
      JSON.stringify({ type: 'event_msg', payload: { type: 'other' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total: usage?.total,
            last: { ...usage?.last, totalTokens: 100 },
            modelContextWindow: 1000,
          },
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              total_tokens: usage.total.totalTokens,
              input_tokens: usage.total.inputTokens,
              cached_input_tokens: usage.total.cachedInputTokens,
              output_tokens: usage.total.outputTokens,
              reasoning_output_tokens: usage.total.reasoningOutputTokens,
            },
            last_token_usage: {
              total_tokens: 300,
              input_tokens: usage.last.inputTokens,
              cached_input_tokens: usage.last.cachedInputTokens,
              output_tokens: usage.last.outputTokens,
              reasoning_output_tokens: usage.last.reasoningOutputTokens,
            },
            model_context_window: 1000,
          },
        },
      }),
    ].join('\n'), 'utf8')

    assert.equal((await parseThreadTokenUsageFromSessionLog(sessionPath))?.last.totalTokens, 300)
    assert.equal((await readThreadTokenUsageFromSessionLog(sessionPath))?.remainingTokens, 700)
    assert.equal(await readThreadTokenUsageFromSessionLog(join(tempDir, 'missing.jsonl')), null)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokeThreadTitleCache(): Promise<void> {
  assert.deepEqual(normalizeThreadTitleCache(null), { titles: {}, order: [] })
  assert.deepEqual(normalizeThreadTitleCache({
    titles: { a: 'Alpha', b: '', c: 7 },
    order: ['a', 'missing', 'a', '', 9],
  }), {
    titles: { a: 'Alpha' },
    order: ['a', 'missing'],
  })

  const updated = updateThreadTitleCache({ titles: { a: 'Alpha' }, order: ['a'] }, 'b', 'Beta')
  assert.deepEqual(updated, { titles: { a: 'Alpha', b: 'Beta' }, order: ['b', 'a'] })
  assert.deepEqual(removeFromThreadTitleCache(updated, 'a'), { titles: { b: 'Beta' }, order: ['b'] })
  assert.deepEqual(mergeThreadTitleCaches(
    { titles: { a: 'Alpha', b: 'Base Beta' }, order: ['a', 'b'] },
    { titles: { b: 'Session Beta', c: 'Gamma' }, order: ['c', 'b'] },
  ), {
    titles: { a: 'Alpha', b: 'Session Beta', c: 'Gamma' },
    order: ['c', 'b', 'a'],
  })

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-thread-title-'))
  try {
    const statePath = join(tempDir, 'global-state.json')
    const sessionIndexPath = join(tempDir, 'session_index.jsonl')

    assert.deepEqual(await readThreadTitleCache(statePath), { titles: {}, order: [] })
    await writeFile(statePath, JSON.stringify({ existing: true }), 'utf8')
    await writeThreadTitleCache(statePath, { titles: { manual: 'Manual title' }, order: ['manual'] })
    assert.deepEqual(await readThreadTitleCache(statePath), {
      titles: { manual: 'Manual title' },
      order: ['manual'],
    })

    await writeFile(sessionIndexPath, [
      '{malformed',
      JSON.stringify({ id: 'thread-a', thread_name: 'Old A', updated_at: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ id: 'thread-a', thread_name: 'New A', updated_at: '2026-01-02T00:00:00.000Z' }),
      JSON.stringify({ id: 'thread-b', thread_name: 'Beta', updated_at: 'not-a-date' }),
      JSON.stringify({ id: 'thread-c', thread_name: '  ', updated_at: '2026-01-03T00:00:00.000Z' }),
    ].join('\n'), 'utf8')

    assert.deepEqual(await parseThreadTitlesFromSessionIndex(sessionIndexPath), {
      titles: { 'thread-a': 'New A', 'thread-b': 'Beta' },
      order: ['thread-a', 'thread-b'],
    })
    assert.deepEqual(await readThreadTitlesFromSessionIndex(sessionIndexPath), {
      titles: { 'thread-a': 'New A', 'thread-b': 'Beta' },
      order: ['thread-a', 'thread-b'],
    })
    assert.deepEqual(await readThreadTitlesFromSessionIndex(join(tempDir, 'missing.jsonl')), { titles: {}, order: [] })
    assert.deepEqual(await readMergedThreadTitleCache(statePath, sessionIndexPath), {
      titles: { manual: 'Manual title', 'thread-a': 'New A', 'thread-b': 'Beta' },
      order: ['thread-a', 'thread-b', 'manual'],
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function smokeRuntimeStateStore(): void {
  const store = new RuntimeStateStore({
    readThreadIdFromPayload,
    readTurnIdFromPayload,
    readItemIdFromPayload,
    readThreadInProgressFromThreadReadPayload: (payload) => readBooleanProperty(payload, 'inProgress'),
    getErrorMessage: (_payload, fallback) => fallback,
  }, { staleMs: 100 })

  store.markQueued('thread-a')
  assert.equal(isRuntimeActiveState(store.snapshot('thread-a').executionState), true)

  store.observeEvent({
    method: 'turn/started',
    params: { threadId: 'thread-a', turnId: 'turn-1', itemId: 'item-1' },
    atIso: new Date(1).toISOString(),
    seq: 1,
  })
  const running = store.snapshot('thread-a', { pendingServerRequests: [] })
  assert.equal(running.executionState, 'sync_degraded')
  assert.equal(running.stale, true)

  store.observeThreadRead('thread-a', false, '', new Date().toISOString(), 'thread-read')
  const completed = store.snapshot('thread-a', { tokenUsage: { total: 1 }, pendingServerRequests: [] })
  assert.equal(completed.executionState, 'completed')
  const persistable = toPersistableRuntimeSnapshot(completed)
  assert.equal(persistable.threadRead, null)
  assert.deepEqual(persistable.pendingServerRequests, [])
  assert.equal(persistable.tokenUsage, null)
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function readThreadIdFromPayload(payload: unknown): string {
  const root = asRecord(payload)
  const direct = readString(root, 'threadId')
  if (direct) return direct
  return readString(asRecord(root?.thread), 'id')
}

function readTurnIdFromPayload(payload: unknown): string {
  return readString(asRecord(payload), 'turnId')
}

function readItemIdFromPayload(payload: unknown): string {
  return readString(asRecord(payload), 'itemId')
}

function readIncludeTurns(payload: unknown): boolean | undefined {
  const value = asRecord(payload)?.includeTurns
  return typeof value === 'boolean' ? value : undefined
}

function readBooleanProperty(payload: unknown, key: string): boolean {
  return asRecord(payload)?.[key] === true
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
