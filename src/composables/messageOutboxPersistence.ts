import type {
  CollaborationMode,
  ComposerTurnOptions,
  ReasoningEffort,
} from '../types/codex'
import { normalizeComposerTurnOptions } from './composerTurnOptions'
import {
  mergeMessageOutboxState,
  type MessageOutboxRemoval,
} from './messageOutboxMerge'

export const MESSAGE_OUTBOX_STORAGE_KEY = 'codex-web-local.message-outbox.v1'
const MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX = `${MESSAGE_OUTBOX_STORAGE_KEY}.entry.`
const MESSAGE_OUTBOX_REMOVAL_JOURNAL_PREFIX = `${MESSAGE_OUTBOX_STORAGE_KEY}.removal.`

const MESSAGE_OUTBOX_VERSION = 1
const MESSAGE_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MESSAGE_OUTBOX_MAX_ENTRIES = 12
const MESSAGE_OUTBOX_MAX_REMOVALS = 256
const OUTBOX_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export type MessageOutboxFileAttachment = {
  label: string
  path: string
  fsPath: string
}

export type MessageOutboxEntry = {
  clientMessageId: string
  threadId: string
  cwd: string
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: MessageOutboxFileAttachment[]
  modelId: string
  reasoningEffort: ReasoningEffort | ''
  collaborationMode: CollaborationMode
  turnOptions?: ComposerTurnOptions
  baselineMatchCount?: number
  baselineMessageCount?: number
  baselineTailMessageId?: string
  state: 'sending' | 'waiting' | 'confirming' | 'failed'
  createdAtMs: number
  updatedAtMs: number
}

type MessageOutboxPayload = {
  version: number
  entries: MessageOutboxEntry[]
  removals?: MessageOutboxRemoval[]
}

export type MessageOutboxState = {
  entries: MessageOutboxEntry[]
  removals: MessageOutboxRemoval[]
}

type MessageOutboxStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function emptyMessageOutboxState(): MessageOutboxState {
  return { entries: [], removals: [] }
}

function normalizeMessageOutboxEntry(value: unknown, nowMs: number): MessageOutboxEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const clientMessageId = typeof row.clientMessageId === 'string' ? row.clientMessageId.trim() : ''
  const createdAtMs = typeof row.createdAtMs === 'number' && Number.isFinite(row.createdAtMs)
    ? row.createdAtMs
    : 0
  if (!clientMessageId || createdAtMs <= 0 || nowMs - createdAtMs > MESSAGE_OUTBOX_MAX_AGE_MS) return null

  const imageUrls = Array.isArray(row.imageUrls)
    ? row.imageUrls.filter((item): item is string => typeof item === 'string')
    : []
  const skills = Array.isArray(row.skills)
    ? row.skills
      .filter((item): item is { name: string; path: string } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).name === 'string'
        && typeof (item as Record<string, unknown>).path === 'string'
      ))
      .map((item) => ({ name: item.name, path: item.path }))
    : []
  const fileAttachments = Array.isArray(row.fileAttachments)
    ? row.fileAttachments
      .filter((item): item is MessageOutboxFileAttachment => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).label === 'string'
        && typeof (item as Record<string, unknown>).path === 'string'
        && typeof (item as Record<string, unknown>).fsPath === 'string'
      ))
      .map((item) => ({ label: item.label, path: item.path, fsPath: item.fsPath }))
    : []
  const reasoningEffort = typeof row.reasoningEffort === 'string'
    && OUTBOX_REASONING_EFFORTS.includes(row.reasoningEffort as ReasoningEffort)
    ? row.reasoningEffort as ReasoningEffort
    : ''

  return {
    clientMessageId,
    threadId: typeof row.threadId === 'string' ? row.threadId.trim() : '',
    cwd: typeof row.cwd === 'string' ? row.cwd.trim() : '',
    text: typeof row.text === 'string' ? row.text : '',
    imageUrls,
    skills,
    fileAttachments,
    modelId: typeof row.modelId === 'string' ? row.modelId.trim() : '',
    reasoningEffort,
    collaborationMode: row.collaborationMode === 'plan' ? 'plan' : 'execute',
    turnOptions: normalizeComposerTurnOptions(row.turnOptions),
    baselineMatchCount: typeof row.baselineMatchCount === 'number' && Number.isFinite(row.baselineMatchCount)
      ? Math.max(0, Math.floor(row.baselineMatchCount))
      : undefined,
    baselineMessageCount: typeof row.baselineMessageCount === 'number' && Number.isFinite(row.baselineMessageCount)
      ? Math.max(0, Math.floor(row.baselineMessageCount))
      : undefined,
    baselineTailMessageId: typeof row.baselineTailMessageId === 'string'
      ? row.baselineTailMessageId.trim()
      : undefined,
    state: row.state === 'failed'
      ? 'failed'
      : row.state === 'waiting'
        ? 'waiting'
        : row.state === 'confirming'
          ? 'confirming'
          : 'sending',
    createdAtMs,
    updatedAtMs: typeof row.updatedAtMs === 'number' && Number.isFinite(row.updatedAtMs)
      ? row.updatedAtMs
      : createdAtMs,
  }
}

