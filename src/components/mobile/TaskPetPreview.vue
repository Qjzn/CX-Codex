<template>
  <div class="task-pet-preview" :class="{ 'is-expanded': expanded }" aria-label="任务宠物预览">
    <Transition name="task-pet-panel">
      <div v-if="expanded" class="task-pet-preview-panel">
        <div class="task-pet-preview-header">
          <span>
            <strong>任务进展</strong>
            <small>实时同步</small>
          </span>
          <span>{{ visibleItems.length > 0 ? `${visibleItems.length} 个进行中` : '当前空闲' }}</span>
        </div>
        <button
          v-for="item in visibleItems"
          :key="item.threadId"
          class="task-pet-preview-row"
          type="button"
          @click="$emit('open', item.threadId)"
        >
          <span class="task-pet-preview-dot" :data-state="item.state" />
          <span class="task-pet-preview-copy">
            <strong>{{ item.title }}</strong>
            <small>{{ item.detail }}<template v-if="item.projectName"> · {{ item.projectName }}</template></small>
            <Transition name="task-pet-live" mode="out-in">
              <small :key="item.latestActivity || item.detail" class="task-pet-preview-live">
                {{ item.latestActivity ? `最新：${item.latestActivity}` : '实时更新 · 刚刚' }}
              </small>
            </Transition>
          </span>
          <span class="task-pet-preview-arrow" aria-hidden="true">›</span>
        </button>
        <p v-if="visibleItems.length === 0" class="task-pet-preview-empty">没有正在运行的任务</p>
      </div>
    </Transition>

    <button
      class="task-pet-preview-mascot"
      type="button"
      :aria-expanded="expanded"
      :aria-label="expanded ? '收起任务进展' : '展开任务进展'"
      @click="expanded = !expanded"
    >
      <span class="task-pet-preview-flame" aria-hidden="true">🔥</span>
      <span class="task-pet-preview-robot" aria-hidden="true">
        <span class="task-pet-preview-face">{{ hasWaitingTask ? '• ︵ •' : '• ᴗ •' }}</span>
      </span>
      <span class="task-pet-preview-laptop" aria-hidden="true">&gt;_</span>
      <span class="task-pet-preview-state">{{ hasWaitingTask ? '待处理' : visibleItems.length > 0 ? '工作中' : '待命' }}</span>
      <span v-if="items.length > 0" class="task-pet-preview-badge" :data-waiting="hasWaitingTask">
        {{ items.length > 99 ? '99+' : items.length }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiTaskPetItem } from '../../types/codex'

const props = withDefaults(defineProps<{
  items: UiTaskPetItem[]
  initiallyExpanded?: boolean
}>(), {
  initiallyExpanded: true,
})

defineEmits<{
  open: [threadId: string]
}>()

const expanded = ref(props.initiallyExpanded)
const visibleItems = computed(() => props.items.slice(0, 3))
const hasWaitingTask = computed(() => props.items.some((item) => item.state === 'waiting'))
</script>

<style scoped>
.task-pet-preview {
  display: flex;
  min-height: 112px;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-bg-secondary, #f4f5f7) 88%, transparent);
  border-radius: 12px;
}

