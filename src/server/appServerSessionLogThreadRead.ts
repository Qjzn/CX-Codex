import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isInternalContextMessageText } from '../internalContextMessage.js'
import { readSessionLogCheckpoint, type SessionLogCheckpoint } from './appServerSessionLogCheckpoint.js'
import {
  applySessionLogLifecycle, hasSettledSessionLogLifecycle, readSessionLogLifecycle,
  type SessionLogTurnLifecycle,
} from './appServerSessionLogLifecycle.js'

const FALLBACK_TURN_LIMIT = 40
const FALLBACK_ITEM_TEXT_LIMIT = 20_000
const FALLBACK_READ_BYTE_LIMIT = 24_000_000
const FALLBACK_CACHE_LIMIT = 40
const TOP_LEVEL_RESPONSE_ITEM_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"response_item"/
const TOP_LEVEL_EVENT_MESSAGE_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"event_msg"/
const TOP_LEVEL_SESSION_META_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"session_meta"/
const TOP_LEVEL_TURN_CONTEXT_PATTERN = /^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"turn_context"/
const TRAILING_MEMORY_CITATION_PATTERN = /\s*<oai-mem-citation>[\s\S]*<\/oai-mem-citation>\s*$/u

type FallbackItem = {
  type: 'userMessage' | 'agentMessage' | 'fileChange'
  id: string
  clientId?: string
  phase?: 'commentary' | 'final_answer'
  startedAt?: string
  completedAt?: string
  status?: 'completed' | 'failed'
  recoverySource?: 'response_item' | 'event_msg'
  content?: Array<{ type: 'text'; text: string } | { type: 'localImage'; path: string }>
  text?: string
  changes?: Array<{
    path: string
    kind: { type: 'add' | 'delete' | 'update'; move_path: string | null }
    diff: string
  }>
}

type RecoveredMessage = {
  role: 'user' | 'assistant'
  text: string
  id: string
  clientId?: string
  turnId?: string
  phase?: 'commentary' | 'final_answer'
  atIso?: string
  source: 'response_item' | 'event_msg'
  images?: string[]
  hidden?: boolean
}

type RecoveredFileChange = {
  id: string
  turnId: string
  atIso?: string
  status: 'completed' | 'failed'
  changes: NonNullable<FallbackItem['changes']>
}

type FallbackTurn = SessionLogTurnLifecycle & {
  id: string
  items: FallbackItem[]
}

type SessionLogThreadReadCacheState = {
  threadId: string
  fileSignature: string
  fileIdentity: string
  fileSize: number
  checkpoint: string
  incrementalReady: boolean
  fullScan: boolean
  threadRead: unknown | null
  cursor: SessionLogRecoveryCursor
  recoveryTurns: FallbackTurn[]
}

type SessionLogRecoveryCursor = { activeTurnId: string; conflicted: boolean }

function createRecoveryCursor(): SessionLogRecoveryCursor {
  return { activeTurnId: '', conflicted: false }
}

function invalidateRecoveryCursor(cursor: SessionLogRecoveryCursor): void {
  cursor.activeTurnId = ''
  cursor.conflicted = true
}

function updateRecoveryCursor(cursor: SessionLogRecoveryCursor, entry: Record<string, unknown>): void {
  const payload = asRecord(entry.payload)
  const eventType = entry.type === 'event_msg' ? readTrimmedString(payload?.type) : ''
  const turnId = readTrimmedString(payload?.turn_id)
  if (eventType === 'task_started') {
    if (!turnId || cursor.conflicted || (cursor.activeTurnId && cursor.activeTurnId !== turnId)) {
      invalidateRecoveryCursor(cursor)
    } else {
      cursor.activeTurnId = turnId
    }
  } else if (eventType === 'task_complete' || eventType === 'turn_aborted') {
    // A terminal boundary never lends its turn to the following input.
    cursor.activeTurnId = ''
    cursor.conflicted = false
  } else if (entry.type === 'turn_context' && cursor.activeTurnId && turnId !== cursor.activeTurnId) {
    invalidateRecoveryCursor(cursor)
  } else if (entry.type === 'response_item' && cursor.activeTurnId) {
    const metadata = asRecord(payload?.internal_chat_message_metadata_passthrough)
    const responseTurnId = readTrimmedString(metadata?.turn_id)
    if (responseTurnId && responseTurnId !== cursor.activeTurnId) invalidateRecoveryCursor(cursor)
  }
}

