import type {
  Thread,
  ThreadItem,
  ThreadReadResponse,
  ThreadListResponse,
  Turn,
  UserInput,
} from '../appServerDtos.js'
import type { CommandExecutionData, UiFileAttachment, UiMessage, UiProjectGroup, UiThread } from '../../types/codex.js'
import { normalizePathForComparison, normalizePathForUi, toProjectName } from '../../pathUtils.js'

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function toRawPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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
  itemId: string,
  content: UserInput[] | undefined,
): { text: string; images: string[]; fileAttachments: UiFileAttachment[]; rawBlocks: UiMessage[] } {
  if (!Array.isArray(content)) return { text: '', images: [], fileAttachments: [], rawBlocks: [] }

  const textChunks: string[] = []
  const images: string[] = []
  const rawBlocks: UiMessage[] = []

  for (const [index, block] of content.entries()) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textChunks.push(block.text)
    }
    if (block.type === 'image' && typeof block.url === 'string' && block.url.trim().length > 0) {
      images.push(block.url.trim())
    }
    if (block.type === 'localImage' && typeof block.path === 'string' && block.path.trim().length > 0) {
      images.push(block.path.trim())
    }

    if (block.type !== 'text' && block.type !== 'image' && block.type !== 'localImage') {
      rawBlocks.push({
        id: `${itemId}:user-content:${index}`,
        role: 'user',
        text: '',
        messageType: `userContent.${block.type}`,
        rawPayload: toRawPayload(block),
        isUnhandled: true,
      })
    }
  }

  const fullText = textChunks.join('\n')
  const fileAttachments = extractFileAttachments(fullText)

  return {
    text: extractCodexUserRequestText(fullText),
    images,
    fileAttachments,
    rawBlocks,
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function pushImageCandidate(images: string[], value: unknown): void {
  const candidate = readTrimmedString(value)
  if (!candidate || images.includes(candidate)) return
  images.push(candidate)
}

function collectImageCandidatesFromValue(value: unknown, images: string[], depth = 0, trustedImageContext = false): void {
  if (depth > 6 || value === null || value === undefined) return

  if (typeof value === 'string') {
    if (trustedImageContext) {
      pushImageCandidate(images, value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const row of value) {
      collectImageCandidatesFromValue(row, images, depth + 1, trustedImageContext)
    }
    return
  }

  if (typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const type = readTrimmedString(record.type).toLowerCase()
  const isImageRecord =
    type.includes('image') ||
    record.image_url !== undefined ||
    record.images !== undefined ||
    record.localImage !== undefined ||
    record.local_image !== undefined

  if (isImageRecord) {
    pushImageCandidate(images, record.url)
    pushImageCandidate(images, record.path)
    pushImageCandidate(images, record.image)
    pushImageCandidate(images, record.image_url)
    pushImageCandidate(images, record.localImage)
    pushImageCandidate(images, record.local_image)
  }

  const data = record.data
  if (data && typeof data === 'object') {
    if (isImageRecord) {
      const dataRecord = data as Record<string, unknown>
      pushImageCandidate(images, dataRecord.url)
      pushImageCandidate(images, dataRecord.path)
      pushImageCandidate(images, dataRecord.image)
      pushImageCandidate(images, dataRecord.image_url)
    }
    collectImageCandidatesFromValue(data, images, depth + 1, isImageRecord)
  }

  const imageUrl = record.image_url
  if (imageUrl && typeof imageUrl === 'object') {
    const imageUrlRecord = imageUrl as Record<string, unknown>
    pushImageCandidate(images, imageUrlRecord.url)
    pushImageCandidate(images, imageUrlRecord.path)
    collectImageCandidatesFromValue(imageUrl, images, depth + 1, true)
  }

  const imagesValue = record.images
  if (Array.isArray(imagesValue)) {
    collectImageCandidatesFromValue(imagesValue, images, depth + 1, true)
  }

  const content = record.content
  if (Array.isArray(content)) {
    collectImageCandidatesFromValue(content, images, depth + 1)
  }
}

function extractAssistantImages(item: ThreadItem): string[] {
  const images: string[] = []
  collectImageCandidatesFromValue(item, images)
  return images
}

function toUiMessages(item: ThreadItem): UiMessage[] {
  const rawItem = item as Record<string, unknown>
  const itemId = readTrimmedString(rawItem.id) || `unhandled:${readTrimmedString(rawItem.type) || 'item'}`
  const itemType = readTrimmedString(rawItem.type)

  if (item.type === 'agentMessage') {
    const text = typeof item.text === 'string' ? item.text : ''
    const images = extractAssistantImages(item)
    return [
      {
        id: item.id,
        role: 'assistant',
        text,
        images: images.length > 0 ? images : undefined,
        messageType: item.type,
      },
    ]
  }

  if (item.type === 'imageView') {
    const images: string[] = []
    pushImageCandidate(images, rawItem.path)
    pushImageCandidate(images, rawItem.url)
    collectImageCandidatesFromValue(rawItem, images)
    if (images.length === 0) return []
    return [
      {
        id: item.id,
        role: 'assistant',
        text: '',
        images,
        messageType: item.type,
      },
    ]
  }

  if (item.type === 'userMessage') {
    const parsed = parseUserMessageContent(item.id, item.content as UserInput[] | undefined)
    const messages: UiMessage[] = []
    const hasRenderableUserContent = parsed.text.length > 0 || parsed.images.length > 0 || parsed.fileAttachments.length > 0

    if (hasRenderableUserContent) {
      messages.push({
        id: item.id,
        role: 'user',
        text: parsed.text,
        images: parsed.images,
        fileAttachments: parsed.fileAttachments.length > 0 ? parsed.fileAttachments : undefined,
        messageType: item.type,
      })
    }

    messages.push(...parsed.rawBlocks)
    if (messages.length === 0) {
      return []
    }

    return messages
  }

  if (item.type === 'reasoning') {
    return []
  }

  if (item.type === 'commandExecution') {
    const status = normalizeCommandStatus(rawItem.status)
    const cmd = typeof rawItem.command === 'string' ? rawItem.command : ''
    const cwd = typeof rawItem.cwd === 'string' ? rawItem.cwd : null
    const aggregatedOutput = typeof rawItem.aggregatedOutput === 'string' ? rawItem.aggregatedOutput : ''
    const exitCode = typeof rawItem.exitCode === 'number' ? rawItem.exitCode : null
    const durationMs = typeof rawItem.durationMs === 'number' && Number.isFinite(rawItem.durationMs) ? Math.max(0, rawItem.durationMs) : null
    return [
      {
        id: item.id,
        role: 'system' as const,
        text: cmd,
        messageType: 'commandExecution',
        commandExecution: { command: cmd, cwd, status, aggregatedOutput, exitCode, durationMs, startedAtMs: null },
      },
    ]
  }

  return [
    {
      id: itemId,
      role: 'system',
      text: itemType ? `Unhandled App Server item: ${itemType}` : 'Unhandled App Server item',
      messageType: itemType ? `unhandled.${itemType}` : 'unhandled.item',
      rawPayload: toRawPayload(item),
      isUnhandled: true,
    },
  ]
}

function normalizeCommandStatus(value: unknown): CommandExecutionData['status'] {
  if (value === 'completed' || value === 'failed' || value === 'declined' || value === 'interrupted') return value
  if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
  return 'completed'
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

  return Array.from(grouped.entries())
    .map(([projectName, projectThreads]) => ({
      projectName,
      threads: projectThreads.sort(
        (a, b) => new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
      ),
    }))
    .sort((a, b) => {
      const aLast = new Date(a.threads[0]?.updatedAtIso ?? 0).getTime()
      const bLast = new Date(b.threads[0]?.updatedAtIso ?? 0).getTime()
      return bLast - aLast
    })
}

export function normalizeThreadGroupsV2(payload: ThreadListResponse): UiProjectGroup[] {
  const uiThreads = payload.data.map(toUiThread)
  return groupThreadsByProject(uiThreads)
}

export function normalizeThreadMessagesV2(payload: ThreadReadResponse): UiMessage[] {
  const turns = Array.isArray(payload.thread.turns) ? payload.thread.turns : []
  const messages: UiMessage[] = []
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex]
    const rawTurn = turn as Record<string, unknown>
    const itemsView = readTrimmedString(rawTurn.itemsView)
    const items = Array.isArray(turn.items) ? turn.items : []
    if (items.length === 0 && itemsView && itemsView !== 'full') {
      messages.push({
        id: readTrimmedString(rawTurn.id) || `turn-${String(turnIndex)}:items-view`,
        role: 'system',
        text: `App Server turn items not loaded: ${itemsView}`,
        messageType: `unhandled.turnItemsView.${itemsView}`,
        rawPayload: toRawPayload(turn),
        isUnhandled: true,
        turnIndex,
      })
      continue
    }
    for (const item of items) {
      const threadItem = (
        item && typeof item === 'object' && !Array.isArray(item)
          ? item
          : { id: `turn-${String(turnIndex)}:item-${String(messages.length)}`, type: 'invalidItem', content: item }
      ) as ThreadItem
      for (const msg of toUiMessages(threadItem)) {
        messages.push({ ...msg, turnIndex })
      }
    }
  }
  return messages
}

export function readThreadInProgressFromResponse(payload: ThreadReadResponse): boolean {
  return readThreadInProgress(payload.thread as Thread)
}

export function readActiveTurnIdFromResponse(payload: ThreadReadResponse): string {
  return readThreadActiveTurnId(payload.thread)
}