function normalizeMessageOutboxRemoval(value: unknown, nowMs: number): MessageOutboxRemoval | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const clientMessageId = typeof row.clientMessageId === 'string' ? row.clientMessageId.trim() : ''
  const removedAtMs = typeof row.removedAtMs === 'number' && Number.isFinite(row.removedAtMs)
    ? row.removedAtMs
    : 0
  if (!clientMessageId || removedAtMs <= 0 || nowMs - removedAtMs > MESSAGE_OUTBOX_MAX_AGE_MS) return null
  return { clientMessageId, removedAtMs }
}

export function parseMessageOutboxState(
  raw: string | null | undefined,
  nowMs = Date.now(),
): MessageOutboxState {
  if (!raw) return emptyMessageOutboxState()
  try {
    const parsed = JSON.parse(raw) as Partial<MessageOutboxPayload>
    if (parsed.version !== MESSAGE_OUTBOX_VERSION || !Array.isArray(parsed.entries)) {
      return emptyMessageOutboxState()
    }
    const entries = parsed.entries
      .map((entry) => normalizeMessageOutboxEntry(entry, nowMs))
      .filter((entry): entry is MessageOutboxEntry => entry !== null)
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .slice(-MESSAGE_OUTBOX_MAX_ENTRIES)
    const removals = (Array.isArray(parsed.removals) ? parsed.removals : [])
      .map((entry) => normalizeMessageOutboxRemoval(entry, nowMs))
      .filter((entry): entry is MessageOutboxRemoval => entry !== null)
      .sort((left, right) => left.removedAtMs - right.removedAtMs)
      .slice(-MESSAGE_OUTBOX_MAX_REMOVALS)
    return mergeMessageOutboxState(entries, [], removals, [])
  } catch {
    return emptyMessageOutboxState()
  }
}

export function serializeMessageOutboxState(
  entries: MessageOutboxEntry[],
  removals: MessageOutboxRemoval[],
  nowMs = Date.now(),
): string | null {
  const nextEntries = entries
    .filter((entry) => nowMs - entry.createdAtMs <= MESSAGE_OUTBOX_MAX_AGE_MS)
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(-MESSAGE_OUTBOX_MAX_ENTRIES)
  const nextRemovals = removals
    .filter((entry) => nowMs - entry.removedAtMs <= MESSAGE_OUTBOX_MAX_AGE_MS)
    .sort((left, right) => left.removedAtMs - right.removedAtMs)
    .slice(-MESSAGE_OUTBOX_MAX_REMOVALS)
  if (nextEntries.length === 0 && nextRemovals.length === 0) return null
  const payload: MessageOutboxPayload = {
    version: MESSAGE_OUTBOX_VERSION,
    entries: nextEntries,
    removals: nextRemovals,
  }
  return JSON.stringify(payload)
}

export function isMessageOutboxStorageKey(key: string | null): boolean {
  return key === MESSAGE_OUTBOX_STORAGE_KEY
    || key?.startsWith(MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX) === true
    || key?.startsWith(MESSAGE_OUTBOX_REMOVAL_JOURNAL_PREFIX) === true
}

export function loadMessageOutboxStateFromStorage(
  storage: MessageOutboxStorage,
  nowMs = Date.now(),
): MessageOutboxState {
  const snapshot = parseMessageOutboxState(storage.getItem(MESSAGE_OUTBOX_STORAGE_KEY), nowMs)
  const journalEntries: MessageOutboxEntry[] = []
  const journalRemovals: MessageOutboxRemoval[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || key === MESSAGE_OUTBOX_STORAGE_KEY) continue
    const raw = storage.getItem(key)
    if (!raw) continue
    try {
      const value = JSON.parse(raw) as unknown
      if (key.startsWith(MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX)) {
        const entry = normalizeMessageOutboxEntry(value, nowMs)
        if (entry) journalEntries.push(entry)
      } else if (key.startsWith(MESSAGE_OUTBOX_REMOVAL_JOURNAL_PREFIX)) {
        const removal = normalizeMessageOutboxRemoval(value, nowMs)
        if (removal) journalRemovals.push(removal)
      }
    } catch {
      // Invalid journal rows are ignored and pruned by the next successful save.
    }
  }

  const merged = mergeMessageOutboxState(
    snapshot.entries,
    journalEntries,
    snapshot.removals,
    journalRemovals,
  )
  const bounded = serializeMessageOutboxState(merged.entries, merged.removals, nowMs)
  return parseMessageOutboxState(bounded, nowMs)
}

