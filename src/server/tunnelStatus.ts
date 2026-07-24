import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { canRunCommand } from '../commandResolution.js'
import {
  getQuickTunnelSnapshot,
  type QuickTunnelPhase,
  type QuickTunnelVerification,
} from './quickTunnel.js'

export type TunnelStatus = {
  enabled: boolean | null
  active: boolean
  managed: boolean
  temporary: boolean
  phase: QuickTunnelPhase
  networkMode: 'system-dns' | 'scoped-doh'
  publicUrl: string
  configPath: string
  configuredCommand: string
  resolvedCommand: string
  cloudflaredAvailable: boolean
  logPath: string
  lastDetectedAtIso: string
  startedAtIso: string
  errorCode: string
  verification: QuickTunnelVerification
  reason: string
}

export type TunnelConfigUpdate = {
  enabled?: boolean | null
  cloudflaredCommand?: string
}

type LaunchConfigSnapshot = {
  path: string
  tunnel: boolean | null
  cloudflaredCommand: string
}

type LogTunnelSnapshot = {
  publicUrl: string
  cloudflaredCommand: string
}

const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g
const ANY_HTTPS_URL_PATTERN = /https:\/\/[^\s"'`<>()]+/g

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveConfigCandidatePath(configPath: string): string {
  return isAbsolute(configPath) ? configPath : resolve(configPath)
}

function getConfigCandidatePaths(): string[] {
  const candidates = [
    process.env.CX_CODEX_CONFIG?.trim() ?? process.env.CODEXUI_CONFIG?.trim() ?? '',
    join(process.cwd(), 'cx-codex.config.json'),
    join(process.cwd(), 'codexui.config.json'),
    join(homedir(), '.cx-codex', 'config.json'),
    join(homedir(), '.codexui', 'config.json'),
  ]

  const unique: string[] = []
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const resolvedCandidate = resolveConfigCandidatePath(trimmed)
    if (unique.includes(resolvedCandidate)) continue
    unique.push(resolvedCandidate)
  }
  return unique
}

async function readLaunchConfigSnapshot(): Promise<LaunchConfigSnapshot> {
  for (const candidate of getConfigCandidatePaths()) {
    if (!existsSync(candidate)) continue

    try {
      const raw = await readFile(candidate, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const record =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {}

      return {
        path: candidate,
        tunnel: typeof record.tunnel === 'boolean' ? record.tunnel : null,
        cloudflaredCommand: normalizeString(record.cloudflaredCommand),
      }
    } catch {
      return {
        path: candidate,
        tunnel: null,
        cloudflaredCommand: '',
      }
    }
  }

  return {
    path: '',
    tunnel: null,
    cloudflaredCommand: '',
  }
}

function getDefaultConfigWritePath(): string {
  const explicit = process.env.CX_CODEX_CONFIG?.trim() || process.env.CODEXUI_CONFIG?.trim()
  if (explicit) return resolveConfigCandidatePath(explicit)
  return join(homedir(), '.cx-codex', 'config.json')
}

function getCloudflaredUserBinDir(): string {
  return join(homedir(), '.local', 'bin')
}

function resolveCloudflaredCommand(configuredCommand: string): string {
  const candidates = [
    process.env.CX_CODEX_CLOUDFLARED_COMMAND?.trim() ?? process.env.CODEXUI_CLOUDFLARED_COMMAND?.trim() ?? '',
    configuredCommand,
    'cloudflared',
    join(getCloudflaredUserBinDir(), 'cloudflared'),
    join(getCloudflaredUserBinDir(), 'cloudflared.exe'),
  ]

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = candidate.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    if (canRunCommand(normalized, ['--version'])) {
      return normalized
    }
  }

  return ''
}

function getTunnelLogPath(): string {
  return join(homedir(), '.cx-codex', 'logs', 'cx-codex.out.log')
}

function readLatestTunnelSnapshotFromLog(logText: string): LogTunnelSnapshot {
  const bannerIndex = logText.lastIndexOf('Codex Web Local is running!')
  const relevantText = bannerIndex >= 0 ? logText.slice(bannerIndex) : logText
  const tunnelLineMatches = [...relevantText.matchAll(/^\s*Tunnel:\s*(https:\/\/[^\s]+)\s*$/gim)]
  const tunnelLineUrl = tunnelLineMatches.at(-1)?.[1]?.trim() ?? ''
  const tryCloudflareMatches = relevantText.match(TRYCLOUDFLARE_URL_PATTERN)
  const httpsMatches = relevantText.match(ANY_HTTPS_URL_PATTERN)
  const publicUrl =
    tunnelLineUrl
    || tryCloudflareMatches?.at(-1)?.trim()
    || httpsMatches?.find((value) => value.includes('.trycloudflare.com'))?.trim()
    || ''

  const commandMatches = [...relevantText.matchAll(/^\s*cloudflared:\s*(.+)$/gim)]
  const cloudflaredCommand = commandMatches.at(-1)?.[1]?.trim() ?? ''

  return {
    publicUrl,
    cloudflaredCommand,
  }
}

