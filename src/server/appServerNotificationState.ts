import { readThreadIdFromPayload, readTurnIdFromPayload } from './appServerPayloadIds.js'
import { shouldInvalidateThreadListCacheForNotification } from './appServerRpcCache.js'

export type AppServerNotificationStateDependencies = {
  invalidateThreadListCache(): void
  clearPlanModeTurnByThreadOrTurn(threadId: string, turnId: string): void
  observeThreadTokenUsage(params: unknown): void
}

export type AppServerNotificationStateInput = {
  method: string
  params: unknown
}

export function shouldClearPlanModeTurnForNotification(method: string): boolean {
  return (
    method === 'turn/completed' ||
    method === 'thread/completed' ||
    method === 'turn/interrupted' ||
    method === 'thread/interrupted' ||
    method === 'error' ||
    method.endsWith('/failed')
  )
}

export function captureAppServerNotificationState(
  notification: AppServerNotificationStateInput,
  dependencies: AppServerNotificationStateDependencies,
): void {
  if (shouldInvalidateThreadListCacheForNotification(notification.method)) {
    dependencies.invalidateThreadListCache()
  }

  if (shouldClearPlanModeTurnForNotification(notification.method)) {
    dependencies.clearPlanModeTurnByThreadOrTurn(
      readThreadIdFromPayload(notification.params),
      readTurnIdFromPayload(notification.params),
    )
  }

  if (notification.method === 'thread/tokenUsage/updated') {
    dependencies.observeThreadTokenUsage(notification.params)
  }
}
