<template>
  <section class="runtime-status-bar" :data-tone="tone" aria-live="polite">
    <div class="runtime-status-primary">
      <span class="runtime-status-orb" aria-hidden="true">
        <span class="runtime-status-orb-core" />
      </span>
      <div class="runtime-status-copy">
        <p class="runtime-status-title">{{ title }}</p>
        <p v-if="detail" class="runtime-status-detail">{{ detail }}</p>
      </div>
    </div>

    <ol class="runtime-status-phases" aria-label="任务状态阶段">
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
      <span v-if="metaLabel" class="runtime-status-meta">{{ metaLabel }}</span>
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
  return '状态已收敛'
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
  if (props.liveOverlay?.activityDetails?.length) return props.liveOverlay.activityDetails[0]
  if (props.summary.messageState === 'cached') return '当前先展示缓存消息，后台会继续补齐最新内容。'
  if (props.summary.lastCompletedAtIso) return '最新结果已经落到当前会话。'
  return '7420 后端状态、消息快照和前端显示一致。'
})

const metaLabel = computed(() => {
  if (props.summary.activeTurnId) return `turn ${props.summary.activeTurnId.slice(0, 8)}`
  if (props.summary.lastEventSeq > 0) return `seq ${props.summary.lastEventSeq}`
  return ''
})
</script>

<style scoped>
@reference "tailwindcss";

.runtime-status-bar {
  @apply mx-auto flex w-full max-w-[var(--content-shell-max-width)] items-center gap-2 border-y border-[#e7dfd2] bg-[#fffdf8]/92 px-3 py-2 text-[#5f5548];
  font-family: var(--font-sans-ui);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.72) inset;
}

.runtime-status-primary {
  @apply flex min-w-0 flex-1 items-center gap-2;
}

.runtime-status-orb {
  @apply relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-current/20 bg-white/78;
}

.runtime-status-orb-core {
  @apply h-3 w-3 rounded-full bg-current;
  animation: runtimeStatusPulse 1.4s ease-in-out infinite;
}

.runtime-status-copy {
  @apply min-w-0;
}

.runtime-status-title {
  @apply m-0 truncate text-sm font-semibold;
}

.runtime-status-detail {
  @apply m-0 hidden truncate text-xs leading-4 text-[#887d70] sm:block;
}

.runtime-status-phases {
  @apply hidden min-w-0 list-none items-center gap-1 p-0 md:flex;
}

.runtime-status-phase {
  @apply inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-[11px] text-[#928779];
}

.runtime-status-phase-dot {
  @apply h-1.5 w-1.5 rounded-full bg-current opacity-35;
}

.runtime-status-phase.is-done {
  @apply text-[#0f766e];
}

.runtime-status-phase.is-done .runtime-status-phase-dot {
  @apply opacity-100;
}

.runtime-status-phase.is-active {
  @apply border-current/20 bg-white/75 text-current;
}

.runtime-status-actions {
  @apply flex shrink-0 items-center gap-1.5;
}

.runtime-status-meta {
  @apply hidden rounded-full border border-[#e4dac9] bg-white/72 px-2 py-1 text-[10px] font-medium text-[#8a7f72] lg:inline-flex;
  font-family: var(--font-mono-ui);
}

.runtime-status-action {
  @apply inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-[#d9d0c2] bg-white/82 px-2.5 text-xs font-semibold text-[#5f5548] transition-[background-color,border-color,color,transform] duration-150 hover:border-[#bfae93] hover:bg-[#f7f1e5] disabled:cursor-not-allowed disabled:opacity-65;
  touch-action: manipulation;
}

.runtime-status-action:active:not(:disabled) {
  transform: translateY(1px);
}

.runtime-status-action-danger {
  @apply border-[#efc7bf] bg-[#fff4f1] text-[#a23f2c] hover:border-[#df9e90] hover:bg-[#ffe8e2] hover:text-[#7f2e20];
}

.runtime-status-action-icon {
  @apply h-3.5 w-3.5;
}

.runtime-status-bar[data-tone='live'] {
  @apply border-[#cbe7e1] bg-[#f2fbf8] text-[#0f766e];
}

.runtime-status-bar[data-tone='syncing'] {
  @apply border-[#d9d0c2] bg-[#fffaf2] text-[#6d6354];
}

.runtime-status-bar[data-tone='warning'] {
  @apply border-[#ead9a2] bg-[#fff8df] text-[#80600c];
}

.runtime-status-bar[data-tone='danger'] {
  @apply border-[#f0c1b8] bg-[#fff1ed] text-[#b13f2b];
}

.runtime-status-bar[data-tone='live'] .runtime-status-orb-core {
  animation: none;
}

@media (max-width: 767px) {
  .runtime-status-bar {
    @apply gap-2 px-2.5 py-1.5;
  }

  .runtime-status-title {
    @apply text-[13px];
  }

  .runtime-status-action {
    @apply min-h-9 px-2;
  }

  .runtime-status-action span {
    @apply sr-only;
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
