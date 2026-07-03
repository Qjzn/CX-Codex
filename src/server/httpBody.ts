import type { IncomingMessage } from 'node:http'

const JSON_REQUEST_BODY_LIMIT_BYTES = 2 * 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`)
  }
}

function readBodyLimitEnv(name: string): string {
  return (
    process.env[`CX_CODEX_${name}`]?.trim() ||
    process.env[`CODEXUI_${name}`]?.trim() ||
    process.env[name]?.trim() ||
    ''
  )
}

export function getJsonRequestBodyLimitBytes(): number {
  const configured = Number.parseInt(readBodyLimitEnv('JSON_BODY_MAX_BYTES'), 10)
  if (Number.isFinite(configured) && configured > 0) return configured
  return JSON_REQUEST_BODY_LIMIT_BYTES
}

export async function readRawBody(req: IncomingMessage, options: { maxBytes?: number } = {}): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    totalBytes += buffer.length
    if (typeof options.maxBytes === 'number' && options.maxBytes > 0 && totalBytes > options.maxBytes) {
      throw new RequestBodyTooLargeError(options.maxBytes)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function readJsonBody(req: IncomingMessage, options: { maxBytes?: number } = {}): Promise<unknown> {
  const raw = await readRawBody(req, { maxBytes: options.maxBytes ?? getJsonRequestBodyLimitBytes() })
  if (raw.length === 0) return null
  const text = raw.toString('utf8').trim()
  if (text.length === 0) return null
  return JSON.parse(text) as unknown
}

export function readHeaderValue(value: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}
