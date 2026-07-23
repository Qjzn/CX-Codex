import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type RuntimeRequestStatus =
  | 'pending_start'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'start_uncertain'
  | 'stopping'
  | 'stop_uncertain'
  | 'stopped'
  | 'interrupted'
  | 'still_running'
  | 'sync_degraded'

export type RuntimeRequestRecord = {
  requestId: string
  clientMessageId: string
  threadId: string
  turnId: string
  status: RuntimeRequestStatus
  promptHash: string
  mode: string
  payload: unknown
  retryCount: number
  createdAtIso: string
  updatedAtIso: string
  lastError: string | null
}

export type RuntimeEventRecord = {
  seq: number
  method: string
  params: unknown
  atIso: string
  threadId: string
  turnId: string
}

export type RuntimeSnapshotRecord = {
  threadId: string
  executionState: string
  activeTurnId: string
  activeItemId: string
  canStop: boolean
  stopRequested: boolean
  lastEventSeq: number
  updatedAtIso: string
  snapshot: unknown
}

export type MobilePushRegistrationRecord = {
  tokenHash: string
  token: string
  platform: 'android'
  appInstanceId: string
  threadIds: string[]
  updatedAtIso: string
  lastDeliveryKey: string
  lastEventSeq: number
  lastSuccessAtIso: string | null
  lastFailureAtIso: string | null
  lastError: string | null
}

export type MobilePushOutboxRecord = {
  tokenHash: string
  token: string
  deliveryKey: string
  eventSeq: number
  method: string
  threadId: string
  turnId: string
  attemptCount: number
  nextAttemptAtIso: string
  createdAtIso: string
  updatedAtIso: string
  lastError: string | null
}

type RuntimeRequestRow = {
  request_id: string
  client_message_id: string
  thread_id: string
  turn_id: string
  status: RuntimeRequestStatus
  prompt_hash: string
  mode: string
  payload_json: string
  retry_count: number
  created_at_iso: string
  updated_at_iso: string
  last_error: string | null
}

type RuntimeEventRow = {
  seq: number
  method: string
  params_json: string
  at_iso: string
  thread_id: string
  turn_id: string
}

type RuntimeSnapshotRow = {
  thread_id: string
  execution_state: string
  active_turn_id: string
  active_item_id: string
  can_stop: number
  stop_requested: number
  last_event_seq: number
  updated_at_iso: string
  snapshot_json: string
}

type MobilePushRegistrationRow = {
  token_hash: string
  token: string
  platform: 'android'
  app_instance_id: string
  thread_ids_json: string
  updated_at_iso: string
  last_delivery_key: string
  last_event_seq: number
  last_success_at_iso: string | null
  last_failure_at_iso: string | null
  last_error: string | null
}

type MobilePushOutboxRow = {
  token_hash: string
  token: string
  delivery_key: string
  event_seq: number
  method: string
  thread_id: string
  turn_id: string
  attempt_count: number
  next_attempt_at_iso: string
  created_at_iso: string
  updated_at_iso: string
  last_error: string | null
}

const SENSITIVE_KEY_PATTERN = /^(?:authorization|authHeader|accessToken|refreshToken|idToken|token|password|secret|cookie|set-cookie|apiKey|apikey)$/iu
const RUNTIME_DB_BUSY_TIMEOUT_MS = 5000
const RUNTIME_EVENT_RETENTION_LIMIT = 5000
const RUNTIME_EVENT_PRUNE_INTERVAL = 100
const RUNTIME_DB_INCREMENTAL_VACUUM_PAGES = 256
const RUNTIME_DB_AUTO_VACUUM_INCREMENTAL = 2
const MOBILE_PUSH_DELIVERY_RETENTION_LIMIT = 128
const MOBILE_PUSH_ACKNOWLEDGEMENT_RETENTION_LIMIT = 256
const APP_LIST_UPDATED_METHOD = 'app/list/updated'

export type RuntimeDatabaseStorageStats = {
  databaseBytes: number
  freeBytes: number
  freePageRatio: number
  pageCount: number
  freePageCount: number
  pageSizeBytes: number
  autoVacuumMode: number
}

export type RuntimeStoreCompactionResult = {
  status: 'compacted' | 'skipped-active-requests'
  activeRequestCount: number
  before: RuntimeDatabaseStorageStats
  after: RuntimeDatabaseStorageStats
  reclaimedBytes: number
  durationMs: number
}

function defaultRuntimeDatabasePath(): string {
  return join(homedir(), '.cx-codex', 'runtime.sqlite')
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeParseJson(value: string): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function redactString(value: string): string {
  if (!value) return value
  return value
    .replace(/(authorization|access_token|refresh_token|token|password|secret|api[_-]?key)=([^&\s]+)/giu, '$1=[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[redacted]')
}

function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[redacted-depth]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1))

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      next[key] = '[redacted]'
      continue
    }
    next[key] = redactSensitiveValue(child, depth + 1)
  }
  return next
}

function toJson(value: unknown): string {
  return JSON.stringify(redactSensitiveValue(value))
}

function fromRequestRow(row: RuntimeRequestRow): RuntimeRequestRecord {
  return {
    requestId: row.request_id,
    clientMessageId: row.client_message_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    status: row.status,
    promptHash: row.prompt_hash,
    mode: row.mode,
    payload: safeParseJson(row.payload_json),
    retryCount: row.retry_count,
    createdAtIso: row.created_at_iso,
    updatedAtIso: row.updated_at_iso,
    lastError: row.last_error,
  }
}

