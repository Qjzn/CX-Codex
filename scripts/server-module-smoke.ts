import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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
import { createAppServerHealthSnapshot, type AppServerHealth } from '../src/server/appServerHealth.js'
import { AppServerLineBuffer } from '../src/server/appServerLineBuffer.js'
import {
  AppServerNotificationDiagnostics,
  isKnownAppServerNotificationMethod,
} from '../src/server/appServerNotificationDiagnostics.js'
import {
  AppServerHookDiagnosticsCache,
  createAppServerHookDiagnosticsUnavailable,
  normalizeAppServerHookDiagnostics,
} from '../src/server/appServerHookDiagnostics.js'
import {
  createWindowsSandboxReadinessUnavailable,
  createWindowsSandboxReadinessUnsupported,
  normalizeWindowsSandboxReadiness,
  WindowsSandboxReadinessCache,
} from '../src/server/windowsSandboxDiagnostics.js'
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
  createCachedThreadRead,
  isCachedThreadReadStaleForRuntime,
  readIsoTimestampMs,
  type CachedThreadRead,
} from '../src/server/appServerThreadReadCache.js'
import { AppServerThreadListAugmenter } from '../src/server/appServerThreadListAugment.js'
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
  type WebBridgeSettings,
} from '../src/server/serverRequestPolicy.js'
import type { FavoriteRecord } from '../src/server/webUiState.js'
import {
  classifyServerRequestMethod,
  createServerRequestDiagnosticsSnapshot,
  toPendingServerRequestDiagnostics,
  toPendingServerRequestDiagnosticsList,
} from '../src/server/serverRequestDiagnostics.js'
import { readServerRequestReplyPayload } from '../src/server/serverRequestReply.js'
import { handleServerRequestRoutes } from '../src/server/serverRequestRoutes.js'
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
import { handleFileUploadRoute } from '../src/server/fileUploadRoute.js'
import {
  ComposerFileSearchError,
  assertComposerFileSearchCwd,
  normalizeComposerFileSearchCwd,
  normalizeComposerFileSearchLimit,
  scoreFileCandidate,
  searchComposerFileCandidates,
} from '../src/server/composerFileSearch.js'
import { handleComposerFileSearchRoutes } from '../src/server/composerFileSearchRoutes.js'
import {
  decodeHtmlEntities,
  type GithubTrendingSince,
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
import { handleGithubTrendingRoutes } from '../src/server/githubTrendingRoutes.js'
import { handleWorktreeRoutes, type WorktreeRoutesDependencies } from '../src/server/worktreeRoutes.js'
import {
  runCommand,
  runCommandCapture,
  runCommandWithOutput,
} from '../src/server/commandRunner.js'
import {
  ensureLocalCodexGitignoreHasRollbacks,
  ensureRepoHasInitialCommit,
  ensureRollbackGitRepo,
  findRollbackCommitByExactMessage,
  getRollbackGitDirForCwd,
  hasRollbackGitWorkingTreeChanges,
  normalizeCommitMessage,
  runRollbackGit,
  runRollbackGitWithOutput,
} from '../src/server/appServerRollbackGit.js'
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
  resolveThreadTokenUsage,
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
import { handleThreadRoutes } from '../src/server/threadRoutes.js'
import {
  isRuntimeActiveState,
  RuntimeStateStore,
  toPersistableRuntimeSnapshot,
  type RuntimeSnapshotOverlay,
  type RuntimeExecutionState,
  type ThreadRuntimeSnapshot,
} from '../src/server/runtimeState.js'
import { handleRuntimeStateRoutes } from '../src/server/runtimeStateRoutes.js'
import type { RuntimeRequestRecord } from '../src/server/runtimeStore.js'
import type { RuntimeEventRecord } from '../src/server/runtimeStore.js'
import {
  parseRuntimeInterruptPayload,
  parseRuntimeSendPayload,
} from '../src/server/runtimePayload.js'
import { handleRuntimeActionRoutes } from '../src/server/runtimeActionRoutes.js'
import { handleDiagnosticsRoutes } from '../src/server/diagnosticsRoutes.js'
import {
  normalizeRuntimeEventForReplay,
  readRuntimeRequestStatusFromExecutionState,
  type BridgeNotificationEvent,
} from '../src/server/appServerRuntimeBridge.js'
import { AppServerNotificationReplay } from '../src/server/appServerNotificationReplay.js'
import {
  handleNotificationReplayRoute,
  readNotificationReplayQuery,
} from '../src/server/notificationReplayRoute.js'
import {
  BRIDGE_HEARTBEAT_METHOD,
  handleNotificationSseRoute,
} from '../src/server/notificationSseRoute.js'
import { handleStatusRoutes } from '../src/server/statusRoutes.js'
import { handleLocalStateRoutes } from '../src/server/localStateRoutes.js'
import {
  createRuntimeReconcileFailurePatch,
  createRuntimeRequestSnapshotPatch,
  createRuntimeThreadStatePayload,
  RUNTIME_RECONCILE_BATCH_LIMIT,
  RUNTIME_RECONCILE_RUNNING_THROTTLE_MS,
  RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES,
  selectRuntimeRequestsForReconcile,
  updateRuntimeRequestsFromSnapshot,
} from '../src/server/appServerRuntimeRequestReconciliation.js'
import {
  createLocalRuntimeSnapshot,
  createLocalRuntimeSnapshotFromPersisted,
} from '../src/server/appServerRuntimeSnapshotRecovery.js'
import {
  normalizeWorkspaceRootsState,
  readWorkspaceRootsState,
  readWorkspaceRootsStateFromPayload,
  upsertWorkspaceRootState,
  writeWorkspaceRootsState,
} from '../src/server/workspaceRootsState.js'
import { handleWorkspaceMetaRoutes } from '../src/server/workspaceMetaRoutes.js'
import {
  ProjectRootError,
  normalizeProjectPath,
  resolveProjectRoot,
  suggestProjectRoot,
} from '../src/server/projectRoots.js'
import { handleProjectRootRoutes } from '../src/server/projectRootRoutes.js'
import {
  getOpenAiTranscribeApiKey,
  getOpenAiTranscribeModel,
  getOpenAiTranscribeResponseFormat,
  getTranscribeRequestBodyLimitBytes,
  getTranscriptionProxyConfigSnapshot,
  prepareOpenAiTranscribeBody,
} from '../src/server/transcriptionProxy.js'
import { handleTranscriptionRoute } from '../src/server/transcriptionRoute.js'
import { setJson } from '../src/server/httpJsonResponse.js'
import { getErrorMessage } from '../src/server/errorMessage.js'
import {
  getAuthLoginRequestBodyLimitBytes,
  readAuthLoginPassword,
} from '../src/server/authMiddleware.js'
import { RequestBodyTooLargeError } from '../src/server/httpBody.js'

const originalNow = Date.now

try {
  await smokeAppServerClientInfo()
  smokePendingServerRequests()
  smokeAppServerJsonRpcWire()
  smokeAppServerInitialization()
  smokeAppServerLaunch()
  smokeAppServerHealth()
  await smokeAuthMiddleware()
  smokeAppServerMethodCatalog()
  smokeAppServerNotificationDiagnostics()
  await smokeAppServerHookDiagnostics()
  await smokeWindowsSandboxReadinessDiagnostics()
  smokeAppServerStatusDiagnostics()
  await smokeAppServerSchemaAuditSummary()
  smokeTranscriptionProxyConfig()
  smokeTranscriptionMultipartDefaults()
  await smokeTranscriptionRoute()
  smokeAppServerRpcResult()
  smokeAppServerPayloadIds()
  smokeAppServerThreadPayload()
  await smokeAppServerThreadListAugment()
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
  await smokeServerRequestRoutes()
  await smokeCommandRunner()
  await smokeAppServerRollbackGit()
  await smokeFileUpload()
  await smokeFileUploadRoute()
  smokeHttpJsonResponse()
  smokeErrorMessage()
  await smokeComposerFileSearch()
  await smokeComposerFileSearchRoutes()
  await smokeGithubTrending()
  await smokeGithubTrendingRoutes()
  await smokeWorktreeRoutes()
  smokeCodexPaths()
  await smokeCodexAuth()
  await smokePinnedThreads()
  await smokeWebBridgeSettings()
  await smokeThreadTokenUsage()
  await smokeThreadTitleCache()
  await smokeThreadSearchIndex()
  await smokeThreadRoutes()
  await smokeStatusRoutes()
  await smokeWorkspaceRootsState()
  await smokeWorkspaceMetaRoutes()
  await smokeProjectRoots()
  await smokeProjectRootRoutes()
  smokeRuntimePayloadParsing()
  await smokeRuntimeActionRoutes()
  await smokeDiagnosticsRoutes()
  smokeAppServerNotificationReplay()
  await smokeLocalStateRoutes()
  await smokeRuntimeStateRoutes()
  smokeNotificationSseRoute()
  smokeNotificationReplayRoute()
  smokeAppServerRuntimeBridge()
  smokeAppServerRuntimeRequestReconciliation()
  smokeAppServerRuntimeSnapshotRecovery()
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

async function smokeServerRequestRoutes(): Promise<void> {
  const pendingRequests = [
    {
      id: 1,
      method: 'item/fileChange/requestApproval',
      params: { prompt: 'hidden' },
      receivedAtIso: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      method: 'mcp/server/elicitation/request',
      params: { prompt: 'hidden' },
      receivedAtIso: '2026-01-01T00:00:01.000Z',
    },
  ]
  const bodies: unknown[] = [{ id: 1, result: { action: 'approve' } }]
  const respondedPayloads: unknown[] = []
  let listCount = 0
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    respondToServerRequest: async (payload: unknown) => {
      respondedPayloads.push(payload)
    },
    listPendingServerRequests: () => {
      listCount += 1
      return pendingRequests
    },
  }

  const respond = createRouteTestResponse()
  assert.equal(await handleServerRequestRoutes(
    { method: 'POST' } as never,
    respond.response as never,
    new URL('http://127.0.0.1/codex-api/server-requests/respond'),
    dependencies,
  ), true)
  assert.deepEqual(respondedPayloads, [{ id: 1, result: { action: 'approve' } }])
  assert.deepEqual(JSON.parse(respond.body), { ok: true })

  const pending = createRouteTestResponse()
  assert.equal(await handleServerRequestRoutes(
    { method: 'GET' } as never,
    pending.response as never,
    new URL('http://127.0.0.1/codex-api/server-requests/pending'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(pending.body), { data: pendingRequests })

  const diagnostics = createRouteTestResponse()
  assert.equal(await handleServerRequestRoutes(
    { method: 'GET' } as never,
    diagnostics.response as never,
    new URL('http://127.0.0.1/codex-api/server-requests/pending/diagnostics'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(diagnostics.body), {
    data: {
      pendingRequestCount: 2,
      pendingByKind: {
        permission: 0,
        approval: 1,
        elicitation: 1,
        tool: 0,
        request: 0,
      },
      pendingRequests: [
        {
          id: 1,
          method: 'item/fileChange/requestApproval',
          kind: 'approval',
          receivedAtIso: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          method: 'mcp/server/elicitation/request',
          kind: 'elicitation',
          receivedAtIso: '2026-01-01T00:00:01.000Z',
        },
      ],
    },
  })
  assert.equal(listCount, 2)

  assert.equal(await handleServerRequestRoutes(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/server-requests/pending'),
    dependencies,
  ), false)
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

async function smokeAuthMiddleware(): Promise<void> {
  const originalLimit = process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES
  try {
    process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES = '321'
    assert.equal(getAuthLoginRequestBodyLimitBytes(), 321)
  } finally {
    if (typeof originalLimit === 'string') {
      process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES = originalLimit
    } else {
      delete process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES
    }
  }

  assert.equal(getAuthLoginRequestBodyLimitBytes(), 16 * 1024)
  assert.equal(
    await readAuthLoginPassword(Readable.from([Buffer.from(JSON.stringify({ password: 'secret' }))]) as never),
    'secret',
  )
  assert.equal(
    await readAuthLoginPassword(Readable.from([Buffer.from(JSON.stringify({ password: 7 }))]) as never),
    '',
  )

  const originalTinyLimit = process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES
  try {
    process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES = '5'
    await assert.rejects(
      readAuthLoginPassword(Readable.from([Buffer.from(JSON.stringify({ password: 'too-large' }))]) as never),
      (error) => error instanceof RequestBodyTooLargeError && error.maxBytes === 5,
    )
  } finally {
    if (typeof originalTinyLimit === 'string') {
      process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES = originalTinyLimit
    } else {
      delete process.env.CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES
    }
  }
}

function smokeAppServerNotificationDiagnostics(): void {
  assert.equal(isKnownAppServerNotificationMethod('turn/started'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/archived'), true)
  assert.equal(isKnownAppServerNotificationMethod('skills/changed'), true)
  assert.equal(isKnownAppServerNotificationMethod('app/list/updated'), true)
  assert.equal(isKnownAppServerNotificationMethod('mcpServer/oauthLogin/completed'), true)
  assert.equal(isKnownAppServerNotificationMethod('mcpServer/startupStatus/updated'), true)
  assert.equal(isKnownAppServerNotificationMethod('account/rateLimits/updated'), true)
  assert.equal(isKnownAppServerNotificationMethod('model/rerouted'), true)
  assert.equal(isKnownAppServerNotificationMethod('model/verification'), true)
  assert.equal(isKnownAppServerNotificationMethod('warning'), true)
  assert.equal(isKnownAppServerNotificationMethod('guardianWarning'), true)
  assert.equal(isKnownAppServerNotificationMethod('item/autoApprovalReview/started'), true)
  assert.equal(isKnownAppServerNotificationMethod('item/autoApprovalReview/completed'), true)
  assert.equal(isKnownAppServerNotificationMethod('deprecationNotice'), true)
  assert.equal(isKnownAppServerNotificationMethod('configWarning'), true)
  assert.equal(isKnownAppServerNotificationMethod('fs/changed'), true)
  assert.equal(isKnownAppServerNotificationMethod('externalAgentConfig/import/completed'), true)
  assert.equal(isKnownAppServerNotificationMethod('hook/started'), true)
  assert.equal(isKnownAppServerNotificationMethod('hook/completed'), true)
  assert.equal(isKnownAppServerNotificationMethod('windows/worldWritableWarning'), true)
  assert.equal(isKnownAppServerNotificationMethod('windowsSandbox/setupCompleted'), true)
  assert.equal(isKnownAppServerNotificationMethod('item/tool/call/failed'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/started'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/itemAdded'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/transcript/delta'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/transcript/done'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/outputAudio/delta'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/sdp'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/error'), true)
  assert.equal(isKnownAppServerNotificationMethod('thread/realtime/closed'), true)

  const diagnostics = new AppServerNotificationDiagnostics({ maxRecentUnknown: 2, maxRecentRealtimeNotifications: 4 })
  diagnostics.observe({
    method: 'turn/started',
    atIso: '2026-07-03T00:00:00.000Z',
    threadId: 'thread-a',
  })
  assert.deepEqual(diagnostics.snapshot(), {
    unknownNotificationCount: 0,
    recentUnknownNotifications: [],
    recentModelNotifications: [],
    recentWindowsSandboxNotifications: [],
    recentHookNotifications: [],
    recentGuardianReviewNotifications: [],
    recentProtocolAlerts: [],
    recentRealtimeNotifications: [],
  })

  diagnostics.observe({
    method: 'model/rerouted',
    atIso: '2026-07-03T00:00:00.500Z',
    threadId: 'thread-model',
    turnId: 'turn-model',
    params: {
      threadId: 'thread-model',
      turnId: 'turn-model',
      fromModel: 'gpt-5.2-codex',
      toModel: 'gpt-5.2-codex-fast',
      reason: 'capacity',
    },
  })
  diagnostics.observe({
    method: 'model/verification',
    atIso: '2026-07-03T00:00:00.600Z',
    params: {
      threadId: 'thread-model',
      turnId: 'turn-model',
      verifications: ['trustedAccessForCyber'],
    },
  })
  const modelSnapshot = diagnostics.snapshot()
  assert.equal(modelSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(modelSnapshot.recentModelNotifications.map((item) => item.method), [
    'model/verification',
    'model/rerouted',
  ])
  assert.deepEqual(modelSnapshot.recentModelNotifications[0], {
    method: 'model/verification',
    atIso: '2026-07-03T00:00:00.600Z',
    threadId: 'thread-model',
    turnId: 'turn-model',
    fromModel: '',
    toModel: '',
    reason: '',
    verificationCount: 1,
    verifications: ['trustedAccessForCyber'],
  })
  assert.equal(modelSnapshot.recentModelNotifications[1]?.fromModel, 'gpt-5.2-codex')
  assert.equal(modelSnapshot.recentModelNotifications[1]?.toModel, 'gpt-5.2-codex-fast')
  assert.equal(modelSnapshot.recentModelNotifications[1]?.reason, 'capacity')

  diagnostics.observe({
    method: 'windows/worldWritableWarning',
    atIso: '2026-07-03T00:00:00.700Z',
    params: {
      samplePaths: ['C:\\Users\\SW\\unsafe-a', 'C:\\Users\\SW\\unsafe-b'],
      extraCount: 3,
      failedScan: false,
    },
  })
  diagnostics.observe({
    method: 'windowsSandbox/setupCompleted',
    atIso: '2026-07-03T00:00:00.800Z',
    params: {
      mode: 'unelevated',
      success: false,
      error: 'setup denied by user',
    },
  })
  const windowsSnapshot = diagnostics.snapshot()
  assert.equal(windowsSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(windowsSnapshot.recentWindowsSandboxNotifications, [
    {
      method: 'windowsSandbox/setupCompleted',
      atIso: '2026-07-03T00:00:00.800Z',
      mode: 'unelevated',
      success: false,
      error: 'setup denied by user',
      samplePathCount: 0,
      extraCount: 0,
      failedScan: null,
    },
    {
      method: 'windows/worldWritableWarning',
      atIso: '2026-07-03T00:00:00.700Z',
      mode: '',
      success: null,
      error: '',
      samplePathCount: 2,
      extraCount: 3,
      failedScan: false,
    },
  ])
  assert.equal(JSON.stringify(windowsSnapshot.recentWindowsSandboxNotifications).includes('unsafe-a'), false)

  diagnostics.observe({
    method: 'hook/started',
    atIso: '2026-07-03T00:00:00.900Z',
    params: {
      threadId: 'thread-hook',
      turnId: 'turn-hook',
      run: {
        id: 'hook-run-a',
        eventName: 'preToolUse',
        handlerType: 'command',
        status: 'running',
        source: 'project',
        sourcePath: 'C:\\secret\\.codex\\hooks.json',
        entries: [{ kind: 'stdout' }],
      },
    },
  })
  diagnostics.observe({
    method: 'hook/completed',
    atIso: '2026-07-03T00:00:00.950Z',
    params: {
      threadId: 'thread-hook',
      turnId: null,
      run: {
        id: 'hook-run-a',
        eventName: 'preToolUse',
        handlerType: 'command',
        status: 'completed',
        durationMs: 12,
        source: 'project',
        sourcePath: 'C:\\secret\\.codex\\hooks.json',
        entries: [{ kind: 'stdout' }, { kind: 'stderr' }],
      },
    },
  })
  const hookNotificationSnapshot = diagnostics.snapshot()
  assert.equal(hookNotificationSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(hookNotificationSnapshot.recentHookNotifications.map((item) => item.method), [
    'hook/completed',
    'hook/started',
  ])
  assert.deepEqual(hookNotificationSnapshot.recentHookNotifications[0], {
    method: 'hook/completed',
    atIso: '2026-07-03T00:00:00.950Z',
    threadId: 'thread-hook',
    turnId: '',
    runId: 'hook-run-a',
    eventName: 'preToolUse',
    handlerType: 'command',
    status: 'completed',
    durationMs: 12,
    source: 'project',
    outputEntryCount: 2,
  })
  assert.equal(JSON.stringify(hookNotificationSnapshot.recentHookNotifications).includes('secret'), false)

  diagnostics.observe({
    method: 'item/autoApprovalReview/started',
    atIso: '2026-07-03T00:00:00.955Z',
    params: {
      threadId: 'thread-guardian',
      turnId: 'turn-guardian',
      startedAtMs: 1_000,
      reviewId: 'review-a',
      targetItemId: 'item-a',
      review: {
        status: 'inProgress',
        riskLevel: 'high',
        userAuthorization: 'medium',
        rationale: 'secret reviewer rationale',
      },
      action: {
        type: 'command',
        source: 'shell',
        command: 'curl https://secret.example/token',
        cwd: 'C:\\secret\\repo',
      },
    },
  })
  diagnostics.observe({
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.956Z',
    params: {
      threadId: 'thread-guardian',
      turnId: 'turn-guardian',
      startedAtMs: 1_000,
      completedAtMs: 1_125,
      reviewId: 'review-b',
      targetItemId: null,
      decisionSource: 'agent',
      review: {
        status: 'denied',
        riskLevel: 'critical',
        userAuthorization: 'low',
        rationale: 'do not expose this rationale',
      },
      action: {
        type: 'requestPermissions',
        reason: 'secret permission reason',
        permissions: {
          network: { domains: ['secret.example'] },
          fileSystem: { writableRoots: ['C:\\secret\\repo'] },
        },
      },
    },
  })
  diagnostics.observe({
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.957Z',
    params: {
      threadId: 'thread-guardian',
      turnId: 'turn-guardian',
      startedAtMs: 1_200,
      completedAtMs: 1_260,
      reviewId: 'review-c',
      targetItemId: null,
      decisionSource: 'agent',
      review: {
        status: 'approved',
        riskLevel: 'medium',
        userAuthorization: 'high',
        rationale: 'secret network rationale',
      },
      action: {
        type: 'networkAccess',
        target: 'https://api.secret.example/v1/audio',
        host: 'api.secret.example',
        protocol: 'https',
        port: 443,
      },
    },
  })
  diagnostics.observe({
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.958Z',
    params: {
      threadId: 'thread-guardian',
      turnId: 'turn-guardian',
      startedAtMs: 1_300,
      completedAtMs: 1_340,
      reviewId: 'review-d',
      targetItemId: 'item-patch',
      decisionSource: 'agent',
      review: {
        status: 'approved',
        riskLevel: 'medium',
        userAuthorization: 'high',
        rationale: 'secret patch rationale',
      },
      action: {
        type: 'applyPatch',
        cwd: 'C:\\secret\\repo',
        files: ['C:\\secret\\repo\\src\\secret.ts', 'C:\\secret\\repo\\README.md'],
      },
    },
  })
  const guardianSnapshot = diagnostics.snapshot()
  assert.equal(guardianSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(guardianSnapshot.recentGuardianReviewNotifications.map((item) => item.method), [
    'item/autoApprovalReview/completed',
    'item/autoApprovalReview/completed',
    'item/autoApprovalReview/completed',
    'item/autoApprovalReview/started',
  ])
  assert.deepEqual(guardianSnapshot.recentGuardianReviewNotifications[0], {
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.958Z',
    threadId: 'thread-guardian',
    turnId: 'turn-guardian',
    reviewId: 'review-d',
    targetItemId: 'item-patch',
    status: 'approved',
    riskLevel: 'medium',
    userAuthorization: 'high',
    actionType: 'applyPatch',
    decisionSource: 'agent',
    durationMs: 40,
    hasRationale: true,
    actionArgCount: 0,
    actionFileCount: 2,
    permissionNetworkRequested: false,
    permissionFileSystemRequested: true,
  })
  assert.deepEqual(guardianSnapshot.recentGuardianReviewNotifications[1], {
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.957Z',
    threadId: 'thread-guardian',
    turnId: 'turn-guardian',
    reviewId: 'review-c',
    targetItemId: '',
    status: 'approved',
    riskLevel: 'medium',
    userAuthorization: 'high',
    actionType: 'networkAccess',
    decisionSource: 'agent',
    durationMs: 60,
    hasRationale: true,
    actionArgCount: 0,
    actionFileCount: 0,
    permissionNetworkRequested: true,
    permissionFileSystemRequested: false,
  })
  assert.deepEqual(guardianSnapshot.recentGuardianReviewNotifications[2], {
    method: 'item/autoApprovalReview/completed',
    atIso: '2026-07-03T00:00:00.956Z',
    threadId: 'thread-guardian',
    turnId: 'turn-guardian',
    reviewId: 'review-b',
    targetItemId: '',
    status: 'denied',
    riskLevel: 'critical',
    userAuthorization: 'low',
    actionType: 'requestPermissions',
    decisionSource: 'agent',
    durationMs: 125,
    hasRationale: true,
    actionArgCount: 0,
    actionFileCount: 0,
    permissionNetworkRequested: true,
    permissionFileSystemRequested: true,
  })
  assert.equal(guardianSnapshot.recentGuardianReviewNotifications[3]?.actionType, 'command')
  assert.equal(guardianSnapshot.recentGuardianReviewNotifications[3]?.hasRationale, true)
  const serializedGuardianSnapshot = JSON.stringify(guardianSnapshot.recentGuardianReviewNotifications)
  assert.equal(serializedGuardianSnapshot.includes('secret'), false)
  assert.equal(serializedGuardianSnapshot.includes('curl'), false)
  assert.equal(serializedGuardianSnapshot.includes('C:\\'), false)
  assert.equal(serializedGuardianSnapshot.includes('api.secret.example'), false)
  assert.equal(serializedGuardianSnapshot.includes('/v1/audio'), false)
  assert.equal(serializedGuardianSnapshot.includes('rationale'), false)

  diagnostics.observe({
    method: 'warning',
    atIso: '2026-07-03T00:00:00.960Z',
    params: {
      threadId: 'thread-warning',
      message: 'general warning',
    },
  })
  diagnostics.observe({
    method: 'configWarning',
    atIso: '2026-07-03T00:00:00.970Z',
    params: {
      summary: 'invalid config value',
      details: 'use a supported option',
      path: 'C:\\Users\\SW\\.codex\\config.toml',
    },
  })
  diagnostics.observe({
    method: 'fs/changed',
    atIso: '2026-07-03T00:00:00.980Z',
    params: {
      watchId: 'watch-secret',
      changedPaths: ['C:\\secret\\file-a.txt', 'C:\\secret\\file-b.txt'],
    },
  })
  diagnostics.observe({
    method: 'externalAgentConfig/import/completed',
    atIso: '2026-07-03T00:00:00.990Z',
    params: {},
  })
  const protocolAlertSnapshot = diagnostics.snapshot()
  assert.equal(protocolAlertSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(protocolAlertSnapshot.recentProtocolAlerts.map((item) => item.method), [
    'externalAgentConfig/import/completed',
    'fs/changed',
    'configWarning',
    'warning',
  ])
  assert.equal(protocolAlertSnapshot.recentProtocolAlerts[1]?.changedPathCount, 2)
  assert.equal(protocolAlertSnapshot.recentProtocolAlerts[1]?.hasPath, true)
  assert.equal(protocolAlertSnapshot.recentProtocolAlerts[2]?.hasPath, true)
  assert.equal(protocolAlertSnapshot.recentProtocolAlerts[2]?.summary, 'invalid config value')
  assert.equal(JSON.stringify(protocolAlertSnapshot.recentProtocolAlerts).includes('C:\\'), false)
  assert.equal(JSON.stringify(protocolAlertSnapshot.recentProtocolAlerts).includes('secret\\file'), false)

  diagnostics.observe({
    method: 'thread/realtime/transcript/delta',
    atIso: '2026-07-03T00:00:01.000Z',
    threadId: 'thread-a',
    params: {
      threadId: 'thread-a',
      role: 'user',
      delta: 'secret transcript delta',
    },
  })
  diagnostics.observe({
    method: 'thread/realtime/transcript/done',
    atIso: '2026-07-03T00:00:01.100Z',
    params: {
      threadId: 'thread-a',
      role: 'assistant',
      text: 'secret final transcript',
    },
  })
  diagnostics.observe({
    method: 'thread/realtime/outputAudio/delta',
    atIso: '2026-07-03T00:00:01.200Z',
    params: {
      threadId: 'thread-a',
      audio: {
        data: 'base64-secret-audio',
        sampleRate: 24000,
        numChannels: 1,
        samplesPerChannel: 320,
        itemId: 'item-audio',
      },
    },
  })
  diagnostics.observe({
    method: 'thread/realtime/sdp',
    atIso: '2026-07-03T00:00:01.300Z',
    params: {
      threadId: 'thread-a',
      sdp: 'v=0\r\nsecret-sdp-offer',
    },
  })
  diagnostics.observe({
    method: 'thread/realtime/error',
    atIso: '2026-07-03T00:00:01.400Z',
    params: {
      threadId: 'thread-a',
      code: 'realtime_failed',
      message: 'safe error summary',
    },
  })
  const realtimeSnapshot = diagnostics.snapshot()
  assert.equal(realtimeSnapshot.unknownNotificationCount, 0)
  assert.deepEqual(realtimeSnapshot.recentRealtimeNotifications.map((item) => item.method), [
    'thread/realtime/error',
    'thread/realtime/sdp',
    'thread/realtime/outputAudio/delta',
    'thread/realtime/transcript/done',
  ])
  assert.equal(realtimeSnapshot.recentRealtimeNotifications[1]?.byteCount, Buffer.byteLength('v=0\r\nsecret-sdp-offer', 'utf8'))
  assert.equal(realtimeSnapshot.recentRealtimeNotifications[2]?.itemId, 'item-audio')
  assert.equal(realtimeSnapshot.recentRealtimeNotifications[2]?.byteCount, Buffer.byteLength('base64-secret-audio', 'utf8'))
  assert.equal(realtimeSnapshot.recentRealtimeNotifications[3]?.byteCount, Buffer.byteLength('secret final transcript', 'utf8'))
  const serializedRealtimeSnapshot = JSON.stringify(realtimeSnapshot.recentRealtimeNotifications)
  assert.equal(serializedRealtimeSnapshot.includes('secret transcript'), false)
  assert.equal(serializedRealtimeSnapshot.includes('base64-secret-audio'), false)
  assert.equal(serializedRealtimeSnapshot.includes('secret-sdp-offer'), false)

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
  assert.equal(snapshot.unknownNotificationCount, 2)
  assert.deepEqual(snapshot.recentUnknownNotifications.map((item) => item.method), [
    'hook/migration/completed',
    'plugin/marketplace/changed',
  ])
  assert.equal(snapshot.recentUnknownNotifications[0]?.count, 1)
  assert.equal(snapshot.recentUnknownNotifications[1]?.count, 1)

  diagnostics.clear()
  assert.equal(diagnostics.snapshot().unknownNotificationCount, 0)
  assert.equal(diagnostics.snapshot().recentModelNotifications.length, 0)
  assert.equal(diagnostics.snapshot().recentWindowsSandboxNotifications.length, 0)
  assert.equal(diagnostics.snapshot().recentHookNotifications.length, 0)
  assert.equal(diagnostics.snapshot().recentGuardianReviewNotifications.length, 0)
  assert.equal(diagnostics.snapshot().recentProtocolAlerts.length, 0)
  assert.equal(diagnostics.snapshot().recentRealtimeNotifications.length, 0)
}

async function smokeAppServerHookDiagnostics(): Promise<void> {
  const normalized = normalizeAppServerHookDiagnostics({
    data: [
      {
        cwd: 'E:\\secret\\repo',
        warnings: ['merge hooks.json and config.toml'],
        errors: [{ message: 'bad hook' }],
        hooks: [
          {
            key: 'hidden-key',
            eventName: 'preToolUse',
            handlerType: 'command',
            matcher: 'Bash',
            command: 'C:\\secret\\hook.ps1',
            timeoutSec: 30,
            statusMessage: 'Checking',
            sourcePath: 'C:\\secret\\.codex\\hooks.json',
            source: 'project',
            pluginId: null,
            displayOrder: 1,
            enabled: true,
            isManaged: false,
            currentHash: 'secret-hash',
            trustStatus: 'untrusted',
          },
          {
            key: 'hidden-key-2',
            eventName: 'stop',
            handlerType: 'prompt',
            matcher: null,
            sourcePath: 'C:\\secret\\.codex\\hooks.json',
            source: 'plugin',
            pluginId: 'plugin-a',
            enabled: false,
            isManaged: true,
            currentHash: 'secret-hash-2',
            trustStatus: 'managed',
          },
        ],
      },
    ],
  }, '2026-07-04T00:00:00.000Z')
  assert.equal(normalized.available, true)
  assert.equal(normalized.cwdCount, 1)
  assert.equal(normalized.hookCount, 2)
  assert.equal(normalized.enabledCount, 1)
  assert.equal(normalized.disabledCount, 1)
  assert.equal(normalized.managedCount, 1)
  assert.equal(normalized.untrustedCount, 1)
  assert.equal(normalized.warningCount, 1)
  assert.equal(normalized.errorCount, 1)
  assert.deepEqual(normalized.byEvent, { preToolUse: 1, stop: 1 })
  assert.deepEqual(normalized.bySource, { project: 1, plugin: 1 })
  assert.deepEqual(normalized.byTrust, { untrusted: 1, managed: 1 })
  assert.deepEqual(normalized.recentHooks, [
    {
      eventName: 'preToolUse',
      handlerType: 'command',
      source: 'project',
      trustStatus: 'untrusted',
      enabled: true,
      isManaged: false,
      hasMatcher: true,
      hasStatusMessage: true,
      pluginId: '',
    },
    {
      eventName: 'stop',
      handlerType: 'prompt',
      source: 'plugin',
      trustStatus: 'managed',
      enabled: false,
      isManaged: true,
      hasMatcher: false,
      hasStatusMessage: false,
      pluginId: 'plugin-a',
    },
  ])
  const serialized = JSON.stringify(normalized)
  assert.equal(serialized.includes('secret'), false)
  assert.equal(serialized.includes('hook.ps1'), false)
  assert.equal(serialized.includes('hidden-key'), false)

  const unavailable = createAppServerHookDiagnosticsUnavailable(
    new Error('x'.repeat(240)),
    '2026-07-04T00:00:01.000Z',
  )
  assert.equal(unavailable.available, false)
  assert.equal(unavailable.error.length, 160)

  let nowMs = 1_000
  let calls = 0
  const cache = new AppServerHookDiagnosticsCache({
    ttlMs: 100,
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
  })
  const first = await cache.read(async () => {
    calls += 1
    return { data: [{ hooks: [{ eventName: 'preToolUse', handlerType: 'command', source: 'project', trustStatus: 'trusted', enabled: true }] }] }
  })
  const cached = await cache.read(async () => {
    calls += 1
    return { data: [] }
  })
  assert.equal(first.hookCount, 1)
  assert.equal(cached.hookCount, 1)
  assert.equal(calls, 1)

  nowMs += 101
  const refreshed = await cache.read(async () => {
    calls += 1
    return { data: [] }
  })
  assert.equal(refreshed.hookCount, 0)
  assert.equal(calls, 2)

  cache.clear()
  const failed = await cache.read(async () => {
    calls += 1
    throw new Error('hooks/list failed')
  })
  assert.equal(failed.available, false)
  assert.equal(failed.error, 'hooks/list failed')
  assert.equal(calls, 3)
}

async function smokeWindowsSandboxReadinessDiagnostics(): Promise<void> {
  assert.deepEqual(normalizeWindowsSandboxReadiness(
    { status: 'ready' },
    '2026-07-04T00:00:00.000Z',
  ), {
    status: 'ready',
    available: true,
    checkedAtIso: '2026-07-04T00:00:00.000Z',
    source: 'app-server',
    error: '',
  })
  assert.deepEqual(normalizeWindowsSandboxReadiness(
    { status: 'notConfigured' },
    '2026-07-04T00:00:01.000Z',
  ).status, 'notConfigured')
  assert.deepEqual(normalizeWindowsSandboxReadiness(
    { status: 'updateRequired' },
    '2026-07-04T00:00:02.000Z',
  ).status, 'updateRequired')

  const unknown = normalizeWindowsSandboxReadiness(
    { status: 'needsElevatedSetup' },
    '2026-07-04T00:00:03.000Z',
  )
  assert.equal(unknown.status, 'unavailable')
  assert.equal(unknown.available, false)
  assert.equal(unknown.source, 'error')
  assert.match(unknown.error, /Unknown Windows sandbox readiness status/)

  const longError = createWindowsSandboxReadinessUnavailable(
    new Error('x'.repeat(240)),
    '2026-07-04T00:00:04.000Z',
  )
  assert.equal(longError.status, 'unavailable')
  assert.equal(longError.available, false)
  assert.equal(longError.error.length, 160)

  const unsupported = createWindowsSandboxReadinessUnsupported('2026-07-04T00:00:05.000Z')
  assert.equal(unsupported.status, 'unsupported')
  assert.equal(unsupported.available, false)
  assert.equal(unsupported.source, 'platform')

  let nowMs = 1_000
  const cache = new WindowsSandboxReadinessCache({
    ttlMs: 100,
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
  })
  let calls = 0
  const first = await cache.read(async () => {
    calls += 1
    return { status: 'ready' }
  })
  const cached = await cache.read(async () => {
    calls += 1
    return { status: 'updateRequired' }
  })
  assert.equal(first.status, 'ready')
  assert.equal(cached.status, 'ready')
  assert.equal(calls, 1)

  nowMs += 101
  const refreshed = await cache.read(async () => {
    calls += 1
    return { status: 'updateRequired' }
  })
  assert.equal(refreshed.status, 'updateRequired')
  assert.equal(calls, 2)

  cache.clear()
  const failed = await cache.read(async () => {
    calls += 1
    throw new Error('readiness rpc failed')
  })
  assert.equal(failed.status, 'unavailable')
  assert.equal(failed.error, 'readiness rpc failed')
  assert.equal(calls, 3)
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

async function smokeAppServerThreadListAugment(): Promise<void> {
  let nowMs = 1_000
  const augmenter = new AppServerThreadListAugmenter({
    ttlMs: 100,
    maxReads: 2,
    maxCacheEntries: 10,
    nowMs: () => nowMs,
  })

  const baseResult = { data: [{ id: 'existing' }], marker: true }
  const calls: string[] = []
  const readThreadById = async (threadId: string): Promise<unknown> => {
    calls.push(threadId)
    if (threadId === 'missing') return { thread: { id: 'other' } }
    if (threadId === 'throws') throw new Error('missing thread')
    return { thread: { id: threadId, title: `Title ${threadId}` } }
  }
  const readPinnedThreadIds = async (): Promise<string[]> => [' existing ', 'pin-a', 'missing', 'pin-b', 'throws']

  assert.equal(await augmenter.augmentThreadListRpcResult({
    params: { archived: false },
    result: baseResult,
    readPinnedThreadIds,
    readThreadById,
  }), baseResult)
  assert.equal(calls.length, 0)

  assert.equal(await augmenter.augmentThreadListRpcResult({
    params: { archived: true, cursor: 'next-page' },
    result: baseResult,
    readPinnedThreadIds,
    readThreadById,
  }), baseResult)
  assert.equal(calls.length, 0)

  const augmented = await augmenter.augmentThreadListRpcResult({
    params: { archived: true },
    result: baseResult,
    readPinnedThreadIds,
    readThreadById,
  }) as { data: Array<{ id: string; title?: string }>; marker: boolean }
  assert.deepEqual(calls, ['pin-a', 'missing'])
  assert.deepEqual(augmented.data.map((thread) => thread.id), ['existing', 'pin-a'])
  assert.equal(augmented.marker, true)

  const cached = await augmenter.augmentThreadListRpcResult({
    params: { archived: true },
    result: baseResult,
    readPinnedThreadIds,
    readThreadById,
  }) as { data: Array<{ id: string; title?: string }> }
  assert.deepEqual(calls, ['pin-a', 'missing', 'pin-b', 'throws'])
  assert.deepEqual(cached.data.map((thread) => thread.id), ['existing', 'pin-a', 'pin-b'])

  nowMs += 101
  await augmenter.augmentThreadListRpcResult({
    params: { archived: true },
    result: baseResult,
    readPinnedThreadIds,
    readThreadById,
  })
  assert.deepEqual(calls, ['pin-a', 'missing', 'pin-b', 'throws', 'pin-a', 'missing'])
}

function smokeAppServerThreadReadCache(): void {
  assert.equal(readIsoTimestampMs('2026-01-01T00:00:00.000Z'), Date.parse('2026-01-01T00:00:00.000Z'))
  assert.equal(readIsoTimestampMs('not-a-date'), 0)
  assert.equal(readIsoTimestampMs(null), 0)

  const constructedThreadRead = createCachedThreadRead({
    thread: {
      id: 'thread-a',
      updatedAt: 1767225600,
      path: 'C:/sessions/thread-a.jsonl',
      activeTurnId: 'turn-a',
      status: 'running',
    },
  }, () => '2026-01-01T00:00:05.000Z')
  assert.deepEqual(constructedThreadRead, {
    threadRead: {
      thread: {
        id: 'thread-a',
        updatedAt: 1767225600,
        path: 'C:/sessions/thread-a.jsonl',
        activeTurnId: 'turn-a',
        status: 'running',
      },
    },
    inProgress: true,
    activeTurnId: 'turn-a',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    sessionPath: 'C:/sessions/thread-a.jsonl',
    cachedAtIso: '2026-01-01T00:00:05.000Z',
  })

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
    assert.equal(getOpenAiTranscribeResponseFormat(), 'json')
    assert.equal(getTranscribeRequestBodyLimitBytes(), 25_000_000)
    assert.deepEqual(getTranscriptionProxyConfigSnapshot(), {
      provider: 'chatgpt',
      officialApiConfigured: false,
      model: 'gpt-4o-transcribe',
      responseFormat: 'json',
      requestBodyLimitBytes: 25_000_000,
      requestBodyLimitMiB: 23.8,
      endpoint: {
        isDefault: true,
        configured: false,
        valid: true,
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
        configured: true,
        valid: true,
        host: 'audio.example.test',
        path: '/v1/audio/transcriptions',
      },
    })
  })

  withTranscriptionEnv({
    OPENAI_API_KEY: undefined,
    OPENAI_TRANSCRIBE_MODEL: undefined,
    OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    OPENAI_TRANSCRIBE_URL: undefined,
    CX_CODEX_OPENAI_API_KEY: 'sk-prefixed',
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-transcribe-diarize',
    CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_URL: undefined,
    CODEXUI_OPENAI_API_KEY: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MODEL: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_URL: undefined,
  }, () => {
    assert.equal(getOpenAiTranscribeModel(), 'gpt-4o-transcribe-diarize')
    assert.equal(getOpenAiTranscribeResponseFormat(), 'diarized_json')
    assert.deepEqual(getTranscriptionProxyConfigSnapshot(), {
      provider: 'openai',
      officialApiConfigured: true,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      requestBodyLimitBytes: 25_000_000,
      requestBodyLimitMiB: 23.8,
      endpoint: {
        isDefault: true,
        configured: false,
        valid: true,
        host: 'api.openai.com',
        path: '/v1/audio/transcriptions',
      },
    })
  })

  withTranscriptionEnv({
    OPENAI_API_KEY: undefined,
    OPENAI_TRANSCRIBE_MODEL: undefined,
    OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    OPENAI_TRANSCRIBE_URL: undefined,
    CX_CODEX_OPENAI_API_KEY: 'sk-prefixed',
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_URL: 'file:///tmp/audio',
    CODEXUI_OPENAI_API_KEY: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MODEL: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    CODEXUI_OPENAI_TRANSCRIBE_URL: undefined,
  }, () => {
    assert.deepEqual(getTranscriptionProxyConfigSnapshot().endpoint, {
      isDefault: true,
      configured: true,
      valid: false,
      host: 'api.openai.com',
      path: '/v1/audio/transcriptions',
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
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="chunking_strategy"\r\n\r\n' +
      'manual\r\n' +
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
    assert.doesNotMatch(prepared, /name="chunking_strategy"/)
    assert.doesNotMatch(prepared, /name="model"\r\n\r\nwhisper-1\r\n/)
    assert.doesNotMatch(prepared, /name="response_format"\r\n\r\ntext\r\n/)
  })

  withTranscriptionEnv({
    OPENAI_TRANSCRIBE_MODEL: undefined,
    CX_CODEX_OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-transcribe-diarize',
    CODEXUI_OPENAI_TRANSCRIBE_MODEL: undefined,
  }, () => {
    const prepared = prepareOpenAiTranscribeBody(
      body,
      `multipart/form-data; boundary=${boundary}`,
    ).toString('utf8')
    assert.match(prepared, /name="model"\r\n\r\ngpt-4o-transcribe-diarize\r\n/)
    assert.match(prepared, /name="response_format"\r\n\r\ndiarized_json\r\n/)
    assert.match(prepared, /name="chunking_strategy"\r\n\r\nauto\r\n/)
    assert.doesNotMatch(prepared, /name="response_format"\r\n\r\njson\r\n/)
    assert.doesNotMatch(prepared, /name="response_format"\r\n\r\ntext\r\n/)
    assert.doesNotMatch(prepared, /name="chunking_strategy"\r\n\r\nmanual\r\n/)
  })
}

async function smokeTranscriptionRoute(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-transcription-route-'))
  const previousCodexHome = process.env.CODEX_HOME
  try {
    process.env.CODEX_HOME = tempDir
    await withTranscriptionEnvAsync({
      OPENAI_API_KEY: undefined,
      OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
      CX_CODEX_OPENAI_API_KEY: undefined,
      CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
      CODEXUI_OPENAI_API_KEY: undefined,
      CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES: undefined,
    }, async () => {
      const missingAuth = createTranscriptionRouteTestResponse()
      await handleTranscriptionRoute(
        createTranscriptionRouteTestRequest(Buffer.from('audio'), 'audio/wav'),
        missingAuth.response as never,
      )
      assert.equal(missingAuth.response.statusCode, 401)
      assert.equal(missingAuth.headers.get('Content-Type'), 'application/json; charset=utf-8')
      assert.deepEqual(JSON.parse(missingAuth.body), { error: 'No auth token available for transcription' })
    })

    await withTranscriptionEnvAsync({
      OPENAI_API_KEY: undefined,
      CX_CODEX_OPENAI_API_KEY: undefined,
      CODEXUI_OPENAI_API_KEY: undefined,
      CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES: '3',
    }, async () => {
      const tooLarge = createTranscriptionRouteTestResponse()
      await handleTranscriptionRoute(
        createTranscriptionRouteTestRequest(Buffer.from('too-large'), 'audio/wav'),
        tooLarge.response as never,
      )
      assert.equal(tooLarge.response.statusCode, 413)
      assert.match(tooLarge.body, /Maximum request size is 3 bytes/u)
    })
  } finally {
    if (typeof previousCodexHome === 'string') {
      process.env.CODEX_HOME = previousCodexHome
    } else {
      delete process.env.CODEX_HOME
    }
    await rm(tempDir, { recursive: true, force: true })
  }
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

async function smokeAppServerRollbackGit(): Promise<void> {
  assert.equal(normalizeCommitMessage(null), '')
  assert.equal(normalizeCommitMessage(' first line \r\n\r\n second line '), 'first line\nsecond line')
  assert.equal(normalizeCommitMessage(`x${'y'.repeat(2500)}`).length, 2000)

  const tempDir = await mkdtemp(join(tmpdir(), 'cx-codex-rollback-git-'))
  try {
    assert.equal(getRollbackGitDirForCwd(tempDir), join(tempDir, '.codex', 'rollbacks', '.git'))

    await ensureLocalCodexGitignoreHasRollbacks(tempDir)
    await ensureLocalCodexGitignoreHasRollbacks(tempDir)
    assert.equal(await readFile(join(tempDir, '.codex', '.gitignore'), 'utf8'), 'rollbacks/\n')

    const sourceRepo = join(tempDir, 'source')
    await mkdir(sourceRepo, { recursive: true })
    await runCommand('git', ['init'], { cwd: sourceRepo })
    await ensureRepoHasInitialCommit(sourceRepo)
    assert.equal(await readFile(join(sourceRepo, 'AGENTS.md'), 'utf8'), '')

    const worktree = join(tempDir, 'worktree')
    await mkdir(worktree, { recursive: true })
    assert.equal(await ensureRollbackGitRepo(worktree), getRollbackGitDirForCwd(worktree))
    assert.equal(await hasRollbackGitWorkingTreeChanges(worktree), true)

    await writeFile(join(worktree, 'note.txt'), 'one\n', 'utf8')
    await runRollbackGit(worktree, ['add', '-A'])
    await runRollbackGit(worktree, ['commit', '-m', 'First line\n\nsecond line'])
    assert.equal(await runRollbackGitWithOutput(worktree, ['status', '--porcelain']), '')

    const commitSha = await findRollbackCommitByExactMessage(worktree, ' First line \n second line ')
    assert.match(commitSha, /^[0-9a-f]{40}$/u)

    await writeFile(join(worktree, 'note.txt'), 'two\n', 'utf8')
    assert.equal(await hasRollbackGitWorkingTreeChanges(worktree), true)
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

async function smokeFileUploadRoute(): Promise<void> {
  const uploadCalls: string[] = []
  let nextError: unknown = null
  const dependencies = {
    handleMultipartFileUpload: async (req: { method?: string }) => {
      uploadCalls.push(req.method ?? '')
      if (nextError) throw nextError
      return { path: 'C:\\tmp\\upload.txt' }
    },
    getErrorMessage: (error: unknown, fallback: string) => getErrorMessage(error, fallback),
  }

  const success = createRouteTestResponse()
  assert.equal(await handleFileUploadRoute(
    { method: 'POST' } as never,
    success.response as never,
    new URL('http://127.0.0.1/codex-api/upload-file'),
    dependencies,
  ), true)
  assert.deepEqual(uploadCalls, ['POST'])
  assert.deepEqual(JSON.parse(success.body), { path: 'C:\\tmp\\upload.txt' })

  nextError = new FileUploadError('No file in request', 400)
  const badUpload = createRouteTestResponse()
  assert.equal(await handleFileUploadRoute(
    { method: 'POST' } as never,
    badUpload.response as never,
    new URL('http://127.0.0.1/codex-api/upload-file'),
    dependencies,
  ), true)
  assert.equal(badUpload.response.statusCode, 400)
  assert.deepEqual(JSON.parse(badUpload.body), { error: 'No file in request' })

  nextError = new Error('disk denied')
  const genericFailure = createRouteTestResponse()
  assert.equal(await handleFileUploadRoute(
    { method: 'POST' } as never,
    genericFailure.response as never,
    new URL('http://127.0.0.1/codex-api/upload-file'),
    dependencies,
  ), true)
  assert.equal(genericFailure.response.statusCode, 500)
  assert.deepEqual(JSON.parse(genericFailure.body), { error: 'disk denied' })

  assert.equal(await handleFileUploadRoute(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/upload-file'),
    dependencies,
  ), false)
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

async function smokeComposerFileSearchRoutes(): Promise<void> {
  const bodies: unknown[] = [
    { cwd: ' C:\\work ', query: ' app ', limit: 3 },
    { cwd: '', query: 'app' },
    { cwd: 'C:\\work', query: 'fail' },
  ]
  const searchCalls: Array<{ cwd: string; query: string; limit: unknown }> = []
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    searchComposerFiles: async (args: { cwd: string; query: string; limit: unknown }) => {
      searchCalls.push(args)
      if (!args.cwd) throw new ComposerFileSearchError('Missing cwd', 400)
      if (args.query === 'fail') throw new Error('backend failed')
      return [{ path: 'src/App.vue' }]
    },
    getErrorMessage: (error: unknown, fallback: string) => getErrorMessage(error, fallback),
  }

  const success = createRouteTestResponse()
  assert.equal(await handleComposerFileSearchRoutes(
    { method: 'POST' } as never,
    success.response as never,
    new URL('http://127.0.0.1/codex-api/composer-file-search'),
    dependencies,
  ), true)
  assert.deepEqual(searchCalls[0], { cwd: ' C:\\work ', query: 'app', limit: 3 })
  assert.deepEqual(JSON.parse(success.body), { data: [{ path: 'src/App.vue' }] })

  const missingCwd = createRouteTestResponse()
  assert.equal(await handleComposerFileSearchRoutes(
    { method: 'POST' } as never,
    missingCwd.response as never,
    new URL('http://127.0.0.1/codex-api/composer-file-search'),
    dependencies,
  ), true)
  assert.equal(missingCwd.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingCwd.body), { error: 'Missing cwd' })

  const genericFailure = createRouteTestResponse()
  assert.equal(await handleComposerFileSearchRoutes(
    { method: 'POST' } as never,
    genericFailure.response as never,
    new URL('http://127.0.0.1/codex-api/composer-file-search'),
    dependencies,
  ), true)
  assert.equal(genericFailure.response.statusCode, 500)
  assert.deepEqual(JSON.parse(genericFailure.body), { error: 'backend failed' })

  assert.equal(await handleComposerFileSearchRoutes(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/composer-file-search'),
    dependencies,
  ), false)
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

async function smokeGithubTrendingRoutes(): Promise<void> {
  const trendingItem = {
    id: 1,
    fullName: 'owner/repo',
    url: 'https://github.com/owner/repo',
    description: 'Build tools',
    language: 'TypeScript',
    stars: 123,
  }
  const bodies: unknown[] = [
    { descriptions: ['hello world', 7, '中文说明', 'extra 1', 'extra 2', 'extra 3', 'extra 4', 'extra 5', 'extra 6', 'extra 7', 'extra 8'] },
    { descriptions: ['fallback text'] },
  ]
  const fetchCalls: Array<{ since: GithubTrendingSince; limit: number }> = []
  const translateCalls: string[][] = []
  let shouldFailFetch = false
  let shouldFailTranslate = false
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    fetchGithubTrending: async (since: GithubTrendingSince, limit: number) => {
      fetchCalls.push({ since, limit })
      if (shouldFailFetch) throw new Error('github unavailable')
      return [trendingItem]
    },
    translateGithubDescriptionsToChinese: async (descriptions: string[]) => {
      translateCalls.push(descriptions)
      if (shouldFailTranslate) throw new Error('translate unavailable')
      return descriptions.map((description) => `zh:${description}`)
    },
    getErrorMessage: (error: unknown, fallback: string) => getErrorMessage(error, fallback),
  }

  const trending = createRouteTestResponse()
  assert.equal(await handleGithubTrendingRoutes(
    { method: 'GET' } as never,
    trending.response as never,
    new URL('http://127.0.0.1/codex-api/github-trending?since=weekly&limit=3'),
    dependencies,
  ), true)
  assert.deepEqual(fetchCalls, [{ since: 'weekly', limit: 3 }])
  assert.deepEqual(JSON.parse(trending.body), { data: [trendingItem] })

  shouldFailFetch = true
  const trendingFailure = createRouteTestResponse()
  assert.equal(await handleGithubTrendingRoutes(
    { method: 'GET' } as never,
    trendingFailure.response as never,
    new URL('http://127.0.0.1/codex-api/github-trending?since=bad&limit=99'),
    dependencies,
  ), true)
  assert.equal(trendingFailure.response.statusCode, 502)
  assert.deepEqual(fetchCalls[1], { since: 'daily', limit: 10 })
  assert.deepEqual(JSON.parse(trendingFailure.body), { error: 'github unavailable' })

  const translation = createRouteTestResponse()
  assert.equal(await handleGithubTrendingRoutes(
    { method: 'POST' } as never,
    translation.response as never,
    new URL('http://127.0.0.1/codex-api/github-trending/translate'),
    dependencies,
  ), true)
  assert.deepEqual(translateCalls[0], ['hello world', '', '中文说明', 'extra 1', 'extra 2', 'extra 3', 'extra 4', 'extra 5', 'extra 6', 'extra 7'])
  assert.deepEqual(JSON.parse(translation.body), {
    data: {
      translations: ['zh:hello world', 'zh:', 'zh:中文说明', 'zh:extra 1', 'zh:extra 2', 'zh:extra 3', 'zh:extra 4', 'zh:extra 5', 'zh:extra 6', 'zh:extra 7'],
    },
  })

  shouldFailTranslate = true
  const translationFallback = createRouteTestResponse()
  assert.equal(await handleGithubTrendingRoutes(
    { method: 'POST' } as never,
    translationFallback.response as never,
    new URL('http://127.0.0.1/codex-api/github-trending/translate'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(translationFallback.body), { data: { translations: ['fallback text'] } })

  assert.equal(await handleGithubTrendingRoutes(
    { method: 'PUT' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/github-trending'),
    dependencies,
  ), false)
}

async function smokeWorktreeRoutes(): Promise<void> {
  const sourceCwd = join(tmpdir(), 'cx-codex-source')
  const notDirectory = join(tmpdir(), 'cx-codex-not-directory')
  const missingSource = join(tmpdir(), 'cx-codex-missing-source')
  const cwd = join(tmpdir(), 'cx-codex-project')
  const gitRoot = join(tmpdir(), 'repo')
  const worktreesRoot = join(tmpdir(), 'cx-codex-worktrees')
  const existingDirs = new Set([sourceCwd, cwd, join(worktreesRoot, 'used')])
  const filePaths = new Set([notDirectory])
  const bodies: unknown[] = [
    { sourceCwd: ' ' },
    { sourceCwd: notDirectory },
    { sourceCwd: missingSource },
    { sourceCwd },
    { cwd, message: 'Commit rollback' },
    { cwd, message: 'Commit rollback' },
    { cwd, message: 'Missing rollback' },
    { cwd, message: 'Root rollback' },
    { cwd, message: 'Apply rollback' },
  ]
  const mkdirCalls: string[] = []
  const commandCalls: Array<{ command: string; args: string[]; cwd?: string }> = []
  const rollbackCommands: string[][] = []
  const ensureRollbackCalls: string[] = []
  const randomIds = ['used', 'free']
  const rollbackOutputQueue = [' M file.txt\n', 'file.txt\n']
  const findCommitQueue = ['', 'commit-root', 'commit-ok']
  const captureRollbackQueue = [new Error('no parent'), 'parent-ok']
  let revParseCalls = 0
  let worktreeAddAttempts = 0
  let ensuredInitialCommit = ''
  let failEnsureRollback = false

  const dependencies: WorktreeRoutesDependencies = {
    readJsonBody: async () => bodies.shift(),
    stat: async (path) => {
      if (existingDirs.has(path)) return { isDirectory: () => true }
      if (filePaths.has(path)) return { isDirectory: () => false }
      throw new Error(`missing path: ${path}`)
    },
    mkdir: async (path) => {
      mkdirCalls.push(path)
      existingDirs.add(path)
    },
    randomWorktreeId: () => {
      const value = randomIds.shift()
      if (!value) throw new Error('missing random worktree id')
      return value
    },
    getCodexWorktreesDir: () => worktreesRoot,
    runCommandCapture: async (command, args, options) => {
      commandCalls.push({ command, args, cwd: options?.cwd })
      revParseCalls += 1
      if (revParseCalls === 1) throw new Error('fatal: not a git repository')
      return gitRoot
    },
    runCommand: async (command, args, options) => {
      commandCalls.push({ command, args, cwd: options?.cwd })
      if (args[0] === 'worktree') {
        worktreeAddAttempts += 1
        if (worktreeAddAttempts === 1) throw new Error('invalid reference: HEAD')
      }
    },
    ensureRepoHasInitialCommit: async (repoRoot) => {
      ensuredInitialCommit = repoRoot
    },
    ensureRollbackGitRepo: async (repoCwd) => {
      ensureRollbackCalls.push(repoCwd)
      if (failEnsureRollback) throw new Error('rollback unavailable')
      return join(repoCwd, '.codex', 'rollbacks', '.git')
    },
    runRollbackGitWithOutput: async (_repoCwd, args) => {
      return rollbackOutputQueue.shift() ?? ''
    },
    runRollbackGit: async (_repoCwd, args) => {
      rollbackCommands.push(args)
    },
    findRollbackCommitByExactMessage: async () => {
      return findCommitQueue.shift() ?? ''
    },
    runRollbackGitCapture: async () => {
      const value = captureRollbackQueue.shift()
      if (value instanceof Error) throw value
      return value ?? ''
    },
    hasRollbackGitWorkingTreeChanges: async () => true,
  }

  const missingSourceCwd = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    missingSourceCwd.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/create'),
    dependencies,
  ), true)
  assert.equal(missingSourceCwd.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingSourceCwd.body), { error: 'Missing sourceCwd' })

  const sourceNotDirectory = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    sourceNotDirectory.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/create'),
    dependencies,
  ), true)
  assert.equal(sourceNotDirectory.response.statusCode, 400)
  assert.deepEqual(JSON.parse(sourceNotDirectory.body), { error: 'sourceCwd is not a directory' })

  const sourceMissing = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    sourceMissing.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/create'),
    dependencies,
  ), true)
  assert.equal(sourceMissing.response.statusCode, 404)
  assert.deepEqual(JSON.parse(sourceMissing.body), { error: 'sourceCwd does not exist' })

  const createSuccess = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    createSuccess.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/create'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(createSuccess.body), {
    data: {
      cwd: join(worktreesRoot, 'free', 'repo'),
      branch: 'codex/free',
      gitRoot,
    },
  })
  assert.equal(ensuredInitialCommit, gitRoot)
  assert.equal(worktreeAddAttempts, 2)
  assert.deepEqual(mkdirCalls, [worktreesRoot, join(worktreesRoot, 'free')])
  assert.deepEqual(commandCalls.map((call) => call.args.join(' ')), [
    'rev-parse --show-toplevel',
    'init',
    'rev-parse --show-toplevel',
    `worktree add -b codex/free ${join(worktreesRoot, 'free', 'repo')} HEAD`,
    `worktree add -b codex/free ${join(worktreesRoot, 'free', 'repo')} HEAD`,
  ])

  const autoCommit = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    autoCommit.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/auto-commit'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(autoCommit.body), { data: { committed: true } })
  assert.deepEqual(rollbackCommands.slice(0, 2), [
    ['add', '-A'],
    ['commit', '-m', 'Commit rollback'],
  ])

  failEnsureRollback = true
  const autoCommitFailure = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    autoCommitFailure.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/auto-commit'),
    dependencies,
  ), true)
  assert.equal(autoCommitFailure.response.statusCode, 500)
  assert.deepEqual(JSON.parse(autoCommitFailure.body), { error: 'rollback unavailable' })
  failEnsureRollback = false

  const rollbackMissingCommit = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    rollbackMissingCommit.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/rollback-to-message'),
    dependencies,
  ), true)
  assert.equal(rollbackMissingCommit.response.statusCode, 404)
  assert.deepEqual(JSON.parse(rollbackMissingCommit.body), { error: 'No matching commit found for this user message' })

  const rollbackRootCommit = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    rollbackRootCommit.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/rollback-to-message'),
    dependencies,
  ), true)
  assert.equal(rollbackRootCommit.response.statusCode, 409)
  assert.deepEqual(JSON.parse(rollbackRootCommit.body), { error: 'Cannot rollback: matched commit has no parent commit' })

  const rollbackSuccess = createRouteTestResponse()
  assert.equal(await handleWorktreeRoutes(
    { method: 'POST' } as never,
    rollbackSuccess.response as never,
    new URL('http://127.0.0.1/codex-api/worktree/rollback-to-message'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(rollbackSuccess.body), {
    data: {
      reset: true,
      commitSha: 'commit-ok',
      resetTargetSha: 'parent-ok',
      stashed: true,
    },
  })
  const rollbackTail = rollbackCommands.slice(-2)
  const stashMessage = rollbackTail[0]?.[4] ?? ''
  assert.deepEqual(rollbackTail, [
    ['stash', 'push', '-u', '-m', stashMessage],
    ['reset', '--hard', 'parent-ok'],
  ])
  assert.equal(stashMessage.startsWith('codex-auto-stash-before-rollback-'), true)
  assert.equal(ensureRollbackCalls.length, 5)

  assert.equal(await handleWorktreeRoutes(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/worktree/create'),
    dependencies,
  ), false)
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

  assert.equal(await resolveThreadTokenUsage(' ', {
    getCachedTokenUsage: () => {
      throw new Error('empty thread id should short-circuit')
    },
    getCachedThreadRead: () => null,
  }), null)

  assert.equal(await resolveThreadTokenUsage(' thread-a ', {
    getCachedTokenUsage: (threadId) => {
      assert.equal(threadId, 'thread-a')
      return usage
    },
    getCachedThreadRead: () => {
      throw new Error('thread read cache should not be consulted when token cache exists')
    },
  }), usage)

  const threadReadTokenUsage = normalizeThreadTokenUsage({
    total: usage.total,
    last: { ...usage.last, totalTokens: 333 },
  })
  assert.ok(threadReadTokenUsage)
  assert.equal((await resolveThreadTokenUsage('thread-a', {
    getCachedTokenUsage: () => null,
    getCachedThreadRead: () => ({
      threadRead: { tokenUsage: threadReadTokenUsage },
      inProgress: false,
      activeTurnId: '',
      updatedAtIso: '',
      sessionPath: 'C:/sessions/thread-a.jsonl',
      cachedAtIso: '2026-01-01T00:00:00.000Z',
    }),
    readSessionLogTokenUsage: async () => {
      throw new Error('session log should not be consulted when thread read has token usage')
    },
  }))?.last.totalTokens, 333)

  const sessionLogTokenUsage = normalizeThreadTokenUsage({
    total: usage.total,
    last: { ...usage.last, totalTokens: 444 },
  })
  assert.ok(sessionLogTokenUsage)
  const requestedSessionPaths: string[] = []
  assert.equal((await resolveThreadTokenUsage('thread-a', {
    getCachedTokenUsage: () => null,
    getCachedThreadRead: () => ({
      threadRead: { thread: { id: 'thread-a' } },
      inProgress: false,
      activeTurnId: '',
      updatedAtIso: '',
      sessionPath: ' C:/sessions/thread-a.jsonl ',
      cachedAtIso: '2026-01-01T00:00:00.000Z',
    }),
    readSessionLogTokenUsage: async (sessionPath) => {
      requestedSessionPaths.push(sessionPath)
      return sessionLogTokenUsage
    },
  }))?.last.totalTokens, 444)
  assert.deepEqual(requestedSessionPaths, ['C:/sessions/thread-a.jsonl'])

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

async function smokeThreadRoutes(): Promise<void> {
  const bodies: unknown[] = [
    { query: ' alpha ', limit: 2.8 },
    { query: '   ', limit: 10 },
    { id: 'thread-a', title: 'Alpha title' },
    { id: 'thread-a', title: '' },
    { title: 'Missing id' },
  ]
  const searchCalls: Array<{ query: string; limit: number }> = []
  const readTitlePaths: string[] = []
  const writeTitleCalls: Array<{ path: string; cache: unknown }> = []
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    threadSearchIndexStore: {
      search: async (query: string, limit: number) => {
        searchCalls.push({ query, limit })
        return { threadIds: ['thread-a'], indexedThreadCount: 3 }
      },
    },
    getCodexGlobalStatePath: () => 'global-state.json',
    getCodexSessionIndexPath: () => 'session-index.jsonl',
    readMergedThreadTitleCache: async (statePath: string, sessionIndexPath: string) => ({
      titles: { 'thread-a': `from:${statePath}:${sessionIndexPath}` },
      order: ['thread-a'],
    }),
    readThreadTitleCache: async (path: string) => {
      readTitlePaths.push(path)
      return { titles: { 'thread-a': 'Old title' }, order: ['thread-a'] }
    },
    writeThreadTitleCache: async (path: string, cache: unknown) => {
      writeTitleCalls.push({ path, cache })
    },
  }

  const titles = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'GET' } as never,
    titles.response as never,
    new URL('http://127.0.0.1/codex-api/thread-titles'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(titles.body), {
    data: {
      titles: { 'thread-a': 'from:global-state.json:session-index.jsonl' },
      order: ['thread-a'],
    },
  })

  const search = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'POST' } as never,
    search.response as never,
    new URL('http://127.0.0.1/codex-api/thread-search'),
    dependencies,
  ), true)
  assert.deepEqual(searchCalls, [{ query: 'alpha', limit: 2 }])
  assert.deepEqual(JSON.parse(search.body), { data: { threadIds: ['thread-a'], indexedThreadCount: 3 } })

  const emptySearch = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'POST' } as never,
    emptySearch.response as never,
    new URL('http://127.0.0.1/codex-api/thread-search'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(emptySearch.body), { data: { threadIds: [], indexedThreadCount: 0 } })
  assert.equal(searchCalls.length, 1)

  const updateTitle = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'PUT' } as never,
    updateTitle.response as never,
    new URL('http://127.0.0.1/codex-api/thread-titles'),
    dependencies,
  ), true)
  assert.deepEqual(readTitlePaths, ['global-state.json'])
  assert.deepEqual(writeTitleCalls[0], {
    path: 'global-state.json',
    cache: {
      titles: { 'thread-a': 'Alpha title' },
      order: ['thread-a'],
    },
  })
  assert.deepEqual(JSON.parse(updateTitle.body), { ok: true })

  const removeTitle = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'PUT' } as never,
    removeTitle.response as never,
    new URL('http://127.0.0.1/codex-api/thread-titles'),
    dependencies,
  ), true)
  assert.deepEqual(writeTitleCalls[1], {
    path: 'global-state.json',
    cache: {
      titles: {},
      order: [],
    },
  })
  assert.deepEqual(JSON.parse(removeTitle.body), { ok: true })

  const missingId = createRouteTestResponse()
  assert.equal(await handleThreadRoutes(
    { method: 'PUT' } as never,
    missingId.response as never,
    new URL('http://127.0.0.1/codex-api/thread-titles'),
    dependencies,
  ), true)
  assert.equal(missingId.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingId.body), { error: 'Missing id' })

  assert.equal(await handleThreadRoutes(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/thread-search'),
    dependencies,
  ), false)
}

