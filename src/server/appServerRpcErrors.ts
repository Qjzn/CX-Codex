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
