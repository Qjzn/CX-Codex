import {
  createDurableRuntimeSendPayload,
  createRuntimePromptHash,
  parseRuntimeSendPayload,
} from './runtimePayload.js'
import {
  RuntimeThreadBusyError,
  type RuntimeRequestRecord,
  type RuntimeRequestStatus,
} from './runtimeStore.js'
import {
  isRuntimeThreadStatusTerminal,
  readRuntimeThreadStatusLifecycle,
} from '../runtimeThreadStatus.js'

const QUEUE_SWEEP_INTERVAL_MS = 4_000
const QUEUE_STATUSES: RuntimeRequestStatus[] = ['queued', 'queue_failed']

type RuntimeMessageQueueStore = {
  createRequest(record: {
    requestId: string
    clientMessageId: string
    threadId: string
    status: RuntimeRequestStatus
    promptHash: string
    mode: string
    payload: unknown
  }): RuntimeRequestRecord
  updateRequest(
    requestId: string,
    patch: { status?: RuntimeRequestStatus; lastError?: string | null; incrementRetry?: boolean },
  ): RuntimeRequestRecord | null
  getRequest(requestId: string): RuntimeRequestRecord | null
  getLatestRequestByClientMessageId(clientMessageId: string): RuntimeRequestRecord | null
  getThreadLease(threadId: string): { requestId: string } | null
  listQueuedRequests(threadId?: string, limit?: number): RuntimeRequestRecord[]
  reorderQueuedRequests(threadId: string, requestIds: string[]): boolean
  listQueuedThreadIds(limit?: number): string[]
}

export type RuntimeMessageQueueEntry = {
  requestId: string
  clientMessageId: string
  threadId: string
  status: 'queued' | 'queue_failed'
  createdAtIso: string
  updatedAtIso: string
  lastError: string | null
  payload: unknown
}

