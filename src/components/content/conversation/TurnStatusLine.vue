<template>
  <button
    v-if="hasProcess"
    type="button"
    class="process-toggle turn-timing"
    :data-status="turn.timingStatus"
    :aria-expanded="expanded"
    :disabled="active"
    @click="emit('toggle')"
  >
    <TurnExecutionClock :turn="turn" :generated-at-ms="generatedAtMs" :thread-id="threadId" :detail="detail" />
    <span v-if="waitLabel" class="turn-wait-time">等待你 {{ waitLabel }}</span>
    <span
      v-if="!active"
      class="process-toggle-icon"
      :class="{ 'is-expanded': expanded }"
      aria-hidden="true"
    >›</span>
  </button>
  <div
    v-else-if="hasTiming"
    class="turn-timing turn-timing--static"
    :data-status="turn.timingStatus"
  >
    <TurnExecutionClock :turn="turn" :generated-at-ms="generatedAtMs" :thread-id="threadId" :detail="detail" />
    <span v-if="waitLabel" class="turn-wait-time">等待你 {{ waitLabel }}</span>
  </div>
</template>

<script setup lang="ts">
// 展示组件：只决定"一行状态长什么样"，展开与否由父组件传入。
// 计时仍由 TurnExecutionClock 负责，这里不再复制一套时长逻辑。
import type { ConversationTurn } from '../../../conversation-transcript'
import TurnExecutionClock from '../TurnExecutionClock.vue'

defineProps<{
  turn: ConversationTurn
  generatedAtMs: number
  threadId: string
  detail: string
  hasProcess: boolean
  hasTiming: boolean
  active: boolean
  expanded: boolean
  waitLabel: string
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<style scoped>
.turn-timing {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.turn-timing--static {
  min-height: 32px;
  align-items: center;
}

.turn-timing[data-status='running'] {
  color: var(--ui-accent);
}

.process-toggle {
  display: inline-flex;
  min-width: 0;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  transition: color var(--motion-duration-fast) var(--motion-ease-standard);
}

.process-toggle:hover:not(:disabled),
.process-toggle:focus-visible {
  color: var(--ui-text-primary);
}

.process-toggle:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 3px;
  border-radius: 4px;
}

.process-toggle:disabled {
  cursor: default;
  opacity: 1;
}

.process-toggle-icon {
  display: inline-grid;
  width: 14px;
  height: 14px;
  place-items: center;
  color: var(--ui-text-tertiary);
  font-size: 16px;
  line-height: 1;
  transform-origin: center;
  transition: transform var(--motion-duration-base) var(--motion-ease-out);
}

.process-toggle-icon.is-expanded {
  transform: rotate(90deg);
}

.turn-status-counts {
  color: var(--ui-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.turn-wait-time {
  color: var(--ui-warning);
}

@media (max-width: 767px) {
  .process-toggle {
    min-height: 28px;
    font-size: 12.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .process-toggle-icon {
    transition-duration: 1ms;
  }
}
</style>
