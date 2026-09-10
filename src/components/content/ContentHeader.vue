<template>
  <header class="content-header">
    <div class="content-header-main">
      <div v-if="hasLeading" class="content-leading">
        <slot name="leading" />
      </div>
      <div class="content-title-wrap">
        <div class="content-title-line">
          <div v-if="hasTitlePrefix" class="content-title-prefix">
            <slot name="title-prefix" />
          </div>
          <h1 class="content-title">{{ title }}</h1>
          <div v-if="hasSubtitle" class="content-subtitle">
            <slot name="subtitle" />
          </div>
        </div>
      </div>
      <div v-if="hasTitleSuffix" class="content-title-suffix">
        <slot name="title-suffix" />
      </div>
      <div v-if="hasMeta" class="content-meta">
        <slot name="meta" />
      </div>
      <div v-if="hasActions" class="content-actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'

defineProps<{
  title: string
}>()

const slots = useSlots()
const hasLeading = computed(() => Boolean(slots.leading))
const hasSubtitle = computed(() => Boolean(slots.subtitle))
const hasMeta = computed(() => Boolean(slots.meta))
const hasActions = computed(() => Boolean(slots.actions))
const hasTitlePrefix = computed(() => Boolean(slots['title-prefix']))
const hasTitleSuffix = computed(() => Boolean(slots['title-suffix']))
</script>

<style scoped>
@reference "tailwindcss";

.content-header {
  @apply sticky top-0 z-20 w-full px-3 sm:px-4 border-b;
  height: var(--ui-topbar-height);
  min-height: var(--ui-topbar-height);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.content-header-main {
  @apply w-full h-full min-h-0 flex items-center gap-2;
  width: min(100%, var(--content-shell-max-width, var(--ui-content-max)));
  margin-inline: auto;
}

.content-title {
  @apply m-0 min-w-0 truncate text-[14px] font-semibold leading-5;
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
  letter-spacing: var(--tracking-tight-soft);
}

.content-title-wrap {
  @apply min-w-0 flex-1;
}

.content-title-line {
  @apply min-w-0 flex items-baseline gap-1.5;
}

.content-title-prefix {
  @apply shrink-0 flex items-center;
}

.content-title-suffix {
  @apply shrink-0 flex items-center gap-1;
}

.content-subtitle {
  @apply min-w-0 flex-1 truncate;
}

.content-actions {
  @apply shrink-0 flex items-center justify-end gap-1.5;
}

.content-leading {
  @apply flex items-center gap-1;
}

.content-meta {
  @apply min-w-0 shrink-0 flex items-center;
  max-width: min(48%, 24rem);
}

@media (max-width: 767px) {
  .content-header {
    @apply px-2;
    height: calc(var(--ui-topbar-height) + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
  }

  .content-header-main {
    @apply gap-1.5;
  }

  .content-title {
    @apply text-[14px] leading-5;
    letter-spacing: 0;
  }

  .content-subtitle {
    @apply hidden;
  }

  .content-meta {
    max-width: 5rem;
  }
}
</style>
