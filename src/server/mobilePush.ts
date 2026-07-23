import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type { MobilePushOutboxRecord, RuntimeEventRecord, RuntimeSnapshotRecord } from './runtimeStore.js'

const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FCM_REQUEST_TIMEOUT_MS = 10_000
const FCM_ACCESS_TOKEN_SKEW_MS = 60_000
const MAX_DEVICE_TOKEN_LENGTH = 4096
const MAX_APP_INSTANCE_ID_LENGTH = 200
const MAX_THREAD_ID_LENGTH = 160
const MAX_SUBSCRIBED_THREADS = 100
const MOBILE_PUSH_DRAIN_BATCH_SIZE = 32
const MOBILE_PUSH_MAX_TIMER_DELAY_MS = 15 * 60_000
const MOBILE_PUSH_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000] as const
const MOBILE_PUSH_DEVICE_ACK_RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000] as const

export type MobilePushRegistrationInput = {
  token: string
  platform: 'android'
  appInstanceId: string
  threadIds: string[]
}

export type MobilePushAcknowledgementInput = {
  appInstanceId: string
  threadId: string
  eventSeq: number
}

type MobilePushRegistration = MobilePushRegistrationInput & {
  tokenHash: string
  lastDeliveryKey: string
  lastEventSeq: number
}

type MobilePushStore = {
  upsertMobilePushRegistration(record: MobilePushRegistrationInput): MobilePushRegistration
  deleteMobilePushRegistration(token: string): boolean
  deleteMobilePushRegistrationByHash(tokenHash: string): boolean
  listMobilePushRegistrationsForThread(threadId: string): MobilePushRegistration[]
  listEventsAfter(afterSeq: number, limit?: number): { notifications: RuntimeEventRecord[] }
  getSnapshot(threadId: string): RuntimeSnapshotRecord | null
  hasMobilePushDelivery(tokenHash: string, deliveryKey: string): boolean
  enqueueMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    eventSeq: number
    method: string
    threadId: string
    turnId: string
  }): boolean
  listDueMobilePushDeliveries(atIso?: string, limit?: number): MobilePushOutboxRecord[]
  rescheduleMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    nextAttemptAtIso: string
    error: string
  }): void
  markMobilePushProviderAccepted(record: {
    tokenHash: string
    deliveryKey: string
    nextAttemptAtIso: string
  }): void
  acknowledgeMobilePushDeliveries(record: MobilePushAcknowledgementInput): {
    accepted: boolean
    acknowledgedCount: number
  }
  getNextMobilePushDeliveryAtIso(): string | null
  markMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    eventSeq: number
    success: boolean
    error?: string | null
  }): void
  getMobilePushHealth(): {
    registrationCount: number
    subscribedRegistrationCount: number
    pendingDeliveryCount: number
    awaitingDeviceAckCount: number
    nextRetryAtIso: string | null
    lastSuccessAtIso: string | null
    lastFailureAtIso: string | null
    lastError: string | null
  }
}

type FirebaseServiceAccount = {
  client_email: string
  private_key: string
  project_id: string
  token_uri?: string
}

export type MobilePushConfiguration =
  | { state: 'not_configured' }
  | { state: 'invalid'; error: string }
  | { state: 'configured'; projectId: string; serviceAccount: FirebaseServiceAccount }

export type MobilePushStatus = {
  provider: 'fcm'
  configurationState: MobilePushConfiguration['state']
  registrationCount: number
  subscribedRegistrationCount: number
  pendingDeliveryCount: number
  awaitingDeviceAckCount: number
  nextRetryAtIso: string | null
  lastSuccessAtIso: string | null
  lastFailureAtIso: string | null
  lastError: string | null
}

type FetchLike = typeof fetch

type AccessTokenCache = {
  token: string
  expiresAtMs: number
}

class FcmSendError extends Error {
  readonly invalidRegistration: boolean

  constructor(message: string, invalidRegistration = false) {
    super(message)
    this.name = 'FcmSendError'
    this.invalidRegistration = invalidRegistration
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

export function resolveMobilePushConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): MobilePushConfiguration {
  const credentialsPath = environment.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? ''
  if (!credentialsPath) return { state: 'not_configured' }
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8')) as Partial<FirebaseServiceAccount>
    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
    const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.trim() : ''
    const projectId = (environment.CX_CODEX_FIREBASE_PROJECT_ID?.trim()
      || (typeof parsed.project_id === 'string' ? parsed.project_id.trim() : ''))
    if (!clientEmail || !privateKey || !projectId) {
      return { state: 'invalid', error: 'service_account_missing_required_fields' }
    }
    return {
      state: 'configured',
      projectId,
      serviceAccount: {
        client_email: clientEmail,
        private_key: privateKey,
        project_id: projectId,
        token_uri: typeof parsed.token_uri === 'string' ? parsed.token_uri.trim() : undefined,
      },
    }
  } catch {
    return { state: 'invalid', error: 'service_account_unreadable' }
  }
}

