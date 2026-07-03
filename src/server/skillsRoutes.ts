import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, mkdir, stat, lstat, readlink, symlink, link } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { resolvePythonCommand, resolveSkillInstallerScriptPath } from '../commandResolution.js'
import {
  buildInstalledHubEntries,
  extractSkillDescriptionFromMarkdown,
  fetchSkillsTree,
  getSkillsHubRawFileUrl,
  getSkillsHubRawPathUrl,
  getSkillsHubRepoSlug,
  getSkillsHubSource,
  getSkillsHubSkillPath,
  searchGithubPopularSkills,
  searchSkillsHub,
  type InstalledSkillInfo,
} from './skillsHubService.js'
import {
  getCodexHomeDir,
  getSkillsInstallDir,
  getSkillsSyncStatePath,
} from './codexPaths.js'

type AppServerLike = {
  rpc(method: string, params: unknown): Promise<unknown>
}

type ReadJsonBody = (req: IncomingMessage) => Promise<unknown>

type SkillRouteContext = {
  appServer: AppServerLike
  readJsonBody: ReadJsonBody
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error && payload.message.trim().length > 0) {
    return payload.message
  }
  const record = asRecord(payload)
  if (!record) return fallback
  const error = record.error
  if (typeof error === 'string' && error.length > 0) return error
  const nestedError = asRecord(error)
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.length > 0) {
    return nestedError.message
  }
  return fallback
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function sanitizeRemoteSkillPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized || normalized.split('/').some((part) => part === '..' || part.length === 0)) return ''
  return normalized
}

function sanitizeGithubRepoSlug(value: string): string {
  const normalized = value.trim()
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized) ? normalized : ''
}

function sanitizeGithubRef(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.includes('..')) return ''
  return /^[A-Za-z0-9._/-]{1,120}$/u.test(normalized) ? normalized : ''
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000

async function runCommand(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`Command timed out after ${timeout}ms (${command} ${args.join(' ')})`))
    }, timeout)
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`))
    })
  })
}

async function runCommandWithOutput(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const timeout = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`Command timed out after ${timeout}ms (${command} ${args.join(' ')})`))
    }, timeout)
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`))
    })
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

async function detectUserSkillsDir(appServer: AppServerLike): Promise<string> {
  try {
    const result = (await appServer.rpc('skills/list', {})) as {
      data?: Array<{ skills?: Array<{ scope?: string; path?: string }> }>
    }
    for (const entry of result.data ?? []) {
      for (const skill of entry.skills ?? []) {
        if (skill.scope !== 'user' || !skill.path) continue
        const parts = skill.path.split('/').filter(Boolean)
        if (parts.length < 2) continue
        return `/${parts.slice(0, -2).join('/')}`
      }
    }
  } catch {}
  return getSkillsInstallDir()
}

async function ensureInstalledSkillIsValid(appServer: AppServerLike, skillPath: string): Promise<void> {
  const result = (await appServer.rpc('skills/list', { forceReload: true })) as {
    data?: Array<{ errors?: Array<{ path?: string; message?: string }> }>
  }
  const normalized = skillPath.endsWith('/SKILL.md') ? skillPath : `${skillPath}/SKILL.md`
  for (const entry of result.data ?? []) {
    for (const error of entry.errors ?? []) {
      if (error.path === normalized) {
        throw new Error(error.message || 'Installed skill is invalid')
      }
    }
  }
}

type SyncedSkill = { owner?: string; name: string; enabled: boolean }

type SkillsSyncState = {
  githubToken?: string
  githubUsername?: string
  repoOwner?: string
  repoName?: string
  installedOwners?: Record<string, string>
  lastPullCommitSha?: string
  lastPushCommitSha?: string
  lastSyncAttemptCount?: number
  lastSyncError?: string
  lastSyncAtIso?: string
}

type GithubDeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type GithubTokenResponse = { access_token?: string; error?: string }

const GITHUB_DEVICE_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const DEFAULT_SKILLS_SYNC_REPO_NAME = 'codexskills'
const SKILLS_SYNC_MANIFEST_PATH = 'installed-skills.json'
const SYNC_UPSTREAM_SKILLS_OWNER = 'OpenClawAndroid'
const SYNC_UPSTREAM_SKILLS_REPO = 'skills'
const PRIVATE_SYNC_BRANCH = 'main'
const PUBLIC_UPSTREAM_BRANCH_ANDROID = 'android'
const PUBLIC_UPSTREAM_BRANCH_DEFAULT = 'main'
let startupSkillsSyncInitialized = false

type StartupSyncStatus = {
  inProgress: boolean
  mode: 'unauthenticated-bootstrap' | 'authenticated-fork-sync' | 'idle'
  branch: string
  lastAction: string
  lastRunAtIso: string
  lastSuccessAtIso: string
  lastError: string
}

const startupSyncStatus: StartupSyncStatus = {
  inProgress: false,
  mode: 'idle',
  branch: PRIVATE_SYNC_BRANCH,
  lastAction: 'not-started',
  lastRunAtIso: '',
  lastSuccessAtIso: '',
  lastError: '',
}

async function scanInstalledSkillsFromDisk(): Promise<Map<string, InstalledSkillInfo>> {
  const map = new Map<string, InstalledSkillInfo>()
  const skillsDir = getSkillsInstallDir()
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMd = join(skillsDir, entry.name, 'SKILL.md')
      try {
        await stat(skillMd)
        map.set(entry.name, { name: entry.name, path: skillMd, enabled: true })
      } catch {}
    }
  } catch {}
  return map
}

