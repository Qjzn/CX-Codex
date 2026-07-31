<template>
  <Teleport to="body">
    <Transition name="command-menu">
      <div
        v-if="open"
        class="command-menu-backdrop"
        role="presentation"
        @pointerdown.self="$emit('close')"
      >
        <section
          ref="panelRef"
          class="command-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-menu-title"
          aria-describedby="command-menu-description"
          @keydown="onPanelKeydown"
        >
          <h2 id="command-menu-title" class="sr-only">命令菜单</h2>
          <p id="command-menu-description" class="sr-only">搜索任务或运行命令</p>

          <div class="command-menu-search">
            <IconTablerSearch class="command-menu-search-icon" aria-hidden="true" />
            <input
              ref="inputRef"
              v-model="query"
              class="command-menu-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="搜索任务或运行命令"
              aria-label="搜索任务或运行命令"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="command-menu-results"
              :aria-expanded="results.length > 0"
              :aria-activedescendant="activeResultId"
            />
            <kbd class="command-menu-escape-hint" aria-hidden="true">Esc</kbd>
          </div>

          <div
            id="command-menu-results"
            ref="resultsRef"
            class="command-menu-results"
            role="listbox"
            aria-label="命令和任务"
          >
            <template v-if="results.length > 0">
              <section
                v-for="section in sections"
                :key="section.id"
                class="command-menu-section"
                :aria-labelledby="`command-menu-section-${section.id}`"
              >
                <div class="command-menu-section-heading">
                  <h3 :id="`command-menu-section-${section.id}`">{{ section.label }}</h3>
                  <span v-if="section.id === 'threads' && query.trim()" aria-live="polite">
                    {{ section.items.length }} 项
                  </span>
                </div>
                <button
                  v-for="item in section.items"
                  :id="resultId(item.flatIndex)"
                  :key="item.key"
                  class="command-menu-result"
                  :class="{ 'is-active': item.flatIndex === activeIndex }"
                  type="button"
                  role="option"
                  :aria-selected="item.flatIndex === activeIndex"
                  tabindex="-1"
                  @click="activate(item)"
                  @pointermove="activeIndex = item.flatIndex"
                >
                  <span class="command-menu-result-icon" :class="`command-menu-result-icon--${item.kind}`">
                    <component :is="item.icon" aria-hidden="true" />
                  </span>
                  <span class="command-menu-result-copy">
                    <span class="command-menu-result-title">{{ item.title }}</span>
                    <span class="command-menu-result-detail">{{ item.detail }}</span>
                  </span>
                  <span v-if="item.thread?.inProgress" class="command-menu-result-state">
                    <span class="command-menu-result-state-dot" aria-hidden="true" />
                    运行中
                  </span>
                  <span v-else-if="item.thread?.unread" class="command-menu-result-state">
                    <span class="command-menu-result-unread-dot" aria-hidden="true" />
                    未读
                  </span>
                  <kbd v-else-if="item.flatIndex === activeIndex" class="command-menu-enter-hint" aria-hidden="true">↵</kbd>
                </button>
              </section>
            </template>

            <div v-else class="command-menu-empty" role="status">
              <IconTablerSearch class="command-menu-empty-icon" aria-hidden="true" />
              <p>没有匹配的任务或命令</p>
              <span>换个关键词试试</span>
            </div>
          </div>

          <footer class="command-menu-footer" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>↵</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerGitFork from '../icons/IconTablerGitFork.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'

type CommandRoute = 'workbench' | 'skills' | 'github-trending' | 'diagnostics'
type CommandDefinition = {
  key: string
  title: string
  detail: string
  searchText: string
  icon: Component
  action?: 'new-thread'
  routeName?: CommandRoute
}
type MenuItem = {
  key: string
  kind: 'command' | 'thread'
  title: string
  detail: string
  searchText: string
  icon: Component
  flatIndex: number
  action?: 'new-thread'
  routeName?: CommandRoute
  thread?: UiThread
}

const props = defineProps<{
  open: boolean
  groups: UiProjectGroup[]
  selectedThreadId?: string
  showGithub?: boolean
}>()

