<template>
  <main class="sidebar-regression-fixture" aria-label="Sidebar row regression fixture">
    <aside class="sidebar-regression-shell" :data-scroll-anchor-test="scrollAnchorMode || revealCurrentMode">
      <header class="sidebar-regression-header">
        <div>
          <p class="sidebar-regression-kicker">Regression Fixture</p>
          <h1>Sidebar Rows</h1>
        </div>
        <div class="sidebar-regression-header-actions">
          <button
            v-if="scrollAnchorMode"
            class="sidebar-regression-promote-button"
            type="button"
            data-regression-action="promote-background-project"
            @click="promoteBackgroundProject = true"
          >
            模拟后台更新
          </button>
          <button
            v-if="searchContinuityMode"
            class="sidebar-regression-promote-button"
            type="button"
            data-regression-action="diverge-search-query"
            @click="continuitySearchQuery = 'release'"
          >
            切换查询
          </button>
          <button
            v-if="searchContinuityMode"
            class="sidebar-regression-promote-button"
            type="button"
            data-regression-action="restore-search-prefix"
            @click="continuitySearchQuery = '移动端'"
          >
            恢复前缀
          </button>
          <button
            v-if="revealCurrentMode"
            class="sidebar-regression-promote-button"
            type="button"
            data-regression-action="reveal-current-thread"
            @click="revealFixtureCurrentThread"
          >
            定位当前会话
          </button>
          <SidebarThreadControls
            :is-sidebar-collapsed="true"
            :attention-count="2"
            @toggle-sidebar="noop"
          />
        </div>
      </header>
      <SidebarThreadTree
        ref="sidebarTreeRef"
        class="sidebar-regression-tree"
        :groups="groups"
        :project-display-name-by-id="projectDisplayNameById"
        :selected-thread-id="fixtureSelectedThreadId"
        :is-loading="false"
        :search-query="fixtureSearchQuery"
        :search-matched-thread-ids="fixtureVisibleMatchedThreadIds"
        :pinned-thread-ids-override="['fixture-thread-unread', 'fixture-thread-running']"
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
        @copy-thread="noop"
        @copy-thread-link="noop"
        @fork-thread="noop"
      />
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import SidebarThreadControls from './SidebarThreadControls.vue'
import SidebarThreadTree from './SidebarThreadTree.vue'
import type { UiProjectGroup } from '../../types/codex'
import { dedupeProjectThreadGroups } from '../../utils/projectGroupOrdering'
import { shouldHoldThreadSearchResults } from '../../utils/threadSearchContinuity'

const now = Date.parse('2026-07-05T10:00:00.000Z')
const route = useRoute()
const staleSearchMode = computed(() => route.query.staleSearch === '1')
const scrollAnchorMode = computed(() => route.query.scrollAnchor === '1')
const searchContinuityMode = computed(() => route.query.searchContinuity === '1')
const revealCurrentMode = computed(() => route.query.revealCurrent === '1')
const fixtureSelectedThreadId = computed(() => (
  revealCurrentMode.value ? 'fixture-thread-eight' : 'fixture-thread-running'
))
const sidebarTreeRef = ref<{ revealSelectedThread: () => Promise<boolean> } | null>(null)
const promoteBackgroundProject = ref(false)
const continuitySearchQuery = ref('移动端')
const fixtureSearchQuery = computed(() => (
  staleSearchMode.value || searchContinuityMode.value ? continuitySearchQuery.value : ''
))
const fixtureMatchedThreadIds = computed(() => (
  staleSearchMode.value || searchContinuityMode.value ? ['fixture-thread-unread'] : null
))
const fixtureMatchedThreadQuery = computed(() => (
  staleSearchMode.value ? '移动端' : searchContinuityMode.value ? '移动' : ''
))
const fixtureVisibleMatchedThreadIds = computed(() => (
  fixtureMatchedThreadIds.value
  && shouldHoldThreadSearchResults(fixtureMatchedThreadQuery.value, fixtureSearchQuery.value)
    ? fixtureMatchedThreadIds.value
    : null
))