async function smokeStatusRoutes(): Promise<void> {
  const desktopStatus = {
    available: true,
    platform: 'win32',
    appInstalled: true,
    appRunning: true,
    appUserModelId: 'OpenAI.Codex!App',
    reason: '',
  }
  const refreshResult = {
    requested: true,
    message: 'refresh requested',
  }
  const tunnelStatus = {
    enabled: true,
    active: true,
    publicUrl: 'https://demo.trycloudflare.com',
    configPath: 'config.json',
    configuredCommand: 'cloudflared',
    resolvedCommand: 'cloudflared',
    cloudflaredAvailable: true,
    logPath: 'cx-codex.out.log',
    lastDetectedAtIso: '2026-01-01T00:00:00.000Z',
    reason: 'ok',
  }
  const bodies: unknown[] = [
    { enabled: false, cloudflaredCommand: ' C:\\tools\\cloudflared.exe ' },
    ['bad'],
  ]
  const tunnelUpdates: unknown[] = []
  let shouldFailRefresh = false
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    getDesktopAppRefreshStatus: async () => desktopStatus,
    requestDesktopAppRefresh: async () => {
      if (shouldFailRefresh) throw new Error('refresh unavailable')
      return refreshResult
    },
    getTunnelStatus: async () => tunnelStatus,
    updateTunnelConfig: async (update: unknown) => {
      tunnelUpdates.push(update)
      return tunnelStatus
    },
    getErrorMessage: (error: unknown, fallback: string) => getErrorMessage(error, fallback),
  }

  const desktopStatusResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'GET' } as never,
    desktopStatusResponse.response as never,
    new URL('http://127.0.0.1/codex-api/desktop-app/status'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(desktopStatusResponse.body), { data: desktopStatus })

  const refreshResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'POST' } as never,
    refreshResponse.response as never,
    new URL('http://127.0.0.1/codex-api/desktop-app/refresh'),
    dependencies,
  ), true)
  assert.equal(refreshResponse.response.statusCode, 202)
  assert.deepEqual(JSON.parse(refreshResponse.body), { data: refreshResult })

  shouldFailRefresh = true
  const refreshFailureResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'POST' } as never,
    refreshFailureResponse.response as never,
    new URL('http://127.0.0.1/codex-api/desktop-app/refresh'),
    dependencies,
  ), true)
  assert.equal(refreshFailureResponse.response.statusCode, 409)
  assert.deepEqual(JSON.parse(refreshFailureResponse.body), { error: 'refresh unavailable' })

  const tunnelStatusResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'GET' } as never,
    tunnelStatusResponse.response as never,
    new URL('http://127.0.0.1/codex-api/tunnel-status'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(tunnelStatusResponse.body), { data: tunnelStatus })

  const tunnelUpdateResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'PUT' } as never,
    tunnelUpdateResponse.response as never,
    new URL('http://127.0.0.1/codex-api/tunnel-status'),
    dependencies,
  ), true)
  assert.deepEqual(tunnelUpdates, [{
    enabled: false,
    cloudflaredCommand: ' C:\\tools\\cloudflared.exe ',
  }])
  assert.deepEqual(JSON.parse(tunnelUpdateResponse.body), { data: tunnelStatus })

  const invalidTunnelUpdateResponse = createRouteTestResponse()
  assert.equal(await handleStatusRoutes(
    { method: 'PUT' } as never,
    invalidTunnelUpdateResponse.response as never,
    new URL('http://127.0.0.1/codex-api/tunnel-status'),
    dependencies,
  ), true)
  assert.deepEqual(tunnelUpdates[1], {
    enabled: null,
    cloudflaredCommand: undefined,
  })
  assert.deepEqual(JSON.parse(invalidTunnelUpdateResponse.body), { data: tunnelStatus })

  assert.equal(await handleStatusRoutes(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/desktop-app/refresh'),
    dependencies,
  ), false)
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

