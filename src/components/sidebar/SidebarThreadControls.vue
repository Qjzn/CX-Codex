<template>
  <div class="sidebar-thread-controls">
    <button
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="sidebarToggleLabel"
      :title="sidebarToggleLabel"
      @click="$emit('toggle-sidebar')"
    >
      <IconTablerLayoutSidebarFilled v-if="isSidebarCollapsed" class="sidebar-thread-controls-icon" />
      <IconTablerLayoutSidebar v-else class="sidebar-thread-controls-icon" />
      <span
        v-if="isSidebarCollapsed && normalizedAttentionCount > 0"
        class="sidebar-thread-controls-attention-badge"
        aria-hidden="true"
      >{{ attentionBadgeText }}</span>
    </button>

    <button
      v-if="showNewThreadButton"
      class="sidebar-thread-controls-button"
      type="button"
      aria-label="新建会话"
      title="新建会话"
      @click="$emit('start-new-thread')"
    >
      <IconTablerFilePencil class="sidebar-thread-controls-icon" />
    </button>

    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'

const props = withDefaults(defineProps<{
  isSidebarCollapsed: boolean
  attentionCount?: number
  showNewThreadButton?: boolean
}>(), {
  attentionCount: 0,
  showNewThreadButton: false,
})

const normalizedAttentionCount = computed(() => (
  Number.isFinite(props.attentionCount)
    ? Math.max(0, Math.trunc(props.attentionCount))
    : 0
))
const attentionBadgeText = computed(() => (
  normalizedAttentionCount.value > 9 ? '9+' : String(normalizedAttentionCount.value)
))
const sidebarToggleLabel = computed(() => {
  if (!props.isSidebarCollapsed) return '收起侧栏'
  if (normalizedAttentionCount.value <= 0) return '展开侧栏'
  return `展开侧栏，${String(normalizedAttentionCount.value)} 个任务需要关注`
})

defineEmits<{
  'toggle-sidebar': []
  'start-new-thread': []
}>()
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-thread-controls {
  @apply flex flex-row flex-nowrap items-center gap-2;
}

.sidebar-thread-controls-button {
  @apply relative h-9 w-9 border border-transparent bg-transparent flex items-center justify-center transition;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease;
  box-shadow: none;
}

.sidebar-thread-controls-button:hover,
.sidebar-thread-controls-button:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.sidebar-thread-controls-button:active {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-row-active);
  color: var(--ui-text-primary);
  box-shadow: none;
}

.sidebar-thread-controls-icon {
  @apply w-4 h-4;
}

.sidebar-thread-controls-attention-badge {
  @apply absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] font-semibold leading-none text-white;
  border-radius: var(--ui-radius-pill);
  background: var(--ui-warning);
}
</style>
