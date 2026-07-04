import type { ServerResponse } from 'node:http'
import { logBridgeError } from './bridgeLog.js'
import { getErrorMessage } from './errorMessage.js'
import { RequestBodyTooLargeError } from './httpBody.js'
import { setJson } from './httpJsonResponse.js'

export type CodexBridgeRequestErrorDetails = {
  requestMethod: string
  requestPath: string
}

export function writeCodexBridgeRequestError(
  res: ServerResponse,
  error: unknown,
  details: CodexBridgeRequestErrorDetails,
): void {
  if (error instanceof RequestBodyTooLargeError) {
    setJson(res, 413, { error: `Request body is too large. Maximum request size is ${error.maxBytes} bytes.` })
    return
  }

  const message = getErrorMessage(error, 'Unknown bridge error')
  logBridgeError('Bridge request failed', error, details)
  setJson(res, 502, { error: message })
}
