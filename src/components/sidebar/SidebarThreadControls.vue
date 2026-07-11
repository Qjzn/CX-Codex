<template>
  <div class="sidebar-thread-controls">
    <button
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      :title="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      @click="$emit('toggle-sidebar')"
    >
      <IconTablerLayoutSidebarFilled v-if="isSidebarCollapsed" class="sidebar-thread-controls-icon" />
      <IconTablerLayoutSidebar v-else class="sidebar-thread-controls-icon" />
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
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'

defineProps<{
  isSidebarCollapsed: boolean
  showNewThreadButton?: boolean
}>()

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
  @apply h-9 w-9 border border-transparent bg-transparent flex items-center justify-center transition;
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
</style>
