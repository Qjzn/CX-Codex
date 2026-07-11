import { createHash, randomBytes } from 'node:crypto'

export type CollaborationMode = 'execute' | 'plan'

export type RuntimeTurnOptions = {
  plugins: Array<{ id: string; name: string }>
  goal?: { enabled: boolean; text: string }
}

export type ParsedRuntimeSendPayload = {
  requestId: string
  clientMessageId: string
  mode: CollaborationMode
  model: string
  cwd: string
  threadId: string
  input: unknown[]
  attachments: unknown
  effort: unknown
  turnOptions: RuntimeTurnOptions | null
  payloadSummary: Record<string, unknown>
}

export type ParsedRuntimeInterruptPayload = {
  requestId: string
  threadId: string
  turnId: string
  payloadSummary: {
    threadId: string
    turnId: string
    source: string
    requestedAtIso: string
    clientElapsedMs: number | null
    userAgent: string
  }
}

const PLAN_MODE_PROMPT_PREFIX = `# Codex Plan Mode

You are working in plan mode.

Rules:
- Do not run shell commands.
- Do not edit, create, delete, rename, or move files.
- Do not call tools or MCP actions that change local or remote state.
- You may inspect the user's request and provide a concrete implementation plan, risks, verification steps, and files likely to change.
- If the user asks you to execute the plan, wait for a separate execute-mode message.

# User Request`

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringByAliases(record: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = readString(record[key]).trim()
    if (value) return value
  }
  return ''
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error) return payload.message || fallback
  const record = asRecord(payload)
  const directMessage = typeof record?.message === 'string' ? record.message : ''
  if (directMessage) return directMessage
  const error = asRecord(record?.error)
  const errorMessage = typeof error?.message === 'string' ? error.message : ''
  return errorMessage || fallback
}

export function readCollaborationModeFromPayload(payload: unknown): CollaborationMode {
  const root = asRecord(payload)
  const raw =
    typeof root?.collaborationMode === 'string'
      ? root.collaborationMode
      : typeof root?.mode === 'string'
        ? root.mode
        : ''
  return raw.trim().toLowerCase() === 'plan' ? 'plan' : 'execute'
}

export function createRuntimeRequestId(): string {
  return `rt-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`
}

export function createRuntimePromptHash(value: unknown): string {
  let input = ''
  try {
    input = JSON.stringify(value ?? null)
  } catch {
    input = String(value ?? '')
  }
  return createHash('sha256').update(input).digest('hex')
}

export function summarizeRuntimeInput(input: unknown[]): Record<string, unknown> {
  let textCount = 0
  let imageCount = 0
  let localImageCount = 0
  let skillCount = 0
  for (const item of input) {
    const record = asRecord(item)
    const type = typeof record?.type === 'string' ? record.type : ''
    if (type === 'text') textCount += 1
    else if (type === 'image') imageCount += 1
    else if (type === 'localImage') localImageCount += 1
    else if (type === 'skill') skillCount += 1
  }
  return {
    inputCount: input.length,
    textCount,
    imageCount,
    localImageCount,
    skillCount,
  }
}

export function buildRuntimeRequestPayloadSummary(args: {
  threadId: string
  cwd: string
  model: string
  effort: unknown
  collaborationMode: CollaborationMode
  input: unknown[]
  attachments: unknown
  turnOptions: RuntimeTurnOptions | null
}): Record<string, unknown> {
  return {
    hasThreadId: args.threadId.length > 0,
    hasCwd: args.cwd.length > 0,
    cwdHash: args.cwd ? createRuntimePromptHash(args.cwd) : '',
    model: args.model,
    effort: readString(args.effort).trim(),
    collaborationMode: args.collaborationMode,
    input: summarizeRuntimeInput(args.input),
    attachmentCount: Array.isArray(args.attachments) ? args.attachments.length : 0,
    turnOptions: {
      pluginCount: args.turnOptions?.plugins.length ?? 0,
      hasGoal: args.turnOptions?.goal?.enabled === true,
    },
  }
}

export function parseRuntimeSendPayload(payload: unknown): ParsedRuntimeSendPayload {
  const body = asRecord(payload)
  if (!body) throw new Error('Invalid body: expected runtime send payload')

  const requestId = readString(body.requestId).trim() || createRuntimeRequestId()
  const clientMessageId = readString(body.clientMessageId).trim()
  const mode = readCollaborationModeFromPayload(body)
  const model = readString(body.model).trim()
  const cwd = readString(body.cwd).trim()
  const threadId = readStringByAliases(body, 'threadId', 'thread_id')
  const turnOptions = readRuntimeTurnOptions(body.turnOptions)
  const input = applyRuntimeTurnOptionsToInput(Array.isArray(body.input) ? body.input : [], turnOptions)
  if (input.length === 0) {
    throw new Error('runtime/send requires input')
  }

  return {
    requestId,
    clientMessageId,
    mode,
    model,
    cwd,
    threadId,
    input,
    attachments: body.attachments,
    effort: body.effort,
    turnOptions,
    payloadSummary: buildRuntimeRequestPayloadSummary({
      threadId,
      cwd,
      model,
      collaborationMode: mode,
      input,
      effort: body.effort,
      attachments: body.attachments,
      turnOptions,
    }),
  }
}

