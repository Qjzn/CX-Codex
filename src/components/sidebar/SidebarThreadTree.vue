<template>
  <section class="thread-tree-root">
    <section v-if="runningThreads.length > 0" class="thread-section">
      <div class="thread-section-heading">
        <span class="thread-section-label">正在运行</span>
        <span class="thread-section-count">{{ runningThreads.length }}</span>
      </div>
      <ul class="thread-list">
        <li v-for="thread in runningThreads" :key="thread.id" class="thread-row-item">
          <SidebarMenuRow
            class="thread-row thread-row-priority"
            :data-thread-id="thread.id"
            :data-active="thread.id === selectedThreadId"
            :data-pinned="isPinned(thread.id)"
            :force-right-hover="isThreadMenuOpen(thread.id)"
            @mouseleave="onThreadRowLeave(thread.id)"
            @contextmenu="onThreadRowContextMenu($event, thread.id)"
          >
            <template #left>
              <span class="thread-left-stack">
                <span class="thread-status-indicator" :data-state="getThreadState(thread)" :title="getThreadStatusLabel(thread)" />
                <button class="thread-pin-button" type="button" title="置顶" @click="togglePin(thread.id)">
                  <IconTablerPin class="thread-icon" />
                </button>
              </span>
            </template>
            <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
              <span class="thread-row-content">
                <span class="thread-row-title-wrap">
                  <span class="thread-row-title">{{ thread.title }}</span>
                  <IconTablerGitFork v-if="thread.hasWorktree" class="thread-row-worktree-icon" title="工作树会话" />
                </span>
                <span class="thread-row-meta">
                  <span class="thread-row-preview">{{ getThreadPreview(thread) }}</span>
                  <span v-if="thread.sourceKind" class="thread-row-source">{{ formatThreadSource(thread) }}</span>
                  <span v-if="thread.inProgress" class="thread-row-source thread-row-source--working">执行中</span>
                  <span v-else-if="thread.unread" class="thread-row-source thread-row-source--unread">未读</span>
                </span>
              </span>
            </button>
            <template #right>
              <span class="thread-row-time">{{ formatRelativeThread(thread) }}</span>
            </template>
            <template #right-hover>
              <div :ref="(el) => setThreadMenuWrapRef(thread.id, el)" class="thread-menu-wrap">
                <button
                  class="thread-menu-trigger"
                  type="button"
                  title="thread_menu"
                  @click.stop="toggleThreadMenu(thread.id)"
                >
                  <IconTablerDots class="thread-icon" />
                </button>
                <div v-if="isThreadMenuOpen(thread.id)" class="thread-menu-panel" @pointerdown.stop @click.stop>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onBrowseThreadFiles(thread.id)">
                    浏览文件
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onExportThread(thread.id)">
                    导出会话
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onToggleThreadPin(thread.id)">
                    {{ isPinned(thread.id) ? '取消置顶' : '置顶会话' }}
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onForkThread(thread.id)">
                    创建分支会话
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="openRenameThreadDialog(thread.id, thread.title)">
                    重命名会话
                  </button>
                  <button class="thread-menu-item thread-menu-item-danger" type="button" @pointerdown.stop @click.stop.prevent="openDeleteThreadDialog(thread.id, thread.title)">
                    删除会话
                  </button>
                </div>
              </div>
            </template>
          </SidebarMenuRow>
        </li>
      </ul>
    </section>

    <section v-if="pinnedThreads.length > 0" class="thread-section pinned-section">
      <div class="thread-section-heading">
        <span class="thread-section-label">置顶</span>
        <span class="thread-section-count">{{ pinnedThreads.length }}</span>
      </div>
      <ul class="thread-list">
        <li v-for="thread in pinnedThreads" :key="thread.id" class="thread-row-item">
          <SidebarMenuRow
            class="thread-row"
            :data-thread-id="thread.id"
            :data-active="thread.id === selectedThreadId"
            :data-pinned="isPinned(thread.id)"
            :force-right-hover="isThreadMenuOpen(thread.id)"
            @mouseleave="onThreadRowLeave(thread.id)"
            @contextmenu="onThreadRowContextMenu($event, thread.id)"
          >
            <template #left>
              <span class="thread-left-stack">
                <span
                  v-if="thread.inProgress || thread.unread"
                  class="thread-status-indicator"
                  :data-state="getThreadState(thread)"
                  :title="getThreadStatusLabel(thread)"
                />
                <button class="thread-pin-button" type="button" title="置顶" @click="togglePin(thread.id)">
                  <IconTablerPin class="thread-icon" />
                </button>
              </span>
            </template>
            <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
              <span class="thread-row-content">
                <span class="thread-row-title-wrap">
                  <span class="thread-row-title">{{ thread.title }}</span>
                  <IconTablerGitFork v-if="thread.hasWorktree" class="thread-row-worktree-icon" title="工作树会话" />
                </span>
                <span class="thread-row-meta">
                  <span class="thread-row-preview">{{ getThreadPreview(thread) }}</span>
                  <span v-if="thread.sourceKind" class="thread-row-source">{{ formatThreadSource(thread) }}</span>
                  <span v-if="thread.inProgress" class="thread-row-source thread-row-source--working">执行中</span>
                  <span v-else-if="thread.unread" class="thread-row-source thread-row-source--unread">未读</span>
                </span>
              </span>
            </button>
            <template #right>
              <span class="thread-row-time">{{ formatRelativeThread(thread) }}</span>
            </template>
            <template #right-hover>
              <div :ref="(el) => setThreadMenuWrapRef(thread.id, el)" class="thread-menu-wrap">
                <button
                  class="thread-menu-trigger"
                  type="button"
                  title="thread_menu"
                  @click.stop="toggleThreadMenu(thread.id)"
                >
                  <IconTablerDots class="thread-icon" />
                </button>
                <div v-if="isThreadMenuOpen(thread.id)" class="thread-menu-panel" @pointerdown.stop @click.stop>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onBrowseThreadFiles(thread.id)">
                    浏览文件
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onExportThread(thread.id)">
                    导出会话
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onToggleThreadPin(thread.id)">
                    {{ isPinned(thread.id) ? '取消置顶' : '置顶会话' }}
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onForkThread(thread.id)">
                    创建分支会话
                  </button>
                  <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="openRenameThreadDialog(thread.id, thread.title)">
                    重命名会话
                  </button>
                  <button class="thread-menu-item thread-menu-item-danger" type="button" @pointerdown.stop @click.stop.prevent="openDeleteThreadDialog(thread.id, thread.title)">
                    删除会话
                  </button>
                </div>
              </div>
            </template>
          </SidebarMenuRow>
        </li>
      </ul>
    </section>

    <SidebarMenuRow as="header" class="thread-tree-header-row">
      <span class="thread-tree-header-stack">
        <span class="thread-tree-header">{{ threadTreeHeader }}</span>
        <span class="thread-tree-header-subtitle">{{ threadTreeHeaderSubtitle }}</span>
      </span>
      <template #right>
        <div ref="organizeMenuWrapRef" class="organize-menu-wrap">
          <button
            class="organize-menu-trigger"
            type="button"
            :aria-expanded="isOrganizeMenuOpen"
            aria-label="整理会话"
            title="整理会话"
            @click="toggleOrganizeMenu"
          >
            <IconTablerDots class="thread-icon" />
          </button>

          <div v-if="isOrganizeMenuOpen" class="organize-menu-panel" @pointerdown.stop @click.stop>
            <p class="organize-menu-title">整理方式</p>
            <button
              class="organize-menu-item"
              :data-active="effectiveThreadViewMode === 'project'"
              type="button"
              @pointerdown.stop
              @click.stop.prevent="setThreadViewMode('project')"
            >
              <span>按项目</span>
              <span v-if="effectiveThreadViewMode === 'project'">✓</span>
            </button>
            <button
              v-if="!useDesktopListParity"
              class="organize-menu-item"
              :data-active="effectiveThreadViewMode === 'chronological'"
              type="button"
              @pointerdown.stop
              @click.stop.prevent="setThreadViewMode('chronological')"
            >
              <span>按时间</span>
              <span v-if="effectiveThreadViewMode === 'chronological'">✓</span>
            </button>
          </div>
        </div>
      </template>
    </SidebarMenuRow>

    <p v-if="isSearchActive && filteredGroups.length === 0" class="thread-tree-no-results">没有匹配的会话</p>

    <div v-else-if="isLoading && groups.length === 0" class="thread-tree-loading" aria-hidden="true">
      <span v-for="index in 5" :key="`thread-skeleton-${index}`" class="thread-loading-skeleton" />
    </div>

    <ul v-else-if="isChronologicalView" class="thread-list thread-list-global">
      <li v-for="thread in globalThreads" :key="thread.id" class="thread-row-item">
        <SidebarMenuRow
          class="thread-row"
          :data-thread-id="thread.id"
          :data-active="thread.id === selectedThreadId"
          :data-pinned="isPinned(thread.id)"
          :force-right-hover="isThreadMenuOpen(thread.id)"
          @mouseleave="onThreadRowLeave(thread.id)"
          @contextmenu="onThreadRowContextMenu($event, thread.id)"
        >
          <template #left>
            <span class="thread-left-stack">
              <span
                v-if="thread.inProgress || thread.unread"
                class="thread-status-indicator"
                :data-state="getThreadState(thread)"
                :title="getThreadStatusLabel(thread)"
              />
              <button class="thread-pin-button" type="button" title="置顶" @click="togglePin(thread.id)">
                <IconTablerPin class="thread-icon" />
              </button>
            </span>
          </template>
          <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
            <span class="thread-row-content">
              <span class="thread-row-title-wrap">
                <span class="thread-row-title">{{ thread.title }}</span>
                <IconTablerGitFork v-if="thread.hasWorktree" class="thread-row-worktree-icon" title="工作树会话" />
              </span>
              <span class="thread-row-meta">
                <span class="thread-row-preview">{{ getThreadPreview(thread) }}</span>
                <span v-if="thread.sourceKind" class="thread-row-source">{{ formatThreadSource(thread) }}</span>
                <span v-if="thread.inProgress" class="thread-row-source thread-row-source--working">执行中</span>
                <span v-else-if="thread.unread" class="thread-row-source thread-row-source--unread">未读</span>
              </span>
            </span>
          </button>
          <template #right>
            <span class="thread-row-time">{{ formatRelativeThread(thread) }}</span>
          </template>
          <template #right-hover>
            <div :ref="(el) => setThreadMenuWrapRef(thread.id, el)" class="thread-menu-wrap">
              <button
                class="thread-menu-trigger"
                type="button"
                title="thread_menu"
                @click.stop="toggleThreadMenu(thread.id)"
              >
                <IconTablerDots class="thread-icon" />
              </button>
              <div v-if="isThreadMenuOpen(thread.id)" class="thread-menu-panel" @pointerdown.stop @click.stop>
                <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onBrowseThreadFiles(thread.id)">
                  浏览文件
                </button>
                <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onExportThread(thread.id)">
                  导出会话
                </button>
                <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onToggleThreadPin(thread.id)">
                  {{ isPinned(thread.id) ? '取消置顶' : '置顶会话' }}
                </button>
                <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onForkThread(thread.id)">
                  创建分支会话
                </button>
                <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="openRenameThreadDialog(thread.id, thread.title)">
                  重命名会话
                </button>
                <button class="thread-menu-item thread-menu-item-danger" type="button" @pointerdown.stop @click.stop.prevent="openDeleteThreadDialog(thread.id, thread.title)">
                  删除会话
                </button>
              </div>
            </div>
          </template>
        </SidebarMenuRow>
      </li>
    </ul>

    <div v-else ref="groupsContainerRef" class="thread-tree-groups" :style="groupsContainerStyle">
      <article
        v-for="group in displayedGroups"
        :key="group.projectName"
        :ref="(el) => setProjectGroupRef(group.projectName, el)"
        class="project-group"
        :data-project-name="group.projectName"
        :data-expanded="!isCollapsed(group.projectName)"
        :data-dragging="isDraggingProject(group.projectName)"
        :style="projectGroupStyle(group.projectName)"
      >
          <SidebarMenuRow
            as="div"
            class="project-header-row"
            role="button"
            tabindex="0"
            @click="toggleProjectCollapse(group.projectName)"
            @keydown="onProjectHeaderKeyDown($event, group.projectName)"
            @keydown.enter.prevent="toggleProjectCollapse(group.projectName)"
            @keydown.space.prevent="toggleProjectCollapse(group.projectName)"
          >
            <template #left>
              <span class="project-icon-stack">
                <span class="project-icon-folder">
                  <IconTablerFolder v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerFolderOpen v-else class="thread-icon" />
                </span>
                <span class="project-icon-chevron">
                  <IconTablerChevronRight v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerChevronDown v-else class="thread-icon" />
                </span>
              </span>
            </template>
            <span
              class="project-main-button"
              :data-dragging-handle="isDraggingProject(group.projectName)"
              @mousedown.left="onProjectHandleMouseDown($event, group.projectName)"
            >
              <span class="project-title-wrap">
                <span class="project-title">{{ getProjectDisplayName(group.projectName) }}</span>
                <span class="project-summary">{{ getProjectSummary(group) }}</span>
              </span>
            </span>
            <template #right>
              <div class="project-hover-controls">
                <div :ref="(el) => setProjectMenuWrapRef(group.projectName, el)" class="project-menu-wrap">
                  <button
                    class="project-menu-trigger"
                    type="button"
                    title="project_menu"
                    @click.stop="toggleProjectMenu(group.projectName)"
                  >
                    <IconTablerDots class="thread-icon" />
                  </button>

                  <div v-if="isProjectMenuOpen(group.projectName)" class="project-menu-panel" @pointerdown.stop @click.stop>
                    <template v-if="projectMenuMode === 'actions'">
                      <button class="project-menu-item" type="button" @pointerdown.stop @click.stop.prevent="openRenameProjectMenu(group.projectName)">
                        修改名称
                      </button>
                      <button
                        class="project-menu-item project-menu-item-danger"
                        type="button"
                        @pointerdown.stop
                        @click.stop.prevent="onRemoveProject(group.projectName)"
                      >
                        移除
                      </button>
                    </template>
                    <template v-else>
                      <label class="project-menu-label">项目名称</label>
                      <input
                        v-model="projectRenameDraft"
                        class="project-menu-input"
                        type="text"
                        @input="onProjectNameInput(group.projectName)"
                      />
                    </template>
                  </div>
                </div>

                <button
                  class="thread-start-button"
                  type="button"
                  :aria-label="getNewThreadButtonAriaLabel(group.projectName)"
                  :title="getNewThreadButtonAriaLabel(group.projectName)"
                  @click.stop="onStartNewThread(group.projectName)"
                >
                  <IconTablerFilePencil class="thread-icon" />
                </button>
              </div>
            </template>
          </SidebarMenuRow>

          <ul v-if="hasThreads(group)" class="thread-list">
            <li v-for="thread in visibleThreads(group)" :key="thread.id" class="thread-row-item">
              <SidebarMenuRow
                class="thread-row"
                :data-thread-id="thread.id"
                :data-active="thread.id === selectedThreadId"
                :data-pinned="isPinned(thread.id)"
                :force-right-hover="isThreadMenuOpen(thread.id)"
                @mouseleave="onThreadRowLeave(thread.id)"
                @contextmenu="onThreadRowContextMenu($event, thread.id)"
              >
                <template #left>
                  <span class="thread-left-stack">
                    <span
                      v-if="thread.inProgress || thread.unread"
                      class="thread-status-indicator"
                      :data-state="getThreadState(thread)"
                      :title="getThreadStatusLabel(thread)"
                    />
                    <button class="thread-pin-button" type="button" title="置顶" @click="togglePin(thread.id)">
                      <IconTablerPin class="thread-icon" />
                    </button>
                  </span>
                </template>
                <button class="thread-main-button" type="button" @click="onSelect(thread.id)">
                  <span class="thread-row-content">
                    <span class="thread-row-title-wrap">
                      <span class="thread-row-title">{{ thread.title }}</span>
                      <IconTablerGitFork v-if="thread.hasWorktree" class="thread-row-worktree-icon" title="工作树会话" />
                    </span>
                    <span class="thread-row-meta">
                      <span class="thread-row-preview">{{ getThreadPreview(thread) }}</span>
                      <span v-if="thread.sourceKind" class="thread-row-source">{{ formatThreadSource(thread) }}</span>
                      <span v-if="thread.inProgress" class="thread-row-source thread-row-source--working">执行中</span>
                      <span v-else-if="thread.unread" class="thread-row-source thread-row-source--unread">未读</span>
                    </span>
                  </span>
                </button>
                <template #right>
                  <span class="thread-row-time">{{ formatRelativeThread(thread) }}</span>
                </template>
                <template #right-hover>
                  <div :ref="(el) => setThreadMenuWrapRef(thread.id, el)" class="thread-menu-wrap">
                    <button
                      class="thread-menu-trigger"
                      type="button"
                      title="thread_menu"
                      @click.stop="toggleThreadMenu(thread.id)"
                    >
                      <IconTablerDots class="thread-icon" />
                    </button>
                    <div v-if="isThreadMenuOpen(thread.id)" class="thread-menu-panel" @pointerdown.stop @click.stop>
                      <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onBrowseThreadFiles(thread.id)">
                        浏览文件
                      </button>
                      <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onExportThread(thread.id)">
                        导出会话
                      </button>
                      <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onToggleThreadPin(thread.id)">
                        {{ isPinned(thread.id) ? '取消置顶' : '置顶会话' }}
                      </button>
                      <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="onForkThread(thread.id)">
                        创建分支会话
                      </button>
                      <button class="thread-menu-item" type="button" @pointerdown.stop @click.stop.prevent="openRenameThreadDialog(thread.id, thread.title)">
                        重命名会话
                      </button>
                      <button class="thread-menu-item thread-menu-item-danger" type="button" @pointerdown.stop @click.stop.prevent="openDeleteThreadDialog(thread.id, thread.title)">
                        删除会话
                      </button>
                    </div>
                  </div>
                </template>
              </SidebarMenuRow>
            </li>
          </ul>

          <SidebarMenuRow v-else as="p" class="project-empty-row">
            <template #left>
              <span class="project-empty-spacer" />
            </template>
            <span class="project-empty">暂无会话</span>
          </SidebarMenuRow>

          <SidebarMenuRow v-if="hasHiddenThreads(group)" class="thread-show-more-row">
            <template #left>
              <span class="thread-show-more-spacer" />
            </template>
            <button class="thread-show-more-button" type="button" @click="toggleProjectExpansion(group.projectName)">
              {{ isExpanded(group.projectName) ? '收起' : '展开更多' }}
            </button>
          </SidebarMenuRow>
      </article>
    </div>

    <Teleport to="body">
      <div v-if="renameThreadDialogVisible" class="rename-thread-overlay" @click.self="onRenameThreadOverlayClick">
        <div
          class="rename-thread-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Thread title"
          @pointerdown.stop
          @click.stop
        >
          <h3 class="rename-thread-title">重命名会话</h3>
          <p class="rename-thread-subtitle">建议简短、容易识别。</p>
          <input
            ref="renameThreadInputRef"
            v-model="renameThreadDraft"
            class="rename-thread-input"
            type="text"
            placeholder="输入会话标题..."
            @pointerdown.stop
            @click.stop
            @keydown.enter.prevent="submitRenameThread"
            @keydown.esc.prevent="closeRenameThreadDialog"
          />
          <div class="rename-thread-actions">
            <button class="rename-thread-button" type="button" @pointerdown.stop @click.stop.prevent="closeRenameThreadDialog">取消</button>
            <button class="rename-thread-button rename-thread-button-primary" type="button" @pointerdown.stop @click.stop.prevent="submitRenameThread">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="deleteThreadDialogVisible" class="rename-thread-overlay" @click.self="closeDeleteThreadDialog">
        <div
          class="rename-thread-panel"
          role="dialog"
          aria-modal="true"
          aria-label="删除会话"
          @pointerdown.stop
          @click.stop
        >
          <h3 class="rename-thread-title">删除会话？</h3>
          <p class="rename-thread-subtitle">
            这会把会话“{{ deleteThreadTitle }}”移到归档中，之后仍可在归档列表中找到。
          </p>
          <div class="rename-thread-actions">
            <button class="rename-thread-button" type="button" @pointerdown.stop @click.stop.prevent="closeDeleteThreadDialog">取消</button>
            <button class="rename-thread-button rename-thread-button-danger" type="button" @pointerdown.stop @click.stop.prevent="submitDeleteThread">删除</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { getPinnedThreadIds, updatePinnedThreadIds } from '../../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'
