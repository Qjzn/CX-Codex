import type { UiProjectGroup, UiThread } from '../types/codex.js'
import { normalizePathForUi, toProjectName } from '../pathUtils.js'

type ThreadOccurrence = {
  thread: UiThread
  groupProjectName: string
  groupIndex: number
  threadIndex: number
}

function isResolvedProjectName(value: string): boolean {
  const normalized = value.trim()
  return normalized.length > 0 && normalized !== 'unknown-project'
}

function readThreadProjectIdentityScore(thread: UiThread, groupProjectName: string): number {
  const normalizedCwd = normalizePathForUi(thread.cwd)
  const cwdProjectName = normalizedCwd ? toProjectName(normalizedCwd) : ''
  let score = 0

  if (normalizedCwd && isResolvedProjectName(cwdProjectName)) score += 4
  if (isResolvedProjectName(thread.projectName)) score += 2
  if (isResolvedProjectName(groupProjectName)) score += 1
  if (cwdProjectName && thread.projectName === cwdProjectName) score += 1
  if (cwdProjectName && groupProjectName === cwdProjectName) score += 1

  return score
}

function resolveOccurrenceProjectName(occurrence: ThreadOccurrence): string {
  const normalizedCwd = normalizePathForUi(occurrence.thread.cwd)
  const cwdProjectName = normalizedCwd ? toProjectName(normalizedCwd) : ''
  if (isResolvedProjectName(cwdProjectName)) return cwdProjectName
  if (isResolvedProjectName(occurrence.thread.projectName)) return occurrence.thread.projectName
  if (isResolvedProjectName(occurrence.groupProjectName)) return occurrence.groupProjectName
  return occurrence.thread.projectName || occurrence.groupProjectName || 'unknown-project'
}

function shouldKeepEmptyProjectGroup(group: UiProjectGroup): boolean {
  return Boolean(group.workspaceRoot || group.isPinnedProject)
}

export function dedupeProjectThreadGroups(groups: UiProjectGroup[]): UiProjectGroup[] {
  const winnersByThreadId = new Map<string, ThreadOccurrence>()

  groups.forEach((group, groupIndex) => {
    group.threads.forEach((thread, threadIndex) => {
      const threadId = thread.id.trim()
      if (!threadId) return

      const candidate: ThreadOccurrence = {
        thread,
        groupProjectName: group.projectName,
        groupIndex,
        threadIndex,
      }
      const current = winnersByThreadId.get(threadId)
      if (
        !current
        || readThreadProjectIdentityScore(candidate.thread, candidate.groupProjectName)
          > readThreadProjectIdentityScore(current.thread, current.groupProjectName)
      ) {
        winnersByThreadId.set(threadId, candidate)
      }
    })
  })

  return groups
    .map((group, groupIndex) => ({
      ...group,
      threads: group.threads.filter((thread, threadIndex) => {
        const threadId = thread.id.trim()
        if (!threadId) return true
        const winner = winnersByThreadId.get(threadId)
        return winner?.groupIndex === groupIndex && winner.threadIndex === threadIndex
      }),
    }))
    .filter((group, groupIndex) => (
      group.threads.length > 0
      || groups[groupIndex].threads.length === 0
      || shouldKeepEmptyProjectGroup(group)
    ))
}

export function upsertThreadIntoProjectGroups(
  groups: UiProjectGroup[],
  incomingThread: UiThread,
): UiProjectGroup[] {
  const incomingOccurrence: ThreadOccurrence = {
    thread: incomingThread,
    groupProjectName: incomingThread.projectName,
    groupIndex: -1,
    threadIndex: -1,
  }
  let winner = incomingOccurrence
  let winnerScore = readThreadProjectIdentityScore(incomingThread, incomingThread.projectName)

  groups.forEach((group, groupIndex) => {
    group.threads.forEach((thread, threadIndex) => {
      if (thread.id !== incomingThread.id) return

      const score = readThreadProjectIdentityScore(thread, group.projectName)
      if (score <= winnerScore) return
      winner = {
        thread,
        groupProjectName: group.projectName,
        groupIndex,
        threadIndex,
      }
      winnerScore = score
    })
  })

  const targetProjectName = resolveOccurrenceProjectName(winner)
  const winningThread = winner.thread.projectName === targetProjectName
    ? winner.thread
    : { ...winner.thread, projectName: targetProjectName }
  const withoutThread = groups
    .map((group) => ({
      ...group,
      threads: group.threads.filter((thread) => thread.id !== incomingThread.id),
    }))
    .filter((group) => group.threads.length > 0 || shouldKeepEmptyProjectGroup(group))
  const targetGroupIndex = withoutThread.findIndex((group) => group.projectName === targetProjectName)

  if (targetGroupIndex < 0) {
    return [{ projectName: targetProjectName, threads: [winningThread] }, ...withoutThread]
  }

  return withoutThread.map((group, groupIndex) => (
    groupIndex === targetGroupIndex
      ? { ...group, threads: [winningThread, ...group.threads] }
      : group
  ))
}

function readThreadActivityTimestamp(thread: UiThread): number {
  const updatedAtMs = Date.parse(thread.updatedAtIso)
  if (Number.isFinite(updatedAtMs)) return updatedAtMs

  const createdAtMs = Date.parse(thread.createdAtIso)
  return Number.isFinite(createdAtMs) ? createdAtMs : 0
}

function readProjectActivityTimestamp(group: UiProjectGroup): number {
  let latestTimestamp = 0
  for (const thread of group.threads) {
    latestTimestamp = Math.max(latestTimestamp, readThreadActivityTimestamp(thread))
  }
  return latestTimestamp
}

function readPinnedProjectRank(group: UiProjectGroup): number {
  return group.isPinnedProject === true && typeof group.pinnedProjectRank === 'number'
    ? group.pinnedProjectRank
    : Number.MAX_SAFE_INTEGER
}

export function orderProjectGroupsByRecentActivity(groups: UiProjectGroup[]): UiProjectGroup[] {
  return groups
    .map((group, inputIndex) => ({
      group,
      inputIndex,
      latestTimestamp: readProjectActivityTimestamp(group),
    }))
    .sort((first, second) => {
      const firstPinned = first.group.isPinnedProject === true
      const secondPinned = second.group.isPinnedProject === true
      if (firstPinned !== secondPinned) return firstPinned ? -1 : 1

      if (firstPinned && secondPinned) {
        const rankDifference = readPinnedProjectRank(first.group) - readPinnedProjectRank(second.group)
        if (rankDifference !== 0) return rankDifference
      }

      const activityDifference = second.latestTimestamp - first.latestTimestamp
      return activityDifference !== 0 ? activityDifference : first.inputIndex - second.inputIndex
    })
    .map(({ group }) => group)
}
