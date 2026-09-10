<template>
  <span
    class="execution-clock"
    :class="{ 'turn-live-state': turn.state === 'running' || turn.state === 'sync-degraded' }"
    :data-state="turn.state"
    :data-execution-state="turn.state"
    :data-chat-feedback-kind="turn.state === 'running' ? 'running' : undefined"
    :data-chat-feedback-thread-id="threadId"
    :data-chat-feedback-turn-id="turn.id"
  >
    <span v-if="turn.state === 'running'" class="execution-pulse turn-live-dot" aria-hidden="true" />
    <span role="status">{{ label }}</span>
    <span v-if="elapsed !== null" class="execution-elapsed" aria-live="off">· {{ formattedElapsed }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ConversationTurn } from '../../conversation-transcript'

const props = defineProps<{ turn: ConversationTurn; generatedAtMs: number; threadId: string }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
const ticking = computed(() => props.turn.state === 'running'
  && props.turn.timingStatus === 'running' && props.turn.activeElapsedMs !== null)
const elapsed = computed(() => {
  if (props.turn.state === 'sync-degraded' || props.turn.state === 'queued') return null
  const base = props.turn.activeElapsedMs
  if (base === null) return null
  return base + (ticking.value ? Math.max(0, now.value - props.generatedAtMs) : 0)
})
const formattedElapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((elapsed.value ?? 0) / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${pad(minutes)}:${pad(seconds % 60)}`
    : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds % 60)}`
})
const label = computed(() => {
  switch (props.turn.state) {
    case 'running': return '正在处理'
    case 'waiting': return '等待你的处理'
    case 'queued': return '等待执行'
    case 'sync-degraded': return '正在更新状态'
    default: return elapsed.value === null ? '过程记录' : '耗时'
  }
})

function updateTimer(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  now.value = Date.now()
  if (ticking.value && document.visibilityState === 'visible') {
    timer = setInterval(() => { now.value = Date.now() }, 1000)
  }
}
watch(ticking, updateTimer)
watch(() => props.generatedAtMs, () => { now.value = Date.now() })
onMounted(() => {
  document.addEventListener('visibilitychange', updateTimer)
  updateTimer()
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
  document.removeEventListener('visibilitychange', updateTimer)
})
</script>

<style scoped>
.execution-clock { display: inline-flex; align-items: center; gap: 6px; }
.execution-elapsed { font-variant-numeric: tabular-nums; }
.execution-pulse { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--ui-accent); animation: execution-pulse 1.6s ease-in-out infinite; }
@keyframes execution-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .execution-pulse { animation: none; } }
</style>
