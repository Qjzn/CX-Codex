import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  createAppServerClientInfo,
  normalizePackageVersion,
  readPackageVersion,
} from '../src/server/appServerClientInfo.js'
import { createAppServerInitializeParams } from '../src/server/appServerInitialization.js'
import {
  APP_SERVER_APPROVAL_POLICIES,
  APP_SERVER_SANDBOX_MODES,
  createAppServerArgs,
  createAppServerLaunchPolicySnapshot,
  DEFAULT_APP_SERVER_LAUNCH_POLICY,
  resolveAppServerLaunchPolicy,
} from '../src/server/appServerLaunch.js'
import { createAppServerHealthSnapshot } from '../src/server/appServerHealth.js'
import { AppServerLineBuffer } from '../src/server/appServerLineBuffer.js'
import {
  AppServerNotificationDiagnostics,
  isKnownAppServerNotificationMethod,
} from '../src/server/appServerNotificationDiagnostics.js'
import { extractMethodCatalogFromSchema } from '../src/server/appServerMethodCatalog.js'
import {
  AppServerStatusDiagnostics,
  isKnownAppServerThreadStatus,
  readThreadStatusCandidates,
} from '../src/server/appServerStatusDiagnostics.js'
import {
  normalizeAppServerSchemaAuditSummary,
  readAppServerSchemaAuditSummary,
} from '../src/server/appServerSchemaAuditSummary.js'
import {
  AppServerRpcCache,
  getShareableRpcKey,
  shouldInvalidateThreadListCacheForNotification,
  shouldInvalidateThreadListCacheForRpc,
  shouldInvalidateThreadReadCacheForNotification,
  shouldInvalidateThreadReadCacheForRpc,
} from '../src/server/appServerRpcCache.js'
import { trimThreadTurnsInRpcResult } from '../src/server/appServerRpcResult.js'
import { AppServerRpcDiagnostics } from '../src/server/appServerRpcDiagnostics.js'
import {
  APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS,
  APP_SERVER_RPC_INIT_TIMEOUT_MS,
  APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS,
  APP_SERVER_RPC_TIMEOUT_MS,
  getRpcTimeoutMs,
} from '../src/server/appServerRpcTimeoutPolicy.js'
import {
  APP_SERVER_OVERLOADED_ERROR_CODE,
  AppServerJsonRpcError,
  createAppServerJsonRpcError,
  createRpcTimeoutError,
  isAppServerOverloadedError,
  isInterruptSettledError,
  isRpcTimeoutError,
  isThreadMaterializingError,
} from '../src/server/appServerRpcErrors.js'
import {
  createAppServerRpcErrorResponse,
  createAppServerRpcNotification,
  createAppServerRpcRequest,
  createAppServerRpcSuccessResponse,
} from '../src/server/appServerJsonRpcWire.js'
import { AppServerRpcQueue, getAppServerRpcQueuePriority } from '../src/server/appServerRpcQueue.js'
import {
  readItemIdFromPayload,
  readStringByAliases,
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from '../src/server/appServerPayloadIds.js'
import {
  readActiveTurnIdFromThreadReadPayload,
  readThreadInProgressFromThreadReadPayload,
  readThreadSessionPathFromThreadReadPayload,
  readThreadUpdatedAtIsoFromThreadReadPayload,
} from '../src/server/appServerThreadPayload.js'
import {
  isCachedThreadReadStaleForRuntime,
  readIsoTimestampMs,
  type CachedThreadRead,
} from '../src/server/appServerThreadReadCache.js'
import { AppServerStderrLogger, type AppServerStderrLogEntry } from '../src/server/appServerStderrLogger.js'
import { PendingServerRequestStore } from '../src/server/pendingServerRequests.js'
import {
  normalizePinnedThreadIds,
  readDesktopPinnedThreadIds,
  readMergedPinnedThreadIds,
  writeMergedPinnedThreadIds,
} from '../src/server/pinnedThreads.js'
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
  classifyServerRequestMethod,
  createServerRequestDiagnosticsSnapshot,
  toPendingServerRequestDiagnostics,
  toPendingServerRequestDiagnosticsList,
} from '../src/server/serverRequestDiagnostics.js'
import { readServerRequestReplyPayload } from '../src/server/serverRequestReply.js'
import {
  DEFAULT_WEB_BRIDGE_SETTINGS,
  normalizePermissionDecision,
  normalizeWebBridgeSettings,
  readWebBridgeSettings,
  writeWebBridgeSettings,
} from '../src/server/webBridgeSettings.js'
import {
  FileUploadError,
  bufferIndexOf,
  getFileUploadRequestBodyLimitBytes,
  parseMultipartFileUpload,
  readRequestBody,
  readMultipartBoundary,
  writeUploadedFile,
} from '../src/server/fileUpload.js'
import {
  ComposerFileSearchError,
  assertComposerFileSearchCwd,
  normalizeComposerFileSearchCwd,
  normalizeComposerFileSearchLimit,
  scoreFileCandidate,
  searchComposerFileCandidates,
} from '../src/server/composerFileSearch.js'
import {
  decodeHtmlEntities,
  normalizeGithubDescriptionTranslationText,
  normalizeGithubTrendingLimit,
  normalizeGithubTrendingSince,
  normalizeGithubTrendingTranslationDescriptions,
  parseGithubTrendingHtml,
  readGoogleTranslateText,
  shouldTranslateGithubDescription,
  stripHtml,
  translateGithubDescriptionsToChinese,
} from '../src/server/githubTrending.js'
import {
  runCommand,
  runCommandCapture,
  runCommandWithOutput,
} from '../src/server/commandRunner.js'
import {
  getCodexAuthPath,
  getCodexGlobalStatePath,
  getCodexHomeDir,
  getCodexSessionIndexPath,
  getCodexWorktreesDir,
  getSkillsInstallDir,
  getSkillsSyncStatePath,
  getWebBridgeSettingsPath,
  getWebFavoritesPath,
  getWebPinnedThreadIdsPath,
  getWebUiStatePath,
} from '../src/server/codexPaths.js'
import { readCodexAuth } from '../src/server/codexAuth.js'
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
  buildThreadSearchIndex,
  isExactPhraseMatch,
  loadAllThreadsForSearch,
  normalizeThreadSearchRow,
  searchThreadIndex,
  ThreadSearchIndexStore,
  type ThreadListParams,
} from '../src/server/threadSearchIndex.js'
import {
  isRuntimeActiveState,
  RuntimeStateStore,
  toPersistableRuntimeSnapshot,
  type ThreadRuntimeSnapshot,
} from '../src/server/runtimeState.js'
import {
  normalizeWorkspaceRootsState,
  readWorkspaceRootsState,
  readWorkspaceRootsStateFromPayload,
  upsertWorkspaceRootState,
  writeWorkspaceRootsState,
} from '../src/server/workspaceRootsState.js'
import {
  ProjectRootError,
  normalizeProjectPath,
  resolveProjectRoot,
  suggestProjectRoot,
} from '../src/server/projectRoots.js'
import {
  getOpenAiTranscribeApiKey,
  getOpenAiTranscribeModel,
  getTranscribeRequestBodyLimitBytes,
  getTranscriptionProxyConfigSnapshot,
  prepareOpenAiTranscribeBody,
} from '../src/server/transcriptionProxy.js'
import { setJson } from '../src/server/httpJsonResponse.js'
import { getErrorMessage } from '../src/server/errorMessage.js'

const originalNow = Date.now

try {
  await smokeAppServerClientInfo()
  smokePendingServerRequests()
  smokeAppServerJsonRpcWire()
  smokeAppServerInitialization()
  smokeAppServerLaunch()
  smokeAppServerHealth()
  smokeAppServerMethodCatalog()
  smokeAppServerNotificationDiagnostics()
  smokeAppServerStatusDiagnostics()
  await smokeAppServerSchemaAuditSummary()
  smokeTranscriptionProxyConfig()
  smokeTranscriptionMultipartDefaults()
  smokeAppServerRpcResult()
  smokeAppServerPayloadIds()
  smokeAppServerThreadPayload()
  smokeAppServerThreadReadCache()
  smokeAppServerRpcTimeoutPolicy()
  await smokeAppServerRpcCache()
  smokeAppServerRpcDiagnostics()
  smokeAppServerRpcErrors()
  await smokeAppServerRpcQueue()
  smokeAppServerLineBuffer()
  smokeAppServerStderrLogger()
  smokePlanModeTurnStore()
  smokeServerRequestPolicy()
  smokeServerRequestDiagnostics()
  smokeServerRequestReply()
  await smokeCommandRunner()
  await smokeFileUpload()
  smokeHttpJsonResponse()
  smokeErrorMessage()
  await smokeComposerFileSearch()
  await smokeGithubTrending()
  smokeCodexPaths()
  await smokeCodexAuth()
  await smokePinnedThreads()
  await smokeWebBridgeSettings()
  await smokeThreadTokenUsage()
  await smokeThreadTitleCache()
  await smokeThreadSearchIndex()
  await smokeWorkspaceRootsState()
  await smokeProjectRoots()
  smokeRuntimeStateStore()
  console.log('server module smoke ok')
} finally {
  Date.now = originalNow
}

