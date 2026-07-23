import { isRpcTimeoutError } from './appServerRpcErrors.js'
import {
  readThreadIdFromPayload,
  readTurnIdFromPayload,
} from './appServerPayloadIds.js'
import {
  createRuntimePromptHash,
  normalizePlanModeTurnStartParams,
  parseRuntimeSendPayload,
  shouldRetryPlanModeWithoutNativeMode,
  type ParsedRuntimeSendPayload,
} from './runtimePayload.js'
import type {
  RuntimeRequestRecord,
  RuntimeRequestStatus,
} from './runtimeStore.js'

export type RuntimeStartResult = {
  request: RuntimeRequestRecord
  threadId: string
  turnId: string
  status: RuntimeRequestStatus
}

export type RuntimeStartDependencies = {
  createRequest(record: {
    requestId: string
    clientMessageId: string
    threadId: string
    status: RuntimeRequestStatus
    promptHash: string
    mode: string
    payload: unknown
  }): RuntimeRequestRecord
  updateRequest(
    requestId: string,
    patch: {
      threadId?: string
      turnId?: string
      status?: RuntimeRequestStatus
      lastError?: string | null
      incrementRetry?: boolean
    },
  ): RuntimeRequestRecord | null
  getRequest(requestId: string): RuntimeRequestRecord | null
  getLatestRequestByClientMessageId(clientMessageId: string): RuntimeRequestRecord | null
  rpc(method: string, params: unknown): Promise<unknown>
  clearThreadSearchIndex(): void
  markStarting(threadId: string): void
  markRunning(threadId: string, turnId?: string): void
  markStartUncertain(threadId: string, lastError?: string | null): void
  markFailed(threadId: string, lastError?: string | null): void
  persistRuntimeSnapshot(threadId: string): { activeTurnId: string }
  markPlanModeTurn(threadId: string, turnId?: string): void
  getErrorMessage(error: unknown, fallback: string): string
}

export function createAppServerRuntimeTurnStarter(
  dependencies: RuntimeStartDependencies,
): (payload: unknown) => Promise<RuntimeStartResult> {
  const inFlightByClientMessageId = new Map<string, {
    signature: string
    promise: Promise<RuntimeStartResult>
  }>()

  return async (payload) => {
    const parsed = parseRuntimeSendPayload(payload)
    const promptHash = createRuntimePromptHash(parsed.input)
    const signature = runtimeSendIdempotencySignature(parsed, promptHash)
    const clientMessageId = parsed.clientMessageId
    const existing = clientMessageId
      ? dependencies.getLatestRequestByClientMessageId(clientMessageId)
      : null
    if (existing && !runtimeRequestMatchesParsed(existing, parsed, promptHash)) {
      throw new Error('clientMessageId already belongs to different message content')
    }
    const inFlight = clientMessageId ? inFlightByClientMessageId.get(clientMessageId) : undefined
    if (inFlight) {
      if (inFlight.signature !== signature) {
        throw new Error('clientMessageId already belongs to different message content')
      }
      const accepted = dependencies.getLatestRequestByClientMessageId(clientMessageId)
      if (!accepted || accepted.status === 'failed') return await inFlight.promise
      return runtimeStartResultFromRequest(accepted)
    }

    const promise = startParsedRuntimeTurnWithAppServer(parsed, promptHash, dependencies)
    if (clientMessageId) {
      inFlightByClientMessageId.set(clientMessageId, { signature, promise })
      void promise.then(
        () => clearInFlightRuntimeStart(inFlightByClientMessageId, clientMessageId, promise),
        () => clearInFlightRuntimeStart(inFlightByClientMessageId, clientMessageId, promise),
      )
      const accepted = dependencies.getLatestRequestByClientMessageId(clientMessageId)
      if (accepted) {
        if (accepted.status === 'failed') return await promise
        return runtimeStartResultFromRequest(accepted)
      }
    }
    return await promise
  }
}