async function smokeWorkspaceMetaRoutes(): Promise<void> {
  const methodCalls: string[] = []
  const readPaths: string[] = []
  const writeCalls: Array<{ path: string; state: unknown }> = []
  const bodies: unknown[] = [
    {
      order: ['C:\\work\\one', '', 'C:\\work\\one'],
      labels: { 'C:\\work\\one': 'One', bad: 7 },
      active: ['C:\\work\\one'],
    },
    ['bad'],
  ]
  const dependencies = {
    methodCatalog: {
      listMethods: async () => {
        methodCalls.push('methods')
        return ['thread/list']
      },
      listNotificationMethods: async () => {
        methodCalls.push('notifications')
        return ['turn/completed']
      },
    },
    readJsonBody: async () => bodies.shift(),
    homeDirectory: () => 'C:\\Users\\SW',
    getCodexGlobalStatePath: () => 'global-state.json',
    readWorkspaceRootsState: async (path: string) => {
      readPaths.push(path)
      return {
        order: ['C:\\work\\one'],
        labels: { 'C:\\work\\one': 'One' },
        active: ['C:\\work\\one'],
      }
    },
    writeWorkspaceRootsState: async (path: string, state: unknown) => {
      writeCalls.push({ path, state })
    },
  }

  const methods = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'GET' } as never,
    methods.response as never,
    new URL('http://127.0.0.1/codex-api/meta/methods'),
    dependencies,
  ), true)
  assert.deepEqual(methodCalls, ['methods'])
  assert.deepEqual(JSON.parse(methods.body), { data: ['thread/list'] })

  const notifications = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'GET' } as never,
    notifications.response as never,
    new URL('http://127.0.0.1/codex-api/meta/notifications'),
    dependencies,
  ), true)
  assert.deepEqual(methodCalls, ['methods', 'notifications'])
  assert.deepEqual(JSON.parse(notifications.body), { data: ['turn/completed'] })

  const workspaceRead = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'GET' } as never,
    workspaceRead.response as never,
    new URL('http://127.0.0.1/codex-api/workspace-roots-state'),
    dependencies,
  ), true)
  assert.deepEqual(readPaths, ['global-state.json'])
  assert.deepEqual(JSON.parse(workspaceRead.body), {
    data: {
      order: ['C:\\work\\one'],
      labels: { 'C:\\work\\one': 'One' },
      active: ['C:\\work\\one'],
    },
  })

  const workspaceWrite = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'PUT' } as never,
    workspaceWrite.response as never,
    new URL('http://127.0.0.1/codex-api/workspace-roots-state'),
    dependencies,
  ), true)
  assert.deepEqual(writeCalls, [{
    path: 'global-state.json',
    state: {
      order: ['C:\\work\\one'],
      labels: { 'C:\\work\\one': 'One' },
      active: ['C:\\work\\one'],
    },
  }])
  assert.deepEqual(JSON.parse(workspaceWrite.body), { ok: true })

  const invalidWorkspaceWrite = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'PUT' } as never,
    invalidWorkspaceWrite.response as never,
    new URL('http://127.0.0.1/codex-api/workspace-roots-state'),
    dependencies,
  ), true)
  assert.equal(invalidWorkspaceWrite.response.statusCode, 400)
  assert.deepEqual(JSON.parse(invalidWorkspaceWrite.body), { error: 'Invalid body: expected object' })

  const homeDirectory = createRouteTestResponse()
  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'GET' } as never,
    homeDirectory.response as never,
    new URL('http://127.0.0.1/codex-api/home-directory'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(homeDirectory.body), { data: { path: 'C:\\Users\\SW' } })

  assert.equal(await handleWorkspaceMetaRoutes(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/home-directory'),
    dependencies,
  ), false)
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