import IconTablerGitFork from '../icons/IconTablerGitFork.vue'
import IconTablerPin from '../icons/IconTablerPin.vue'
import SidebarMenuRow from './SidebarMenuRow.vue'

const props = defineProps<{
  groups: UiProjectGroup[]
  projectDisplayNameById: Record<string, string>
  selectedThreadId: string
  isLoading: boolean
  searchQuery: string
  searchMatchedThreadIds: string[] | null
  desktopListParity?: boolean
  pinnedThreadIdsOverride?: string[]
}>()

const emit = defineEmits<{
  select: [threadId: string]
  archive: [threadId: string]
  'start-new-thread': [projectName: string]
  'browse-thread-files': [threadId: string]
  'rename-project': [payload: { projectName: string; displayName: string }]
  'rename-thread': [payload: { threadId: string; title: string }]
  'remove-project': [projectName: string]
  'reorder-project': [payload: { projectName: string; toIndex: number }]
  'export-thread': [threadId: string]
  'fork-thread': [threadId: string]
}>()

type PendingProjectDrag = {
  projectName: string
  fromIndex: number
  startClientX: number
  startClientY: number
  pointerOffsetY: number
  groupLeft: number
  groupWidth: number
  groupHeight: number
  groupOuterHeight: number
}

type ActiveProjectDrag = {
  projectName: string
  fromIndex: number
  pointerOffsetY: number
  groupLeft: number
  groupWidth: number
  groupHeight: number
  groupOuterHeight: number
  ghostTop: number
  dropTargetIndexFull: number | null
}

