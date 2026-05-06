<template>
  <aside v-if="displaySnapshots.length > 0" class="rate-limit-status" aria-live="polite">
    <div
      v-for="snapshot in displaySnapshots"
      :key="getSnapshotKey(snapshot)"
      class="rate-limit-card"
      :title="buildTooltip(snapshot)"
    >
      <div class="rate-limit-card-header">
        <span class="rate-limit-card-title">{{ getSnapshotTitle(snapshot) }}</span>
        <span v-if="snapshot.planType" class="rate-limit-card-plan">{{ formatPlanType(snapshot.planType) }}</span>
      </div>

      <div class="rate-limit-card-metrics">
        <span
          v-for="metric in getWindowMetrics(snapshot)"
          :key="metric.key"
          class="rate-limit-card-metric"
        >
          {{ metric.label }}
        </span>
      </div>

      <div v-if="getFooterParts(snapshot).length > 0" class="rate-limit-card-footer">
        {{ getFooterParts(snapshot).join(' | ') }}
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UiRateLimitSnapshot, UiRateLimitWindow } from '../../types/codex'

const props = defineProps<{
  snapshots: UiRateLimitSnapshot[]
}>()

type RateLimitMetric = {
  key: string
  label: string
}

function getSnapshotKey(snapshot: UiRateLimitSnapshot): string {
  return getSnapshotIdentity(snapshot)
}

function getWindowIdentity(window: UiRateLimitWindow | null): string {
  if (!window) return 'none'
  return [
    Math.round(window.usedPercent),
    window.windowDurationMins ?? 'any',
    window.resetsAt ?? 'open',
  ].join(':')
}

function getSnapshotIdentity(snapshot: UiRateLimitSnapshot): string {
  return [
    snapshot.limitId?.trim() || '',
    snapshot.limitName?.trim() || '',
    snapshot.planType?.trim() || '',
    getWindowIdentity(snapshot.primary),
    getWindowIdentity(snapshot.secondary),
    snapshot.credits?.balance ?? '',
    snapshot.credits?.unlimited === true ? 'unlimited' : '',
  ].join('|')
}

function getSnapshotTitle(snapshot: UiRateLimitSnapshot): string {
  const name = snapshot.limitName?.trim()
  if (name) return name
  const id = snapshot.limitId?.trim()
  if (!id) return '套餐余量'
  if (id.toLowerCase() === 'codex') return 'Codex 套餐'
  return id.replace(/[_-]+/g, ' ')
}

function formatPlanType(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatWindowDuration(windowDurationMins: number | null): string {
  if (!windowDurationMins || windowDurationMins <= 0) return '窗口'
  if (windowDurationMins % 1440 === 0) return `${windowDurationMins / 1440}d`
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60}h`
  if (windowDurationMins < 60) return `${windowDurationMins}m`
  return `${Math.round((windowDurationMins / 60) * 10) / 10}h`
}

function formatRemainingPercent(value: number): string {
  const remaining = Math.max(0, Math.min(100, 100 - value))
  return `剩余 ${Math.round(remaining)}%`
}

function formatUsedPercent(value: number): string {
  return `${Math.round(value)}%`
}

function formatWindowMetric(window: UiRateLimitWindow, key: string): RateLimitMetric {
  return {
    key,
    label: `${formatWindowDuration(window.windowDurationMins)} ${formatRemainingPercent(window.usedPercent)}`,
  }
}

function getWindowMetrics(snapshot: UiRateLimitSnapshot): RateLimitMetric[] {
  const metrics: RateLimitMetric[] = []
  if (snapshot.primary) metrics.push(formatWindowMetric(snapshot.primary, 'primary'))
  if (snapshot.secondary) metrics.push(formatWindowMetric(snapshot.secondary, 'secondary'))
  return metrics
}

function formatAbsoluteResetDate(resetsAt: number | null): string {
  if (!resetsAt) return ''

  const resetDate = new Date(resetsAt * 1000)
  const month = resetDate.getMonth() + 1
  const day = String(resetDate.getDate()).padStart(2, '0')
  const hours = String(resetDate.getHours()).padStart(2, '0')
  const minutes = String(resetDate.getMinutes()).padStart(2, '0')
  return `${month}.${day} ${hours}:${minutes}`
}

function formatRelativeResetText(window: UiRateLimitWindow | null): string {
  if (!window?.resetsAt) return ''

  const diffMs = window.resetsAt * 1000 - Date.now()
  if (diffMs <= 0) return '正在重置'

  const diffMinutes = Math.round(diffMs / 60000)
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟后重置`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时后重置`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} 天后重置`
}