const sessionLogThreadReadCacheStateByPath = new Map<string, SessionLogThreadReadCacheState>()
const RECOVERED_USER_IMAGE_PATTERN = /\s*<image\b[^>]*\bpath=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/image>\s*/giu

export function isSessionLogThreadReadCandidateLine(line: string): boolean {
  if (TOP_LEVEL_SESSION_META_PATTERN.test(line) || TOP_LEVEL_EVENT_MESSAGE_PATTERN.test(line)
    || TOP_LEVEL_TURN_CONTEXT_PATTERN.test(line)) return true
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

function getFileIdentity(stats: { dev: number; ino: number; birthtimeMs: number }): string {
  return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.birthtimeMs)}`
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

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
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
        const images = Array.isArray(item.content)
          ? item.content
              .map((block) => asRecord(block))
              .filter((block): block is Record<string, unknown> => block?.type === 'localImage')
              .map((block) => readTrimmedString(block.path))
              .filter((path) => path.length > 0)
          : []
        if (text || images.length > 0) {
          items.push({
            type: 'userMessage',
            id,
            ...(readTrimmedString(item.clientId) ? { clientId: readTrimmedString(item.clientId) } : {}),
            ...(readTrimmedString(item.startedAt) ? { startedAt: readTrimmedString(item.startedAt) } : {}),
            ...(item.recoverySource === 'response_item' || item.recoverySource === 'event_msg'
              ? { recoverySource: item.recoverySource } : {}),
            content: [
              ...(text ? [{ type: 'text' as const, text }] : []),
              ...images.map((path) => ({ type: 'localImage' as const, path })),
            ],
          })
        }
      } else if (item.type === 'agentMessage') {
        const text = readTrimmedString(item.text)
        const phase = readTrimmedString(item.phase)
        if (text) items.push({
          type: 'agentMessage',
          id,
          text,
          ...(phase === 'commentary' || phase === 'final_answer' ? { phase } : {}),
          ...(readTrimmedString(item.startedAt) ? { startedAt: readTrimmedString(item.startedAt) } : {}),
          ...(item.recoverySource === 'response_item' || item.recoverySource === 'event_msg'
            ? { recoverySource: item.recoverySource }
          : {}),
        })
      } else if (item.type === 'fileChange') {
        const changes = Array.isArray(item.changes)
          ? item.changes.flatMap((changeValue) => {
              const change = asRecord(changeValue)
              const path = readTrimmedString(change?.path)
              if (!path) return []
              const kind = asRecord(change?.kind)
              const type = readTrimmedString(kind?.type)
              const normalizedType: 'add' | 'delete' | 'update' = type === 'add' || type === 'delete'
                ? type
                : 'update'
              return [{
                path,
                kind: {
                  type: normalizedType,
                  move_path: readTrimmedString(kind?.move_path) || null,
                },
                diff: limitText(readTrimmedString(change?.diff)),
              }]
            })
          : []
        if (changes.length > 0) {
          items.push({
            type: 'fileChange',
            id,
            status: item.status === 'failed' ? 'failed' : 'completed',
            ...(readTrimmedString(item.completedAt) ? { completedAt: readTrimmedString(item.completedAt) } : {}),
            changes,
          })
        }
      }
    }
    turns.push({
      id: readTrimmedString(turn.id) || `fallback-turn-${String(turns.length + 1)}`,
      status: turn.status === 'inProgress' || turn.status === 'failed' || turn.status === 'interrupted'
        ? turn.status : 'completed',
      ...(Object.hasOwn(turn, 'startedAt') ? { startedAt: readTrimmedString(turn.startedAt) || null } : {}),
      ...(Object.hasOwn(turn, 'completedAt') ? { completedAt: readTrimmedString(turn.completedAt) || null } : {}),
      ...(readNonNegativeInteger(turn.durationMs) !== null ? { durationMs: readNonNegativeInteger(turn.durationMs)! } : {}),
      ...(readTrimmedString(asRecord(turn.error)?.message)
        ? { error: { message: readTrimmedString(asRecord(turn.error)?.message) } } : {}),
      items,
    })
  }
  return turns.slice(-FALLBACK_TURN_LIMIT)
}

function hydrateRecoveredMessageIds(
  turns: FallbackTurn[],
  seenMessageIds: Set<string>,
): void {
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.id) seenMessageIds.add(item.id)
    }
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

function readRecoveredUserContent(text: string): { text: string; images: string[] } {
  const images: string[] = []
  const visibleText = text.replace(RECOVERED_USER_IMAGE_PATTERN, (_match, doubleQuoted, singleQuoted) => {
    const path = readTrimmedString(doubleQuoted || singleQuoted)
    if (path) images.push(path)
    return '\n'
  }).replace(/\n{3,}/gu, '\n\n').trim()
  return { text: visibleText, images }
}

function isLocalImagePath(path: string): boolean {
  return Boolean(path) && (!/^[a-z][a-z0-9+.-]*:/iu.test(path) || /^[a-z]:[\\/]/iu.test(path))
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
  const rawPhase = role === 'assistant' ? readTrimmedString(payload.phase) : ''
  const phase = rawPhase === 'commentary' || rawPhase === 'final_answer' ? rawPhase : undefined
  const atIso = readTrimmedString(entry.timestamp)
  const rawText = readTextContent(payload.content)
  const recoveredUserContent = role === 'user' ? readRecoveredUserContent(rawText) : null
  const text = role === 'assistant'
    ? normalizeRecoveredAssistantText(rawText)
    : recoveredUserContent?.text ?? rawText
  if (!text && !(role === 'user' && recoveredUserContent?.images.length)) return null
  const id = readTrimmedString(payload.id)
  const metadata = asRecord(payload.internal_chat_message_metadata_passthrough)
  const turnId = readTrimmedString(metadata?.turn_id)
  if (isInternalContextMessageText(text)) {
    return role === 'user' ? {
      role,
      text: '',
      id,
      ...(turnId ? { turnId } : {}),
      ...(atIso ? { atIso } : {}),
      source: 'response_item',
      hidden: true,
    } : null
  }
  return {
    role,
    text,
    id,
    ...(turnId ? { turnId } : {}),
    ...(phase ? { phase } : {}),
    ...(atIso ? { atIso } : {}),
    source: 'response_item',
    ...(recoveredUserContent?.images.length ? { images: recoveredUserContent.images } : {}),
  }
}

function readEventMessage(entry: Record<string, unknown>, entryOffset: number, cursor: SessionLogRecoveryCursor, nativeUiUserHistory: boolean): RecoveredMessage | null {
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
  const rawPhase = role === 'assistant' ? readTrimmedString(payload?.phase) : ''
  const phase = rawPhase === 'commentary' || rawPhase === 'final_answer' ? rawPhase : undefined
  const rawText = readTrimmedString(payload?.message)
  const recoveredUserContent = role === 'user' ? readRecoveredUserContent(rawText) : null
  const localImages = role === 'user' && Array.isArray(payload?.local_images)
    ? payload.local_images.map(readTrimmedString).filter(isLocalImagePath) : []
  const images = [...new Set([...(recoveredUserContent?.images ?? []), ...localImages])].filter(isLocalImagePath)
  const text = role === 'assistant' ? normalizeRecoveredAssistantText(rawText) : recoveredUserContent?.text ?? rawText
  if (!text && images.length === 0) return null
  const clientId = role === 'user' ? readTrimmedString(payload?.client_id) : ''
  if (isInternalContextMessageText(text)) {
    return role === 'user' ? {
      role,
      text: '',
      id: `event:offset:${String(entryOffset)}`,
      source: 'event_msg',
      hidden: true,
    } : null
  }
  const atIso = readTrimmedString(entry.timestamp)
  return {
    role,
    text,
    id: `event:${atIso || 'unknown'}:offset:${String(entryOffset)}`,
    ...(clientId ? { clientId } : {}),
    ...((clientId || nativeUiUserHistory) && cursor.activeTurnId ? { turnId: cursor.activeTurnId } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(phase ? { phase } : {}),
    ...(atIso ? { atIso } : {}),
    source: 'event_msg',
  }
}

function readEventFileChange(entry: Record<string, unknown>, entryIndex: number): RecoveredFileChange | null {
  if (entry.type !== 'event_msg') return null
  const payload = asRecord(entry.payload)
  if (payload?.type !== 'patch_apply_end') return null
  const turnId = readTrimmedString(payload.turn_id)
  const rawChanges = asRecord(payload.changes)
  if (!turnId || !rawChanges) return null

  const changes: NonNullable<FallbackItem['changes']> = []
  for (const [rawPath, rawChange] of Object.entries(rawChanges)) {
    const path = rawPath.trim()
    const change = asRecord(rawChange)
    if (!path || !change) continue
    const rawType = readTrimmedString(change.type)
    changes.push({
      path,
      kind: {
        type: rawType === 'add' || rawType === 'delete' ? rawType : 'update',
        move_path: readTrimmedString(change.move_path) || null,
      },
      diff: limitText(readTrimmedString(change.unified_diff)),
    })
  }
  if (changes.length === 0) return null

  const atIso = readTrimmedString(entry.timestamp)
  const callId = readTrimmedString(payload.call_id)
  return {
    id: callId || `event:patch:${atIso || 'unknown'}:${String(entryIndex)}`,
    turnId,
    ...(atIso ? { atIso } : {}),
    status: payload.success === false || payload.status === 'failed' ? 'failed' : 'completed',
    changes,
  }
}

function findFallbackTurn(turns: FallbackTurn[], turnId: string): FallbackTurn | null {
  if (!turnId) return null
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.id === turnId) return turns[index] ?? null
  }
  return null
}

function matchesRecoveredMessage(item: FallbackItem, message: RecoveredMessage, source: RecoveredMessage['source']): boolean {
  if (item.recoverySource !== source || item.phase !== message.phase) return false
  if (message.role === 'assistant') {
    return item.type === 'agentMessage' && item.text === limitText(message.text)
  }
  // The log has no explicit response-item <-> client-event alias. Never drop
  // or relabel an identified event merely because the bodies happen to match.
  if (item.clientId || message.clientId) return false
  return item.type === 'userMessage' && readTextContent(item.content) === limitText(message.text)
}

function trimFallbackTurns(turns: FallbackTurn[]): void {
  while (turns.length > FALLBACK_TURN_LIMIT) turns.shift()
}

function appendMessageTurn(turns: FallbackTurn[], message: RecoveredMessage): boolean {
  if (message.hidden) {
    if (
      message.role === 'user'
      && message.source === 'response_item'
      && message.turnId
      && !findFallbackTurn(turns, message.turnId)
    ) {
      turns.push({ id: message.turnId, status: 'completed', items: [] })
      trimFallbackTurns(turns)
    }
    return false
  }
  const text = limitText(message.text)
  const matchingTurn = findFallbackTurn(turns, message.turnId ?? '')
  if (message.role === 'user' && !matchingTurn && turns.at(-1)?.items.length === 0) {
    turns.pop()
  }
  const messageItemType = message.role === 'user' ? 'userMessage' : 'agentMessage'
  const canonicalEventTarget = message.source === 'event_msg' && !message.turnId
    ? turns.at(-1)?.items.some((item) => (
        item.type === messageItemType && matchesRecoveredMessage(item, message, 'response_item')
      ))
      ? turns.at(-1) ?? null
      : null
    : null
  const mustCreateAuthoritativeTurn = Boolean(
    message.source === 'response_item' && message.turnId && !matchingTurn,
  )
  const turn = matchingTurn ?? canonicalEventTarget ?? (mustCreateAuthoritativeTurn
    ? null
    : message.role === 'user' || turns.length === 0
    ? null
    : turns.at(-1) ?? null)
  const targetTurn = turn ?? {
    id: message.turnId || message.id || `fallback-turn-${String(turns.length + 1)}`,
    status: 'completed' as const,
    items: [],
  }
  const wasVisible = targetTurn.items.length > 0
  if (!turn) {
    if (message.source === 'response_item' && message.turnId && message.role === 'assistant') {
      const previousTurn = turns.at(-1)
      if (previousTurn) {
        previousTurn.items = previousTurn.items.filter((item) => !matchesRecoveredMessage(item, message, 'event_msg'))
      }
    }
    turns.push(targetTurn)
  }

  if (
    message.source === 'event_msg' &&
    targetTurn.items.some((item) => item.type === messageItemType && matchesRecoveredMessage(item, message, 'response_item'))
  ) {
    return !turn
  }
  if (message.source === 'response_item') {
    targetTurn.items = targetTurn.items.filter((item) => !(
      item.type === messageItemType && matchesRecoveredMessage(item, message, 'event_msg')
    ))
  }

  const itemId = message.id || `${targetTurn.id}:${message.role}:${String(targetTurn.items.length + 1)}`
  targetTurn.items.push(message.role === 'user'
    ? {
        type: 'userMessage',
        id: itemId,
        ...(message.clientId ? { clientId: message.clientId } : {}),
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...(message.images ?? []).map((path) => ({ type: 'localImage' as const, path })),
        ],
        ...(message.atIso ? { startedAt: message.atIso } : {}),
        recoverySource: message.source,
      }
    : {
        type: 'agentMessage',
        id: itemId,
        text,
        ...(message.phase === 'commentary' || message.phase === 'final_answer' ? { phase: message.phase } : {}),
        ...(message.atIso ? { startedAt: message.atIso } : {}),
        recoverySource: message.source,
      })

  trimFallbackTurns(turns)
  return !wasVisible
}

function appendFileChangeTurn(turns: FallbackTurn[], fileChange: RecoveredFileChange): boolean {
  const matchingTurn = findFallbackTurn(turns, fileChange.turnId)
  const targetTurn = matchingTurn ?? {
    id: fileChange.turnId,
    status: 'completed' as const,
    items: [],
  }
  const wasVisible = targetTurn.items.length > 0
  if (!matchingTurn) turns.push(targetTurn)
  targetTurn.items.push({
    type: 'fileChange',
    id: fileChange.id,
    status: fileChange.status,
    ...(fileChange.atIso ? { completedAt: fileChange.atIso } : {}),
    changes: fileChange.changes,
  })
  trimFallbackTurns(turns)
  return !wasVisible
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
  options: {
    startOffset?: number; seedTurns?: boolean; fromStart?: boolean
    cursor?: SessionLogRecoveryCursor; fileSize?: number
    checkpoint?: SessionLogCheckpoint
    recoveryTurns?: FallbackTurn[]
  } = {},
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
  const turns = options.recoveryTurns ?? (options.seedTurns === true ? cloneFallbackTurns(fallbackThread.turns) : [])
  let recoveredTurnCount = options.seedTurns === true
    ? Math.max(
        turns.filter((turn) => turn.items.length > 0).length,
        readNonNegativeInteger(fallbackThread.originalTurnsCount) ?? 0,
      )
    : 0
  const seenMessageIds = new Set<string>()
  hydrateRecoveredMessageIds(turns, seenMessageIds)
  const cursor = options.cursor ?? createRecoveryCursor()
  const fileSize = options.fileSize ?? (await stat(sessionPath)).size
  const checkpoint = options.checkpoint ?? await readSessionLogCheckpoint(sessionPath, fileSize)
  const nativeUiUserHistory = checkpoint.nativeLegacyThreadId === fallbackThreadId
  const startOffset = typeof options.startOffset === 'number'
    ? Math.max(0, Math.min(options.startOffset, fileSize))
    : options.fromStart === true
      ? 0
      : Math.max(0, fileSize - FALLBACK_READ_BYTE_LIMIT)

  const processLine = (line: string, entryOffset: number): void => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (!isSessionLogThreadReadCandidateLine(trimmed)) {
      // A damaged non-candidate can hide a task boundary too. Only validate
      // otherwise skipped records while we hold a scope that could be misused.
      if (cursor.activeTurnId) {
        try { JSON.parse(trimmed) } catch { invalidateRecoveryCursor(cursor) }
      }
      return
    }

    try {
      const entry = asRecord(JSON.parse(trimmed) as unknown)
      if (!entry) return
      const lifecycle = readSessionLogLifecycle(entry)
      let lifecycleTurn = lifecycle ? findFallbackTurn(turns, lifecycle.turnId) : null
      // A known settled start replay is also a no-op for input ownership. It
      // must neither reopen that turn nor poison the next legitimate start.
      const settledStartReplay = lifecycle?.status === 'inProgress'
        && lifecycleTurn && hasSettledSessionLogLifecycle(lifecycleTurn)
      if (!settledStartReplay) updateRecoveryCursor(cursor, entry)

      if (lifecycle && !settledStartReplay) {
        if (lifecycle.status === 'inProgress') {
          if (cursor.activeTurnId === lifecycle.turnId) {
            if (!lifecycleTurn) {
              lifecycleTurn = { id: lifecycle.turnId, status: 'completed', items: [] }
              turns.push(lifecycleTurn)
              trimFallbackTurns(turns)
            }
            applySessionLogLifecycle(lifecycleTurn, lifecycle)
          }
        } else if (lifecycleTurn) {
          // A bounded suffix can contain another turn's terminal event. Only
          // the explicitly identified, retained turn may be settled by it.
          applySessionLogLifecycle(lifecycleTurn, lifecycle)
        }
      }

      updatedAt = Math.max(updatedAt, readUnixSeconds(entry.timestamp))
      if (entry.type === 'session_meta') {
        const payload = asRecord(entry.payload)
        if (payload) {
          cwd = cwd || readTrimmedString(payload.cwd)
          source = payload.source ?? source
          createdAt = createdAt || readUnixSeconds(payload.timestamp)
        }
      }

      const fileChange = readEventFileChange(entry, entryOffset)
      if (fileChange) {
        if (seenMessageIds.has(fileChange.id)) return
        seenMessageIds.add(fileChange.id)
        if (appendFileChangeTurn(turns, fileChange)) recoveredTurnCount += 1
        return
      }

      const message = readResponseItemMessage(entry) ?? readEventMessage(entry, entryOffset, cursor, nativeUiUserHistory)
      if (!message) return
      if (nativeUiUserHistory && message.role === 'user' && message.source === 'response_item') {
        // Native legacy records model input before its canonical UI user event.
        // It supplies neither an extra user bubble nor evidence to confirm a
        // local send. Keep only its explicit turn boundary for later activity.
        appendMessageTurn(turns, { ...message, hidden: true })
        return
      }
      if (message.id) {
        if (seenMessageIds.has(message.id)) return
        seenMessageIds.add(message.id)
      }
      if (message.hidden && turns.length === 0) return
      if (appendMessageTurn(turns, message)) recoveredTurnCount += 1
      if (!preview && message.role === 'user') {
        preview = message.text.split('\n')[0]?.trim() ?? ''
      }
    } catch {
      // Skip malformed lines and keep the rest of the recoverable history.
      invalidateRecoveryCursor(cursor)
    }
  }

  if (fileSize > startOffset) {
    const input = createReadStream(sessionPath, {
      start: startOffset,
      end: fileSize - 1,
    })
    // Byte offsets remain stable across full, incremental and UTF-8/CRLF reads.
    // A per-read line counter can collide after append and silently lose input.
    let pending: Buffer[] = []
    let pendingBytes = 0
    let lineOffset = startOffset
    let skipPartialFirstLine = options.startOffset === undefined && startOffset > 0
    const consumeLine = (bytes: Buffer, terminated: boolean): void => {
      if (skipPartialFirstLine) skipPartialFirstLine = false
      else processLine(bytes.toString('utf8'), lineOffset)
      lineOffset += bytes.length + (terminated ? 1 : 0)
    }
    try {
      for await (const chunk of input) {
        const data = chunk as Buffer
        let start = 0
        let newline = data.indexOf(10, start)
        while (newline !== -1) {
          const part = data.subarray(start, newline)
          consumeLine(pending.length > 0 ? Buffer.concat([...pending, part], pendingBytes + part.length) : part, true)
          pending = []
          pendingBytes = 0
          start = newline + 1
          newline = data.indexOf(10, start)
        }
        if (start < data.length) {
          const part = data.subarray(start)
          pending.push(part)
          pendingBytes += part.length
        }
      }
      if (pendingBytes > 0) consumeLine(Buffer.concat(pending, pendingBytes), false)
    } finally {
      input.destroy()
    }
  }

  const visibleTurns = turns.filter((turn) => turn.items.length > 0)
  // A complete known-native read with no UI input yet is usable. A cold tail
  // without visible records says nothing about history outside its window.
  const canReturnEmpty = nativeUiUserHistory && (startOffset === 0 || options.seedTurns === true)
  if (visibleTurns.length === 0 && !canReturnEmpty) return null
  const title = readFallbackThreadTitle(fallbackThread, preview)
  const knownOriginalTurnsCount = readNonNegativeInteger(fallbackThread.originalTurnsCount) ?? 0
  const originalTurnsCount = Math.max(recoveredTurnCount, knownOriginalTurnsCount, visibleTurns.length)
  const turnsStartIndex = Math.max(0, originalTurnsCount - visibleTurns.length)

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
      turns: visibleTurns,
      ...(turnsStartIndex > 0
        ? {
            turnsView: 'recent',
            originalTurnsCount,
            turnsStartIndex,
          }
        : {}),
    },
  }
}

export async function parseThreadReadFromSessionLog(
  sessionPath: string,
  fallbackThreadRead: unknown,
  options: { fromStart?: boolean } = {},
): Promise<unknown | null> {
  return parseThreadReadFromSessionLogRange(sessionPath, fallbackThreadRead, options)
}

export async function readThreadReadFromSessionLog(
  sessionPath: string,
  fallbackThreadRead: unknown,
  options: { fromStart?: boolean } = {},
): Promise<unknown | null> {
  const normalizedSessionPath = sessionPath.trim()
  if (!normalizedSessionPath) return null
  const threadId = readTrimmedString(asRecord(asRecord(fallbackThreadRead)?.thread)?.id)
  if (!threadId) return null

  try {
    const stats = await stat(normalizedSessionPath)
    const fileSignature = getFileSignature(stats)
    const fileIdentity = getFileIdentity(stats)
    const cached = sessionLogThreadReadCacheStateByPath.get(normalizedSessionPath)
    if (cached?.threadId === threadId && cached.fileIdentity === fileIdentity && cached.fileSignature === fileSignature
      && (options.fromStart !== true || cached.fullScan)) {
      return cached.threadRead
    }

    const appendedByteCount = cached ? stats.size - cached.fileSize : 0
    let canReadIncrementally = Boolean(
      cached?.incrementalReady &&
      cached.threadId === threadId &&
      cached.fileIdentity === fileIdentity &&
      (options.fromStart !== true || cached.fullScan) &&
      cached.threadRead &&
      appendedByteCount > 0 &&
      appendedByteCount <= FALLBACK_READ_BYTE_LIMIT,
    )
    if (canReadIncrementally && cached) {
      canReadIncrementally = (await readSessionLogCheckpoint(normalizedSessionPath, cached.fileSize)).key === cached.checkpoint
    }
    const beforeReadCheckpoint = await readSessionLogCheckpoint(normalizedSessionPath, stats.size)
    const cursor = canReadIncrementally && cached ? { ...cached.cursor } : createRecoveryCursor()
    // Keep non-visible explicit turn boundaries privately, otherwise activity
    // appended after a raw-only batch can attach to the previous visible turn.
    // Clone before parsing so a rejected read cannot mutate a previous cache.
    const recoveryTurns = canReadIncrementally && cached ? cloneFallbackTurns(cached.recoveryTurns) : []
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
          cursor,
          fileSize: stats.size,
          checkpoint: beforeReadCheckpoint,
          recoveryTurns,
        })
      : await parseThreadReadFromSessionLogRange(normalizedSessionPath, fallbackThreadRead, {
          ...options, cursor, fileSize: stats.size, checkpoint: beforeReadCheckpoint, recoveryTurns,
        })
    const checkpoint = await readSessionLogCheckpoint(normalizedSessionPath, stats.size)
    const afterReadStats = await stat(normalizedSessionPath)
    if (getFileIdentity(afterReadStats) !== fileIdentity
      || checkpoint.key !== beforeReadCheckpoint.key
      || (afterReadStats.size <= stats.size && getFileSignature(afterReadStats) !== fileSignature)) {
      // Never seed a later append with a cursor parsed before a rewrite and a
      // checkpoint captured after it. Ordinary append beyond our fixed range
      // can keep the cache; the next read starts at that original range end.
      // These sampled guards assume append-only log interiors. Arbitrary
      // in-place middle edits plus append need stronger integrity evidence.
      sessionLogThreadReadCacheStateByPath.delete(normalizedSessionPath)
      // Do not let the outer runtime cache remember a UI history interpreted
      // using a native-source declaration that changed during this read.
      if (beforeReadCheckpoint.nativeLegacyThreadId === threadId
        || checkpoint.nativeLegacyThreadId === threadId) return null
      return threadRead
    }
    writeCacheState(normalizedSessionPath, {
      threadId,
      fileSignature,
      fileIdentity,
      fileSize: stats.size,
      checkpoint: checkpoint.key,
      incrementalReady: checkpoint.endsWithNewline,
      fullScan: options.fromStart === true || (canReadIncrementally && cached?.fullScan === true),
      threadRead,
      cursor,
      recoveryTurns,
    })
    return threadRead
  } catch {
    writeCacheState(normalizedSessionPath, {
      threadId,
      fileSignature: 'missing',
      fileIdentity: '',
      fileSize: 0,
      checkpoint: '',
      incrementalReady: false,
      fullScan: false,
      threadRead: null,
      cursor: createRecoveryCursor(),
      recoveryTurns: [],
    })
    return null
  }
}
