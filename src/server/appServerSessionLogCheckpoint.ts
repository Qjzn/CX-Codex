import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

// A CX probing budget, not a limit imposed by the native JSONL protocol.
const HEADER_BYTE_LIMIT = 64 * 1024
const HEADER_READ_CHUNK = 4096

export type SessionLogCheckpoint = {
  key: string
  endsWithNewline: boolean
  nativeLegacyThreadId: string | null
}

function firstRecordEnd(bytes: Buffer): number {
  let start = 0
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
    if (bytes.subarray(start, end).toString('utf8').trim()) return end + 1
    start = end + 1
  }
  return 0
}

function nativeLegacyThreadId(header: Buffer): string | null {
  try {
    const entry = JSON.parse(header.toString('utf8').trim())
    // Only the first complete nonempty record is authoritative. Later metadata
    // may belong to a copied fork. Missing/unknown/oversized heads stay compatible.
    return entry?.type === 'session_meta' && entry.payload?.history_mode === 'legacy'
      && typeof entry.payload.id === 'string' && entry.payload.id.length > 0
      ? entry.payload.id : null
  } catch {
    return null
  }
}

export async function readSessionLogCheckpoint(sessionPath: string, fileSize: number): Promise<SessionLogCheckpoint> {
  if (fileSize <= 0) return { key: '', endsWithNewline: false, nativeLegacyThreadId: null }
  const handle = await open(sessionPath, 'r')
  try {
    const headLimit = Math.min(fileSize, HEADER_BYTE_LIMIT)
    const head = Buffer.alloc(headLimit)
    let bytesRead = 0
    let headerEnd = 0
    while (bytesRead < headLimit && !headerEnd) {
      const result = await handle.read(head, bytesRead, Math.min(HEADER_READ_CHUNK, headLimit - bytesRead), bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
      headerEnd = firstRecordEnd(head.subarray(0, bytesRead))
    }
    const header = head.subarray(0, headerEnd || bytesRead)
    const size = Math.min(fileSize, 512)
    const tail = Buffer.alloc(size)
    const last = await handle.read(tail, 0, size, fileSize - size)
    // Cover the entire head evidence (native metadata often exceeds 512 bytes),
    // but not subsequent body bytes: ordinary append must remain incremental.
    const headerHash = createHash('sha256').update(header).digest('hex')
    return {
      key: `${head.subarray(0, Math.min(bytesRead, size)).toString('base64')}:${headerHash}:${tail.subarray(0, last.bytesRead).toString('base64')}`,
      endsWithNewline: last.bytesRead === size && tail[size - 1] === 10,
      nativeLegacyThreadId: headerEnd ? nativeLegacyThreadId(header) : null,
    }
  } finally {
    await handle.close()
  }
}