type DragPointerSample = {
  clientX: number
  clientY: number
}

const DRAG_START_THRESHOLD_PX = 4
const PROJECT_GROUP_EXPANDED_GAP_PX = 6
const expandedProjects = ref<Record<string, boolean>>({})
const collapsedProjects = ref<Record<string, boolean>>({})
const PINNED_THREAD_STORAGE_KEY = 'codex-web-local.pinned-thread-ids.v1'
const pinnedThreadIds = ref<string[]>(normalizePinnedThreadIds(props.pinnedThreadIdsOverride ?? loadPinnedThreadIds()))
const hasPinnedThreadIdsHydrated = ref(false)
let pinnedThreadIdsSequence = 0
let pinnedThreadIdsHydrationPromise: Promise<void> | null = null
const openProjectMenuId = ref('')
const openThreadMenuId = ref('')
const projectMenuMode = ref<'actions' | 'rename'>('actions')
const projectRenameDraft = ref('')
const renameThreadDialogVisible = ref(false)
const renameThreadDialogThreadId = ref('')
const renameThreadDraft = ref('')
const renameThreadInputRef = ref<HTMLInputElement | null>(null)
const renameThreadDialogOpenedAt = ref(0)
const deleteThreadDialogVisible = ref(false)
const deleteThreadDialogThreadId = ref('')
const deleteThreadTitle = ref('')
const groupsContainerRef = ref<HTMLElement | null>(null)
const pendingProjectDrag = ref<PendingProjectDrag | null>(null)
const activeProjectDrag = ref<ActiveProjectDrag | null>(null)
let pendingDragPointerSample: DragPointerSample | null = null
let dragPointerRafId: number | null = null
const suppressNextProjectToggleId = ref('')
const measuredHeightByProject = ref<Record<string, number>>({})
const projectGroupElementByName = new Map<string, HTMLElement>()
const projectMenuWrapElementByName = new Map<string, HTMLElement>()
const threadMenuWrapElementById = new Map<string, HTMLElement>()
const projectNameByElement = new WeakMap<HTMLElement, string>()
const organizeMenuWrapRef = ref<HTMLElement | null>(null)
const isOrganizeMenuOpen = ref(false)
const THREAD_VIEW_MODE_STORAGE_KEY = 'codex-web-local.thread-view-mode.v1'
const threadViewMode = ref<'project' | 'chronological'>(loadThreadViewMode())
const projectGroupResizeObserver =
  typeof window !== 'undefined'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          const projectName = projectNameByElement.get(element)
          if (!projectName) continue
          updateMeasuredProjectHeight(projectName, element)
        }
      })
    : null
const COLLAPSED_STORAGE_KEY = 'codex-web-local.collapsed-projects.v1'

function normalizePinnedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const threadId = item.trim()
    if (!threadId || normalized.includes(threadId)) continue
    normalized.push(threadId)
  }
  return normalized
}

