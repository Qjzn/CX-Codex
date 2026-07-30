<template>
  <section class="conversation-loading-skeleton" role="status" aria-label="正在打开会话">
    <div class="conversation-loading-skeleton-stack" aria-hidden="true">
      <span class="conversation-loading-skeleton-line conversation-loading-skeleton-line--short" />
      <span class="conversation-loading-skeleton-line" />
      <span class="conversation-loading-skeleton-line conversation-loading-skeleton-line--medium" />
      <span class="conversation-loading-skeleton-line conversation-loading-skeleton-line--reply" />
    </div>
  </section>
</template>

<style scoped>
.conversation-loading-skeleton {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 24px clamp(16px, 4vw, 40px);
}

.conversation-loading-skeleton-stack {
  display: flex;
  width: min(100%, var(--ui-content-max));
  margin: 0 auto;
  flex-direction: column;
  gap: 14px;
}

.conversation-loading-skeleton-line {
  display: block;
  width: 78%;
  height: 48px;
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface-muted);
  background-image: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--ui-bg-surface) 82%, transparent) 42%,
    transparent 64%
  );
  background-size: 220% 100%;
  animation: conversation-loading-sheen 1.1s var(--motion-ease-out) infinite;
}

.conversation-loading-skeleton-line--short {
  width: 42%;
  height: 18px;
}

.conversation-loading-skeleton-line--medium {
  width: 64%;
  height: 72px;
}

.conversation-loading-skeleton-line--reply {
  width: 38%;
  height: 42px;
  margin-left: auto;
}

@keyframes conversation-loading-sheen {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-loading-skeleton-line {
    animation: none;
  }
}
</style>
