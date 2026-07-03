import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type ParsedMultipartFileUpload = {
  fileName: string
  fileData: Buffer
}

export class FileUploadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'FileUploadError'
  }
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

export async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  return await new Promise<Buffer>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', (error: Error) => reject(error))
  })
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
