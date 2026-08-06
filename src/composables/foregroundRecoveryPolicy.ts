export type ForegroundMessageRecoveryState = {
  hasThread: boolean
  requestedForceRefresh: boolean
  allowRoutineActiveRefresh: boolean
  pendingMessageRefresh: boolean
  unread: boolean
  executionActive: boolean
  executionStale: boolean
  hasLoadedThreadDetail: boolean
  hasPendingServerRequest: boolean
  hasQueuedWork: boolean
  connectionStale: boolean
  recentlySynced: boolean
  forceRefreshDue: boolean
}

export function shouldRefreshForegroundMessages(state: ForegroundMessageRecoveryState): boolean {
  if (!state.hasThread) return false
  if (state.pendingMessageRefresh || state.unread) return true
  if (state.executionStale || !state.hasLoadedThreadDetail) return true
  if (state.hasPendingServerRequest || state.hasQueuedWork) return true
  if (state.connectionStale && !state.recentlySynced) return true
  if (!state.allowRoutineActiveRefresh) return false
  if (state.executionActive) return true
  if (!state.requestedForceRefresh) return false
  return state.forceRefreshDue
}