async function smokeAppServerClientInfo(): Promise<void> {
  assert.deepEqual(createAppServerClientInfo('2.3.4'), {
    name: 'codex-web-local',
    title: 'CX-Codex',
    version: '2.3.4',
  })
  assert.equal(normalizePackageVersion(' 2.3.5 '), '2.3.5')
  assert.equal(normalizePackageVersion(''), 'unknown')
  assert.equal(normalizePackageVersion(null), 'unknown')

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-client-info-'))
  try {
    const packageJsonPath = join(tempDir, 'package.json')
    await writeFile(packageJsonPath, '{"version":"9.8.7"}\n', 'utf8')
    assert.equal(await readPackageVersion(packageJsonPath), '9.8.7')

    const invalidPackageJsonPath = join(tempDir, 'invalid-package.json')
    await writeFile(invalidPackageJsonPath, '{"version":""}\n', 'utf8')
    assert.equal(await readPackageVersion(invalidPackageJsonPath), 'unknown')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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

function smokeServerRequestDiagnostics(): void {
  assert.equal(classifyServerRequestMethod('item/commandExecution/requestPermission'), 'permission')
  assert.equal(classifyServerRequestMethod('item/fileChange/requestApproval'), 'approval')
  assert.equal(classifyServerRequestMethod('mcp/server/elicitation/request'), 'elicitation')
  assert.equal(classifyServerRequestMethod('item/tool/call'), 'tool')
  assert.equal(classifyServerRequestMethod('server/unknown/request'), 'request')

  const request = {
    id: 9,
    method: 'item/fileChange/requestApproval',
    params: {
      prompt: 'do not expose this',
      path: 'C:\\secret\\file.txt',
    },
    receivedAtIso: '2026-07-03T00:00:00.000Z',
  }
  const diagnostics = toPendingServerRequestDiagnostics(request)
  assert.deepEqual(diagnostics, {
    id: 9,
    method: 'item/fileChange/requestApproval',
    kind: 'approval',
    receivedAtIso: '2026-07-03T00:00:00.000Z',
  })
  assert.equal('params' in diagnostics, false)
  assert.deepEqual(toPendingServerRequestDiagnosticsList([request]), [diagnostics])

  const snapshot = createServerRequestDiagnosticsSnapshot([
    request,
    {
      id: 10,
      method: 'mcp/server/elicitation/request',
      params: { prompt: 'hidden' },
      receivedAtIso: '2026-07-03T00:00:01.000Z',
    },
    {
      id: 11,
      method: 'server/unknown/request',
      params: { prompt: 'hidden' },
      receivedAtIso: '2026-07-03T00:00:02.000Z',
    },
  ])
  assert.equal(snapshot.pendingRequestCount, 3)
  assert.equal(snapshot.pendingByKind.approval, 1)
  assert.equal(snapshot.pendingByKind.elicitation, 1)
  assert.equal(snapshot.pendingByKind.request, 1)
  assert.equal('params' in snapshot.pendingRequests[0], false)
}

function smokeServerRequestReply(): void {
  assert.deepEqual(readServerRequestReplyPayload({
    id: 7,
    result: { action: 'approve' },
  }), {
    id: 7,
    reply: { result: { action: 'approve' } },
  })

  assert.deepEqual(readServerRequestReplyPayload({
    id: 8,
    error: { code: -32602.7, message: '  Denied by user  ' },
  }), {
    id: 8,
    reply: { error: { code: -32602, message: 'Denied by user' } },
  })

  assert.deepEqual(readServerRequestReplyPayload({
    id: 9,
    error: { code: 'bad', message: '  ' },
  }), {
    id: 9,
    reply: { error: { code: -32000, message: 'Server request rejected by client' } },
  })

  assert.throws(
    () => readServerRequestReplyPayload(null),
    /Invalid response payload: expected object/,
  )
  assert.throws(
    () => readServerRequestReplyPayload({ id: 1.2, result: true }),
    /Invalid response payload: "id" must be an integer/,
  )
  assert.throws(
    () => readServerRequestReplyPayload({ id: 10 }),
    /Invalid response payload: expected "result" or "error"/,
  )
}

function smokeAppServerJsonRpcWire(): void {
  const request = createAppServerRpcRequest(1, 'thread/start', { model: 'gpt-5.4' })
  assert.deepEqual(request, {
    id: 1,
    method: 'thread/start',
    params: { model: 'gpt-5.4' },
  })
  assert.equal('jsonrpc' in request, false)

  const initialized = createAppServerRpcNotification('initialized')
  assert.deepEqual(initialized, { method: 'initialized' })
  assert.equal('jsonrpc' in initialized, false)

  const notificationWithParams = createAppServerRpcNotification('turn/started', { turnId: 'turn-1' })
  assert.deepEqual(notificationWithParams, {
    method: 'turn/started',
    params: { turnId: 'turn-1' },
  })
  assert.equal('jsonrpc' in notificationWithParams, false)

  const success = createAppServerRpcSuccessResponse(2, { ok: true })
  assert.deepEqual(success, { id: 2, result: { ok: true } })
  assert.equal('jsonrpc' in success, false)

  const emptySuccess = createAppServerRpcSuccessResponse(3)
  assert.deepEqual(emptySuccess, { id: 3, result: {} })

  const error = createAppServerRpcErrorResponse(4, { code: -32601, message: 'Unsupported' })
  assert.deepEqual(error, { id: 4, error: { code: -32601, message: 'Unsupported' } })
  assert.equal('jsonrpc' in error, false)
}

function smokeAppServerInitialization(): void {
  const clientInfo = createAppServerClientInfo('2.2.7')
  assert.deepEqual(createAppServerInitializeParams(clientInfo), {
    clientInfo,
  })

  assert.deepEqual(createAppServerInitializeParams(clientInfo, { experimentalApi: false }), {
    clientInfo,
  })

  assert.deepEqual(createAppServerInitializeParams(clientInfo, { experimentalApi: true }), {
    clientInfo,
    capabilities: {
      experimentalApi: true,
    },
  })

  assert.deepEqual(createAppServerInitializeParams(clientInfo, {
    optOutNotificationMethods: ['thread/started', '', 3, 'item/agentMessage/delta'],
  }), {
    clientInfo,
    capabilities: {
      optOutNotificationMethods: ['thread/started', 'item/agentMessage/delta'],
    },
  })
}

function smokeAppServerLaunch(): void {
  assert.deepEqual(APP_SERVER_APPROVAL_POLICIES, ['untrusted', 'on-request', 'never'])
  assert.deepEqual(APP_SERVER_SANDBOX_MODES, ['read-only', 'workspace-write', 'danger-full-access'])
  assert.deepEqual(DEFAULT_APP_SERVER_LAUNCH_POLICY, {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  })
  assert.deepEqual(resolveAppServerLaunchPolicy({}), DEFAULT_APP_SERVER_LAUNCH_POLICY)
  assert.deepEqual(resolveAppServerLaunchPolicy({
    CX_CODEX_APP_SERVER_APPROVAL_POLICY: ' on-request ',
    CX_CODEX_APP_SERVER_SANDBOX_MODE: ' workspace-write ',
  }), {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  })
  assert.deepEqual(resolveAppServerLaunchPolicy({
    CX_CODEX_APP_SERVER_APPROVAL_POLICY: 'invalid',
    CX_CODEX_APP_SERVER_SANDBOX_MODE: 'invalid',
    CODEXUI_APP_SERVER_APPROVAL_POLICY: 'untrusted',
    CODEXUI_APP_SERVER_SANDBOX_MODE: 'read-only',
  }), DEFAULT_APP_SERVER_LAUNCH_POLICY)
  assert.deepEqual(resolveAppServerLaunchPolicy({
    CODEXUI_APP_SERVER_APPROVAL_POLICY: 'untrusted',
    CODEXUI_APP_SERVER_SANDBOX_MODE: 'read-only',
  }), {
    approvalPolicy: 'untrusted',
    sandboxMode: 'read-only',
  })
  assert.deepEqual(createAppServerLaunchPolicySnapshot(DEFAULT_APP_SERVER_LAUNCH_POLICY), {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    legacyHighTrust: true,
  })
  assert.deepEqual(createAppServerLaunchPolicySnapshot({
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  }), {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    legacyHighTrust: false,
  })
  assert.deepEqual(createAppServerArgs(), [
    'app-server',
    '-c',
    'approval_policy="never"',
    '-c',
    'sandbox_mode="danger-full-access"',
  ])
  assert.deepEqual(createAppServerArgs({
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  }), [
    'app-server',
    '-c',
    'approval_policy="on-request"',
    '-c',
    'sandbox_mode="workspace-write"',
  ])
}

function smokeAppServerHealth(): void {
  const snapshot = createAppServerHealthSnapshot({
    running: true,
    initialized: true,
    stopping: false,
    pid: 7420,
    pendingRpcCount: 2,
    queuedRpcCount: 1,
    pendingServerRequestCount: 3,
    activePlanModeTurnCount: 4,
    launchPolicy: createAppServerLaunchPolicySnapshot(DEFAULT_APP_SERVER_LAUNCH_POLICY),
    rpcDiagnostics: {
      activeRpcCalls: 1,
      pendingRpcCount: 2,
      queuedRpcCount: 1,
      queuePeakCount: 5,
      queuePeakAtIso: '2026-07-04T00:00:00.000Z',
      recentSlowRpc: [],
      recentTimeouts: [],
    },
  })

  assert.deepEqual(snapshot, {
    running: true,
    initialized: true,
    stopping: false,
    pid: 7420,
    pendingRpcCount: 2,
    queuedRpcCount: 1,
    pendingServerRequestCount: 3,
    activePlanModeTurnCount: 4,
    launchPolicy: {
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      legacyHighTrust: true,
    },
    rpcDiagnostics: {
      activeRpcCalls: 1,
      pendingRpcCount: 2,
      queuedRpcCount: 1,
      queuePeakCount: 5,
      queuePeakAtIso: '2026-07-04T00:00:00.000Z',
      recentSlowRpc: [],
      recentTimeouts: [],
    },
  })
}

function smokeAppServerNotificationDiagnostics(): void {
  assert.equal(isKnownAppServerNotificationMethod('turn/started'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/archived'), true)
  assert.equal(isKnownAppServerNotificationMethod('item/tool/call/failed'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/transcript/delta'), false)

  const diagnostics = new AppServerNotificationDiagnostics({ maxRecentUnknown: 2 })
  diagnostics.observe({
    method: 'turn/started',
    atIso: '2026-07-03T00:00:00.000Z',
    threadId: 'thread-a',
  })
  assert.deepEqual(diagnostics.snapshot(), {
    unknownNotificationCount: 0,
    recentUnknownNotifications: [],
  })

  diagnostics.observe({
    method: 'thread/realtime/transcript/delta',
    atIso: '2026-07-03T00:00:01.000Z',
    threadId: 'thread-a',
    turnId: 'turn-a',
  })
  diagnostics.observe({
    method: 'thread/realtime/transcript/delta',
    atIso: '2026-07-03T00:00:02.000Z',
    threadId: 'thread-b',
  })
  diagnostics.observe({
    method: 'plugin/marketplace/changed',
    atIso: '2026-07-03T00:00:03.000Z',
  })
  diagnostics.observe({
    method: 'hook/migration/completed',
    atIso: '2026-07-03T00:00:04.000Z',
  })

  const snapshot = diagnostics.snapshot()
  assert.equal(snapshot.unknownNotificationCount, 4)
  assert.deepEqual(snapshot.recentUnknownNotifications.map((item) => item.method), [
    'hook/migration/completed',
    'plugin/marketplace/changed',
  ])
  assert.equal(snapshot.recentUnknownNotifications[0]?.count, 1)
  assert.equal(snapshot.recentUnknownNotifications[1]?.count, 1)

  diagnostics.clear()
  assert.equal(diagnostics.snapshot().unknownNotificationCount, 0)
}

function smokeAppServerMethodCatalog(): void {
  const methods = extractMethodCatalogFromSchema({
    oneOf: [
      { properties: { method: { enum: ['thread/list', 'turn/start'] } } },
      { properties: { method: { enum: ['thread/list', 'thread/read', ''] } } },
      { properties: { method: { enum: [123, 'mcp/list'] } } },
      { properties: { other: { enum: ['ignored'] } } },
    ],
  })
  assert.deepEqual(methods, ['mcp/list', 'thread/list', 'thread/read', 'turn/start'])
  assert.deepEqual(extractMethodCatalogFromSchema({ oneOf: null }), [])
}

function smokeAppServerStatusDiagnostics(): void {
  assert.equal(isKnownAppServerThreadStatus('running'), true)
  assert.equal(isKnownAppServerThreadStatus('completed'), true)
  assert.equal(isKnownAppServerThreadStatus('inProgress'), true)
  assert.equal(isKnownAppServerThreadStatus('awaiting_handoff'), false)
  assert.deepEqual(readThreadStatusCandidates({
    thread: {
      status: { type: 'running' },
      turnStatus: 'inProgress',
      turns: [
        { id: 'turn-a', status: 'completed' },
        { id: 'turn-b', status: 'customTurnState' },
      ],
    },
  }), [
    { source: 'thread.status.type', value: 'running' },
    { source: 'thread.turnStatus', value: 'inProgress' },
    { source: 'thread.turns.status', value: 'customTurnState' },
  ])

  const diagnostics = new AppServerStatusDiagnostics({ maxRecentUnknown: 2 })
  diagnostics.observeThreadRead({
    threadId: 'thread-a',
    atIso: '2026-07-03T00:00:00.000Z',
    payload: {
      thread: {
        status: 'running',
        turnStatus: 'inProgress',
        turns: [{ status: 'completed' }],
      },
    },
  })
  assert.deepEqual(diagnostics.snapshot(), {
    unknownStatusCount: 0,
    recentUnknownStatuses: [],
  })

  diagnostics.observeThreadRead({
    threadId: 'thread-a',
    atIso: '2026-07-03T00:00:01.000Z',
    payload: {
      thread: {
        status: { type: 'awaiting_handoff' },
        turns: [{ status: 'customTurnState' }],
      },
    },
  })
  diagnostics.observeThreadRead({
    threadId: 'thread-b',
    atIso: '2026-07-03T00:00:02.000Z',
    payload: {
      thread: {
        status: { type: 'awaiting_handoff' },
      },
    },
  })
  diagnostics.observeThreadRead({
    threadId: 'thread-c',
    atIso: '2026-07-03T00:00:03.000Z',
    payload: {
      thread: {
        turnStatus: 'handoffQueued',
      },
    },
  })

  const snapshot = diagnostics.snapshot()
  assert.equal(snapshot.unknownStatusCount, 4)
  assert.deepEqual(snapshot.recentUnknownStatuses.map((item) => `${item.source}:${item.normalizedValue}`), [
    'thread.turnStatus:handoffqueued',
    'thread.status.type:awaiting_handoff',
  ])
  assert.equal(snapshot.recentUnknownStatuses[1]?.count, 2)
  assert.equal(snapshot.recentUnknownStatuses[1]?.threadId, 'thread-b')

  diagnostics.clear()
  assert.equal(diagnostics.snapshot().unknownStatusCount, 0)
}

async function smokeAppServerSchemaAuditSummary(): Promise<void> {
  const normalized = normalizeAppServerSchemaAuditSummary({
    generatedAtIso: '2026-07-03T00:00:00.000Z',
    officialDocsUrl: 'https://developers.openai.com/codex/app-server',
    auditCommand: 'npm.cmd run audit:app-server-schemas',
    auditOutput: 'output/app-server-schema-audit/example',
    reviewStatus: 'drift-recorded',
    comparison: {
      typescriptRoot: {
        baselineCount: 2,
        generatedCount: 3,
        addedCount: 1,
        removedCount: 0,
        representativeAdded: ['A', 'B', 'C', 'D', 'E', 'F'],
        representativeRemoved: [],
      },
      typescriptV2: {
        baselineCount: 4,
        generatedCount: 7,
        addedCount: 4,
        removedCount: 1,
      },
      jsonRoot: {
        baselineCount: 5,
        generatedCount: 6,
        addedCount: 2,
        removedCount: 1,
      },
      jsonV2: {
        baselineCount: 8,
        generatedCount: 9,
        addedCount: 3,
        removedCount: 2,
      },
    },
  })
  assert.equal(normalized.available, true)
  assert.equal(normalized.reviewStatus, 'drift-recorded')
  assert.equal(normalized.comparison.typescriptRoot.representativeAdded.length, 5)
  assert.deepEqual(normalized.totals, {
    addedCount: 10,
    removedCount: 4,
  })

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-schema-audit-'))
  try {
    const summaryPath = join(tempDir, 'summary.json')
    await writeFile(summaryPath, JSON.stringify({
      generatedAtIso: '2026-07-03T00:00:00.000Z',
      officialDocsUrl: 'https://developers.openai.com/codex/app-server',
      auditCommand: 'npm.cmd run audit:app-server-schemas',
      reviewStatus: 'drift-recorded',
      comparison: {
        typescriptRoot: { baselineCount: 1, generatedCount: 2, addedCount: 1, removedCount: 0 },
        typescriptV2: { baselineCount: 1, generatedCount: 3, addedCount: 2, removedCount: 0 },
        jsonRoot: { baselineCount: 1, generatedCount: 1, addedCount: 0, removedCount: 0 },
        jsonV2: { baselineCount: 1, generatedCount: 4, addedCount: 3, removedCount: 0 },
      },
    }), 'utf8')
    const loaded = await readAppServerSchemaAuditSummary(summaryPath)
    assert.equal(loaded.available, true)
    assert.deepEqual(loaded.totals, {
      addedCount: 6,
      removedCount: 0,
    })

    const missing = await readAppServerSchemaAuditSummary(join(tempDir, 'missing.json'))
    assert.equal(missing.available, false)
    assert.equal(missing.reviewStatus, 'unavailable')
    assert.match(missing.error, /ENOENT/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function smokeAppServerRpcResult(): void {
  const original = {
    thread: {
      id: 'thread-a',
      turns: Array.from({ length: 12 }, (_, index) => ({ id: `turn-${String(index + 1)}` })),
    },
    other: true,
  }

  assert.equal(trimThreadTurnsInRpcResult('model/list', original), original)
  assert.deepEqual(trimThreadTurnsInRpcResult('thread/read', {
    thread: { id: 'thread-a', turns: [{ id: 'turn-1' }] },
  }), {
    thread: { id: 'thread-a', turns: [{ id: 'turn-1' }] },
  })

  const trimmed = trimThreadTurnsInRpcResult('thread/read', original) as { thread: { turns: Array<{ id: string }> }; other?: boolean }
  assert.deepEqual(trimmed.thread.turns.map((turn) => turn.id), [
    'turn-3',
    'turn-4',
    'turn-5',
    'turn-6',
    'turn-7',
    'turn-8',
    'turn-9',
    'turn-10',
    'turn-11',
    'turn-12',
  ])
  assert.equal(trimmed.other, true)
  assert.equal(trimmed.thread.turns.length, 10)
  assert.deepEqual(trimThreadTurnsInRpcResult('thread/resume', { thread: { turns: null } }), { thread: { turns: null } })
}

function smokeAppServerPayloadIds(): void {
  assert.equal(readStringByAliases({ threadId: '', thread_id: ' thread-under ' }, 'threadId', 'thread_id'), 'thread-under')
  assert.equal(readStringByAliases(null, 'threadId'), '')

  assert.equal(readThreadIdFromPayload({ threadId: ' thread-direct ' }), 'thread-direct')
  assert.equal(readThreadIdFromPayload({ request: { thread_id: ' thread-request ' } }), 'thread-request')
  assert.equal(readThreadIdFromPayload({ request: { params: { threadId: ' thread-request-params ' } } }), 'thread-request-params')
  assert.equal(readThreadIdFromPayload({ params: { thread_id: ' thread-params ' } }), 'thread-params')
  assert.equal(readThreadIdFromPayload({ thread: { id: ' thread-record ' } }), 'thread-record')
  assert.equal(readThreadIdFromPayload({ turn: { threadId: ' thread-turn ' } }), 'thread-turn')
  assert.equal(readThreadIdFromPayload({ item: { thread_id: ' thread-item ' } }), 'thread-item')
  assert.equal(readThreadIdFromPayload(null), '')

  assert.equal(readTurnIdFromPayload({ turnId: ' turn-direct ' }), 'turn-direct')
  assert.equal(readTurnIdFromPayload({ activeTurnId: ' turn-active ' }), 'turn-active')
  assert.equal(readTurnIdFromPayload({ request: { turn_id: ' turn-request ' } }), 'turn-request')
  assert.equal(readTurnIdFromPayload({ request: { params: { activeTurnId: ' turn-request-params ' } } }), 'turn-request-params')
  assert.equal(readTurnIdFromPayload({ params: { turnId: ' turn-params ' } }), 'turn-params')
  assert.equal(readTurnIdFromPayload({ turn: { id: ' turn-record ' } }), 'turn-record')
  assert.equal(readTurnIdFromPayload({ item: { turn_id: ' turn-item ' } }), 'turn-item')
  assert.equal(readTurnIdFromPayload([]), '')

  assert.equal(readItemIdFromPayload({ itemId: ' item-direct ' }), 'item-direct')
  assert.equal(readItemIdFromPayload({ item_id: ' item-under ' }), 'item-under')
  assert.equal(readItemIdFromPayload({ item: { id: ' item-record ' } }), 'item-record')
  assert.equal(readItemIdFromPayload({ item: { item_id: ' item-nested ' } }), 'item-nested')
  assert.equal(readItemIdFromPayload({ item: { id: 42 } }), '')
}

function smokeAppServerThreadPayload(): void {
  const timestampSeconds = 1_700_000_000
  const payload = {
    thread: {
      activeTurnId: ' direct-turn ',
      inProgress: false,
      updatedAt: timestampSeconds,
      path: ' C:/sessions/thread.jsonl ',
      turns: [
        { id: 'turn-1', status: 'completed' },
        { id: 'turn-2', status: 'inProgress' },
      ],
    },
  }
  assert.equal(readActiveTurnIdFromThreadReadPayload(payload), 'direct-turn')
  assert.equal(readThreadInProgressFromThreadReadPayload(payload), true)
  assert.equal(readThreadUpdatedAtIsoFromThreadReadPayload(payload), new Date(timestampSeconds * 1000).toISOString())
  assert.equal(readThreadSessionPathFromThreadReadPayload(payload), 'C:/sessions/thread.jsonl')

  assert.equal(readActiveTurnIdFromThreadReadPayload({
    thread: {
      status: { turnId: ' status-turn ' },
      turns: [{ id: 'turn-1', status: 'inProgress' }],
    },
  }), 'status-turn')
  assert.equal(readActiveTurnIdFromThreadReadPayload({
    thread: {
      turns: [
        { id: 'turn-1', status: 'completed' },
        { id: ' turn-2 ', status: 'inProgress' },
      ],
    },
  }), 'turn-2')
  assert.equal(readThreadInProgressFromThreadReadPayload({ thread: { status: { type: 'Running' } } }), true)
  assert.equal(readThreadInProgressFromThreadReadPayload({ thread: { turnStatus: 'in_progress' } }), true)
  assert.equal(readThreadInProgressFromThreadReadPayload({ thread: { status: 'completed' } }), false)
  assert.equal(readThreadSessionPathFromThreadReadPayload({ path: ' C:/sessions/fallback.jsonl ', thread: {} }), 'C:/sessions/fallback.jsonl')
  assert.equal(readThreadUpdatedAtIsoFromThreadReadPayload({ thread: { updatedAt: 0 } }), '')
}

function smokeAppServerThreadReadCache(): void {
  assert.equal(readIsoTimestampMs('2026-01-01T00:00:00.000Z'), Date.parse('2026-01-01T00:00:00.000Z'))
  assert.equal(readIsoTimestampMs('not-a-date'), 0)
  assert.equal(readIsoTimestampMs(null), 0)

  const cachedThreadRead: CachedThreadRead = {
    threadRead: { thread: { id: 'thread-a' } },
    inProgress: false,
    activeTurnId: '',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    sessionPath: 'C:/sessions/thread-a.jsonl',
    cachedAtIso: '2026-01-01T00:00:05.000Z',
  }
  const baseSnapshot = createThreadRuntimeSnapshot({
    executionState: 'completed',
    lastCompletedAtIso: '2026-01-01T00:00:04.000Z',
  })

  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, baseSnapshot, true), false)
  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, createThreadRuntimeSnapshot({ executionState: 'running' }), false), true)
  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, createThreadRuntimeSnapshot({ executionState: 'completed_pending_sync' }), false), true)
  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, baseSnapshot, false), false)
  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, createThreadRuntimeSnapshot({
    executionState: 'completed',
    lastCompletedAtIso: '2026-01-01T00:00:06.000Z',
  }), false), true)
  assert.equal(isCachedThreadReadStaleForRuntime({
    ...cachedThreadRead,
    cachedAtIso: 'invalid-date',
  }, baseSnapshot, false), true)
  assert.equal(isCachedThreadReadStaleForRuntime(cachedThreadRead, createThreadRuntimeSnapshot({
    executionState: 'completed',
    lastCompletedAtIso: null,
  }), false), false)
}

