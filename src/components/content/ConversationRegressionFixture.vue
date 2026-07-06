<template>
  <main class="conversation-regression-fixture" aria-label="Conversation block regression fixture">
    <section class="conversation-regression-shell">
      <header class="conversation-regression-header">
        <p class="conversation-regression-kicker">Regression Fixture</p>
        <h1>Conversation Blocks</h1>
      </header>
      <RuntimeStatusBar
        class="conversation-regression-runtime"
        :summary="runtimeSummary"
        :live-overlay="liveOverlay"
        :pending-request-count="0"
        :is-sending="false"
        :is-loading="true"
        :is-refreshing="false"
        :sync-lagging="false"
        sync-error=""
        :notification-stale="false"
        connection-state="connected"
        @refresh="noop"
        @stop="noop"
      />
      <ThreadConversation
        class="conversation-regression-thread"
        :messages="messages"
        :pending-requests="pendingRequests"
        :live-overlay="liveOverlay"
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
      <QueuedMessages
        class="conversation-regression-queue"
        :messages="queuedMessages"
        :is-processing="true"
        @edit="noop"
        @quote="noop"
        @delete="noop"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import ThreadConversation from './ThreadConversation.vue'
import RuntimeStatusBar from './RuntimeStatusBar.vue'
import QueuedMessages from './QueuedMessages.vue'
import type { UiLiveOverlay, UiMessage, UiRuntimeStatusSummary, UiServerRequest } from '../../types/codex'

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
    id: 'fixture-hidden-file-change-noise',
    role: 'system',
    text: 'Unhandled App Server item: fileChange',
    messageType: 'unhandled.fileChange',
    rawPayload: JSON.stringify({
      type: 'fileChange',
      marker: 'fixture-hidden-file-change-noise',
      summary: 'This low-value system item should not render in the normal conversation flow.',
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
  ...Array.from({ length: 8 }, (_, index): UiMessage => ({
    id: `fixture-latest-turn-progress-${String(index + 1)}`,
    role: 'system',
    text: `fixture latest turn progress ${String(index + 1)}`,
    messageType: 'fixture.progress',
    turnIndex: 1,
  })),
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

const liveOverlay: UiLiveOverlay = {
  activityLabel: 'fixture runtime activity',
  activityDetails: ['fixture runtime detail should stay compact and neutral'],
  reasoningText: 'fixture reasoning text',
  errorText: '',
}

const runtimeSummary: UiRuntimeStatusSummary = {
  threadId: 'regression-conversation-blocks',
  executionState: 'running',
  canStop: true,
  stale: false,
  stopRequested: false,
  activeTurnId: 'fixture-turn-runtime',
  lastError: null,
  degradedReason: null,
  messageState: 'fresh',
  updatedAtIso: '2026-07-05T05:02:00.000Z',
  lastEventSeq: 7420,
  lastStartedAtIso: '2026-07-05T05:00:00.000Z',
  lastCompletedAtIso: null,
}

const queuedMessages = [
  {
    id: 'fixture-queue-next',
    text: 'fixture queued message keeps compact neutral styling',
    imageUrls: [],
    skills: [{ name: 'ui-ux-pro-max', path: 'C:/Users/SW/.agents/skills/ui-ux-pro-max/SKILL.md' }],
    fileAttachments: [
      {
        label: 'PRODUCT.md',
        path: 'E:/javaword/CXCodex/codexui/PRODUCT.md',
        fsPath: 'E:/javaword/CXCodex/codexui/PRODUCT.md',
      },
    ],
  },
  {
    id: 'fixture-queue-followup',
    text: 'second queued item should not introduce warm panels',
    imageUrls: [],
    skills: [],
    fileAttachments: [],
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

.conversation-regression-runtime {
  @apply shrink-0;
}

.conversation-regression-queue {
  @apply shrink-0 pb-3;
}
</style>
