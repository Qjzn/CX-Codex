export const CX_SESSION_FILES_CHANGED_METHOD = 'cx/session-files/changed'

export type CxSessionFileChangeSource = 'session-index' | 'session-log'

export type CxSessionFileChangeSyncPolicy = {
  refreshMessages: boolean
  refreshThreads: boolean
}

export function isCxSessionFilesChangedMethod(method: string): boolean {
  return method === CX_SESSION_FILES_CHANGED_METHOD
}

export function readCxSessionFileChangeSource(params: unknown): CxSessionFileChangeSource | '' {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return ''
  const source = (params as { source?: unknown }).source
  return source === 'session-index' || source === 'session-log' ? source : ''
}

export function getCxSessionFileChangeSyncPolicy(
  method: string,
  params: unknown,
): CxSessionFileChangeSyncPolicy | null {
  if (!isCxSessionFilesChangedMethod(method)) return null
  const source = readCxSessionFileChangeSource(params)
  if (source === 'session-log') {
    return { refreshMessages: true, refreshThreads: false }
  }
  if (source === 'session-index') {
    return { refreshMessages: false, refreshThreads: true }
  }
  return { refreshMessages: true, refreshThreads: true }
}

export function shouldInvalidateThreadCollectionForCxSessionFileChange(params: unknown): boolean {
  return getCxSessionFileChangeSyncPolicy(CX_SESSION_FILES_CHANGED_METHOD, params)?.refreshThreads ?? true
}
