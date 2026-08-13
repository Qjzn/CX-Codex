import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const FALLBACK_TURN_LIMIT = 40
const FALLBACK_ITEM_TEXT_LIMIT = 20_000
const FALLBACK_READ_BYTE_LIMIT = 24_000_000
const FALLBACK_CACHE_LIMIT = 40
const TOP_LEVEL_RESPONSE_ITEM_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"response_item"/
const TOP_LEVEL_EVENT_MESSAGE_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"event_msg"/
const TOP_LEVEL_SESSION_META_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"session_meta"/
const TRAILING_MEMORY_CITATION_PATTERN = /\s*<oai-mem-citation>[\s\S]*<\/oai-mem-citation>\s*$/u

type FallbackItem = {
  type: 'userMessage' | 'agentMessage'
  id: string
  phase?: 'commentary'
  content?: Array<{ type: 'text'; text: string }>
  text?: string
}

type RecoveredMessage = {
  role: 'user' | 'assistant'
  text: string
  id: string
  phase?: 'commentary'
  hidden?: boolean
}

type FallbackTurn = {
  id: string
  status: 'completed'
  items: FallbackItem[]
}

type SessionLogThreadReadCacheState = {
  fileSignature: string
  fileSize: number
  incrementalReady: boolean
  threadRead: unknown | null
}

const sessionLogThreadReadCacheStateByPath = new Map<string, SessionLogThreadReadCacheState>()

export function isSessionLogThreadReadCandidateLine(line: string): boolean {
  if (TOP_LEVEL_SESSION_META_PATTERN.test(line) || TOP_LEVEL_EVENT_MESSAGE_PATTERN.test(line)) return true
  if (!TOP_LEVEL_RESPONSE_ITEM_PATTERN.test(line)) return false
  return line.includes('"role":"user"') || line.includes('"role":"assistant"')
}

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

function cloneFallbackTurns(value: unknown): FallbackTurn[] {
  if (!Array.isArray(value)) return []

  const turns: FallbackTurn[] = []
  for (const row of value) {
    const turn = asRecord(row)
    if (!turn || !Array.isArray(turn.items)) continue
    const items: FallbackItem[] = []
    for (const itemValue of turn.items) {
      const item = asRecord(itemValue)
      if (!item) continue
      const id = readTrimmedString(item.id)
      if (item.type === 'userMessage') {
        const text = readTextContent(item.content)
        if (text) {
          items.push({ type: 'userMessage', id, content: [{ type: 'text', text }] })
        }
      } else if (item.type === 'agentMessage') {
        const text = readTrimmedString(item.text)
        const phase = readTrimmedString(item.phase)
        if (text) items.push({
          type: 'agentMessage',
          id,
          text,
          ...(phase === 'commentary' ? { phase } : {}),
        })
      }
    }
    turns.push({
      id: readTrimmedString(turn.id) || `fallback-turn-${String(turns.length + 1)}`,
      status: 'completed',
      items,
    })
  }
  return turns.slice(-FALLBACK_TURN_LIMIT)
}

function hydrateRecoveredMessageState(
  turns: FallbackTurn[],
  seenMessageIds: Set<string>,
): RecoveredMessage | null {
  let lastRecoveredMessage: RecoveredMessage | null = null
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.id) seenMessageIds.add(item.id)
      const role = item.type === 'userMessage' ? 'user' : 'assistant'
      const text = item.type === 'userMessage'
        ? readTextContent(item.content)
        : readTrimmedString(item.text)
      if (text) lastRecoveredMessage = {
        role,
        text,
        id: item.id,
        ...(item.phase === 'commentary' ? { phase: item.phase } : {}),
      }
    }
  }
  return lastRecoveredMessage
}

async function doesFileEndWithNewline(sessionPath: string, fileSize: number): Promise<boolean> {
  if (fileSize <= 0) return false
  const handle = await open(sessionPath, 'r')
  try {
    const byte = Buffer.allocUnsafe(1)
    const result = await handle.read(byte, 0, 1, fileSize - 1)
    return result.bytesRead === 1 && byte[0] === 10
  } finally {
    await handle.close()
  }
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

function isInternalContextMessageText(text: string): boolean {
  return (
    text.startsWith('<codex_internal_context') ||
    text.startsWith('<environment_context') ||
    text.startsWith('<developer_context') ||
    text.startsWith('<system_context') ||
    text.startsWith('# AGENTS.md instructions') ||
    text.startsWith('<INSTRUCTIONS>')
  )
}

function normalizeRecoveredAssistantText(text: string): string {
  return text.replace(TRAILING_MEMORY_CITATION_PATTERN, '').trim()
}

function readResponseItemMessage(entry: Record<string, unknown>): RecoveredMessage | null {
  if (entry.type !== 'response_item') return null
  const payload = asRecord(entry.payload)
  if (payload?.type !== 'message') return null
  const role = payload.role === 'user' || payload.role === 'assistant' ? payload.role : null
  if (!role) return null
  const phase = role === 'assistant' && readTrimmedString(payload.phase) === 'commentary'
    ? 'commentary' as const
    : undefined
  const rawText = readTextContent(payload.content)
  const text = role === 'assistant' ? normalizeRecoveredAssistantText(rawText) : rawText
  if (!text) return null
  const id = readTrimmedString(payload.id)
  if (isInternalContextMessageText(text)) {
    return role === 'user' ? { role, text: '', id, hidden: true } : null
  }
  return { role, text, id, ...(phase ? { phase } : {}) }
}

function readEventMessage(entry: Record<string, unknown>): RecoveredMessage | null {
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
  if (role === 'assistant' && readTrimmedString(payload?.phase) === 'commentary') return null
  const rawText = readTrimmedString(payload?.message)
  const text = role === 'assistant' ? normalizeRecoveredAssistantText(rawText) : rawText
  if (!text) return null
  if (isInternalContextMessageText(text)) {
    return role === 'user' ? { role, text: '', id: '', hidden: true } : null
  }
  return { role, text, id: '' }
}

function appendMessageTurn(turns: FallbackTurn[], message: RecoveredMessage): void {
  // Hidden internal-context messages (e.g. injected AGENTS.md prompts) are
  // omitted by the App Server thread read; skipping them here keeps the
  // fallback turn indexes aligned with the App Server view.
  if (message.hidden) return

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
        ...(message.phase === 'commentary' ? { phase: message.phase } : {}),
      })

  while (turns.length > FALLBACK_TURN_LIMIT) {
    turns.shift()
  }
}