export async function startRuntimeTurnWithAppServer(
  payload: unknown,
  dependencies: RuntimeStartDependencies,
): Promise<RuntimeStartResult> {
  const parsed = parseRuntimeSendPayload(payload)
  return await startParsedRuntimeTurnWithAppServer(
    parsed,
    createRuntimePromptHash(parsed.input),
    dependencies,
  )
}

async function startParsedRuntimeTurnWithAppServer(
  parsed: ParsedRuntimeSendPayload,
  promptHash: string,
  dependencies: RuntimeStartDependencies,
): Promise<RuntimeStartResult> {
  let threadId = parsed.threadId
  let requestId = parsed.requestId
  let shouldCreateRequest = true

  if (parsed.clientMessageId) {
    const existing = dependencies.getLatestRequestByClientMessageId(parsed.clientMessageId)
    if (existing) {
      if (!runtimeRequestMatchesParsed(existing, parsed, promptHash)) {
        throw new Error('clientMessageId already belongs to different message content')
      }
      if (existing.status === 'pending_start') {
        requestId = existing.requestId
        threadId = existing.threadId || threadId
        shouldCreateRequest = false
        dependencies.updateRequest(existing.requestId, { incrementRetry: true })
      } else {
        const retried = dependencies.updateRequest(existing.requestId, { incrementRetry: true }) ?? existing
        if (retried.status === 'failed') {
          throw new Error(retried.lastError || 'Previous send attempt failed')
        }
        return runtimeStartResultFromRequest(retried)
      }
    }
  }

  if (shouldCreateRequest) {
    dependencies.createRequest({
      requestId,
      clientMessageId: parsed.clientMessageId,
      threadId,
      status: 'pending_start',
      promptHash,
      mode: parsed.mode,
      payload: parsed.payloadSummary,
    })
  }

  try {
    if (!threadId) {
      const threadParams = createRuntimeThreadStartParams(parsed)
      const startedThread = await dependencies.rpc('thread/start', threadParams)
      threadId = readThreadIdFromPayload(startedThread)
      if (!threadId) throw new Error('thread/start did not return a thread id')
      dependencies.clearThreadSearchIndex()
      dependencies.updateRequest(requestId, {
        threadId,
        status: 'pending_start',
      })
    }

    const turnParams = createRuntimeTurnStartParams({
      threadId,
      input: parsed.input,
      attachments: parsed.attachments,
      model: parsed.model,
      effort: parsed.effort,
      mode: parsed.mode,
    })

    dependencies.markStarting(threadId)
    dependencies.persistRuntimeSnapshot(threadId)
    dependencies.updateRequest(requestId, {
      status: 'starting',
      threadId,
    })

    const rpcResult = await startRuntimeTurnRpc(turnParams, parsed.mode, dependencies)
    const turnId = readTurnIdFromPayload(rpcResult)
    if (parsed.mode === 'plan') {
      dependencies.markPlanModeTurn(threadId, turnId)
    }
    dependencies.markRunning(threadId, turnId)
    const snapshot = dependencies.persistRuntimeSnapshot(threadId)
    const effectiveTurnId = turnId || snapshot.activeTurnId
    const request = dependencies.updateRequest(requestId, {
      status: 'running',
      threadId,
      turnId: effectiveTurnId,
      lastError: null,
    }) ?? dependencies.getRequest(requestId)
    return {
      request: request as RuntimeRequestRecord,
      threadId,
      turnId: effectiveTurnId,
      status: 'running',
    }
  } catch (error) {
    if (threadId && isRpcTimeoutError(error)) {
      const lastError = dependencies.getErrorMessage(error, 'turn/start timed out')
      dependencies.markStartUncertain(threadId, lastError)
      dependencies.persistRuntimeSnapshot(threadId)
      const request = dependencies.updateRequest(requestId, {
        status: 'start_uncertain',
        threadId,
        lastError,
      }) ?? dependencies.getRequest(requestId)
      return {
        request: request as RuntimeRequestRecord,
        threadId,
        turnId: '',
        status: 'start_uncertain',
      }
    }

    const lastError = dependencies.getErrorMessage(error, 'runtime send failed')
    dependencies.updateRequest(requestId, {
      status: 'failed',
      threadId,
      lastError,
    })
    if (threadId) {
      dependencies.markFailed(threadId, lastError)
      dependencies.persistRuntimeSnapshot(threadId)
    }
    throw error
  }
}