function smokeAppServerRpcTimeoutPolicy(): void {
  assert.equal(getRpcTimeoutMs('initialize', {}), APP_SERVER_RPC_INIT_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('thread/read', { includeTurns: false }), APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('thread/read', {}), APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('thread/read', { includeTurns: true }), APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('thread/read', { includeTurns: 'true' }), APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('thread/resume', {}), APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('model/list', {}), APP_SERVER_RPC_TIMEOUT_MS)
  assert.equal(getRpcTimeoutMs('turn/start', null), APP_SERVER_RPC_TIMEOUT_MS)
}

function smokeTranscriptionProxyConfig(): void {
  withTranscriptionEnv({
    OPENAI_API_KEY: undefined,
    OPENAI_TRANSCRIBE_MODEL: undefined,
    OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    OPENAI_TRANSCRIBE_URL: undefined,
    CX_CODEX_OPENAI_API_KEY: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_URL: undefined,
    CODEXUI_OPENAI_API_KEY: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MODEL: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_URL: undefined,
  }, () => {
    assert.equal(getOpenAiTranscribeApiKey(), '')
    assert.equal(getOpenAiTranscribeModel(), 'gpt-4o-transcribe')
    assert.equal(getTranscribeRequestBodyLimitBytes(), 26 * 1024 * 1024)
    assert.deepEqual(getTranscriptionProxyConfigSnapshot(), {
      provider: 'chatgpt',
      officialApiConfigured: false,
      model: 'gpt-4o-transcribe',
      responseFormat: 'json',
      requestBodyLimitBytes: 26 * 1024 * 1024,
      requestBodyLimitMiB: 26,
      endpoint: {
        isDefault: true,
        host: 'api.openai.com',
        path: '/v1/audio/transcriptions',
      },
    })
  })

  withTranscriptionEnv({
    OPENAI_API_KEY: 'sk-default',
    OPENAI_TRANSCRIBE_MODEL: 'whisper-1',
    OPENAI_TRANSCRIBE_MAX_BYTES: '1024',
    OPENAI_TRANSCRIBE_URL: 'https://ignored.example/v1/audio/transcriptions',
    CX_CODEX_OPENAI_API_KEY: 'sk-prefixed',
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
    CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: '2048',
    CX_CODEX_OPENAI_TRANSCRIBE_URL: 'https://audio.example.test/v1/audio/transcriptions?token=secret',
  }, () => {
    assert.equal(getOpenAiTranscribeApiKey(), 'sk-prefixed')
    assert.equal(getOpenAiTranscribeModel(), 'gpt-4o-mini-transcribe')
    assert.equal(getTranscribeRequestBodyLimitBytes(), 2048)
    assert.deepEqual(getTranscriptionProxyConfigSnapshot(), {
      provider: 'openai',
      officialApiConfigured: true,
      model: 'gpt-4o-mini-transcribe',
      responseFormat: 'json',
      requestBodyLimitBytes: 2048,
      requestBodyLimitMiB: 0,
      endpoint: {
        isDefault: false,
        host: 'audio.example.test',
        path: '/v1/audio/transcriptions',
      },
    })
  })
}

