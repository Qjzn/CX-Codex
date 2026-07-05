<template>
  <section
    class="runtime-status-bar"
    :class="{ 'runtime-status-bar--header': props.variant === 'header' }"
    :data-tone="tone"
    aria-live="polite"
  >
    <div class="runtime-status-primary">
      <span class="runtime-status-orb" aria-hidden="true">
        <span class="runtime-status-orb-core" />
      </span>
      <div class="runtime-status-copy">
        <p class="runtime-status-title">{{ title }}</p>
        <p v-if="detail" class="runtime-status-detail">{{ detail }}</p>
      </div>
    </div>

    <ol v-if="showPhaseRail" class="runtime-status-phases" aria-label="任务状态阶段">
      <li
        v-for="(phase, index) in phases"
        :key="phase.key"
        class="runtime-status-phase"
        :class="{
          'is-active': index === activePhaseIndex,
          'is-done': index < activePhaseIndex || isSettled,
        }"
      >
        <span class="runtime-status-phase-dot" aria-hidden="true" />
        <span class="runtime-status-phase-label">{{ phase.label }}</span>
      </li>
    </ol>

    <div class="runtime-status-actions">
      <span v-if="showMetaLabel && metaLabel" class="runtime-status-meta">{{ metaLabel }}</span>
      <button
        class="runtime-status-action"
        type="button"
        :disabled="isRefreshing"
        title="强制恢复当前会话状态"
        aria-label="强制恢复当前会话状态"
        @click="$emit('refresh')"
      >
        <IconTablerRefresh class="runtime-status-action-icon" />
        <span>{{ isRefreshing ? '恢复中' : '强制恢复' }}</span>
      </button>
      <button
        v-if="summary.canStop"
        class="runtime-status-action runtime-status-action-danger"
        type="button"
        title="停止当前任务"
        aria-label="停止当前任务"
        @click="$emit('stop')"
      >
        <IconTablerPlayerStopFilled class="runtime-status-action-icon" />
        <span>停止</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerRefresh from '../icons/IconTablerRefresh.vue'
import type { UiLiveOverlay, UiRuntimeStatusSummary } from '../../types/codex'

type Tone = 'live' | 'syncing' | 'warning' | 'danger'

const props = defineProps<{
  summary: UiRuntimeStatusSummary
  liveOverlay: UiLiveOverlay | null
  pendingRequestCount: number
  isSending: boolean
  isLoading: boolean
  isRefreshing: boolean
  syncLagging: boolean
  syncError: string
  notificationStale: boolean
  connectionState: string
  variant?: 'default' | 'header'
}>()

defineEmits<{
  refresh: []
  stop: []
}>()

const phases = [
  { key: 'submit', label: '发送' },
  { key: 'accepted', label: '接收' },
  { key: 'running', label: '执行' },
  { key: 'settled', label: '收敛' },
] as const

const activeStates = new Set(['queued', 'starting', 'start_uncertain', 'running', 'waiting_permission', 'stopping', 'stop_uncertain'])
const settledStates = new Set(['completed_pending_sync', 'completed', 'failed', 'interrupted', 'stopped', 'idle', 'sync_degraded'])

const isActive = computed(() => activeStates.has(props.summary.executionState))
const isSettled = computed(() => settledStates.has(props.summary.executionState) && !isActive.value)

const activePhaseIndex = computed(() => {
  if (props.isSending || props.summary.executionState === 'queued') return 0
  if (props.summary.executionState === 'starting' || props.summary.executionState === 'start_uncertain') return 1
  if (
    props.summary.executionState === 'running' ||
    props.summary.executionState === 'waiting_permission' ||
    props.summary.executionState === 'stopping' ||
    props.summary.executionState === 'stop_uncertain'
  ) return 2
  return 3
})

