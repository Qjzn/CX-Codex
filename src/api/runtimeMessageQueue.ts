import type {
  CollaborationMode,
  ComposerPluginSelection,
  ComposerTurnOptions,
  ReasoningEffort,
  SpeedMode,
} from '../types/codex'
import type { FileAttachmentParam } from './codexGateway'
import { normalizeComposerTurnOptions } from '../composables/composerTurnOptions'

const QUEUE_REQUEST_TIMEOUT_MS = 15_000

export type RuntimeMessageQueueEntry = {
  id: string
  clientMessageId: string
  threadId: string
  deliveryState: 'queued' | 'failed'
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: FileAttachmentParam[]
  modelId: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
  collaborationMode: CollaborationMode
  turnOptions?: ComposerTurnOptions
  createdAtIso: string
  error: string | null
}

export type RuntimeMessageQueueEnqueueArgs = {
  threadId: string
  text: string
  imageUrls?: string[]
  model?: string
  effort?: ReasoningEffort
  skills?: Array<{ name: string; path: string }>
  fileAttachments?: FileAttachmentParam[]
  collaborationMode?: CollaborationMode
  turnOptions?: ComposerTurnOptions
  clientMessageId: string
  speedMode: SpeedMode
}

export type RuntimeQueuedMessage = {
  id: string
  serverRequestId?: string
  backgroundPersisted?: boolean
  clientMessageId: string
  deliveryState: 'queued' | 'failed'
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: FileAttachmentParam[]
  modelId: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
  collaborationMode: CollaborationMode
  turnOptions?: ComposerTurnOptions
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  const error = asRecord(payload)?.error
  return typeof error === 'string' && error.trim() ? error : fallback
}

async function queueFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), QUEUE_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${label} timed out`)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | '' {
  const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  return typeof value === 'string' && allowed.includes(value as ReasoningEffort)
    ? value as ReasoningEffort
    : ''
}

function buildTextWithAttachments(prompt: string, files: FileAttachmentParam[]): string {
  if (files.length === 0) return prompt
  const lines = ['# Files mentioned by the user:']
  for (const file of files) lines.push('', `## ${file.label}: ${file.path}`)
  lines.push('', '## My request for Codex:', '', prompt, '')
  return lines.join('\n')
}

function isLocalImageInput(value: string): boolean {
  return value.startsWith('file://') || /^[A-Za-z]:[\\/]/u.test(value) || (value.startsWith('/') && !value.startsWith('/codex-local-image?'))
}

function buildTurnStartInput(
  text: string,
  imageUrls: string[],
  skills: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[],
  plugins: ComposerPluginSelection[] = [],
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [
    { type: 'text', text: buildTextWithAttachments(text, fileAttachments) },
  ]
  for (const rawUrl of imageUrls) {
    const url = rawUrl.trim()
    if (!url) continue
    input.push(isLocalImageInput(url)
      ? { type: 'localImage', path: url }
      : { type: 'image', url, image_url: url })
  }
  for (const skill of skills) input.push({ type: 'skill', name: skill.name, path: skill.path })
  for (const plugin of plugins) {
    const name = plugin.name.trim()
    const id = plugin.id.trim()
    const path = plugin.path?.trim() || (plugin.source === 'app' ? `app://${id}` : `plugin://${id}`)
    if (name && path) input.push({ type: 'mention', name, path })
  }
  return input
}

