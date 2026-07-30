<template>
  <section class="page-loading-skeleton" role="status" aria-label="正在打开页面">
    <header class="page-loading-skeleton-header" aria-hidden="true">
      <span class="page-loading-skeleton-line page-loading-skeleton-line--title" />
      <span class="page-loading-skeleton-line page-loading-skeleton-line--subtitle" />
    </header>
    <div class="page-loading-skeleton-toolbar" aria-hidden="true">
      <span class="page-loading-skeleton-line page-loading-skeleton-line--field" />
      <span class="page-loading-skeleton-line page-loading-skeleton-line--button" />
    </div>
    <div class="page-loading-skeleton-grid" aria-hidden="true">
      <article v-for="index in 6" :key="index" class="page-loading-skeleton-card">
        <span class="page-loading-skeleton-line page-loading-skeleton-line--card-title" />
        <span class="page-loading-skeleton-line" />
        <span class="page-loading-skeleton-line page-loading-skeleton-line--short" />
      </article>
    </div>
  </section>
</template>

<style scoped>
@reference "tailwindcss";

.page-loading-skeleton {
  @apply mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-hidden px-3 py-3 sm:px-4;
}

.page-loading-skeleton-header {
  @apply flex flex-col gap-2;
}

.page-loading-skeleton-toolbar {
  @apply flex items-center gap-3 rounded-lg border p-3;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.page-loading-skeleton-grid {
  @apply grid gap-3 md:grid-cols-2 xl:grid-cols-3;
}

.page-loading-skeleton-card {
  @apply flex min-h-40 flex-col gap-3 rounded-lg border p-4;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.page-loading-skeleton-line {
  @apply block h-3 w-full rounded-md;
  background-color: var(--ui-bg-row-hover);
  background-image: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--ui-bg-surface) 82%, transparent) 42%,
    transparent 64%
  );
  background-size: 220% 100%;
  animation: page-loading-shimmer 1.25s ease-in-out infinite;
}

.page-loading-skeleton-line--title {
  @apply h-6 w-36;
}

.page-loading-skeleton-line--subtitle {
  @apply w-72 max-w-full;
}

.page-loading-skeleton-line--field {
  @apply h-9 flex-1;
}

.page-loading-skeleton-line--button {
  @apply h-9 w-20;
}

.page-loading-skeleton-line--card-title {
  @apply h-5 w-2/3;
}

.page-loading-skeleton-line--short {
  @apply w-3/4;
}

@keyframes page-loading-shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-loading-skeleton-line {
    animation: none;
  }
}
</style>
