export type CodexBridgeSharedState<TAppServer, TMethodCatalog> = {
  appServer: TAppServer
  methodCatalog: TMethodCatalog
}

export type CodexBridgeSharedStateGlobal<TAppServer, TMethodCatalog> = typeof globalThis & {
  [CODEX_BRIDGE_SHARED_STATE_KEY]?: CodexBridgeSharedState<TAppServer, TMethodCatalog>
}

export type CodexBridgeSharedStateDependencies<TAppServer, TMethodCatalog> = {
  createAppServer: () => TAppServer
  createMethodCatalog: () => TMethodCatalog
  globalScope?: CodexBridgeSharedStateGlobal<TAppServer, TMethodCatalog>
}

export const CODEX_BRIDGE_SHARED_STATE_KEY = '__codexRemoteSharedBridge__'

export function getCodexBridgeSharedState<TAppServer, TMethodCatalog>(
  dependencies: CodexBridgeSharedStateDependencies<TAppServer, TMethodCatalog>,
): CodexBridgeSharedState<TAppServer, TMethodCatalog> {
  const globalScope = dependencies.globalScope
    ?? (globalThis as CodexBridgeSharedStateGlobal<TAppServer, TMethodCatalog>)

  const existing = globalScope[CODEX_BRIDGE_SHARED_STATE_KEY]
  if (existing) return existing

  const created = {
    appServer: dependencies.createAppServer(),
    methodCatalog: dependencies.createMethodCatalog(),
  }
  globalScope[CODEX_BRIDGE_SHARED_STATE_KEY] = created
  return created
}