function normalizeEntry(value: unknown): RuntimeMessageQueueEntry | null {
  const row = asRecord(value)
  const requestId = typeof row?.requestId === 'string' ? row.requestId.trim() : ''
  const threadId = typeof row?.threadId === 'string' ? row.threadId.trim() : ''
  if (!row || !requestId || !threadId) return null
  const metadata = asRecord(asRecord(row.payload)?.queueMetadata) ?? {}
  const skills = Array.isArray(metadata.skills)
    ? metadata.skills.flatMap((item) => {
        const skill = asRecord(item)
        const name = typeof skill?.name === 'string' ? skill.name : ''
        const path = typeof skill?.path === 'string' ? skill.path : ''
        return name && path ? [{ name, path }] : []
      })
    : []
  const fileAttachments = Array.isArray(metadata.fileAttachments)
    ? metadata.fileAttachments.flatMap((item) => {
        const file = asRecord(item)
        const label = typeof file?.label === 'string' ? file.label : ''
        const path = typeof file?.path === 'string' ? file.path : ''
        const fsPath = typeof file?.fsPath === 'string' ? file.fsPath : ''
        return label && (path || fsPath) ? [{ label, path, fsPath }] : []
      })
    : []
  const turnOptions = asRecord(metadata.turnOptions)
  return {
    id: requestId,
    clientMessageId: typeof row.clientMessageId === 'string' ? row.clientMessageId.trim() : '',
    threadId,
    deliveryState: row.status === 'queue_failed' ? 'failed' : 'queued',
    text: typeof metadata.text === 'string' ? metadata.text : '',
    imageUrls: Array.isArray(metadata.imageUrls)
      ? metadata.imageUrls.filter((item): item is string => typeof item === 'string')
      : [],
    skills,
    fileAttachments,
    modelId: typeof metadata.modelId === 'string' ? metadata.modelId.trim() : '',
    reasoningEffort: normalizeReasoningEffort(metadata.reasoningEffort),
    speedMode: metadata.speedMode === 'fast' ? 'fast' : 'standard',
    collaborationMode: metadata.collaborationMode === 'plan' ? 'plan' : 'execute',
    turnOptions: turnOptions ? turnOptions as ComposerTurnOptions : undefined,
    createdAtIso: typeof row.createdAtIso === 'string' ? row.createdAtIso : '',
    error: typeof row.lastError === 'string' ? row.lastError : null,
  }
}

function queuedMessageFromRuntime(entry: RuntimeMessageQueueEntry): RuntimeQueuedMessage {
  return {
    id: entry.id,
    serverRequestId: entry.id,
    backgroundPersisted: true,
    clientMessageId: entry.clientMessageId,
    deliveryState: entry.deliveryState,
    text: entry.text,
    imageUrls: [...entry.imageUrls],
    skills: entry.skills.map((skill) => ({ ...skill })),
    fileAttachments: entry.fileAttachments.map((file) => ({ ...file })),
    modelId: entry.modelId,
    reasoningEffort: entry.reasoningEffort,
    speedMode: entry.speedMode,
    collaborationMode: entry.collaborationMode,
    turnOptions: normalizeComposerTurnOptions(entry.turnOptions),
  }
}

function normalizeQueuedMessage(value: unknown): RuntimeQueuedMessage | null {
  const row = asRecord(value)
  const id = typeof row?.id === 'string' ? row.id.trim() : ''
  if (!row || !id) return null
  const skills = Array.isArray(row.skills)
    ? row.skills.flatMap((item) => {
        const skill = asRecord(item)
        const name = typeof skill?.name === 'string' ? skill.name : ''
        const path = typeof skill?.path === 'string' ? skill.path : ''
        return name && path ? [{ name, path }] : []
      })
    : []
  const fileAttachments = Array.isArray(row.fileAttachments)
    ? row.fileAttachments.flatMap((item) => {
        const file = asRecord(item)
        const label = typeof file?.label === 'string' ? file.label : ''
        const path = typeof file?.path === 'string' ? file.path : ''
        const fsPath = typeof file?.fsPath === 'string' ? file.fsPath : ''
        return label && (path || fsPath) ? [{ label, path, fsPath }] : []
      })
    : []
  return {
    id,
    serverRequestId: typeof row.serverRequestId === 'string' && row.serverRequestId.trim()
      ? row.serverRequestId.trim()
      : undefined,
    backgroundPersisted: row.backgroundPersisted === true,
    clientMessageId: typeof row.clientMessageId === 'string' && row.clientMessageId.trim()
      ? row.clientMessageId.trim()
      : `queued-${id}`,
    deliveryState: row.deliveryState === 'failed' ? 'failed' : 'queued',
    text: typeof row.text === 'string' ? row.text : '',
    imageUrls: Array.isArray(row.imageUrls)
      ? row.imageUrls.filter((item): item is string => typeof item === 'string')
      : [],
    skills,
    fileAttachments,
    modelId: typeof row.modelId === 'string' ? row.modelId.trim() : '',
    reasoningEffort: normalizeReasoningEffort(row.reasoningEffort),
    speedMode: row.speedMode === 'fast' ? 'fast' : 'standard',
    collaborationMode: row.collaborationMode === 'plan' ? 'plan' : 'execute',
    turnOptions: normalizeComposerTurnOptions(row.turnOptions),
  }
}