function areStringArraysEqual(first: string[], second: string[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function loadCollapsedState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function loadThreadViewMode(): 'project' | 'chronological' {
  if (typeof window === 'undefined') return 'project'

  const raw = window.localStorage.getItem(THREAD_VIEW_MODE_STORAGE_KEY)
  return raw === 'chronological' ? 'chronological' : 'project'
}

function loadPinnedThreadIds(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PINNED_THREAD_STORAGE_KEY)
    if (!raw) return []
    return normalizePinnedThreadIds(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

function savePinnedThreadIds(value: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PINNED_THREAD_STORAGE_KEY, JSON.stringify(value))
}

function setPinnedThreadIds(value: string[]): void {
  const normalized = normalizePinnedThreadIds(value)
  if (areStringArraysEqual(pinnedThreadIds.value, normalized)) return
  const previousPinnedThreadIds = pinnedThreadIds.value
  pinnedThreadIds.value = normalized
  if (hasPinnedThreadIdsOverride.value) return
  savePinnedThreadIds(normalized)
  if (!hasPinnedThreadIdsHydrated.value) return
  void persistPinnedThreadIds(normalized, previousPinnedThreadIds)
}

async function hydratePinnedThreadIds(): Promise<void> {
  if (pinnedThreadIdsHydrationPromise) {
    await pinnedThreadIdsHydrationPromise
    return
  }

  const hydrationPromise = (async () => {
    try {
      if (hasPinnedThreadIdsOverride.value) return
      const hydrationSequence = pinnedThreadIdsSequence
      const serverPinnedThreadIds = await getPinnedThreadIds()
      if (pinnedThreadIdsSequence !== hydrationSequence) return
      if (serverPinnedThreadIds.length === 0 && pinnedThreadIds.value.length > 0) {
        const migrated = await updatePinnedThreadIds(pinnedThreadIds.value)
        if (pinnedThreadIdsSequence !== hydrationSequence) return
        pinnedThreadIds.value = migrated
        savePinnedThreadIds(migrated)
        return
      }

      pinnedThreadIds.value = serverPinnedThreadIds
      savePinnedThreadIds(serverPinnedThreadIds)
    } catch {
      // Keep local cache when account-level sync is temporarily unavailable.
    } finally {
      hasPinnedThreadIdsHydrated.value = true
    }
  })()
  pinnedThreadIdsHydrationPromise = hydrationPromise

  try {
    await hydrationPromise
  } finally {
    if (pinnedThreadIdsHydrationPromise === hydrationPromise) {
      pinnedThreadIdsHydrationPromise = null
    }
  }
}

async function persistPinnedThreadIds(nextPinnedThreadIds: string[], previousPinnedThreadIds: string[]): Promise<void> {
  const sequence = pinnedThreadIdsSequence + 1
  pinnedThreadIdsSequence = sequence
  try {
    const saved = await updatePinnedThreadIds(nextPinnedThreadIds)
    if (pinnedThreadIdsSequence !== sequence) return
    pinnedThreadIds.value = saved
    savePinnedThreadIds(saved)
  } catch (error) {
    if (pinnedThreadIdsSequence !== sequence) return
    pinnedThreadIds.value = previousPinnedThreadIds
    savePinnedThreadIds(previousPinnedThreadIds)
    console.warn('Failed to persist pinned thread ids', error)
  }
}

collapsedProjects.value = loadCollapsedState()

onMounted(() => {
  window.addEventListener('focus', onWindowFocusRefreshPinned)
  if (!hasPinnedThreadIdsOverride.value) {
    void hydratePinnedThreadIds()
  }
})

function onWindowFocusRefreshPinned(): void {
  if (hasPinnedThreadIdsOverride.value) return
  void hydratePinnedThreadIds()
}

watch(
  collapsedProjects,
  (value) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

watch(threadViewMode, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THREAD_VIEW_MODE_STORAGE_KEY, value)
})

const normalizedSearchQuery = computed(() => props.searchQuery.trim().toLowerCase())

const isSearchActive = computed(() => normalizedSearchQuery.value.length > 0)
const useDesktopListParity = computed(() => props.desktopListParity === true)
const hasPinnedThreadIdsOverride = computed(() => Array.isArray(props.pinnedThreadIdsOverride))
const effectivePinnedThreadIds = computed(() => (
  hasPinnedThreadIdsOverride.value
    ? normalizePinnedThreadIds(props.pinnedThreadIdsOverride)
    : pinnedThreadIds.value
))
const matchedThreadIdSet = computed(() => {
  if (!props.searchMatchedThreadIds) return null
  return new Set(props.searchMatchedThreadIds)
})
const pinnedThreadIdSet = computed(() => new Set(effectivePinnedThreadIds.value))

function matchesThreadSearch(
  thread: UiThread,
  query: string,
  matchedIds: Set<string> | null,
): boolean {
  if (!query) return true
  if (matchedIds) {
    return matchedIds.has(thread.id)
  }
  return thread.title.toLowerCase().includes(query)
}

function compareThreadByUpdatedAt(first: UiThread, second: UiThread): number {
  const firstTimestamp = new Date(first.updatedAtIso || first.createdAtIso).getTime()
  const secondTimestamp = new Date(second.updatedAtIso || second.createdAtIso).getTime()
  return secondTimestamp - firstTimestamp
}

const threadCollections = computed(() => {
  const query = normalizedSearchQuery.value
  const matchedIds = matchedThreadIdSet.value
  const pinnedIds = effectivePinnedThreadIds.value
  const pinnedSet = new Set(pinnedIds)
  const threadById = new Map<string, UiThread>()
  const threadProjectNameById = new Map<string, string>()
  const threadTimestampById = new Map<string, number>()

  for (const group of props.groups) {
    for (const thread of group.threads) {
      threadById.set(thread.id, thread)
      threadProjectNameById.set(thread.id, group.projectName)
      threadTimestampById.set(thread.id, new Date(thread.updatedAtIso || thread.createdAtIso).getTime())
    }
  }

  const filteredGroups = query
    ? props.groups
      .map((group) => ({
        ...group,
        threads: group.threads.filter((thread) => matchesThreadSearch(thread, query, matchedIds)),
      }))
      .filter((group) => group.threads.length > 0)
    : props.groups

  const runningThreads: UiThread[] = []
  for (const group of filteredGroups) {
    for (const thread of group.threads) {
      if (thread.inProgress && !pinnedSet.has(thread.id)) {
        runningThreads.push(thread)
      }
    }
  }
  runningThreads.sort(compareThreadByUpdatedAt)

  const prioritizedThreadIdSet = new Set<string>([
    ...pinnedIds,
    ...runningThreads.map((thread) => thread.id),
  ])

  const pinnedThreads = pinnedIds
    .map((threadId) => threadById.get(threadId) ?? null)
    .filter((thread): thread is UiThread => thread !== null)
    .filter((thread) => matchesThreadSearch(thread, query, matchedIds))

  const globalThreads: UiThread[] = []
  for (const group of filteredGroups) {
    for (const thread of group.threads) {
      if (prioritizedThreadIdSet.has(thread.id)) continue
      globalThreads.push(thread)
    }
  }
  globalThreads.sort(compareThreadByUpdatedAt)

  return {
    filteredGroups,
    globalThreads,
    threadById,
    threadProjectNameById,
    threadTimestampById,
    pinnedThreads,
    runningThreads,
    prioritizedThreadIdSet,
  }
})

function threadMatchesSearch(thread: UiThread): boolean {
  return matchesThreadSearch(thread, normalizedSearchQuery.value, matchedThreadIdSet.value)
}

const filteredGroups = computed<UiProjectGroup[]>(() => threadCollections.value.filteredGroups)
const displayedGroups = computed<UiProjectGroup[]>(() => filteredGroups.value)
const effectiveThreadViewMode = computed<'project' | 'chronological'>(() => (
  useDesktopListParity.value ? 'project' : threadViewMode.value
))
const isChronologicalView = computed(() => effectiveThreadViewMode.value === 'chronological')
const threadTreeHeader = computed(() => (isChronologicalView.value ? '最近会话' : '项目'))
const threadTreeHeaderSubtitle = computed(() => (
  isChronologicalView.value ? '按最近活动排序' : '按工作区分组浏览'
))
const globalThreads = computed<UiThread[]>(() => threadCollections.value.globalThreads)
const threadById = computed(() => threadCollections.value.threadById)
const threadProjectNameById = computed(() => threadCollections.value.threadProjectNameById)
const threadTimestampById = computed(() => threadCollections.value.threadTimestampById)
const pinnedThreads = computed(() => threadCollections.value.pinnedThreads)
const runningThreads = computed<UiThread[]>(() => threadCollections.value.runningThreads)

const projectedDropProjectIndex = computed<number | null>(() => {
  const drag = activeProjectDrag.value
  if (!drag || drag.dropTargetIndexFull === null || props.groups.length === 0) return null

  const boundedDropIndex = Math.max(0, Math.min(drag.dropTargetIndexFull, props.groups.length))
  const projectedIndex = boundedDropIndex > drag.fromIndex ? boundedDropIndex - 1 : boundedDropIndex
  const boundedProjectedIndex = Math.max(0, Math.min(projectedIndex, props.groups.length - 1))
  return boundedProjectedIndex === drag.fromIndex ? null : boundedProjectedIndex
})

const layoutProjectOrder = computed<string[]>(() => {
  const sourceGroups = useDesktopListParity.value
    ? displayedGroups.value
    : (isSearchActive.value ? filteredGroups.value : props.groups)
  const names = sourceGroups.map((group) => group.projectName)
  const drag = activeProjectDrag.value
  const projectedIndex = projectedDropProjectIndex.value

  if (!drag || projectedIndex === null) {
    return names
  }

  const next = [...names]
  const [movedProject] = next.splice(drag.fromIndex, 1)
  if (!movedProject) {
    return names
  }
  next.splice(projectedIndex, 0, movedProject)
  return next
})

const layoutTopByProject = computed<Record<string, number>>(() => {
  const topByProject: Record<string, number> = {}
  let currentTop = 0

  for (const projectName of layoutProjectOrder.value) {
    topByProject[projectName] = currentTop
    currentTop += getProjectOuterHeight(projectName)
  }

  return topByProject
})

const groupsContainerStyle = computed<Record<string, string>>(() => {
  let totalHeight = 0
  for (const projectName of layoutProjectOrder.value) {
    totalHeight += getProjectOuterHeight(projectName)
  }

  return {
    height: `${Math.max(0, totalHeight)}px`,
  }
})

function formatRelative(timestamp: number): string {
  if (Number.isNaN(timestamp)) return 'n/a'

  const diffMs = Math.abs(Date.now() - timestamp)
  if (diffMs < 60000) return 'now'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatRelativeThread(thread: UiThread): string {
  const timestamp = threadTimestampById.value.get(thread.id)
  if (typeof timestamp === 'number') {
    return formatRelative(timestamp)
  }
  return formatRelative(new Date(thread.updatedAtIso || thread.createdAtIso).getTime())
}

function getThreadPreview(thread: UiThread): string {
  const preview = thread.preview.trim()
  if (preview.length > 0) return preview

  const normalizedCwd = thread.cwd.trim().replace(/\\/gu, '/')
  if (!normalizedCwd) return getProjectDisplayName(thread.projectName)
  return normalizedCwd.split('/').filter(Boolean).pop() || normalizedCwd
}

function getThreadStatusLabel(thread: UiThread): string {
  if (thread.inProgress) return '执行中'
  if (thread.unread) return '未读'
  return thread.hasWorktree ? '工作树' : '就绪'
}

function formatThreadSource(thread: UiThread): string {
  const source = thread.sourceKind?.trim()
  if (!source) return ''
  if (source === 'cli') return 'CLI'
  if (source.startsWith('subAgent.')) return '子任务'
  if (source === 'app' || source === 'desktop') return '桌面端'
  return source
}

function getProjectSummary(group: UiProjectGroup): string {
  const total = group.threads.length
  const running = group.threads.filter((thread) => thread.inProgress).length
  const threadLabel = '个会话'
  if (running > 0) {
    return `${total}${threadLabel} · ${running} 个运行中`
  }
  return `${total}${threadLabel}`
}

function isPinned(threadId: string): boolean {
  return pinnedThreadIdSet.value.has(threadId)
}

function togglePin(threadId: string): void {
  const currentPinnedThreadIds = effectivePinnedThreadIds.value
  if (isPinned(threadId)) {
    setPinnedThreadIds(currentPinnedThreadIds.filter((id) => id !== threadId))
    return
  }

  setPinnedThreadIds([threadId, ...currentPinnedThreadIds])
}

function onToggleThreadPin(threadId: string): void {
  togglePin(threadId)
  closeThreadMenu()
}

function onSelect(threadId: string): void {
  emit('select', threadId)
}

function onExportThread(threadId: string): void {
  emit('export-thread', threadId)
  closeThreadMenu()
}

function onForkThread(threadId: string): void {
  emit('fork-thread', threadId)
  closeThreadMenu()
}

function getNewThreadButtonAriaLabel(projectName: string): string {
  return `在 ${getProjectDisplayName(projectName)} 中新建会话`
}

function onStartNewThread(projectName: string): void {
  emit('start-new-thread', projectName)
}

function onBrowseThreadFiles(threadId: string): void {
  emit('browse-thread-files', threadId)
  closeThreadMenu()
}

function onThreadRowLeave(threadId: string): void {
  if (openThreadMenuId.value === threadId) {
    closeThreadMenu()
  }
}

function isThreadMenuOpen(threadId: string): boolean {
  return openThreadMenuId.value === threadId
}

function closeThreadMenu(): void {
  openThreadMenuId.value = ''
}

function toggleThreadMenu(threadId: string): void {
  if (openThreadMenuId.value === threadId) {
    closeThreadMenu()
    return
  }
  openThreadMenuId.value = threadId
}

function onThreadRowContextMenu(event: MouseEvent, threadId: string): void {
  event.preventDefault()
  openThreadMenuId.value = threadId
}

function focusRenameThreadInput(): void {
  if (typeof window === 'undefined') return

  window.requestAnimationFrame(() => {
    if (!renameThreadDialogVisible.value) return
    const input = renameThreadInputRef.value
    if (!input) return
    input.focus({ preventScroll: true })
    input.select()
  })
}

function openRenameThreadDialog(threadId: string, currentTitle: string): void {
  closeThreadMenu()
  renameThreadDialogThreadId.value = threadId
  renameThreadDraft.value = currentTitle
  renameThreadDialogOpenedAt.value = typeof performance === 'undefined' ? Date.now() : performance.now()
  renameThreadDialogVisible.value = true
  void nextTick(focusRenameThreadInput)
}

function closeRenameThreadDialog(): void {
  renameThreadDialogVisible.value = false
  renameThreadDialogThreadId.value = ''
  renameThreadDraft.value = ''
  renameThreadDialogOpenedAt.value = 0
}

function onRenameThreadOverlayClick(): void {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now()
  if (renameThreadDialogOpenedAt.value > 0 && now - renameThreadDialogOpenedAt.value < 250) return
  closeRenameThreadDialog()
}

function submitRenameThread(): void {
  const threadId = renameThreadDialogThreadId.value
  const title = renameThreadDraft.value.trim()
  if (!threadId || !title) return
  emit('rename-thread', { threadId, title })
  closeRenameThreadDialog()
}

function openDeleteThreadDialog(threadId: string, currentTitle: string): void {
  deleteThreadDialogThreadId.value = threadId
  deleteThreadTitle.value = currentTitle
  deleteThreadDialogVisible.value = true
  closeThreadMenu()
}

function closeDeleteThreadDialog(): void {
  deleteThreadDialogVisible.value = false
  deleteThreadDialogThreadId.value = ''
  deleteThreadTitle.value = ''
}

function submitDeleteThread(): void {
  const threadId = deleteThreadDialogThreadId.value
  if (!threadId) return
  setPinnedThreadIds(pinnedThreadIds.value.filter((id) => id !== threadId))
  emit('archive', threadId)
  closeDeleteThreadDialog()
}

function getProjectDisplayName(projectName: string): string {
  return props.projectDisplayNameById[projectName] ?? projectName
}

function isProjectMenuOpen(projectName: string): boolean {
  return openProjectMenuId.value === projectName
}

function closeProjectMenu(): void {
  openProjectMenuId.value = ''
  projectMenuMode.value = 'actions'
  projectRenameDraft.value = ''
}

function toggleOrganizeMenu(): void {
  isOrganizeMenuOpen.value = !isOrganizeMenuOpen.value
}

function setThreadViewMode(mode: 'project' | 'chronological'): void {
  threadViewMode.value = mode
  isOrganizeMenuOpen.value = false
}

function toggleProjectMenu(projectName: string): void {
  if (openProjectMenuId.value === projectName) {
    closeProjectMenu()
    return
  }

  openProjectMenuId.value = projectName
  projectMenuMode.value = 'actions'
  projectRenameDraft.value = getProjectDisplayName(projectName)
}

function openRenameProjectMenu(projectName: string): void {
  openProjectMenuId.value = projectName
  projectMenuMode.value = 'rename'
  projectRenameDraft.value = getProjectDisplayName(projectName)
}

function onProjectNameInput(projectName: string): void {
  emit('rename-project', {
    projectName,
    displayName: projectRenameDraft.value,
  })
}

function onRemoveProject(projectName: string): void {
  const targetGroup = props.groups.find((group) => group.projectName === projectName)
  const archivedThreadIds = new Set(
    (targetGroup?.threads ?? [])
      .map((thread) => thread.id.trim())
      .filter((threadId) => threadId.length > 0),
  )
  if (archivedThreadIds.size > 0) {
    setPinnedThreadIds(pinnedThreadIds.value.filter((threadId) => !archivedThreadIds.has(threadId)))
  }
  emit('remove-project', projectName)
  closeProjectMenu()
}

function onProjectHeaderKeyDown(event: KeyboardEvent, projectName: string): void {
  if (!event.altKey) return
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

  const currentIndex = props.groups.findIndex((group) => group.projectName === projectName)
  if (currentIndex < 0) return

  const delta = event.key === 'ArrowUp' ? -1 : 1
  const targetIndex = Math.max(0, Math.min(currentIndex + delta, props.groups.length - 1))
  if (targetIndex === currentIndex) return

  event.preventDefault()
  emit('reorder-project', {
    projectName,
    toIndex: targetIndex,
  })
}

function isExpanded(projectName: string): boolean {
  return expandedProjects.value[projectName] === true
}

function isCollapsed(projectName: string): boolean {
  return collapsedProjects.value[projectName] === true
}

function toggleProjectExpansion(projectName: string): void {
  expandedProjects.value = {
    ...expandedProjects.value,
    [projectName]: !isExpanded(projectName),
  }
}

function toggleProjectCollapse(projectName: string): void {
  if (suppressNextProjectToggleId.value === projectName) {
    suppressNextProjectToggleId.value = ''
    return
  }

  collapsedProjects.value = {
    ...collapsedProjects.value,
    [projectName]: !isCollapsed(projectName),
  }
}

function getProjectOuterHeight(projectName: string): number {
  const measuredHeight = measuredHeightByProject.value[projectName] ?? 0
  const drag = activeProjectDrag.value
  const dragHeight = drag?.projectName === projectName ? drag.groupHeight : null
  const baseHeight = dragHeight ?? measuredHeight
  const gap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  return Math.max(0, Math.round(baseHeight + gap))
}

function setProjectMenuWrapRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectMenuWrapElementByName.set(projectName, htmlElement)
    return
  }

  projectMenuWrapElementByName.delete(projectName)
}