async function readSkillsSyncState(): Promise<SkillsSyncState> {
  try {
    const raw = await readFile(getSkillsSyncStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as SkillsSyncState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeSkillsSyncState(state: SkillsSyncState): Promise<void> {
  await writeFile(getSkillsSyncStatePath(), JSON.stringify(state), 'utf8')
}

async function getGithubJson<T>(url: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codex-web-local',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GitHub API ${method} ${url} failed (${resp.status}): ${text}`)
  }
  return await resp.json() as T
}

async function startGithubDeviceLogin(): Promise<GithubDeviceCodeResponse> {
  const resp = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'codex-web-local',
    },
    body: new URLSearchParams({
      client_id: GITHUB_DEVICE_CLIENT_ID,
      scope: 'repo read:user',
    }),
  })
  if (!resp.ok) {
    throw new Error(`GitHub device flow init failed (${resp.status})`)
  }
  return await resp.json() as GithubDeviceCodeResponse
}

async function completeGithubDeviceLogin(deviceCode: string): Promise<{ token: string | null; error: string | null }> {
  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'codex-web-local',
    },
    body: new URLSearchParams({
      client_id: GITHUB_DEVICE_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  if (!resp.ok) {
    throw new Error(`GitHub token exchange failed (${resp.status})`)
  }
  const payload = await resp.json() as GithubTokenResponse
  if (!payload.access_token) return { token: null, error: payload.error || 'unknown_error' }
  return { token: payload.access_token, error: null }
}

function isAndroidLikeRuntime(): boolean {
  if (process.platform === 'android') return true
  if (existsSync('/data/data/com.termux')) return true
  if (process.env.TERMUX_VERSION) return true
  const prefix = process.env.PREFIX?.toLowerCase() ?? ''
  if (prefix.includes('/com.termux/')) return true
  const proot = process.env.PROOT_TMP_DIR?.toLowerCase() ?? ''
  return proot.length > 0
}

function getPreferredPublicUpstreamBranch(): string {
  return isAndroidLikeRuntime() ? PUBLIC_UPSTREAM_BRANCH_ANDROID : PUBLIC_UPSTREAM_BRANCH_DEFAULT
}

function isUpstreamSkillsRepo(repoOwner: string, repoName: string): boolean {
  return repoOwner.toLowerCase() === SYNC_UPSTREAM_SKILLS_OWNER.toLowerCase()
    && repoName.toLowerCase() === SYNC_UPSTREAM_SKILLS_REPO.toLowerCase()
}

async function resolveGithubUsername(token: string): Promise<string> {
  const user = await getGithubJson<{ login: string }>('https://api.github.com/user', token)
  return user.login
}

async function ensurePrivateForkFromUpstream(token: string, username: string, repoName: string): Promise<void> {
  const repoUrl = `https://api.github.com/repos/${username}/${repoName}`
  let created = false
  const existing = await fetch(repoUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codex-web-local',
    },
  })
  if (existing.ok) {
    const details = await existing.json() as { private?: boolean }
    if (details.private === true) return
    await getGithubJson(repoUrl, token, 'PATCH', { private: true })
    return
  }
  if (existing.status !== 404) {
    throw new Error(`Failed to check personal repo existence (${existing.status})`)
  }

  await getGithubJson(
    'https://api.github.com/user/repos',
    token,
    'POST',
    { name: repoName, private: true, auto_init: false, description: 'Codex skills private mirror sync' },
  )
  created = true

  let ready = false
  for (let i = 0; i < 20; i++) {
    const check = await fetch(repoUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codex-web-local',
      },
    })
    if (check.ok) {
      ready = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (!ready) throw new Error('Private mirror repo was created but is not available yet')
  if (!created) return

  const tmp = await mkdtemp(join(tmpdir(), 'codex-skills-seed-'))
  try {
    const upstreamUrl = `https://github.com/${SYNC_UPSTREAM_SKILLS_OWNER}/${SYNC_UPSTREAM_SKILLS_REPO}.git`
    const branch = PRIVATE_SYNC_BRANCH
    try {
      await runCommand('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, upstreamUrl, tmp])
    } catch {
      await runCommand('git', ['clone', '--depth', '1', upstreamUrl, tmp])
    }
    const privateRemote = toGitHubTokenRemote(username, repoName, token)
    await runCommand('git', ['remote', 'set-url', 'origin', privateRemote], { cwd: tmp })
    try { await runCommand('git', ['checkout', '-B', branch], { cwd: tmp }) } catch {}
    await runCommand('git', ['push', '-u', 'origin', `HEAD:${branch}`], { cwd: tmp })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function readRemoteSkillsManifest(token: string, repoOwner: string, repoName: string): Promise<SyncedSkill[]> {
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${SKILLS_SYNC_MANIFEST_PATH}`
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codex-web-local',
    },
  })
  if (resp.status === 404) return []
  if (!resp.ok) throw new Error(`Failed to read remote manifest (${resp.status})`)
  const payload = await resp.json() as { content?: string }
  const content = payload.content ? Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8') : '[]'
  const parsed = JSON.parse(content) as unknown
  if (!Array.isArray(parsed)) return []
  const skills: SyncedSkill[] = []
  for (const row of parsed) {
    const item = asRecord(row)
    const owner = typeof item?.owner === 'string' ? item.owner : ''
    const name = typeof item?.name === 'string' ? item.name : ''
    if (!name) continue
    skills.push({ ...(owner ? { owner } : {}), name, enabled: item?.enabled !== false })
  }
  return skills
}

async function writeRemoteSkillsManifest(token: string, repoOwner: string, repoName: string, skills: SyncedSkill[]): Promise<void> {
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${SKILLS_SYNC_MANIFEST_PATH}`
  let sha = ''
  const existing = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'codex-web-local',
    },
  })
  if (existing.ok) {
    const payload = await existing.json() as { sha?: string }
    sha = payload.sha ?? ''
  }
  const content = Buffer.from(JSON.stringify(skills, null, 2), 'utf8').toString('base64')
  await getGithubJson(url, token, 'PUT', {
    message: 'Update synced skills manifest',
    content,
    ...(sha ? { sha } : {}),
  })
}