async function smokeProjectRootRoutes(): Promise<void> {
  const bodies: unknown[] = [
    { path: ' C:\\work\\new ', createIfMissing: true, label: 'New Project' },
    { path: ' ' },
  ]
  const readPaths: string[] = []
  const writeCalls: Array<{ path: string; state: unknown }> = []
  const resolveCalls: Array<{
    path: string
    createIfMissing?: boolean
    label?: string
    existingState: unknown
  }> = []
  const suggestCalls: string[] = []
  const nextWorkspaceState = {
    order: ['C:\\work\\new', 'C:\\work\\old'],
    labels: { 'C:\\work\\new': 'New Project' },
    active: ['C:\\work\\new', 'C:\\work\\old'],
  }
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    getCodexGlobalStatePath: () => 'global-state.json',
    readWorkspaceRootsState: async (path: string) => {
      readPaths.push(path)
      return {
        order: ['C:\\work\\old'],
        labels: {},
        active: ['C:\\work\\old'],
      }
    },
    writeWorkspaceRootsState: async (path: string, state: unknown) => {
      writeCalls.push({ path, state })
    },
    resolveProjectRoot: async (path: string, options: {
      createIfMissing?: boolean
      label?: string
      existingState: {
        order: string[]
        labels: Record<string, string>
        active: string[]
      }
    }) => {
      resolveCalls.push({
        path,
        createIfMissing: options.createIfMissing,
        label: options.label,
        existingState: options.existingState,
      })
      if (!path) throw new ProjectRootError('Missing path', 400)
      return {
        path: 'C:\\work\\new',
        workspaceState: nextWorkspaceState,
      }
    },
    suggestProjectRoot: async (basePath: string) => {
      suggestCalls.push(basePath)
      if (!basePath) throw new ProjectRootError('Missing basePath', 400)
      return {
        name: 'New Project (1)',
        path: 'C:\\work\\New Project (1)',
      }
    },
  }

  const createProject = createRouteTestResponse()
  assert.equal(await handleProjectRootRoutes(
    { method: 'POST' } as never,
    createProject.response as never,
    new URL('http://127.0.0.1/codex-api/project-root'),
    dependencies,
  ), true)
  assert.deepEqual(readPaths, ['global-state.json'])
  assert.deepEqual(resolveCalls, [{
    path: 'C:\\work\\new',
    createIfMissing: true,
    label: 'New Project',
    existingState: {
      order: ['C:\\work\\old'],
      labels: {},
      active: ['C:\\work\\old'],
    },
  }])
  assert.deepEqual(writeCalls, [{
    path: 'global-state.json',
    state: nextWorkspaceState,
  }])
  assert.deepEqual(JSON.parse(createProject.body), { data: { path: 'C:\\work\\new' } })

  const missingProject = createRouteTestResponse()
  assert.equal(await handleProjectRootRoutes(
    { method: 'POST' } as never,
    missingProject.response as never,
    new URL('http://127.0.0.1/codex-api/project-root'),
    dependencies,
  ), true)
  assert.equal(missingProject.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingProject.body), { error: 'Missing path' })
  assert.equal(writeCalls.length, 1)

  const suggestion = createRouteTestResponse()
  assert.equal(await handleProjectRootRoutes(
    { method: 'GET' } as never,
    suggestion.response as never,
    new URL('http://127.0.0.1/codex-api/project-root-suggestion?basePath=%20C%3A%5Cwork%20'),
    dependencies,
  ), true)
  assert.deepEqual(suggestCalls, ['C:\\work'])
  assert.deepEqual(JSON.parse(suggestion.body), {
    data: {
      name: 'New Project (1)',
      path: 'C:\\work\\New Project (1)',
    },
  })

  const missingBasePath = createRouteTestResponse()
  assert.equal(await handleProjectRootRoutes(
    { method: 'GET' } as never,
    missingBasePath.response as never,
    new URL('http://127.0.0.1/codex-api/project-root-suggestion?basePath=%20'),
    dependencies,
  ), true)
  assert.equal(missingBasePath.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingBasePath.body), { error: 'Missing basePath' })

  assert.equal(await handleProjectRootRoutes(
    { method: 'PUT' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/project-root'),
    dependencies,
  ), false)
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

function smokeAppServerRuntimeBridge(): void {
  const expectedStatuses: Array<[RuntimeExecutionState, string]> = [
    ['idle', 'stopped'],
    ['queued', 'stopped'],
    ['starting', 'running'],
    ['start_uncertain', 'start_uncertain'],
    ['running', 'running'],
    ['waiting_permission', 'running'],
    ['stopping', 'stopping'],
    ['stop_uncertain', 'stop_uncertain'],
    ['completed_pending_sync', 'completed'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['interrupted', 'interrupted'],
    ['stopped', 'stopped'],
    ['sync_degraded', 'sync_degraded'],
  ]
  for (const [executionState, requestStatus] of expectedStatuses) {
    assert.equal(readRuntimeRequestStatusFromExecutionState(executionState), requestStatus)
  }

  const params = { threadId: 'thread-a' }
  assert.deepEqual(normalizeRuntimeEventForReplay({
    seq: 12,
    method: 'turn/completed',
    params,
    atIso: '2026-01-01T00:00:00.000Z',
  }), {
    seq: 12,
    method: 'turn/completed',
    params,
    atIso: '2026-01-01T00:00:00.000Z',
  })
}

function smokeAppServerRuntimeRequestReconciliation(): void {
  assert.deepEqual(RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES, [
    'pending_start',
    'start_uncertain',
    'running',
    'stopping',
    'stop_uncertain',
    'still_running',
  ])
  assert.equal(RUNTIME_RECONCILE_RUNNING_THROTTLE_MS, 10_000)
  assert.equal(RUNTIME_RECONCILE_BATCH_LIMIT, 3)

  const snapshot = createThreadRuntimeSnapshot({ executionState: 'running', activeTurnId: 'turn-a' })
  const statusFilters: unknown[] = []
  const runtimeRequests: RuntimeRequestRecord[] = [{
    requestId: 'request-a',
    clientMessageId: 'client-a',
    threadId: 'thread-a',
    turnId: 'turn-a',
    status: 'running',
    mode: 'default',
    promptHash: 'hash-a',
    payload: {},
    retryCount: 0,
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    lastError: null,
  }]
  assert.deepEqual(createRuntimeThreadStatePayload('thread-a', snapshot, {
    listRequestsByThread: (threadId, statuses) => {
      assert.equal(threadId, 'thread-a')
      statusFilters.push(statuses)
      return runtimeRequests
    },
  }), {
    snapshot,
    requests: runtimeRequests,
  })
  assert.deepEqual(statusFilters, [RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES])

  const patchFilters: unknown[] = []
  const patches: Array<{ requestId: string; patch: unknown }> = []
  assert.equal(updateRuntimeRequestsFromSnapshot('thread-a', createThreadRuntimeSnapshot({
    executionState: 'completed',
    activeTurnId: 'turn-finished',
  }), {
    listRequestsByThread: (threadId, statuses) => {
      assert.equal(threadId, 'thread-a')
      patchFilters.push(statuses)
      return runtimeRequests
    },
    updateRequest: (requestId, patch) => {
      patches.push({ requestId, patch })
      return null
    },
  }), 1)
  assert.deepEqual(patchFilters, [RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES])
  assert.deepEqual(patches, [{
    requestId: 'request-a',
    patch: {
      status: 'completed',
      threadId: 'thread-a',
      turnId: 'turn-finished',
      lastError: null,
    },
  }])

  const makeRuntimeRequest = (requestId: string, status: RuntimeRequestRecord['status'], threadId: string): RuntimeRequestRecord => ({
    ...runtimeRequests[0],
    requestId,
    status,
    threadId,
  })
  const reconcileRequests = [
    makeRuntimeRequest('missing-thread', 'start_uncertain', ''),
    makeRuntimeRequest('stopping-a', 'stopping', 'thread-a'),
    makeRuntimeRequest('running-fresh', 'running', 'thread-b'),
    makeRuntimeRequest('still-stale', 'still_running', 'thread-c'),
    makeRuntimeRequest('start-uncertain', 'start_uncertain', 'thread-d'),
    makeRuntimeRequest('running-stale', 'running', 'thread-e'),
  ]
  const lastReconciledAtMs = new Map<string, number>([
    ['thread-b', 9_500],
    ['thread-c', 0],
    ['thread-e', -1],
  ])
  assert.deepEqual(
    selectRuntimeRequestsForReconcile(reconcileRequests, lastReconciledAtMs, 10_000).map((request) => request.requestId),
    ['stopping-a', 'still-stale', 'start-uncertain'],
  )
  assert.deepEqual(
    selectRuntimeRequestsForReconcile(reconcileRequests, lastReconciledAtMs, 10_000, 10).map((request) => request.requestId),
    ['stopping-a', 'still-stale', 'start-uncertain', 'running-stale'],
  )
  assert.deepEqual(createRuntimeReconcileFailurePatch(
    { status: 'stopping' },
    'runtime reconcile failed',
  ), {
    status: 'stop_uncertain',
    lastError: 'runtime reconcile failed',
    incrementRetry: true,
  })
  assert.deepEqual(createRuntimeReconcileFailurePatch(
    { status: 'running' },
    'runtime reconcile failed',
  ), {
    status: 'running',
    lastError: 'runtime reconcile failed',
    incrementRetry: true,
  })

  assert.deepEqual(createRuntimeRequestSnapshotPatch(
    { status: 'running', turnId: 'old-turn' },
    'thread-a',
    {
      executionState: 'completed',
      inProgress: false,
      activeTurnId: 'new-turn',
      lastError: null,
    },
  ), {
    status: 'completed',
    threadId: 'thread-a',
    turnId: 'new-turn',
    lastError: null,
  })

  assert.deepEqual(createRuntimeRequestSnapshotPatch(
    { status: 'stopping', turnId: 'old-turn' },
    'thread-a',
    {
      executionState: 'running',
      inProgress: true,
      activeTurnId: '',
      lastError: 'still active',
    },
  ), {
    status: 'still_running',
    threadId: 'thread-a',
    turnId: 'old-turn',
    lastError: 'still active',
  })

  assert.deepEqual(createRuntimeRequestSnapshotPatch(
    { status: 'stop_uncertain', turnId: 'turn-b' },
    'thread-b',
    {
      executionState: 'failed',
      inProgress: false,
      activeTurnId: '',
      lastError: 'failed after interrupt',
    },
  ), {
    status: 'failed',
    threadId: 'thread-b',
    turnId: 'turn-b',
    lastError: 'failed after interrupt',
  })
}

function smokeRuntimePayloadParsing(): void {
  const parsedSend = parseRuntimeSendPayload({
    requestId: 'request-a',
    clientMessageId: 'client-a',
    mode: 'plan',
    model: 'gpt-test',
    cwd: ' E:/project ',
    thread_id: ' thread-a ',
    effort: ' high ',
    attachments: [{ path: 'a.txt' }],
    turnOptions: {
      goal: { enabled: true, text: '持续完成目标' },
      plugins: [{ id: 'plugin-a', name: 'Plugin A' }, { id: '', name: 'skip' }],
    },
    input: [{ type: 'text', text: ' hello ' }],
  })
  assert.equal(parsedSend.requestId, 'request-a')
  assert.equal(parsedSend.clientMessageId, 'client-a')
  assert.equal(parsedSend.mode, 'plan')
  assert.equal(parsedSend.model, 'gpt-test')
  assert.equal(parsedSend.cwd, 'E:/project')
  assert.equal(parsedSend.threadId, 'thread-a')
  assert.equal(parsedSend.input.length, 1)
  assert.match(JSON.stringify(parsedSend.input[0]), /CX-Codex turn options/)
  assert.deepEqual(parsedSend.payloadSummary, {
    hasThreadId: true,
    hasCwd: true,
    cwdHash: parsedSend.payloadSummary.cwdHash,
    model: 'gpt-test',
    effort: 'high',
    collaborationMode: 'plan',
    input: {
      inputCount: 1,
      textCount: 1,
      imageCount: 0,
      localImageCount: 0,
      skillCount: 0,
    },
    attachmentCount: 1,
    turnOptions: {
      pluginCount: 1,
      hasGoal: true,
    },
  })
  assert.equal(typeof parsedSend.payloadSummary.cwdHash, 'string')
  assert.equal((parsedSend.payloadSummary.cwdHash as string).length, 64)

  assert.throws(
    () => parseRuntimeSendPayload({ input: [] }),
    /runtime\/send requires input/,
  )
  assert.throws(
    () => parseRuntimeSendPayload(null),
    /Invalid body: expected runtime send payload/,
  )

  const longUserAgent = 'u'.repeat(260)
  const parsedInterrupt = parseRuntimeInterruptPayload({
    requestId: 'interrupt-a',
    thread_id: ' thread-a ',
    activeTurnId: ' turn-a ',
    source: '',
    requestedAtIso: '2026-01-01T00:00:00.000Z',
    clientElapsedMs: 12.7,
    userAgent: longUserAgent,
  })
  assert.deepEqual(parsedInterrupt, {
    requestId: 'interrupt-a',
    threadId: 'thread-a',
    turnId: 'turn-a',
    payloadSummary: {
      threadId: 'thread-a',
      turnId: 'turn-a',
      source: 'unknown',
      requestedAtIso: '2026-01-01T00:00:00.000Z',
      clientElapsedMs: 13,
      userAgent: longUserAgent.slice(0, 240),
    },
  })
  assert.throws(
    () => parseRuntimeInterruptPayload({ turnId: 'turn-a' }),
    /runtime\/interrupt requires threadId/,
  )
  assert.throws(
    () => parseRuntimeInterruptPayload({ threadId: 'thread-a' }),
    /runtime\/interrupt requires turnId/,
  )
}

async function smokeRuntimeActionRoutes(): Promise<void> {
  const bodies: unknown[] = [
    { input: 'hello' },
    { input: 'wait' },
    { threadId: 'thread-a', turnId: 'turn-a' },
    { threadId: 'thread-b', turnId: 'turn-b' },
  ]
  const startedPayloads: unknown[] = []
  const interruptedPayloads: unknown[] = []
  const knownRequest: RuntimeRequestRecord = {
    requestId: 'request-a',
    clientMessageId: 'client-a',
    threadId: 'thread-a',
    turnId: 'turn-a',
    status: 'running',
    promptHash: 'hash-a',
    mode: 'execute',
    payload: { input: 'hello' },
    retryCount: 0,
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: '2026-01-01T00:00:01.000Z',
    lastError: null,
  }
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    startRuntimeTurn: async (payload: unknown) => {
      startedPayloads.push(payload)
      return {
        status: startedPayloads.length === 1 ? 'running' : 'start_uncertain',
        requestId: `start-${startedPayloads.length}`,
      }
    },
    interruptRuntimeTurn: async (payload: unknown) => {
      interruptedPayloads.push(payload)
      return {
        status: interruptedPayloads.length === 1 ? 'stopped' : 'stop_uncertain',
        requestId: `stop-${interruptedPayloads.length}`,
      }
    },
    getLatestRequestByClientMessageId: (clientMessageId: string) => (
      clientMessageId === 'client-a' ? knownRequest : null
    ),
  }

  const sendRunning = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'POST' } as never,
    sendRunning.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/send'),
    dependencies,
  ), true)
  assert.equal(sendRunning.response.statusCode, 200)
  assert.deepEqual(JSON.parse(sendRunning.body), { data: { status: 'running', requestId: 'start-1' } })

  const sendUncertain = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'POST' } as never,
    sendUncertain.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/send'),
    dependencies,
  ), true)
  assert.equal(sendUncertain.response.statusCode, 202)
  assert.deepEqual(startedPayloads, [{ input: 'hello' }, { input: 'wait' }])
  assert.deepEqual(JSON.parse(sendUncertain.body), { data: { status: 'start_uncertain', requestId: 'start-2' } })

  const missingRequestId = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'GET' } as never,
    missingRequestId.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/request?clientMessageId=%20'),
    dependencies,
  ), true)
  assert.equal(missingRequestId.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingRequestId.body), { error: 'Missing clientMessageId' })

  const missingRequest = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'GET' } as never,
    missingRequest.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/request?clientMessageId=missing'),
    dependencies,
  ), true)
  assert.equal(missingRequest.response.statusCode, 404)
  assert.deepEqual(JSON.parse(missingRequest.body), { data: null })

  const foundRequest = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'GET' } as never,
    foundRequest.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/request?clientMessageId=%20client-a%20'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(foundRequest.body), { data: knownRequest })

  const stopped = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'POST' } as never,
    stopped.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/interrupt'),
    dependencies,
  ), true)
  assert.equal(stopped.response.statusCode, 200)
  assert.deepEqual(JSON.parse(stopped.body), { data: { status: 'stopped', requestId: 'stop-1' } })

  const stopUncertain = createRouteTestResponse()
  assert.equal(await handleRuntimeActionRoutes(
    { method: 'POST' } as never,
    stopUncertain.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/interrupt'),
    dependencies,
  ), true)
  assert.equal(stopUncertain.response.statusCode, 202)
  assert.deepEqual(interruptedPayloads, [
    { threadId: 'thread-a', turnId: 'turn-a' },
    { threadId: 'thread-b', turnId: 'turn-b' },
  ])
  assert.deepEqual(JSON.parse(stopUncertain.body), { data: { status: 'stop_uncertain', requestId: 'stop-2' } })

  assert.equal(await handleRuntimeActionRoutes(
    { method: 'GET' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/runtime/send'),
    dependencies,
  ), false)
}

