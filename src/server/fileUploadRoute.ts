import type { IncomingMessage, ServerResponse } from 'node:http'

import { getErrorMessage } from './errorMessage.js'
import {
  FileUploadError,
  handleMultipartFileUpload,
} from './fileUpload.js'
import { setJson } from './httpJsonResponse.js'

export type FileUploadRouteDependencies = {
  handleMultipartFileUpload?: typeof handleMultipartFileUpload
  getErrorMessage?: typeof getErrorMessage
}

export async function handleFileUploadRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: FileUploadRouteDependencies = {},
): Promise<boolean> {
  if (req.method !== 'POST' || url.pathname !== '/codex-api/upload-file') {
    return false
  }

  const uploadFile = dependencies.handleMultipartFileUpload ?? handleMultipartFileUpload
  const readErrorMessage = dependencies.getErrorMessage ?? getErrorMessage
  try {
    const result = await uploadFile(req)
    setJson(res, 200, result)
  } catch (error) {
    const statusCode = error instanceof FileUploadError ? error.statusCode : 500
    setJson(res, statusCode, { error: readErrorMessage(error, 'Upload failed') })
  }
  return true
}
