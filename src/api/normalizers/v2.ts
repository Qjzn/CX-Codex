import type {
  Thread,
  ThreadItem,
  ThreadReadResponse,
  ThreadListResponse,
  Turn,
  UserInput,
} from '../appServerDtos.js'
import type { AcknowledgedUserMessage, UiFileAttachment, UiProjectGroup, UiThread } from '../../types/codex.js'
import { normalizePathForComparison, normalizePathForUi, toProjectName } from '../../pathUtils.js'
import { orderProjectGroupsByRecentActivity } from '../../utils/projectGroupOrdering.js'
import { isInternalContextMessageText } from '../../internalContextMessage.js'

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

const FILE_ATTACHMENT_LINE = /^##\s+(.+?):\s+(.+?)\s*$/
const FILES_MENTIONED_MARKER = /^#\s*files mentioned by the user\s*:?\s*$/i

function extractFileAttachments(value: string): UiFileAttachment[] {
  const markerIdx = value.split('\n').findIndex((line) => FILES_MENTIONED_MARKER.test(line.trim()))
  if (markerIdx < 0) return []
  const lines = value.split('\n').slice(markerIdx + 1)
  const attachments: UiFileAttachment[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(FILE_ATTACHMENT_LINE)
    if (!m) break
    const label = m[1]?.trim()
    const path = m[2]?.trim().replace(/\s+\((?:lines?\s+\d+(?:-\d+)?)\)\s*$/, '')
    if (label && path) attachments.push({ label, path })
  }
  return attachments
}

function extractCodexUserRequestText(value: string): string {
  const markerRegex = /(?:^|\n)\s{0,3}#{0,6}\s*my request for codex\s*:?\s*/giu
  const matches = Array.from(value.matchAll(markerRegex))
  if (matches.length === 0) {
    return value.trim()
  }

  const lastMatch = matches.at(-1)
  if (!lastMatch || typeof lastMatch.index !== 'number') {
    return value.trim()
  }

  const markerOffset = lastMatch.index + lastMatch[0].length
  return value.slice(markerOffset).trim()
}

function parseUserMessageContent(
  content: UserInput[] | undefined,
): { text: string; images: string[]; fileAttachments: UiFileAttachment[] } {
  if (!Array.isArray(content)) return { text: '', images: [], fileAttachments: [] }

  const textChunks: string[] = []
  const images: string[] = []

  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textChunks.push(block.text)
    }
    if (block.type === 'image' && typeof block.url === 'string' && block.url.trim().length > 0) {
      images.push(block.url.trim())
    }
    if (block.type === 'localImage' && typeof block.path === 'string' && block.path.trim().length > 0) {
      images.push(block.path.trim())
    }
  }

  const fullText = textChunks.join('\n')
  const fileAttachments = extractFileAttachments(fullText)

  return {
    text: extractCodexUserRequestText(fullText),
    images,
    fileAttachments,
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0
}

function readFirstRecordKey(value: Record<string, unknown>): string {
  return Object.keys(value).find((key) => key.trim().length > 0)?.trim() ?? ''
}

function readSubAgentSourceKind(value: unknown): string {
  const direct = readTrimmedString(value)
  if (direct) return `subAgent.${direct}`
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'subAgent'

  const tag = readFirstRecordKey(value as Record<string, unknown>)
  return tag ? `subAgent.${tag}` : 'subAgent'
}

function readThreadSourceKind(value: unknown): string | undefined {
  const direct = readTrimmedString(value)
  if (direct) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as Record<string, unknown>
  if (record.subAgent !== undefined) return readSubAgentSourceKind(record.subAgent)

  const tag = readFirstRecordKey(record)
  return tag || undefined
}

function toAcknowledgedUserMessage(item: ThreadItem): AcknowledgedUserMessage | null {
  if (item.type !== 'userMessage') return null
  const parsed = parseUserMessageContent(item.content as UserInput[] | undefined)
  if (isInternalContextMessageText(parsed.text)) return null
  if (parsed.text.length === 0 && parsed.images.length === 0 && parsed.fileAttachments.length === 0) return null
  return {
    id: item.id,
    role: 'user',
    text: parsed.text,
    images: parsed.images,
    fileAttachments: parsed.fileAttachments.length > 0 ? parsed.fileAttachments : undefined,
    messageType: item.type,
  }
}

function pickThreadName(summary: Thread): string {
  const rawSummary = summary as Record<string, unknown>
  const direct = [rawSummary.name, rawSummary.title, summary.preview]
  for (const candidate of direct) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return ''
}

function toThreadTitle(summary: Thread): string {
  const named = pickThreadName(summary)
  return named.length > 0 ? named : 'Untitled thread'
}

function isTurnInProgress(turn: Turn | null | undefined): boolean {
  return turn?.status === 'inProgress'
}

function readThreadActiveTurnId(summary: ThreadReadResponse['thread']): string {
  const rawThread = summary as Record<string, unknown>
  const directActiveTurnId = typeof rawThread.activeTurnId === 'string' ? rawThread.activeTurnId.trim() : ''
  if (directActiveTurnId) return directActiveTurnId

  const status =
    rawThread.status && typeof rawThread.status === 'object' && !Array.isArray(rawThread.status)
      ? rawThread.status as Record<string, unknown>
      : null
  const statusActiveTurnId =
    typeof status?.activeTurnId === 'string'
      ? status.activeTurnId.trim()
      : typeof status?.turnId === 'string'
        ? status.turnId.trim()
        : ''
  if (statusActiveTurnId) return statusActiveTurnId

  const turns = Array.isArray(summary.turns) ? summary.turns : []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (isTurnInProgress(turn) && typeof turn.id === 'string' && turn.id.trim().length > 0) {
      return turn.id.trim()
    }
  }
  return ''
}

