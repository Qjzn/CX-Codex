import type { UiProjectGroup, UiThread } from '../types/codex.js'

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