function getResetWindows(snapshot: UiRateLimitSnapshot): UiRateLimitWindow[] {
  return [snapshot.primary, snapshot.secondary].filter((window): window is UiRateLimitWindow => window !== null)
}

function getPrimaryResetWindow(snapshot: UiRateLimitSnapshot): UiRateLimitWindow | null {
  const windows = getResetWindows(snapshot)
  if (windows.length === 0) return null

  return [...windows].sort((first, second) => {
    const firstDuration = first.windowDurationMins ?? Number.MAX_SAFE_INTEGER
    const secondDuration = second.windowDurationMins ?? Number.MAX_SAFE_INTEGER
    if (firstDuration !== secondDuration) return firstDuration - secondDuration
    return (first.resetsAt ?? Number.MAX_SAFE_INTEGER) - (second.resetsAt ?? Number.MAX_SAFE_INTEGER)
  })[0]
}

function getWeeklyResetText(snapshot: UiRateLimitSnapshot): string {
  const windows = getResetWindows(snapshot)
  if (windows.length === 0) return ''

  const weeklyWindow = [...windows].sort((first, second) => {
    const firstDuration = first.windowDurationMins ?? -1
    const secondDuration = second.windowDurationMins ?? -1
    if (firstDuration !== secondDuration) return secondDuration - firstDuration
    return (second.resetsAt ?? -1) - (first.resetsAt ?? -1)
  })[0]

  const absoluteText = formatAbsoluteResetDate(weeklyWindow.resetsAt)
  if (!absoluteText) return ''

  return absoluteText
}

function getCreditsText(snapshot: UiRateLimitSnapshot): string {
  const credits = snapshot.credits
  if (!credits) return ''
  if (credits.unlimited) return '额度不限'
  if (credits.balance) return `余额 ${credits.balance}`
  if (credits.hasCredits) return '有可用额度'
  return ''
}

function getFooterParts(snapshot: UiRateLimitSnapshot): string[] {
  return [
    formatRelativeResetText(getPrimaryResetWindow(snapshot)),
    getWeeklyResetText(snapshot),
    getCreditsText(snapshot),
  ].filter((value) => value.length > 0)
}

function buildTooltip(snapshot: UiRateLimitSnapshot): string {
  const lines = [getSnapshotTitle(snapshot)]
  for (const metric of getWindowMetrics(snapshot)) {
    lines.push(metric.label)
  }
  for (const window of getResetWindows(snapshot)) {
    lines.push(`${formatWindowDuration(window.windowDurationMins)} 已用 ${formatUsedPercent(window.usedPercent)}`)
  }
  for (const footer of getFooterParts(snapshot)) {
    lines.push(footer)
  }
  return lines.join('\n')
}

const displaySnapshots = computed(() => {
  const seen = new Set<string>()
  const next: UiRateLimitSnapshot[] = []
  for (const snapshot of props.snapshots) {
    const identity = getSnapshotIdentity(snapshot)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(snapshot)
  }
  return next
})
</script>

<style scoped>
@reference "tailwindcss";

.rate-limit-status {
  @apply grid w-full gap-2;
}

.rate-limit-card {
  @apply w-full rounded-lg border border-[#e6dccb] bg-white/90 px-3 py-2 text-left;
}

.rate-limit-card-header {
  @apply flex min-w-0 items-center justify-between gap-2;
}

.rate-limit-card-title {
  @apply min-w-0 truncate text-xs font-semibold text-[#3f372d];
}

.rate-limit-card-plan {
  @apply shrink-0 rounded-full bg-[#f1ebde] px-2 py-0.5 text-[10px] font-medium text-[#7b7062];
}

.rate-limit-card-metrics {
  @apply mt-2 grid grid-cols-2 gap-1.5;
}

.rate-limit-card-metric {
  @apply rounded-md bg-[#fff7ed] px-2 py-1 text-center text-xs font-semibold text-[#9a3412];
}

.rate-limit-card-footer {
  @apply mt-1.5 text-[11px] leading-4 text-[#8f8577];
}
</style>
