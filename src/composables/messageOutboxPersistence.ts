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

const MESSAGE_OUTBOX_VERSION = 1
const MESSAGE_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MESSAGE_OUTBOX_MAX_ENTRIES = 12
const MESSAGE_OUTBOX_MAX_REMOVALS = 256
const OUTBOX_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

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

export function loadMessageOutboxState(): MessageOutboxState {
  if (typeof window === 'undefined') return emptyMessageOutboxState()
  try {
    return parseMessageOutboxState(window.localStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY))
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
    const serialized = serializeMessageOutboxState(entries, removals)
    if (serialized === null) {
      window.localStorage.removeItem(MESSAGE_OUTBOX_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, serialized)
  } catch {
    // Sending still proceeds when private mode or storage quota makes persistence unavailable.
  }
}
