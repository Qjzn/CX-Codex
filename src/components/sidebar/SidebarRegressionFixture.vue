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
        :pinned-thread-ids-override="['fixture-thread-unread']"
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
      {
        id: 'fixture-thread-four',
        title: '压缩侧栏操作入口',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'desktop',
        hasWorktree: false,
        createdAtIso: new Date(now - 90000000).toISOString(),
        updatedAtIso: new Date(now - 7200000).toISOString(),
        preview: '把常用操作收敛成手机友好的紧凑命令区。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'fixture-thread-five',
        title: '检查项目会话显示上限',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'cli',
        hasWorktree: false,
        createdAtIso: new Date(now - 93600000).toISOString(),
        updatedAtIso: new Date(now - 9000000).toISOString(),
        preview: '项目展开后默认只显示最新 5 条会话。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'fixture-thread-six',
        title: '移动端菜单按钮触控优化',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'app',
        hasWorktree: false,
        createdAtIso: new Date(now - 97200000).toISOString(),
        updatedAtIso: new Date(now - 10800000).toISOString(),
        preview: '按钮保留文字标签，避免手机上只剩难识别的小图标。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'fixture-thread-seven',
        title: '侧栏更多入口文案',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'desktop',
        hasWorktree: false,
        createdAtIso: new Date(now - 100800000).toISOString(),
        updatedAtIso: new Date(now - 12600000).toISOString(),
        preview: '显示更多按钮展示剩余数量，减少误解。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'fixture-thread-eight',
        title: '保留项目顺序回归',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'cli',
        hasWorktree: false,
        createdAtIso: new Date(now - 104400000).toISOString(),
        updatedAtIso: new Date(now - 14400000).toISOString(),
        preview: '项目目录仍沿用上游归一化顺序，不做二次重排。',
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
