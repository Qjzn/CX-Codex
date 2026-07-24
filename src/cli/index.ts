import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Command } from 'commander'
import qrcode from 'qrcode-terminal'
import {
  canRunCommand,
  getNpmGlobalBinDir,
  getUserNpmPrefix,
  prependPathEntry,
  resolveCodexCommand,
} from '../commandResolution.js'
import { resolveLaunchOptions, type LaunchCliOptions } from './config.js'
import { createServer as createApp } from '../server/httpServer.js'
import { generatePassword } from '../server/password.js'
import { RuntimeStore } from '../server/runtimeStore.js'
import {
  ensureVerifiedCloudflared,
  startQuickTunnel,
  stopQuickTunnel,
} from '../server/quickTunnel.js'
import { spawnSyncCommand } from '../utils/commandInvocation.js'

const program = new Command().name('cx-codex').description('CX-Codex Web bridge for Codex app-server')
const __dirname = dirname(fileURLToPath(import.meta.url))
let hasPromptedCloudflaredInstall = false

function logRuntimeError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : ''
  console.error(JSON.stringify({
    atIso: new Date().toISOString(),
    scope,
    level: 'error',
    message,
    stack,
  }))
}

process.on('unhandledRejection', (error) => {
  logRuntimeError('cx-codex-unhandled-rejection', error)
})

process.on('uncaughtExceptionMonitor', (error) => {
  logRuntimeError('cx-codex-uncaught-exception', error)
})

function getBridgeEnv(name: 'CONFIG' | 'CODEX_COMMAND' | 'RG_COMMAND' | 'CLOUDFLARED_COMMAND'): string | undefined {
  return process.env[`CX_CODEX_${name}`]?.trim() || process.env[`CODEXUI_${name}`]?.trim()
}

function setBridgeEnv(name: 'CODEX_COMMAND' | 'RG_COMMAND' | 'CLOUDFLARED_COMMAND', value: string): void {
  process.env[`CX_CODEX_${name}`] = value
  process.env[`CODEXUI_${name}`] = value
}