function smokeAppServerRuntimeSnapshotRecovery(): void {
  const activeSnapshot = createThreadRuntimeSnapshot({
    executionState: 'running',
    inProgress: true,
    canStop: true,
    stale: false,
    lastEventAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: '2026-01-01T00:00:00.000Z',
    threadRead: { stale: 'payload' },
    messageState: 'fresh',
    pendingServerRequests: [],
    tokenUsage: { total: 1 },
  })

  const fresh = createLocalRuntimeSnapshotFromPersisted(activeSnapshot, {
    pendingServerRequests: [],
    tokenUsage: { total: 2 },
    appServerStartedAtMs: Date.parse('2025-12-31T23:59:59.000Z'),
    nowMs: Date.parse('2026-01-01T00:00:30.000Z'),
    staleMs: 90_000,
  })
  assert.equal(fresh.executionState, 'running')
  assert.equal(fresh.inProgress, true)
  assert.equal(fresh.canStop, true)
  assert.equal(fresh.stale, false)
  assert.equal(fresh.threadRead, null)
  assert.equal(fresh.messageState, 'unavailable')
  assert.deepEqual(fresh.tokenUsage, { total: 2 })

  const timedOut = createLocalRuntimeSnapshotFromPersisted(activeSnapshot, {
    pendingServerRequests: [],
    tokenUsage: null,
    appServerStartedAtMs: Date.parse('2025-12-31T23:59:59.000Z'),
    nowMs: Date.parse('2026-01-01T00:02:00.000Z'),
    staleMs: 90_000,
  })
  assert.equal(timedOut.executionState, 'sync_degraded')
  assert.equal(timedOut.inProgress, false)
  assert.equal(timedOut.canStop, false)
  assert.equal(timedOut.stale, true)
  assert.equal(timedOut.degradedReason, 'persisted runtime snapshot is stale')

  const restarted = createLocalRuntimeSnapshotFromPersisted(activeSnapshot, {
    pendingServerRequests: [],
    tokenUsage: null,
    appServerStartedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
    nowMs: Date.parse('2026-01-01T00:00:30.000Z'),
    staleMs: 90_000,
  })
  assert.equal(restarted.executionState, 'sync_degraded')
  assert.equal(restarted.degradedReason, 'app-server restarted after active runtime snapshot')

  const waitingPermission = createLocalRuntimeSnapshotFromPersisted(activeSnapshot, {
    pendingServerRequests: [{ id: 1, method: 'server/request', params: { threadId: 'thread-a' }, receivedAtIso: '2026-01-01T00:00:01.000Z' }],
    tokenUsage: null,
    appServerStartedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
    nowMs: Date.parse('2026-01-01T00:02:00.000Z'),
    staleMs: 90_000,
  })
  assert.equal(waitingPermission.executionState, 'running')
  assert.equal(waitingPermission.stale, false)
  assert.equal(waitingPermission.pendingServerRequests.length, 1)

  const localFromPersisted = createLocalRuntimeSnapshot({
    persistedSnapshot: activeSnapshot,
    pendingServerRequests: [],
    tokenUsage: { total: 3 },
    appServerStartedAtMs: Date.parse('2025-12-31T23:59:59.000Z'),
    nowMs: Date.parse('2026-01-01T00:00:30.000Z'),
    staleMs: 90_000,
    createCurrentSnapshot: () => {
      throw new Error('current snapshot should not be created when persisted snapshot exists')
    },
    persistCurrentSnapshot: () => {
      throw new Error('current snapshot should not be persisted when persisted snapshot exists')
    },
  })
  assert.equal(localFromPersisted.executionState, 'running')
  assert.deepEqual(localFromPersisted.tokenUsage, { total: 3 })

  const currentSnapshot = createThreadRuntimeSnapshot({
    executionState: 'completed',
    pendingServerRequests: [],
    tokenUsage: { total: 4 },
  })
  const createdOverlays: unknown[] = []
  const persistedSnapshots: unknown[] = []
  const localFromCurrent = createLocalRuntimeSnapshot({
    persistedSnapshot: null,
    pendingServerRequests: [{ id: 2, method: 'server/request', params: { threadId: 'thread-b' }, receivedAtIso: '2026-01-01T00:00:02.000Z' }],
    tokenUsage: { total: 4 },
    appServerStartedAtMs: Date.parse('2025-12-31T23:59:59.000Z'),
    createCurrentSnapshot: (overlay) => {
      createdOverlays.push(overlay)
      return currentSnapshot
    },
    persistCurrentSnapshot: (snapshot) => {
      persistedSnapshots.push(snapshot)
      return snapshot
    },
  })
  assert.equal(localFromCurrent, currentSnapshot)
  assert.deepEqual(createdOverlays, [{
    pendingServerRequests: [{ id: 2, method: 'server/request', params: { threadId: 'thread-b' }, receivedAtIso: '2026-01-01T00:00:02.000Z' }],
    tokenUsage: { total: 4 },
  }])
  assert.deepEqual(persistedSnapshots, [currentSnapshot])
}

