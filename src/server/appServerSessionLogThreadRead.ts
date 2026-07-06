import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const FALLBACK_TURN_LIMIT = 10
const FALLBACK_ITEM_TEXT_LIMIT = 20_000
const FALLBACK_READ_BYTE_LIMIT = 2_000_000
const FALLBACK_CACHE_LIMIT = 40

type FallbackItem = {
  type: 'userMessage' | 'agentMessage'
  id: string
  content?: Array<{ type: 'text'; text: string }>
  text?: string
}

type FallbackTurn = {
  id: string
  status: 'completed'
  items: FallbackItem[]
}

type SessionLogThreadReadCacheState = {
  fileSignature: string
  threadRead: unknown | null
}

const sessionLogThreadReadCacheStateByPath = new Map<string, SessionLogThreadReadCacheState>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getFileSignature(stats: { mtimeMs: number; size: number }): string {
  return `${String(stats.mtimeMs)}:${String(stats.size)}`
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readUnixSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  const text = readTrimmedString(value)
  if (!text) return 0
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

function limitText(value: string): string {
  return value.length > FALLBACK_ITEM_TEXT_LIMIT
    ? `${value.slice(0, FALLBACK_ITEM_TEXT_LIMIT)}\n\n[message trimmed by CX-Codex fallback]`
    : value
}

function readFallbackThreadTitle(thread: Record<string, unknown>, preview: string): string {
  return (
    readTrimmedString(thread.name) ||
    readTrimmedString(thread.title) ||
    preview.split('\n')[0]?.trim() ||
    ''
  )
}

function readTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  const chunks: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (!record) continue
    const type = readTrimmedString(record.type)
    const text = readTrimmedString(record.text)
    if (!text) continue
    if (
      type === 'text' ||
      type === 'input_text' ||
      type === 'output_text' ||
      type === 'input_text_delta' ||
      type === 'output_text_delta'
    ) {
      chunks.push(text)
    }
  }
  return chunks.join('\n').trim()
}

function readResponseItemMessage(entry: Record<string, unknown>): { role: 'user' | 'assistant'; text: string; id: string } | null {
  if (entry.type !== 'response_item') return null
  const payload = asRecord(entry.payload)
  if (payload?.type !== 'message') return null
  const role = payload.role === 'user' || payload.role === 'assistant' ? payload.role : null
  if (!role) return null
  const text = readTextContent(payload.content)
  if (!text) return null
  const id = readTrimmedString(payload.id)
  return { role, text, id }
}

function readEventMessage(entry: Record<string, unknown>): { role: 'user' | 'assistant'; text: string; id: string } | null {
  if (entry.type !== 'event_msg') return null
  const payload = asRecord(entry.payload)
  const type = readTrimmedString(payload?.type)
  const role =
    type === 'user_message'
      ? 'user'
      : type === 'agent_message'
        ? 'assistant'
        : null
  if (!role) return null
  const text = readTrimmedString(payload?.message)
  if (!text) return null
  return { role, text, id: '' }
}

function appendMessageTurn(turns: FallbackTurn[], message: { role: 'user' | 'assistant'; text: string; id: string }): void {
  const text = limitText(message.text)
  const turn = message.role === 'user' || turns.length === 0
    ? null
    : turns.at(-1) ?? null
  const targetTurn = turn ?? {
    id: message.id || `fallback-turn-${String(turns.length + 1)}`,
    status: 'completed' as const,
    items: [],
  }
  if (!turn) turns.push(targetTurn)

  const itemId = message.id || `${targetTurn.id}:${message.role}:${String(targetTurn.items.length + 1)}`
  targetTurn.items.push(message.role === 'user'
    ? {
        type: 'userMessage',
        id: itemId,
        content: [{ type: 'text', text }],
      }
    : {
        type: 'agentMessage',
        id: itemId,
        text,
      })

  while (turns.length > FALLBACK_TURN_LIMIT) {
    turns.shift()
  }
}

function isSameRecoveredMessage(
  first: { role: 'user' | 'assistant'; text: string } | null,
  second: { role: 'user' | 'assistant'; text: string },
): boolean {
  return Boolean(first && first.role === second.role && first.text === second.text)
}