function isDuplicateRecoveredMessage(
  first: RecoveredMessage | null,
  second: RecoveredMessage,
): boolean {
  if (second.hidden) return false
  if (
    !first ||
    first.role !== second.role ||
    first.text !== second.text ||
    first.phase !== second.phase
  ) return false
  return !first.id || !second.id
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

async function parseThreadReadFromSessionLogRange(
  sessionPath: string,
  fallbackThreadRead: unknown,
  options: { startOffset?: number; seedTurns?: boolean } = {},
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
  const turns = options.seedTurns === true ? cloneFallbackTurns(fallbackThread.turns) : []
  const seenMessageIds = new Set<string>()
  let lastRecoveredMessage = hydrateRecoveredMessageState(turns, seenMessageIds)
  const stats = await stat(sessionPath)
  const startOffset = typeof options.startOffset === 'number'
    ? Math.max(0, Math.min(options.startOffset, stats.size))
    : Math.max(0, stats.size - FALLBACK_READ_BYTE_LIMIT)

  const processLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed || !isSessionLogThreadReadCandidateLine(trimmed)) return

    try {
      const entry = asRecord(JSON.parse(trimmed) as unknown)
      if (!entry) return

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
      if (!message || isDuplicateRecoveredMessage(lastRecoveredMessage, message)) return
      if (message.id) {
        if (seenMessageIds.has(message.id)) return
        seenMessageIds.add(message.id)
      }
      if (message.hidden && turns.length === 0) return
      appendMessageTurn(turns, message)
      if (!message.hidden) {
        lastRecoveredMessage = {
          role: message.role,
          text: message.text,
          id: message.id,
          ...(message.phase === 'commentary' ? { phase: message.phase } : {}),
        }
      }
      if (!preview && message.role === 'user') {
        preview = message.text.split('\n')[0]?.trim() ?? ''
      }
    } catch {
      // Skip malformed lines and keep the rest of the recoverable history.
    }
  }

  if (options.startOffset !== undefined) {
    const byteCount = Math.max(0, stats.size - startOffset)
    if (byteCount > 0) {
      const handle = await open(sessionPath, 'r')
      try {
        const buffer = Buffer.allocUnsafe(byteCount)
        let bytesRead = 0
        while (bytesRead < byteCount) {
          const result = await handle.read(buffer, bytesRead, byteCount - bytesRead, startOffset + bytesRead)
          if (result.bytesRead === 0) break
          bytesRead += result.bytesRead
        }
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/u)) {
          processLine(line)
        }
      } finally {
        await handle.close()
      }
    }
  } else {
    const input = createReadStream(sessionPath, {
      encoding: 'utf8',
      start: startOffset,
      end: Math.max(startOffset, stats.size - 1),
    })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let skipPartialFirstLine = startOffset > 0
    try {
      for await (const line of lines) {
        if (skipPartialFirstLine) {
          skipPartialFirstLine = false
          continue
        }
        processLine(line)
      }
    } finally {
      lines.close()
      input.close()
    }
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

export async function parseThreadReadFromSessionLog(
  sessionPath: string,
  fallbackThreadRead: unknown,
): Promise<unknown | null> {
  return parseThreadReadFromSessionLogRange(sessionPath, fallbackThreadRead)
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

    const appendedByteCount = cached ? stats.size - cached.fileSize : 0
    const canReadIncrementally = Boolean(
      cached?.incrementalReady &&
      cached.threadRead &&
      appendedByteCount > 0 &&
      appendedByteCount <= FALLBACK_READ_BYTE_LIMIT,
    )
    const threadRead = canReadIncrementally
      ? await parseThreadReadFromSessionLogRange(normalizedSessionPath, {
          thread: {
            ...asRecord(asRecord(cached?.threadRead)?.thread),
            ...asRecord(asRecord(fallbackThreadRead)?.thread),
            turns: asRecord(asRecord(cached?.threadRead)?.thread)?.turns ?? [],
          },
        }, {
          startOffset: cached?.fileSize,
          seedTurns: true,
        })
      : await parseThreadReadFromSessionLog(normalizedSessionPath, fallbackThreadRead)
    const incrementalReady = await doesFileEndWithNewline(normalizedSessionPath, stats.size)
    writeCacheState(normalizedSessionPath, {
      fileSignature,
      fileSize: stats.size,
      incrementalReady,
      threadRead,
    })
    return threadRead
  } catch {
    writeCacheState(normalizedSessionPath, {
      fileSignature: 'missing',
      fileSize: 0,
      incrementalReady: false,
      threadRead: null,
    })
    return null
  }
}
