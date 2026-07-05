<template>
  <main class="conversation-regression-fixture" aria-label="Conversation block regression fixture">
    <section class="conversation-regression-shell">
      <header class="conversation-regression-header">
        <p class="conversation-regression-kicker">Regression Fixture</p>
        <h1>Conversation Blocks</h1>
      </header>
      <ThreadConversation
        class="conversation-regression-thread"
        :messages="messages"
        :pending-requests="[]"
        :live-overlay="null"
        :is-loading="false"
        active-thread-id="regression-conversation-blocks"
        cwd="E:/javaword/CXCodex/codexui"
        :scroll-state="null"
        :favorite-message-ids="[]"
        @update-scroll-state="noop"
        @respond-server-request="noop"
        @rollback="noop"
        @toggle-favorite="noop"
        @return-to-new-thread="noop"
        @dismiss-empty-thread="noop"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import ThreadConversation from './ThreadConversation.vue'
import type { UiMessage } from '../../types/codex'

const messages: UiMessage[] = [
  {
    id: 'fixture-user-files',
    role: 'user',
    text: '请审查这些文件，并说明代码块、diff 和 raw payload 的结构化显示是否正常。',
    fileAttachments: [
      {
        label: 'PRODUCT.md',
        path: 'E:/javaword/CXCodex/codexui/PRODUCT.md',
      },
      {
        label: 'ThreadConversation.vue',
        path: 'E:/javaword/CXCodex/codexui/src/components/content/ThreadConversation.vue',
      },
    ],
    turnIndex: 1,
  },
  {
    id: 'fixture-assistant-blocks',
    role: 'assistant',
    text: [
      '下面是用于 P1 回归的结构化消息块 fixture。',
      '',
      '```ts',
      'export const fixtureCodeBlock = "fixture-code-block"',
      'console.log(fixtureCodeBlock)',
      '```',
      '',
      '```diff',
      'diff --git a/src/example.ts b/src/example.ts',
      '@@ -1,3 +1,3 @@',
      '-const state = "old"',
      '+const state = "new"',
      ' console.log(state)',
      '```',
      '',
      '| 类型 | 状态 |',
      '| --- | --- |',
      '| code | copy-ready |',
      '| diff | highlighted |',
    ].join('\n'),
    turnIndex: 1,
  },
  {
    id: 'fixture-raw-payload',
    role: 'system',
    text: '',
    messageType: 'rawResponseItem/completed',
    rawPayload: JSON.stringify({
      type: 'rawResponseItem/completed',
      marker: 'fixture-raw-payload',
      item: {
        kind: 'unknown-tool-output',
        summary: 'Raw payload must stay inspectable but folded behind a structured card.',
      },
    }),
    isUnhandled: true,
    turnIndex: 1,
  },
]

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
}
</script>

<style scoped>
@reference "tailwindcss";

.conversation-regression-fixture {
  @apply min-h-dvh px-4 py-6;
  background: var(--ui-bg-window);
  color: var(--ui-text-primary);
}

.conversation-regression-shell {
  @apply mx-auto flex min-h-[calc(100dvh-3rem)] max-w-4xl flex-col overflow-hidden border;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.conversation-regression-header {
  @apply shrink-0 border-b px-4 py-3;
  border-color: var(--ui-border-subtle);
}

.conversation-regression-kicker {
  @apply m-0 text-xs font-medium;
  color: var(--ui-text-tertiary);
}

.conversation-regression-header h1 {
  @apply m-0 mt-1 text-lg font-semibold;
  color: var(--ui-text-primary);
}

.conversation-regression-thread {
  @apply min-h-0 flex-1;
}
</style>