export function loadQueuedMessagesMap(storageKey: string): Record<string, RuntimeQueuedMessage[]> {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, RuntimeQueuedMessage[]> = {}
    for (const [threadId, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId || !Array.isArray(rows)) continue
      const queue = rows.map(normalizeQueuedMessage).filter((row): row is RuntimeQueuedMessage => row !== null)
      if (queue.length > 0) next[threadId] = queue
    }
    return next
  } catch {
    return {}
  }
}

export function saveQueuedMessagesMap(
  storageKey: string,
  queueByThreadId: Record<string, RuntimeQueuedMessage[]>,
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(queueByThreadId))
  } catch {
    // Keep the in-memory queue when browser storage is unavailable.
  }
}

export async function syncRuntimeMessageQueueState(
  current: Record<string, RuntimeQueuedMessage[]>,
  threadId = '',
): Promise<Record<string, RuntimeQueuedMessage[]>> {
  const normalizedThreadId = threadId.trim()
  const entries = await listRuntimeMessageQueue(normalizedThreadId)
  const serverByThreadId = new Map<string, RuntimeQueuedMessage[]>()
  for (const entry of entries) {
    const queue = serverByThreadId.get(entry.threadId) ?? []
    queue.push(queuedMessageFromRuntime(entry))
    serverByThreadId.set(entry.threadId, queue)
  }
  const merge = (targetThreadId: string): RuntimeQueuedMessage[] => {
    const serverQueue = serverByThreadId.get(targetThreadId) ?? []
    const serverClientIds = new Set(serverQueue.map((message) => message.clientMessageId))
    const localOnly = (current[targetThreadId] ?? [])
      .filter((message) => !message.serverRequestId && !serverClientIds.has(message.clientMessageId))
    return [...serverQueue, ...localOnly]
  }
  if (normalizedThreadId) {
    const queue = merge(normalizedThreadId)
    const next = { ...current }
    if (queue.length > 0) next[normalizedThreadId] = queue
    else delete next[normalizedThreadId]
    return next
  }
  const next: Record<string, RuntimeQueuedMessage[]> = {}
  const threadIds = new Set([...Object.keys(current), ...serverByThreadId.keys()])
  for (const targetThreadId of threadIds) {
    const queue = merge(targetThreadId)
    if (queue.length > 0) next[targetThreadId] = queue
  }
  return next
}

function isRetryableQueueError(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof SyntaxError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return ['failed to fetch', 'networkerror', 'network error', 'load failed', 'connection reset', 'connection refused', 'timed out']
    .some((fragment) => message.includes(fragment))
}