export function saveMessageOutboxStateToStorage(
  storage: MessageOutboxStorage,
  entries: MessageOutboxEntry[],
  removals: MessageOutboxRemoval[],
  nowMs = Date.now(),
): void {
  pruneMessageOutboxJournals(storage, nowMs)
  for (const entry of entries) {
    storage.setItem(createMessageOutboxJournalKey(MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX, entry.clientMessageId, entry.updatedAtMs), JSON.stringify(entry))
  }
  for (const removal of removals) {
    storage.setItem(createMessageOutboxJournalKey(MESSAGE_OUTBOX_REMOVAL_JOURNAL_PREFIX, removal.clientMessageId, removal.removedAtMs), JSON.stringify(removal))
  }

  const persisted = loadMessageOutboxStateFromStorage(storage, nowMs)
  const merged = mergeMessageOutboxState(entries, persisted.entries, removals, persisted.removals)
  const serialized = serializeMessageOutboxState(merged.entries, merged.removals, nowMs)
  if (serialized === null) {
    storage.removeItem(MESSAGE_OUTBOX_STORAGE_KEY)
  } else {
    storage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, serialized)
  }
  pruneMessageOutboxJournals(storage, nowMs)
}

export function loadMessageOutboxState(): MessageOutboxState {
  if (typeof window === 'undefined') return emptyMessageOutboxState()
  try {
    return loadMessageOutboxStateFromStorage(window.localStorage)
  } catch {
    return emptyMessageOutboxState()
  }
}

export function saveMessageOutboxState(
  entries: MessageOutboxEntry[],
  removals: MessageOutboxRemoval[],
): void {
  if (typeof window === 'undefined') return
  try {
    saveMessageOutboxStateToStorage(window.localStorage, entries, removals)
  } catch {
    // Sending still proceeds when private mode or storage quota makes persistence unavailable.
  }
}

function createMessageOutboxJournalKey(prefix: string, clientMessageId: string, atMs: number): string {
  return `${prefix}${encodeURIComponent(clientMessageId)}.${Math.max(0, Math.trunc(atMs))}`
}

function pruneMessageOutboxJournals(storage: MessageOutboxStorage, nowMs: number): void {
  const keysToRemove = new Set<string>()
  const newestEntriesByClientId = new Map<string, { key: string; atMs: number }>()
  const newestRemovalsByClientId = new Map<string, { key: string; atMs: number }>()
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || (!key.startsWith(MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX) && !key.startsWith(MESSAGE_OUTBOX_REMOVAL_JOURNAL_PREFIX))) {
      continue
    }
    const raw = storage.getItem(key)
    if (!raw) {
      keysToRemove.add(key)
      continue
    }
    try {
      const value = JSON.parse(raw) as unknown
      const isEntry = key.startsWith(MESSAGE_OUTBOX_ENTRY_JOURNAL_PREFIX)
      const normalized = isEntry
        ? (() => {
            const entry = normalizeMessageOutboxEntry(value, nowMs)
            return entry ? { clientMessageId: entry.clientMessageId, atMs: entry.updatedAtMs } : null
          })()
        : (() => {
            const removal = normalizeMessageOutboxRemoval(value, nowMs)
            return removal ? { clientMessageId: removal.clientMessageId, atMs: removal.removedAtMs } : null
          })()
      if (!normalized) {
        keysToRemove.add(key)
        continue
      }
      const newestByClientId = isEntry ? newestEntriesByClientId : newestRemovalsByClientId
      const current = newestByClientId.get(normalized.clientMessageId)
      if (!current || normalized.atMs >= current.atMs) {
        if (current) keysToRemove.add(current.key)
        newestByClientId.set(normalized.clientMessageId, { key, atMs: normalized.atMs })
      } else {
        keysToRemove.add(key)
      }
    } catch {
      keysToRemove.add(key)
    }
  }

  markJournalRowsOverLimit(newestEntriesByClientId, MESSAGE_OUTBOX_MAX_ENTRIES, keysToRemove)
  markJournalRowsOverLimit(newestRemovalsByClientId, MESSAGE_OUTBOX_MAX_REMOVALS, keysToRemove)
  for (const key of keysToRemove) storage.removeItem(key)
}

function markJournalRowsOverLimit(
  rowsByClientId: ReadonlyMap<string, { key: string; atMs: number }>,
  limit: number,
  keysToRemove: Set<string>,
): void {
  const rows = [...rowsByClientId.values()].sort((left, right) => right.atMs - left.atMs)
  for (const row of rows.slice(limit)) keysToRemove.add(row.key)
}