export type RuntimeMessageQueueDependencies = {
  store: RuntimeMessageQueueStore
  startRuntimeTurn(payload: unknown): Promise<unknown>
  rpc(method: string, params: unknown): Promise<unknown>
  publishNotification(notification: { method: string; params: unknown }): void
  getErrorMessage(error: unknown, fallback: string): string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toQueueEntry(request: RuntimeRequestRecord): RuntimeMessageQueueEntry {
  return {
    requestId: request.requestId,
    clientMessageId: request.clientMessageId,
    threadId: request.threadId,
    status: request.status === 'queue_failed' ? 'queue_failed' : 'queued',
    createdAtIso: request.createdAtIso,
    updatedAtIso: request.updatedAtIso,
    lastError: request.lastError,
    payload: request.payload,
  }
}

function requestsMatch(existing: RuntimeRequestRecord, threadId: string, mode: string, promptHash: string): boolean {
  return existing.threadId === threadId
    && existing.mode === mode
    && existing.promptHash === promptHash
}

export class RuntimeMessageQueue {
  private readonly processingThreadIds = new Set<string>()
  private readonly scheduledThreadIds = new Set<string>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(private readonly dependencies: RuntimeMessageQueueDependencies) {}

  start(): void {
    if (this.disposed || this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.scheduleAll(), QUEUE_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
    this.scheduleAll()
  }

  dispose(): void {
    this.disposed = true
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
    this.processingThreadIds.clear()
    this.scheduledThreadIds.clear()
  }

  enqueue(payload: unknown): RuntimeMessageQueueEntry {
    const parsed = parseRuntimeSendPayload(payload)
    if (!parsed.threadId) throw new Error('runtime/queue requires threadId')

    const clientMessageId = parsed.clientMessageId || `queue-${parsed.requestId}`
    const queueMetadata = asRecord(asRecord(payload)?.queueMetadata)
    const durablePayload = {
      ...createDurableRuntimeSendPayload({ ...parsed, clientMessageId }),
      ...(queueMetadata ? { queueMetadata } : {}),
    }
    const promptHash = createRuntimePromptHash(parsed.input)
    const existing = this.dependencies.store.getLatestRequestByClientMessageId(clientMessageId)
    if (existing) {
      if (!requestsMatch(existing, parsed.threadId, parsed.mode, promptHash)) {
        throw new Error('clientMessageId already belongs to different message content')
      }
      if (QUEUE_STATUSES.includes(existing.status)) this.scheduleThread(parsed.threadId)
      return toQueueEntry(existing)
    }

    const request = this.dependencies.store.createRequest({
      requestId: parsed.requestId,
      clientMessageId,
      threadId: parsed.threadId,
      status: 'queued',
      promptHash,
      mode: parsed.mode,
      payload: durablePayload,
    })
    this.publish(request.threadId, request.requestId, 'queued')
    this.scheduleThread(request.threadId)
    return toQueueEntry(request)
  }

  list(threadId = ''): RuntimeMessageQueueEntry[] {
    return this.dependencies.store.listQueuedRequests(threadId, 500).map(toQueueEntry)
  }

  cancel(requestId: string): boolean {
    const request = this.dependencies.store.getRequest(requestId)
    if (!request || !QUEUE_STATUSES.includes(request.status)) return false
    const updated = this.dependencies.store.updateRequest(requestId, {
      status: 'interrupted',
      lastError: 'Removed from message queue',
    })
    if (!updated) return false
    this.publish(request.threadId, requestId, 'removed')
    this.scheduleThread(request.threadId)
    return true
  }

  retry(requestId: string): boolean {
    const request = this.dependencies.store.getRequest(requestId)
    if (!request || request.status !== 'queue_failed') return false
    const updated = this.dependencies.store.updateRequest(requestId, {
      status: 'queued',
      lastError: null,
      incrementRetry: true,
    })
    if (!updated) return false
    this.publish(request.threadId, requestId, 'retried')
    this.scheduleThread(request.threadId)
    return true
  }

  reorder(threadId: string, requestIds: string[]): boolean {
    const normalizedThreadId = threadId.trim()
    if (!this.dependencies.store.reorderQueuedRequests(normalizedThreadId, requestIds)) return false
    this.publish(normalizedThreadId, '', 'reordered')
    this.scheduleThread(normalizedThreadId)
    return true
  }

  handleRuntimeEvent(method: string, threadId: string, params?: unknown): void {
    if (!threadId || method === 'runtime/queue/updated') return
    const threadStatusSettled = method === 'thread/status/changed'
      && isRuntimeThreadStatusTerminal(readRuntimeThreadStatusLifecycle(params))
    if (method === 'turn/completed' || method === 'turn/started' || method === 'error' || threadStatusSettled) {
      this.scheduleThread(threadId)
    }
  }

  private scheduleAll(): void {
    if (this.disposed) return
    for (const threadId of this.dependencies.store.listQueuedThreadIds()) {
      this.scheduleThread(threadId)
    }
  }

  private scheduleThread(threadId: string): void {
    const normalizedThreadId = threadId.trim()
    if (this.disposed || !normalizedThreadId || this.scheduledThreadIds.has(normalizedThreadId)) return
    this.scheduledThreadIds.add(normalizedThreadId)
    queueMicrotask(() => {
      this.scheduledThreadIds.delete(normalizedThreadId)
      void this.processThread(normalizedThreadId)
    })
  }

  private async processThread(threadId: string): Promise<void> {
    if (this.disposed || this.processingThreadIds.has(threadId)) return
    if (this.dependencies.store.getThreadLease(threadId)) return
    const next = this.dependencies.store.listQueuedRequests(threadId, 1)[0]
    if (!next || next.status === 'queue_failed') return

    this.processingThreadIds.add(threadId)
    try {
      await this.applyQueuedSpeedMode(next.payload)
      const pending = this.dependencies.store.getRequest(next.requestId)
      if (!pending || pending.status !== 'queued') return
      const claimed = this.dependencies.store.updateRequest(pending.requestId, {
        status: 'pending_start',
        lastError: null,
      })
      if (!claimed) return
      this.publish(threadId, next.requestId, 'starting')
      await this.dependencies.startRuntimeTurn(claimed.payload)
    } catch (error) {
      if (error instanceof RuntimeThreadBusyError) return
      const lastError = this.dependencies.getErrorMessage(error, 'Queued message failed to start')
      this.dependencies.store.updateRequest(next.requestId, {
        status: 'queue_failed',
        lastError,
      })
      this.publish(threadId, next.requestId, 'failed')
    } finally {
      this.processingThreadIds.delete(threadId)
    }
  }

  private async applyQueuedSpeedMode(payload: unknown): Promise<void> {
    const speedMode = asRecord(asRecord(payload)?.queueMetadata)?.speedMode === 'fast'
      ? 'fast'
      : 'standard'
    const configPayload = asRecord(await this.dependencies.rpc('config/read', {}))
    const config = asRecord(configPayload?.config)
    const features = asRecord(config?.features)
    const currentSpeedMode = config?.service_tier === 'fast' ? 'fast' : 'standard'
    const fastModeEnabled = features?.fast_mode === true
    const edits: Array<Record<string, unknown>> = []
    if (speedMode === 'fast' && !fastModeEnabled) {
      edits.push({
        keyPath: 'features.fast_mode',
        value: true,
        mergeStrategy: 'upsert',
      })
    }
    if (speedMode !== currentSpeedMode) {
      edits.push({
        keyPath: 'service_tier',
        value: speedMode === 'fast' ? 'fast' : null,
        mergeStrategy: speedMode === 'fast' ? 'upsert' : 'replace',
      })
    }
    if (edits.length === 0) return
    await this.dependencies.rpc('config/batchWrite', {
      edits,
      filePath: null,
      expectedVersion: null,
    })
  }

  private publish(threadId: string, requestId: string, action: string): void {
    this.dependencies.publishNotification({
      method: 'runtime/queue/updated',
      params: { threadId, requestId, action },
    })
  }
}