const tone = computed<Tone>(() => {
  if (props.syncError.trim() || props.summary.executionState === 'failed') return 'danger'
  if (
    props.summary.stale ||
    props.summary.executionState === 'sync_degraded' ||
    props.summary.executionState === 'start_uncertain' ||
    props.summary.executionState === 'stop_uncertain' ||
    props.pendingRequestCount > 0 ||
    props.syncLagging ||
    props.notificationStale ||
    (props.connectionState === 'disconnected' && isActive.value)
  ) return 'warning'
  if (props.isSending || props.isLoading || props.isRefreshing || isActive.value || props.connectionState === 'connecting') return 'syncing'
  return 'live'
})

const title = computed(() => {
  if (props.syncError.trim()) return '同步异常'
  if (props.pendingRequestCount > 0) return '等待你的确认'
  if (props.isRefreshing) return '正在强制恢复'
  if (props.isSending) return '正在发送'
  if (props.summary.executionState === 'start_uncertain') return '正在确认任务是否开始'
  if (props.summary.executionState === 'stop_uncertain') return '正在确认是否已停止'
  if (props.summary.executionState === 'stopping') return '正在停止'
  if (props.summary.executionState === 'waiting_permission') return '等待权限处理'
  if (props.summary.executionState === 'running') return props.liveOverlay?.activityLabel || '任务执行中'
  if (props.summary.executionState === 'failed') return '任务失败'
  if (props.summary.executionState === 'sync_degraded') return '状态已降级'
  if (props.summary.executionState === 'interrupted' || props.summary.executionState === 'stopped') return '任务已停止'
  return '已同步'
})

const detail = computed(() => {
  const errorText = props.syncError.trim() || props.summary.lastError?.trim() || ''
  if (errorText) return errorText
  if (props.pendingRequestCount > 0) return `${props.pendingRequestCount} 个请求需要处理，处理后任务会继续。`
  if (props.summary.degradedReason) return props.summary.degradedReason
  if (props.summary.stale) return '本地状态偏旧，点击强制恢复会重新核验后端快照。'
  if (props.summary.executionState === 'start_uncertain') return '任务请求已发出，7420 后台正在核验 Codex 是否已接收。'
  if (props.summary.executionState === 'stop_uncertain') return '停止请求已发出，正在核验任务是否仍在运行。'
  if (props.syncLagging || props.notificationStale) return '实时事件可能有延迟，页面会自动补同步。'
  if (props.connectionState === 'reconnecting') return '实时通道正在重连，恢复后会补齐事件。'
  if (props.summary.messageState === 'cached') return '当前先展示缓存消息，后台会继续补齐最新内容。'
  return ''
})

const showPhaseRail = computed(() => tone.value !== 'live')

const showMetaLabel = computed(() => tone.value !== 'live')

const metaLabel = computed(() => {
  if (props.summary.activeTurnId) return `turn ${props.summary.activeTurnId.slice(0, 8)}`
  if (props.summary.lastEventSeq > 0) return `seq ${props.summary.lastEventSeq}`
  return ''
})
</script>

<style scoped>
@reference "tailwindcss";

.runtime-status-bar {
  @apply mx-auto flex w-full max-w-[var(--content-shell-max-width)] items-center gap-2 border-y px-3 py-1;
  font-family: var(--font-sans-ui);
  border-color: var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
  color: var(--ui-text-secondary);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--ui-bg-surface) 72%, transparent) inset;
}

.runtime-status-bar--header {
  @apply mx-0 max-w-none border px-2 py-1;
  border-radius: var(--ui-radius-control);
  border-color: color-mix(in srgb, currentColor 16%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-bg-surface) 84%, transparent);
  box-shadow: none;
}

.runtime-status-primary {
  @apply flex min-w-0 flex-1 items-center gap-1.5;
}

.runtime-status-orb {
  @apply relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border;
  border-color: color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, var(--ui-bg-surface) 78%, transparent);
}

.runtime-status-orb-core {
  @apply h-2 w-2 rounded-full bg-current;
  animation: runtimeStatusPulse 1.4s ease-in-out infinite;
}

.runtime-status-copy {
  @apply min-w-0;
}

.runtime-status-title {
  @apply m-0 truncate text-xs font-semibold;
}

