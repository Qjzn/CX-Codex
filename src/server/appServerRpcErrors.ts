import { getErrorMessage } from './errorMessage.js'

export const APP_SERVER_OVERLOADED_ERROR_CODE = -32001

export class AppServerJsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'AppServerJsonRpcError'
  }
}

export function createAppServerJsonRpcError(error: { code: number; message: string }): AppServerJsonRpcError {
  return new AppServerJsonRpcError(error.code, error.message)
}

export function isAppServerOverloadedError(error: unknown): boolean {
  if (error instanceof AppServerJsonRpcError) {
    return error.code === APP_SERVER_OVERLOADED_ERROR_CODE
  }
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return code === APP_SERVER_OVERLOADED_ERROR_CODE
  }
  return false
}

export function isThreadMaterializingError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase()
  if (!message) return false
  return (
    message.includes('is not materialized yet') ||
    message.includes('includeturns is unavailable before first user message') ||
    message.includes('no rollout found for thread id') ||
    (message.includes('rollout') && message.includes('is empty')) ||
    message.includes('does not start with session metadata') ||
    (message.includes('thread-store internal error') && message.includes('failed to read thread'))
  )
}

export function createRpcTimeoutError(method: string, timeoutMs: number): Error {
  const error = new Error(`${method} timed out after ${Math.ceil(timeoutMs / 1000)}s`)
  error.name = 'AppServerRpcTimeoutError'
  return error
}

export function isRpcTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AppServerRpcTimeoutError'
}

export function isInterruptSettledError(error: unknown): boolean {
  if (isRpcTimeoutError(error)) return false
  const message = getErrorMessage(error, '').toLowerCase()
  if (!message) return false
  return (
    message.includes('no active turn') ||
    message.includes('not running') ||
    message.includes('already completed') ||
    message.includes('cannot interrupt') ||
    message.includes('unable to interrupt') ||
    message.includes('active turn not found')
  )
}