function toGitHubTokenRemote(repoOwner: string, repoName: string, token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoOwner}/${repoName}.git`
}

async function ensureSkillsWorkingTreeRepo(repoUrl: string, branch: string): Promise<string> {
  const localDir = getSkillsInstallDir()
  await mkdir(localDir, { recursive: true })
  const gitDir = join(localDir, '.git')
  let hasGitDir = false
  try { hasGitDir = (await stat(gitDir)).isDirectory() } catch { hasGitDir = false }

  if (!hasGitDir) {
    await runCommand('git', ['init'], { cwd: localDir })
    await runCommand('git', ['config', 'user.email', 'skills-sync@local'], { cwd: localDir })
    await runCommand('git', ['config', 'user.name', 'Skills Sync'], { cwd: localDir })
    await runCommand('git', ['add', '-A'], { cwd: localDir })
    try { await runCommand('git', ['commit', '-m', 'Local skills snapshot before sync'], { cwd: localDir }) } catch {}
    await runCommand('git', ['branch', '-M', branch], { cwd: localDir })
    try { await runCommand('git', ['remote', 'add', 'origin', repoUrl], { cwd: localDir }) } catch {
      await runCommand('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: localDir })
    }
    await runCommand('git', ['fetch', 'origin'], { cwd: localDir })
    try {
      await runCommand('git', ['merge', '--allow-unrelated-histories', '--no-edit', `origin/${branch}`], { cwd: localDir })
    } catch {}
    return localDir
  }

  await runCommand('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: localDir })
  await runCommand('git', ['fetch', 'origin'], { cwd: localDir })
  await resolveMergeConflictsByNewerCommit(localDir, branch)
  try {
    await runCommand('git', ['checkout', branch], { cwd: localDir })
  } catch {
    await resolveMergeConflictsByNewerCommit(localDir, branch)
    await runCommand('git', ['checkout', '-B', branch], { cwd: localDir })
  }
  await resolveMergeConflictsByNewerCommit(localDir, branch)
  const localMtimesBeforePull = await snapshotFileMtimes(localDir)
  try { await runCommand('git', ['stash', 'push', '--include-untracked', '-m', 'codex-skills-autostash'], { cwd: localDir }) } catch {}
  let pulledMtimes = new Map<string, number>()
  try {
    await runCommand('git', ['pull', '--no-rebase', '--no-ff', 'origin', branch], { cwd: localDir })
    pulledMtimes = await snapshotFileMtimes(localDir)
  } catch {
    await resolveMergeConflictsByNewerCommit(localDir, branch)
    pulledMtimes = await snapshotFileMtimes(localDir)
  }
  try {
    await runCommand('git', ['stash', 'pop'], { cwd: localDir })
  } catch {
    await resolveStashPopConflictsByFileTime(localDir, localMtimesBeforePull, pulledMtimes)
  }
  return localDir
}

async function resolveMergeConflictsByNewerCommit(repoDir: string, branch: string): Promise<void> {
  const unmerged = (await runCommandWithOutput('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir }))
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  if (unmerged.length === 0) return
  for (const path of unmerged) {
    const oursTime = await getCommitTime(repoDir, 'HEAD', path)
    const theirsTime = await getCommitTime(repoDir, `origin/${branch}`, path)
    if (theirsTime > oursTime) {
      await runCommand('git', ['checkout', '--theirs', '--', path], { cwd: repoDir })
    } else {
      await runCommand('git', ['checkout', '--ours', '--', path], { cwd: repoDir })
    }
    await runCommand('git', ['add', '--', path], { cwd: repoDir })
  }
  const mergeHead = (await runCommandWithOutput('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: repoDir })).trim()
  if (mergeHead) {
    await runCommand('git', ['commit', '-m', 'Auto-resolve skills merge by newer file'], { cwd: repoDir })
  }
}

async function getCommitTime(repoDir: string, ref: string, path: string): Promise<number> {
  try {
    const output = (await runCommandWithOutput('git', ['log', '-1', '--format=%ct', ref, '--', path], { cwd: repoDir })).trim()
    return output ? Number.parseInt(output, 10) : 0
  } catch {
    return 0
  }
}

async function resolveStashPopConflictsByFileTime(
  repoDir: string,
  localMtimesBeforePull: Map<string, number>,
  pulledMtimes: Map<string, number>,
): Promise<void> {
  const unmerged = (await runCommandWithOutput('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir }))
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  if (unmerged.length === 0) return
  for (const path of unmerged) {
    const localMtime = localMtimesBeforePull.get(path) ?? 0
    const pulledMtime = pulledMtimes.get(path) ?? 0
    const side = localMtime >= pulledMtime ? '--theirs' : '--ours'
    await runCommand('git', ['checkout', side, '--', path], { cwd: repoDir })
    await runCommand('git', ['add', '--', path], { cwd: repoDir })
  }
  const mergeHead = (await runCommandWithOutput('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: repoDir })).trim()
  if (mergeHead) {
    await runCommand('git', ['commit', '-m', 'Auto-resolve stash-pop conflicts by file time'], { cwd: repoDir })
  }
}

async function snapshotFileMtimes(dir: string): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>()
  await walkFileMtimes(dir, dir, mtimes)
  return mtimes
}

async function walkFileMtimes(rootDir: string, currentDir: string, out: Map<string, number>): Promise<void> {
  let entries: Array<{ name: string | Buffer; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = (await readdir(currentDir, { withFileTypes: true })) as Array<{ name: string | Buffer; isDirectory: () => boolean; isFile: () => boolean }>
  } catch {
    return
  }
  for (const entry of entries) {
    const entryName = String(entry.name)
    if (entryName === '.git') continue
    const absolutePath = join(currentDir, entryName)
    const relativePath = absolutePath.slice(rootDir.length + 1)
    if (entry.isDirectory()) {
      await walkFileMtimes(rootDir, absolutePath, out)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const info = await stat(absolutePath)
      out.set(relativePath, info.mtimeMs)
    } catch {}
  }
}

async function syncInstalledSkillsFolderToRepo(
  token: string,
  repoOwner: string,
  repoName: string,
  _installedMap: Map<string, InstalledSkillInfo>,
): Promise<void> {
  function isNonFastForwardPushError(error: unknown): boolean {
    const text = getErrorMessage(error, '').toLowerCase()
    return text.includes('non-fast-forward')
      || text.includes('fetch first')
      || (text.includes('rejected') && text.includes('push'))
  }

  async function pushWithNonFastForwardRetry(repoDir: string, branch: string): Promise<void> {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await runCommand('git', ['fetch', 'origin'], { cwd: repoDir })
      let hasLatestRemote = false
      try {
        await runCommand('git', ['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD'], { cwd: repoDir })
        hasLatestRemote = true
      } catch {
        hasLatestRemote = false
      }
      if (!hasLatestRemote) {
        try {
          await runCommand('git', ['pull', '--no-rebase', '--no-ff', 'origin', branch], { cwd: repoDir })
        } catch {
          await resolveMergeConflictsByNewerCommit(repoDir, branch)
        }
        await runCommand('git', ['add', '.'], { cwd: repoDir })
        const statusAfterReconcile = (await runCommandWithOutput('git', ['status', '--porcelain'], { cwd: repoDir })).trim()
        if (statusAfterReconcile) {
          await runCommand('git', ['commit', '-m', 'Reconcile skills sync before push retry'], { cwd: repoDir })
        }
      }
      try {
        await runCommand('git', ['push', 'origin', `HEAD:${branch}`], { cwd: repoDir })
        const state = await readSkillsSyncState()
        const pushedHead = await runCommandWithOutput('git', ['rev-parse', 'HEAD'], { cwd: repoDir })
        await writeSkillsSyncState({
          ...state,
          lastPushCommitSha: pushedHead.trim(),
          lastSyncAttemptCount: attempt,
          lastSyncError: '',
          lastSyncAtIso: new Date().toISOString(),
        })
        return
      } catch (error) {
        if (!isNonFastForwardPushError(error) || attempt >= maxAttempts) {
          const state = await readSkillsSyncState()
          await writeSkillsSyncState({
            ...state,
            lastSyncAttemptCount: attempt,
            lastSyncError: getErrorMessage(error, 'push failed'),
            lastSyncAtIso: new Date().toISOString(),
          })
          throw error
        }
      }
    }
    throw new Error('Failed to push after non-fast-forward retries')
  }

  const remoteUrl = toGitHubTokenRemote(repoOwner, repoName, token)
  const branch = PRIVATE_SYNC_BRANCH
  const repoDir = await ensureSkillsWorkingTreeRepo(remoteUrl, branch)
  void _installedMap
  await runCommand('git', ['config', 'user.email', 'skills-sync@local'], { cwd: repoDir })
  await runCommand('git', ['config', 'user.name', 'Skills Sync'], { cwd: repoDir })
  await runCommand('git', ['add', '.'], { cwd: repoDir })
  const status = (await runCommandWithOutput('git', ['status', '--porcelain'], { cwd: repoDir })).trim()
  if (!status) {
    const state = await readSkillsSyncState()
    await writeSkillsSyncState({
      ...state,
      lastSyncAttemptCount: 1,
      lastSyncError: '',
      lastSyncAtIso: new Date().toISOString(),
    })
    return
  }
  await runCommand('git', ['commit', '-m', 'Sync installed skills folder and manifest'], { cwd: repoDir })
  await pushWithNonFastForwardRetry(repoDir, branch)
}

async function pullInstalledSkillsFolderFromRepo(token: string, repoOwner: string, repoName: string): Promise<void> {
  const remoteUrl = toGitHubTokenRemote(repoOwner, repoName, token)
  const branch = PRIVATE_SYNC_BRANCH
  await ensureSkillsWorkingTreeRepo(remoteUrl, branch)
}

async function bootstrapSkillsFromUpstreamIntoLocal(): Promise<void> {
  const repoUrl = `https://github.com/${SYNC_UPSTREAM_SKILLS_OWNER}/${SYNC_UPSTREAM_SKILLS_REPO}.git`
  const branch = getPreferredPublicUpstreamBranch()
  await ensureSkillsWorkingTreeRepo(repoUrl, branch)
}