const emit = defineEmits<{
  close: []
  selectThread: [threadId: string]
  startNewThread: []
  openRoute: [routeName: CommandRoute]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)
const query = ref('')
const activeIndex = ref(0)
let previousFocus: HTMLElement | null = null

const commandDefinitions = computed<CommandDefinition[]>(() => {
  const items: CommandDefinition[] = [
    {
      key: 'command:new-thread',
      title: '新建任务',
      detail: '在当前项目中开始新任务',
      searchText: '新建任务 新建会话 create new task thread',
      icon: IconTablerFilePencil,
      action: 'new-thread',
    },
    {
      key: 'command:workbench',
      title: '打开工作台',
      detail: '浏览项目和本地文件',
      searchText: '打开工作台 项目 文件 workbench project files',
      icon: IconTablerFolder,
      routeName: 'workbench',
    },
    {
      key: 'command:skills',
      title: '打开技能',
      detail: '查看已安装和可用技能',
      searchText: '打开技能 skills',
      icon: IconTablerBolt,
      routeName: 'skills',
    },
  ]
  if (props.showGithub) {
    items.push({
      key: 'command:github-trending',
      title: '打开 GitHub',
      detail: '查看 GitHub 项目',
      searchText: '打开 github 项目 trending',
      icon: IconTablerGitFork,
      routeName: 'github-trending',
    })
  }
  items.push({
    key: 'command:diagnostics',
    title: '打开诊断',
    detail: '检查连接和运行状态',
    searchText: '打开诊断 设置 连接 状态 diagnostics settings',
    icon: IconTablerSettings,
    routeName: 'diagnostics',
  })
  return items
})

const recentThreads = computed(() => {
  const byId = new Map<string, UiThread>()
  for (const group of props.groups) {
    for (const thread of group.threads) {
      if (!byId.has(thread.id)) byId.set(thread.id, thread)
    }
  }
  return [...byId.values()].sort((left, right) => {
    if (left.id === props.selectedThreadId) return -1
    if (right.id === props.selectedThreadId) return 1
    return Date.parse(right.updatedAtIso) - Date.parse(left.updatedAtIso)
  })
})

const sections = computed(() => {
  const normalizedQuery = normalizeSearchText(query.value)
  const commandItems = commandDefinitions.value
    .filter((item) => !normalizedQuery || normalizeSearchText(`${item.title} ${item.detail} ${item.searchText}`).includes(normalizedQuery))
    .slice(0, normalizedQuery ? 5 : 3)
  const threadItems = recentThreads.value
    .filter((thread) => {
      if (!normalizedQuery) return true
      return normalizeSearchText(`${thread.title} ${thread.projectName} ${thread.preview} ${thread.cwd}`).includes(normalizedQuery)
    })
    .slice(0, normalizedQuery ? 20 : 8)

  let flatIndex = 0
  const menuSections: Array<{ id: string; label: string; items: MenuItem[] }> = []
  if (commandItems.length > 0) {
    menuSections.push({
      id: 'commands',
      label: normalizedQuery ? '命令' : '推荐',
      items: commandItems.map((item) => ({
        ...item,
        kind: 'command',
        flatIndex: flatIndex++,
      })),
    })
  }
  if (threadItems.length > 0) {
    menuSections.push({
      id: 'threads',
      label: normalizedQuery ? '任务' : '最近任务',
      items: threadItems.map((thread) => ({
        key: `thread:${thread.id}`,
        kind: 'thread',
        title: thread.title || '未命名任务',
        detail: [thread.projectName, compactPreview(thread.preview)].filter(Boolean).join(' · '),
        searchText: '',
        icon: IconTablerSearch,
        flatIndex: flatIndex++,
        thread,
      })),
    })
  }
  return menuSections
})

const results = computed(() => sections.value.flatMap((section) => section.items))
const activeResultId = computed(() => results.value.length > 0 ? resultId(activeIndex.value) : undefined)

watch(() => props.open, (open) => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    query.value = ''
    activeIndex.value = 0
    void nextTick(() => inputRef.value?.focus())
    return
  }
  restoreFocus()
}, { immediate: true })