function fromEventRow(row: RuntimeEventRow): RuntimeEventRecord {
  return {
    seq: row.seq,
    method: row.method,
    params: safeParseJson(row.params_json),
    atIso: row.at_iso,
    threadId: row.thread_id,
    turnId: row.turn_id,
  }
}

function fromSnapshotRow(row: RuntimeSnapshotRow): RuntimeSnapshotRecord {
  return {
    threadId: row.thread_id,
    executionState: row.execution_state,
    activeTurnId: row.active_turn_id,
    activeItemId: row.active_item_id,
    canStop: row.can_stop === 1,
    stopRequested: row.stop_requested === 1,
    lastEventSeq: row.last_event_seq,
    updatedAtIso: row.updated_at_iso,
    snapshot: safeParseJson(row.snapshot_json),
  }
}

function fromMobilePushRegistrationRow(row: MobilePushRegistrationRow): MobilePushRegistrationRecord {
  const parsedThreadIds = safeParseJson(row.thread_ids_json)
  return {
    tokenHash: row.token_hash,
    token: row.token,
    platform: row.platform,
    appInstanceId: row.app_instance_id,
    threadIds: Array.isArray(parsedThreadIds)
      ? parsedThreadIds.filter((value): value is string => typeof value === 'string')
      : [],
    updatedAtIso: row.updated_at_iso,
    lastDeliveryKey: row.last_delivery_key,
    lastEventSeq: row.last_event_seq,
    lastSuccessAtIso: row.last_success_at_iso,
    lastFailureAtIso: row.last_failure_at_iso,
    lastError: row.last_error,
  }
}

function fromMobilePushOutboxRow(row: MobilePushOutboxRow): MobilePushOutboxRecord {
  return {
    tokenHash: row.token_hash,
    token: row.token,
    deliveryKey: row.delivery_key,
    eventSeq: row.event_seq,
    method: row.method,
    threadId: row.thread_id,
    turnId: row.turn_id,
    attemptCount: row.attempt_count,
    nextAttemptAtIso: row.next_attempt_at_iso,
    createdAtIso: row.created_at_iso,
    updatedAtIso: row.updated_at_iso,
    lastError: row.last_error,
  }
}

export class RuntimeStore {
  private readonly db: Database.Database
  private appendEventCount = 0