function smokeAppServerNotificationReplay(): void {
  const appended: unknown[] = []
  const observations: unknown[] = []
  let persisted = {
    notifications: [] as Array<{ seq: number; method: string; params: unknown; atIso: string }>,
    latestSeq: 10,
    oldestSeq: 10,
  }
  const replay = new AppServerNotificationReplay({
    initialSeq: 10.8,
    bufferLimit: 2,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    appendEvent: (event) => { appended.push(event) },
    listEventsAfter: () => persisted,
    observeNotification: (observation) => { observations.push(observation) },
    readThreadIdFromPayload: (payload) => readStringProperty(payload, 'threadId'),
    readTurnIdFromPayload: (payload) => readStringProperty(payload, 'turnId'),
  })

  const first = replay.remember({
    method: 'turn/started',
    params: { threadId: 'thread-a', turnId: 'turn-a' },
  })
  const second = replay.remember({
    method: 'item/updated',
    params: { threadId: 'thread-b' },
  })
  const third = replay.remember({
    method: 'turn/completed',
    params: { threadId: 'thread-c', turnId: 'turn-c' },
  })

  assert.equal(replay.latestSeq, 13)
  assert.deepEqual([first.seq, second.seq, third.seq], [11, 12, 13])
  assert.deepEqual(appended, [
    {
      seq: 11,
      method: 'turn/started',
      params: { threadId: 'thread-a', turnId: 'turn-a' },
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-a',
      turnId: 'turn-a',
    },
    {
      seq: 12,
      method: 'item/updated',
      params: { threadId: 'thread-b' },
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-b',
      turnId: '',
    },
    {
      seq: 13,
      method: 'turn/completed',
      params: { threadId: 'thread-c', turnId: 'turn-c' },
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-c',
      turnId: 'turn-c',
    },
  ])
  assert.deepEqual(observations, [
    {
      method: 'turn/started',
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-a',
      turnId: 'turn-a',
      params: { threadId: 'thread-a', turnId: 'turn-a' },
    },
    {
      method: 'item/updated',
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-b',
      turnId: '',
      params: { threadId: 'thread-b' },
    },
    {
      method: 'turn/completed',
      atIso: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-c',
      turnId: 'turn-c',
      params: { threadId: 'thread-c', turnId: 'turn-c' },
    },
  ])

  assert.deepEqual(replay.listAfter(11, 10), {
    notifications: [second, third],
    latestSeq: 13,
    oldestSeq: 12,
  })

  persisted = {
    notifications: [{
      seq: 12,
      method: 'persisted/event',
      params: { ok: true },
      atIso: '2026-01-01T00:00:01.000Z',
    }],
    latestSeq: 13,
    oldestSeq: 2,
  }
  assert.deepEqual(replay.listAfter(1, 100), {
    notifications: [{
      seq: 12,
      method: 'persisted/event',
      params: { ok: true },
      atIso: '2026-01-01T00:00:01.000Z',
    }],
    latestSeq: 13,
    oldestSeq: 2,
  })
}

