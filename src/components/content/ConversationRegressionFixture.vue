<template>
  <main class="conversation-regression-fixture" aria-label="Conversation block regression fixture">
    <section class="conversation-regression-shell">
      <header class="conversation-regression-header">
        <p class="conversation-regression-kicker">Regression Fixture</p>
        <h1>Conversation Blocks</h1>
      </header>
      <div v-if="isScrollSwitchRaceFixture" class="conversation-scroll-switch-controls">
        <button type="button" data-testid="switch-scroll-thread-a" @click="activeThreadId = 'regression-scroll-a'">
          Thread A
        </button>
        <button type="button" data-testid="switch-scroll-thread-b" @click="activeThreadId = 'regression-scroll-b'">
          Thread B
        </button>
        <button
          v-if="isForegroundResumeScrollFixture"
          type="button"
          data-testid="append-resume-output"
          @click="appendResumeOutput"
        >
          Append output
        </button>
        <span
          class="conversation-scroll-switch-state"
          :data-active-thread-id="activeThreadId"
          :data-thread-a-scroll-top="scrollStateByThreadId['regression-scroll-a']?.scrollTop ?? -1"
          :data-thread-a-at-bottom="scrollStateByThreadId['regression-scroll-a']?.isAtBottom ?? ''"
          :data-thread-b-scroll-top="scrollStateByThreadId['regression-scroll-b']?.scrollTop ?? -1"
          :data-thread-b-at-bottom="scrollStateByThreadId['regression-scroll-b']?.isAtBottom ?? ''"
          aria-hidden="true"
        />
      </div>
      <RuntimeStatusBar
        v-if="!isQueueFailureFixture && !isLoadFailureFixture"
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
        v-if="!isQueueFailureFixture"
        class="conversation-regression-thread"
        :messages="fixtureMessages"
        :pending-requests="pendingRequests"
        :live-overlay="liveOverlay"
        :is-loading="false"
        :is-turn-in-progress="!isLoadFailureFixture && !isScrollSwitchRaceFixture"
        :load-error="isLoadFailureFixture ? '连接不到桌面端，会话内容暂时未加载。页面会自动重试，也可以检查或修改连接地址。' : ''"
        :show-connection-settings-action="isLoadFailureFixture"
        compact-runtime-chrome
        :active-thread-id="activeThreadId"
        cwd="E:/javaword/CXCodex/codexui"
        :scroll-state="activeScrollState"
        :favorite-message-ids="favoriteMessageIds"
        @update-scroll-state="onUpdateScrollState"
        @respond-server-request="noop"
        @rollback="noop"
        @toggle-favorite="noop"
        @load-older-history="onLoadOlderHistory"
        @retry-load="loadRetryCount += 1"
        @open-connection-settings="connectionSettingsCount += 1"
        @return-to-new-thread="noop"
        @dismiss-empty-thread="noop"
        @retry-failed-message="noop"
        @copy-status="copyStatus = $event"
      />
      <p
        v-if="copyStatus"
        class="conversation-regression-copy-status"
        :data-tone="copyStatus.tone"
        role="status"
      >
        {{ copyStatus.message }}
      </p>
      <span class="conversation-regression-older-history-count" :data-count="olderHistoryRequestCount" aria-hidden="true" />
      <span class="conversation-regression-load-retry-count" :data-count="loadRetryCount" aria-hidden="true" />
      <span class="conversation-regression-connection-settings-count" :data-count="connectionSettingsCount" aria-hidden="true" />
      <QueuedMessages
        v-if="!isLoadFailureFixture"
        class="conversation-regression-queue"
        :messages="queuedMessages"
        :is-processing="!isQueueFailureFixture"
        @edit="noop"
        @quote="noop"
        @retry="noop"
        @delete="noop"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ThreadConversation from './ThreadConversation.vue'
import RuntimeStatusBar from './RuntimeStatusBar.vue'
import QueuedMessages from './QueuedMessages.vue'
import type {
  ThreadScrollState,
  UiLiveOverlay,
  UiMessage,
  UiRuntimeStatusSummary,
  UiServerRequest,
} from '../../types/codex'

