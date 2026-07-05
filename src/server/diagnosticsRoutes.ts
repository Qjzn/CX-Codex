import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AppServerHealth } from './appServerHealth.js'
import { setJson } from './httpJsonResponse.js'
import type { PendingServerRequest } from './pendingServerRequests.js'
import type {
  RuntimeEventRecord,
  RuntimeRequestRecord,
} from './runtimeStore.js'
import {
  createServerRequestDiagnosticsSnapshot,
} from './serverRequestDiagnostics.js'

const HEALTH_DIAGNOSTICS_TIMEOUT_MS = 1_500
const FULL_DIAGNOSTICS_TIMEOUT_MS = 5_000

type RuntimeStoreHealthSnapshot = {
  latestSeq: number
  [key: string]: unknown
}

type RuntimeDiagnosticsStore = {
  getHealth: () => RuntimeStoreHealthSnapshot
  listEventsAfter: (afterSeq: number, limit: number) => {
    notifications: RuntimeEventRecord[]
  }
  listUncertainRequests: (limit: number) => RuntimeRequestRecord[]
}

export type DiagnosticsRoutesDependencies = {
  getAppServerStatus: () => AppServerHealth
  getNotificationDiagnostics: () => unknown
  getStatusDiagnostics: () => unknown
  listPendingServerRequests: () => PendingServerRequest[]
  readHookDiagnostics: () => Promise<unknown>
  readSchemaAuditSummary: () => Promise<unknown>
  readWindowsSandboxDiagnostics: () => Promise<unknown>
  getTranscriptionDiagnostics: () => unknown
  runtimeStore: RuntimeDiagnosticsStore
  nowIso?: () => string
}

async function readDiagnosticsWithTimeout<T>(
  read: () => Promise<T>,
  label: string,
  timeoutMs: number,
  timestamp: string,
): Promise<T | { available: false; status: 'timeout'; reason: string; checkedAtIso: string }> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s`))
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    return {
      available: false,
      status: 'timeout',
      reason: error instanceof Error ? error.message : `${label} timed out`,
      checkedAtIso: timestamp,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function handleDiagnosticsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: DiagnosticsRoutesDependencies,
): Promise<boolean> {
  if (req.method !== 'GET' || (url.pathname !== '/codex-api/health' && url.pathname !== '/codex-api/diagnostics')) {
    return false
  }

  const timestamp = (dependencies.nowIso ?? (() => new Date().toISOString()))()
  const schemaAudit = await dependencies.readSchemaAuditSummary()
  const serverRequestDiagnostics = createServerRequestDiagnosticsSnapshot(dependencies.listPendingServerRequests())
  const diagnosticsTimeoutMs = url.pathname === '/codex-api/health'
    ? HEALTH_DIAGNOSTICS_TIMEOUT_MS
    : FULL_DIAGNOSTICS_TIMEOUT_MS
  const [hookDiagnostics, windowsSandbox] = await Promise.all([
    readDiagnosticsWithTimeout(
      dependencies.readHookDiagnostics,
      'hook diagnostics',
      diagnosticsTimeoutMs,
      timestamp,
    ),
    readDiagnosticsWithTimeout(
      dependencies.readWindowsSandboxDiagnostics,
      'Windows sandbox diagnostics',
      diagnosticsTimeoutMs,
      timestamp,
    ),
  ])
  const runtimeHealth = dependencies.runtimeStore.getHealth()

  if (url.pathname === '/codex-api/health') {
    setJson(res, 200, {
      status: 'ok',
      data: {
        appServer: dependencies.getAppServerStatus(),
        notificationDiagnostics: dependencies.getNotificationDiagnostics(),
        statusDiagnostics: dependencies.getStatusDiagnostics(),
        serverRequestDiagnostics,
        hookDiagnostics,
        schemaAudit,
        windowsSandbox,
        transcription: dependencies.getTranscriptionDiagnostics(),
        runtimeStore: runtimeHealth,
        timestamp,
      },
    })
    return true
  }

  const recentEvents = dependencies.runtimeStore
    .listEventsAfter(Math.max(0, runtimeHealth.latestSeq - 20), 20)
    .notifications
    .slice(-10)
    .map((event) => ({
      seq: event.seq,
      method: event.method,
      atIso: event.atIso,
      threadId: event.threadId,
      turnId: event.turnId,
    }))
  const uncertainRequests = dependencies.runtimeStore.listUncertainRequests(10).map((request) => ({
    requestId: request.requestId,
    clientMessageId: request.clientMessageId,
    threadId: request.threadId,
    turnId: request.turnId,
    status: request.status,
    retryCount: request.retryCount,
    updatedAtIso: request.updatedAtIso,
    lastError: request.lastError,
  }))

  setJson(res, 200, {
    status: 'ok',
    data: {
      appServer: dependencies.getAppServerStatus(),
      notificationDiagnostics: dependencies.getNotificationDiagnostics(),
      statusDiagnostics: dependencies.getStatusDiagnostics(),
      serverRequestDiagnostics,
      hookDiagnostics,
      schemaAudit,
      windowsSandbox,
      transcription: dependencies.getTranscriptionDiagnostics(),
      runtimeStore: runtimeHealth,
      runtime: {
        uncertainRequests,
        recentEvents,
      },
      pendingServerRequests: serverRequestDiagnostics.pendingRequests,
      timestamp,
    },
  })
  return true
}
