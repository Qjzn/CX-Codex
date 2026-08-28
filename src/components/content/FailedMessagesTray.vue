<template>
  <section v-if="messages.length > 0" class="failed-messages-tray" aria-label="未发送消息">
    <button
      class="failed-messages-summary"
      type="button"
      :aria-expanded="expanded"
      aria-controls="failed-messages-list"
      @click="expanded = !expanded"
    >
      <span class="failed-messages-indicator" aria-hidden="true" />
      <span class="failed-messages-title">未发送消息</span>
      <span class="failed-messages-count">{{ messages.length }}</span>
      <span class="failed-messages-hint">{{ expanded ? '收起' : '查看并处理' }}</span>
      <svg class="failed-messages-chevron" :class="{ 'is-expanded': expanded }" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
      </svg>
    </button>

    <div v-if="expanded" id="failed-messages-list" class="failed-messages-list" role="status" aria-live="polite">
      <p class="failed-messages-caption">这些历史消息未能确认发送，已从最新回复下方移出。</p>
      <article v-for="message in messages" :key="message.id" class="failed-message-row">
        <p class="failed-message-preview">{{ messagePreview(message) }}</p>
        <div class="failed-message-actions">
          <button type="button" @click="$emit('edit', message.id)">编辑</button>
          <button type="button" class="is-primary" @click="$emit('retry', message.id)">重试</button>
          <button
            type="button"
            class="failed-message-delete"
            title="删除未发送消息"
            aria-label="删除未发送消息"
            @click="$emit('delete', message.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
            </svg>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { UiMessage } from '../../types/codex'

defineProps<{
  messages: UiMessage[]
}>()

defineEmits<{
  edit: [messageId: string]
  retry: [messageId: string]
  delete: [messageId: string]
}>()

const expanded = ref(false)

function messagePreview(message: UiMessage): string {
  const text = message.text.trim()
  if (text) return text
  const parts: string[] = []
  const imageCount = message.images?.length ?? 0
  const fileCount = message.fileAttachments?.length ?? 0
  if (imageCount > 0) parts.push(`${imageCount} 张图片`)
  if (fileCount > 0) parts.push(`${fileCount} 个文件`)
  return parts.join('，') || '未发送内容'
}
</script>

<style scoped>
@reference "tailwindcss";

.failed-messages-tray {
  @apply w-full max-w-175 mx-auto px-2 sm:px-6;
}

.failed-messages-summary {
  @apply flex w-full min-w-0 items-center gap-2 border px-3 py-2 text-left transition;
  min-height: 40px;
  border-radius: var(--ui-radius-control);
  border-color: color-mix(in srgb, var(--ui-warning) 24%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-warning) 5%, var(--ui-bg-surface));
  color: var(--ui-text-secondary);
}

.failed-messages-summary:hover {
  border-color: color-mix(in srgb, var(--ui-warning) 36%, var(--ui-border-strong));
  background: color-mix(in srgb, var(--ui-warning) 8%, var(--ui-bg-surface));
}

.failed-messages-summary:focus-visible,
.failed-message-actions button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

.failed-messages-indicator {
  @apply h-2 w-2 shrink-0 rounded-full;
  background: var(--ui-warning);
}

.failed-messages-title {
  @apply min-w-0 text-sm font-semibold;
  color: var(--ui-text-primary);
}

.failed-messages-count {
  @apply inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold;
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg-surface));
  color: color-mix(in srgb, var(--ui-warning) 82%, var(--ui-text-primary));
}

.failed-messages-hint {
  @apply ml-auto truncate text-xs;
  color: var(--ui-text-tertiary);
}

.failed-messages-chevron {
  @apply h-4 w-4 shrink-0 transition-transform;
}

.failed-messages-chevron.is-expanded {
  transform: rotate(180deg);
}

.failed-messages-list {
  @apply mt-1.5 flex max-h-[30dvh] flex-col gap-1.5 overflow-y-auto border px-2.5 py-2;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.failed-messages-caption {
  @apply m-0 text-xs leading-4;
  color: var(--ui-text-tertiary);
}

.failed-message-row {
  @apply flex min-w-0 items-center gap-2 border px-2.5 py-2;
  border-radius: var(--ui-radius-card);
  border-color: color-mix(in srgb, var(--ui-warning) 22%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-warning) 4%, var(--ui-bg-surface));
}

.failed-message-preview {
  @apply m-0 min-w-0 flex-1 text-sm leading-5;
  color: var(--ui-text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.failed-message-actions {
  @apply flex shrink-0 items-center gap-1;
}

.failed-message-actions button {
  @apply border px-2.5 py-1 text-xs font-medium transition;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
}

.failed-message-actions button:hover {
  border-color: var(--ui-border-strong);
  color: var(--ui-text-primary);
}

.failed-message-actions button.is-primary {
  border-color: color-mix(in srgb, var(--ui-accent) 26%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-surface));
  color: var(--ui-accent);
}

.failed-message-actions button.failed-message-delete {
  @apply inline-flex h-7 w-7 items-center justify-center border-0 p-0;
  background: transparent;
  color: var(--ui-text-tertiary);
}

.failed-message-delete svg {
  @apply h-4 w-4;
}

@media (max-width: 767px) {
  .failed-messages-tray {
    @apply px-2.5;
  }

  .failed-messages-summary {
    min-height: 44px;
  }

  .failed-message-row {
    @apply items-start flex-col;
  }

  .failed-message-actions {
    @apply w-full justify-end;
  }

  .failed-message-actions button {
    min-height: 36px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .failed-messages-chevron,
  .failed-messages-summary,
  .failed-message-actions button {
    transition: none;
  }
}
</style>
