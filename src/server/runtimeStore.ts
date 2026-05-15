import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
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

const SENSITIVE_KEY_PATTERN = /^(?:authorization|authHeader|accessToken|refreshToken|idToken|token|password|secret|cookie|set-cookie|apiKey|apikey)$/iu
const RUNTIME_DB_BUSY_TIMEOUT_MS = 5000
const RUNTIME_EVENT_RETENTION_LIMIT = 5000
const RUNTIME_EVENT_PRUNE_INTERVAL = 100

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

export class RuntimeStore {
  private readonly db: Database.Database
  private appendEventCount = 0

  constructor(dbPath = defaultRuntimeDatabasePath()) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
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
    `)
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
      WHERE status IN ('pending_start', 'start_uncertain', 'running', 'stopping', 'stop_uncertain', 'still_running')
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
    }
    return event
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

  getHealth(): {
    path: string
    requestCount: number
    uncertainRequestCount: number
    latestSeq: number
    oldestSeq: number
    snapshotCount: number
  } {
    const scalar = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { value?: number } | undefined
      return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : 0
    }
    const home = homedir()
    const displayPath = this.db.name.startsWith(home)
      ? `~${this.db.name.slice(home.length)}`
      : this.db.name
    return {
      path: displayPath,
      requestCount: scalar('SELECT COUNT(*) AS value FROM runtime_requests'),
      uncertainRequestCount: scalar(`
        SELECT COUNT(*) AS value FROM runtime_requests
        WHERE status IN ('pending_start', 'start_uncertain', 'running', 'stopping', 'stop_uncertain', 'still_running')
      `),
      latestSeq: this.getLatestEventSeq(),
      oldestSeq: this.getOldestEventSeq(),
      snapshotCount: scalar('SELECT COUNT(*) AS value FROM thread_runtime_snapshots'),
    }
  }

  close(): void {
    this.db.close()
  }
}