async function readLatestTunnelSnapshotFromLogs(): Promise<{
  logSnapshot: LogTunnelSnapshot
  logPath: string
  lastDetectedAtIso: string
}> {
  const directLogPath = getTunnelLogPath()
  const fallback = {
    logSnapshot: {
      publicUrl: '',
      cloudflaredCommand: '',
    },
    logPath: directLogPath,
    lastDetectedAtIso: '',
  }

  const logDir = dirname(directLogPath)
  try {
    const entries = await readdir(logDir, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.out.log'))
      .map((entry) => join(logDir, entry.name))

    if (candidates.length === 0) {
      if (!existsSync(directLogPath)) return fallback
      const [rawLog, logStat] = await Promise.all([readFile(directLogPath, 'utf8'), stat(directLogPath)])
      return {
        logSnapshot: readLatestTunnelSnapshotFromLog(rawLog),
        logPath: directLogPath,
        lastDetectedAtIso: logStat.mtime.toISOString(),
      }
    }

    const orderedCandidates = await Promise.all(candidates.map(async (candidatePath) => {
      const candidateStat = await stat(candidatePath)
      return {
        path: candidatePath,
        mtimeMs: candidateStat.mtimeMs,
        mtimeIso: candidateStat.mtime.toISOString(),
      }
    }))

    orderedCandidates.sort((first, second) => second.mtimeMs - first.mtimeMs)

    for (const candidate of orderedCandidates) {
      try {
        const rawLog = await readFile(candidate.path, 'utf8')
        const logSnapshot = readLatestTunnelSnapshotFromLog(rawLog)
        if (logSnapshot.publicUrl || logSnapshot.cloudflaredCommand || rawLog.includes('Codex Web Local is running!')) {
          return {
            logSnapshot,
            logPath: candidate.path,
            lastDetectedAtIso: candidate.mtimeIso,
          }
        }
      } catch {
        // Skip unreadable logs and continue with older candidates.
      }
    }

    const latest = orderedCandidates[0]
    return {
      logSnapshot: fallback.logSnapshot,
      logPath: latest.path,
      lastDetectedAtIso: latest.mtimeIso,
    }
  } catch {
    return fallback
  }
}

function buildTunnelReason(payload: {
  enabled: boolean | null
  publicUrl: string
  resolvedCommand: string
  configuredCommand: string
}): string {
  if (payload.enabled === false) {
    return '配置中已关闭 Cloudflare Tunnel。'
  }
  if (payload.publicUrl) {
    return '已从最新启动日志识别到可访问的公网地址。'
  }
  if (payload.resolvedCommand) {
    return payload.enabled === true
      ? '配置已开启 Tunnel，但最近启动日志里还没有生成 trycloudflare 地址。'
      : '已检测到 cloudflared，可在配置中开启 Tunnel 后生成公网地址。'
  }
  if (payload.configuredCommand) {
    return '配置了 cloudflared 路径，但当前机器上无法正常执行。'
  }
  return '尚未检测到可用的 cloudflared，可执行文件或 Tunnel 启动记录。'
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const configSnapshot = await readLaunchConfigSnapshot()
  const { logSnapshot, logPath, lastDetectedAtIso } = await readLatestTunnelSnapshotFromLogs()
  const runtime = getQuickTunnelSnapshot()

  const resolvedCommand = resolveCloudflaredCommand(configSnapshot.cloudflaredCommand)
  const enabled = configSnapshot.tunnel
  const publicUrl = runtime.publicUrl || (enabled === false ? '' : logSnapshot.publicUrl)
  const active = runtime.active

  return {
    enabled,
    active,
    managed: runtime.phase !== 'idle' || runtime.startedAtIso.length > 0,
    temporary: true,
    phase: runtime.phase,
    networkMode: runtime.networkMode,
    publicUrl,
    configPath: configSnapshot.path || getDefaultConfigWritePath(),
    configuredCommand: configSnapshot.cloudflaredCommand,
    resolvedCommand: runtime.command || resolvedCommand || logSnapshot.cloudflaredCommand,
    cloudflaredAvailable: resolvedCommand.length > 0,
    logPath,
    lastDetectedAtIso,
    startedAtIso: runtime.startedAtIso,
    errorCode: runtime.errorCode,
    verification: { ...runtime.verification },
    reason: runtime.phase === 'idle'
      ? buildTunnelReason({
          enabled,
          publicUrl: '',
          resolvedCommand,
          configuredCommand: configSnapshot.cloudflaredCommand,
        })
      : runtime.message,
  }
}

export async function updateTunnelConfig(update: TunnelConfigUpdate): Promise<TunnelStatus> {
  const configSnapshot = await readLaunchConfigSnapshot()
  const targetPath = configSnapshot.path || getDefaultConfigWritePath()

  let nextConfig: Record<string, unknown> = {}
  if (existsSync(targetPath)) {
    try {
      nextConfig = JSON.parse(await readFile(targetPath, 'utf8')) as Record<string, unknown>
    } catch {
      nextConfig = {}
    }
  }

  if (typeof update.enabled === 'boolean') {
    nextConfig.tunnel = update.enabled
  }

  if (typeof update.cloudflaredCommand === 'string') {
    const normalizedCommand = update.cloudflaredCommand.trim()
    if (normalizedCommand) {
      nextConfig.cloudflaredCommand = normalizedCommand
    } else {
      delete nextConfig.cloudflaredCommand
    }
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  return await getTunnelStatus()
}
