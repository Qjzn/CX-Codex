import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export type LaunchConfigFile = {
  host?: string
  port?: string
  password?: string | boolean
  tunnel?: boolean
  open?: boolean
  projectPath?: string
  codexCommand?: string
  ripgrepCommand?: string
  cloudflaredCommand?: string
}

export type LaunchCliOptions = {
  config?: string
  host?: string
  port: string
  password?: string | boolean
  tunnel: boolean
  open: boolean
  openProject?: string
  cloudflaredCommand?: string
}

export type ResolvedLaunchOptions = {
  configPath?: string
  host: string
  port: string
  password: string | boolean
  tunnel: boolean
  open: boolean
  projectPath?: string
  codexCommand?: string
  ripgrepCommand?: string
  cloudflaredCommand?: string
}

type LoadedLaunchConfig = {
  path?: string
  config: LaunchConfigFile
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizePort(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return undefined
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizePassword(value: unknown): string | boolean | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'boolean') {
    return value
  }
  return undefined
}

function normalizeConfigShape(raw: unknown): LaunchConfigFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const record = raw as Record<string, unknown>
  return {
    host: normalizeString(record.host),
    port: normalizePort(record.port),
    password: normalizePassword(record.password),
    tunnel: normalizeBoolean(record.tunnel),
    open: normalizeBoolean(record.open),
    projectPath: normalizeString(record.projectPath),
    codexCommand: normalizeString(record.codexCommand),
    ripgrepCommand: normalizeString(record.ripgrepCommand),
    cloudflaredCommand: normalizeString(record.cloudflaredCommand),
  }
}

function resolveCandidatePath(inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(inputPath)
}

function getDefaultConfigCandidates(): string[] {
  return [
    join(process.cwd(), 'cx-codex.config.json'),
    join(process.cwd(), 'codexui.config.json'),
    join(homedir(), '.cx-codex', 'config.json'),
    join(homedir(), '.codexui', 'config.json'),
  ]
}

async function loadConfigFile(configPath: string): Promise<LoadedLaunchConfig> {
  const resolvedPath = resolveCandidatePath(configPath)
  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`)
  }

  const raw = await readFile(resolvedPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON in config file ${resolvedPath}: ${message}`)
  }

  return {
    path: resolvedPath,
    config: normalizeConfigShape(parsed),
  }
}

async function loadLaunchConfig(explicitConfigPath?: string): Promise<LoadedLaunchConfig> {
  const trimmedExplicit = explicitConfigPath?.trim()
  if (trimmedExplicit) {
    return await loadConfigFile(trimmedExplicit)
  }

  const envConfigPath = process.env.CX_CODEX_CONFIG?.trim() || process.env.CODEXUI_CONFIG?.trim()
  if (envConfigPath) {
    return await loadConfigFile(envConfigPath)
  }

  for (const candidate of getDefaultConfigCandidates()) {
    if (!existsSync(candidate)) continue
    return await loadConfigFile(candidate)
  }

  return { config: {} }
}

function flagProvided(rawArgv: string[], longName: string, shortNames: string[] = []): boolean {
  const shortFlags = shortNames.flatMap((name) => [`-${name}`, `-${name}=`])
  return rawArgv.some((arg) => (
    arg === `--${longName}`
    || arg === `--no-${longName}`
    || arg.startsWith(`--${longName}=`)
    || shortFlags.some((shortFlag) => arg === shortFlag || arg.startsWith(shortFlag))
  ))
}

export async function resolveLaunchOptions(args: {
  rawArgv: string[]
  cliOptions: LaunchCliOptions
  projectPath?: string
}): Promise<ResolvedLaunchOptions> {
  const { rawArgv, cliOptions } = args
  const launchProject = args.projectPath?.trim()
  const loaded = await loadLaunchConfig(cliOptions.config)
  const config = loaded.config

  const host = flagProvided(rawArgv, 'host')
    ? normalizeString(cliOptions.host) ?? '0.0.0.0'
    : config.host ?? '0.0.0.0'
  const port = flagProvided(rawArgv, 'port', ['p'])
    ? normalizePort(cliOptions.port) ?? '5999'
    : config.port ?? '5999'

  let password: string | boolean = true
  if (flagProvided(rawArgv, 'password')) {
    password = cliOptions.password ?? true
  } else if (typeof config.password !== 'undefined') {
    password = config.password
  }

  const tunnel = flagProvided(rawArgv, 'tunnel')
    ? cliOptions.tunnel
    : config.tunnel ?? false
  const open = flagProvided(rawArgv, 'open')
    ? cliOptions.open
    : config.open ?? true

  const projectPath = launchProject && launchProject.length > 0
    ? launchProject
    : config.projectPath
  const cloudflaredCommand = flagProvided(rawArgv, 'cloudflared-command')
    ? normalizeString(cliOptions.cloudflaredCommand)
    : config.cloudflaredCommand

  return {
    configPath: loaded.path,
    host,
    port,
    password,
    tunnel,
    open,
    projectPath,
    codexCommand: config.codexCommand,
    ripgrepCommand: config.ripgrepCommand,
    cloudflaredCommand,
  }
}
