<template>
  <header class="content-header">
    <div class="content-header-main">
      <div class="content-leading">
        <slot name="leading" />
      </div>
      <div class="content-title-wrap">
        <div class="content-title-line">
          <div v-if="hasTitlePrefix" class="content-title-prefix">
            <slot name="title-prefix" />
          </div>
          <h1 class="content-title">{{ title }}</h1>
          <div v-if="hasTitleSuffix" class="content-title-suffix">
            <slot name="title-suffix" />
          </div>
        </div>
        <slot name="subtitle" />
      </div>
      <div class="content-actions">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="hasMeta" class="content-meta">
      <slot name="meta" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'

defineProps<{
  title: string
}>()

const slots = useSlots()
const hasMeta = computed(() => Boolean(slots.meta))
const hasTitlePrefix = computed(() => Boolean(slots['title-prefix']))
const hasTitleSuffix = computed(() => Boolean(slots['title-suffix']))
</script>

<style scoped>
@reference "tailwindcss";

.content-header {
  @apply sticky top-0 z-20 w-full flex flex-col gap-1 px-3 sm:px-4 pt-2 sm:pt-2 pb-2 border-b;
  min-height: var(--ui-topbar-height);
  border-color: var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
  backdrop-filter: blur(10px);
}

.content-header-main {
  @apply w-full min-h-11 sm:min-h-12 flex items-center gap-2 sm:gap-3;
  width: min(100%, var(--content-shell-max-width, var(--ui-content-max)));
  margin-inline: auto;
}

.content-title {
  @apply m-0 min-w-0 truncate text-[16px] sm:text-[17px] font-semibold leading-6;
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
  letter-spacing: var(--tracking-tight-soft);
}

.content-title-wrap {
  @apply min-w-0 flex-1 flex flex-col gap-0.5;
}

.content-title-line {
  @apply min-w-0 flex items-center gap-1.5;
}

.content-title-prefix {
  @apply shrink-0 flex items-center;
}

.content-title-suffix {
  @apply shrink-0 flex items-center;
}

.content-actions {
  @apply flex items-center justify-end gap-2;
}

.content-leading {
  @apply flex items-center gap-1;
}

.content-meta {
  @apply flex flex-wrap items-center gap-1.5 min-h-0;
  width: min(100%, var(--content-shell-max-width, var(--ui-content-max)));
  margin-inline: auto;
}

@media (min-width: 1024px) {
  .content-header {
    @apply px-4 pt-2.5 pb-2.5;
  }
}

@media (max-width: 767px) {
  .content-header {
    @apply gap-0.5 px-3 pb-1.5;
    padding-top: max(0.35rem, env(safe-area-inset-top));
  }

  .content-header-main {
    @apply min-h-10 gap-2;
  }

  .content-title {
    @apply text-[15px] leading-5;
    letter-spacing: 0;
  }

  .content-meta {
    @apply gap-1;
  }
}
</style>
