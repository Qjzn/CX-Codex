import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path'
import { getSpawnInvocation } from './utils/commandInvocation.js'

export type CommandInvocation = {
  command: string
  args: string[]
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const unique: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || unique.includes(normalized)) continue
    unique.push(normalized)
  }
  return unique
}

function isPathLike(command: string): boolean {
  return command.includes('/') || command.includes('\\') || /^[a-zA-Z]:/.test(command)
}

function isRunnableCommand(command: string, args: string[] = []): boolean {
  if (isPathLike(command) && !existsSync(command)) {
    return false
  }
  return canRunCommand(command, args)
}

function getAbsolutePathCommandCandidates(command: string, pathValue = process.env.PATH): string[] {
  const normalizedCommand = command.trim()
  if (!normalizedCommand) return []
  if (isPathLike(normalizedCommand)) {
    return isAbsolute(normalizedCommand) ? [normalizedCommand] : []
  }
  const fileNames = process.platform === 'win32' && !/\.exe$/iu.test(normalizedCommand)
    ? [`${normalizedCommand}.exe`]
    : [normalizedCommand]
  return uniqueStrings((pathValue ?? '').split(delimiter).flatMap((entry) => {
    const directory = entry.trim().replace(/^"|"$/gu, '')
    if (!directory || !isAbsolute(directory)) return []
    return fileNames.map((fileName) => join(directory, fileName))
  }))
}

function getWindowsAppDataNpmPrefix(): string | null {
  const appData = process.env.APPDATA?.trim()
  return appData ? join(appData, 'npm') : null
}

function getPotentialNpmPrefixes(): string[] {
  return uniqueStrings([
    process.env.npm_config_prefix,
    process.env.PREFIX,
    getUserNpmPrefix(),
    process.platform === 'win32' ? getWindowsAppDataNpmPrefix() : null,
  ])
}

function getPotentialCodexPackageDirs(prefix: string): string[] {
  const dirs = [join(prefix, 'node_modules', '@openai', 'codex')]
  if (process.platform !== 'win32') {
    dirs.push(join(prefix, 'lib', 'node_modules', '@openai', 'codex'))
  }
  return dirs
}

function getPotentialCodexExecutables(prefix: string): string[] {
  return getPotentialCodexPackageDirs(prefix).map((packageDir) => (
    process.platform === 'win32'
      ? join(
          packageDir,
          'node_modules',
          '@openai',
          'codex-win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'codex',
          'codex.exe',
        )
      : join(packageDir, 'bin', 'codex')
  ))
}

function getPotentialRipgrepExecutables(prefix: string): string[] {
  return getPotentialCodexPackageDirs(prefix).map((packageDir) => (
    process.platform === 'win32'
      ? join(
          packageDir,
          'node_modules',
          '@openai',
          'codex-win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'path',
          'rg.exe',
        )
      : join(packageDir, 'bin', 'rg')
  ))
}

export function getWindowsDesktopCodexExecutables(localAppData = process.env.LOCALAPPDATA): string[] {
  const normalizedLocalAppData = localAppData?.trim()
  if (!normalizedLocalAppData) return []

  const binDir = join(normalizedLocalAppData, 'OpenAI', 'Codex', 'bin')
  if (!existsSync(binDir)) return []

  const versionedExecutables: Array<{ path: string; modifiedAtMs: number }> = []
  try {
    for (const entry of readdirSync(binDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const executable = join(binDir, entry.name, 'codex.exe')
      if (!existsSync(executable)) continue
      versionedExecutables.push({
        path: executable,
        modifiedAtMs: statSync(executable).mtimeMs,
      })
    }
  } catch {
    return []
  }

  versionedExecutables.sort((first, second) => second.modifiedAtMs - first.modifiedAtMs)
  const stableExecutable = join(binDir, 'codex.exe')
  return uniqueStrings([
    ...versionedExecutables.map((entry) => entry.path),
    existsSync(stableExecutable) ? stableExecutable : null,
  ])
}

export function canRunCommand(command: string, args: string[] = []): boolean {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    windowsHide: true,
  })
  return !result.error && result.status === 0
}

export function getUserNpmPrefix(): string {
  return join(homedir(), '.npm-global')
}

export function getNpmGlobalBinDir(prefix: string): string {
  return process.platform === 'win32' ? prefix : join(prefix, 'bin')
}