  constructor(dbPath = defaultRuntimeDatabasePath()) {
    mkdirSync(dirname(dbPath), { recursive: true })
    const isNewDatabase = !existsSync(dbPath)
    this.db = new Database(dbPath)
    if (isNewDatabase) {
      this.db.pragma('auto_vacuum = INCREMENTAL')
    }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma(`busy_timeout = ${RUNTIME_DB_BUSY_TIMEOUT_MS}`)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_requests (
        request_id TEXT PRIMARY KEY,
        client_message_id TEXT NOT NULL DEFAULT '',
        thread_id TEXT NOT NULL DEFAULT '',
        turn_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        prompt_hash TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_iso TEXT NOT NULL,
        updated_at_iso TEXT NOT NULL,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_requests_thread_status
        ON runtime_requests(thread_id, status, updated_at_iso);
      CREATE INDEX IF NOT EXISTS idx_runtime_requests_client_message
        ON runtime_requests(client_message_id, updated_at_iso);

      CREATE TABLE IF NOT EXISTS runtime_events (
        seq INTEGER PRIMARY KEY,
        method TEXT NOT NULL,
        params_json TEXT NOT NULL DEFAULT '{}',
        at_iso TEXT NOT NULL,
        thread_id TEXT NOT NULL DEFAULT '',
        turn_id TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_events_thread_seq
        ON runtime_events(thread_id, seq);

      CREATE TABLE IF NOT EXISTS thread_runtime_snapshots (
        thread_id TEXT PRIMARY KEY,
        execution_state TEXT NOT NULL,
        active_turn_id TEXT NOT NULL DEFAULT '',
        active_item_id TEXT NOT NULL DEFAULT '',
        can_stop INTEGER NOT NULL DEFAULT 0,
        stop_requested INTEGER NOT NULL DEFAULT 0,
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        updated_at_iso TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS mobile_push_registrations (
        token_hash TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        platform TEXT NOT NULL,
        app_instance_id TEXT NOT NULL DEFAULT '',
        thread_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at_iso TEXT NOT NULL,
        last_delivery_key TEXT NOT NULL DEFAULT '',
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        last_success_at_iso TEXT,
        last_failure_at_iso TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_push_registrations_updated
        ON mobile_push_registrations(updated_at_iso);

      CREATE TABLE IF NOT EXISTS mobile_push_deliveries (
        token_hash TEXT NOT NULL,
        delivery_key TEXT NOT NULL,
        event_seq INTEGER NOT NULL DEFAULT 0,
        delivered_at_iso TEXT NOT NULL,
        PRIMARY KEY (token_hash, delivery_key)
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_push_deliveries_token_time
        ON mobile_push_deliveries(token_hash, delivered_at_iso DESC);

      CREATE TABLE IF NOT EXISTS mobile_push_device_acknowledgements (
        app_instance_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL DEFAULT 0,
        acknowledged_at_iso TEXT NOT NULL,
        PRIMARY KEY (app_instance_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_push_device_ack_time
        ON mobile_push_device_acknowledgements(app_instance_id, acknowledged_at_iso DESC);

      CREATE TABLE IF NOT EXISTS mobile_push_outbox (
        token_hash TEXT NOT NULL,
        delivery_key TEXT NOT NULL,
        event_seq INTEGER NOT NULL DEFAULT 0,
        method TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_iso TEXT NOT NULL,
        created_at_iso TEXT NOT NULL,
        updated_at_iso TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (token_hash, delivery_key)
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_push_outbox_due
        ON mobile_push_outbox(next_attempt_at_iso, created_at_iso);

      INSERT OR IGNORE INTO mobile_push_deliveries (
        token_hash, delivery_key, event_seq, delivered_at_iso
      )
      SELECT
        token_hash,
        last_delivery_key,
        last_event_seq,
        COALESCE(last_success_at_iso, updated_at_iso)
      FROM mobile_push_registrations
      WHERE last_delivery_key <> '';
    `)
    this.runLightweightStartupMaintenance()
  }

  getLatestEventSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM runtime_events').get() as { seq?: number } | undefined
    return typeof row?.seq === 'number' && Number.isFinite(row.seq) ? Math.max(0, Math.trunc(row.seq)) : 0
  }

  getOldestEventSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MIN(seq), 0) AS seq FROM runtime_events').get() as { seq?: number } | undefined
    return typeof row?.seq === 'number' && Number.isFinite(row.seq) ? Math.max(0, Math.trunc(row.seq)) : 0
  }

  createRequest(record: {
    requestId: string
    clientMessageId?: string
    threadId?: string
    turnId?: string
    status: RuntimeRequestStatus
    promptHash?: string
    mode?: string
    payload?: unknown
    lastError?: string | null
  }): RuntimeRequestRecord {
    const timestamp = nowIso()
    this.db.prepare(`
      INSERT INTO runtime_requests (
        request_id, client_message_id, thread_id, turn_id, status, prompt_hash, mode,
        payload_json, retry_count, created_at_iso, updated_at_iso, last_error
      ) VALUES (
        @requestId, @clientMessageId, @threadId, @turnId, @status, @promptHash, @mode,
        @payloadJson, 0, @createdAtIso, @updatedAtIso, @lastError
      )
      ON CONFLICT(request_id) DO UPDATE SET
        client_message_id=excluded.client_message_id,
        thread_id=excluded.thread_id,
        turn_id=excluded.turn_id,
        status=excluded.status,
        prompt_hash=excluded.prompt_hash,
        mode=excluded.mode,
        payload_json=excluded.payload_json,
        updated_at_iso=excluded.updated_at_iso,
        last_error=excluded.last_error
    `).run({
      requestId: record.requestId,
      clientMessageId: record.clientMessageId ?? '',
      threadId: record.threadId ?? '',
      turnId: record.turnId ?? '',
      status: record.status,
      promptHash: record.promptHash ?? '',
      mode: record.mode ?? '',
      payloadJson: toJson(record.payload ?? {}),
      createdAtIso: timestamp,
      updatedAtIso: timestamp,
      lastError: record.lastError ?? null,
    })
    return this.getRequest(record.requestId) as RuntimeRequestRecord
  }

  updateRequest(requestId: string, patch: {
    threadId?: string
    turnId?: string
    status?: RuntimeRequestStatus
    lastError?: string | null
    payload?: unknown
    incrementRetry?: boolean
  }): RuntimeRequestRecord | null {
    const existing = this.getRequest(requestId)
    if (!existing) return null
    const nextPayload = typeof patch.payload === 'undefined' ? existing.payload : patch.payload
    this.db.prepare(`
      UPDATE runtime_requests SET
        thread_id=@threadId,
        turn_id=@turnId,
        status=@status,
        payload_json=@payloadJson,
        retry_count=@retryCount,
        updated_at_iso=@updatedAtIso,
        last_error=@lastError
      WHERE request_id=@requestId
    `).run({
      requestId,
      threadId: patch.threadId ?? existing.threadId,
      turnId: patch.turnId ?? existing.turnId,
      status: patch.status ?? existing.status,
      payloadJson: toJson(nextPayload),
      retryCount: existing.retryCount + (patch.incrementRetry === true ? 1 : 0),
      updatedAtIso: nowIso(),
      lastError: typeof patch.lastError === 'undefined' ? existing.lastError : patch.lastError,
    })
    return this.getRequest(requestId)
  }

  getRequest(requestId: string): RuntimeRequestRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_requests WHERE request_id = ?').get(requestId) as RuntimeRequestRow | undefined
    return row ? fromRequestRow(row) : null
  }

  getLatestRequestByClientMessageId(clientMessageId: string): RuntimeRequestRecord | null {
    const normalizedClientMessageId = clientMessageId.trim()
    if (!normalizedClientMessageId) return null
    const row = this.db.prepare(`
      SELECT * FROM runtime_requests
      WHERE client_message_id = ?
      ORDER BY updated_at_iso DESC
      LIMIT 1
    `).get(normalizedClientMessageId) as RuntimeRequestRow | undefined
    return row ? fromRequestRow(row) : null
  }

  listRequestsByThread(threadId: string, statuses: RuntimeRequestStatus[], limit = 20): RuntimeRequestRecord[] {
    if (!threadId || statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT * FROM runtime_requests
      WHERE thread_id = ? AND status IN (${placeholders})
      ORDER BY updated_at_iso DESC
      LIMIT ?
    `).all(threadId, ...statuses, Math.max(1, Math.min(100, Math.trunc(limit)))) as RuntimeRequestRow[]
    return rows.map(fromRequestRow)
  }

  listUncertainRequests(limit = 50): RuntimeRequestRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM runtime_requests
      WHERE status IN ('pending_start', 'starting', 'start_uncertain', 'running', 'stopping', 'stop_uncertain', 'still_running', 'sync_degraded')
      ORDER BY updated_at_iso ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(200, Math.trunc(limit)))) as RuntimeRequestRow[]
    return rows.map(fromRequestRow)
  }

  appendEvent(event: RuntimeEventRecord): RuntimeEventRecord {
    this.db.prepare(`
      INSERT OR REPLACE INTO runtime_events (seq, method, params_json, at_iso, thread_id, turn_id)
      VALUES (@seq, @method, @paramsJson, @atIso, @threadId, @turnId)
    `).run({
      seq: event.seq,
      method: event.method,
      paramsJson: toJson(event.params ?? {}),
      atIso: event.atIso,
      threadId: event.threadId,
      turnId: event.turnId,
    })
    this.appendEventCount += 1
    if (this.appendEventCount % RUNTIME_EVENT_PRUNE_INTERVAL === 0) {
      this.db.prepare('DELETE FROM runtime_events WHERE seq <= ?').run(Math.max(0, event.seq - RUNTIME_EVENT_RETENTION_LIMIT))
      this.runIncrementalVacuum()
    }
    return event
  }

  getStorageStats(): RuntimeDatabaseStorageStats {
    const pageCount = this.readPragmaNumber('page_count')
    const freePageCount = this.readPragmaNumber('freelist_count')
    const pageSizeBytes = this.readPragmaNumber('page_size')
    const databaseBytes = pageCount * pageSizeBytes
    const freeBytes = freePageCount * pageSizeBytes
    return {
      databaseBytes,
      freeBytes,
      freePageRatio: pageCount > 0 ? freePageCount / pageCount : 0,
      pageCount,
      freePageCount,
      pageSizeBytes,
      autoVacuumMode: this.readPragmaNumber('auto_vacuum'),
    }
  }

  compact(): RuntimeStoreCompactionResult {
    const startedAt = Date.now()
    const activeRequestCount = this.countActiveRequests()
    const before = this.getStorageStats()
    if (activeRequestCount > 0) {
      return {
        status: 'skipped-active-requests',
        activeRequestCount,
        before,
        after: before,
        reclaimedBytes: 0,
        durationMs: Date.now() - startedAt,
      }
    }

    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.pragma('auto_vacuum = INCREMENTAL')
    this.db.exec('VACUUM')
    const after = this.getStorageStats()
    return {
      status: 'compacted',
      activeRequestCount,
      before,
      after,
      reclaimedBytes: Math.max(0, before.databaseBytes - after.databaseBytes),
      durationMs: Date.now() - startedAt,
    }
  }

  listEventsAfter(afterSeq: number, limit = 200): {
    notifications: RuntimeEventRecord[]
    latestSeq: number
    oldestSeq: number
  } {
    const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.trunc(afterSeq)) : 0
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 1000)) : 200
    const rows = this.db.prepare(`
      SELECT * FROM runtime_events
      WHERE seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(normalizedAfterSeq, normalizedLimit) as RuntimeEventRow[]
    return {
      notifications: rows.map(fromEventRow),
      latestSeq: this.getLatestEventSeq(),
      oldestSeq: this.getOldestEventSeq(),
    }
  }

  upsertSnapshot(snapshot: RuntimeSnapshotRecord): RuntimeSnapshotRecord {
    this.db.prepare(`
      INSERT INTO thread_runtime_snapshots (
        thread_id, execution_state, active_turn_id, active_item_id, can_stop, stop_requested,
        last_event_seq, updated_at_iso, snapshot_json
      ) VALUES (
        @threadId, @executionState, @activeTurnId, @activeItemId, @canStop, @stopRequested,
        @lastEventSeq, @updatedAtIso, @snapshotJson
      )
      ON CONFLICT(thread_id) DO UPDATE SET
        execution_state=excluded.execution_state,
        active_turn_id=excluded.active_turn_id,
        active_item_id=excluded.active_item_id,
        can_stop=excluded.can_stop,
        stop_requested=excluded.stop_requested,
        last_event_seq=excluded.last_event_seq,
        updated_at_iso=excluded.updated_at_iso,
        snapshot_json=excluded.snapshot_json
    `).run({
      threadId: snapshot.threadId,
      executionState: snapshot.executionState,
      activeTurnId: snapshot.activeTurnId,
      activeItemId: snapshot.activeItemId,
      canStop: snapshot.canStop ? 1 : 0,
      stopRequested: snapshot.stopRequested ? 1 : 0,
      lastEventSeq: snapshot.lastEventSeq,
      updatedAtIso: snapshot.updatedAtIso,
      snapshotJson: toJson(snapshot.snapshot ?? {}),
    })
    return this.getSnapshot(snapshot.threadId) as RuntimeSnapshotRecord
  }

  getSnapshot(threadId: string): RuntimeSnapshotRecord | null {
    const row = this.db.prepare('SELECT * FROM thread_runtime_snapshots WHERE thread_id = ?').get(threadId) as RuntimeSnapshotRow | undefined
    return row ? fromSnapshotRow(row) : null
  }

  upsertMobilePushRegistration(record: {
    token: string
    platform: 'android'
    appInstanceId: string
    threadIds: string[]
  }): MobilePushRegistrationRecord {
    const tokenHash = createHash('sha256').update(record.token).digest('hex')
    const updatedAtIso = nowIso()
    const values = {
      tokenHash,
      token: record.token,
      platform: record.platform,
      appInstanceId: record.appInstanceId,
      threadIdsJson: JSON.stringify(record.threadIds),
      updatedAtIso,
    }
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM mobile_push_outbox
        WHERE token_hash IN (
          SELECT token_hash FROM mobile_push_registrations
          WHERE platform = @platform
            AND app_instance_id = @appInstanceId
            AND token_hash <> @tokenHash
        )
      `).run(values)
      this.db.prepare(`
        DELETE FROM mobile_push_deliveries
        WHERE token_hash IN (
          SELECT token_hash FROM mobile_push_registrations
          WHERE platform = @platform
            AND app_instance_id = @appInstanceId
            AND token_hash <> @tokenHash
        )
      `).run(values)
      this.db.prepare(`
        DELETE FROM mobile_push_registrations
        WHERE platform = @platform
          AND app_instance_id = @appInstanceId
          AND token_hash <> @tokenHash
      `).run(values)
      this.db.prepare(`
        INSERT INTO mobile_push_registrations (
          token_hash, token, platform, app_instance_id, thread_ids_json, updated_at_iso
        ) VALUES (
          @tokenHash, @token, @platform, @appInstanceId, @threadIdsJson, @updatedAtIso
        )
        ON CONFLICT(token_hash) DO UPDATE SET
          token=excluded.token,
          platform=excluded.platform,
          app_instance_id=excluded.app_instance_id,
          thread_ids_json=excluded.thread_ids_json,
          updated_at_iso=excluded.updated_at_iso
      `).run(values)
    })()
    return this.getMobilePushRegistration(tokenHash) as MobilePushRegistrationRecord
  }

  deleteMobilePushRegistration(token: string): boolean {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    return this.deleteMobilePushRegistrationByHash(tokenHash)
  }

  deleteMobilePushRegistrationByHash(tokenHash: string): boolean {
    const registration = this.db.prepare(
      'SELECT app_instance_id FROM mobile_push_registrations WHERE token_hash = ?',
    ).get(tokenHash) as { app_instance_id?: string } | undefined
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM mobile_push_outbox WHERE token_hash = ?').run(tokenHash)
      this.db.prepare('DELETE FROM mobile_push_deliveries WHERE token_hash = ?').run(tokenHash)
      const deleted = this.db.prepare('DELETE FROM mobile_push_registrations WHERE token_hash = ?').run(tokenHash).changes > 0
      const appInstanceId = registration?.app_instance_id?.trim() ?? ''
      if (deleted && appInstanceId) {
        this.db.prepare(`
          DELETE FROM mobile_push_device_acknowledgements
          WHERE app_instance_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM mobile_push_registrations
              WHERE app_instance_id = ?
            )
        `).run(appInstanceId, appInstanceId)
      }
      return deleted
    })()
  }

  listMobilePushRegistrationsForThread(threadId: string): MobilePushRegistrationRecord[] {
    if (!threadId) return []
    const rows = this.db.prepare(`
      SELECT registrations.*
      FROM mobile_push_registrations AS registrations
      WHERE EXISTS (
        SELECT 1
        FROM json_each(registrations.thread_ids_json) AS subscription
        WHERE subscription.value = ?
      )
      ORDER BY updated_at_iso DESC
      LIMIT 32
    `).all(threadId) as MobilePushRegistrationRow[]
    return rows.map(fromMobilePushRegistrationRow)
  }

  hasMobilePushDelivery(tokenHash: string, deliveryKey: string): boolean {
    const normalizedTokenHash = tokenHash.trim()
    const normalizedDeliveryKey = deliveryKey.trim()
    if (!normalizedTokenHash || !normalizedDeliveryKey) return false
    const row = this.db.prepare(`
      SELECT 1 AS found
      FROM mobile_push_deliveries
      WHERE token_hash = ? AND delivery_key = ?
      LIMIT 1
    `).get(normalizedTokenHash, normalizedDeliveryKey) as { found?: number } | undefined
    return row?.found === 1
  }

  markMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    eventSeq: number
    success: boolean
    error?: string | null
  }): void {
    const timestamp = nowIso()
    const values = {
      tokenHash: record.tokenHash,
      deliveryKey: record.deliveryKey,
      eventSeq: Math.max(0, Math.trunc(record.eventSeq)),
      success: record.success ? 1 : 0,
      timestamp,
      lastError: record.success ? null : (record.error ?? 'delivery_failed').slice(0, 240),
    }
    this.db.transaction(() => {
      const update = this.db.prepare(`
        UPDATE mobile_push_registrations SET
          last_delivery_key=CASE WHEN @success = 1 THEN @deliveryKey ELSE last_delivery_key END,
          last_event_seq=CASE WHEN @success = 1 THEN @eventSeq ELSE last_event_seq END,
          last_success_at_iso=CASE WHEN @success = 1 THEN @timestamp ELSE last_success_at_iso END,
          last_failure_at_iso=CASE WHEN @success = 0 THEN @timestamp ELSE last_failure_at_iso END,
          last_error=@lastError
        WHERE token_hash=@tokenHash
      `).run(values)
      if (!record.success || update.changes === 0) return
      this.db.prepare(`
        DELETE FROM mobile_push_outbox
        WHERE token_hash = @tokenHash AND delivery_key = @deliveryKey
      `).run(values)
      this.db.prepare(`
        INSERT OR IGNORE INTO mobile_push_deliveries (
          token_hash, delivery_key, event_seq, delivered_at_iso
        ) VALUES (
          @tokenHash, @deliveryKey, @eventSeq, @timestamp
        )
      `).run(values)
      this.db.prepare(`
        DELETE FROM mobile_push_deliveries
        WHERE token_hash = @tokenHash
          AND rowid NOT IN (
            SELECT rowid
            FROM mobile_push_deliveries
            WHERE token_hash = @tokenHash
            ORDER BY delivered_at_iso DESC, rowid DESC
            LIMIT @retentionLimit
          )
      `).run({
        tokenHash: record.tokenHash,
        retentionLimit: MOBILE_PUSH_DELIVERY_RETENTION_LIMIT,
      })
    })()
  }

  markMobilePushProviderAccepted(record: {
    tokenHash: string
    deliveryKey: string
    nextAttemptAtIso: string
  }): void {
    const timestamp = nowIso()
    const values = {
      tokenHash: record.tokenHash.trim(),
      deliveryKey: record.deliveryKey.trim(),
      nextAttemptAtIso: record.nextAttemptAtIso,
      timestamp,
    }
    this.db.transaction(() => {
      const update = this.db.prepare(`
        UPDATE mobile_push_outbox SET
          attempt_count=attempt_count + 1,
          next_attempt_at_iso=@nextAttemptAtIso,
          updated_at_iso=@timestamp,
          last_error='awaiting_device_ack'
        WHERE token_hash=@tokenHash AND delivery_key=@deliveryKey
      `).run(values)
      if (update.changes === 0) return
      this.db.prepare(`
        UPDATE mobile_push_registrations SET
          last_success_at_iso=@timestamp,
          last_error=NULL
        WHERE token_hash=@tokenHash
      `).run(values)
    })()
  }

  acknowledgeMobilePushDeliveries(record: {
    appInstanceId: string
    threadId: string
    eventSeq: number
  }): { accepted: boolean; acknowledgedCount: number } {
    const values = {
      appInstanceId: record.appInstanceId.trim(),
      threadId: record.threadId.trim(),
      eventSeq: Math.max(0, Math.trunc(record.eventSeq)),
    }
    if (!values.appInstanceId || !values.threadId || values.eventSeq <= 0) {
      return { accepted: false, acknowledgedCount: 0 }
    }
    const registered = this.db.prepare(`
      SELECT 1 AS found FROM mobile_push_registrations
      WHERE platform = 'android' AND app_instance_id = ?
      LIMIT 1
    `).get(values.appInstanceId) as { found?: number } | undefined
    if (registered?.found !== 1) return { accepted: false, acknowledgedCount: 0 }
    const timestamp = nowIso()
    const acknowledgedCount = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO mobile_push_device_acknowledgements (
          app_instance_id, thread_id, event_seq, acknowledged_at_iso
        ) VALUES (
          @appInstanceId, @threadId, @eventSeq, @timestamp
        )
        ON CONFLICT(app_instance_id, thread_id) DO UPDATE SET
          event_seq=MAX(event_seq, excluded.event_seq),
          acknowledged_at_iso=CASE
            WHEN excluded.event_seq >= event_seq THEN excluded.acknowledged_at_iso
            ELSE acknowledged_at_iso
          END
      `).run({ ...values, timestamp })
      const rows = this.db.prepare(`
        SELECT outbox.token_hash, outbox.delivery_key, outbox.event_seq
        FROM mobile_push_outbox AS outbox
        INNER JOIN mobile_push_registrations AS registrations
          ON registrations.token_hash = outbox.token_hash
        WHERE registrations.platform = 'android'
          AND registrations.app_instance_id = @appInstanceId
          AND outbox.thread_id = @threadId
          AND outbox.event_seq <= @eventSeq
        ORDER BY outbox.event_seq ASC, outbox.created_at_iso ASC
      `).all(values) as Array<{
        token_hash: string
        delivery_key: string
        event_seq: number
      }>
      for (const row of rows) {
        const delivery = {
          tokenHash: row.token_hash,
          deliveryKey: row.delivery_key,
          eventSeq: Math.max(0, Math.trunc(row.event_seq)),
          timestamp,
        }
        this.db.prepare(`
          INSERT OR IGNORE INTO mobile_push_deliveries (
            token_hash, delivery_key, event_seq, delivered_at_iso
          ) VALUES (
            @tokenHash, @deliveryKey, @eventSeq, @timestamp
          )
        `).run(delivery)
        this.db.prepare(`
          DELETE FROM mobile_push_outbox
          WHERE token_hash=@tokenHash AND delivery_key=@deliveryKey
        `).run(delivery)
        this.db.prepare(`
          UPDATE mobile_push_registrations SET
            last_delivery_key=@deliveryKey,
            last_event_seq=MAX(last_event_seq, @eventSeq),
            last_error=NULL
          WHERE token_hash=@tokenHash
        `).run(delivery)
      }
      for (const tokenHash of new Set(rows.map((row) => row.token_hash))) {
        this.db.prepare(`
          DELETE FROM mobile_push_deliveries
          WHERE token_hash = @tokenHash
            AND rowid NOT IN (
              SELECT rowid
              FROM mobile_push_deliveries
              WHERE token_hash = @tokenHash
              ORDER BY delivered_at_iso DESC, rowid DESC
              LIMIT @retentionLimit
            )
        `).run({ tokenHash, retentionLimit: MOBILE_PUSH_DELIVERY_RETENTION_LIMIT })
      }
      this.db.prepare(`
        DELETE FROM mobile_push_device_acknowledgements
        WHERE app_instance_id = @appInstanceId
          AND rowid NOT IN (
            SELECT rowid
            FROM mobile_push_device_acknowledgements
            WHERE app_instance_id = @appInstanceId
            ORDER BY acknowledged_at_iso DESC, rowid DESC
            LIMIT @retentionLimit
          )
      `).run({
        appInstanceId: values.appInstanceId,
        retentionLimit: MOBILE_PUSH_ACKNOWLEDGEMENT_RETENTION_LIMIT,
      })
      return rows.length
    })()
    return { accepted: true, acknowledgedCount }
  }

  enqueueMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    eventSeq: number
    method: string
    threadId: string
    turnId: string
  }): boolean {
    const timestamp = nowIso()
    const values = {
      tokenHash: record.tokenHash.trim(),
      deliveryKey: record.deliveryKey.trim(),
      eventSeq: Math.max(0, Math.trunc(record.eventSeq)),
      method: record.method.trim().slice(0, 120),
      threadId: record.threadId.trim().slice(0, 160),
      turnId: record.turnId.trim().slice(0, 160),
      timestamp,
    }
    if (!values.tokenHash || !values.deliveryKey || !values.method || !values.threadId) return false
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO mobile_push_outbox (
        token_hash, delivery_key, event_seq, method, thread_id, turn_id,
        attempt_count, next_attempt_at_iso, created_at_iso, updated_at_iso
      )
      SELECT
        @tokenHash, @deliveryKey, @eventSeq, @method, @threadId, @turnId,
        0, @timestamp, @timestamp, @timestamp
      WHERE EXISTS (
        SELECT 1 FROM mobile_push_registrations WHERE token_hash = @tokenHash
      ) AND NOT EXISTS (
        SELECT 1 FROM mobile_push_deliveries
        WHERE token_hash = @tokenHash AND delivery_key = @deliveryKey
      ) AND NOT EXISTS (
        SELECT 1
        FROM mobile_push_registrations AS registration
        INNER JOIN mobile_push_device_acknowledgements AS acknowledgement
          ON acknowledgement.app_instance_id = registration.app_instance_id
        WHERE registration.token_hash = @tokenHash
          AND acknowledgement.thread_id = @threadId
          AND acknowledgement.event_seq >= @eventSeq
      )
    `).run(values)
    return result.changes > 0
  }

  listDueMobilePushDeliveries(atIso = nowIso(), limit = 32): MobilePushOutboxRecord[] {
    const rows = this.db.prepare(`
      SELECT outbox.*, registrations.token
      FROM mobile_push_outbox AS outbox
      INNER JOIN mobile_push_registrations AS registrations
        ON registrations.token_hash = outbox.token_hash
      WHERE outbox.next_attempt_at_iso <= ?
      ORDER BY outbox.next_attempt_at_iso ASC, outbox.created_at_iso ASC
      LIMIT ?
    `).all(atIso, Math.max(1, Math.min(128, Math.trunc(limit)))) as MobilePushOutboxRow[]
    return rows.map(fromMobilePushOutboxRow)
  }

  rescheduleMobilePushDelivery(record: {
    tokenHash: string
    deliveryKey: string
    nextAttemptAtIso: string
    error: string
  }): void {
    const timestamp = nowIso()
    const values = {
      tokenHash: record.tokenHash,
      deliveryKey: record.deliveryKey,
      nextAttemptAtIso: record.nextAttemptAtIso,
      timestamp,
      lastError: (record.error || 'delivery_failed').slice(0, 240),
    }
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE mobile_push_outbox SET
          attempt_count=attempt_count + 1,
          next_attempt_at_iso=@nextAttemptAtIso,
          updated_at_iso=@timestamp,
          last_error=@lastError
        WHERE token_hash=@tokenHash AND delivery_key=@deliveryKey
      `).run(values)
      this.db.prepare(`
        UPDATE mobile_push_registrations SET
          last_failure_at_iso=@timestamp,
          last_error=@lastError
        WHERE token_hash=@tokenHash
      `).run(values)
    })()
  }

  getNextMobilePushDeliveryAtIso(): string | null {
    const row = this.db.prepare(`
      SELECT MIN(next_attempt_at_iso) AS next_attempt_at_iso
      FROM mobile_push_outbox
    `).get() as { next_attempt_at_iso?: string | null } | undefined
    return row?.next_attempt_at_iso ?? null
  }

  getMobilePushHealth(): {
    registrationCount: number
    subscribedRegistrationCount: number
    pendingDeliveryCount: number
    awaitingDeviceAckCount: number
    nextRetryAtIso: string | null
    lastSuccessAtIso: string | null
    lastFailureAtIso: string | null
    lastError: string | null
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS registration_count,
        SUM(CASE WHEN thread_ids_json <> '[]' THEN 1 ELSE 0 END) AS subscribed_registration_count,
        MAX(last_success_at_iso) AS last_success_at_iso,
        MAX(last_failure_at_iso) AS last_failure_at_iso
      FROM mobile_push_registrations
    `).get() as {
      registration_count?: number
      subscribed_registration_count?: number
      last_success_at_iso?: string | null
      last_failure_at_iso?: string | null
    } | undefined
    const latestFailure = this.db.prepare(`
      SELECT last_error FROM mobile_push_registrations
      WHERE last_failure_at_iso IS NOT NULL
      ORDER BY last_failure_at_iso DESC
      LIMIT 1
    `).get() as { last_error?: string | null } | undefined
    const pendingDeliveries = this.db.prepare(
      `SELECT
        COUNT(*) AS value,
        SUM(CASE WHEN last_error = 'awaiting_device_ack' THEN 1 ELSE 0 END) AS awaiting_device_ack
      FROM mobile_push_outbox`,
    ).get() as { value?: number; awaiting_device_ack?: number } | undefined
    return {
      registrationCount: row?.registration_count ?? 0,
      subscribedRegistrationCount: row?.subscribed_registration_count ?? 0,
      pendingDeliveryCount: pendingDeliveries?.value ?? 0,
      awaitingDeviceAckCount: pendingDeliveries?.awaiting_device_ack ?? 0,
      nextRetryAtIso: this.getNextMobilePushDeliveryAtIso(),
      lastSuccessAtIso: row?.last_success_at_iso ?? null,
      lastFailureAtIso: row?.last_failure_at_iso ?? null,
      lastError: latestFailure?.last_error ?? null,
    }
  }

  private getMobilePushRegistration(tokenHash: string): MobilePushRegistrationRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM mobile_push_registrations WHERE token_hash = ?',
    ).get(tokenHash) as MobilePushRegistrationRow | undefined
    return row ? fromMobilePushRegistrationRow(row) : null
  }

  getHealth(): {
    path: string
    requestCount: number
    uncertainRequestCount: number
    latestSeq: number
    oldestSeq: number
    snapshotCount: number
    databaseBytes: number
    freeBytes: number
    freePageRatio: number
    autoVacuumMode: number
  } {
    const scalar = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { value?: number } | undefined
      return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : 0
    }
    const home = homedir()
    const displayPath = this.db.name.startsWith(home)
      ? `~${this.db.name.slice(home.length)}`
      : this.db.name
    const storage = this.getStorageStats()
    return {
      path: displayPath,
      requestCount: scalar('SELECT COUNT(*) AS value FROM runtime_requests'),
      uncertainRequestCount: scalar(`
        SELECT COUNT(*) AS value FROM runtime_requests
        WHERE status IN ('pending_start', 'starting', 'start_uncertain', 'running', 'stopping', 'stop_uncertain', 'still_running', 'sync_degraded')
      `),
      latestSeq: this.getLatestEventSeq(),
      oldestSeq: this.getOldestEventSeq(),
      snapshotCount: scalar('SELECT COUNT(*) AS value FROM thread_runtime_snapshots'),
      databaseBytes: storage.databaseBytes,
      freeBytes: storage.freeBytes,
      freePageRatio: storage.freePageRatio,
      autoVacuumMode: storage.autoVacuumMode,
    }
  }

  private runLightweightStartupMaintenance(): void {
    const latestSeq = this.getLatestEventSeq()
    if (latestSeq > 0) {
      this.db.prepare('DELETE FROM runtime_events WHERE seq <= ?').run(Math.max(0, latestSeq - RUNTIME_EVENT_RETENTION_LIMIT))
    }
    this.db.prepare(`
      UPDATE runtime_events
      SET params_json = '{}'
      WHERE method = ? AND params_json <> '{}'
    `).run(APP_LIST_UPDATED_METHOD)
    this.db.prepare(`
      DELETE FROM mobile_push_outbox
      WHERE NOT EXISTS (
        SELECT 1 FROM mobile_push_registrations
        WHERE mobile_push_registrations.token_hash = mobile_push_outbox.token_hash
      ) OR EXISTS (
        SELECT 1 FROM mobile_push_deliveries
        WHERE mobile_push_deliveries.token_hash = mobile_push_outbox.token_hash
          AND mobile_push_deliveries.delivery_key = mobile_push_outbox.delivery_key
      )
    `).run()
    this.db.prepare(`
      DELETE FROM mobile_push_device_acknowledgements
      WHERE NOT EXISTS (
        SELECT 1 FROM mobile_push_registrations
        WHERE mobile_push_registrations.app_instance_id = mobile_push_device_acknowledgements.app_instance_id
      )
    `).run()
    this.runIncrementalVacuum()
  }

  private runIncrementalVacuum(): void {
    if (this.readPragmaNumber('auto_vacuum') !== RUNTIME_DB_AUTO_VACUUM_INCREMENTAL) return
    this.db.pragma(`incremental_vacuum(${RUNTIME_DB_INCREMENTAL_VACUUM_PAGES})`)
  }

  private countActiveRequests(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS value FROM runtime_requests
      WHERE status IN ('pending_start', 'starting', 'start_uncertain', 'running', 'stopping', 'stop_uncertain', 'still_running')
    `).get() as { value?: number } | undefined
    return typeof row?.value === 'number' && Number.isFinite(row.value) ? Math.max(0, Math.trunc(row.value)) : 0
  }

  private readPragmaNumber(name: 'page_count' | 'freelist_count' | 'page_size' | 'auto_vacuum'): number {
    const value = this.db.pragma(name, { simple: true }) as unknown
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  }

  close(): void {
    this.db.close()
  }
}
