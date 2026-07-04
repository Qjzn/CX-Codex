import type { IncomingMessage, ServerResponse } from 'node:http'

import { readCodexAuth } from './codexAuth.js'
import {
  readHeaderValue,
  readRawBody,
  RequestBodyTooLargeError,
} from './httpBody.js'
import { setJson } from './httpJsonResponse.js'
import {
  getOpenAiTranscribeApiKey,
  getTranscribeRequestBodyLimitBytes,
  proxyChatGptTranscribe,
  proxyOpenAiTranscribe,
  type TranscriptionProxyResult,
} from './transcriptionProxy.js'

export async function handleTranscriptionRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: Buffer
  try {
    rawBody = await readRawBody(req, { maxBytes: getTranscribeRequestBodyLimitBytes() })
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      setJson(res, 413, { error: `Transcription upload is too large. Maximum request size is ${err.maxBytes} bytes.` })
      return
    }
    throw err
  }

  const incomingCt = readHeaderValue(req.headers['content-type'], 'application/octet-stream')
  const openAiApiKey = getOpenAiTranscribeApiKey()
  let upstream: TranscriptionProxyResult
  if (openAiApiKey) {
    upstream = await proxyOpenAiTranscribe(rawBody, incomingCt, openAiApiKey)
  } else {
    const auth = await readCodexAuth()
    if (!auth) {
      setJson(res, 401, { error: 'No auth token available for transcription' })
      return
    }
    upstream = await proxyChatGptTranscribe(rawBody, incomingCt, auth.accessToken, auth.accountId)
  }

  res.statusCode = upstream.status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(upstream.body)
}