function setThreadMenuWrapRef(threadId: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    threadMenuWrapElementById.set(threadId, htmlElement)
    return
  }

  threadMenuWrapElementById.delete(threadId)
}

function isEventInsideOpenProjectMenu(event: Event): boolean {
  const projectName = openProjectMenuId.value
  if (!projectName) return false

  const openMenuWrapElement = projectMenuWrapElementByName.get(projectName)
  if (!openMenuWrapElement) return false

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (eventPath.includes(openMenuWrapElement)) return true

  const target = event.target
  return target instanceof Node ? openMenuWrapElement.contains(target) : false
}

function isEventInsideOpenThreadMenu(event: Event): boolean {
  const threadId = openThreadMenuId.value
  if (!threadId) return false

  const openMenuWrapElement = threadMenuWrapElementById.get(threadId)
  if (!openMenuWrapElement) return false

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (eventPath.includes(openMenuWrapElement)) return true

  const target = event.target
  return target instanceof Node ? openMenuWrapElement.contains(target) : false
}

function onProjectMenuPointerDown(event: PointerEvent): void {
  if (isOrganizeMenuOpen.value) {
    const organizeElement = organizeMenuWrapRef.value
    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
    const isInsideOrganizeMenu =
      !!organizeElement &&
      (eventPath.includes(organizeElement) || (event.target instanceof Node && organizeElement.contains(event.target)))

    if (!isInsideOrganizeMenu) {
      isOrganizeMenuOpen.value = false
    }
  }

  if (!openProjectMenuId.value) return
  if (!isEventInsideOpenProjectMenu(event)) {
    closeProjectMenu()
  }

  if (!openThreadMenuId.value) return
  if (isEventInsideOpenThreadMenu(event)) return
  closeThreadMenu()
}