function smokeTranscriptionMultipartDefaults(): void {
  const boundary = '----cx-codex-smoke-boundary'
  const body = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="hello.wav"\r\n' +
      'Content-Type: audio/wav\r\n\r\n' +
      'RIFF_AUDIO_PAYLOAD\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      'whisper-1\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
      'text\r\n' +
      `--${boundary}--\r\n`,
  )

  withTranscriptionEnv({
    OPENAI_TRANSCRIBE_MODEL: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
    CODEXUI_OPENAI_TRANSCRIBE_MODEL: undefined,
  }, () => {
    const prepared = prepareOpenAiTranscribeBody(
      body,
      `multipart/form-data; boundary=${boundary}`,
    ).toString('utf8')
    assert.match(prepared, /name="file"; filename="hello\.wav"/)
    assert.match(prepared, /RIFF_AUDIO_PAYLOAD/)
    assert.match(prepared, /name="model"\r\n\r\ngpt-4o-mini-transcribe\r\n/)
    assert.match(prepared, /name="response_format"\r\n\r\njson\r\n/)
    assert.doesNotMatch(prepared, /name="model"\r\n\r\nwhisper-1\r\n/)
    assert.doesNotMatch(prepared, /name="response_format"\r\n\r\ntext\r\n/)
  })
}

