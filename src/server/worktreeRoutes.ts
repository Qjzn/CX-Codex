import { randomBytes } from 'node:crypto'
import { mkdir as fsMkdir, stat as fsStat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join, resolve } from 'node:path'

import {
  ensureRepoHasInitialCommit,
  ensureRollbackGitRepo,
  findRollbackCommitByExactMessage,
  hasRollbackGitWorkingTreeChanges,
  normalizeCommitMessage,
  runRollbackGit,
  runRollbackGitCapture,
  runRollbackGitWithOutput,
} from './appServerRollbackGit.js'
import { runCommand, runCommandCapture } from './commandRunner.js'
import { getCodexWorktreesDir } from './codexPaths.js'
import { getErrorMessage } from './errorMessage.js'
import { setJson } from './httpJsonResponse.js'

type FsStats = {
  isDirectory: () => boolean
}

export type WorktreeRoutesDependencies = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  stat?: (path: string) => Promise<FsStats>
  mkdir?: (path: string, options: { recursive: boolean }) => Promise<unknown>
  randomWorktreeId?: () => string
  getCodexWorktreesDir?: typeof getCodexWorktreesDir
  runCommand?: typeof runCommand
  runCommandCapture?: typeof runCommandCapture
  ensureRepoHasInitialCommit?: typeof ensureRepoHasInitialCommit
  ensureRollbackGitRepo?: typeof ensureRollbackGitRepo
  findRollbackCommitByExactMessage?: typeof findRollbackCommitByExactMessage
  hasRollbackGitWorkingTreeChanges?: typeof hasRollbackGitWorkingTreeChanges
  normalizeCommitMessage?: typeof normalizeCommitMessage
  runRollbackGit?: typeof runRollbackGit
  runRollbackGitCapture?: typeof runRollbackGitCapture
  runRollbackGitWithOutput?: typeof runRollbackGitWithOutput
  getErrorMessage?: typeof getErrorMessage
}