.runtime-status-detail {
  @apply m-0 hidden truncate text-xs leading-4 sm:block;
  color: var(--ui-text-tertiary);
}

.runtime-status-bar--header .runtime-status-detail,
.runtime-status-bar--header .runtime-status-phases,
.runtime-status-bar--header .runtime-status-meta {
  display: none;
}

.runtime-status-phases {
  @apply hidden min-w-0 list-none items-center gap-1 p-0 md:flex;
}

.runtime-status-phase {
  @apply inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-[11px];
  color: var(--ui-text-tertiary);
}

.runtime-status-phase-dot {
  @apply h-1.5 w-1.5 rounded-full bg-current opacity-35;
}

.runtime-status-phase.is-done {
  color: var(--ui-success);
}

.runtime-status-phase.is-done .runtime-status-phase-dot {
  @apply opacity-100;
}

.runtime-status-phase.is-active {
  border-color: color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, var(--ui-bg-surface) 75%, transparent);
  color: currentColor;
}

.runtime-status-actions {
  @apply flex shrink-0 items-center gap-1.5;
}

.runtime-status-meta {
  @apply hidden rounded-full border px-2 py-1 text-[10px] font-medium lg:inline-flex;
  border-color: var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 76%, transparent);
  color: var(--ui-text-tertiary);
  font-family: var(--font-mono-ui);
}

.runtime-status-action {
  @apply inline-flex min-h-7 items-center justify-center gap-1.5 rounded-full border px-2 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-65;
  border-color: var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 84%, transparent);
  color: var(--ui-text-secondary);
  touch-action: manipulation;
}

.runtime-status-bar--header .runtime-status-action {
  @apply min-h-6 px-2 text-[11px];
}

.runtime-status-action:hover {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.runtime-status-action:active:not(:disabled) {
  transform: translateY(1px);
}

.runtime-status-action-danger {
  border-color: color-mix(in srgb, var(--ui-danger) 28%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-danger) 7%, var(--ui-bg-surface));
  color: var(--ui-danger);
}

.runtime-status-action-danger:hover {
  border-color: color-mix(in srgb, var(--ui-danger) 42%, var(--ui-border-strong));
  background: color-mix(in srgb, var(--ui-danger) 10%, var(--ui-bg-surface));
  color: color-mix(in srgb, var(--ui-danger) 86%, var(--ui-text-primary));
}

.runtime-status-action-icon {
  @apply h-3.5 w-3.5;
}

.runtime-status-bar[data-tone='live'] {
  border-color: color-mix(in srgb, var(--ui-success) 24%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-success) 6%, var(--ui-bg-surface));
  color: var(--ui-success);
}

.runtime-status-bar[data-tone='syncing'] {
  border-color: color-mix(in srgb, var(--ui-accent) 20%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-accent) 5%, var(--ui-bg-surface));
  color: var(--ui-text-secondary);
}

.runtime-status-bar[data-tone='warning'] {
  border-color: color-mix(in srgb, var(--ui-warning) 32%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg-surface));
  color: color-mix(in srgb, var(--ui-warning) 78%, var(--ui-text-primary));
}

.runtime-status-bar[data-tone='danger'] {
  border-color: color-mix(in srgb, var(--ui-danger) 32%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-danger) 7%, var(--ui-bg-surface));
  color: var(--ui-danger);
}

.runtime-status-bar[data-tone='live'] .runtime-status-orb-core {
  animation: none;
}

@media (max-width: 767px) {
  .runtime-status-bar {
    @apply gap-1.5 px-2.5 py-1;
  }

  .runtime-status-title {
    @apply text-[12px];
  }

  .runtime-status-action {
    @apply min-h-9 px-2;
  }

  .runtime-status-action span {
    @apply sr-only;
  }

  .runtime-status-bar--header {
    @apply px-1.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .runtime-status-orb-core {
    animation: none;
  }
}

@keyframes runtimeStatusPulse {
  0%,
  100% {
    transform: scale(0.82);
    opacity: 0.72;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
