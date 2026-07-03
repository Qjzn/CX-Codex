import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export type TranscriptionProxyResult = {
  status: number
  body: string
}

export type TranscriptionEndpointSnapshot = {
  isDefault: boolean
  host: string
  path: string
}

export type TranscriptionProxyConfigSnapshot = {
  provider: 'openai' | 'chatgpt'
  officialApiConfigured: boolean
  model: string
  responseFormat: 'json'
  requestBodyLimitBytes: number
  requestBodyLimitMiB: number
  endpoint: TranscriptionEndpointSnapshot
}

const CHATGPT_TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe'
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const DEFAULT_OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe'
const DEFAULT_OPENAI_TRANSCRIBE_RESPONSE_FORMAT = 'json'
const TRANSCRIBE_REQUEST_BODY_LIMIT_BYTES = 26 * 1024 * 1024

let curlImpersonateAvailable: boolean | null = null

function httpPost(
  url: string,
  headers: Record<string, string | number>,
  body: Buffer,
): Promise<TranscriptionProxyResult> {
  const doRequest = url.startsWith('http://') ? httpRequest : httpsRequest
  return new Promise((resolve, reject) => {
    const req = doRequest(url, { method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function curlImpersonatePost(
  url: string,
  headers: Record<string, string | number>,
  body: Buffer,
): Promise<TranscriptionProxyResult> {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-w', '\n%{http_code}', '-X', 'POST', url]
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-length') continue
      args.push('-H', `${key}: ${String(value)}`)
    }
    args.push('--data-binary', '@-')
    const proc = spawn('curl-impersonate-chrome', args, {
      env: { ...process.env, CURL_IMPERSONATE: 'chrome116' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.on('error', (error) => {
      curlImpersonateAvailable = false
      reject(error)
    })
    proc.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const lastNewline = raw.lastIndexOf('\n')
      const statusStr = lastNewline >= 0 ? raw.slice(lastNewline + 1).trim() : ''
      const responseBody = lastNewline >= 0 ? raw.slice(0, lastNewline) : raw
      const status = parseInt(statusStr, 10) || (code === 0 ? 200 : 500)
      curlImpersonateAvailable = true
      resolve({ status, body: responseBody })
    })
    proc.stdin.write(body)
    proc.stdin.end()
  })
}

function readTranscribeEnv(name: string): string {
  return (
    process.env[`CX_CODEX_${name}`]?.trim() ||
    process.env[`CODEXUI_${name}`]?.trim() ||
    process.env[name]?.trim() ||
    ''
  )
}

export function getOpenAiTranscribeApiKey(): string {
  return readTranscribeEnv('OPENAI_API_KEY')
}

export function getOpenAiTranscribeModel(): string {
  return readTranscribeEnv('OPENAI_TRANSCRIBE_MODEL') || DEFAULT_OPENAI_TRANSCRIBE_MODEL
}

function getOpenAiTranscribeUrl(): string {
  return readTranscribeEnv('OPENAI_TRANSCRIBE_URL') || OPENAI_TRANSCRIBE_URL
}

export function getTranscribeRequestBodyLimitBytes(): number {
  const configured = Number.parseInt(readTranscribeEnv('OPENAI_TRANSCRIBE_MAX_BYTES'), 10)
  if (Number.isFinite(configured) && configured > 0) return configured
  return TRANSCRIBE_REQUEST_BODY_LIMIT_BYTES
}

function snapshotTranscribeEndpoint(url: string): TranscriptionEndpointSnapshot {
  try {
    const parsed = new URL(url)
    return {
      isDefault: url === OPENAI_TRANSCRIBE_URL,
      host: parsed.host,
      path: parsed.pathname,
    }
  } catch {
    return {
      isDefault: false,
      host: 'invalid-url',
      path: '',
    }
  }
}

export function getTranscriptionProxyConfigSnapshot(): TranscriptionProxyConfigSnapshot {
  const officialApiConfigured = getOpenAiTranscribeApiKey().length > 0
  const requestBodyLimitBytes = getTranscribeRequestBodyLimitBytes()
  return {
    provider: officialApiConfigured ? 'openai' : 'chatgpt',
    officialApiConfigured,
    model: getOpenAiTranscribeModel(),
    responseFormat: DEFAULT_OPENAI_TRANSCRIBE_RESPONSE_FORMAT,
    requestBodyLimitBytes,
    requestBodyLimitMiB: Math.round((requestBodyLimitBytes / 1024 / 1024) * 10) / 10,
    endpoint: snapshotTranscribeEndpoint(getOpenAiTranscribeUrl()),
  }
}

function getMultipartBoundary(contentType: string): string {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/iu)
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

function appendMultipartTextField(body: Buffer, boundary: string, name: string, value: string): Buffer {
  const finalBoundary = Buffer.from(`--${boundary}--`)
  const finalBoundaryIndex = body.lastIndexOf(finalBoundary)
  if (finalBoundaryIndex < 0) return body

  const prefix = body.subarray(0, finalBoundaryIndex)
  const suffix = body.subarray(finalBoundaryIndex)
  const separator = prefix.length > 0 && !prefix.subarray(-2).equals(Buffer.from('\r\n')) ? '\r\n' : ''
  const field = Buffer.from(
    `${separator}--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
    `${value}\r\n`,
  )
  return Buffer.concat([prefix, field, suffix])
}

function prepareOpenAiTranscribeBody(body: Buffer, contentType: string): Buffer {
  const boundary = getMultipartBoundary(contentType)
  if (!boundary) return body

  let nextBody = body
  if (!body.includes(Buffer.from('name="model"'))) {
    nextBody = appendMultipartTextField(nextBody, boundary, 'model', getOpenAiTranscribeModel())
  }
  if (!body.includes(Buffer.from('name="response_format"'))) {
    nextBody = appendMultipartTextField(nextBody, boundary, 'response_format', DEFAULT_OPENAI_TRANSCRIBE_RESPONSE_FORMAT)
  }
  return nextBody
}

export async function proxyOpenAiTranscribe(
  body: Buffer,
  contentType: string,
  apiKey: string,
): Promise<TranscriptionProxyResult> {
  const upstreamBody = prepareOpenAiTranscribeBody(body, contentType)
  return httpPost(getOpenAiTranscribeUrl(), {
    'Content-Type': contentType,
    'Content-Length': upstreamBody.length,
    Authorization: `Bearer ${apiKey}`,
  }, upstreamBody)
}

export async function proxyChatGptTranscribe(
  body: Buffer,
  contentType: string,
  authToken: string,
  accountId?: string,
): Promise<TranscriptionProxyResult> {
  const chatgptHeaders: Record<string, string | number> = {
    'Content-Type': contentType,
    'Content-Length': body.length,
    Authorization: `Bearer ${authToken}`,
    originator: 'Codex Desktop',
    'User-Agent': `Codex Desktop/0.1.0 (${process.platform}; ${process.arch})`,
  }
  if (accountId) chatgptHeaders['ChatGPT-Account-Id'] = accountId

  const postFn = curlImpersonateAvailable !== false ? curlImpersonatePost : httpPost
  let result: TranscriptionProxyResult
  try {
    result = await postFn(CHATGPT_TRANSCRIBE_URL, chatgptHeaders, body)
  } catch {
    result = await httpPost(CHATGPT_TRANSCRIBE_URL, chatgptHeaders, body)
  }

  if (result.status === 403 && result.body.includes('cf_chl')) {
    if (curlImpersonateAvailable !== false && postFn !== curlImpersonatePost) {
      try {
        const ciResult = await curlImpersonatePost(CHATGPT_TRANSCRIBE_URL, chatgptHeaders, body)
        if (ciResult.status !== 403) return ciResult
      } catch {}
    }
    return { status: 503, body: JSON.stringify({ error: 'Transcription blocked by Cloudflare. Install curl-impersonate-chrome.' }) }
  }

  return result
}