async function smokeDiagnosticsRoutes(): Promise<void> {
  const appServerStatus: AppServerHealth = {
    running: true,
    initialized: true,
    stopping: false,
    pid: 1234,
    pendingRpcCount: 1,
    queuedRpcCount: 2,
    pendingServerRequestCount: 1,
    activePlanModeTurnCount: 0,
    launchPolicy: createAppServerLaunchPolicySnapshot(DEFAULT_APP_SERVER_LAUNCH_POLICY),
  }
  const runtimeHealth = {
    path: '~/.cx-codex/runtime.sqlite',
    requestCount: 3,
    uncertainRequestCount: 1,
    latestSeq: 30,
    oldestSeq: 10,
    snapshotCount: 2,
  }
  const pendingServerRequest = {
    id: 77,
    method: 'item/fileChange/requestApproval',
    params: { path: 'hidden.txt' },
    receivedAtIso: '2026-01-01T00:00:00.000Z',
  }
  const runtimeEvent = (seq: number): RuntimeEventRecord => ({
    seq,
    method: `event/${seq}`,
    params: { hidden: true },
    atIso: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    threadId: `thread-${seq}`,
    turnId: `turn-${seq}`,
  })
  const uncertainRequest: RuntimeRequestRecord = {
    requestId: 'request-a',
    clientMessageId: 'client-a',
    threadId: 'thread-a',
    turnId: 'turn-a',
    status: 'running',
    promptHash: 'hash-a',
    mode: 'plan',
    payload: { hidden: true },
    retryCount: 2,
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtIso: '2026-01-01T00:00:01.000Z',
    lastError: 'still running',
  }
  const listEventsCalls: Array<{ afterSeq: number; limit: number }> = []
  const uncertainLimitCalls: number[] = []
  const dependencies = {
    getAppServerStatus: () => appServerStatus,
    getNotificationDiagnostics: () => ({ unknownNotificationCount: 0 }),
    getStatusDiagnostics: () => ({ unknownStatusCount: 0 }),
    listPendingServerRequests: () => [pendingServerRequest],
    readHookDiagnostics: async () => ({ available: true, hookCount: 0 }),
    readSchemaAuditSummary: async () => ({ status: 'ok' }),
    readWindowsSandboxDiagnostics: async () => ({ status: 'ready', available: true }),
    getTranscriptionDiagnostics: () => ({ configured: true }),
    nowIso: () => '2026-01-01T00:00:30.000Z',
    runtimeStore: {
      getHealth: () => runtimeHealth,
      listEventsAfter: (afterSeq: number, limit: number) => {
        listEventsCalls.push({ afterSeq, limit })
        return {
          notifications: Array.from({ length: 12 }, (_, index) => runtimeEvent(index + 1)),
        }
      },
      listUncertainRequests: (limit: number) => {
        uncertainLimitCalls.push(limit)
        return [uncertainRequest]
      },
    },
  }

  const healthResponse = createRouteTestResponse()
  assert.equal(await handleDiagnosticsRoutes(
    { method: 'GET' } as never,
    healthResponse.response as never,
    new URL('http://127.0.0.1/codex-api/health'),
    dependencies,
  ), true)
  assert.equal(healthResponse.response.statusCode, 200)
  assert.deepEqual(JSON.parse(healthResponse.body), {
    status: 'ok',
    data: {
      appServer: appServerStatus,
      notificationDiagnostics: { unknownNotificationCount: 0 },
      statusDiagnostics: { unknownStatusCount: 0 },
      serverRequestDiagnostics: {
        pendingRequestCount: 1,
        pendingByKind: {
          permission: 0,
          approval: 1,
          elicitation: 0,
          tool: 0,
          request: 0,
        },
        pendingRequests: [{
          id: 77,
          method: 'item/fileChange/requestApproval',
          kind: 'approval',
          receivedAtIso: '2026-01-01T00:00:00.000Z',
        }],
      },
      hookDiagnostics: { available: true, hookCount: 0 },
      schemaAudit: { status: 'ok' },
      windowsSandbox: { status: 'ready', available: true },
      transcription: { configured: true },
      runtimeStore: runtimeHealth,
      timestamp: '2026-01-01T00:00:30.000Z',
    },
  })

  const diagnosticsResponse = createRouteTestResponse()
  assert.equal(await handleDiagnosticsRoutes(
    { method: 'GET' } as never,
    diagnosticsResponse.response as never,
    new URL('http://127.0.0.1/codex-api/diagnostics'),
    dependencies,
  ), true)
  assert.deepEqual(listEventsCalls, [{ afterSeq: 10, limit: 20 }])
  assert.deepEqual(uncertainLimitCalls, [10])
  const diagnosticsPayload = JSON.parse(diagnosticsResponse.body)
  assert.equal(diagnosticsPayload.status, 'ok')
  assert.deepEqual(diagnosticsPayload.data.runtime.recentEvents.map((event: { seq: number }) => event.seq), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.equal('params' in diagnosticsPayload.data.runtime.recentEvents[0], false)
  assert.deepEqual(diagnosticsPayload.data.runtime.uncertainRequests, [{
    requestId: 'request-a',
    clientMessageId: 'client-a',
    threadId: 'thread-a',
    turnId: 'turn-a',
    status: 'running',
    retryCount: 2,
    updatedAtIso: '2026-01-01T00:00:01.000Z',
    lastError: 'still running',
  }])
  assert.equal('payload' in diagnosticsPayload.data.runtime.uncertainRequests[0], false)
  assert.deepEqual(diagnosticsPayload.data.pendingServerRequests, [{
    id: 77,
    method: 'item/fileChange/requestApproval',
    kind: 'approval',
    receivedAtIso: '2026-01-01T00:00:00.000Z',
  }])

  assert.equal(await handleDiagnosticsRoutes(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/diagnostics'),
    dependencies,
  ), false)
}

async function smokeLocalStateRoutes(): Promise<void> {
  const favoriteRecord: FavoriteRecord = {
    id: 'favorite-a',
    threadId: 'thread-a',
    messageId: 'message-a',
    threadTitle: 'Thread A',
    threadCwd: 'E:/repo',
    role: 'assistant' as const,
    text: 'Favorite text',
    preview: 'Favorite text',
    turnIndex: 1,
    favoritedAtIso: '2026-01-01T00:00:00.000Z',
  }
  const settings: WebBridgeSettings = {
    permissions: {
      allowAllPermissionRequests: true,
      commandExecution: 'ask' as const,
      fileChange: 'allowForSession' as const,
      mcpTools: 'ask' as const,
    },
  }
  const writtenSettings: WebBridgeSettings = {
    permissions: {
      allowAllPermissionRequests: false,
      commandExecution: 'allowForSession' as const,
      fileChange: 'ask' as const,
      mcpTools: 'allowForSession' as const,
    },
  }
  const bodies: unknown[] = [
    { permissions: { commandExecution: 'allowForSession' } },
    { favorites: [favoriteRecord] },
    { pinnedThreadIds: ['thread-b'] },
  ]
  const settingsPaths: string[] = []
  const settingsUpdates: unknown[] = []
  const settingsWrites: unknown[] = []
  const favoriteWrites: unknown[] = []
  const pinnedWrites: unknown[] = []
  const dependencies = {
    readJsonBody: async () => bodies.shift(),
    setWebBridgeSettings: (value: WebBridgeSettings) => {
      settingsUpdates.push(value)
    },
    getWebBridgeSettingsPath: () => 'settings-path.json',
    readWebBridgeSettings: async (path: string) => {
      settingsPaths.push(path)
      return settings
    },
    writeWebBridgeSettings: async (path: string, payload: unknown) => {
      settingsWrites.push({ path, payload })
      return writtenSettings
    },
    readFavoriteRecords: async () => [favoriteRecord],
    writeFavoriteRecords: async (favorites: FavoriteRecord[]) => {
      favoriteWrites.push(favorites)
      return favorites
    },
    readMergedPinnedThreadIds: async () => ['thread-a'],
    writeMergedPinnedThreadIds: async (pinnedThreadIds: string[]) => {
      pinnedWrites.push(pinnedThreadIds)
      return pinnedThreadIds
    },
  }

  const webSettingsRead = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'GET' } as never,
    webSettingsRead.response as never,
    new URL('http://127.0.0.1/codex-api/web-settings'),
    dependencies,
  ), true)
  assert.equal(webSettingsRead.response.statusCode, 200)
  assert.deepEqual(JSON.parse(webSettingsRead.body), { data: settings })
  assert.deepEqual(settingsPaths, ['settings-path.json'])
  assert.deepEqual(settingsUpdates, [settings])

  const webSettingsWrite = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'PUT' } as never,
    webSettingsWrite.response as never,
    new URL('http://127.0.0.1/codex-api/web-settings'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(webSettingsWrite.body), { data: writtenSettings })
  assert.deepEqual(settingsWrites, [{
    path: 'settings-path.json',
    payload: { permissions: { commandExecution: 'allowForSession' } },
  }])
  assert.deepEqual(settingsUpdates, [settings, writtenSettings])

  const favoritesRead = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'GET' } as never,
    favoritesRead.response as never,
    new URL('http://127.0.0.1/codex-api/favorites'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(favoritesRead.body), { data: [favoriteRecord] })

  const favoritesWrite = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'PUT' } as never,
    favoritesWrite.response as never,
    new URL('http://127.0.0.1/codex-api/favorites'),
    dependencies,
  ), true)
  assert.deepEqual(favoriteWrites, [[favoriteRecord]])
  assert.deepEqual(JSON.parse(favoritesWrite.body), { data: [favoriteRecord] })

  const pinnedRead = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'GET' } as never,
    pinnedRead.response as never,
    new URL('http://127.0.0.1/codex-api/pinned-threads'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(pinnedRead.body), { data: ['thread-a'] })

  const pinnedWrite = createRouteTestResponse()
  assert.equal(await handleLocalStateRoutes(
    { method: 'PUT' } as never,
    pinnedWrite.response as never,
    new URL('http://127.0.0.1/codex-api/pinned-threads'),
    dependencies,
  ), true)
  assert.deepEqual(pinnedWrites, [['thread-b']])
  assert.deepEqual(JSON.parse(pinnedWrite.body), { data: ['thread-b'] })

  assert.equal(await handleLocalStateRoutes(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/favorites'),
    dependencies,
  ), false)
}