async function collectLocalSyncedSkills(appServer: AppServerLike): Promise<SyncedSkill[]> {
  const state = await readSkillsSyncState()
  const owners = { ...(state.installedOwners ?? {}) }
  const tree = await fetchSkillsTree()
  const uniqueOwnerByName = new Map<string, string>()
  const ambiguousNames = new Set<string>()
  for (const entry of tree) {
    if (ambiguousNames.has(entry.name)) continue
    const existingOwner = uniqueOwnerByName.get(entry.name)
    if (!existingOwner) {
      uniqueOwnerByName.set(entry.name, entry.owner)
      continue
    }
    if (existingOwner !== entry.owner) {
      uniqueOwnerByName.delete(entry.name)
      ambiguousNames.add(entry.name)
    }
  }

  const skills = (await appServer.rpc('skills/list', {})) as { data?: Array<{ skills?: Array<{ name?: string; enabled?: boolean }> }> }
  const seen = new Set<string>()
  const synced: SyncedSkill[] = []
  let ownersChanged = false
  for (const entry of skills.data ?? []) {
    for (const skill of entry.skills ?? []) {
      const name = typeof skill.name === 'string' ? skill.name : ''
      if (!name || seen.has(name)) continue
      seen.add(name)
      let owner = owners[name]
      if (!owner) {
        owner = uniqueOwnerByName.get(name) ?? ''
        if (owner) {
          owners[name] = owner
          ownersChanged = true
        }
      }
      synced.push({ ...(owner ? { owner } : {}), name, enabled: skill.enabled !== false })
    }
  }
  if (ownersChanged) {
    await writeSkillsSyncState({ ...state, installedOwners: owners })
  }
  synced.sort((a, b) => `${a.owner ?? ''}/${a.name}`.localeCompare(`${b.owner ?? ''}/${b.name}`))
  return synced
}

