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
        :pending-requests="pendingRequests"
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
import type { UiMessage, UiServerRequest } from '../../types/codex'

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
  {
    id: 'fixture-command-output',
    role: 'system',
    text: '',
    messageType: 'commandExecution',
    commandExecution: {
      command: 'npm.cmd run test:7420:frontend -- --fixture command-output',
      cwd: 'E:/javaword/CXCodex/codexui',
      status: 'completed',
      aggregatedOutput: [
        '> fixture command output',
        'fixture-command-output: ok',
        'checked structured command block rendering',
      ].join('\n'),
      exitCode: 0,
      durationMs: 1450,
      startedAtMs: 1783227600000,
    },
    turnIndex: 1,
  },
]

const pendingRequests: UiServerRequest[] = [
  {
    id: 742001,
    method: 'elicitation/create',
    threadId: 'regression-conversation-blocks',
    turnId: 'fixture-turn-permission',
    itemId: 'fixture-mcp-permission',
    receivedAtIso: '2026-07-05T05:00:00.000Z',
    params: {
      message: 'Allow the chrome MCP server to run tool "browser_click"?',
      serverName: 'chrome',
      toolName: 'browser_click',
      reason: 'fixture-permission-workbench',
    },
  },
  {
    id: 742002,
    method: 'item/tool/call',
    threadId: 'regression-conversation-blocks',
    turnId: 'fixture-turn-tool-call',
    itemId: 'fixture-tool-call',
    receivedAtIso: '2026-07-05T05:01:00.000Z',
    params: {
      toolName: 'browser_click',
      serverName: 'chrome',
      reason: 'fixture-tool-call-workbench',
      summary: 'Browser tool call cannot be executed directly in this web surface.',
    },
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