function onProjectMenuFocusIn(event: FocusEvent): void {
  if (openProjectMenuId.value && !isEventInsideOpenProjectMenu(event)) {
    closeProjectMenu()
  }
  if (openThreadMenuId.value && !isEventInsideOpenThreadMenu(event)) {
    closeThreadMenu()
  }
}

function onWindowBlurForProjectMenu(): void {
  if (isOrganizeMenuOpen.value) {
    isOrganizeMenuOpen.value = false
  }
  if (openProjectMenuId.value) {
    closeProjectMenu()
  }
  if (openThreadMenuId.value) {
    closeThreadMenu()
  }
}

function bindProjectMenuDismissListeners(): void {
  window.addEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.addEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.addEventListener('blur', onWindowBlurForProjectMenu)
}

function unbindProjectMenuDismissListeners(): void {
  window.removeEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.removeEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.removeEventListener('blur', onWindowBlurForProjectMenu)
}

function updateMeasuredProjectHeight(projectName: string, element: HTMLElement): void {
  const nextHeight = Math.round(element.getBoundingClientRect().height)
  if (!Number.isFinite(nextHeight) || nextHeight <= 0) return

  const previousHeight = measuredHeightByProject.value[projectName]
  if (previousHeight !== undefined && Math.abs(previousHeight - nextHeight) < 1) {
    return
  }

  measuredHeightByProject.value = {
    ...measuredHeightByProject.value,
    [projectName]: nextHeight,
  }
}

function setProjectGroupRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const previousElement = projectGroupElementByName.get(projectName)
  if (previousElement && previousElement !== element && projectGroupResizeObserver) {
    projectGroupResizeObserver.unobserve(previousElement)
  }

  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectGroupElementByName.set(projectName, htmlElement)
    projectNameByElement.set(htmlElement, projectName)
    updateMeasuredProjectHeight(projectName, htmlElement)
    projectGroupResizeObserver?.observe(htmlElement)
    return
  }

  if (previousElement) {
    projectGroupResizeObserver?.unobserve(previousElement)
  }

  projectGroupElementByName.delete(projectName)
}

function onProjectHandleMouseDown(event: MouseEvent, projectName: string): void {
  if (event.button !== 0) return
  if (pendingProjectDrag.value || activeProjectDrag.value) return

  const fromIndex = props.groups.findIndex((group) => group.projectName === projectName)
  const projectGroupElement = projectGroupElementByName.get(projectName)
  if (fromIndex < 0 || !projectGroupElement) return

  const groupRect = projectGroupElement.getBoundingClientRect()
  const groupGap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  pendingProjectDrag.value = {
    projectName,
    fromIndex,
    startClientX: event.clientX,
    startClientY: event.clientY,
    pointerOffsetY: event.clientY - groupRect.top,
    groupLeft: groupRect.left,
    groupWidth: groupRect.width,
    groupHeight: groupRect.height,
    groupOuterHeight: groupRect.height + groupGap,
  }

  event.preventDefault()
  bindProjectDragListeners()
}

function bindProjectDragListeners(): void {
  window.addEventListener('mousemove', onProjectDragMouseMove)
  window.addEventListener('mouseup', onProjectDragMouseUp)
  window.addEventListener('keydown', onProjectDragKeyDown)
}

function unbindProjectDragListeners(): void {
  window.removeEventListener('mousemove', onProjectDragMouseMove)
  window.removeEventListener('mouseup', onProjectDragMouseUp)
  window.removeEventListener('keydown', onProjectDragKeyDown)
}

function onProjectDragMouseMove(event: MouseEvent): void {
  pendingDragPointerSample = {
    clientX: event.clientX,
    clientY: event.clientY,
  }
  scheduleProjectDragPointerFrame()
}

function onProjectDragMouseUp(event: MouseEvent): void {
  processProjectDragPointerSample({
    clientX: event.clientX,
    clientY: event.clientY,
  })

  const drag = activeProjectDrag.value
  if (drag && projectedDropProjectIndex.value !== null) {
    const currentProjectIndex = props.groups.findIndex((group) => group.projectName === drag.projectName)
    if (currentProjectIndex >= 0) {
      const toIndex = projectedDropProjectIndex.value
      if (toIndex !== currentProjectIndex) {
        emit('reorder-project', {
          projectName: drag.projectName,
          toIndex,
        })
      }
    }
  }

  resetProjectDragState()
}

function onProjectDragKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!pendingProjectDrag.value && !activeProjectDrag.value) return

  event.preventDefault()
  resetProjectDragState()
}

function resetProjectDragState(): void {
  if (dragPointerRafId !== null) {
    window.cancelAnimationFrame(dragPointerRafId)
    dragPointerRafId = null
  }
  pendingDragPointerSample = null
  pendingProjectDrag.value = null
  activeProjectDrag.value = null
  suppressNextProjectToggleId.value = ''
  unbindProjectDragListeners()
}

function scheduleProjectDragPointerFrame(): void {
  if (dragPointerRafId !== null) return

  dragPointerRafId = window.requestAnimationFrame(() => {
    dragPointerRafId = null
    if (!pendingDragPointerSample) return

    const sample = pendingDragPointerSample
    pendingDragPointerSample = null
    processProjectDragPointerSample(sample)
  })
}

function processProjectDragPointerSample(sample: DragPointerSample): void {
  const pending = pendingProjectDrag.value
  if (!activeProjectDrag.value && pending) {
    const deltaX = sample.clientX - pending.startClientX
    const deltaY = sample.clientY - pending.startClientY
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < DRAG_START_THRESHOLD_PX) {
      return
    }

    closeProjectMenu()
    suppressNextProjectToggleId.value = pending.projectName
    activeProjectDrag.value = {
      projectName: pending.projectName,
      fromIndex: pending.fromIndex,
      pointerOffsetY: pending.pointerOffsetY,
      groupLeft: pending.groupLeft,
      groupWidth: pending.groupWidth,
      groupHeight: pending.groupHeight,
      groupOuterHeight: pending.groupOuterHeight,
      ghostTop: sample.clientY - pending.pointerOffsetY,
      dropTargetIndexFull: null,
    }
  }

  if (!activeProjectDrag.value) return
  updateProjectDropTarget(sample)
}

function updateProjectDropTarget(sample: DragPointerSample): void {
  const drag = activeProjectDrag.value
  if (!drag) return

  drag.ghostTop = sample.clientY - drag.pointerOffsetY
  if (!isPointerInProjectDropZone(sample)) {
    drag.dropTargetIndexFull = null
    return
  }

  const cursorY = sample.clientY
  const groupsContainer = groupsContainerRef.value
  if (!groupsContainer) {
    drag.dropTargetIndexFull = null
    return
  }

  const containerRect = groupsContainer.getBoundingClientRect()
  const projectIndexByName = new Map(props.groups.map((group, index) => [group.projectName, index]))
  const nonDraggedProjectNames = props.groups
    .map((group) => group.projectName)
    .filter((projectName) => projectName !== drag.projectName)

  let accumulatedTop = 0
  let nextDropTarget = props.groups.length

  for (const projectName of nonDraggedProjectNames) {
    const originalIndex = projectIndexByName.get(projectName)
    if (originalIndex === undefined) continue

    const groupOuterHeight = getProjectOuterHeight(projectName)
    const groupMiddleY = containerRect.top + accumulatedTop + groupOuterHeight / 2
    if (cursorY < groupMiddleY) {
      nextDropTarget = originalIndex
      break
    }

    accumulatedTop += groupOuterHeight
  }

  drag.dropTargetIndexFull = nextDropTarget
}

