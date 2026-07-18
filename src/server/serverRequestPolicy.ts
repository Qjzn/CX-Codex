export type PermissionDecision = 'ask' | 'allowForSession'

export type WebBridgePermissionSettings = {
  allowAllPermissionRequests: boolean
  commandExecution: PermissionDecision
  fileChange: PermissionDecision
  mcpTools: PermissionDecision
}

export type WebBridgeSettings = {
  permissions: WebBridgePermissionSettings
}

export type ServerRequestPolicyDecision =
  | { kind: 'plan-decline'; result: unknown }
  | { kind: 'auto-approve'; result: unknown }
  | { kind: 'reject-unsupported'; result: unknown }
  | { kind: 'queue' }

export type ImmediateServerRequestPolicyDecision = Exclude<ServerRequestPolicyDecision, { kind: 'queue' }>

type EvaluateServerRequestPolicyOptions = {
  method: string
  params: unknown
  permissions: WebBridgePermissionSettings
  isPlanModeRequest: boolean
}

const COMMAND_APPROVAL_METHOD = 'item/commandExecution/requestApproval'
const FILE_CHANGE_APPROVAL_METHOD = 'item/fileChange/requestApproval'
const TOOL_CALL_METHOD = 'item/tool/call'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function looksLikeMcpElicitationPayload(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false
  return (
    readString(payload.message).trim().length > 0 ||
    readString(payload.mode).trim().length > 0 ||
    readString(payload.url).trim().length > 0 ||
    asRecord(payload.requestedSchema) !== null ||
    asRecord(payload.schema) !== null ||
    asRecord(payload.inputSchema) !== null ||
    asRecord(payload.jsonSchema) !== null
  )
}

function readMcpElicitationPayload(params: unknown): Record<string, unknown> | null {
  const row = asRecord(params)
  if (!row) return null
  const requestParams = asRecord(asRecord(row.request)?.params)
  if (looksLikeMcpElicitationPayload(requestParams)) return requestParams
  const elicitationParams = asRecord(asRecord(row.elicitation)?.params)
  if (looksLikeMcpElicitationPayload(elicitationParams)) return elicitationParams
  const nestedParams = asRecord(row.params)
  if (looksLikeMcpElicitationPayload(nestedParams)) return nestedParams
  return row
}

export function isMcpElicitationRequestMethod(method: string): boolean {
  const normalized = method.trim().toLowerCase()
  return (
    normalized === 'mcpserver/elicitation/request' ||
    normalized === 'mcpserver/elication/request' ||
    normalized === 'elicitation/create'
  )
}

export function isMcpToolPermissionRequest(method: string, params: unknown): boolean {
  if (!isMcpElicitationRequestMethod(method)) return false
  const payload = readMcpElicitationPayload(params)
  const message = readString(payload?.message).trim()
  if (/^Allow\s+(?:the\s+.+?\s+MCP\s+server|.+?)\s+to\s+run\s+tool\s+["'“”‘’][^"'“”‘’]+["'“”‘’]\??$/iu.test(message)) {
    return true
  }
  const metadata = asRecord(payload?._meta)
  if (metadata?.codex_approval_kind === 'mcp_tool_call') return true
  const serverName = readString(payload?.serverName || payload?.server).trim()
  const toolName = readString(payload?.toolName || payload?.tool).trim()
  return serverName.length > 0 && toolName.length > 0
}

function isApprovalPermissionRequest(method: string, params: unknown): boolean {
  return (
    method === COMMAND_APPROVAL_METHOD ||
    method === FILE_CHANGE_APPROVAL_METHOD ||
    isMcpToolPermissionRequest(method, params)
  )
}

export function shouldDeclinePlanModeServerRequest(
  method: string,
  params: unknown,
  isPlanModeRequest: boolean,
): boolean {
  if (!isPlanModeRequest) return false
  return isApprovalPermissionRequest(method, params)
}

export function buildPlanModeDeclineResult(method: string, params: unknown): unknown {
  if (isMcpToolPermissionRequest(method, params)) {
    return { action: 'decline' }
  }
  return { decision: 'decline' }
}

export function shouldAutoApproveServerRequest(
  method: string,
  params: unknown,
  permissions: WebBridgePermissionSettings,
): boolean {
  if (permissions.allowAllPermissionRequests) {
    return isApprovalPermissionRequest(method, params)
  }
  if (method === COMMAND_APPROVAL_METHOD) {
    return permissions.commandExecution === 'allowForSession'
  }
  if (method === FILE_CHANGE_APPROVAL_METHOD) {
    return permissions.fileChange === 'allowForSession'
  }
  if (isMcpToolPermissionRequest(method, params)) {
    return permissions.mcpTools === 'allowForSession'
  }
  return false
}

export function buildAutoApprovalResult(method: string, params: unknown): unknown {
  if (isMcpToolPermissionRequest(method, params)) {
    const payload = readMcpElicitationPayload(params)
    const metadata = asRecord(payload?._meta)
    const persistValues = Array.isArray(metadata?.persist) ? metadata.persist : [metadata?.persist]
    return persistValues.includes('session')
      ? { action: 'accept', content: {}, _meta: { persist: 'session' } }
      : { action: 'accept', content: {} }
  }
  return { decision: 'acceptForSession' }
}

export function shouldRejectUnsupportedServerRequest(method: string): boolean {
  return method === TOOL_CALL_METHOD
}

export function buildUnsupportedServerRequestResult(method: string): unknown {
  if (method === TOOL_CALL_METHOD) {
    return {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'CX-Codex Web 收到了 Codex 工具调用请求，但当前 Web 端不能代执行这个工具。请改用文字方案继续，或提示用户在桌面端 Codex 客户端处理需要的工具操作。',
        },
      ],
    }
  }
  return {}
}

export function evaluateServerRequestPolicy(
  options: EvaluateServerRequestPolicyOptions,
): ServerRequestPolicyDecision {
  const { method, params, permissions, isPlanModeRequest } = options

  if (shouldDeclinePlanModeServerRequest(method, params, isPlanModeRequest)) {
    return { kind: 'plan-decline', result: buildPlanModeDeclineResult(method, params) }
  }

  if (shouldAutoApproveServerRequest(method, params, permissions)) {
    return { kind: 'auto-approve', result: buildAutoApprovalResult(method, params) }
  }

  if (shouldRejectUnsupportedServerRequest(method)) {
    return { kind: 'reject-unsupported', result: buildUnsupportedServerRequestResult(method) }
  }

  return { kind: 'queue' }
}

export function isImmediateServerRequestPolicyDecision(
  decision: ServerRequestPolicyDecision,
): decision is ImmediateServerRequestPolicyDecision {
  return decision.kind !== 'queue'
}