async function smokeRuntimeStateRoutes(): Promise<void> {
  const localSnapshot = createThreadRuntimeSnapshot({ threadId: 'thread-local', executionState: 'running' })
  const reconciledSnapshot = createThreadRuntimeSnapshot({ threadId: 'thread-reconciled', executionState: 'completed' })
  const persistedSnapshot = createThreadRuntimeSnapshot({ threadId: 'thread-persisted', executionState: 'waiting_permission' })
  const legacySnapshot = createThreadRuntimeSnapshot({ threadId: 'thread-legacy', executionState: 'sync_degraded' })
  const tokenUsage = normalizeThreadTokenUsage({
    total: {
      totalTokens: 7,
      inputTokens: 3,
      cachedInputTokens: 1,
      outputTokens: 4,
      reasoningOutputTokens: 2,
    },
    last: {
      totalTokens: 7,
      inputTokens: 3,
      cachedInputTokens: 1,
      outputTokens: 4,
      reasoningOutputTokens: 2,
    },
    modelContextWindow: 100,
  })
  if (!tokenUsage) throw new Error('expected normalized token usage')
  const requestedThreads: string[] = []
  const reconciledThreads: string[] = []
  const persisted: Array<{ threadId: string; snapshot: ThreadRuntimeSnapshot }> = []
  const overlays: Array<{ threadId: string; overlay: RuntimeSnapshotOverlay }> = []
  const snapshotBatchCalls: Array<{ threadIds: string[]; overlays: Map<string, RuntimeSnapshotOverlay> }> = []
  const legacyReads: string[] = []
  const tokenUsageReads: string[] = []
  const dependencies = {
    runtimeRequestStore: {
      listRequestsByThread: (threadId: string) => {
        requestedThreads.push(threadId)
        return []
      },
    },
    runtimeStateStore: {
      snapshot: (threadId: string, overlay?: RuntimeSnapshotOverlay) => {
        overlays.push({ threadId, overlay: overlay ?? {} })
        return createThreadRuntimeSnapshot({ threadId, executionState: 'running', pendingServerRequests: overlay?.pendingServerRequests ?? [] })
      },
      snapshots: (threadIds: string[], overlaysByThreadId?: Map<string, RuntimeSnapshotOverlay>) => {
        snapshotBatchCalls.push({ threadIds, overlays: overlaysByThreadId ?? new Map() })
        return threadIds.map((threadId) => createThreadRuntimeSnapshot({ threadId }))
      },
    },
    reconcileRuntimeThread: async (threadId: string) => {
      reconciledThreads.push(threadId)
      return reconciledSnapshot
    },
    readLocalRuntimeSnapshot: (threadId: string) => ({ ...localSnapshot, threadId }),
    persistRuntimeSnapshot: (threadId: string, snapshot: ThreadRuntimeSnapshot) => {
      persisted.push({ threadId, snapshot })
      return persistedSnapshot
    },
    readThreadRuntimeSnapshot: async (threadId: string) => {
      legacyReads.push(threadId)
      return legacySnapshot
    },
    readCachedThreadTokenUsage: async (threadId: string) => {
      tokenUsageReads.push(threadId)
      return tokenUsage
    },
    listPendingServerRequestsForThread: (threadId: string) => [{
      id: 1,
      method: 'server/request',
      params: { threadId },
      receivedAtIso: '2026-01-01T00:00:00.000Z',
    }],
    getThreadTokenUsage: () => tokenUsage,
  }

  const runtimeThreadRead = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    runtimeThreadRead.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/thread/thread%20A'),
    dependencies,
  ), true)
  assert.deepEqual(JSON.parse(runtimeThreadRead.body), {
    data: {
      snapshot: { ...localSnapshot, threadId: 'thread A' },
      requests: [],
    },
  })
  assert.deepEqual(requestedThreads, ['thread A'])

  const runtimeThreadReconcile = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'POST' } as never,
    runtimeThreadReconcile.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/thread/thread-r/reconcile'),
    dependencies,
  ), true)
  assert.deepEqual(reconciledThreads, ['thread-r'])
  assert.deepEqual(JSON.parse(runtimeThreadReconcile.body), {
    data: {
      snapshot: reconciledSnapshot,
      requests: [],
    },
  })

  const missingRuntimeThread = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    missingRuntimeThread.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/thread/%20'),
    dependencies,
  ), true)
  assert.equal(missingRuntimeThread.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingRuntimeThread.body), { error: 'Missing threadId' })

  const runtimeSnapshotMissing = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    runtimeSnapshotMissing.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/snapshot'),
    dependencies,
  ), true)
  assert.equal(runtimeSnapshotMissing.response.statusCode, 400)
  assert.deepEqual(JSON.parse(runtimeSnapshotMissing.body), { error: 'Missing threadId' })

  const runtimeSnapshot = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    runtimeSnapshot.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/snapshot?threadId=thread-one'),
    dependencies,
  ), true)
  assert.deepEqual(persisted.map((item) => item.threadId), ['thread-one'])
  assert.deepEqual(overlays.map((item) => item.threadId), ['thread-one'])
  assert.deepEqual(JSON.parse(runtimeSnapshot.body), { data: persistedSnapshot })

  const runtimeSnapshots = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    runtimeSnapshots.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/snapshots?threadIds=thread-a,, thread-b ,%20'),
    dependencies,
  ), true)
  assert.deepEqual(snapshotBatchCalls[0].threadIds, ['thread-a', 'thread-b'])
  assert.equal(snapshotBatchCalls[0].overlays.has('thread-a'), true)
  assert.equal(snapshotBatchCalls[0].overlays.has('thread-b'), true)
  assert.deepEqual(JSON.parse(runtimeSnapshots.body).data.map((snapshot: ThreadRuntimeSnapshot) => snapshot.threadId), ['thread-a', 'thread-b'])

  const legacyState = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    legacyState.response as never,
    new URL('http://127.0.0.1/codex-api/state/thread/thread%20legacy'),
    dependencies,
  ), true)
  assert.deepEqual(legacyReads, ['thread legacy'])
  assert.deepEqual(JSON.parse(legacyState.body), { data: legacySnapshot })

  const missingLegacyState = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    missingLegacyState.response as never,
    new URL('http://127.0.0.1/codex-api/state/thread/%20'),
    dependencies,
  ), true)
  assert.equal(missingLegacyState.response.statusCode, 400)
  assert.deepEqual(JSON.parse(missingLegacyState.body), { error: 'Missing thread id' })

  const tokenUsageResponse = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    tokenUsageResponse.response as never,
    new URL('http://127.0.0.1/codex-api/thread-token-usage?threadId=thread-token'),
    dependencies,
  ), true)
  assert.deepEqual(tokenUsageReads, ['thread-token'])
  assert.deepEqual(JSON.parse(tokenUsageResponse.body), { data: { tokenUsage } })

  const tokenUsageMissing = createRouteTestResponse()
  assert.equal(await handleRuntimeStateRoutes(
    { method: 'GET' } as never,
    tokenUsageMissing.response as never,
    new URL('http://127.0.0.1/codex-api/thread-token-usage'),
    dependencies,
  ), true)
  assert.equal(tokenUsageMissing.response.statusCode, 400)
  assert.deepEqual(JSON.parse(tokenUsageMissing.body), { error: 'Missing threadId' })

  assert.equal(await handleRuntimeStateRoutes(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/thread-token-usage?threadId=thread-token'),
    dependencies,
  ), false)
}

function smokeNotificationSseRoute(): void {
  const request = Object.assign(new EventEmitter(), { method: 'GET' })
  const response = createSseRouteTestResponse()
  const timers: Array<() => void> = []
  const clearedTimers: unknown[] = []
  const unsubscribed: string[] = []
  const listeners: Array<(value: BridgeNotificationEvent) => void> = []

  const handled = handleNotificationSseRoute(
    request as never,
    response.response as never,
    new URL('http://127.0.0.1/codex-api/events'),
    {
      latestSeq: () => 42,
      nowIso: () => '2026-01-01T00:00:00.000Z',
      heartbeatIntervalMs: 10,
      setInterval: ((callback: () => void, intervalMs: number) => {
        assert.equal(intervalMs, 10)
        timers.push(callback)
        return { timerId: timers.length } as never
      }) as never,
      clearInterval: ((timer: unknown) => {
        clearedTimers.push(timer)
      }) as never,
      subscribeNotifications: (nextListener) => {
        listeners.push(nextListener)
        return () => {
          unsubscribed.push('yes')
        }
      },
    },
  )

  assert.equal(handled, true)
  assert.equal(response.response.statusCode, 200)
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform')
  assert.equal(response.headers.get('Connection'), 'keep-alive')
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no')
  assert.equal(response.chunks[0], 'event: ready\ndata: {"ok":true,"latestSeq":42}\n\n')
  assert.equal(timers.length, 1)
  assert.equal(listeners.length, 1)

  const notificationListener = listeners[0]
  assert.equal(typeof notificationListener, 'function')
  notificationListener({
    seq: 43,
    method: 'turn/completed',
    params: { ok: true },
    atIso: '2026-01-01T00:00:01.000Z',
  })
  assert.equal(response.chunks[1], 'data: {"seq":43,"method":"turn/completed","params":{"ok":true},"atIso":"2026-01-01T00:00:01.000Z"}\n\n')

  timers[0]()
  assert.equal(response.chunks[2], `data: ${JSON.stringify({
    method: BRIDGE_HEARTBEAT_METHOD,
    params: { ok: true },
    atIso: '2026-01-01T00:00:00.000Z',
  })}\n\n`)

  request.emit('close')
  assert.equal(response.ended, true)
  assert.equal(clearedTimers.length, 1)
  assert.deepEqual(unsubscribed, ['yes'])

  assert.equal(handleNotificationSseRoute(
    Object.assign(new EventEmitter(), { method: 'POST' }) as never,
    createSseRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/events'),
    {
      latestSeq: 1,
      subscribeNotifications: () => {
        throw new Error('unexpected SSE subscription')
      },
    },
  ), false)
}

function smokeNotificationReplayRoute(): void {
  assert.deepEqual(
    readNotificationReplayQuery(new URL('http://127.0.0.1/codex-api/events/replay?after=12&limit=5')),
    { afterSeq: 12, limit: 5 },
  )
  assert.deepEqual(
    readNotificationReplayQuery(new URL('http://127.0.0.1/codex-api/runtime/events?afterSeq=bad&after=12&limit=bad')),
    { afterSeq: 0, limit: 200 },
  )

  const calls: Array<{ afterSeq: number; limit: number }> = []
  const response = createRouteTestResponse()
  const handled = handleNotificationReplayRoute(
    { method: 'GET' } as never,
    response.response as never,
    new URL('http://127.0.0.1/codex-api/runtime/events?afterSeq=7&limit=3'),
    (afterSeq, limit) => {
      calls.push({ afterSeq, limit })
      return {
        notifications: [{ seq: afterSeq + 1, method: 'turn/completed', params: {}, atIso: '2026-01-01T00:00:00.000Z' }],
        latestSeq: afterSeq + 1,
        oldestSeq: afterSeq + 1,
      }
    },
  )
  assert.equal(handled, true)
  assert.deepEqual(calls, [{ afterSeq: 7, limit: 3 }])
  assert.equal(response.response.statusCode, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(response.body), {
    data: {
      notifications: [{ seq: 8, method: 'turn/completed', params: {}, atIso: '2026-01-01T00:00:00.000Z' }],
      latestSeq: 8,
      oldestSeq: 8,
    },
  })

  assert.equal(handleNotificationReplayRoute(
    { method: 'POST' } as never,
    createRouteTestResponse().response as never,
    new URL('http://127.0.0.1/codex-api/runtime/events'),
    () => {
      throw new Error('unexpected replay call')
    },
  ), false)
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

async function withTranscriptionEnvAsync(
  values: Record<string, string | undefined>,
  callback: () => Promise<void>,
): Promise<void> {
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
    await callback()
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

function createTranscriptionRouteTestRequest(body: Buffer, contentType: string) {
  return Object.assign(Readable.from([body]), {
    headers: {
      'content-type': contentType,
    },
  }) as never
}

function createTranscriptionRouteTestResponse() {
  return createRouteTestResponse()
}

function createSseRouteTestResponse() {
  const headers = new Map<string, string | number | readonly string[]>()
  const chunks: string[] = []
  let ended = false
  const response = {
    statusCode: 0,
    destroyed: false,
    get writableEnded() {
      return ended
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value)
    },
    write(value: string | Buffer) {
      chunks.push(Buffer.isBuffer(value) ? value.toString('utf8') : value)
      return true
    },
    end() {
      ended = true
    },
  }

  return {
    response,
    headers,
    chunks,
    get ended() {
      return ended
    },
  }
}

function createRouteTestResponse() {
  const headers = new Map<string, string | number | readonly string[]>()
  let endedBody = ''
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value)
    },
    end(value?: string | Buffer) {
      endedBody = Buffer.isBuffer(value) ? value.toString('utf8') : value ?? ''
    },
  }

  return {
    response,
    headers,
    get body() {
      return endedBody
    },
  }
}

function readIncludeTurns(payload: unknown): boolean | undefined {
  const value = asRecord(payload)?.includeTurns
  return typeof value === 'boolean' ? value : undefined
}

function readBooleanProperty(payload: unknown, key: string): boolean {
  return asRecord(payload)?.[key] === true
}

function readStringProperty(payload: unknown, key: string): string {
  const value = asRecord(payload)?.[key]
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
