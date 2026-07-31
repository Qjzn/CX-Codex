export const CX_SESSION_FILES_CHANGED_METHOD = 'cx/session-files/changed'

export function isCxSessionFilesChangedMethod(method: string): boolean {
  return method === CX_SESSION_FILES_CHANGED_METHOD
}
