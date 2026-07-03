import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

export type TokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown
  last: TokenUsageBreakdown
  modelContextWindow: number | null
  usedPercent: number | null
  remainingTokens: number | null
}

type SessionLogThreadTokenUsageCacheState = {
  fileSignature: string | null
  tokenUsage: ThreadTokenUsage | null
}

const MAX_SESSION_LOG_TOKEN_USAGE_CACHE_ENTRIES = 400
const sessionLogThreadTokenUsageCacheStateByPath = new Map<string, SessionLogThreadTokenUsageCacheState>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function readRecordNumberByAliases(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in record) {
      return readNonNegativeNumber(record[key])
    }
  }
  return 0
}

function getFileSignature(stats: { mtimeMs: number; size: number }): string {
  return `${String(stats.mtimeMs)}:${String(stats.size)}`
}

function writeSessionLogThreadTokenUsageCacheState(
  sessionPath: string,
  cacheState: SessionLogThreadTokenUsageCacheState,
): void {
  if (sessionLogThreadTokenUsageCacheStateByPath.has(sessionPath)) {
    sessionLogThreadTokenUsageCacheStateByPath.delete(sessionPath)
  }
  sessionLogThreadTokenUsageCacheStateByPath.set(sessionPath, cacheState)
  while (sessionLogThreadTokenUsageCacheStateByPath.size > MAX_SESSION_LOG_TOKEN_USAGE_CACHE_ENTRIES) {
    const oldestKey = sessionLogThreadTokenUsageCacheStateByPath.keys().next().value
    if (typeof oldestKey !== 'string') break
    sessionLogThreadTokenUsageCacheStateByPath.delete(oldestKey)
  }
}

export function normalizeTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    totalTokens: readRecordNumberByAliases(record, 'totalTokens', 'total_tokens'),
    inputTokens: readRecordNumberByAliases(record, 'inputTokens', 'input_tokens'),
    cachedInputTokens: readRecordNumberByAliases(record, 'cachedInputTokens', 'cached_input_tokens'),
    outputTokens: readRecordNumberByAliases(record, 'outputTokens', 'output_tokens'),
    reasoningOutputTokens: readRecordNumberByAliases(record, 'reasoningOutputTokens', 'reasoning_output_tokens'),
  }
}

export function normalizeThreadTokenUsage(value: unknown): ThreadTokenUsage | null {
  const record = asRecord(value)
  if (!record) return null
  const total = normalizeTokenUsageBreakdown(record.total ?? record.total_token_usage)
  const last = normalizeTokenUsageBreakdown(record.last ?? record.last_token_usage)
  if (!total || !last) return null

  const rawContextWindow = record.modelContextWindow ?? record.model_context_window
  const modelContextWindow =
    typeof rawContextWindow === 'number' && Number.isFinite(rawContextWindow) && rawContextWindow > 0
      ? Math.max(0, rawContextWindow)
      : null
  const rawUsedPercent = record.usedPercent ?? record.used_percent
  const derivedUsedTokens =
    typeof modelContextWindow === 'number' && modelContextWindow > 0
      ? Math.min(Math.max(last.totalTokens, 0), modelContextWindow)
      : null
  const usedPercent =
    typeof rawUsedPercent === 'number' && Number.isFinite(rawUsedPercent)
      ? Math.min(Math.max(rawUsedPercent, 0), 100)
      : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number' && modelContextWindow > 0
        ? Math.min(Math.max((derivedUsedTokens / modelContextWindow) * 100, 0), 100)
        : null
  const rawRemainingTokens = record.remainingTokens ?? record.remaining_tokens
  const remainingTokens =
    typeof rawRemainingTokens === 'number' && Number.isFinite(rawRemainingTokens)
      ? Math.max(0, rawRemainingTokens)
      : typeof derivedUsedTokens === 'number' && typeof modelContextWindow === 'number'
        ? Math.max(modelContextWindow - derivedUsedTokens, 0)
        : null

  return {
    total,
    last,
    modelContextWindow,
    usedPercent,
    remainingTokens,
  }
}

export function readThreadTokenUsageFromThreadReadPayload(payload: unknown): ThreadTokenUsage | null {
  const root = asRecord(payload)
  const thread = asRecord(root?.thread)
  return normalizeThreadTokenUsage(root?.tokenUsage ?? thread?.tokenUsage)
}

export function normalizeThreadTokenUsageFromSessionLogEntry(entry: unknown): ThreadTokenUsage | null {
  const record = asRecord(entry)
  if (record?.type !== 'event_msg') return null

  const payload = asRecord(record.payload)
  if (payload?.type !== 'token_count') return null

  const info = asRecord(payload.info)
  if (!info) return null

  return normalizeThreadTokenUsage({
    total: info.total ?? info.total_token_usage,
    last: info.last ?? info.last_token_usage,
    modelContextWindow: info.modelContextWindow ?? info.model_context_window,
  })
}

export async function parseThreadTokenUsageFromSessionLog(sessionPath: string): Promise<ThreadTokenUsage | null> {
  let latestTokenUsage: ThreadTokenUsage | null = null
  const input = createReadStream(sessionPath, { encoding: 'utf8' })
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const tokenUsage = normalizeThreadTokenUsageFromSessionLogEntry(JSON.parse(trimmed) as unknown)
        if (tokenUsage) {
          latestTokenUsage = tokenUsage
        }
      } catch {
        // Skip malformed lines and keep scanning the rest of the session log.
      }
    }
  } finally {
    lines.close()
    input.close()
  }

  return latestTokenUsage
}

export async function readThreadTokenUsageFromSessionLog(sessionPath: string): Promise<ThreadTokenUsage | null> {
  const normalizedSessionPath = sessionPath.trim()
  if (!normalizedSessionPath) return null

  try {
    const stats = await stat(normalizedSessionPath)
    const fileSignature = getFileSignature(stats)
    const cached = sessionLogThreadTokenUsageCacheStateByPath.get(normalizedSessionPath)
    if (cached?.fileSignature === fileSignature) {
      return cached.tokenUsage
    }

    const tokenUsage = await parseThreadTokenUsageFromSessionLog(normalizedSessionPath)
    writeSessionLogThreadTokenUsageCacheState(normalizedSessionPath, { fileSignature, tokenUsage })
    return tokenUsage
  } catch {
    writeSessionLogThreadTokenUsageCacheState(normalizedSessionPath, {
      fileSignature: 'missing',
      tokenUsage: null,
    })
    return null
  }
}

export class ThreadTokenUsageStore {
  private readonly tokenUsageByThreadId = new Map<string, ThreadTokenUsage>()

  observeUpdate(params: unknown): void {
    const record = asRecord(params)
    const threadId = typeof record?.threadId === 'string' ? record.threadId.trim() : ''
    if (!threadId) return

    const tokenUsage = normalizeThreadTokenUsage(record?.tokenUsage)
    if (tokenUsage) {
      this.tokenUsageByThreadId.set(threadId, tokenUsage)
      return
    }

    this.tokenUsageByThreadId.delete(threadId)
  }

  get(threadId: string): ThreadTokenUsage | null {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null
    return this.tokenUsageByThreadId.get(normalizedThreadId) ?? null
  }

  clear(): void {
    this.tokenUsageByThreadId.clear()
  }

  get count(): number {
    return this.tokenUsageByThreadId.size
  }
}
