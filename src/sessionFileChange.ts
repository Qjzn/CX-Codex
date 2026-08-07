export const CX_SESSION_FILES_CHANGED_METHOD = 'cx/session-files/changed'

export type CxSessionFileChangeSource = 'session-index' | 'session-log'
export type CxSessionFileChangeOrigin = 'live-app-server' | 'external'

export type CxSessionFileChangeSyncPolicy = {
  preferSessionLogMessages: boolean
  refreshMessages: boolean
  refreshThreads: boolean
}

export type SessionLogAuthoritativeRefreshState = {
  isSelected: boolean
  executionActive: boolean
  hasPendingServerRequest: boolean
  hasQueuedWork: boolean
  hasTerminalEvidence: boolean
}

export type SessionLogAuthoritativeRefreshAction = 'skip' | 'defer' | 'refresh'

export function getSessionLogAuthoritativeRefreshAction(
  state: SessionLogAuthoritativeRefreshState,
): SessionLogAuthoritativeRefreshAction {
  if (!state.isSelected) return 'skip'
  if (state.executionActive || state.hasPendingServerRequest || state.hasQueuedWork) return 'defer'
  if (!state.hasTerminalEvidence) return 'defer'
  return 'refresh'
}

export type SessionLogMessageEvidence = {
  role: 'user' | 'assistant' | 'system'
  messageType?: string
  phase?: 'commentary' | 'final'
}

export function hasSettledSessionLogMessageEvidence(
  messages: readonly SessionLogMessageEvidence[],
): boolean {
  let latestUserIndex = -1
  let latestAssistantIndex = -1
  let latestAssistantIsFinal = false
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role === 'user') {
      latestUserIndex = index
      continue
    }
    if (message?.role === 'assistant' && message.messageType === 'agentMessage') {
      latestAssistantIndex = index
      latestAssistantIsFinal = message.phase !== 'commentary'
    }
  }
  return latestAssistantIndex > latestUserIndex && latestAssistantIsFinal
}

export function isCxSessionFilesChangedMethod(method: string): boolean {
  return method === CX_SESSION_FILES_CHANGED_METHOD
}

export function readCxSessionFileChangeSource(params: unknown): CxSessionFileChangeSource | '' {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return ''
  const source = (params as { source?: unknown }).source
  return source === 'session-index' || source === 'session-log' ? source : ''
}

export function readCxSessionFileChangeOrigin(params: unknown): CxSessionFileChangeOrigin | '' {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return ''
  const origin = (params as { origin?: unknown }).origin
  return origin === 'live-app-server' || origin === 'external' ? origin : ''
}

export function getCxSessionFileChangeSyncPolicy(
  method: string,
  params: unknown,
): CxSessionFileChangeSyncPolicy | null {
  if (!isCxSessionFilesChangedMethod(method)) return null
  const source = readCxSessionFileChangeSource(params)
  if (source === 'session-log') {
    return {
      preferSessionLogMessages: true,
      refreshMessages: true,
      refreshThreads: false,
    }
  }
  if (source === 'session-index') {
    return { preferSessionLogMessages: false, refreshMessages: false, refreshThreads: true }
  }
  return { preferSessionLogMessages: false, refreshMessages: true, refreshThreads: true }
}

export function shouldInvalidateThreadCollectionForCxSessionFileChange(params: unknown): boolean {
  return getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, params)?.refreshThreads ?? true
}