function getCodexHomePath(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

function getCloudflaredUserBinDir(): string {
  return join(homedir(), '.local', 'bin')
}

function getCloudflaredPromptMarkerPath(): string {
  return join(getCodexHomePath(), '.cloudflared-install-prompted')
}

function hasPromptedCloudflaredInstallPersisted(): boolean {
  return existsSync(getCloudflaredPromptMarkerPath())
}

async function persistCloudflaredInstallPrompted(): Promise<void> {
  const codexHome = getCodexHomePath()
  mkdirSync(codexHome, { recursive: true })
  await writeFile(getCloudflaredPromptMarkerPath(), `${Date.now()}\n`, 'utf8')
}

async function readCliVersion(): Promise<string> {
  try {
    const packageJsonPath = join(__dirname, '..', 'package.json')
    const raw = await readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function isTermuxRuntime(): boolean {
  return Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('/com.termux/'))
}

function runOrFail(command: string, args: string[], label: string): void {
  const result = spawnSyncCommand(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status ?? -1)}`)
  }
}

function runWithStatus(command: string, args: string[]): number {
  const result = spawnSyncCommand(command, args, { stdio: 'inherit' })
  return result.status ?? -1
}

function resolveCloudflaredCommand(): string | null {
  const explicit = getBridgeEnv('CLOUDFLARED_COMMAND')
  const candidates = [
    explicit,
    'cloudflared',
    join(getCloudflaredUserBinDir(), 'cloudflared'),
    join(getCloudflaredUserBinDir(), 'cloudflared.exe'),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (existsSync(candidate) || candidate === 'cloudflared') {
      if (canRunCommand(candidate, ['--version'])) {
        return candidate
      }
    }
  }

  return null
}

async function shouldInstallCloudflaredInteractively(): Promise<boolean> {
  if (hasPromptedCloudflaredInstall || hasPromptedCloudflaredInstallPersisted()) {
    return false
  }
  hasPromptedCloudflaredInstall = true
  await persistCloudflaredInstallPrompted()

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn('\n[cloudflared] cloudflared is missing and terminal is non-interactive, skipping install.')
    return false
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const installDir = getCloudflaredUserBinDir()
    const answer = await prompt.question(`cloudflared is not installed. Install it now to ${installDir}? [y/N] `)
    const normalized = answer.trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes'
  } finally {
    prompt.close()
  }
}

async function resolveCloudflaredForTunnel(): Promise<string | null> {
  const current = resolveCloudflaredCommand()
  if (current) {
    return current
  }

  const installApproved = await shouldInstallCloudflaredInteractively()
  if (!installApproved) {
    return null
  }

  const installed = await ensureVerifiedCloudflared()
  process.env.PATH = prependPathEntry(process.env.PATH ?? '', getCloudflaredUserBinDir())
  return installed.command
}

function hasCodexAuth(): boolean {
  const codexHome = getCodexHomePath()
  return existsSync(join(codexHome, 'auth.json'))
}

function ensureCodexInstalled(): string | null {
  let codexCommand = resolveCodexCommand()
  if (!codexCommand) {
    const installWithFallback = (pkg: string, label: string): void => {
      const status = runWithStatus('npm', ['install', '-g', pkg])
      if (status === 0) {
        return
      }
      if (isTermuxRuntime()) {
        throw new Error(`${label} failed with exit code ${String(status)}`)
      }
      const userPrefix = getUserNpmPrefix()
      console.log(`\nGlobal npm install requires elevated permissions. Retrying with --prefix ${userPrefix}...\n`)
      runOrFail('npm', ['install', '-g', '--prefix', userPrefix, pkg], `${label} (user prefix)`)
      process.env.PATH = prependPathEntry(process.env.PATH ?? '', getNpmGlobalBinDir(userPrefix))
    }

    if (isTermuxRuntime()) {
      console.log('\nCodex CLI not found. Installing Termux-compatible Codex CLI from npm...\n')
      installWithFallback('@mmmbuto/codex-cli-termux', 'Codex CLI install')
      codexCommand = resolveCodexCommand()
      if (!codexCommand) {
        console.log('\nTermux npm package did not expose `codex`. Installing official CLI fallback...\n')
        installWithFallback('@openai/codex', 'Codex CLI fallback install')
      }
    } else {
      console.log('\nCodex CLI not found. Installing official Codex CLI from npm...\n')
      installWithFallback('@openai/codex', 'Codex CLI install')
    }

    codexCommand = resolveCodexCommand()
    if (!codexCommand && !isTermuxRuntime()) {
      // Non-Termux path should resolve after official package install.
      throw new Error('Official Codex CLI install completed but binary is still not available in PATH')
    }
    if (!codexCommand && isTermuxRuntime()) {
      codexCommand = resolveCodexCommand()
    }
    if (!codexCommand) {
      throw new Error('Codex CLI install completed but binary is still not available in PATH')
    }
    console.log('\nCodex CLI installed.\n')
  }
  return codexCommand
}

function resolvePassword(input: string | boolean): string | undefined {
  if (input === false) {
    return undefined
  }
  if (typeof input === 'string') {
    return input
  }
  return generatePassword()
}

function printTermuxKeepAlive(lines: string[]): void {
  if (!isTermuxRuntime()) {
    return
  }
  lines.push('')
  lines.push('  Android/Termux keep-alive:')
  lines.push('  1) Keep this Termux session open (do not swipe it away).')
  lines.push('  2) Disable battery optimization for Termux in Android settings.')
  lines.push('  3) Optional: run `termux-wake-lock` in another shell.')
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? { cmd: 'open', args: [url] }
    : process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
      : { cmd: 'xdg-open', args: [url] }

  const child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function isWildcardBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::'
}

function getAccessibleUrls(host: string, port: number): string[] {
  const trimmedHost = host.trim()
  const normalizedHost = trimmedHost.toLowerCase()
  if (!trimmedHost || isWildcardBindHost(trimmedHost)) {
    const urls = new Set<string>([`http://localhost:${String(port)}`])
    try {
      const interfaces = networkInterfaces()
      for (const entries of Object.values(interfaces)) {
        if (!entries) {
          continue
        }
        for (const entry of entries) {
          if (entry.internal) {
            continue
          }
          if (entry.family === 'IPv4') {
            urls.add(`http://${entry.address}:${String(port)}`)
          }
        }
      }
    } catch {}
    return Array.from(urls)
  }

  if (normalizedHost === 'localhost') {
    return [`http://localhost:${String(port)}`]
  }

  return [`http://${trimmedHost}:${String(port)}`]
}

function getPreferredOpenUrl(host: string, port: number): string {
  const urls = getAccessibleUrls(host, port)
  return urls[0] ?? `http://localhost:${String(port)}`
}

function listenWithFallback(server: ReturnType<typeof createServer>, startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          attempt(port + 1)
          return
        }
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(port)
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    }

    attempt(startPort)
  })
}

function getCodexGlobalStatePath(): string {
  const codexHome = getCodexHomePath()
  return join(codexHome, '.codex-global-state.json')
}

function normalizeUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || next.includes(trimmed)) continue
    next.push(trimmed)
  }
  return next
}

