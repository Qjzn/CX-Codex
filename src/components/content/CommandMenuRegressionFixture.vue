<template>
  <main class="command-menu-regression-fixture">
    <button type="button" @click="isOpen = true">打开命令菜单</button>
    <p data-command-menu-regression-status>{{ status }}</p>
    <CommandMenu
      :open="isOpen"
      :groups="groups"
      selected-thread-id="thread-active"
      :show-github="true"
      @close="isOpen = false"
      @select-thread="onSelectThread"
      @start-new-thread="status = 'new-thread'"
      @open-route="status = `route:${$event}`"
    />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { UiProjectGroup } from '../../types/codex'
import CommandMenu from './CommandMenu.vue'

const isOpen = ref(true)
const status = ref('idle')
const groups: UiProjectGroup[] = [
  {
    projectName: 'CX-Codex',
    workspaceRoot: 'E:/javaword/CXCodex/codexui',
    threads: [
      {
        id: 'thread-active',
        title: '优化全局命令菜单',
        projectName: 'CX-Codex',
        cwd: 'E:/javaword/CXCodex/codexui',
        hasWorktree: false,
        createdAtIso: '2026-08-01T08:00:00.000Z',
        updatedAtIso: '2026-08-01T09:00:00.000Z',
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
        createdAtIso: '2026-07-31T08:00:00.000Z',
        updatedAtIso: '2026-07-31T10:00:00.000Z',
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
</script>

<style scoped>
.command-menu-regression-fixture {
  min-height: 100dvh;
  padding: 24px;
  background: var(--ui-bg-window);
}
</style>