function runtimeRequestMatchesParsed(
  existing: RuntimeRequestRecord,
  parsed: ParsedRuntimeSendPayload,
  promptHash: string,
): boolean {
  return existing.promptHash === promptHash
    && existing.mode === parsed.mode
    && !(parsed.threadId && existing.threadId && existing.threadId !== parsed.threadId)
}

function clearInFlightRuntimeStart(
  inFlightByClientMessageId: Map<string, { signature: string; promise: Promise<RuntimeStartResult> }>,
  clientMessageId: string,
  promise: Promise<RuntimeStartResult>,
): void {
  if (inFlightByClientMessageId.get(clientMessageId)?.promise === promise) {
    inFlightByClientMessageId.delete(clientMessageId)
  }
}

export function createRuntimeThreadStartParams(
  parsed: Pick<ParsedRuntimeSendPayload, 'cwd' | 'model'>,
  platform = process.platform,
): Record<string, unknown> {
  const threadParams: Record<string, unknown> = {}
  if (parsed.cwd) threadParams.cwd = parsed.cwd
  if (parsed.model) threadParams.model = parsed.model
  if (platform === 'win32') {
    threadParams.config = {
      'features.shell_snapshot': false,
    }
  }
  return threadParams
}

function runtimeStartResultFromRequest(request: RuntimeRequestRecord): RuntimeStartResult {
  return {
    request,
    threadId: request.threadId,
    turnId: request.turnId,
    status: request.status,
  }
}

function runtimeSendIdempotencySignature(parsed: ParsedRuntimeSendPayload, promptHash: string): string {
  return [promptHash, parsed.mode, parsed.threadId].join('\u001f')
}

function createRuntimeTurnStartParams(args: {
  threadId: string
  input: unknown[]
  attachments: unknown
  model: string
  effort: unknown
  mode: string
}): Record<string, unknown> {
  const turnParams: Record<string, unknown> = {
    threadId: args.threadId,
    input: args.input,
  }
  if (Array.isArray(args.attachments) && args.attachments.length > 0) {
    turnParams.attachments = args.attachments
  }
  if (args.model) turnParams.model = args.model
  const effort = typeof args.effort === 'string' ? args.effort.trim() : ''
  if (effort) turnParams.effort = effort
  if (args.mode === 'plan') turnParams.collaborationMode = 'plan'
  return turnParams
}

async function startRuntimeTurnRpc(
  turnParams: Record<string, unknown>,
  mode: string,
  dependencies: RuntimeStartDependencies,
): Promise<unknown> {
  let rpcParams: unknown = mode === 'plan'
    ? normalizePlanModeTurnStartParams(turnParams, { includeNativeMode: true })
    : turnParams
  try {
    return await startRuntimeTurnRpcWithResume(rpcParams, dependencies)
  } catch (error) {
    if (mode !== 'plan' || !shouldRetryPlanModeWithoutNativeMode(error)) {
      throw error
    }
    rpcParams = normalizePlanModeTurnStartParams(turnParams, { includeNativeMode: false })
    return await startRuntimeTurnRpcWithResume(rpcParams, dependencies)
  }
}

async function startRuntimeTurnRpcWithResume(
  rpcParams: unknown,
  dependencies: RuntimeStartDependencies,
): Promise<unknown> {
  try {
    return await dependencies.rpc('turn/start', rpcParams)
  } catch (error) {
    const threadId = readRuntimeThreadId(rpcParams)
    const message = dependencies.getErrorMessage(error, '').toLowerCase()
    if (!threadId || !message.includes('thread not found')) throw error
    await dependencies.rpc('thread/resume', { threadId })
    return await dependencies.rpc('turn/start', rpcParams)
  }
}

function readRuntimeThreadId(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const threadId = (payload as Record<string, unknown>).threadId
  return typeof threadId === 'string' ? threadId.trim() : ''
}
