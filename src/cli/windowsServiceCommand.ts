import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSyncCommand } from '../utils/commandInvocation.js'

export type WindowsServiceAction = 'start' | 'stop' | 'restart' | 'status' | 'enable' | 'disable'

export interface WindowsServiceCliOptions {
  port: string
  config: string
  launcher: string
  taskName?: string
  watchdogTaskName?: string
  json?: boolean
}

interface ServiceCommandError {
  code: 'INVALID_ARGUMENT' | 'UNSUPPORTED_PLATFORM' | 'MISSING_INSTALL_RESOURCE' | 'INTERNAL_ERROR'
  exitCode: 1 | 2 | 3 | 4
  message: string
}

const SERVICE_SCRIPT_NAME = 'manage-windows-service.ps1'
const POWERSHELL_RUNNER_NAME = 'run-powershell-script.mjs'

export function getDefaultWindowsServiceConfigPath(): string {
  return join(homedir(), '.cx-codex', 'config.json')
}

export function getDefaultWindowsServiceLauncherPath(): string {
  return join(homedir(), '.local', 'bin', 'cx-codex-start.cmd')
}

function writeAdapterError(
  action: WindowsServiceAction,
  port: number | null,
  options: WindowsServiceCliOptions,
  error: ServiceCommandError,
  json: boolean,
): void {
  if (json) {
    const taskName = options.taskName?.trim() || (port === null ? null : `CodexUI-${port}`)
    const watchdogTaskName = options.watchdogTaskName?.trim() || (port === null ? null : `CodexUI-${port}-Watchdog`)
    console.log(JSON.stringify({
      ok: false,
      action,
      code: error.code,
      message: error.message,
      port,
      health: { ready: false, url: port === null ? null : `http://127.0.0.1:${port}/health` },
      process: {
        pidMarkerPath: null,
        recordedPid: null,
        recordedPidStale: false,
        managedPids: [],
        listenerPids: [],
        unmanagedListenerPids: [],
      },
      launcher: { path: options.launcher?.trim() || null, exists: false },
      config: { path: options.config?.trim() || null, exists: false },
      startupTask: { name: taskName, exists: false, enabled: false, state: 'Unknown' },
      watchdogTask: { name: watchdogTaskName, exists: false, enabled: false, state: 'Unknown' },
    }))
    return
  }
  console.error(`[${error.code}] ${error.message}`)
}

function fail(
  action: WindowsServiceAction,
  port: number | null,
  options: WindowsServiceCliOptions,
  error: ServiceCommandError,
  json: boolean,
): number {
  writeAdapterError(action, port, options, error, json)
  return error.exitCode
}

function requireNonBlank(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) throw new Error(`${label} must not be empty.`)
  return normalized
}

function resolveServiceScriptsDirectory(): string | null {
  const cliDirectory = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(cliDirectory, '..', 'scripts'),
    resolve(process.cwd(), 'scripts'),
  ]
  for (const scriptsDirectory of [...new Set(candidates)]) {
    const runnerPath = join(scriptsDirectory, POWERSHELL_RUNNER_NAME)
    const serviceScriptPath = join(scriptsDirectory, SERVICE_SCRIPT_NAME)
    if (existsSync(runnerPath) && existsSync(serviceScriptPath)) return scriptsDirectory
  }
  return null
}

export function runWindowsServiceCommand(action: WindowsServiceAction, options: WindowsServiceCliOptions): number {
  const json = options.json === true
  const parsedPort = Number(options.port)
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return fail(action, null, options, {
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
      message: 'Port must be an integer between 1 and 65535.',
    }, json)
  }

  let configPath: string
  let launcherPath: string
  let taskName: string
  let watchdogTaskName: string
  try {
    configPath = resolve(requireNonBlank(options.config, 'Config path'))
    launcherPath = resolve(requireNonBlank(options.launcher, 'Launcher path'))
    taskName = requireNonBlank(options.taskName ?? `CodexUI-${parsedPort}`, 'Task name')
    watchdogTaskName = requireNonBlank(options.watchdogTaskName ?? `CodexUI-${parsedPort}-Watchdog`, 'Watchdog task name')
  } catch (error) {
    return fail(action, parsedPort, options, {
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
      message: error instanceof Error ? error.message : String(error),
    }, json)
  }

  if (process.platform !== 'win32') {
    return fail(action, parsedPort, options, {
      code: 'UNSUPPORTED_PLATFORM',
      exitCode: 3,
      message: 'Windows service management is only available on Windows.',
    }, json)
  }

  const scriptsDirectory = resolveServiceScriptsDirectory()
  if (!scriptsDirectory) {
    return fail(action, parsedPort, options, {
      code: 'MISSING_INSTALL_RESOURCE',
      exitCode: 4,
      message: `Could not locate ${POWERSHELL_RUNNER_NAME} and ${SERVICE_SCRIPT_NAME} in the same scripts directory.`,
    }, json)
  }

  const result = spawnSyncCommand(process.execPath, [
    join(scriptsDirectory, POWERSHELL_RUNNER_NAME),
    join(scriptsDirectory, SERVICE_SCRIPT_NAME),
    '-Action', action,
    '-Port', String(parsedPort),
    '-ConfigPath', configPath,
    '-LauncherPath', launcherPath,
    '-TaskName', taskName,
    '-WatchdogTaskName', watchdogTaskName,
    '-OutputFormat', json ? 'Json' : 'Human',
  ], { stdio: 'inherit', windowsHide: true })

  if (result.error) {
    return fail(action, parsedPort, options, {
      code: 'INTERNAL_ERROR',
      exitCode: 1,
      message: result.error.message,
    }, json)
  }
  return result.status ?? 1
}