function isPointerInProjectDropZone(sample: DragPointerSample): boolean {
  const groupsContainer = groupsContainerRef.value
  if (!groupsContainer) return false

  const bounds = groupsContainer.getBoundingClientRect()
  const xInBounds = sample.clientX >= bounds.left && sample.clientX <= bounds.right
  const yInBounds = sample.clientY >= bounds.top - 32 && sample.clientY <= bounds.bottom + 32
  return xInBounds && yInBounds
}

function isDraggingProject(projectName: string): boolean {
  return activeProjectDrag.value?.projectName === projectName
}

function projectGroupStyle(projectName: string): Record<string, string> | undefined {
  const drag = activeProjectDrag.value
  const targetTop = Math.round(layoutTopByProject.value[projectName] ?? 0)
  const openThreadMenuProjectName = openThreadMenuId.value
    ? (threadProjectNameById.value.get(openThreadMenuId.value) ?? '')
    : ''
  const shouldElevateForMenu =
    openProjectMenuId.value === projectName || openThreadMenuProjectName === projectName

  if (!drag || drag.projectName !== projectName) {
    return {
      position: 'absolute',
      top: `${targetTop}px`,
      left: '0',
      right: '0',
      zIndex: shouldElevateForMenu ? '40' : '1',
      transform: 'none',
      transition: 'top 180ms ease',
    }
  }

  return {
    position: 'fixed',
    top: `${Math.round(drag.ghostTop)}px`,
    left: `${Math.round(drag.groupLeft)}px`,
    width: `${Math.round(drag.groupWidth)}px`,
    height: `${Math.round(drag.groupHeight)}px`,
    zIndex: '50',
    pointerEvents: 'none',
    transform: 'none',
    transition: 'top 0ms linear',
  }
}

function projectThreads(group: UiProjectGroup): UiThread[] {
  if (isSearchActive.value) {
    return group.threads.filter((thread) => threadMatchesSearch(thread))
  }
  return group.threads
}

function visibleThreads(group: UiProjectGroup): UiThread[] {
  if (isSearchActive.value) return projectThreads(group)
  if (isCollapsed(group.projectName)) return []
  if (useDesktopListParity.value) return projectThreads(group)

  const rows = projectThreads(group)
  return isExpanded(group.projectName) ? rows : rows.slice(0, 10)
}

function hasHiddenThreads(group: UiProjectGroup): boolean {
  if (isSearchActive.value) return false
  if (useDesktopListParity.value) return false
  return !isCollapsed(group.projectName) && projectThreads(group).length > 10
}

function hasThreads(group: UiProjectGroup): boolean {
  return projectThreads(group).length > 0
}

function getThreadState(thread: UiThread): 'working' | 'unread' | 'idle' {
  if (thread.inProgress) return 'working'
  if (thread.unread) return 'unread'
  return 'idle'
}

watch(
  () => props.groups.map((group) => group.projectName),
  (projectNames) => {
    const dragProjectName = activeProjectDrag.value?.projectName ?? pendingProjectDrag.value?.projectName ?? ''
    if (dragProjectName && !props.groups.some((group) => group.projectName === dragProjectName)) {
      resetProjectDragState()
    }

    const projectNameSet = new Set(projectNames)
    const nextMeasuredHeights = Object.fromEntries(
      Object.entries(measuredHeightByProject.value).filter(([projectName]) => projectNameSet.has(projectName)),
    ) as Record<string, number>

    if (Object.keys(nextMeasuredHeights).length !== Object.keys(measuredHeightByProject.value).length) {
      measuredHeightByProject.value = nextMeasuredHeights
    }
  },
)

const hasOpenDismissableMenu = computed(() => (
  isOrganizeMenuOpen.value || openProjectMenuId.value !== '' || openThreadMenuId.value !== ''
))

watch(hasOpenDismissableMenu, (isOpen) => {
  if (isOpen) {
    bindProjectMenuDismissListeners()
    return
  }

  unbindProjectMenuDismissListeners()
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocusRefreshPinned)
  for (const element of projectGroupElementByName.values()) {
    projectGroupResizeObserver?.unobserve(element)
  }
  projectGroupElementByName.clear()
  projectMenuWrapElementByName.clear()
  threadMenuWrapElementById.clear()
  unbindProjectMenuDismissListeners()
  resetProjectDragState()
})
</script>

<style scoped>
@reference "tailwindcss";

.thread-tree-root {
  @apply flex flex-col gap-2;
  text-rendering: auto;
  -webkit-font-smoothing: auto;
  -moz-osx-font-smoothing: auto;
}

.thread-section {
  @apply flex flex-col gap-1.5;
}

.pinned-section {
  @apply mb-1;
}

.thread-section-heading {
  @apply px-2 flex items-center justify-between gap-3;
}

.thread-section-label {
  @apply text-[11px] font-semibold;
  color: var(--ui-text-secondary);
  letter-spacing: 0;
}

.thread-section-count {
  @apply inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.thread-tree-header-row {
  @apply cursor-default mt-1;
}

.thread-tree-header-stack {
  @apply flex min-w-0 flex-col gap-0.5;
}

.thread-tree-header {
  @apply text-[13px] font-semibold select-none;
  color: var(--ui-text-primary);
  letter-spacing: 0;
}

.thread-tree-header-subtitle {
  @apply text-[11px] select-none;
  color: var(--ui-text-tertiary);
}

.organize-menu-wrap {
  @apply relative;
}

.organize-menu-trigger {
  @apply h-8 w-8 flex items-center justify-center transition-colors duration-100;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.organize-menu-trigger:hover,
.organize-menu-trigger:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.organize-menu-panel {
  @apply absolute right-0 top-full mt-2 z-30 min-w-48 border p-1.5 backdrop-blur-sm;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 96%, transparent);
  box-shadow: var(--ui-shadow-float);
}

.organize-menu-title {
  @apply px-2 py-1 text-[11px];
  color: var(--ui-text-tertiary);
  letter-spacing: 0;
}

.organize-menu-item {
  @apply w-full px-2.5 py-2 text-sm flex items-center justify-between;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.organize-menu-item:hover,
.organize-menu-item:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.organize-menu-item[data-active='true'] {
  background: var(--ui-bg-row-active);
  color: var(--ui-text-primary);
}

.thread-start-button {
  @apply h-8 w-8 flex items-center justify-center transition-colors duration-100;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.thread-start-button:hover,
.thread-start-button:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-tree-loading {
  @apply px-3 py-1.5 flex flex-col gap-2;
}

.thread-loading-skeleton {
  @apply block h-11 border;
  border-radius: var(--ui-radius-row);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  position: relative;
  overflow: hidden;
}

.thread-loading-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.42) 50%, transparent 100%);
  animation: thread-skeleton-sheen 1.4s ease-in-out infinite;
}

.thread-tree-no-results {
  @apply px-3 py-3 text-sm;
  color: var(--ui-text-secondary);
}

.thread-tree-groups {
  @apply pr-0.5 relative;
}

.project-group {
  @apply m-0 border border-transparent bg-transparent;
  border-radius: var(--ui-radius-card);
  box-shadow: none;
}

.project-group[data-dragging='true'] {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  box-shadow: none;
}

.project-header-row {
  @apply cursor-pointer bg-transparent focus-visible:outline-none;
}

.project-header-row:hover {
  background: var(--ui-bg-row-hover);
}

.project-main-button {
  @apply min-w-0 w-full text-left rounded px-0 py-0 flex items-start min-h-6 cursor-grab;
}

.project-main-button[data-dragging-handle='true'] {
  @apply cursor-grabbing;
}

.project-icon-stack {
  @apply relative w-4 h-4 flex items-center justify-center;
  color: var(--ui-text-secondary);
}

.project-icon-folder {
  @apply absolute inset-0 flex items-center justify-center opacity-100;
}

.project-icon-chevron {
  @apply absolute inset-0 items-center justify-center opacity-0 hidden;
}

.project-title {
  @apply text-[14px] font-semibold truncate select-none;
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
  line-height: 1.25rem;
  letter-spacing: 0;
}

.project-title-wrap {
  @apply min-w-0 flex flex-col gap-1;
}