async function autoPushSyncedSkills(appServer: AppServerLike): Promise<void> {
  const state = await readSkillsSyncState()
  if (!state.githubToken || !state.repoOwner || !state.repoName) return
  if (isUpstreamSkillsRepo(state.repoOwner, state.repoName)) {
    throw new Error('Refusing to push to upstream skills repository')
  }
  const local = await collectLocalSyncedSkills(appServer)
  const installedMap = await scanInstalledSkillsFromDisk()
  await writeRemoteSkillsManifest(state.githubToken, state.repoOwner, state.repoName, local)
  await syncInstalledSkillsFolderToRepo(state.githubToken, state.repoOwner, state.repoName, installedMap)
}

async function ensureCodexAgentsSymlinkToSkillsAgents(): Promise<void> {
  const codexHomeDir = getCodexHomeDir()
  const skillsAgentsPath = join(codexHomeDir, 'skills', 'AGENTS.md')
  const codexAgentsPath = join(codexHomeDir, 'AGENTS.md')
  await mkdir(join(codexHomeDir, 'skills'), { recursive: true })
  let copiedFromCodex = false
  try {
    const codexAgentsStat = await lstat(codexAgentsPath)
    if (codexAgentsStat.isFile() || codexAgentsStat.isSymbolicLink()) {
      const content = await readFile(codexAgentsPath, 'utf8')
      await writeFile(skillsAgentsPath, content, 'utf8')
      copiedFromCodex = true
    } else {
      await rm(codexAgentsPath, { force: true, recursive: true })
    }
  } catch {}
  if (!copiedFromCodex) {
    try {
      const skillsAgentsStat = await stat(skillsAgentsPath)
      if (!skillsAgentsStat.isFile()) {
        await rm(skillsAgentsPath, { force: true, recursive: true })
        await writeFile(skillsAgentsPath, '', 'utf8')
      }
    } catch {
      await writeFile(skillsAgentsPath, '', 'utf8')
    }
  }
  const relativeTarget = join('skills', 'AGENTS.md')
  try {
    const current = await lstat(codexAgentsPath)
    if (current.isSymbolicLink()) {
      const existingTarget = await readlink(codexAgentsPath)
      if (existingTarget === relativeTarget) return
    }
    await rm(codexAgentsPath, { force: true, recursive: true })
  } catch {}
  try {
    await symlink(relativeTarget, codexAgentsPath)
    return
  } catch {}
  try {
    await rm(codexAgentsPath, { force: true, recursive: true })
  } catch {}
  try {
    // Hard links work on Windows without Developer Mode and still keep both paths in sync.
    await link(skillsAgentsPath, codexAgentsPath)
    return
  } catch {}
  const skillsAgentsContent = await readFile(skillsAgentsPath, 'utf8')
  await writeFile(codexAgentsPath, skillsAgentsContent, 'utf8')
}

