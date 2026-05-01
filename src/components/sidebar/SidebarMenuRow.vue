<template>
  <component
    :is="props.as"
    class="sidebar-menu-row"
    :data-has-left="hasLeft"
    :data-has-right="hasRight"
    :data-has-right-hover="hasRightHover"
    :data-force-right-hover="props.forceRightHover"
    v-bind="$attrs"
  >
    <span v-if="hasLeft" class="sidebar-menu-row-left">
      <slot name="left" />
    </span>

    <span class="sidebar-menu-row-main">
      <slot />
    </span>

    <span v-if="hasRight" class="sidebar-menu-row-right">
      <span v-if="hasRightDefault" class="sidebar-menu-row-right-default">
        <slot name="right" />
      </span>
      <span v-if="hasRightHover" class="sidebar-menu-row-right-hover">
        <slot name="right-hover" />
      </span>
    </span>
  </component>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<{
    as?: string
    forceRightHover?: boolean
  }>(),
  {
    as: 'div',
    forceRightHover: false,
  },
)

const slots = useSlots()

const hasLeft = computed(() => Boolean(slots.left))
const hasRightDefault = computed(() => Boolean(slots.right))
const hasRightHover = computed(() => Boolean(slots['right-hover']))
const hasRight = computed(() => hasRightDefault.value || hasRightHover.value)
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-menu-row {
  @apply w-full min-w-0 rounded-[20px] px-3 py-2.5 text-left border border-transparent;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 0.625rem;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    opacity 150ms ease;
}

.sidebar-menu-row-left {
  @apply min-w-4 h-4 shrink-0 flex items-center justify-center text-zinc-500;
  margin-top: 0.125rem;
}

.sidebar-menu-row-main {
  @apply min-w-0;
}

.sidebar-menu-row-right {
  @apply shrink-0 flex items-start justify-end;
  min-width: 2.4rem;
}

.sidebar-menu-row-right-default,
.sidebar-menu-row-right-hover {
  @apply transition duration-150 items-start justify-end;
  display: inline-flex;
  width: 100%;
}

.sidebar-menu-row:hover,
.sidebar-menu-row:focus-within {
  box-shadow: 0 6px 16px -18px rgba(31, 41, 55, 0.12);
}

@media (max-width: 767px) {
  .sidebar-menu-row {
    @apply rounded-[14px] px-2.5 py-1.5;
    column-gap: 0.5rem;
  }

  .sidebar-menu-row-left {
    margin-top: 0.05rem;
  }
}

.sidebar-menu-row[data-has-right='true'] .sidebar-menu-row-right-hover {
  display: none;
}

.sidebar-menu-row[data-has-right='true'][data-has-right-hover='true']:hover .sidebar-menu-row-right-default,
.sidebar-menu-row[data-has-right='true'][data-has-right-hover='true']:focus-within .sidebar-menu-row-right-default {
  display: none;
}

.sidebar-menu-row[data-has-right='true'][data-has-right-hover='true']:hover .sidebar-menu-row-right-hover,
.sidebar-menu-row[data-has-right='true'][data-has-right-hover='true']:focus-within .sidebar-menu-row-right-hover {
  display: inline-flex;
  pointer-events: auto;
}

.sidebar-menu-row[data-has-right='true'][data-force-right-hover='true'] .sidebar-menu-row-right-default {
  display: none;
}

.sidebar-menu-row[data-has-right='true'][data-force-right-hover='true'] .sidebar-menu-row-right-hover {
  display: inline-flex;
  pointer-events: auto;
}
</style>