function writeCacheState(sessionPath: string, cacheState: SessionLogThreadReadCacheState): void {
  if (sessionLogThreadReadCacheStateByPath.has(sessionPath)) {
    sessionLogThreadReadCacheStateByPath.delete(sessionPath)
  }
  sessionLogThreadReadCacheStateByPath.set(sessionPath, cacheState)
  while (sessionLogThreadReadCacheStateByPath.size > FALLBACK_CACHE_LIMIT) {
    const oldestKey = sessionLogThreadReadCacheStateByPath.keys().next().value
    if (typeof oldestKey !== 'string') break
    sessionLogThreadReadCacheStateByPath.delete(oldestKey)
  }
}

export async function parseThreadReadFromSessionLog(
  sessionPath: string,
  fallbackThreadRead: unknown,
): Promise<unknown | null> {
  const fallbackRoot = asRecord(fallbackThreadRead)
  const fallbackThread = asRecord(fallbackRoot?.thread)
  if (!fallbackThread) return null
  const fallbackThreadId = readTrimmedString(fallbackThread.id)
  if (!fallbackThreadId) return null

  let cwd = readTrimmedString(fallbackThread?.cwd)
  let preview = readTrimmedString(fallbackThread?.preview)
  let source = fallbackThread?.source ?? 'unknown'
  let createdAt = readUnixSeconds(fallbackThread?.createdAt)
  let updatedAt = readUnixSeconds(fallbackThread?.updatedAt)
  const turns: FallbackTurn[] = []
  const seenMessageIds = new Set<string>()
  let lastRecoveredMessage: { role: 'user' | 'assistant'; text: string } | null = null
  const stats = await stat(sessionPath)
  const startOffset = Math.max(0, stats.size - FALLBACK_READ_BYTE_LIMIT)

  const input = createReadStream(sessionPath, { encoding: 'utf8', start: startOffset })
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  })
  let skipPartialFirstLine = startOffset > 0

  try {
    for await (const line of lines) {
      if (skipPartialFirstLine) {
        skipPartialFirstLine = false
        continue
      }

      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const entry = asRecord(JSON.parse(trimmed) as unknown)
        if (!entry) continue

        updatedAt = Math.max(updatedAt, readUnixSeconds(entry.timestamp))
        if (entry.type === 'session_meta') {
          const payload = asRecord(entry.payload)
          if (payload) {
            cwd = cwd || readTrimmedString(payload.cwd)
            source = payload.source ?? source
            createdAt = createdAt || readUnixSeconds(payload.timestamp)
          }
        }

        const message = readResponseItemMessage(entry) ?? readEventMessage(entry)
        if (!message) continue

        if (message.id) {
          if (seenMessageIds.has(message.id)) continue
          seenMessageIds.add(message.id)
        } else if (isSameRecoveredMessage(lastRecoveredMessage, message)) {
          continue
        }
        appendMessageTurn(turns, message)
        lastRecoveredMessage = { role: message.role, text: message.text }
        if (!preview && message.role === 'user') {
          preview = message.text.split('\n')[0]?.trim() ?? ''
        }
      } catch {
        // Skip malformed lines and keep the rest of the recoverable history.
      }
    }
  } finally {
    lines.close()
    input.close()
  }

  if (turns.length === 0) return null
  const title = readFallbackThreadTitle(fallbackThread, preview)

  return {
    thread: {
      ...fallbackThread,
      id: fallbackThreadId,
      ...(title ? { name: title, title } : {}),
      preview,
      modelProvider: readTrimmedString(fallbackThread?.modelProvider),
      createdAt,
      updatedAt,
      path: readTrimmedString(fallbackThread?.path) || sessionPath,
      cwd,
      cliVersion: readTrimmedString(fallbackThread?.cliVersion),
      source,
      gitInfo: fallbackThread?.gitInfo ?? null,
      turns,
    },
  }
}

export async function readThreadReadFromSessionLog(
  sessionPath: string,
  fallbackThreadRead: unknown,
): Promise<unknown | null> {
  const normalizedSessionPath = sessionPath.trim()
  if (!normalizedSessionPath) return null

  try {
    const stats = await stat(normalizedSessionPath)
    const fileSignature = getFileSignature(stats)
    const cached = sessionLogThreadReadCacheStateByPath.get(normalizedSessionPath)
    if (cached?.fileSignature === fileSignature) return cached.threadRead

    const threadRead = await parseThreadReadFromSessionLog(normalizedSessionPath, fallbackThreadRead)
    writeCacheState(normalizedSessionPath, { fileSignature, threadRead })
    return threadRead
  } catch {
    writeCacheState(normalizedSessionPath, { fileSignature: 'missing', threadRead: null })
    return null
  }
}
