import type { PendingServerRequest } from './pendingServerRequests.js'

export type ServerRequestDiagnosticsKind =
  | 'permission'
  | 'approval'
  | 'elicitation'
  | 'tool'
  | 'request'

export type PendingServerRequestDiagnostics = {
  id: number
  method: string
  kind: ServerRequestDiagnosticsKind
  receivedAtIso: string
}

export type ServerRequestDiagnosticsSnapshot = {
  pendingRequestCount: number
  pendingByKind: Record<ServerRequestDiagnosticsKind, number>
  pendingRequests: PendingServerRequestDiagnostics[]
}

export function classifyServerRequestMethod(method: string): ServerRequestDiagnosticsKind {
  const normalized = method.trim().toLowerCase()
  if (normalized.includes('permission')) return 'permission'
  if (normalized.includes('approval')) return 'approval'
  if (normalized.includes('elicitation')) return 'elicitation'
  if (normalized.includes('tool')) return 'tool'
  return 'request'
}

export function toPendingServerRequestDiagnostics(
  request: PendingServerRequest,
): PendingServerRequestDiagnostics {
  return {
    id: request.id,
    method: request.method,
    kind: classifyServerRequestMethod(request.method),
    receivedAtIso: request.receivedAtIso,
  }
}

export function toPendingServerRequestDiagnosticsList(
  requests: PendingServerRequest[],
): PendingServerRequestDiagnostics[] {
  return requests.map(toPendingServerRequestDiagnostics)
}

export function createServerRequestDiagnosticsSnapshot(
  requests: PendingServerRequest[],
): ServerRequestDiagnosticsSnapshot {
  const pendingRequests = toPendingServerRequestDiagnosticsList(requests)
  const pendingByKind = createEmptyKindCounts()
  for (const request of pendingRequests) {
    pendingByKind[request.kind] += 1
  }
  return {
    pendingRequestCount: pendingRequests.length,
    pendingByKind,
    pendingRequests,
  }
}

function createEmptyKindCounts(): Record<ServerRequestDiagnosticsKind, number> {
  return {
    permission: 0,
    approval: 0,
    elicitation: 0,
    tool: 0,
    request: 0,
  }
}