export async function persistRuntimeQueuedMessages(
  threadId: string,
  queue: RuntimeQueuedMessage[],
): Promise<RuntimeQueuedMessage[]> {
  let next = [...queue]
  for (const message of queue) {
    if (message.serverRequestId || message.deliveryState === 'failed') continue
    try {
      const entry = await enqueueRuntimeThreadTurn({
        threadId,
        text: message.text,
        imageUrls: message.imageUrls,
        model: message.modelId || undefined,
        effort: message.reasoningEffort || undefined,
        skills: message.skills,
        fileAttachments: message.fileAttachments,
        collaborationMode: message.collaborationMode,
        turnOptions: message.turnOptions,
        clientMessageId: message.clientMessageId,
        speedMode: message.speedMode,
      })
      next = next.map((candidate) => candidate.clientMessageId === message.clientMessageId
        ? queuedMessageFromRuntime(entry)
        : candidate)
    } catch (error) {
      if (!isRetryableQueueError(error)) {
        next = next.map((candidate) => candidate.id === message.id
          ? { ...candidate, deliveryState: 'failed' }
          : candidate)
      }
    }
  }
  return next
}

export async function enqueueRuntimeThreadTurn(args: RuntimeMessageQueueEnqueueArgs): Promise<RuntimeMessageQueueEntry> {
  const fileAttachments = args.fileAttachments ?? []
  const imageUrls = args.imageUrls ?? []
  const skills = args.skills ?? []
  const collaborationMode = args.collaborationMode ?? 'execute'
  const body: Record<string, unknown> = {
    threadId: args.threadId.trim(),
    input: buildTurnStartInput(args.text, imageUrls, skills, fileAttachments, args.turnOptions?.plugins),
    attachments: fileAttachments.map((file) => ({ ...file })),
    collaborationMode,
    turnOptions: args.turnOptions,
    clientMessageId: args.clientMessageId,
    queueMetadata: {
      text: args.text,
      imageUrls,
      skills,
      fileAttachments,
      modelId: args.model?.trim() ?? '',
      reasoningEffort: args.effort ?? '',
      speedMode: args.speedMode,
      collaborationMode,
      turnOptions: args.turnOptions,
    },
  }
  if (args.model?.trim()) body.model = args.model.trim()
  if (args.effort?.trim()) body.effort = args.effort.trim()

  const response = await queueFetch('/codex-api/runtime/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Runtime queue request')
  const payload = (await response.json()) as unknown
  if (!response.ok && response.status !== 202) {
    throw new Error(errorMessageFromPayload(payload, 'Failed to queue runtime turn'))
  }
  const entry = normalizeEntry(asRecord(payload)?.data)
  if (!entry) throw new Error('Runtime queue response was invalid')
  return entry
}

export async function listRuntimeMessageQueue(threadId = ''): Promise<RuntimeMessageQueueEntry[]> {
  const query = threadId.trim() ? `?threadId=${encodeURIComponent(threadId.trim())}` : ''
  const response = await queueFetch(`/codex-api/runtime/queue${query}`, { method: 'GET' }, 'Runtime queue list request')
  const payload = (await response.json()) as unknown
  if (!response.ok) throw new Error(errorMessageFromPayload(payload, 'Failed to load runtime queue'))
  const rows = asRecord(payload)?.data
  return Array.isArray(rows)
    ? rows.map(normalizeEntry).filter((entry): entry is RuntimeMessageQueueEntry => entry !== null)
    : []
}

export async function removeRuntimeQueuedMessage(requestId: string): Promise<void> {
  const response = await queueFetch(`/codex-api/runtime/queue/${encodeURIComponent(requestId)}`, { method: 'DELETE' }, 'Runtime queue remove request')
  if (!response.ok && response.status !== 404) {
    throw new Error(errorMessageFromPayload(await response.json(), 'Failed to remove queued message'))
  }
}

export async function retryRuntimeQueuedMessage(requestId: string): Promise<void> {
  const response = await queueFetch(`/codex-api/runtime/queue/${encodeURIComponent(requestId)}/retry`, { method: 'POST' }, 'Runtime queue retry request')
  if (!response.ok && response.status !== 202) {
    throw new Error(errorMessageFromPayload(await response.json(), 'Failed to retry queued message'))
  }
}
