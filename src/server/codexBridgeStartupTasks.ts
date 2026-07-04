import type { WebBridgeSettings } from './serverRequestPolicy.js'

export type CodexBridgeStartupTaskDependencies = {
  initializeSkillsSyncOnStartup: () => Promise<void>
  warmupAppServer: () => Promise<void>
  getWebBridgeSettingsPath: () => string
  readWebBridgeSettings: (settingsPath: string) => Promise<WebBridgeSettings>
  setWebBridgeSettings: (settings: WebBridgeSettings) => void
  logError: (message: string, error: unknown) => void
}

export function startCodexBridgeStartupTasks(
  dependencies: CodexBridgeStartupTaskDependencies,
): void {
  void dependencies.initializeSkillsSyncOnStartup()
    .catch((error) => {
      dependencies.logError('Startup skills sync failed', error)
    })

  void dependencies.warmupAppServer()
    .catch((error) => {
      dependencies.logError('App server warmup failed', error)
    })

  void dependencies.readWebBridgeSettings(dependencies.getWebBridgeSettingsPath())
    .then((settings) => {
      dependencies.setWebBridgeSettings(settings)
    })
    .catch((error) => {
      dependencies.logError('Web settings load failed', error)
    })
}
