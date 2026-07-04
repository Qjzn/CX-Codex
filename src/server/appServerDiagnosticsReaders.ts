import {
  AppServerHookDiagnosticsCache,
  createAppServerHookDiagnosticsReader,
  type AppServerHookDiagnostics,
} from './appServerHookDiagnostics.js'
import {
  createWindowsSandboxReadinessReader,
  WindowsSandboxReadinessCache,
  type WindowsSandboxReadinessDiagnostics,
} from './windowsSandboxDiagnostics.js'

export type AppServerDiagnosticsReadersDependencies = {
  hookDiagnosticsCache: AppServerHookDiagnosticsCache
  windowsSandboxReadinessCache: WindowsSandboxReadinessCache
  rpc(method: string, params: unknown): Promise<unknown>
  getCwds(): string[]
  isWindows(): boolean
}

export type AppServerDiagnosticsReaders = {
  readAppServerHookDiagnostics(): Promise<AppServerHookDiagnostics>
  readWindowsSandboxReadinessDiagnostics(): Promise<WindowsSandboxReadinessDiagnostics>
}

export function createAppServerDiagnosticsReaders(
  dependencies: AppServerDiagnosticsReadersDependencies,
): AppServerDiagnosticsReaders {
  return {
    readAppServerHookDiagnostics: createAppServerHookDiagnosticsReader({
      cache: dependencies.hookDiagnosticsCache,
      rpc: dependencies.rpc,
      getCwds: dependencies.getCwds,
    }),
    readWindowsSandboxReadinessDiagnostics: createWindowsSandboxReadinessReader({
      cache: dependencies.windowsSandboxReadinessCache,
      rpc: dependencies.rpc,
      isWindows: dependencies.isWindows,
    }),
  }
}