async function runSkillsSyncStartup(appServer: AppServerLike): Promise<void> {
  if (startupSyncStatus.inProgress) return
  startupSyncStatus.inProgress = true
  startupSyncStatus.lastRunAtIso = new Date().toISOString()
  startupSyncStatus.lastError = ''
  startupSyncStatus.branch = PRIVATE_SYNC_BRANCH
  try {
    const state = await readSkillsSyncState()
    if (!state.githubToken) {
      await ensureCodexAgentsSymlinkToSkillsAgents()
      if (!isAndroidLikeRuntime()) {
        startupSyncStatus.mode = 'idle'
        startupSyncStatus.lastAction = 'skip-upstream-non-android'
        startupSyncStatus.lastSuccessAtIso = new Date().toISOString()
        return
      }
      startupSyncStatus.mode = 'unauthenticated-bootstrap'
      startupSyncStatus.branch = getPreferredPublicUpstreamBranch()
      startupSyncStatus.lastAction = 'pull-upstream'
      await bootstrapSkillsFromUpstreamIntoLocal()
      try { await appServer.rpc('skills/list', { forceReload: true }) } catch {}
      startupSyncStatus.lastSuccessAtIso = new Date().toISOString()
      startupSyncStatus.lastAction = 'pull-upstream-complete'
      return
    }
    startupSyncStatus.mode = 'authenticated-fork-sync'
    startupSyncStatus.branch = PRIVATE_SYNC_BRANCH
    startupSyncStatus.lastAction = 'ensure-private-fork'
    const username = state.githubUsername || await resolveGithubUsername(state.githubToken)
    const repoName = DEFAULT_SKILLS_SYNC_REPO_NAME
    await ensurePrivateForkFromUpstream(state.githubToken, username, repoName)
    await writeSkillsSyncState({ ...state, githubUsername: username, repoOwner: username, repoName })
    startupSyncStatus.lastAction = 'pull-private-fork'
    await pullInstalledSkillsFolderFromRepo(state.githubToken, username, repoName)
    try { await appServer.rpc('skills/list', { forceReload: true }) } catch {}
    startupSyncStatus.lastAction = 'push-private-fork'
    await autoPushSyncedSkills(appServer)
    startupSyncStatus.lastSuccessAtIso = new Date().toISOString()
    startupSyncStatus.lastAction = 'startup-sync-complete'
  } catch (error) {
    startupSyncStatus.lastError = getErrorMessage(error, 'startup-sync-failed')
    startupSyncStatus.lastAction = 'startup-sync-failed'
  } finally {
    startupSyncStatus.inProgress = false
  }
}

export async function initializeSkillsSyncOnStartup(appServer: AppServerLike): Promise<void> {
  if (startupSkillsSyncInitialized) return
  startupSkillsSyncInitialized = true
  await runSkillsSyncStartup(appServer)
}

async function finalizeGithubLoginAndSync(token: string, username: string, appServer: AppServerLike): Promise<void> {
  const repoName = DEFAULT_SKILLS_SYNC_REPO_NAME
  await ensurePrivateForkFromUpstream(token, username, repoName)
  const current = await readSkillsSyncState()
  await writeSkillsSyncState({ ...current, githubToken: token, githubUsername: username, repoOwner: username, repoName })
  await pullInstalledSkillsFolderFromRepo(token, username, repoName)
  try { await appServer.rpc('skills/list', { forceReload: true }) } catch {}
  await autoPushSyncedSkills(appServer)
}

