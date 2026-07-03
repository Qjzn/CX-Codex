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