async function persistLaunchProject(projectPath: string): Promise<void> {
  const trimmed = projectPath.trim()
  if (!trimmed) return
  const normalizedPath = isAbsolute(trimmed) ? trimmed : resolve(trimmed)
  const directoryInfo = await stat(normalizedPath)
  if (!directoryInfo.isDirectory()) {
    throw new Error(`Not a directory: ${normalizedPath}`)
  }

  const statePath = getCodexGlobalStatePath()
  let payload: Record<string, unknown> = {}
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>
    }
  } catch {
    payload = {}
  }

  const roots = normalizeUniqueStrings(payload['electron-saved-workspace-roots'])
  const activeRoots = normalizeUniqueStrings(payload['active-workspace-roots'])
  payload['electron-saved-workspace-roots'] = [
    normalizedPath,
    ...roots.filter((value) => value !== normalizedPath),
  ]
  payload['active-workspace-roots'] = [
    normalizedPath,
    ...activeRoots.filter((value) => value !== normalizedPath),
  ]
  await writeFile(statePath, JSON.stringify(payload), 'utf8')
}

async function addProjectOnly(projectPath: string): Promise<void> {
  const trimmed = projectPath.trim()
  if (!trimmed) {
    throw new Error('Missing project path')
  }
  await persistLaunchProject(trimmed)
}