const baseGroups: UiProjectGroup[] = [
  {
    projectName: 'E:/javaword/CXCodex/codexui',
    isPinnedProject: true,
    pinnedProjectRank: 0,
    threads: [
      {
        id: 'fixture-thread-eight',
        title: '最近项目排序回归',
        projectName: 'E:/javaword/CXCodex/codexui',
        cwd: 'E:/javaword/CXCodex/codexui',
        sourceKind: 'cli',
        hasWorktree: false,
        createdAtIso: new Date(now - 104400000).toISOString(),
        updatedAtIso: new Date(now - 14400000).toISOString(),
        preview: '项目目录按内部最新会话时间上浮。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'fixture-thread-running',
        title: '优化会话栏桌面端信息密度，确保长标题在窄侧栏中仍可完整识别',
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
    ],
  },
  {
    projectName: 'empty-root',
    workspaceRoot: 'E:/javaword/CXCodex/empty-root',
    threads: [],
  },
  {
    projectName: 'E:/javaword/CXCodex/playground',
    threads: [
      {
        id: 'fixture-thread-waiting',
        title: '确认移动端工具权限',
        projectName: 'E:/javaword/CXCodex/playground',
        cwd: 'E:/javaword/CXCodex/playground',
        sourceKind: 'app',
        hasWorktree: false,
        createdAtIso: new Date(now - 5400000).toISOString(),
        updatedAtIso: new Date(now - 180000).toISOString(),
        preview: '任务暂停在权限确认，等待用户处理。',
        unread: false,
        inProgress: true,
        waitingForInput: true,
      },
      {
        id: 'fixture-thread-background',
        title: '后台整理回归证据',
        projectName: 'E:/javaword/CXCodex/playground',
        cwd: 'E:/javaword/CXCodex/playground',
        sourceKind: 'app',
        hasWorktree: false,
        createdAtIso: new Date(now - 3600000).toISOString(),
        updatedAtIso: new Date(now - 60000).toISOString(),
        preview: '普通运行任务更新时间更近，但优先级低于等待处理。',
        unread: false,
        inProgress: true,
      },
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

const scrollAnchorExtraGroups: UiProjectGroup[] = Array.from({ length: 5 }, (_, index) => {
  const projectName = `fixture-anchor-${index + 1}`
  return {
    projectName,
    threads: [{
      id: `fixture-anchor-thread-${index + 1}`,
      title: `滚动锚点样本 ${index + 1}`,
      projectName,
      cwd: `E:/javaword/CXCodex/${projectName}`,
      sourceKind: 'app',
      hasWorktree: false,
      createdAtIso: new Date(now - 7200000 - index * 3600000).toISOString(),
      updatedAtIso: new Date(now - 7200000 - index * 3600000).toISOString(),
      preview: '用于验证后台项目重排后可见位置保持稳定。',
      unread: false,
      inProgress: false,
    }],
  }
})

const groups = computed<UiProjectGroup[]>(() => {
  const fixtureGroups = scrollAnchorMode.value
    ? [...baseGroups, ...scrollAnchorExtraGroups]
    : baseGroups
  const groupsWithBackgroundUpdate = scrollAnchorMode.value && promoteBackgroundProject.value
    ? fixtureGroups.map((group) => (
        group.projectName === 'empty-root'
          ? {
              ...group,
              threads: [{
                id: 'fixture-thread-materialized',
                title: '后台创建的新任务',
                projectName: 'empty-root',
                cwd: 'E:/javaword/CXCodex/empty-root',
                sourceKind: 'app',
                hasWorktree: false,
                createdAtIso: new Date(now + 60000).toISOString(),
                updatedAtIso: new Date(now + 60000).toISOString(),
                preview: '后台任务更新不应打断当前侧栏浏览位置。',
                unread: false,
                inProgress: false,
              }],
            }
          : group
      ))
    : fixtureGroups

  if (route.query.duplicateIdentity !== '1') return groupsWithBackgroundUpdate

  const resolvedThread = groupsWithBackgroundUpdate[0]?.threads.find((thread) => thread.id === 'fixture-thread-running')
  if (!resolvedThread) return groupsWithBackgroundUpdate

  return dedupeProjectThreadGroups([
    {
      projectName: 'unknown-project',
      threads: [{
        ...resolvedThread,
        projectName: 'unknown-project',
        cwd: '',
        preview: '帮我优化',
      }],
    },
    ...groupsWithBackgroundUpdate,
  ])
})

const projectDisplayNameById: Record<string, string> = {
  'E:/javaword/CXCodex/codexui': 'codexui',
  'empty-root': 'Empty Workspace',
  'E:/javaword/CXCodex/playground': 'Playground',
  ...Object.fromEntries(scrollAnchorExtraGroups.map((group, index) => (
    [group.projectName, `Anchor Workspace ${index + 1}`]
  ))),
}

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
}

function revealFixtureCurrentThread(): void {
  void sidebarTreeRef.value?.revealSelectedThread()
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

.sidebar-regression-shell[data-scroll-anchor-test='true'] {
  height: calc(100dvh - 3rem);
  min-height: 0;
}

.sidebar-regression-header {
  @apply flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2.5;
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

.sidebar-regression-header-actions {
  @apply flex items-center gap-1.5;
}

.sidebar-regression-promote-button {
  @apply rounded-md border px-2 py-1 text-[11px] font-medium;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
}

.sidebar-regression-tree {
  @apply min-h-0 flex-1 overflow-auto p-2;
}
</style>