export function normalizeMobilePushRegistration(payload: unknown): MobilePushRegistrationInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid mobile push registration payload')
  }
  const record = payload as Record<string, unknown>
  const token = typeof record.token === 'string' ? record.token.trim() : ''
  const platform = record.platform === 'android' ? 'android' : ''
  const appInstanceId = typeof record.appInstanceId === 'string' ? record.appInstanceId.trim() : ''
  if (token.length < 20 || token.length > MAX_DEVICE_TOKEN_LENGTH) {
    throw new Error('Invalid mobile push token')
  }
  if (platform !== 'android') throw new Error('Unsupported mobile push platform')
  if (!appInstanceId || appInstanceId.length > MAX_APP_INSTANCE_ID_LENGTH) {
    throw new Error('Invalid mobile push app instance')
  }
  const rawThreadIds = Array.isArray(record.threadIds) ? record.threadIds : []
  const threadIds = [...new Set(rawThreadIds.flatMap((value) => {
    if (typeof value !== 'string') return []
    const normalized = value.trim()
    return normalized && normalized.length <= MAX_THREAD_ID_LENGTH ? [normalized] : []
  }))].slice(0, MAX_SUBSCRIBED_THREADS)
  return { token, platform, appInstanceId, threadIds }
}

export function normalizeMobilePushAcknowledgement(payload: unknown): MobilePushAcknowledgementInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid mobile push acknowledgement payload')
  }
  const record = payload as Record<string, unknown>
  const appInstanceId = typeof record.appInstanceId === 'string' ? record.appInstanceId.trim() : ''
  const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : ''
  const eventSeq = Number(record.eventSeq)
  if (!appInstanceId || appInstanceId.length > MAX_APP_INSTANCE_ID_LENGTH) {
    throw new Error('Invalid mobile push app instance')
  }
  if (!threadId || threadId.length > MAX_THREAD_ID_LENGTH) {
    throw new Error('Invalid mobile push thread')
  }
  if (!Number.isSafeInteger(eventSeq) || eventSeq <= 0) {
    throw new Error('Invalid mobile push event sequence')
  }
  return { appInstanceId, threadId, eventSeq }
}

export function isMobilePushTerminalEvent(method: string): boolean {
  return method === 'turn/completed'
    || method === 'thread/completed'
    || method === 'turn/interrupted'
    || method === 'thread/interrupted'
    || method === 'error'
}

function isMobilePushTerminalSnapshot(snapshot: RuntimeSnapshotRecord): boolean {
  return snapshot.executionState === 'completed_pending_sync'
    || snapshot.executionState === 'completed'
    || snapshot.executionState === 'failed'
    || snapshot.executionState === 'interrupted'
    || snapshot.executionState === 'stopped'
}

export function createMobilePushDeliveryKey(event: RuntimeEventRecord): string {
  const terminalIdentity = event.turnId || `${event.method}:${event.seq}`
  return `${event.threadId}:${terminalIdentity}`
}

export function createFcmTerminalMessage(event: RuntimeEventRecord, token: string): unknown {
  return {
    message: {
      token,
      data: {
        kind: 'task_terminal',
        threadId: event.threadId,
        turnId: event.turnId,
        eventSeq: String(event.seq),
        method: event.method,
      },
      android: {
        priority: 'high',
        ttl: '60s',
      },
    },
  }
}

export class MobilePushCoordinator {
  private readonly store: MobilePushStore
  private readonly fetcher: FetchLike
  private readonly configuration: MobilePushConfiguration
  private readonly now: () => number
  private readonly retryDelaysMs: readonly number[]
  private readonly deviceAckRetryDelaysMs: readonly number[]
  private readonly inFlightDeliveryKeys = new Set<string>()
  private accessTokenCache: AccessTokenCache | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private drainPromise: Promise<void> | null = null
  private started = false
  private disposed = false

