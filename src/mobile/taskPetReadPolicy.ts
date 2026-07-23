export interface TaskPetThreadViewState {
  routeThreadId: string
  displayedThreadId: string
  messageCount: number
  loading: boolean
  switching: boolean
}

export function shouldAcknowledgeMobileShellTaskPetThreadOpen(
  state: TaskPetThreadViewState,
): boolean {
  const routeThreadId = state.routeThreadId.trim()
  return (
    routeThreadId.length > 0
    && state.displayedThreadId.trim() === routeThreadId
    && state.messageCount > 0
    && !state.loading
    && !state.switching
  )
}

export function shouldMarkMobileShellTaskPetThreadRead(
  state: TaskPetThreadViewState & { inProgress: boolean },
): boolean {
  return !state.inProgress && shouldAcknowledgeMobileShellTaskPetThreadOpen(state)
}
