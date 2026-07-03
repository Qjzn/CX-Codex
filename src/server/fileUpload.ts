import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RequestBodyTooLargeError, readRawBody } from './httpBody.js'

export type ParsedMultipartFileUpload = {
  fileName: string
  fileData: Buffer
}

const FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024

export class FileUploadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly maxBytes?: number,
  ) {
    super(message)
    this.name = 'FileUploadError'
  }
}

function readUploadEnv(name: string): string {
  return (
    process.env[`CX_CODEX_${name}`]?.trim() ||
    process.env[`CODEXUI_${name}`]?.trim() ||
    process.env[name]?.trim() ||
    ''
  )
}

export function getFileUploadRequestBodyLimitBytes(): number {
  const configured = Number.parseInt(readUploadEnv('FILE_UPLOAD_MAX_BYTES'), 10)
  if (Number.isFinite(configured) && configured > 0) return configured
  return FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES
}

export function bufferIndexOf(buf: Buffer, needle: Buffer, start = 0): number {
  for (let i = start; i <= buf.length - needle.length; i++) {
    let match = true
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { match = false; break }
    }
    if (match) return i
  }
  return -1
}

function readContentType(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export function readMultipartBoundary(contentType: string): string {
  const boundaryMatch = contentType.match(/boundary=(.+)/i)
  if (!boundaryMatch) throw new FileUploadError('Missing multipart boundary', 400)
  return boundaryMatch[1]
}

export function parseMultipartFileUpload(body: Buffer, contentType: string): ParsedMultipartFileUpload {
  const boundary = readMultipartBoundary(contentType)
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []
  let searchStart = 0
  while (searchStart < body.length) {
    const idx = body.indexOf(boundaryBuf, searchStart)
    if (idx < 0) break
    if (searchStart > 0) parts.push(body.subarray(searchStart, idx))
    searchStart = idx + boundaryBuf.length
    if (body[searchStart] === 0x0d && body[searchStart + 1] === 0x0a) searchStart += 2
  }

  const headerSep = Buffer.from('\r\n\r\n')
  for (const part of parts) {
    const headerEnd = bufferIndexOf(part, headerSep)
    if (headerEnd < 0) continue
    const headers = part.subarray(0, headerEnd).toString('utf8')
    const fnMatch = headers.match(/filename="([^"]+)"/i)
    if (!fnMatch) continue

    const fileName = fnMatch[1].replace(/[/\\]/g, '_')
    let end = part.length
    if (end >= 2 && part[end - 2] === 0x0d && part[end - 1] === 0x0a) end -= 2
    return {
      fileName,
      fileData: part.subarray(headerEnd + 4, end),
    }
  }

  throw new FileUploadError('No file in request', 400)
}

export async function readRequestBody(req: IncomingMessage, options: { maxBytes?: number } = {}): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? getFileUploadRequestBodyLimitBytes()
  try {
    return await readRawBody(req, { maxBytes })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new FileUploadError(`Upload is too large. Maximum request size is ${error.maxBytes} bytes.`, 413, error.maxBytes)
    }
    throw error
  }
}

export async function writeUploadedFile(
  upload: ParsedMultipartFileUpload,
  uploadDir = join(tmpdir(), 'codex-web-uploads'),
): Promise<string> {
  await mkdir(uploadDir, { recursive: true })
  const destDir = await mkdtemp(join(uploadDir, 'f-'))
  const destPath = join(destDir, upload.fileName)
  await writeFile(destPath, upload.fileData)
  return destPath
}

export async function handleMultipartFileUpload(req: IncomingMessage): Promise<{ path: string }> {
  const body = await readRequestBody(req)
  const upload = parseMultipartFileUpload(body, readContentType(req.headers['content-type']))
  const path = await writeUploadedFile(upload)
  return { path }
}