watch(results, (items) => {
  if (items.length === 0) {
    activeIndex.value = 0
    return
  }
  activeIndex.value = Math.min(activeIndex.value, items.length - 1)
})

onBeforeUnmount(restoreFocus)

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')
}

function compactPreview(value: string): string {
  const compact = value.trim().replace(/\s+/gu, ' ')
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact
}

function resultId(index: number): string {
  return `command-menu-result-${index}`
}

function restoreFocus(): void {
  const target = previousFocus
  previousFocus = null
  if (!target?.isConnected) return
  void nextTick(() => target.focus())
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
    return
  }
  if (event.key === 'Enter' && !event.isComposing) {
    const item = results.value[activeIndex.value]
    if (!item) return
    event.preventDefault()
    activate(item)
  }
}

function moveActive(offset: number): void {
  const itemCount = results.value.length
  if (itemCount === 0) return
  activeIndex.value = (activeIndex.value + offset + itemCount) % itemCount
  void nextTick(() => {
    panelRef.value
      ?.querySelector<HTMLElement>(`#${resultId(activeIndex.value)}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function activate(item: MenuItem): void {
  emit('close')
  if (item.thread) {
    emit('selectThread', item.thread.id)
    return
  }
  if (item.action === 'new-thread') {
    emit('startNewThread')
    return
  }
  if (item.routeName) emit('openRoute', item.routeName)
}
</script>

<style>
@reference "tailwindcss";

.command-menu-backdrop {
  @apply fixed inset-0 flex justify-center px-4;
  z-index: var(--ui-z-modal, 80);
  align-items: flex-start;
  background: rgb(15 15 15 / 0.34);
}

.command-menu-panel {
  @apply flex w-full flex-col overflow-hidden border;
  width: min(640px, 100%);
  max-height: min(680px, calc(100dvh - 96px));
  margin-top: clamp(48px, 10vh, 112px);
  border-radius: 12px;
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  box-shadow: 0 4px 8px rgb(0 0 0 / 0.14);
}

.command-menu-search {
  @apply flex min-h-14 items-center gap-3 border-b px-4;
  border-color: var(--ui-border-subtle);
}

.command-menu-search-icon {
  @apply h-5 w-5 shrink-0;
  color: var(--ui-text-tertiary);
}

.command-menu-input {
  @apply min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] outline-none;
  color: var(--ui-text-primary);
}

.command-menu-input::placeholder {
  color: var(--ui-text-secondary);
  opacity: 1;
}

.command-menu-escape-hint,
.command-menu-enter-hint,
.command-menu-footer kbd {
  @apply inline-flex min-w-5 items-center justify-center border px-1.5 font-mono text-[10px] leading-5;
  border-radius: 5px;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.command-menu-results {
  @apply min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2;
}

.command-menu-section + .command-menu-section {
  @apply mt-2 border-t pt-2;
  border-color: var(--ui-border-subtle);
}

.command-menu-section-heading {
  @apply flex h-7 items-center justify-between px-2 text-[11px] font-medium;
  color: var(--ui-text-tertiary);
}

.command-menu-result {
  @apply flex min-h-12 w-full items-center gap-3 border border-transparent px-2.5 py-1.5 text-left;
  border-radius: var(--ui-radius-card);
  color: var(--ui-text-primary);
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    border-color var(--motion-duration-fast) var(--motion-ease-standard);
}

.command-menu-result.is-active,
.command-menu-result:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-row-hover);
}

.command-menu-result:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: -2px;
}

.command-menu-result-icon {
  @apply flex h-8 w-8 shrink-0 items-center justify-center;
  border-radius: 7px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.command-menu-result-icon svg {
  @apply h-4 w-4;
}

.command-menu-result-icon--command {
  color: var(--ui-accent);
}

.command-menu-result-copy {
  @apply flex min-w-0 flex-1 flex-col;
}

.command-menu-result-title {
  @apply truncate text-[13px] font-medium leading-5;
}

.command-menu-result-detail {
  @apply truncate text-xs leading-4;
  color: var(--ui-text-secondary);
}

.command-menu-result-state {
  @apply ml-auto flex shrink-0 items-center gap-1.5 text-[11px];
  color: var(--ui-text-secondary);
}

.command-menu-result-state-dot,
.command-menu-result-unread-dot {
  @apply h-1.5 w-1.5 rounded-full;
  background: var(--ui-success);
}

.command-menu-result-unread-dot {
  background: var(--ui-focus);
}

.command-menu-empty {
  @apply flex min-h-48 flex-col items-center justify-center px-6 text-center;
}

.command-menu-empty-icon {
  @apply mb-3 h-6 w-6;
  color: var(--ui-text-tertiary);
}

.command-menu-empty p {
  @apply text-sm font-medium;
}

.command-menu-empty span {
  @apply mt-1 text-xs;
  color: var(--ui-text-secondary);
}

.command-menu-footer {
  @apply flex min-h-9 items-center justify-end gap-4 border-t px-4 text-[11px];
  border-color: var(--ui-border-subtle);
  color: var(--ui-text-secondary);
}

.command-menu-footer span {
  @apply flex items-center gap-1;
}

.command-menu-enter-hint {
  @apply ml-auto;
}

.command-menu-enter-hint,
.command-menu-footer kbd {
  min-width: 18px;
  padding-inline: 4px;
  line-height: 17px;
}

.command-menu-enter-hint {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-surface);
}

:root.dark .command-menu-backdrop {
  background: rgb(0 0 0 / 0.58);
}

:root.dark .command-menu-panel {
  border-color: #3f3f46;
  background: #18181b;
  color: #f4f4f5;
}

:root.dark .command-menu-search,
:root.dark .command-menu-section + .command-menu-section,
:root.dark .command-menu-footer {
  border-color: #3f3f46;
}

:root.dark .command-menu-input {
  color: #f4f4f5;
}

:root.dark .command-menu-input::placeholder,
:root.dark .command-menu-result-detail,
:root.dark .command-menu-result-state,
:root.dark .command-menu-footer {
  color: #a1a1aa;
}

:root.dark .command-menu-search-icon,
:root.dark .command-menu-section-heading,
:root.dark .command-menu-empty-icon {
  color: #71717a;
}

:root.dark .command-menu-result.is-active,
:root.dark .command-menu-result:hover {
  border-color: #3f3f46;
  background: #27272a;
}

:root.dark .command-menu-result-icon,
:root.dark .command-menu-escape-hint,
:root.dark .command-menu-footer kbd {
  border-color: #3f3f46;
  background: #27272a;
  color: #d4d4d8;
}

:root.dark .command-menu-result-icon--command {
  color: #5eead4;
}

:root.dark .command-menu-enter-hint {
  border-color: #52525b;
  background: #18181b;
  color: #d4d4d8;
}

.command-menu-enter-active,
.command-menu-leave-active {
  transition: opacity var(--motion-duration-base) var(--motion-ease-standard);
}

.command-menu-enter-active .command-menu-panel,
.command-menu-leave-active .command-menu-panel {
  transition:
    opacity var(--motion-duration-base) var(--motion-ease-standard),
    transform var(--motion-duration-base) var(--motion-ease-out);
}

.command-menu-enter-from,
.command-menu-leave-to,
.command-menu-enter-from .command-menu-panel,
.command-menu-leave-to .command-menu-panel {
  opacity: 0;
}

.command-menu-enter-from .command-menu-panel,
.command-menu-leave-to .command-menu-panel {
  transform: translateY(-8px) scale(0.99);
}

@media (max-width: 640px) {
  .command-menu-backdrop {
    @apply px-3;
  }

  .command-menu-panel {
    max-height: calc(100dvh - 24px);
    margin-top: 12px;
  }

  .command-menu-result {
    min-height: 52px;
  }

  .command-menu-footer {
    display: none;
  }

  .command-menu-escape-hint {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .command-menu-enter-active,
  .command-menu-leave-active,
  .command-menu-enter-active .command-menu-panel,
  .command-menu-leave-active .command-menu-panel {
    transition-duration: 1ms;
  }

  .command-menu-enter-from .command-menu-panel,
  .command-menu-leave-to .command-menu-panel {
    transform: none;
  }
}
</style>
