import { createAppServerRuntimeTurnStarter } from './appServerRuntimeStart.js'
import type { RuntimeStartDependencies, RuntimeStartResult } from './appServerRuntimeStart.js'
import {
  assistantHardeningConfig,
  assistantThreadParams,
  type AssistantRoleBinding,
} from './assistantRolePolicy.js'
import type { RuntimeStore } from './runtimeStore.js'

const GENERIC_ASSISTANT_ERROR = 'Assistant request rejected.'

type AssistantRoleStore = Pick<
  RuntimeStore,
  'readAssistantIdentity' | 'readAssistantMainConversation' | 'getLatestRequestByClientMessageId'
> & Partial<Pick<RuntimeStore, 'assistantTasks'>>

function readPlainRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Managed assistant turn starter.
 *
 * This starter is deliberately private to the dedicated assistant conversation
 * route: it injects the role policy at the thread/start boundary (hardened config,
 * read-only sandbox, no approvals, no dynamic tools) before delegating to the
 * conservative managed start semantics in appServerRuntimeStart. Ordinary runtime
 * turns never use it; their boundary is protected centrally by AppServerProcess.rpc.
 */
export function createAssistantRuntimeTurnStarter(
  deps: RuntimeStartDependencies,
  options: {
    readInstructions?: () => string
    readTools?: () => unknown[]
    onThreadCreated?: (result: unknown) => void
  } = {},
): (payload: unknown) => Promise<RuntimeStartResult> {
  return createAppServerRuntimeTurnStarter({
    ...deps,
    rpc: async (method, params) => {
      if (method !== 'thread/start') return await deps.rpc(method, params)

      const configRead = await deps.rpc('config/read', { includeLayers: false })
      const config = assistantHardeningConfig(configRead)
      const base = readPlainRecord(params)
      const serverCwd = typeof base.cwd === 'string' ? base.cwd.trim() : ''
      const hardened = assistantThreadParams(serverCwd, config, options.readInstructions?.())
      const threadParams: Record<string, unknown> = { ...base, ...hardened }
      if (options.readTools) threadParams.dynamicTools = options.readTools()
      if (!serverCwd) delete threadParams.cwd
      const result = await deps.rpc(method, threadParams)
      options.onThreadCreated?.(result)
      return result
    },
  })
}

/** Cold recovery must preserve the dedicated creator before a native ID exists. */
export function createAssistantPendingStartResumer<T>(deps: {
  readMainClientMessageId?: () => string | null
  startAssistantConversation: (payload: unknown) => Promise<T>
  startRuntimeTurn: (payload: unknown) => Promise<T>
}): (payload: unknown) => Promise<T> {
  return async (payload) => {
    const clientMessageId = readPlainRecord(payload).clientMessageId
    const mainClientMessageId = deps.readMainClientMessageId?.()
    return clientMessageId && clientMessageId === mainClientMessageId
      ? await deps.startAssistantConversation(payload)
      : await deps.startRuntimeTurn(payload)
  }
}

/**
 * Resolves the current assistant role binding from the store only. The frontend
 * cannot supply or influence it: a reservation must already exist, its identity
 * must still match (same assistant, same workspace, compared the way the store
 * compares workspaces), and the thread id comes from the persisted request for
 * that reservation, never from a client-supplied prefix.
 *
 * A reservation without a bound native thread yields { threadId: '', cwd } so the
 * global rpc policy still blocks host config changes instead of silently treating
 * the assistant as unbound. Read failures propagate; they are never mapped to
 * "no assistant" because that would disable the protection.
 */
export function readAssistantRoleBinding(store: AssistantRoleStore): AssistantRoleBinding | null {
  const reservation = store.readAssistantMainConversation()
  if (!reservation) return null

  const identity = store.readAssistantIdentity()
  if (!identity) throw new Error(GENERIC_ASSISTANT_ERROR)
  if (!reservation.assistantId || identity.assistantId !== reservation.assistantId) {
    throw new Error(GENERIC_ASSISTANT_ERROR)
  }
  if (!reservation.cwd || !identity.cwd) throw new Error(GENERIC_ASSISTANT_ERROR)
  if (workspaceComparisonKey(identity.cwd) !== workspaceComparisonKey(reservation.cwd)) {
    throw new Error(GENERIC_ASSISTANT_ERROR)
  }

  const request = store.getLatestRequestByClientMessageId(reservation.clientMessageId)
  const requestThreadId = request && typeof request.threadId === 'string' ? request.threadId.trim() : ''
  const registeredThreadId = store.assistantTasks?.readCoordinator(identity.assistantId)?.mainToolsThreadId ?? ''
  if (requestThreadId && registeredThreadId && requestThreadId !== registeredThreadId) throw new Error(GENERIC_ASSISTANT_ERROR)
  const threadId = registeredThreadId || requestThreadId
  return { threadId, cwd: reservation.cwd }
}

/**
 * Mirrors the store's assistant workspace comparison: slashes are normalized,
 * trailing separators are ignored, and drive-letter / UNC paths compare
 * case-insensitively while POSIX paths stay case-sensitive.
 */
function workspaceComparisonKey(cwd: string): string {
  const normalized = cwd.trim().replace(/\\/g, '/')
  const trimmed = normalized === '/' ? '/' : normalized.replace(/\/+$/, '')
  const caseInsensitive = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
  return caseInsensitive ? trimmed.toLowerCase() : trimmed
}
