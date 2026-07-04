import {
  isInterruptSettledError,
  isRpcTimeoutError,
} from './appServerRpcErrors.js'
import { parseRuntimeInterruptPayload } from './runtimePayload.js'
import type {
  RuntimeRequestRecord,
  RuntimeRequestStatus,
} from './runtimeStore.js'

export type RuntimeInterruptResult = {
  requestId: string
  threadId: string
  turnId: string
  status: RuntimeRequestStatus
}

export type RuntimeInterruptDependencies = {
  createRequest(record: {
    requestId: string
    threadId: string
    turnId: string
    status: RuntimeRequestStatus
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
    },
  ): RuntimeRequestRecord | null
  rpc(method: string, params: unknown): Promise<unknown>
  markStopping(threadId: string): void
  markInterrupted(threadId: string, lastError?: string | null): void
  markStopUncertain(threadId: string, lastError?: string | null): void
  persistRuntimeSnapshot(threadId: string): unknown
  clearPlanModeTurn(threadId: string, turnId?: string): void
  getErrorMessage(error: unknown, fallback: string): string
}

export async function interruptRuntimeTurnWithAppServer(
  payload: unknown,
  dependencies: RuntimeInterruptDependencies,
): Promise<RuntimeInterruptResult> {
  const parsed = parseRuntimeInterruptPayload(payload)
  dependencies.createRequest({
    requestId: parsed.requestId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    status: 'stopping',
    mode: 'interrupt',
    payload: parsed.payloadSummary,
  })
  dependencies.markStopping(parsed.threadId)
  dependencies.persistRuntimeSnapshot(parsed.threadId)

  try {
    await dependencies.rpc('turn/interrupt', { threadId: parsed.threadId, turnId: parsed.turnId })
    return completeRuntimeInterrupt(parsed, dependencies)
  } catch (error) {
    if (isInterruptSettledError(error)) {
      return completeRuntimeInterrupt(parsed, dependencies, dependencies.getErrorMessage(error, 'turn already settled'))
    }

    if (isRpcTimeoutError(error)) {
      const lastError = dependencies.getErrorMessage(error, 'turn/interrupt timed out')
      dependencies.markStopUncertain(parsed.threadId, lastError)
      dependencies.persistRuntimeSnapshot(parsed.threadId)
      dependencies.updateRequest(parsed.requestId, {
        status: 'stop_uncertain',
        threadId: parsed.threadId,
        turnId: parsed.turnId,
        lastError,
      })
      return createRuntimeInterruptResult(parsed, 'stop_uncertain')
    }

    dependencies.updateRequest(parsed.requestId, {
      status: 'failed',
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      lastError: dependencies.getErrorMessage(error, 'runtime interrupt failed'),
    })
    throw error
  }
}

type ParsedRuntimeInterrupt = ReturnType<typeof parseRuntimeInterruptPayload>

function completeRuntimeInterrupt(
  parsed: ParsedRuntimeInterrupt,
  dependencies: RuntimeInterruptDependencies,
  lastError: string | null = null,
): RuntimeInterruptResult {
  dependencies.clearPlanModeTurn(parsed.threadId, parsed.turnId)
  dependencies.markInterrupted(parsed.threadId, lastError)
  dependencies.persistRuntimeSnapshot(parsed.threadId)
  dependencies.updateRequest(parsed.requestId, {
    status: 'stopped',
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    lastError: null,
  })
  return createRuntimeInterruptResult(parsed, 'stopped')
}

function createRuntimeInterruptResult(
  parsed: ParsedRuntimeInterrupt,
  status: RuntimeRequestStatus,
): RuntimeInterruptResult {
  return {
    requestId: parsed.requestId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    status,
  }
}