  constructor(options: {
    store: MobilePushStore
    fetcher?: FetchLike
    configuration?: MobilePushConfiguration
    now?: () => number
    retryDelaysMs?: readonly number[]
    deviceAckRetryDelaysMs?: readonly number[]
  }) {
    this.store = options.store
    this.fetcher = options.fetcher ?? fetch
    this.configuration = options.configuration ?? resolveMobilePushConfiguration()
    this.now = options.now ?? Date.now
    this.retryDelaysMs = options.retryDelaysMs?.length
      ? options.retryDelaysMs.map((delay) => Math.max(0, Math.trunc(delay)))
      : MOBILE_PUSH_RETRY_DELAYS_MS
    this.deviceAckRetryDelaysMs = options.deviceAckRetryDelaysMs?.length
      ? options.deviceAckRetryDelaysMs.map((delay) => Math.max(0, Math.trunc(delay)))
      : MOBILE_PUSH_DEVICE_ACK_RETRY_DELAYS_MS
  }

  register(payload: unknown): MobilePushStatus {
    const registration = this.store.upsertMobilePushRegistration(normalizeMobilePushRegistration(payload))
    if (this.configuration.state === 'configured') {
      for (const threadId of registration.threadIds) {
        const snapshot = this.store.getSnapshot(threadId)
        if (!snapshot || !isMobilePushTerminalSnapshot(snapshot) || snapshot.lastEventSeq <= 0) continue
        const event = this.store.listEventsAfter(snapshot.lastEventSeq - 1, 1).notifications[0]
        if (
          !event
          || event.seq !== snapshot.lastEventSeq
          || event.threadId !== threadId
          || !isMobilePushTerminalEvent(event.method)
        ) continue
        this.enqueueTerminalDelivery(registration, event)
      }
    }
    if (this.started) this.scheduleDrain(0)
    return this.getStatus()
  }

  unregister(payload: unknown): MobilePushStatus {
    const token = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? String((payload as Record<string, unknown>).token ?? '').trim()
      : ''
    if (!token || token.length > MAX_DEVICE_TOKEN_LENGTH) throw new Error('Invalid mobile push token')
    this.store.deleteMobilePushRegistration(token)
    return this.getStatus()
  }

  acknowledge(payload: unknown): MobilePushStatus & { accepted: boolean; acknowledgedCount: number } {
    const acknowledgement = normalizeMobilePushAcknowledgement(payload)
    const result = this.store.acknowledgeMobilePushDeliveries(acknowledgement)
    if (this.started) this.scheduleNextDrain()
    return { ...this.getStatus(), ...result }
  }

  getStatus(): MobilePushStatus {
    const health = this.store.getMobilePushHealth()
    return {
      provider: 'fcm',
      configurationState: this.configuration.state,
      ...health,
      lastError: this.configuration.state === 'invalid'
        ? this.configuration.error
        : health.lastError,
    }
  }

  start(): void {
    if (this.started || this.disposed || this.configuration.state !== 'configured') return
    this.started = true
    this.scheduleDrain(0)
  }

  dispose(): void {
    this.disposed = true
    this.started = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  async handleRuntimeEvent(event: RuntimeEventRecord): Promise<void> {
    if (this.configuration.state !== 'configured') return
    if (!event.threadId || !isMobilePushTerminalEvent(event.method)) return
    this.start()
    const registrations = this.store.listMobilePushRegistrationsForThread(event.threadId)
    for (const registration of registrations) {
      this.enqueueTerminalDelivery(registration, event)
    }
    await this.retryPendingDeliveries()
  }

  private enqueueTerminalDelivery(registration: MobilePushRegistration, event: RuntimeEventRecord): boolean {
    const deliveryKey = createMobilePushDeliveryKey(event)
    if (
      registration.lastDeliveryKey === deliveryKey
      || this.store.hasMobilePushDelivery(registration.tokenHash, deliveryKey)
    ) return false
    return this.store.enqueueMobilePushDelivery({
      tokenHash: registration.tokenHash,
      deliveryKey,
      eventSeq: event.seq,
      method: event.method,
      threadId: event.threadId,
      turnId: event.turnId,
    })
  }

  async retryPendingDeliveries(): Promise<void> {
    if (this.disposed || this.configuration.state !== 'configured') return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.drainPromise) return this.drainPromise
    const drainPromise = this.drainDueDeliveries()
    this.drainPromise = drainPromise
    try {
      await drainPromise
    } finally {
      if (this.drainPromise === drainPromise) this.drainPromise = null
      this.scheduleNextDrain()
    }
  }