async function smokeAppServerRpcCache(): Promise<void> {
  assert.equal(getShareableRpcKey('thread/start', {}), null)
  assert.equal(getShareableRpcKey('thread/list', { limit: 1 }), 'thread/list:{"limit":1}')
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/name/set'), true)
  assert.equal(shouldInvalidateThreadListCacheForRpc('thread/read'), false)
  assert.equal(shouldInvalidateThreadListCacheForNotification('thread/name/updated'), true)
  assert.equal(shouldInvalidateThreadListCacheForNotification('thread/created'), true)
  assert.equal(shouldInvalidateThreadListCacheForNotification('item/completed'), false)
  assert.equal(shouldInvalidateThreadReadCacheForRpc('turn/start'), true)
  assert.equal(shouldInvalidateThreadReadCacheForRpc('thread/name/set'), true)
  assert.equal(shouldInvalidateThreadReadCacheForRpc('model/list'), false)
  assert.equal(shouldInvalidateThreadReadCacheForNotification('turn/completed'), true)
  assert.equal(shouldInvalidateThreadReadCacheForNotification('item/updated'), true)
  assert.equal(shouldInvalidateThreadReadCacheForNotification('tool/failed'), true)
  assert.equal(shouldInvalidateThreadReadCacheForNotification('thread/name/updated'), false)

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

function smokeAppServerRpcErrors(): void {
  assert.equal(isAppServerOverloadedError(createAppServerJsonRpcError({
    code: APP_SERVER_OVERLOADED_ERROR_CODE,
    message: 'Server overloaded; retry later.',
  })), true)
  assert.equal(isAppServerOverloadedError(new AppServerJsonRpcError(123, 'Other error')), false)
  assert.equal(isThreadMaterializingError(new Error('thread is not materialized yet')), true)
  assert.equal(isThreadMaterializingError(new Error('includeTurns is unavailable before first user message')), true)
  assert.equal(isThreadMaterializingError(new Error('no rollout found for thread id')), true)
  assert.equal(isThreadMaterializingError(new Error('rollout is empty')), true)
  assert.equal(isThreadMaterializingError(new Error('permission denied')), false)

  const timeout = createRpcTimeoutError('thread/read', 30_000)
  assert.equal(timeout.name, 'AppServerRpcTimeoutError')
  assert.equal(timeout.message, 'thread/read timed out after 30s')
  assert.equal(isRpcTimeoutError(timeout), true)
  assert.equal(isRpcTimeoutError(new Error('thread/read timed out after 30s')), false)

  assert.equal(isInterruptSettledError(new Error('no active turn')), true)
  assert.equal(isInterruptSettledError(new Error('already completed')), true)
  assert.equal(isInterruptSettledError(new Error('cannot interrupt')), true)
  assert.equal(isInterruptSettledError(timeout), false)
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

  const retryDiagnostics = new AppServerRpcDiagnostics(
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
  let overloadedAttempts = 0
  const retryQueue = new AppServerRpcQueue({
    maxSize: 3,
    maxInFlight: 1,
    diagnostics: retryDiagnostics,
    overloadRetry: {
      maxRetries: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterMs: 0,
    },
    execute: async () => {
      overloadedAttempts += 1
      if (overloadedAttempts < 3) {
        throw createAppServerJsonRpcError({
          code: APP_SERVER_OVERLOADED_ERROR_CODE,
          message: 'Server overloaded; retry later.',
        })
      }
      return 'retried:done'
    },
  })
  assert.equal(await retryQueue.enqueue('thread/read', {}), 'retried:done')
  assert.equal(overloadedAttempts, 3)

  const exhaustedDiagnostics = new AppServerRpcDiagnostics(
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
  let exhaustedAttempts = 0
  const exhaustedQueue = new AppServerRpcQueue({
    maxSize: 3,
    maxInFlight: 1,
    diagnostics: exhaustedDiagnostics,
    overloadRetry: {
      maxRetries: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterMs: 0,
    },
    execute: async () => {
      exhaustedAttempts += 1
      throw createAppServerJsonRpcError({
        code: APP_SERVER_OVERLOADED_ERROR_CODE,
        message: 'Server overloaded; retry later.',
      })
    },
  })
  await assert.rejects(
    exhaustedQueue.enqueue('thread/read', {}),
    (error) => error instanceof AppServerJsonRpcError && error.code === APP_SERVER_OVERLOADED_ERROR_CODE,
  )
  assert.equal(exhaustedAttempts, 2)
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

async function smokeCommandRunner(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-command-runner-'))
  try {
    await runCommand(process.execPath, ['-e', 'process.exit(0)'], { cwd: tempDir })
    assert.equal(
      await runCommandCapture(process.execPath, ['-e', 'console.log(process.cwd())'], { cwd: tempDir }),
      tempDir,
    )
    assert.equal(
      await runCommandWithOutput(process.execPath, ['-e', 'console.log("  output  ")']),
      'output',
    )
    await assert.rejects(
      runCommand(process.execPath, ['-e', 'console.error("stderr detail"); console.log("stdout detail"); process.exit(7)']),
      (error) => error instanceof Error
        && error.message.includes(`Command failed (${process.execPath} -e`)
        && error.message.includes('stderr detail')
        && error.message.includes('stdout detail'),
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokeFileUpload(): Promise<void> {
  const originalUploadLimit = process.env.CX_CODEX_FILE_UPLOAD_MAX_BYTES
  try {
    process.env.CX_CODEX_FILE_UPLOAD_MAX_BYTES = '12345'
    assert.equal(getFileUploadRequestBodyLimitBytes(), 12345)
  } finally {
    if (typeof originalUploadLimit === 'string') {
      process.env.CX_CODEX_FILE_UPLOAD_MAX_BYTES = originalUploadLimit
    } else {
      delete process.env.CX_CODEX_FILE_UPLOAD_MAX_BYTES
    }
  }

  assert.equal(bufferIndexOf(Buffer.from('abc--boundary'), Buffer.from('--')), 3)
  assert.equal(bufferIndexOf(Buffer.from('abc'), Buffer.from('missing')), -1)
  assert.equal(readMultipartBoundary('multipart/form-data; boundary=demo-boundary'), 'demo-boundary')
  assert.throws(
    () => readMultipartBoundary('multipart/form-data'),
    (error) => error instanceof FileUploadError && error.statusCode === 400 && /Missing multipart boundary/.test(error.message),
  )

  const boundary = 'cx-boundary'
  const body = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="meta"',
    '',
    'ignored',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="nested/path\\demo.txt"',
    'Content-Type: text/plain',
    '',
    'hello upload',
    `--${boundary}--`,
    '',
  ].join('\r\n'), 'utf8')

  const parsed = parseMultipartFileUpload(body, `multipart/form-data; boundary=${boundary}`)
  assert.equal(parsed.fileName, 'nested_path_demo.txt')
  assert.equal(parsed.fileData.toString('utf8'), 'hello upload')
  assert.equal((await readRequestBody(Readable.from([Buffer.from('hello')]) as never, { maxBytes: 5 })).toString('utf8'), 'hello')
  await assert.rejects(
    readRequestBody(Readable.from([Buffer.from('too-large')]) as never, { maxBytes: 3 }),
    (error) => error instanceof FileUploadError && error.statusCode === 413 && error.maxBytes === 3,
  )
  assert.throws(
    () => parseMultipartFileUpload(Buffer.from(`--${boundary}\r\n\r\nno file\r\n`, 'utf8'), `multipart/form-data; boundary=${boundary}`),
    (error) => error instanceof FileUploadError && error.statusCode === 400 && /No file in request/.test(error.message),
  )

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-upload-'))
  try {
    const destPath = await writeUploadedFile(parsed, tempDir)
    assert.equal(await readFile(destPath, 'utf8'), 'hello upload')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function smokeHttpJsonResponse(): void {
  const headers = new Map<string, string | number | readonly string[]>()
  let endedBody = ''
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value)
    },
    end(value: string) {
      endedBody = value
    },
  }

  setJson(response as never, 202, { ok: true, count: 2 })

  assert.equal(response.statusCode, 202)
  assert.equal(headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.equal(endedBody, '{"ok":true,"count":2}')
}

function smokeErrorMessage(): void {
  assert.equal(getErrorMessage(new Error('direct failure'), 'fallback'), 'direct failure')
  assert.equal(getErrorMessage({ error: 'plain failure' }, 'fallback'), 'plain failure')
  assert.equal(getErrorMessage({ error: { message: 'nested failure' } }, 'fallback'), 'nested failure')
  assert.equal(getErrorMessage({ message: 'ignored top-level message' }, 'fallback'), 'fallback')
  assert.equal(getErrorMessage({ error: { message: '' } }, 'fallback'), 'fallback')
  assert.equal(getErrorMessage(null, 'fallback'), 'fallback')
}

async function smokeComposerFileSearch(): Promise<void> {
  assert.equal(normalizeComposerFileSearchLimit(undefined), 20)
  assert.equal(normalizeComposerFileSearchLimit(0), 1)
  assert.equal(normalizeComposerFileSearchLimit(500), 100)
  assert.equal(normalizeComposerFileSearchCwd('relative-cwd').endsWith('relative-cwd'), true)
  assert.throws(
    () => normalizeComposerFileSearchCwd(''),
    (error) => error instanceof ComposerFileSearchError
      && error.statusCode === 400
      && error.message === 'Missing cwd',
  )

  assert.equal(scoreFileCandidate('src/App.vue', 'app.vue'), 0)
  assert.equal(scoreFileCandidate('src/App.vue', 'app'), 1)
  assert.equal(scoreFileCandidate('src/components/AppShell.vue', 'shell'), 2)
  assert.equal(scoreFileCandidate('src/server/app/file.ts', 'server'), 3)
  assert.equal(scoreFileCandidate('src/server/file.ts', 'ver/f'), 4)
  assert.equal(scoreFileCandidate('src/server/file.ts', 'missing'), 10)
  assert.deepEqual(searchComposerFileCandidates([
    'src/server/file.ts',
    'src/App.vue',
    'README.md',
    'src/components/AppShell.vue',
  ], 'app', 2), [
    { path: 'src/App.vue' },
    { path: 'src/components/AppShell.vue' },
  ])
  assert.deepEqual(searchComposerFileCandidates(['b.txt', 'a.txt'], '', 10), [
    { path: 'a.txt' },
    { path: 'b.txt' },
  ])

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-composer-file-search-'))
  try {
    await assertComposerFileSearchCwd(tempDir)
    const filePath = join(tempDir, 'file.txt')
    await writeFile(filePath, 'not a directory', 'utf8')
    await assert.rejects(
      assertComposerFileSearchCwd(filePath),
      (error) => error instanceof ComposerFileSearchError
        && error.statusCode === 400
        && error.message === 'cwd is not a directory',
    )
    await assert.rejects(
      assertComposerFileSearchCwd(join(tempDir, 'missing')),
      (error) => error instanceof ComposerFileSearchError
        && error.statusCode === 404
        && error.message === 'cwd does not exist',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokeGithubTrending(): Promise<void> {
  assert.equal(normalizeGithubTrendingSince('weekly'), 'weekly')
  assert.equal(normalizeGithubTrendingSince('monthly'), 'monthly')
  assert.equal(normalizeGithubTrendingSince('invalid'), 'daily')
  assert.equal(normalizeGithubTrendingLimit(undefined), 6)
  assert.equal(normalizeGithubTrendingLimit('0'), 1)
  assert.equal(normalizeGithubTrendingLimit('99'), 10)
  assert.equal(normalizeGithubTrendingLimit('bad'), 6)
  assert.deepEqual(
    normalizeGithubTrendingTranslationDescriptions(['one', 2, 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven']),
    ['one', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  )

  assert.equal(decodeHtmlEntities('A &amp; B &lt;tag&gt; &quot;x&quot; &#39;y&#39; &#x2F;'), 'A & B <tag> "x" \'y\' /')
  assert.equal(stripHtml('<p> A&nbsp; <strong>&amp;</strong> B </p>').includes('&'), true)
  assert.equal(normalizeGithubDescriptionTranslationText('  hello\n world  '), 'hello world')
  assert.equal(shouldTranslateGithubDescription('hello world'), true)
  assert.equal(shouldTranslateGithubDescription('中文说明'), false)
  assert.equal(shouldTranslateGithubDescription('12345'), false)
  assert.equal(readGoogleTranslateText([[['你好', 'hello'], ['世界', 'world']]]), '你好世界')
  assert.equal(readGoogleTranslateText({ invalid: true }), '')

  const originalNow = Date.now
  Date.now = () => 10_000
  try {
    const html = [
      '<article>',
      '<h2><a href="/owner/repo">owner / repo</a></h2>',
      '<p class="col-9 color-fg-muted">Build &amp; ship <strong>tools</strong></p>',
      '<span itemprop="programmingLanguage">TypeScript</span>',
      '<a href="/owner/repo/stargazers">1,234</a>',
      '</article>',
      '<article>',
      '<h2><a href="/owner/repo">duplicate / repo</a></h2>',
      '<p>Duplicate</p>',
      '</article>',
      '<article>',
      '<h2><a href="/other/project">other / project</a></h2>',
      '<p class="color-fg-muted">Second project</p>',
      '<span itemprop="programmingLanguage">Rust</span>',
      '<a href="/other/project/stargazers">bad</a>',
      '</article>',
    ].join('')
    assert.deepEqual(parseGithubTrendingHtml(html, 10), [
      {
        id: 10_000,
        fullName: 'owner/repo',
        url: 'https://github.com/owner/repo',
        description: 'Build & ship tools',
        language: 'TypeScript',
        stars: 1234,
      },
      {
        id: 10_001,
        fullName: 'other/project',
        url: 'https://github.com/other/project',
        description: 'Second project',
        language: 'Rust',
        stars: 0,
      },
    ])
    assert.deepEqual(parseGithubTrendingHtml(html, 1).map((item) => item.fullName), ['owner/repo'])
  } finally {
    Date.now = originalNow
  }

  assert.deepEqual(await translateGithubDescriptionsToChinese(['  中文\n说明  ', '', '12345']), [
    '中文 说明',
    '',
    '12345',
  ])
}

function smokeCodexPaths(): void {
  const previous = process.env.CODEX_HOME
  try {
    process.env.CODEX_HOME = '  C:\\cx-codex-home  '
    assert.equal(getCodexHomeDir(), 'C:\\cx-codex-home')
    assert.equal(getCodexAuthPath(), join('C:\\cx-codex-home', 'auth.json'))
    assert.equal(getCodexGlobalStatePath(), join('C:\\cx-codex-home', '.codex-global-state.json'))
    assert.equal(getCodexSessionIndexPath(), join('C:\\cx-codex-home', 'session_index.jsonl'))
    assert.equal(getWebBridgeSettingsPath(), join('C:\\cx-codex-home', 'web-bridge-settings.json'))
    assert.equal(getWebUiStatePath(), join('C:\\cx-codex-home', 'web-ui-state.json'))
    assert.equal(getWebFavoritesPath(), join('C:\\cx-codex-home', 'web-favorites.json'))
    assert.equal(getWebPinnedThreadIdsPath(), join('C:\\cx-codex-home', 'web-pinned-thread-ids.json'))
    assert.equal(getSkillsInstallDir(), join('C:\\cx-codex-home', 'skills'))
    assert.equal(getSkillsSyncStatePath(), join('C:\\cx-codex-home', 'skills-sync.json'))
    assert.equal(getCodexWorktreesDir(), join('C:\\cx-codex-home', 'worktrees'))

    process.env.CODEX_HOME = '   '
    assert.match(getCodexHomeDir(), /\.codex$/u)
  } finally {
    if (typeof previous === 'string') {
      process.env.CODEX_HOME = previous
    } else {
      delete process.env.CODEX_HOME
    }
  }
}

async function smokeCodexAuth(): Promise<void> {
  const previous = process.env.CODEX_HOME
  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-auth-'))
  try {
    process.env.CODEX_HOME = tempDir
    assert.equal(await readCodexAuth(), null)

    await writeFile(getCodexAuthPath(), '{invalid', 'utf8')
    assert.equal(await readCodexAuth(), null)

    await writeFile(getCodexAuthPath(), JSON.stringify({ tokens: { account_id: 'acct-only' } }), 'utf8')
    assert.equal(await readCodexAuth(), null)

    await writeFile(getCodexAuthPath(), JSON.stringify({
      tokens: {
        access_token: 'token-smoke',
        account_id: 'account-smoke',
      },
    }), 'utf8')
    assert.deepEqual(await readCodexAuth(), {
      accessToken: 'token-smoke',
      accountId: 'account-smoke',
    })
  } finally {
    if (typeof previous === 'string') {
      process.env.CODEX_HOME = previous
    } else {
      delete process.env.CODEX_HOME
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokePinnedThreads(): Promise<void> {
  assert.deepEqual(normalizePinnedThreadIds([' a ', '', 'a', 3, 'b']), ['a', 'b'])

  const previous = process.env.CODEX_HOME
  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-pinned-threads-'))
  try {
    process.env.CODEX_HOME = tempDir
    await writeFile(getWebPinnedThreadIdsPath(), JSON.stringify(['web-a', 'desktop-a', ' web-b ']), 'utf8')
    await writeFile(getCodexGlobalStatePath(), JSON.stringify({
      existing: true,
      'pinned-thread-ids': ['desktop-a', 'desktop-b', '', 'desktop-b'],
    }), 'utf8')

    assert.deepEqual(await readDesktopPinnedThreadIds(), ['desktop-a', 'desktop-b'])
    assert.deepEqual(await readMergedPinnedThreadIds(), ['web-a', 'desktop-a', 'web-b', 'desktop-b'])

    assert.deepEqual(await writeMergedPinnedThreadIds([' next-a ', 'next-a', 'next-b']), ['next-a', 'next-b'])
    const webPinned = JSON.parse(await readFile(getWebPinnedThreadIdsPath(), 'utf8')) as unknown
    const desktopState = JSON.parse(await readFile(getCodexGlobalStatePath(), 'utf8')) as Record<string, unknown>
    assert.deepEqual(webPinned, ['next-a', 'next-b'])
    assert.equal(desktopState.existing, true)
    assert.deepEqual(desktopState['pinned-thread-ids'], ['next-a', 'next-b'])
  } finally {
    if (typeof previous === 'string') {
      process.env.CODEX_HOME = previous
    } else {
      delete process.env.CODEX_HOME
    }
    await rm(tempDir, { recursive: true, force: true })
  }
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

async function smokeThreadSearchIndex(): Promise<void> {
  assert.deepEqual(normalizeThreadSearchRow({ id: '', name: 'Missing id' }), null)
  assert.deepEqual(normalizeThreadSearchRow({ id: 'thread-a', name: '  Alpha  ', preview: 'Preview A' }), {
    id: 'thread-a',
    title: 'Alpha',
    preview: 'Preview A',
  })
  assert.deepEqual(normalizeThreadSearchRow({ id: 'thread-b', preview: '  Preview B  ' }), {
    id: 'thread-b',
    title: 'Preview B',
    preview: '  Preview B  ',
  })
  assert.deepEqual(normalizeThreadSearchRow({ id: 'thread-c' }), {
    id: 'thread-c',
    title: 'Untitled thread',
    preview: '',
  })

  const requestedParams: ThreadListParams[] = []
  const listThreads = async (params: ThreadListParams): Promise<unknown> => {
    requestedParams.push(params)
    if (!params.archived && params.cursor === null) {
      return {
        data: [
          { id: 'thread-a', name: 'Alpha notes', preview: 'A preview' },
          { id: 'thread-b', preview: 'Beta preview' },
        ],
        nextCursor: 'page-2',
      }
    }
    if (!params.archived && params.cursor === 'page-2') {
      return {
        data: [
          { id: 'thread-a', name: 'Duplicate Alpha' },
          { id: 'thread-c', name: 'Gamma plan' },
        ],
      }
    }
    if (params.archived && params.cursor === null) {
      return { data: [{ id: 'thread-d', name: 'Archived delta' }] }
    }
    throw new Error(`Unexpected thread/list params: ${JSON.stringify(params)}`)
  }

  const sessionIndexCache = {
    titles: {
      'thread-c': 'Ignored duplicate session title',
      'thread-e': 'Session epsilon',
    },
    order: ['thread-c', 'thread-e'],
  }
  const docs = await loadAllThreadsForSearch(listThreads, sessionIndexCache)
  assert.deepEqual(requestedParams, [
    { archived: false, limit: 100, sortKey: 'updated_at', cursor: null },
    { archived: false, limit: 100, sortKey: 'updated_at', cursor: 'page-2' },
    { archived: true, limit: 100, sortKey: 'updated_at', cursor: null },
  ])
  assert.deepEqual(docs.map((doc) => [doc.id, doc.title]), [
    ['thread-a', 'Alpha notes'],
    ['thread-b', 'Beta preview'],
    ['thread-c', 'Gamma plan'],
    ['thread-d', 'Archived delta'],
    ['thread-e', 'Session epsilon'],
  ])

  const index = await buildThreadSearchIndex(listThreads, sessionIndexCache)
  assert.equal(index.docsById.size, 5)
  assert.equal(isExactPhraseMatch('alpha', index.docsById.get('thread-a')!), true)
  assert.equal(isExactPhraseMatch('missing', index.docsById.get('thread-a')!), false)
  assert.deepEqual(searchThreadIndex(index, 'thread', 2), {
    threadIds: [],
    indexedThreadCount: 5,
  })
  assert.deepEqual(searchThreadIndex(index, 'a', 2), {
    threadIds: ['thread-a', 'thread-b'],
    indexedThreadCount: 5,
  })

  let buildCount = 0
  const store = new ThreadSearchIndexStore(async () => {
    buildCount += 1
    return {
      docsById: new Map([
        ['thread-a', { id: 'thread-a', title: `Alpha ${String(buildCount)}`, preview: '', messageText: '', searchableText: '' }],
      ]),
    }
  })
  assert.deepEqual(await store.search('', 10), { threadIds: [], indexedThreadCount: 0 })
  assert.deepEqual(await store.search('alpha', 10), { threadIds: ['thread-a'], indexedThreadCount: 1 })
  assert.deepEqual(await store.search('alpha', 10), { threadIds: ['thread-a'], indexedThreadCount: 1 })
  assert.equal(buildCount, 1)
  store.clear()
  assert.deepEqual(await store.search('alpha', 10), { threadIds: ['thread-a'], indexedThreadCount: 1 })
  assert.equal(buildCount, 2)
}

async function smokeWorkspaceRootsState(): Promise<void> {
  assert.deepEqual(normalizeWorkspaceRootsState(null), { order: [], labels: {}, active: [] })
  assert.deepEqual(normalizeWorkspaceRootsState({
    order: ['C:\\work\\one', 'C:\\work\\one', '', 7],
    labels: { 'C:\\work\\one': 'One', empty: '', bad: 9 },
    active: ['C:\\work\\two', 'C:\\work\\two'],
  }), {
    order: ['C:\\work\\one'],
    labels: { 'C:\\work\\one': 'One', empty: '' },
    active: ['C:\\work\\two'],
  })
  assert.deepEqual(readWorkspaceRootsStateFromPayload({
    'electron-saved-workspace-roots': ['C:\\work\\old', 'C:\\work\\old'],
    'electron-workspace-root-labels': { 'C:\\work\\old': 'Old' },
    'active-workspace-roots': ['C:\\work\\active'],
  }), {
    order: ['C:\\work\\old'],
    labels: { 'C:\\work\\old': 'Old' },
    active: ['C:\\work\\active'],
  })

  const upserted = upsertWorkspaceRootState({
    order: ['C:\\work\\old', 'C:\\work\\new'],
    labels: { 'C:\\work\\old': 'Old' },
    active: ['C:\\work\\old'],
  }, 'C:\\work\\new', 'New')
  assert.deepEqual(upserted, {
    order: ['C:\\work\\new', 'C:\\work\\old'],
    labels: { 'C:\\work\\old': 'Old', 'C:\\work\\new': 'New' },
    active: ['C:\\work\\new', 'C:\\work\\old'],
  })

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-workspace-roots-'))
  try {
    const statePath = join(tempDir, 'global-state.json')
    assert.deepEqual(await readWorkspaceRootsState(statePath), { order: [], labels: {}, active: [] })

    await writeFile(statePath, JSON.stringify({ existing: true }), 'utf8')
    await writeWorkspaceRootsState(statePath, {
      order: ['C:\\work\\one', 'C:\\work\\one'],
      labels: { 'C:\\work\\one': 'One' },
      active: ['C:\\work\\one'],
    })

    assert.deepEqual(await readWorkspaceRootsState(statePath), {
      order: ['C:\\work\\one'],
      labels: { 'C:\\work\\one': 'One' },
      active: ['C:\\work\\one'],
    })
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).existing, true)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function smokeProjectRoots(): Promise<void> {
  assert.equal(normalizeProjectPath('relative-project').endsWith('relative-project'), true)
  await assert.rejects(
    resolveProjectRoot('', { existingState: { order: [], labels: {}, active: [] } }),
    (error) => error instanceof ProjectRootError && error.statusCode === 400 && error.message === 'Missing path',
  )

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-project-roots-'))
  try {
    const existingDir = join(tempDir, 'existing')
    const createdDir = join(tempDir, 'created')
    const filePath = join(tempDir, 'file.txt')
    await mkdir(existingDir)
    await writeFile(filePath, 'not a directory', 'utf8')

    await assert.rejects(
      resolveProjectRoot(filePath, { existingState: { order: [], labels: {}, active: [] } }),
      (error) => error instanceof ProjectRootError && error.statusCode === 400 && error.message === 'Path exists but is not a directory',
    )
    await assert.rejects(
      resolveProjectRoot(createdDir, { existingState: { order: [], labels: {}, active: [] } }),
      (error) => error instanceof ProjectRootError && error.statusCode === 404 && error.message === 'Directory does not exist',
    )

    const created = await resolveProjectRoot(createdDir, {
      createIfMissing: true,
      label: 'Created Project',
      existingState: { order: [existingDir], labels: {}, active: [existingDir] },
    })
    assert.equal(created.path, createdDir)
    assert.deepEqual(created.workspaceState, {
      order: [createdDir, existingDir],
      labels: { [createdDir]: 'Created Project' },
      active: [createdDir, existingDir],
    })

    await mkdir(join(tempDir, 'New Project (1)'))
    const suggestion = await suggestProjectRoot(tempDir)
    assert.deepEqual(suggestion, {
      name: 'New Project (2)',
      path: join(tempDir, 'New Project (2)'),
    })

    await assert.rejects(
      suggestProjectRoot(''),
      (error) => error instanceof ProjectRootError && error.statusCode === 400 && error.message === 'Missing basePath',
    )
    await assert.rejects(
      suggestProjectRoot(filePath),
      (error) => error instanceof ProjectRootError && error.statusCode === 400 && error.message === 'basePath is not a directory',
    )
    await assert.rejects(
      suggestProjectRoot(join(tempDir, 'missing-base')),
      (error) => error instanceof ProjectRootError && error.statusCode === 404 && error.message === 'basePath does not exist',
    )
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

function createThreadRuntimeSnapshot(overrides: Partial<ThreadRuntimeSnapshot> = {}): ThreadRuntimeSnapshot {
  return {
    threadId: 'thread-a',
    executionState: 'completed',
    inProgress: false,
    activeTurnId: '',
    activeItemId: '',
    canStop: false,
    stopRequested: false,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    lastEventSeq: 0,
    lastEventAtIso: null,
    lastStartedAtIso: null,
    lastCompletedAtIso: null,
    lastError: null,
    stale: false,
    degradedReason: null,
    source: 'thread-read',
    threadRead: null,
    messageState: 'fresh',
    pendingServerRequests: [],
    tokenUsage: null,
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function withTranscriptionEnv(
  values: Record<string, string | undefined>,
  callback: () => void,
): void {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key])
    const value = values[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    callback()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function readIncludeTurns(payload: unknown): boolean | undefined {
  const value = asRecord(payload)?.includeTurns
  return typeof value === 'boolean' ? value : undefined
}

function readBooleanProperty(payload: unknown, key: string): boolean {
  return asRecord(payload)?.[key] === true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