async function startServer(options: {
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
}) {
  if (options.configPath) {
    process.env.CX_CODEX_CONFIG = options.configPath
    process.env.CODEXUI_CONFIG = options.configPath
  }
  const version = await readCliVersion()
  const projectPath = options.projectPath?.trim() ?? ''
  if (projectPath.length > 0) {
    try {
      await persistLaunchProject(projectPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`\n[project] Could not open launch project: ${message}\n`)
    }
  }
  if (options.codexCommand) {
    setBridgeEnv('CODEX_COMMAND', options.codexCommand)
  }
  if (options.ripgrepCommand) {
    setBridgeEnv('RG_COMMAND', options.ripgrepCommand)
  }
  if (options.cloudflaredCommand) {
    setBridgeEnv('CLOUDFLARED_COMMAND', options.cloudflaredCommand)
  }

  const codexCommand = ensureCodexInstalled() ?? resolveCodexCommand()
  if (codexCommand) {
    setBridgeEnv('CODEX_COMMAND', codexCommand)
  }
  if (!hasCodexAuth() && codexCommand) {
    console.log('\nCodex is not logged in. Starting `codex login`...\n')
    runOrFail(codexCommand, ['login'], 'Codex login')
  }

  const host = options.host.trim()
  if (!host) {
    throw new Error('Host must not be empty')
  }
  const requestedPort = parseInt(options.port, 10)
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    throw new Error(`Invalid port: ${options.port}`)
  }
  const password = resolvePassword(options.password)
  if (options.tunnel && !password) {
    throw new Error('Cloudflare Tunnel requires password protection. Remove --no-password and try again.')
  }
  const { app, dispose, attachWebSocket } = createApp({ password })
  const server = createServer(app)
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 0
  server.timeout = 0
  attachWebSocket(server)
  const port = await listenWithFallback(server, requestedPort, host)
  let tunnelUrl: string | null = null
  let resolvedCloudflaredCommand: string | null = null

  if (options.tunnel) {
    try {
      const cloudflaredCommand = await resolveCloudflaredForTunnel()
      if (!cloudflaredCommand) {
        throw new Error('cloudflared is not installed. Install it first, rerun in an interactive terminal to allow auto-install, or set cloudflaredCommand / CX_CODEX_CLOUDFLARED_COMMAND.')
      }
      resolvedCloudflaredCommand = cloudflaredCommand
      const tunnel = await startQuickTunnel({
        localPort: port,
        preferredCommand: cloudflaredCommand,
      })
      resolvedCloudflaredCommand = tunnel.command
      tunnelUrl = tunnel.publicUrl
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`\n[cloudflared] Tunnel not started: ${message}`)
    }
  }

  const lines = [
    '',
    'CX-Codex Web is running!',
    `  Version:  ${version}`,
    '  GitHub:   https://github.com/Qjzn/CX-Codex',
    '',
    `  Bind:     http://${host}:${String(port)}`,
  ]
  const accessUrls = getAccessibleUrls(host, port)
  if (accessUrls.length > 0) {
    lines.push(`  Local:    ${accessUrls[0]}`)
    for (const accessUrl of accessUrls.slice(1)) {
      lines.push(`  Network:  ${accessUrl}`)
    }
  }
  lines.push('  Health:   /health')
  lines.push('  RPC:      /codex-api/rpc')
  if (password) {
    lines.push(`  Pairing:  http://127.0.0.1:${String(port)}/local-setup (local machine only)`)
  }

  if (options.configPath) {
    lines.push(`  Config:   ${options.configPath}`)
  }

  if (port !== requestedPort) {
    lines.push(`  Requested port ${String(requestedPort)} was unavailable; using ${String(port)}.`)
  }

  if (password) {
    lines.push('  Password: enabled (hidden)')
  }
  if (tunnelUrl) {
    lines.push(`  Tunnel:   ${tunnelUrl}`)
    lines.push('  Tunnel QR code below')
  }
  if (resolvedCloudflaredCommand) {
    lines.push(`  cloudflared: ${resolvedCloudflaredCommand}`)
  }

  printTermuxKeepAlive(lines)
  lines.push('')
  console.log(lines.join('\n'))
  if (tunnelUrl) {
    qrcode.generate(tunnelUrl, { small: true })
    console.log('')
  }
  if (options.open) openBrowser(getPreferredOpenUrl(host, port))

  let isShuttingDown = false
  function shutdown() {
    if (isShuttingDown) return
    isShuttingDown = true
    console.log('\nShutting down...')
    void stopQuickTunnel().finally(() => {
      server.close(() => {
        dispose()
        process.exit(0)
      })
    })
    // Force exit after timeout
    setTimeout(() => {
      dispose()
      process.exit(1)
    }, 5000).unref()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function runLogin() {
  const codexCommand = ensureCodexInstalled() ?? 'codex'
  setBridgeEnv('CODEX_COMMAND', codexCommand)
  console.log('\nStarting `codex login`...\n')
  runOrFail(codexCommand, ['login'], 'Codex login')
}

function formatMegabytes(bytes: number): string {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MiB`
}

async function runRuntimeCompact(options: { database?: string }): Promise<void> {
  const databasePath = options.database?.trim()
  const runtimeStore = new RuntimeStore(databasePath ? resolve(databasePath) : undefined)
  try {
    const result = runtimeStore.compact()
    if (result.status === 'skipped-active-requests') {
      throw new Error(`Runtime database still has ${String(result.activeRequestCount)} active request(s). Stop CX-Codex after the task settles, then retry.`)
    }
    console.log([
      'Runtime database compacted.',
      `  Before:    ${formatMegabytes(result.before.databaseBytes)}`,
      `  After:     ${formatMegabytes(result.after.databaseBytes)}`,
      `  Reclaimed: ${formatMegabytes(result.reclaimedBytes)}`,
      `  Duration:  ${String(result.durationMs)} ms`,
    ].join('\n'))
  } finally {
    runtimeStore.close()
  }
}

program
  .argument('[projectPath]', 'project directory to open on launch')
  .option('-c, --config <path>', 'read launch options from a JSON config file')
  .option('--host <host>', 'host/interface to bind', '0.0.0.0')
  .option('--open-project <path>', 'open project directory on launch (Codex desktop parity)')
  .option('-p, --port <port>', 'port to listen on', '5999')
  .option('--password <pass>', 'set a specific password')
  .option('--no-password', 'disable password protection')
  .option('--tunnel', 'start cloudflared tunnel')
  .option('--no-tunnel', 'disable cloudflared tunnel startup')
  .option('--cloudflared-command <path>', 'set explicit cloudflared executable path')
  .option('--open', 'open browser on startup', true)
  .option('--no-open', 'do not open browser on startup')
  .action(async (
    projectPath: string | undefined,
    opts: LaunchCliOptions,
  ) => {
    const rawArgv = process.argv.slice(2)
    const openProjectFlagIndex = rawArgv.findIndex((arg) => arg === '--open-project' || arg.startsWith('--open-project='))
    let openProjectOnly = (opts.openProject ?? '').trim()
    if (!openProjectOnly && openProjectFlagIndex >= 0 && projectPath?.trim()) {
      // Commander may map "--open-project ." to the positional arg in this command layout.
      openProjectOnly = projectPath.trim()
    }
    if (openProjectOnly.length > 0) {
      await addProjectOnly(openProjectOnly)
      console.log(`Added project: ${openProjectOnly}`)
      return
    }

    const launchProject = (projectPath ?? '').trim()
    const resolvedOptions = await resolveLaunchOptions({
      rawArgv,
      cliOptions: opts,
      projectPath: launchProject,
    })
    await startServer(resolvedOptions)
  })

program.command('login').description('Install/check Codex CLI and run `codex login`').action(runLogin)

program
  .command('runtime-compact')
  .description('Compact the runtime replay database while CX-Codex is stopped')
  .option('--database <path>', 'override the runtime database path')
  .action(runRuntimeCompact)

program.command('help').description('Show CX-Codex command help').action(() => {
  program.outputHelp()
})

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nFailed to run CX-Codex: ${message}`)
  process.exit(1)
})