export function prependPathEntry(existingPath: string, entry: string): string {
  const normalizedEntry = entry.trim()
  if (!normalizedEntry) return existingPath

  const parts = existingPath
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean)

  if (parts.includes(normalizedEntry)) {
    return existingPath
  }

  return existingPath ? `${normalizedEntry}${delimiter}${existingPath}` : normalizedEntry
}

export function resolveCodexCommand(): string | null {
  const explicit = process.env.CX_CODEX_CODEX_COMMAND?.trim() || process.env.CODEXUI_CODEX_COMMAND?.trim()
  const packageCandidates = getPotentialNpmPrefixes().flatMap(getPotentialCodexExecutables)
  const desktopCandidates = process.platform === 'win32'
    ? getWindowsDesktopCodexExecutables()
    : []
  const fallbackCandidates = process.platform === 'win32'
    ? [...desktopCandidates, ...packageCandidates, 'codex']
    : ['codex', ...packageCandidates]

  for (const candidate of uniqueStrings([explicit, ...fallbackCandidates])) {
    if (isRunnableCommand(candidate, ['--version'])) {
      return candidate
    }
  }

  return null
}

export function resolveRipgrepCommand(): string | null {
  const explicit = process.env.CX_CODEX_RG_COMMAND?.trim() || process.env.CODEXUI_RG_COMMAND?.trim()
  const packageCandidates = getPotentialNpmPrefixes().flatMap(getPotentialRipgrepExecutables)
  const fallbackCandidates = uniqueStrings([
    ...getAbsolutePathCommandCandidates(explicit ?? ''),
    ...packageCandidates,
    ...getAbsolutePathCommandCandidates('rg'),
  ])

  for (const candidate of fallbackCandidates) {
    if (isRunnableCommand(candidate, ['--version'])) {
      return candidate
    }
  }

  return null
}

export function resolveGitCommand(): string | null {
  const explicit = process.env.CX_CODEX_GIT_COMMAND?.trim()
  const candidates = uniqueStrings([
    ...getAbsolutePathCommandCandidates(explicit ?? ''),
    ...getAbsolutePathCommandCandidates('git'),
  ])
  for (const candidate of candidates) {
    if (isRunnableCommand(candidate, ['--version'])) return candidate
  }
  return null
}

export function resolvePythonCommand(): CommandInvocation | null {
  const candidates: CommandInvocation[] = process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]

  for (const candidate of candidates) {
    if (isRunnableCommand(candidate.command, [...candidate.args, '--version'])) {
      return candidate
    }
  }

  return null
}