.task-pet-preview-panel {
  width: min(258px, calc(100% - 88px));
  padding: 10px;
  background: var(--color-bg-primary, #fff);
  border-radius: 14px;
  box-shadow: 0 4px 8px rgb(15 23 42 / 12%);
  transform-origin: right bottom;
}

.task-pet-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  color: var(--color-text-primary, #1d2430);
  font-size: 13px;
}

.task-pet-preview-header span {
  color: var(--color-text-secondary, #596579);
  font-size: 11px;
}

.task-pet-preview-header > span:first-child {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.task-pet-preview-header small {
  color: var(--color-text-secondary, #596579);
  font-size: 9px;
  font-weight: 500;
}

.task-pet-preview-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: var(--color-bg-secondary, #f2f5f9);
  color: inherit;
  text-align: left;
  transition: background-color 140ms ease, transform 140ms ease;
}

.task-pet-preview-row:hover {
  background: color-mix(in srgb, var(--color-bg-secondary, #f2f5f9) 82%, var(--color-accent, #2a72e8));
}

.task-pet-preview-row:active {
  transform: scale(0.985);
}

.task-pet-preview-row:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
}

.task-pet-preview-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 999px;
  background: #2a72e8;
}

.task-pet-preview-dot[data-state='waiting'] {
  background: #c16f12;
}

.task-pet-preview-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.task-pet-preview-copy strong,
.task-pet-preview-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-pet-preview-copy strong {
  color: var(--color-text-primary, #1e2430);
  font-size: 12px;
}

.task-pet-preview-copy small {
  color: var(--color-text-secondary, #596579);
  font-size: 10px;
}

.task-pet-preview-copy .task-pet-preview-live {
  color: color-mix(in srgb, var(--color-accent, #2a72e8) 78%, #263449);
  font-size: 9px;
}

.task-pet-preview-arrow {
  color: var(--color-text-secondary, #596579);
  font-size: 20px;
}

.task-pet-preview-empty {
  margin: 8px 0 2px;
  color: var(--color-text-secondary, #596579);
  font-size: 12px;
}

.task-pet-preview-mascot {
  position: relative;
  width: 84px;
  height: 104px;
  flex: none;
  border: 0;
  background: transparent;
  color: #241f1c;
  touch-action: none;
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), opacity 100ms ease-out;
}

.task-pet-preview-mascot:active {
  transform: scale(0.97);
}

.task-pet-preview-mascot:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
  border-radius: 12px;
}

.task-pet-preview-flame {
  position: absolute;
  top: 0;
  left: 50%;
  font-size: 30px;
  transform: translateX(-50%);
}

.task-pet-preview-robot {
  position: absolute;
  top: 29px;
  left: 7px;
  display: grid;
  width: 70px;
  height: 58px;
  place-items: center;
  border-radius: 14px;
  background: #f26925;
  box-shadow: 0 3px 7px rgb(80 35 12 / 22%);
}

.task-pet-preview-face {
  display: grid;
  width: 54px;
  height: 35px;
  place-items: center;
  border-radius: 10px;
  background: #ffda9f;
  font-size: 17px;
  font-weight: 800;
}

.task-pet-preview-laptop {
  position: absolute;
  right: 3px;
  bottom: 10px;
  display: grid;
  width: 43px;
  height: 25px;
  place-items: center;
  border-radius: 5px;
  background: #363d49;
  color: white;
  font: 700 11px/1 ui-monospace, monospace;
}

.task-pet-preview-state,
.task-pet-preview-badge {
  position: absolute;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-weight: 700;
}

.task-pet-preview-state {
  bottom: 0;
  left: 0;
  min-width: 46px;
  height: 21px;
  padding: 0 7px;
  background: rgb(255 255 255 / 94%);
  color: #354052;
  font-size: 10px;
}

.task-pet-preview-badge {
  top: 5px;
  right: 0;
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  background: #2a72e8;
  color: white;
  font-size: 11px;
}

.task-pet-preview-badge[data-waiting='true'] {
  background: #b9670c;
}

.task-pet-panel-enter-active {
  transition: opacity 160ms ease-out, transform 190ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-panel-leave-active {
  transition: opacity 110ms ease-in, transform 130ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-panel-enter-from,
.task-pet-panel-leave-to {
  opacity: 0;
  transform: translateY(5px) scaleY(0.94);
}

.task-pet-live-enter-active,
.task-pet-live-leave-active {
  transition: opacity 100ms ease-out, transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-live-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.task-pet-live-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (max-width: 420px) {
  .task-pet-preview {
    align-items: flex-end;
  }

  .task-pet-preview-panel {
    width: calc(100% - 82px);
  }

  .task-pet-preview-copy small {
    max-width: 22ch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-pet-preview *,
  .task-pet-preview *::before,
  .task-pet-preview *::after {
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
  }
}
</style>
