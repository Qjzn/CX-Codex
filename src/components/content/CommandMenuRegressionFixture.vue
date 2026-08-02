<template>
  <main class="command-menu-regression-fixture">
    <button data-command-menu-regression-launch type="button" @click="isOpen = true">打开命令菜单</button>
    <p data-command-menu-regression-status>{{ status }}</p>
    <CommandMenu
      :open="isOpen"
      :groups="groups"
      selected-thread-id="thread-gateway"
      :show-github="true"
      cwd="E:/javaword/CXCodex/codexui"
      :initial-mode="typeAheadFixture ? 'files' : 'root'"
      @close="isOpen = false"
      @select-thread="onSelectThread"
      @start-new-thread="status = 'new-thread'"
      @open-route="status = `route:${$event}`"
      @open-file="status = `file:${$event}`"
    />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { UiProjectGroup } from '../../types/codex'
import CommandMenu from './CommandMenu.vue'

const typeAheadFixture = /(?:\?|&)typeAhead=1(?:&|$)/u.test(window.location.hash)
const focusOwnershipFixture = /(?:\?|&)focusOwnership=1(?:&|$)/u.test(window.location.hash)
const isOpen = ref(!focusOwnershipFixture)
const status = ref('idle')
const originalFetch = window.fetch
const typeAheadFetch: typeof window.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string'
    ? input
    : (input instanceof URL ? input.toString() : input.url)
  if (!requestUrl.includes('/codex-api/composer-file-search')) {
    return originalFetch(input, init)
  }
  let query = ''
  try {
    const rawBody = typeof init?.body === 'string'
      ? init.body
      : (input instanceof Request ? await input.clone().text() : '')
    const body = rawBody ? JSON.parse(rawBody) as { query?: unknown } : null
    query = typeof body?.query === 'string' ? body.query.trim() : ''
  } catch {
    // Keep the deterministic empty response if the browser sends an unexpected body.
  }
  const initialRows = [
    { path: 'src/components/content/CommandMenu.vue' },
    { path: 'src/components/content/ConversationRegressionFixture.vue' },
    { path: 'src/App.vue' },
  ]
  const rows = query === 'src' ? initialRows : initialRows.slice(0, 1)
  await new Promise<void>((resolve) => window.setTimeout(resolve, query === 'src' ? 40 : 900))
  return new Response(JSON.stringify({ data: rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
if (typeAheadFixture) window.fetch = typeAheadFetch
const groups: UiProjectGroup[] = [
  {
    projectName: 'CX-Codex',
    workspaceRoot: 'E:/javaword/CXCodex/codexui',
    threads: [
      {
        id: 'thread-active',
        title: '确认工具权限请求',
        projectName: 'CX-Codex',
        cwd: 'E:/javaword/CXCodex/codexui',
        hasWorktree: false,
        createdAtIso: '2026-07-31T08:00:00.000Z',
        updatedAtIso: '2026-07-31T09:00:00.000Z',
        preview: '任务正在等待用户确认工具权限。',
        unread: false,
        inProgress: true,
        waitingForInput: true,
      },
      {
        id: 'thread-running',
        title: '优化全局命令菜单',
        projectName: 'CX-Codex',
        cwd: 'E:/javaword/CXCodex/codexui',
        hasWorktree: false,
        createdAtIso: '2026-08-01T09:30:00.000Z',
        updatedAtIso: '2026-08-01T11:00:00.000Z',
        preview: '对照 Codex 桌面端，统一快速入口、键盘导航与状态表达。',
        unread: false,
        inProgress: true,
      },
      {
        id: 'thread-review',
        title: '审查移动端会话恢复',
        projectName: 'CX-Codex',
        cwd: 'E:/javaword/CXCodex/codexui',
        hasWorktree: false,
        createdAtIso: '2026-08-01T08:00:00.000Z',
        updatedAtIso: '2026-08-01T10:00:00.000Z',
        preview: '验证 Android Back、待发送消息和连接恢复。',
        unread: true,
        inProgress: false,
      },
    ],
  },
  {
    projectName: '服务端网关',
    workspaceRoot: 'E:/javaword/gateway',
    threads: [
      {
        id: 'thread-gateway',
        title: '检查事件回放边界',
        projectName: '服务端网关',
        cwd: 'E:/javaword/gateway',
        hasWorktree: false,
        createdAtIso: '2026-07-30T08:00:00.000Z',
        updatedAtIso: '2026-07-30T12:00:00.000Z',
        preview: '核对 streamId、sequence cursor 与断线重连。',
        unread: false,
        inProgress: false,
      },
    ],
  },
]

function onSelectThread(threadId: string): void {
  status.value = `thread:${threadId}`
}

onBeforeUnmount(() => {
  if (window.fetch === typeAheadFetch) window.fetch = originalFetch
})
</script>

<style scoped>
.command-menu-regression-fixture {
  min-height: 100dvh;
  padding: 24px;
  background: var(--ui-bg-window);
}
</style>
