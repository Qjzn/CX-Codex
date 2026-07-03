import { readFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  runCommand,
  runCommandCapture,
  runCommandWithOutput,
} from './commandRunner.js'

export async function ensureRepoHasInitialCommit(repoRoot: string): Promise<void> {
  const agentsPath = join(repoRoot, 'AGENTS.md')
  try {
    await stat(agentsPath)
  } catch {
    await writeFile(agentsPath, '', 'utf8')
  }

  await runCommand('git', ['add', 'AGENTS.md'], { cwd: repoRoot })
  await runCommand(
    'git',
    ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', 'Initialize repository for worktree support'],
    { cwd: repoRoot },
  )
}

export function normalizeCommitMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
  return normalized.slice(0, 2000)
}

export function getRollbackGitDirForCwd(cwd: string): string {
  return join(cwd, '.codex', 'rollbacks', '.git')
}

export async function ensureLocalCodexGitignoreHasRollbacks(cwd: string): Promise<void> {
  const localCodexDir = join(cwd, '.codex')
  const gitignorePath = join(localCodexDir, '.gitignore')
  await mkdir(localCodexDir, { recursive: true })
  let current = ''
  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch {
    current = ''
  }
  const rows = current.split(/\r?\n/).map((line) => line.trim())
  if (rows.includes('rollbacks/')) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? `${current}\n` : current
  await writeFile(gitignorePath, `${prefix}rollbacks/\n`, 'utf8')
}

export async function ensureRollbackGitRepo(cwd: string): Promise<string> {
  const gitDir = getRollbackGitDirForCwd(cwd)
  try {
    const headInfo = await stat(join(gitDir, 'HEAD'))
    if (!headInfo.isFile()) {
      throw new Error('Invalid rollback git repository')
    }
  } catch {
    await mkdir(dirname(gitDir), { recursive: true })
    await runCommand('git', ['--git-dir', gitDir, '--work-tree', cwd, 'init'])
  }
  await runCommand('git', ['--git-dir', gitDir, 'config', 'user.email', 'codex@local'])
  await runCommand('git', ['--git-dir', gitDir, 'config', 'user.name', 'Codex Rollback'])
  try {
    await runCommandCapture('git', ['--git-dir', gitDir, '--work-tree', cwd, 'rev-parse', '--verify', 'HEAD'])
  } catch {
    await runCommand(
      'git',
      ['--git-dir', gitDir, '--work-tree', cwd, 'commit', '--allow-empty', '-m', 'Initialize rollback history'],
    )
  }
  await ensureLocalCodexGitignoreHasRollbacks(cwd)
  return gitDir
}

export async function runRollbackGit(cwd: string, args: string[]): Promise<void> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  await runCommand('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

export async function runRollbackGitCapture(cwd: string, args: string[]): Promise<string> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  return await runCommandCapture('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

export async function runRollbackGitWithOutput(cwd: string, args: string[]): Promise<string> {
  const gitDir = await ensureRollbackGitRepo(cwd)
  return await runCommandWithOutput('git', ['--git-dir', gitDir, '--work-tree', cwd, ...args])
}

export async function hasRollbackGitWorkingTreeChanges(cwd: string): Promise<boolean> {
  const status = await runRollbackGitWithOutput(cwd, ['status', '--porcelain'])
  return status.trim().length > 0
}

export async function findRollbackCommitByExactMessage(cwd: string, message: string): Promise<string> {
  const normalizedTarget = normalizeCommitMessage(message)
  if (!normalizedTarget) return ''
  const raw = await runRollbackGitWithOutput(cwd, ['log', '--format=%H%x1f%B%x1e'])
  const entries = raw.split('\x1e')
  for (const entry of entries) {
    if (!entry.trim()) continue
    const [shaRaw, bodyRaw] = entry.split('\x1f')
    const sha = (shaRaw ?? '').trim()
    const body = normalizeCommitMessage(bodyRaw ?? '')
    if (!sha) continue
    if (body === normalizedTarget) return sha
  }
  return ''
}