export async function handleSkillsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: SkillRouteContext,
): Promise<boolean> {
  const { appServer, readJsonBody } = context
  if (req.method === 'GET' && url.pathname === '/codex-api/skills-hub') {
    try {
      const q = url.searchParams.get('q') || ''
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200)
      const sort = url.searchParams.get('sort') || 'date'
      const allEntries = await fetchSkillsTree()

      const installedMap = await scanInstalledSkillsFromDisk()
      try {
        const result = (await appServer.rpc('skills/list', {})) as { data?: Array<{ skills?: Array<{ name?: string; path?: string; enabled?: boolean }> }> }
        for (const entry of result.data ?? []) {
          for (const skill of entry.skills ?? []) {
            if (skill.name) {
              installedMap.set(skill.name, { name: skill.name, path: skill.path ?? '', enabled: skill.enabled !== false })
            }
          }
        }
      } catch {}

      const installed = await buildInstalledHubEntries(allEntries, installedMap)
      const results = await searchSkillsHub(allEntries, q, limit, sort, installedMap)
      setJson(res, 200, { data: results, installed, total: allEntries.length })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to fetch skills hub') })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/skills-hub/github-search') {
    try {
      const q = url.searchParams.get('q') || ''
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 1), 100)
      const installedMap = await scanInstalledSkillsFromDisk()
      try {
        const result = (await appServer.rpc('skills/list', {})) as { data?: Array<{ skills?: Array<{ name?: string; path?: string; enabled?: boolean }> }> }
        for (const entry of result.data ?? []) {
          for (const skill of entry.skills ?? []) {
            if (skill.name) {
              installedMap.set(skill.name, { name: skill.name, path: skill.path ?? '', enabled: skill.enabled !== false })
            }
          }
        }
      } catch {}
      const results = await searchGithubPopularSkills(q, limit, installedMap)
      setJson(res, 200, { data: results.data, installed: [], total: results.total })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to search GitHub skills') })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/skills-sync/status') {
    const state = await readSkillsSyncState()
    setJson(res, 200, {
      data: {
        loggedIn: Boolean(state.githubToken),
        githubUsername: state.githubUsername ?? '',
        repoOwner: state.repoOwner ?? '',
        repoName: state.repoName ?? '',
        configured: Boolean(state.githubToken && state.repoOwner && state.repoName),
        telemetry: {
          lastPullCommitSha: state.lastPullCommitSha ?? '',
          lastPushCommitSha: state.lastPushCommitSha ?? '',
          lastSyncAttemptCount: state.lastSyncAttemptCount ?? 0,
          lastSyncError: state.lastSyncError ?? '',
          lastSyncAtIso: state.lastSyncAtIso ?? '',
        },
        startup: {
          inProgress: startupSyncStatus.inProgress,
          mode: startupSyncStatus.mode,
          branch: startupSyncStatus.branch,
          lastAction: startupSyncStatus.lastAction,
          lastRunAtIso: startupSyncStatus.lastRunAtIso,
          lastSuccessAtIso: startupSyncStatus.lastSuccessAtIso,
          lastError: startupSyncStatus.lastError,
        },
      },
    })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/github/start-login') {
    try {
      const started = await startGithubDeviceLogin()
      setJson(res, 200, { data: started })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to start GitHub login') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/github/logout') {
    try {
      const state = await readSkillsSyncState()
      await writeSkillsSyncState({
        ...state,
        githubToken: undefined,
        githubUsername: undefined,
        repoOwner: undefined,
        repoName: undefined,
      })
      setJson(res, 200, { ok: true })
    } catch (error) {
      setJson(res, 500, { error: getErrorMessage(error, 'Failed to logout GitHub') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/github/complete-login') {
    try {
      const payload = asRecord(await readJsonBody(req))
      const deviceCode = typeof payload?.deviceCode === 'string' ? payload.deviceCode : ''
      if (!deviceCode) {
        setJson(res, 400, { error: 'Missing deviceCode' })
        return true
      }
      const result = await completeGithubDeviceLogin(deviceCode)
      if (!result.token) {
        setJson(res, 200, { ok: false, pending: result.error === 'authorization_pending', error: result.error || 'login_failed' })
        return true
      }
      const token = result.token
      const username = await resolveGithubUsername(token)
      await finalizeGithubLoginAndSync(token, username, appServer)
      setJson(res, 200, { ok: true, data: { githubUsername: username } })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to complete GitHub login') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/push') {
    try {
      const state = await readSkillsSyncState()
      if (!state.githubToken || !state.repoOwner || !state.repoName) {
        setJson(res, 400, { error: 'Skills sync is not configured yet' })
        return true
      }
      if (isUpstreamSkillsRepo(state.repoOwner, state.repoName)) {
        setJson(res, 400, { error: 'Refusing to push to upstream repository' })
        return true
      }
      const local = await collectLocalSyncedSkills(appServer)
      const installedMap = await scanInstalledSkillsFromDisk()
      await writeRemoteSkillsManifest(state.githubToken, state.repoOwner, state.repoName, local)
      await syncInstalledSkillsFolderToRepo(state.githubToken, state.repoOwner, state.repoName, installedMap)
      setJson(res, 200, { ok: true, data: { synced: local.length } })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to push synced skills') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/startup-sync') {
    try {
      await runSkillsSyncStartup(appServer)
      setJson(res, 200, { ok: true })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to run startup sync') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-sync/pull') {
    try {
      const state = await readSkillsSyncState()
      if (!state.githubToken || !state.repoOwner || !state.repoName) {
        await bootstrapSkillsFromUpstreamIntoLocal()
        try { await appServer.rpc('skills/list', { forceReload: true }) } catch {}
        setJson(res, 200, { ok: true, data: { synced: 0, source: 'upstream' } })
        return true
      }
      const remote = await readRemoteSkillsManifest(state.githubToken, state.repoOwner, state.repoName)
      const tree = await fetchSkillsTree()
      const uniqueOwnerByName = new Map<string, string>()
      const ambiguousNames = new Set<string>()
      for (const entry of tree) {
        if (ambiguousNames.has(entry.name)) continue
        const existingOwner = uniqueOwnerByName.get(entry.name)
        if (!existingOwner) {
          uniqueOwnerByName.set(entry.name, entry.owner)
          continue
        }
        if (existingOwner !== entry.owner) {
          uniqueOwnerByName.delete(entry.name)
          ambiguousNames.add(entry.name)
        }
      }
      const localDir = await detectUserSkillsDir(appServer)
      await pullInstalledSkillsFolderFromRepo(state.githubToken, state.repoOwner, state.repoName)
      const localSkills = await scanInstalledSkillsFromDisk()
      const missingAfterPull: string[] = []
      for (const skill of remote) {
        const owner = skill.owner || uniqueOwnerByName.get(skill.name) || ''
        if (!owner) continue
        if (!localSkills.has(skill.name)) {
          missingAfterPull.push(`${owner}/${skill.name}`)
          continue
        }
        const skillPath = join(localDir, skill.name)
        await appServer.rpc('skills/config/write', { path: skillPath, enabled: skill.enabled })
      }
      if (missingAfterPull.length > 0) {
        throw new Error(`Missing skill folders after pull: ${missingAfterPull.join(', ')}`)
      }
      const remoteNames = new Set(remote.map((row) => row.name))
      for (const [name, localInfo] of localSkills.entries()) {
        if (!remoteNames.has(name)) {
          await rm(localInfo.path.replace(/\/SKILL\.md$/, ''), { recursive: true, force: true })
        }
      }
      const nextOwners: Record<string, string> = {}
      for (const item of remote) {
        const owner = item.owner || uniqueOwnerByName.get(item.name) || ''
        if (owner) nextOwners[item.name] = owner
      }
      const pulledHead = await runCommandWithOutput('git', ['rev-parse', 'HEAD'], { cwd: getSkillsInstallDir() }).catch(() => '')
      await writeSkillsSyncState({
        ...state,
        installedOwners: nextOwners,
        lastPullCommitSha: pulledHead.trim(),
        lastSyncAttemptCount: 1,
        lastSyncError: '',
        lastSyncAtIso: new Date().toISOString(),
      })
      try { await appServer.rpc('skills/list', { forceReload: true }) } catch {}
      setJson(res, 200, { ok: true, data: { synced: remote.length } })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to pull synced skills') })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/skills-hub/readme') {
    try {
      const owner = url.searchParams.get('owner') || ''
      const name = url.searchParams.get('name') || ''
      const installed = url.searchParams.get('installed') === 'true'
      const skillPath = url.searchParams.get('path') || ''
      const sourcePath = sanitizeRemoteSkillPath(url.searchParams.get('sourcePath') || '')
      if (!owner || !name) {
        setJson(res, 400, { error: 'Missing owner or name' })
        return true
      }
      if (installed) {
        const installedMap = await scanInstalledSkillsFromDisk()
        const installedInfo = installedMap.get(name)
        const localSkillPath = installedInfo?.path
          || (skillPath ? (skillPath.endsWith('/SKILL.md') ? skillPath : `${skillPath}/SKILL.md`) : '')
        if (localSkillPath) {
          const content = await readFile(localSkillPath, 'utf8')
          const description = extractSkillDescriptionFromMarkdown(content)
          setJson(res, 200, { content, description, source: 'local' })
          return true
        }
      }
      const rawUrl = sourcePath
        ? getSkillsHubRawPathUrl(sourcePath, 'SKILL.md')
        : getSkillsHubRawFileUrl(owner, name, 'SKILL.md')
      const resp = await fetch(rawUrl)
      if (!resp.ok) throw new Error(`Failed to fetch SKILL.md: ${resp.status}`)
      const content = await resp.text()
      const description = extractSkillDescriptionFromMarkdown(content)
      setJson(res, 200, { content, description, source: 'remote' })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to fetch SKILL.md') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-hub/install') {
    try {
      const payload = asRecord(await readJsonBody(req))
      const owner = typeof payload?.owner === 'string' ? payload.owner : ''
      const name = typeof payload?.name === 'string' ? payload.name : ''
      const sourcePath = sanitizeRemoteSkillPath(typeof payload?.sourcePath === 'string' ? payload.sourcePath : '')
      const repoSlug = sanitizeGithubRepoSlug(typeof payload?.repoSlug === 'string' ? payload.repoSlug : '')
      const repoRef = sanitizeGithubRef(typeof payload?.repoRef === 'string' ? payload.repoRef : '')
      if (!owner || !name) {
        setJson(res, 400, { error: 'Missing owner or name' })
        return true
      }
      const installerScript = resolveSkillInstallerScriptPath(getCodexHomeDir())
      if (!installerScript) {
        throw new Error('Skill installer script not found')
      }
      const pythonCommand = resolvePythonCommand()
      if (!pythonCommand) {
        throw new Error('Python 3 is required to install skills')
      }
      const installDest = await withTimeout(
        detectUserSkillsDir(appServer),
        10_000,
        'detectUserSkillsDir',
      ).catch(() => getSkillsInstallDir())
      const skillDir = join(installDest, name)
      if (existsSync(skillDir)) {
        await rm(skillDir, { recursive: true, force: true })
      }
      const source = getSkillsHubSource()
      await runCommand(pythonCommand.command, [
        ...pythonCommand.args,
        installerScript,
        '--repo', repoSlug || getSkillsHubRepoSlug(),
        '--path', sourcePath || getSkillsHubSkillPath(owner, name),
        '--ref', repoRef || source.ref,
        '--dest', installDest,
        '--method', 'git',
      ], { timeoutMs: 90_000 })
      try { await withTimeout(ensureInstalledSkillIsValid(appServer, skillDir), 10_000, 'ensureInstalledSkillIsValid') } catch {}
      const syncState = await readSkillsSyncState()
      const nextOwners = { ...(syncState.installedOwners ?? {}), [name]: owner }
      await writeSkillsSyncState({ ...syncState, installedOwners: nextOwners })
      autoPushSyncedSkills(appServer).catch(() => {})
      setJson(res, 200, { ok: true, name })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to install skill') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/skills-hub/uninstall') {
    try {
      const payload = asRecord(await readJsonBody(req))
      const name = typeof payload?.name === 'string' ? payload.name : ''
      const path = typeof payload?.path === 'string' ? payload.path : ''
      const normalizedPath = path.endsWith('/SKILL.md') ? path.slice(0, -'/SKILL.md'.length) : path
      const target = normalizedPath || (name ? join(getSkillsInstallDir(), name) : '')
      if (!target) {
        setJson(res, 400, { error: 'Missing name or path' })
        return true
      }
      await rm(target, { recursive: true, force: true })
      if (name) {
        const syncState = await readSkillsSyncState()
        const nextOwners = { ...(syncState.installedOwners ?? {}) }
        delete nextOwners[name]
        await writeSkillsSyncState({ ...syncState, installedOwners: nextOwners })
      }
      autoPushSyncedSkills(appServer).catch(() => {})
      try { await withTimeout(appServer.rpc('skills/list', { forceReload: true }), 10_000, 'skills/list reload') } catch {}
      setJson(res, 200, { ok: true, deletedPath: target })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to uninstall skill') })
    }
    return true
  }

  return false
}
