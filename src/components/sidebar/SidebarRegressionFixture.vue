<template>
  <main class="sidebar-regression-fixture" aria-label="Sidebar row regression fixture">
    <aside class="sidebar-regression-shell">
      <header class="sidebar-regression-header">
        <p class="sidebar-regression-kicker">Regression Fixture</p>
        <h1>Sidebar Rows</h1>
      </header>
      <SidebarThreadTree
        class="sidebar-regression-tree"
        :groups="groups"
        :project-display-name-by-id="projectDisplayNameById"
        selected-thread-id="fixture-thread-running"
        :is-loading="false"
        search-query=""
        :search-matched-thread-ids="null"
        desktop-list-parity
        @select="noop"
        @archive="noop"
        @start-new-thread="noop"
        @browse-thread-files="noop"
        @rename-project="noop"
        @rename-thread="noop"
        @remove-project="noop"
        @reorder-project="noop"
        @export-thread="noop"
        @fork-thread="noop"
      />
    </aside>
  </main>
</template>

<script setup lang="ts">
import SidebarThreadTree from './SidebarThreadTree.vue'
import type { UiProjectGroup } from '../../types/codex'

const now = Date.parse('2026-07-05T10:00:00.000Z')

const groups: UiProjectGroup[] = [
  {
    projectName: 'E:/javaword/CXCodex/codexui',
    threads: [
      {
        id: 'fixture-thread-running',
        title: '优化会话栏桌面端信息密度',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'desktop',
        hasWorktree: true,
        createdAtIso: new Date(now - 3600000).toISOString(),
        updatedAtIso: new Date(now - 120000).toISOString(),
        preview: '正在调整 Sidebar row 的标题、预览、状态和时间层级。',
        unread: false,
        inProgress: true,
      },
      {
        id: 'fixture-thread-unread',
        title: '回归测试前端布局',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'cli',
        hasWorktree: false,
        createdAtIso: new Date(now - 7200000).toISOString(),
        updatedAtIso: new Date(now - 900000).toISOString(),
        preview: 'test:7420:frontend 已覆盖桌面、手机和 fixture 路由。',
        unread: true,
        inProgress: false,
      },
      {
        id: 'fixture-thread-idle',
        title: '整理 release review 任务',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'subAgent.review',
        hasWorktree: false,
        createdAtIso: new Date(now - 86400000).toISOString(),
        updatedAtIso: new Date(now - 5400000).toISOString(),
        preview: '把 schema drift、README、安全声明和公开宣传边界收口。',
        unread: false,
        inProgress: false,
      },
    ],
  },
  {
    projectName: 'E:/javaword/CXCodex/playground',
    threads: [
      {
        id: 'fixture-thread-project',
        title: 'Playground 新会话',
        projectName: 'E:/javaword/CXCodex/playground',
        cwd: 'E:/javaword/CXCodex/playground',
        sourceKind: 'app',
        hasWorktree: false,
        createdAtIso: new Date(now - 172800000).toISOString(),
        updatedAtIso: new Date(now - 86400000).toISOString(),
        preview: '从项目入口快速发起新的 Codex 任务。',
        unread: false,
        inProgress: false,
      },
    ],
  },
]

const projectDisplayNameById: Record<string, string> = {
  'E:/javaword/CXCodex/codexui': 'codexui',
  'E:/javaword/CXCodex/playground': 'Playground',
}

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
}
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-regression-fixture {
  @apply min-h-dvh px-4 py-6;
  background: var(--ui-bg-window);
  color: var(--ui-text-primary);
}

.sidebar-regression-shell {
  @apply mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-[356px] flex-col overflow-hidden border;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-sidebar);
}

.sidebar-regression-header {
  @apply shrink-0 border-b px-3 py-2.5;
  border-color: var(--ui-border-subtle);
}

.sidebar-regression-kicker {
  @apply m-0 text-[11px] font-medium;
  color: var(--ui-text-tertiary);
}

.sidebar-regression-header h1 {
  @apply m-0 mt-0.5 text-base font-semibold;
  color: var(--ui-text-primary);
}

.sidebar-regression-tree {
  @apply min-h-0 flex-1 overflow-auto p-2;
}
</style>