  private async drainDueDeliveries(): Promise<void> {
    while (!this.disposed) {
      const due = this.store.listDueMobilePushDeliveries(
        new Date(this.now()).toISOString(),
        MOBILE_PUSH_DRAIN_BATCH_SIZE,
      )
      if (due.length === 0) return
      const results = await Promise.allSettled(due.map((delivery) => this.deliverPending(delivery)))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
  }

  private async deliverPending(delivery: MobilePushOutboxRecord): Promise<void> {
    const inFlightKey = `${delivery.tokenHash}:${delivery.deliveryKey}`
    if (this.inFlightDeliveryKeys.has(inFlightKey)) return
    this.inFlightDeliveryKeys.add(inFlightKey)
    try {
      await this.sendTerminalEvent({
        seq: delivery.eventSeq,
        method: delivery.method,
        params: {},
        atIso: delivery.createdAtIso,
        threadId: delivery.threadId,
        turnId: delivery.turnId,
      }, delivery.token)
      const delayIndex = Math.min(delivery.attemptCount, this.deviceAckRetryDelaysMs.length - 1)
      const retryDelayMs = this.deviceAckRetryDelaysMs[Math.max(0, delayIndex)]
        ?? MOBILE_PUSH_MAX_TIMER_DELAY_MS
      this.store.markMobilePushProviderAccepted({
        tokenHash: delivery.tokenHash,
        deliveryKey: delivery.deliveryKey,
        nextAttemptAtIso: new Date(this.now() + retryDelayMs).toISOString(),
      })
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error('delivery_failed')
      if (resolvedError instanceof FcmSendError && resolvedError.invalidRegistration) {
        this.store.deleteMobilePushRegistrationByHash(delivery.tokenHash)
        return
      }
      const delayIndex = Math.min(delivery.attemptCount, this.retryDelaysMs.length - 1)
      const retryDelayMs = this.retryDelaysMs[Math.max(0, delayIndex)] ?? MOBILE_PUSH_MAX_TIMER_DELAY_MS
      this.store.rescheduleMobilePushDelivery({
        tokenHash: delivery.tokenHash,
        deliveryKey: delivery.deliveryKey,
        nextAttemptAtIso: new Date(this.now() + retryDelayMs).toISOString(),
        error: resolvedError.message,
      })
    } finally {
      this.inFlightDeliveryKeys.delete(inFlightKey)
    }
  }

  private scheduleNextDrain(): void {
    const nextAttemptAtIso = this.store.getNextMobilePushDeliveryAtIso()
    if (!nextAttemptAtIso) return
    const nextAttemptAtMs = Date.parse(nextAttemptAtIso)
    const delayMs = Number.isFinite(nextAttemptAtMs)
      ? Math.max(0, nextAttemptAtMs - this.now())
      : 0
    this.scheduleDrain(Math.min(delayMs, MOBILE_PUSH_MAX_TIMER_DELAY_MS))
  }

  private scheduleDrain(delayMs: number): void {
    if (this.disposed || this.configuration.state !== 'configured') return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.retryPendingDeliveries().catch(() => {
        this.scheduleDrain(MOBILE_PUSH_MAX_TIMER_DELAY_MS)
      })
    }, Math.max(0, Math.trunc(delayMs)))
    this.retryTimer.unref?.()
  }

  private async sendTerminalEvent(event: RuntimeEventRecord, token: string): Promise<void> {
    if (this.configuration.state !== 'configured') return
    const accessToken = await this.getAccessToken(this.configuration.serviceAccount)
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.configuration.projectId)}/messages:send`
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(createFcmTerminalMessage(event, token)),
      signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
    })
    if (response.ok) return
    const responseText = (await response.text()).slice(0, 4_000)
    const invalidRegistration = responseText.includes('UNREGISTERED')
      || responseText.includes('registration-token-not-registered')
    throw new FcmSendError(`fcm_http_${response.status}`, invalidRegistration)
  }

  private async getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
    const now = this.now()
    if (this.accessTokenCache && this.accessTokenCache.expiresAtMs - FCM_ACCESS_TOKEN_SKEW_MS > now) {
      return this.accessTokenCache.token
    }
    const issuedAtSeconds = Math.floor(now / 1000)
    const tokenUrl = serviceAccount.token_uri || GOOGLE_OAUTH_TOKEN_URL
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64Url(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FIREBASE_MESSAGING_SCOPE,
      aud: tokenUrl,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
    }))
    const unsignedJwt = `${header}.${claims}`
    const signer = createSign('RSA-SHA256')
    signer.update(unsignedJwt)
    signer.end()
    const assertion = `${unsignedJwt}.${signer.sign(serviceAccount.private_key).toString('base64url')}`
    const response = await this.fetcher(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new FcmSendError(`fcm_auth_http_${response.status}`)
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown }
    const token = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
    const expiresInSeconds = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(60, Math.trunc(payload.expires_in))
      : 3600
    if (!token) throw new FcmSendError('fcm_auth_missing_access_token')
    this.accessTokenCache = {
      token,
      expiresAtMs: now + expiresInSeconds * 1000,
    }
    return token
  }
}