.project-summary {
  @apply text-[11px] font-medium;
  color: var(--ui-text-tertiary);
  font-family: var(--font-sans-ui);
  line-height: 1.05rem;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-menu-wrap {
  @apply relative;
}

.project-hover-controls {
  @apply flex items-start gap-1;
}

.project-menu-trigger {
  @apply h-6 w-6 rounded-lg p-0 flex items-center justify-center;
  color: var(--ui-text-secondary);
}

.project-menu-trigger:hover,
.project-menu-trigger:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.project-menu-panel {
  @apply absolute right-0 top-full mt-2 z-20 min-w-40 border p-1.5 flex flex-col gap-0.5;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.project-menu-item {
  @apply px-2.5 py-1.5 text-left text-sm transition-colors duration-100;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.project-menu-item:hover,
.project-menu-item:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.project-menu-item-danger {
  color: var(--ui-danger);
}

.project-menu-item-danger:hover,
.project-menu-item-danger:focus-visible {
  background: color-mix(in srgb, var(--ui-danger) 8%, var(--ui-bg-surface));
  color: var(--ui-danger);
}

.project-menu-label {
  @apply px-2 pt-1 text-[11px] font-medium;
  color: var(--ui-text-tertiary);
  letter-spacing: 0;
}

.project-menu-input {
  @apply px-2 py-1 text-sm bg-transparent border-none outline-none;
  color: var(--ui-text-primary);
}

.project-empty-row {
  @apply cursor-default;
}

.project-empty-spacer {
  @apply block w-4 h-4;
}

.project-empty {
  @apply text-sm;
  color: var(--ui-text-tertiary);
}

.thread-list {
  @apply list-none m-0 p-0 flex flex-col gap-0.5;
}

.thread-list-global {
  @apply pr-0.5;
}

.project-group > .thread-list {
  @apply mt-0.5 px-0.5 pb-0.5;
}

.thread-row-item {
  @apply m-0;
}

.thread-row {
  @apply border border-transparent bg-transparent;
  min-height: var(--ui-row-height);
  align-items: center;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

.thread-row-priority {
  border-color: transparent;
  background: var(--ui-bg-surface-muted);
}

.thread-left-stack {
  @apply relative w-5 h-5 flex items-center justify-center;
  margin-top: 0;
  align-self: center;
}

.thread-pin-button {
  @apply absolute inset-[-1px] z-[1] w-5 h-5 rounded-md opacity-0 pointer-events-none transition-colors duration-100 flex items-center justify-center;
  color: var(--ui-text-secondary);
}

.thread-main-button {
  @apply min-w-0 w-full text-left rounded px-0 py-0 flex items-center min-h-0;
}

.thread-row-content {
  @apply min-w-0 flex flex-col justify-center;
  min-height: 2.05rem;
  gap: 0.08rem;
}

.thread-row-title-wrap {
  @apply min-w-0 inline-flex items-center gap-1;
}

.thread-row-title {
  @apply block text-[14px] font-medium truncate whitespace-nowrap;
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
  line-height: 1.12rem;
  letter-spacing: 0;
  text-shadow: none;
}

.thread-row-worktree-icon {
  @apply w-3.5 h-3.5 shrink-0;
  color: var(--ui-text-tertiary);
}

.thread-status-indicator {
  @apply w-2.5 h-2.5 rounded-full pointer-events-none transition-opacity duration-150 ease-out;
}

.thread-row-meta {
  @apply min-w-0 flex items-center gap-1.5;
}

.thread-row-preview {
  @apply block min-w-0 flex-1 text-[12px];
  color: var(--ui-text-secondary);
  font-family: var(--font-sans-ui);
  line-height: 1rem;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: none;
}

.thread-row-source {
  @apply inline-flex shrink-0 items-center gap-1 text-[11px] font-medium leading-none;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ui-text-secondary);
  font-family: var(--font-sans-ui);
}

.thread-row-source::before {
  content: '·';
  color: var(--ui-text-tertiary);
}

.thread-row-source--working {
  color: var(--ui-accent);
}

.thread-row-source--unread {
  color: var(--ui-focus);
}

.thread-row-time {
  @apply block self-center text-[10px] font-medium;
  color: var(--ui-text-tertiary);
  font-family: var(--font-sans-ui);
  font-variant-numeric: tabular-nums;
  line-height: 1rem;
  min-width: 2.4rem;
  padding-top: 0;
  text-align: right;
  background: transparent;
}

.thread-menu-wrap {
  @apply relative;
}

.thread-menu-trigger {
  @apply h-7 w-7 p-0 text-xs flex items-center justify-center;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.thread-menu-trigger:hover,
.thread-menu-trigger:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-menu-panel {
  @apply absolute right-0 top-full mt-2 z-20 min-w-40 border p-1.5 flex flex-col gap-0.5;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.thread-menu-item {
  @apply px-2.5 py-1.5 text-left text-sm transition-colors duration-100;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.thread-menu-item:hover,
.thread-menu-item:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-menu-item-danger {
  color: var(--ui-danger);
}

.thread-menu-item-danger:hover,
.thread-menu-item-danger:focus-visible {
  background: color-mix(in srgb, var(--ui-danger) 8%, var(--ui-bg-surface));
  color: var(--ui-danger);
}

.thread-icon {
  @apply w-4 h-4;
}

.thread-show-more-row {
  @apply mt-1;
}

.thread-show-more-spacer {
  @apply block w-4 h-4;
}

.thread-show-more-button {
  @apply block mx-auto rounded-full px-3 py-1 text-sm font-medium transition-colors duration-100;
  color: var(--ui-text-secondary);
}

.thread-show-more-button:hover,
.thread-show-more-button:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.project-header-row:hover .project-icon-folder {
  @apply opacity-0;
}

.project-header-row:hover .project-icon-chevron {
  @apply flex opacity-100;
}

.thread-row[data-active='true'] {
  border-color: transparent;
  background: var(--ui-bg-row-active);
  box-shadow: none;
}

.thread-row[data-active='true'] .thread-row-title {
  color: var(--ui-text-primary);
}

.thread-row[data-active='true'] .thread-row-preview {
  color: var(--ui-text-secondary);
}

.thread-row:hover,
.thread-row:focus-within {
  border-color: transparent;
  background: var(--ui-bg-row-hover);
  box-shadow: none;
}

.thread-row:hover .thread-pin-button,
.thread-row:focus-within .thread-pin-button {
  @apply opacity-100 pointer-events-auto;
}

.thread-pin-button:hover,
.thread-pin-button:focus-visible {
  @apply outline-none;
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-status-indicator[data-state='unread'] {
  width: 7px;
  height: 7px;
  background: var(--ui-accent);
}

.thread-status-indicator[data-state='working'] {
  width: 7px;
  height: 7px;
  background: var(--ui-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 14%, transparent);
}

.thread-row:hover .thread-status-indicator[data-state='unread'],
.thread-row:hover .thread-status-indicator[data-state='working'],
.thread-row:focus-within .thread-status-indicator[data-state='unread'],
.thread-row:focus-within .thread-status-indicator[data-state='working'] {
  @apply opacity-0;
}

.rename-thread-overlay {
  @apply fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4;
}

.rename-thread-panel {
  @apply w-full max-w-sm border p-4;
  border-radius: 14px;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.rename-thread-title {
  @apply m-0 text-base font-semibold;
  color: var(--ui-text-primary);
}

.rename-thread-subtitle {
  @apply mt-1 mb-3 text-sm;
  color: var(--ui-text-secondary);
}

.rename-thread-input {
  @apply w-full border px-3 py-2 text-sm outline-none;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

.rename-thread-input:focus {
  border-color: var(--ui-focus);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-focus) 14%, transparent);
}

.rename-thread-actions {
  @apply mt-3 flex items-center justify-end gap-2;
}

.rename-thread-button {
  @apply px-3 py-1.5 text-sm transition-colors duration-100;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.rename-thread-button:hover,
.rename-thread-button:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.rename-thread-button-primary {
  background: var(--ui-text-primary);
  color: var(--ui-bg-surface);
}

.rename-thread-button-primary:hover,
.rename-thread-button-primary:focus-visible {
  background: color-mix(in srgb, var(--ui-text-primary) 88%, #000);
  color: var(--ui-bg-surface);
}

.rename-thread-button-danger {
  background: var(--ui-danger);
  color: #fff;
}

.rename-thread-button-danger:hover,
.rename-thread-button-danger:focus-visible {
  background: color-mix(in srgb, var(--ui-danger) 88%, #000);
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .thread-status-indicator[data-state='working'] {
    animation: none !important;
  }

  .organize-menu-trigger,
  .thread-start-button,
  .thread-pin-button,
  .thread-show-more-button {
    transition: none !important;
  }

  .thread-loading-skeleton::after {
    animation: none !important;
  }
}

@media (max-width: 767px) {
  .thread-tree-root {
    @apply gap-1.5;
  }

  .project-group {
    border-radius: var(--ui-radius-card);
  }

  .project-group > .thread-list {
    @apply mt-0.5 px-0.5 pb-0.5;
  }

  .thread-list {
    @apply gap-0.5;
  }

  .thread-row {
    min-height: 44px;
  }

  .thread-row-content {
    min-height: 2rem;
  }

  .thread-row-title {
    @apply text-[13px];
    line-height: 1.05rem;
  }

  .thread-row-preview {
    @apply text-[11px];
    line-height: 0.9rem;
  }

  .thread-row-source {
    @apply hidden;
  }

  .project-title {
    @apply text-[13px];
  }

  .project-summary {
    @apply text-[10px];
  }

  .thread-row-time {
    background: transparent;
    padding-inline: 0;
  }
}

@media (min-width: 1024px) {
  .thread-tree-root {
    @apply gap-2;
  }

  .thread-section-heading {
    @apply px-2;
  }

  .project-group > .thread-list {
    @apply px-1.5 pb-1.5;
  }

  .thread-row {
    min-height: 44px;
  }
}

@keyframes thread-skeleton-sheen {
  100% {
    transform: translateX(100%);
  }
}
</style>
