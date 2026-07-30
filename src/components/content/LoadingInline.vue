<template>
  <div
    class="loading-inline"
    :class="[compact ? 'loading-inline--compact' : '', `loading-inline--${tone}`]"
    role="status"
    aria-live="polite"
  >
    <span class="loading-inline-marker" aria-hidden="true">
      <span class="loading-inline-marker-ring" />
      <span class="loading-inline-marker-core" />
    </span>
    <span class="loading-inline-copy">
      <span class="loading-inline-label">{{ label }}</span>
      <span class="loading-inline-dots" aria-hidden="true">
        <span class="loading-inline-dot" />
        <span class="loading-inline-dot" />
        <span class="loading-inline-dot" />
      </span>
    </span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    compact?: boolean
    tone?: 'teal' | 'warm' | 'muted'
  }>(),
  {
    compact: false,
    tone: 'teal',
  },
)
</script>

<style scoped>
@reference "tailwindcss";

.loading-inline {
  @apply inline-flex min-w-0 items-center gap-2.5 text-[#0f766e];
}

.loading-inline--compact {
  @apply gap-2;
}

.loading-inline--warm {
  @apply text-[#8a6a11];
}

.loading-inline--muted {
  @apply text-[#6d6354];
}

.loading-inline-marker {
  @apply relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full;
}

.loading-inline-marker-ring {
  @apply absolute inset-0 rounded-full border;
  border-color: color-mix(in srgb, currentColor 18%, transparent);
  border-top-color: currentColor;
  animation: loadingInlineSpin 1.15s linear infinite;
}

.loading-inline-marker-core {
  @apply block h-2 w-2 rounded-full;
  background: currentColor;
  animation: loadingInlinePulse 1.3s ease-in-out infinite;
}

.loading-inline-copy {
  @apply min-w-0 inline-flex items-center gap-1.5;
}

.loading-inline-label {
  @apply min-w-0 text-sm font-medium leading-5;
}

.loading-inline--compact .loading-inline-label {
  @apply text-xs leading-4;
}

.loading-inline-dots {
  @apply inline-flex items-center gap-1;
}

.loading-inline-dot {
  @apply h-1.5 w-1.5 rounded-full;
  background: currentColor;
  opacity: 0.25;
  animation: loadingInlineDot 1.1s ease-in-out infinite;
}

.loading-inline-dot:nth-child(2) {
  animation-delay: 0.14s;
}

.loading-inline-dot:nth-child(3) {
  animation-delay: 0.28s;
}

@keyframes loadingInlineSpin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes loadingInlinePulse {
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

@keyframes loadingInlineDot {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.22;
  }
  45% {
    transform: translateY(-2px);
    opacity: 0.9;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-inline-marker-ring,
  .loading-inline-marker-core,
  .loading-inline-dot {
    animation: none !important;
  }
}
</style>