export function resolveSkillInstallerScriptPath(codexHome?: string): string | null {
  const normalizedCodexHome = codexHome?.trim()
  const candidates = uniqueStrings([
    normalizedCodexHome
      ? join(normalizedCodexHome, 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py')
      : null,
    process.env.CODEX_HOME?.trim()
      ? join(process.env.CODEX_HOME.trim(), 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py')
      : null,
    join(homedir(), '.codex', 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py'),
    join(homedir(), '.cursor', 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py'),
  ])

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export type CodexLaunchIdentityKind = 'native' | 'launcher' | 'unknown'

export type CodexLaunchIdentity = {
  generation: number
  launchPath: string
  versionRaw: string | null
  sha256: string | null
  identityKind: CodexLaunchIdentityKind
  reason?: string
}

export type CodexLaunchIdentityCore = Omit<CodexLaunchIdentity, 'generation'>

export type CodexVersionProbeResult = {
  status: number | null
  stdout: string
  error: boolean
}

export type CodexVersionProbe = (launchPath: string) => CodexVersionProbeResult

export type CodexLaunchCaptureOptions = {
  platform?: NodeJS.Platform
  pathValue?: string
  cwd?: string
  probeVersion?: CodexVersionProbe
  hashFile?: (launchPath: string) => string | null
}

export const CODEX_LAUNCH_IDENTITY_PROBE_TIMEOUT_MS = 5_000

const LAUNCHER_SCRIPT_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1', '.js', '.mjs', '.cjs', '.sh'])

function defaultCodexVersionProbe(launchPath: string): CodexVersionProbeResult {
  // Same Windows shim semantics and bounded timeout the real launch uses, so a `.cmd`/`.bat`
  // target is probed through cmd.exe exactly as it is spawned.
  const invocation = getSpawnInvocation(launchPath, ['--version'])
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: CODEX_LAUNCH_IDENTITY_PROBE_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
  })
  return {
    status: typeof result.status === 'number' ? result.status : null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    error: Boolean(result.error) || result.signal !== null,
  }
}

export function readCodexLaunchFileSha256(launchPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(launchPath)).digest('hex')
  } catch {
    return null
  }
}

export function getCodexLaunchIdentityKind(launchPath: string): CodexLaunchIdentityKind {
  const extension = extname(launchPath).toLowerCase()
  return LAUNCHER_SCRIPT_EXTENSIONS.has(extension) ? 'launcher' : 'native'
}

/**
 * Freezes the final resolved launch command into an absolute, annotated target and binds the
 * version probe, the file hash and the later launch to that exact target. It never re-resolves
 * and never invents a trustworthy identity: any probe/hash/unresolved failure degrades to
 * `identityKind: 'unknown'` with a null version/SHA and a short reason.
 */
export function captureCodexLaunchIdentity(
  command: string,
  options: CodexLaunchCaptureOptions = {},
): CodexLaunchIdentityCore {
  const cwd = options.cwd ?? process.cwd()
  const normalizedCommand = command.trim()
  const fallbackLaunchPath = isAbsolute(normalizedCommand)
    ? normalizedCommand
    : resolve(cwd, normalizedCommand || 'codex')

  if (!normalizedCommand) {
    return {
      launchPath: fallbackLaunchPath,
      versionRaw: null,
      sha256: null,
      identityKind: 'unknown',
      reason: 'empty-launch-command',
    }
  }

  let launchPath = fallbackLaunchPath
  if (!isPathLike(normalizedCommand)) {
    const pathValue = options.pathValue ?? process.env.PATH
    const absoluteCandidate = getAbsolutePathCommandCandidates(normalizedCommand, pathValue)
      .find((entry) => existsSync(entry))
    if (!absoluteCandidate) {
      return {
        launchPath: fallbackLaunchPath,
        versionRaw: null,
        sha256: null,
        identityKind: 'unknown',
        reason: 'unresolved-launch-path',
      }
    }
    launchPath = absoluteCandidate
  }

  const hashFile = options.hashFile ?? readCodexLaunchFileSha256
  const hashBeforeProbe = hashFile(launchPath)
  const probe = (options.probeVersion ?? defaultCodexVersionProbe)(launchPath)
  const hashAfterProbe = hashFile(launchPath)

  if (hashBeforeProbe === null || hashAfterProbe === null) {
    return { launchPath, versionRaw: null, sha256: null, identityKind: 'unknown', reason: 'hash-failed' }
  }
  if (hashBeforeProbe !== hashAfterProbe) {
    return {
      launchPath,
      versionRaw: null,
      sha256: null,
      identityKind: 'unknown',
      reason: 'identity-changed-during-version-probe',
    }
  }

  const versionRaw = probe.error || probe.status !== 0 ? null : probe.stdout.trim() ? probe.stdout : null
  if (versionRaw === null) {
    return { launchPath, versionRaw: null, sha256: null, identityKind: 'unknown', reason: 'version-probe-failed' }
  }

  return {
    launchPath,
    versionRaw,
    sha256: hashAfterProbe,
    identityKind: getCodexLaunchIdentityKind(launchPath),
  }
}

export function markCodexLaunchIdentityUnknown(
  core: CodexLaunchIdentityCore,
  reason: string,
): CodexLaunchIdentityCore {
  return {
    launchPath: core.launchPath,
    versionRaw: null,
    sha256: null,
    identityKind: 'unknown',
    reason,
  }
}

export function createCodexLaunchIdentity(core: CodexLaunchIdentityCore, generation: number): CodexLaunchIdentity {
  return Object.freeze({
    generation,
    launchPath: core.launchPath,
    versionRaw: core.versionRaw,
    sha256: core.sha256,
    identityKind: core.identityKind,
    ...(core.reason ? { reason: core.reason } : {}),
  })
}

export function copyCodexLaunchIdentity(identity: CodexLaunchIdentity): CodexLaunchIdentity {
  return {
    generation: identity.generation,
    launchPath: identity.launchPath,
    versionRaw: identity.versionRaw,
    sha256: identity.sha256,
    identityKind: identity.identityKind,
    ...(identity.reason ? { reason: identity.reason } : {}),
  }
}
