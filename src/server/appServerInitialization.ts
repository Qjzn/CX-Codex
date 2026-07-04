import type { AppServerClientInfo } from './appServerClientInfo.js'

export type AppServerInitializeCapabilities = {
  experimentalApi: boolean
  optOutNotificationMethods?: string[]
}

export type AppServerInitializeOptions = {
  experimentalApi?: boolean
  optOutNotificationMethods?: unknown
}

export type AppServerInitializeParams = {
  clientInfo: AppServerClientInfo
  capabilities?: AppServerInitializeCapabilities
}

const APP_SERVER_EXPERIMENTAL_API_ENABLED = false

export function createAppServerInitializeParams(
  clientInfo: AppServerClientInfo,
  options: AppServerInitializeOptions = {},
): AppServerInitializeParams {
  const experimentalApi = options.experimentalApi ?? APP_SERVER_EXPERIMENTAL_API_ENABLED
  const optOutNotificationMethods = normalizeOptOutNotificationMethods(options.optOutNotificationMethods)

  if (experimentalApi !== true && optOutNotificationMethods.length === 0) {
    return { clientInfo }
  }

  const capabilities: AppServerInitializeCapabilities = {
    experimentalApi,
  }
  if (optOutNotificationMethods.length > 0) {
    capabilities.optOutNotificationMethods = optOutNotificationMethods
  }

  return { clientInfo, capabilities }
}

function normalizeOptOutNotificationMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}