export async function handleWorktreeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: WorktreeRoutesDependencies,
): Promise<boolean> {
  const statPath = dependencies.stat ?? fsStat
  const mkdirPath = dependencies.mkdir ?? fsMkdir
  const createRandomWorktreeId = dependencies.randomWorktreeId ?? (() => randomBytes(2).toString('hex'))
  const readWorktreesDir = dependencies.getCodexWorktreesDir ?? getCodexWorktreesDir
  const runGitCommand = dependencies.runCommand ?? runCommand
  const captureGitCommand = dependencies.runCommandCapture ?? runCommandCapture
  const ensureInitialCommit = dependencies.ensureRepoHasInitialCommit ?? ensureRepoHasInitialCommit
  const ensureRollbackRepo = dependencies.ensureRollbackGitRepo ?? ensureRollbackGitRepo
  const findRollbackCommit = dependencies.findRollbackCommitByExactMessage ?? findRollbackCommitByExactMessage
  const hasRollbackChanges = dependencies.hasRollbackGitWorkingTreeChanges ?? hasRollbackGitWorkingTreeChanges
  const normalizeMessage = dependencies.normalizeCommitMessage ?? normalizeCommitMessage
  const runRollback = dependencies.runRollbackGit ?? runRollbackGit
  const captureRollback = dependencies.runRollbackGitCapture ?? runRollbackGitCapture
  const runRollbackWithOutput = dependencies.runRollbackGitWithOutput ?? runRollbackGitWithOutput
  const readErrorMessage = dependencies.getErrorMessage ?? getErrorMessage

  if (req.method === 'POST' && url.pathname === '/codex-api/worktree/create') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const rawSourceCwd = typeof payload?.sourceCwd === 'string' ? payload.sourceCwd.trim() : ''
    if (!rawSourceCwd) {
      setJson(res, 400, { error: 'Missing sourceCwd' })
      return true
    }

    const sourceCwd = isAbsolute(rawSourceCwd) ? rawSourceCwd : resolve(rawSourceCwd)
    try {
      const sourceInfo = await statPath(sourceCwd)
      if (!sourceInfo.isDirectory()) {
        setJson(res, 400, { error: 'sourceCwd is not a directory' })
        return true
      }
    } catch {
      setJson(res, 404, { error: 'sourceCwd does not exist' })
      return true
    }

    try {
      let gitRoot = ''
      try {
        gitRoot = await captureGitCommand('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
      } catch (error) {
        if (!isNotGitRepositoryError(error, readErrorMessage)) throw error
        await runGitCommand('git', ['init'], { cwd: sourceCwd })
        gitRoot = await captureGitCommand('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
      }
      const repoName = basename(gitRoot) || 'repo'
      const worktreesRoot = readWorktreesDir()
      await mkdirPath(worktreesRoot, { recursive: true })

      // Match Codex desktop layout so project grouping resolves to repo name:
      // ~/.codex/worktrees/<id>/<repoName>
      let worktreeId = ''
      let worktreeParent = ''
      let worktreeCwd = ''
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = createRandomWorktreeId()
        const parent = join(worktreesRoot, candidate)
        try {
          await statPath(parent)
          continue
        } catch {
          worktreeId = candidate
          worktreeParent = parent
          worktreeCwd = join(parent, repoName)
          break
        }
      }
      if (!worktreeId || !worktreeParent || !worktreeCwd) {
        throw new Error('Failed to allocate a unique worktree id')
      }
      const branch = `codex/${worktreeId}`

      await mkdirPath(worktreeParent, { recursive: true })
      try {
        await runGitCommand('git', ['worktree', 'add', '-b', branch, worktreeCwd, 'HEAD'], { cwd: gitRoot })
      } catch (error) {
        if (!isMissingHeadError(error, readErrorMessage)) throw error
        await ensureInitialCommit(gitRoot)
        await runGitCommand('git', ['worktree', 'add', '-b', branch, worktreeCwd, 'HEAD'], { cwd: gitRoot })
      }

      setJson(res, 200, {
        data: {
          cwd: worktreeCwd,
          branch,
          gitRoot,
        },
      })
    } catch (error) {
      setJson(res, 500, { error: readErrorMessage(error, 'Failed to create worktree') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/worktree/auto-commit') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
    const commitMessage = normalizeMessage(payload?.message)
    if (!rawCwd) {
      setJson(res, 400, { error: 'Missing cwd' })
      return true
    }
    if (!commitMessage) {
      setJson(res, 400, { error: 'Missing message' })
      return true
    }

    const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
    try {
      const cwdInfo = await statPath(cwd)
      if (!cwdInfo.isDirectory()) {
        setJson(res, 400, { error: 'cwd is not a directory' })
        return true
      }
    } catch {
      setJson(res, 404, { error: 'cwd does not exist' })
      return true
    }

    try {
      await ensureRollbackRepo(cwd)
      const beforeStatus = await runRollbackWithOutput(cwd, ['status', '--porcelain'])
      if (!beforeStatus.trim()) {
        setJson(res, 200, { data: { committed: false } })
        return true
      }

      await runRollback(cwd, ['add', '-A'])
      const stagedStatus = await runRollbackWithOutput(cwd, ['diff', '--cached', '--name-only'])
      if (!stagedStatus.trim()) {
        setJson(res, 200, { data: { committed: false } })
        return true
      }

      await runRollback(cwd, ['commit', '-m', commitMessage])
      setJson(res, 200, { data: { committed: true } })
    } catch (error) {
      setJson(res, 500, { error: readErrorMessage(error, 'Failed to auto-commit rollback changes') })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/worktree/rollback-to-message') {
    const payload = asRecord(await dependencies.readJsonBody(req))
    const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
    const commitMessage = normalizeMessage(payload?.message)
    if (!rawCwd) {
      setJson(res, 400, { error: 'Missing cwd' })
      return true
    }
    if (!commitMessage) {
      setJson(res, 400, { error: 'Missing message' })
      return true
    }

    const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
    try {
      const cwdInfo = await statPath(cwd)
      if (!cwdInfo.isDirectory()) {
        setJson(res, 400, { error: 'cwd is not a directory' })
        return true
      }
    } catch {
      setJson(res, 404, { error: 'cwd does not exist' })
      return true
    }

    try {
      await ensureRollbackRepo(cwd)
      const commitSha = await findRollbackCommit(cwd, commitMessage)
      if (!commitSha) {
        setJson(res, 404, { error: 'No matching commit found for this user message' })
        return true
      }
      let resetTargetSha = ''
      try {
        resetTargetSha = await captureRollback(cwd, ['rev-parse', `${commitSha}^`])
      } catch {
        setJson(res, 409, { error: 'Cannot rollback: matched commit has no parent commit' })
        return true
      }

      let stashed = false
      if (await hasRollbackChanges(cwd)) {
        const stashMessage = `codex-auto-stash-before-rollback-${Date.now()}`
        await runRollback(cwd, ['stash', 'push', '-u', '-m', stashMessage])
        stashed = true
      }

      await runRollback(cwd, ['reset', '--hard', resetTargetSha])
      setJson(res, 200, { data: { reset: true, commitSha, resetTargetSha, stashed } })
    } catch (error) {
      setJson(res, 500, { error: readErrorMessage(error, 'Failed to rollback project to user message commit') })
    }
    return true
  }

  return false
}

function isMissingHeadError(error: unknown, readErrorMessage: typeof getErrorMessage): boolean {
  const message = readErrorMessage(error, '').toLowerCase()
  return (
    message.includes("not a valid object name: 'head'") ||
    message.includes('not a valid object name: head') ||
    message.includes('invalid reference: head')
  )
}

function isNotGitRepositoryError(error: unknown, readErrorMessage: typeof getErrorMessage): boolean {
  const message = readErrorMessage(error, '').toLowerCase()
  return message.includes('not a git repository') || message.includes('fatal: not a git repository')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