const messages: UiMessage[] = [
  {
    id: 'fixture-history-window-notice',
    role: 'system',
    text: '已优先显示最近 10 轮，较早 8 轮已折叠以保持流畅。',
    messageType: 'history.notice',
    turnIndex: 0,
  },
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
    turnIndex: 0,
  },
  ...Array.from({ length: 8 }, (_, index): UiMessage => ({
    id: `fixture-latest-turn-progress-${String(index + 1)}`,
    role: 'system',
    text: `fixture latest turn progress ${String(index + 1)}`,
    messageType: 'fixture.progress',
    turnIndex: 0,
  })),
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
    id: 'fixture-hidden-web-search-noise',
    role: 'system',
    text: 'Unhandled App Server item: webSearch',
    messageType: 'unhandled.webSearch',
    rawPayload: JSON.stringify({
      type: 'webSearch',
      query: 'fixture-hidden-web-search-noise',
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
  {
    id: 'fixture-interrupted-turn',
    role: 'system',
    text: '已在 12 秒后停止',
    messageType: 'turn.interrupted',
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:plain-echo',
    role: 'user',
    text: '这是一条立即回显的用户消息；内容会立刻出现，不暴露内部状态。',
    deliveryState: 'sending',
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:failed-echo',
    role: 'user',
    text: '这是一条弱网发送失败后仍保留的消息，可以直接重试。',
    deliveryState: 'failed',
    deliveryError: '发送失败，请检查连接后重试。',
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:retrying-echo',
    role: 'user',
    text: '网络短暂中断，正在安全重连，内容不会重复发送。',
    deliveryState: 'retrying',
    deliveryAttempt: 1,
    deliveryAttemptMax: 4,
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:waiting-echo',
    role: 'user',
    text: '网络暂时不可用，消息已保留，将在连接恢复后自动发送。',
    deliveryState: 'waiting',
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:confirming-echo',
    role: 'user',
    text: '服务器已记录请求，但任务启动结果仍在确认，消息恢复依据会继续保留。',
    deliveryState: 'confirming',
    turnIndex: 1,
  },
  {
    id: 'optimistic-user:fixture:sent-echo',
    role: 'user',
    text: '服务端已经确认接收，正在等待历史消息同步。',
    deliveryState: 'sent',
    turnIndex: 1,
  },
  {
    id: 'fixture-running-command-current',
    role: 'system',
    text: '',
    messageType: 'commandExecution',
    commandExecution: {
      command: 'npm.cmd run verify:frontend-normalizers',
      cwd: 'E:/javaword/CXCodex/codexui',
      status: 'inProgress',
      aggregatedOutput: 'fixture-current-command: running',
      exitCode: null,
      durationMs: null,
      startedAtMs: Date.now() - 6500,
    },
    turnIndex: 2,
  },
  {
    id: 'fixture-streaming-assistant-tail',
    role: 'assistant',
    text: '我已经完成前半部分检查，回复仍在继续生成，不应让运行状态消失。',
    messageType: 'agentMessage.live',
    turnIndex: 2,
  },
]

const olderHistoryRequestCount = ref(0)

const allPendingRequests: UiServerRequest[] = [
  {
    id: 742001,
    method: 'elicitation/create',
    threadId: 'regression-conversation-blocks',
    turnId: 'fixture-turn-permission',
    itemId: 'fixture-mcp-permission',
    receivedAtIso: '2026-07-05T05:00:00.000Z',
    params: {
      serverName: 'codex_apps',
      mode: 'form',
      message: 'Allow GitHub to run tool "github_update_pull_request"?',
      requestedSchema: {
        type: 'object',
        properties: {},
      },
      _meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_name: 'GitHub',
        tool_title: 'update_pull_request',
        persist: ['session', 'always'],
        tool_params_display: [
          { name: 'pr_number', value: 18, display_name: 'pr_number' },
          { name: 'repository_full_name', value: 'Qjzn/CX-Codex', display_name: 'repository_full_name' },
          { name: 'state', value: 'closed', display_name: 'state' },
        ],
      },
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

const fixtureParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  : new URLSearchParams()
const isTailStatusFixture = fixtureParams.get('tailStatus') === '1'
const isNextActivityFixture = fixtureParams.get('tailNextActivity') === '1'
const isResumeRecoveryFixture = fixtureParams.get('resumeRecovery') === '1'
const isQueueFailureFixture = fixtureParams.get('queueFailure') === '1'
const isLoadFailureFixture = fixtureParams.get('loadFailure') === '1'
const isScrollSwitchRaceFixture = fixtureParams.get('scrollSwitchRace') === '1'
const isForegroundResumeScrollFixture = fixtureParams.get('foregroundResumeScroll') === '1'
const isImagePreviewFixture = fixtureParams.get('imagePreview') === '1'
const isMarkdownImageFixture = fixtureParams.get('markdownImage') === '1'
const isMessageActionHitFixture = fixtureParams.get('messageActionHit') === '1'
const activeThreadId = ref(isScrollSwitchRaceFixture ? 'regression-scroll-a' : 'regression-conversation-blocks')
const scrollStateByThreadId = ref<Record<string, ThreadScrollState>>({})
const activeScrollState = computed(() => scrollStateByThreadId.value[activeThreadId.value] ?? null)
const favoriteMessageIds = computed(() => (
  isMessageActionHitFixture ? [`${activeThreadId.value}-message-39`] : []
))
const imagePreviewMessage: UiMessage = {
  id: 'fixture-image-preview-gestures',
  role: 'assistant',
  text: '图片预览手势回归夹具',
  images: ['branding/cx-codex-logo.png'],
  turnIndex: 7,
}
const markdownImageMessages: UiMessage[] = [
  {
    id: 'fixture-markdown-image-visible',
    role: 'assistant',
    text: '已生成回归截图：\n\n![Markdown 图片回归](branding/cx-codex-logo.png)',
    turnIndex: 8,
  },
  {
    id: 'fixture-markdown-image-failed',
    role: 'assistant',
    text: '失效图片应提供恢复入口：\n\n![失效 Markdown 图片](/__missing-markdown-image-regression.png)',
    turnIndex: 9,
  },
]
const scrollRaceMessagesByThreadId = ref<Record<string, UiMessage[]>>(Object.fromEntries(
  ['regression-scroll-a', 'regression-scroll-b'].map((threadId) => [
    threadId,
    Array.from({ length: 48 }, (_, index): UiMessage => ({
      id: `${threadId}-message-${String(index + 1)}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `${threadId} fixture message ${String(index + 1)} ${'stable scroll content '.repeat(5)}`,
      turnIndex: Math.floor(index / 2),
    })),
  ]),
))
const fixtureMessages = computed(() => {
  if (isLoadFailureFixture) return []
  if (isScrollSwitchRaceFixture) {
    return scrollRaceMessagesByThreadId.value[activeThreadId.value] ?? []
  }
  if (isImagePreviewFixture) return [...messages, imagePreviewMessage]
  if (isMarkdownImageFixture) return [...messages, ...markdownImageMessages]
  return messages
})
const pendingRequests: UiServerRequest[] = isTailStatusFixture || isLoadFailureFixture ? [] : allPendingRequests
const loadRetryCount = ref(0)
const connectionSettingsCount = ref(0)
const copyStatus = ref<{ message: string; tone: 'success' | 'info' | 'warning' | 'danger' } | null>(null)

const liveOverlay = ref<UiLiveOverlay | null>({
  activityId: 'fixture-turn-runtime',
  isRecovering: isResumeRecoveryFixture,
  startedAtMs: Date.now() - (isNextActivityFixture ? 5 * 60 * 1000 : 6500),
  activityLabel: 'fixture runtime activity',
  activityDetails: ['fixture runtime detail should stay compact and neutral'],
  reasoningText: 'fixture reasoning text',
  errorText: '',
})

if (isLoadFailureFixture || isScrollSwitchRaceFixture) {
  liveOverlay.value = null
}

if (typeof window !== 'undefined' && fixtureParams.get('tailGap') === '1') {
  window.setTimeout(() => {
    liveOverlay.value = null
  }, 250)
}

if (typeof window !== 'undefined' && isNextActivityFixture) {
  window.setTimeout(() => {
    liveOverlay.value = {
      activityId: 'fixture-turn-next',
      startedAtMs: Date.now(),
      activityLabel: 'fixture next activity',
      activityDetails: ['a later turn must start a new elapsed timer'],
      reasoningText: '',
      errorText: '',
    }
  }, 250)
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
  latestReply: '',
  latestReplyEventSeq: 0,
  lastStartedAtIso: '2026-07-05T05:00:00.000Z',
  lastCompletedAtIso: null,
}

const queuedMessages = [
  {
    id: 'fixture-queue-next',
    deliveryState: isQueueFailureFixture ? 'failed' as const : 'queued' as const,
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
    deliveryState: 'queued' as const,
    text: 'second queued item should not introduce warm panels',
    imageUrls: [],
    skills: [],
    fileAttachments: [],
  },
]

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
}

function appendResumeOutput(): void {
  const threadId = activeThreadId.value
  const currentMessages = scrollRaceMessagesByThreadId.value[threadId] ?? []
  const nextIndex = currentMessages.length + 1
  scrollRaceMessagesByThreadId.value = {
    ...scrollRaceMessagesByThreadId.value,
    [threadId]: [
      ...currentMessages,
      {
        id: `${threadId}-message-${String(nextIndex)}`,
        role: 'assistant',
        text: `${threadId} recovered output ${String(nextIndex)} ${'foreground recovery content '.repeat(8)}`,
        turnIndex: Math.floor(nextIndex / 2),
      },
    ],
  }
}

function onUpdateScrollState(payload: { threadId: string; state: ThreadScrollState }): void {
  scrollStateByThreadId.value = {
    ...scrollStateByThreadId.value,
    [payload.threadId]: payload.state,
  }
}

function onLoadOlderHistory(): void {
  olderHistoryRequestCount.value += 1
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

.conversation-scroll-switch-controls {
  @apply flex shrink-0 gap-2 border-b px-4 py-2;
  border-color: var(--ui-border-subtle);
}

.conversation-scroll-switch-controls button {
  @apply rounded-md border px-3 py-1 text-xs;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}

.conversation-scroll-switch-state {
  @apply hidden;
}

.conversation-regression-thread {
  @apply min-h-0 flex-1;
}

.conversation-regression-runtime {
  @apply shrink-0;
}

.conversation-regression-copy-status {
  @apply fixed left-1/2 top-3 z-50 m-0 -translate-x-1/2 rounded-lg px-3 py-2 text-sm font-medium;
  color: var(--ui-danger);
  background: color-mix(in srgb, var(--ui-danger) 8%, var(--ui-bg-surface));
  border: 1px solid color-mix(in srgb, var(--ui-danger) 28%, var(--ui-border-subtle));
}

.conversation-regression-queue {
  @apply shrink-0 pb-3;
}
</style>
