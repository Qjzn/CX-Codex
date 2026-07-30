<template>
  <section class="sidebar-loading-skeleton" role="status" aria-label="正在加载会话列表">
    <div class="sidebar-loading-skeleton-heading" aria-hidden="true">
      <span class="sidebar-loading-skeleton-line sidebar-loading-skeleton-line--title" />
      <span class="sidebar-loading-skeleton-line sidebar-loading-skeleton-line--meta" />
    </div>
    <div class="sidebar-loading-skeleton-rows" aria-hidden="true">
      <span v-for="index in 5" :key="index" class="sidebar-loading-skeleton-row" />
    </div>
  </section>
</template>

<style scoped>
.sidebar-loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}

.sidebar-loading-skeleton-heading {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-loading-skeleton-line,
.sidebar-loading-skeleton-row {
  display: block;
  overflow: hidden;
  border-radius: var(--ui-radius-row);
  background: var(--ui-bg-surface-muted);
  position: relative;
}

.sidebar-loading-skeleton-line::after,
.sidebar-loading-skeleton-row::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ui-bg-surface) 78%, transparent), transparent);
  animation: sidebar-loading-sheen 900ms var(--motion-ease-out) 1 both;
}

.sidebar-loading-skeleton-line--title {
  width: 56px;
  height: 12px;
}

.sidebar-loading-skeleton-line--meta {
  width: 76px;
  height: 10px;
}

.sidebar-loading-skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-loading-skeleton-row {
  height: 44px;
  border: 1px solid var(--ui-border-subtle);
}

@keyframes sidebar-loading-sheen {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-loading-skeleton-line::after,
  .sidebar-loading-skeleton-row::after {
    animation: none;
  }
}
</style>