export function parseRuntimeInterruptPayload(payload: unknown): ParsedRuntimeInterruptPayload {
  const body = asRecord(payload)
  if (!body) throw new Error('Invalid body: expected runtime interrupt payload')

  const threadId = readStringByAliases(body, 'threadId', 'thread_id')
  const turnId = readStringByAliases(body, 'turnId', 'turn_id', 'activeTurnId')
  if (!threadId) throw new Error('runtime/interrupt requires threadId')
  if (!turnId) throw new Error('runtime/interrupt requires turnId')

  const requestId = readString(body.requestId).trim() || createRuntimeRequestId()
  const source = readString(body.source).trim() || 'unknown'
  const requestedAtIso = readString(body.requestedAtIso).trim()
  const userAgent = readString(body.userAgent).trim()
  const clientElapsedMs = typeof body.clientElapsedMs === 'number' && Number.isFinite(body.clientElapsedMs)
    ? Math.max(0, Math.round(body.clientElapsedMs))
    : null

  return {
    requestId,
    threadId,
    turnId,
    payloadSummary: {
      threadId,
      turnId,
      source,
      requestedAtIso,
      clientElapsedMs,
      userAgent: userAgent.slice(0, 240),
    },
  }
}

export function readRuntimeTurnOptions(value: unknown): RuntimeTurnOptions | null {
  const root = asRecord(value)
  if (!root) return null

  const plugins = Array.isArray(root.plugins)
    ? root.plugins
      .map((item) => {
        const record = asRecord(item)
        const id = readString(record?.id).trim()
        const name = readString(record?.name).trim()
        return id && name ? { id, name } : null
      })
      .filter((item): item is { id: string; name: string } => item !== null)
    : []

  const rawGoal = asRecord(root.goal)
  const goal = rawGoal && rawGoal.enabled === true
    ? {
        enabled: true,
        text: readString(rawGoal.text).trim(),
      }
    : undefined

  if (plugins.length === 0 && !goal) return null
  return {
    plugins,
    ...(goal ? { goal } : {}),
  }
}

export function buildRuntimeTurnOptionsPrompt(options: RuntimeTurnOptions | null): string {
  if (!options) return ''
  const lines: string[] = []
  if (options.goal?.enabled === true) {
    const goalText = options.goal.text || '主动给出可执行的下一步，并补齐关键风险。'
    lines.push(`本轮要求: ${goalText}。仅应用于这次消息，请据此主动推进，不只停留在解释。`)
  }
  if (lines.length === 0) return ''
  return `<!-- CX-Codex turn options\n${lines.join('\n')}\n-->`
}

export function applyRuntimeTurnOptionsToInput(input: unknown[], options: RuntimeTurnOptions | null): unknown[] {
  const optionsPrompt = buildRuntimeTurnOptionsPrompt(options)
  if (!optionsPrompt) return input

  let didApply = false
  const next = input.map((item) => {
    const record = asRecord(item)
    if (!record || didApply || record.type !== 'text' || typeof record.text !== 'string') return item
    didApply = true
    return {
      ...record,
      text: record.text.trim()
        ? `${optionsPrompt}\n${record.text}`
        : optionsPrompt,
    }
  })

  if (didApply) return next
  return [
    { type: 'text', text: optionsPrompt },
    ...input,
  ]
}

export function buildPlanModePrompt(text: string): string {
  const normalizedText = text.trim()
  return `${PLAN_MODE_PROMPT_PREFIX}\n\n${normalizedText || '请先制定计划。'}`
}

export function normalizePlanModeTurnStartParams(params: unknown, options: { includeNativeMode?: boolean } = {}): unknown {
  const root = asRecord(params)
  if (!root || readCollaborationModeFromPayload(root) !== 'plan') return params

  const next: Record<string, unknown> = { ...root }
  delete next.collaborationMode
  if (options.includeNativeMode !== false) {
    next.mode = 'plan'
    return next
  }

  if (next.mode === 'plan') {
    delete next.mode
  }

  const input = Array.isArray(root.input) ? root.input : []
  let didWrapText = false
  next.input = input.map((item) => {
    const record = asRecord(item)
    if (!record || didWrapText || record.type !== 'text' || typeof record.text !== 'string') {
      return item
    }
    didWrapText = true
    return {
      ...record,
      text: buildPlanModePrompt(record.text),
    }
  })

  if (!didWrapText) {
    next.input = [
      { type: 'text', text: buildPlanModePrompt('') },
      ...input,
    ]
  }

  return next
}

export function shouldRetryPlanModeWithoutNativeMode(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase()
  if (!message) return false
  return (
    message.includes('mode') &&
    (
      message.includes('unknown') ||
      message.includes('invalid') ||
      message.includes('unexpected') ||
      message.includes('unrecognized') ||
      message.includes('deserialize')
    )
  )
}