function readThreadInProgress(summary: Thread): boolean {
  const rawSummary = summary as Record<string, unknown>
  if (rawSummary.inProgress === true) return true
  if (rawSummary.status === 'inProgress' || rawSummary.turnStatus === 'inProgress') return true
  const statusRecord =
    rawSummary.status && typeof rawSummary.status === 'object' && !Array.isArray(rawSummary.status)
      ? rawSummary.status as Record<string, unknown>
      : null
  const statusType = typeof statusRecord?.type === 'string' ? statusRecord.type.trim().toLowerCase() : ''
  if (
    statusType === 'inprogress'
    || statusType === 'in_progress'
    || statusType === 'running'
    || statusType === 'active'
    || statusType === 'processing'
  ) {
    return true
  }

  const turns = Array.isArray(summary.turns) ? summary.turns : []
  const lastTurn = turns.at(-1)
  return isTurnInProgress(lastTurn)
}

function toUiThread(summary: Thread): UiThread {
  const rawSummary = summary as Record<string, unknown>
  const cwd = normalizePathForUi(typeof rawSummary.cwd === 'string' ? rawSummary.cwd : summary.cwd)
  const comparableCwd = normalizePathForComparison(cwd)
  const sourceKind = readThreadSourceKind(rawSummary.source)
  const hasWorktree =
    rawSummary.isWorktree === true ||
    rawSummary.worktree === true ||
    rawSummary.worktreeId !== undefined ||
    rawSummary.worktreePath !== undefined ||
    comparableCwd.includes('/.codex/worktrees/') ||
    comparableCwd.includes('/.git/worktrees/')

  return {
    id: summary.id,
    title: toThreadTitle(summary),
    projectName: toProjectName(cwd),
    cwd,
    sourceKind,
    hasWorktree,
    createdAtIso: toIso(summary.createdAt),
    updatedAtIso: toIso(summary.updatedAt),
    preview: summary.preview,
    unread: false,
    inProgress: readThreadInProgress(summary),
  }
}

function groupThreadsByProject(threads: UiThread[]): UiProjectGroup[] {
  const grouped = new Map<string, UiThread[]>()
  for (const thread of threads) {
    const rows = grouped.get(thread.projectName)
    if (rows) rows.push(thread)
    else grouped.set(thread.projectName, [thread])
  }

  const groups = Array.from(grouped.entries())
    .map(([projectName, projectThreads]) => ({
      projectName,
      threads: projectThreads.sort(
        (a, b) => new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
      ),
    }))
  return orderProjectGroupsByRecentActivity(groups)
}

export function normalizeThreadGroupsV2(payload: ThreadListResponse): UiProjectGroup[] {
  const seenThreadIds = new Set<string>()
  const uiThreads: UiThread[] = []
  for (const thread of payload.data) {
    const uiThread = toUiThread(thread)
    if (seenThreadIds.has(uiThread.id)) continue
    seenThreadIds.add(uiThread.id)
    uiThreads.push(uiThread)
  }
  return groupThreadsByProject(uiThreads)
}

export function normalizeAcknowledgedUserMessagesV2(payload: ThreadReadResponse): AcknowledgedUserMessage[] {
  const turns = Array.isArray(payload.thread.turns) ? payload.thread.turns : []
  const messages: AcknowledgedUserMessage[] = []
  const rawThread = payload.thread as Record<string, unknown>
  const turnsStartIndex = readNonNegativeInteger(rawThread.turnsStartIndex)
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const absoluteTurnIndex = turnsStartIndex + turnIndex
    const turn = turns[turnIndex]
    const rawTurn = turn as Record<string, unknown>
    const items = Array.isArray(turn.items) ? turn.items : []
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const threadItem = item as ThreadItem
      const turnId = readTrimmedString(rawTurn.id)
      const message = toAcknowledgedUserMessage(threadItem)
      if (message) messages.push({ ...message, turnIndex: absoluteTurnIndex, ...(turnId ? { turnId } : {}) })
    }
  }
  return messages
}

export function applyActiveTurnIdToAcknowledgedUserMessages(
  messages: AcknowledgedUserMessage[],
  activeTurnId: string,
  active: boolean,
): AcknowledgedUserMessage[] {
  const normalizedTurnId = activeTurnId.trim()
  if (!active || !normalizedTurnId || messages.length === 0) return messages

  let activeTurnStartIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || message.messageType !== 'userMessage') continue
    activeTurnStartIndex = index
    break
  }
  if (activeTurnStartIndex < 0) return messages

  let changed = false
  const nextMessages = messages.map((message, index) => {
    if (index < activeTurnStartIndex || message.turnId === normalizedTurnId) return message
    changed = true
    return { ...message, turnId: normalizedTurnId }
  })
  return changed ? nextMessages : messages
}

export function readThreadInProgressFromResponse(payload: ThreadReadResponse): boolean {
  return readThreadInProgress(payload.thread as Thread)
}

export function readActiveTurnIdFromResponse(payload: ThreadReadResponse): string {
  return readThreadActiveTurnId(payload.thread)
}
