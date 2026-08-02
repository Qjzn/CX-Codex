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
          tabindex="-1"
          @keydown="onPanelKeydown"
        >
          <h2 id="command-menu-title" class="sr-only">命令菜单</h2>
          <p id="command-menu-description" class="sr-only">{{ dialogDescription }}</p>

          <div class="command-menu-search">
            <IconTablerSearch class="command-menu-search-icon" aria-hidden="true" />
            <input
              ref="inputRef"
              v-model="query"
              class="command-menu-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :placeholder="searchPlaceholder"
              :aria-label="searchPlaceholder"
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
            :aria-label="resultsLabel"
            :aria-busy="mode === 'files' && fileSearchState === 'loading'"
          >
            <template v-if="results.length > 0">
              <section
                v-for="section in sections"
                :key="section.id"
                class="command-menu-section"
                :aria-labelledby="section.label ? `command-menu-section-${section.id}` : undefined"
              >
                <div v-if="section.label" class="command-menu-section-heading">
                  <h3 :id="`command-menu-section-${section.id}`">{{ section.label }}</h3>
                  <span v-if="(section.id === 'threads' || section.id === 'files') && query.trim()" aria-live="polite">
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
                  <span v-if="item.thread?.waitingForInput" class="command-menu-result-state">
                    <span class="command-menu-result-waiting-dot" aria-hidden="true" />
                    等待处理
                  </span>
                  <span v-else-if="item.thread?.inProgress" class="command-menu-result-state">
                    <span class="command-menu-result-state-dot" aria-hidden="true" />
                    运行中
                  </span>
                  <span v-else-if="item.thread?.unread" class="command-menu-result-state">
                    <span class="command-menu-result-unread-dot" aria-hidden="true" />
                    未读
                  </span>
                  <kbd v-else-if="item.shortcut" class="command-menu-item-shortcut" aria-hidden="true">{{ item.shortcut }}</kbd>
                  <kbd v-else-if="item.flatIndex === activeIndex" class="command-menu-enter-hint" aria-hidden="true">↵</kbd>
                </button>
              </section>
            </template>

            <div v-if="mode === 'files' && fileSearchStatus" class="command-menu-empty command-menu-empty--files" role="status">
              <span v-if="fileSearchState === 'loading'" class="command-menu-loading-indicator" aria-hidden="true" />
              <IconTablerSearch v-else class="command-menu-empty-icon" aria-hidden="true" />
              <p>{{ fileSearchStatus.title }}</p>
              <span>{{ fileSearchStatus.detail }}</span>
            </div>

            <div v-else-if="results.length === 0" class="command-menu-empty" role="status">
              <IconTablerSearch class="command-menu-empty-icon" aria-hidden="true" />
              <p>没有匹配的任务或命令</p>
              <span>换个关键词试试</span>
            </div>
          </div>

          <footer class="command-menu-footer" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>↵</kbd> 打开</span>
            <span><kbd>Esc</kbd> {{ mode === 'files' ? '返回' : '关闭' }}</span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { searchComposerFiles, type ComposerFileSuggestion } from '../../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'
import IconTablerGitFork from '../icons/IconTablerGitFork.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'

type CommandRoute = 'workbench' | 'skills' | 'github-trending' | 'diagnostics'
type CommandMenuMode = 'root' | 'files'
type RecentFileEntry = {
  cwd: string
  path: string
  openedAtMs: number
}
type CommandDefinition = {
  key: string
  title: string
  detail: string
  searchText: string
  icon: Component
  action?: 'new-thread' | 'search-files'
  routeName?: CommandRoute
  shortcut?: string
}
type MenuItem = {
  key: string
  kind: 'command' | 'thread' | 'file' | 'navigation'
  title: string
  detail: string
  searchText: string
  icon: Component
  flatIndex: number
  action?: 'new-thread' | 'search-files' | 'back'
  routeName?: CommandRoute
  thread?: UiThread
  file?: ComposerFileSuggestion
  shortcut?: string
}

const props = defineProps<{
  open: boolean
  groups: UiProjectGroup[]
  selectedThreadId?: string
  showGithub?: boolean
  cwd?: string
  initialMode?: CommandMenuMode
  modeRequestId?: number
}>()

const emit = defineEmits<{
  close: []
  selectThread: [threadId: string]
  startNewThread: []
  openRoute: [routeName: CommandRoute]
  openFile: [path: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)
const query = ref('')
const mode = ref<CommandMenuMode>('root')
const activeIndex = ref(0)
const fileSuggestions = ref<ComposerFileSuggestion[]>([])
const settledFileQuery = ref('')
const fileSearchState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const RECENT_FILE_STORAGE_KEY = 'codex-web-local.command-menu-recent-files.v1'
const MAX_RECENT_FILES = 36
const MAX_RECENT_FILES_PER_WORKSPACE = 6
const recentFiles = ref<RecentFileEntry[]>(loadRecentFiles())
let previousFocus: HTMLElement | null = null
let previousBodyOverflow = ''
let ownsBodyScrollLock = false
let fileSearchTimer: ReturnType<typeof setTimeout> | null = null
let fileSearchToken = 0

const COMMAND_MENU_FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const normalizedCwd = computed(() => props.cwd?.trim() ?? '')
const recentWorkspaceFiles = computed<ComposerFileSuggestion[]>(() => {
  const cwdKey = normalizeFileLocation(normalizedCwd.value)
  if (!cwdKey) return []
  return recentFiles.value
    .filter((entry) => normalizeFileLocation(entry.cwd) === cwdKey)
    .sort((left, right) => right.openedAtMs - left.openedAtMs)
    .slice(0, MAX_RECENT_FILES_PER_WORKSPACE)
    .map((entry) => ({ path: entry.path }))
})
const visibleFileSuggestions = computed(() => {
  const normalizedQuery = normalizeSearchText(query.value)
  if (!normalizedQuery) return []
  if (normalizedQuery === normalizeSearchText(settledFileQuery.value)) {
    return fileSuggestions.value
  }
  return fileSuggestions.value.filter((file) => (
    normalizeSearchText(file.path).includes(normalizedQuery)
  ))
})
const searchPlaceholder = computed(() => mode.value === 'files' ? '搜索文件' : '搜索任务或运行命令')
const dialogDescription = computed(() => mode.value === 'files' ? '在当前工作区中搜索并打开文件' : '搜索任务或运行命令')
const resultsLabel = computed(() => mode.value === 'files' ? '工作区文件' : '命令和任务')
const fileSearchShortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/iu.test(navigator.platform)
  ? '⌘P'
  : 'Ctrl P'

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
  if (normalizedCwd.value) {
    items.splice(1, 0, {
      key: 'command:search-files',
      title: '搜索文件',
      detail: '在当前工作区快速打开文件',
      searchText: '搜索文件 快速打开 quick open files workspace',
      icon: IconTablerFolderOpen,
      action: 'search-files',
      shortcut: fileSearchShortcut,
    })
  }
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

function compareAttentionThreads(left: UiThread, right: UiThread): number {
  const stateOrder = attentionThreadRank(left) - attentionThreadRank(right)
  if (stateOrder !== 0) return stateOrder
  if (left.id === props.selectedThreadId) return -1
  if (right.id === props.selectedThreadId) return 1
  return Date.parse(right.updatedAtIso) - Date.parse(left.updatedAtIso)
}

function attentionThreadRank(thread: UiThread): number {
  if (thread.waitingForInput) return 0
  if (thread.inProgress) return 1
  return 2
}

const fileSections = computed(() => {
  let flatIndex = 0
  const menuSections: Array<{ id: string; label: string; items: MenuItem[] }> = [
    {
      id: 'navigation',
      label: '',
      items: [{
        key: 'navigation:back',
        kind: 'navigation',
        title: '返回命令',
        detail: normalizedCwd.value,
        searchText: '',
        icon: IconTablerChevronLeft,
        action: 'back',
        flatIndex: flatIndex++,
      }],
    },
  ]
  const normalizedQuery = query.value.trim()
  const visibleFiles = normalizedQuery ? visibleFileSuggestions.value : recentWorkspaceFiles.value
  if (visibleFiles.length > 0) {
    menuSections.push({
      id: normalizedQuery ? 'files' : 'recent-files',
      label: normalizedQuery ? '文件' : '最近文件',
      items: visibleFiles.map((file) => ({
        key: `file:${file.path}`,
        kind: 'file',
        title: fileName(file.path),
        detail: file.path,
        searchText: file.path,
        icon: IconTablerFilePencil,
        file,
        flatIndex: flatIndex++,
      })),
    })
  }
  return menuSections
})

const sections = computed(() => {
  if (mode.value === 'files') return fileSections.value

  const normalizedQuery = normalizeSearchText(query.value)
  const commandItems = commandDefinitions.value
    .filter((item) => !normalizedQuery || normalizeSearchText(`${item.title} ${item.detail} ${item.searchText}`).includes(normalizedQuery))
    .slice(0, normalizedQuery ? 5 : 3)
  const matchingThreads = recentThreads.value.filter((thread) => {
    if (!normalizedQuery) return true
    return normalizeSearchText(`${thread.title} ${thread.projectName} ${thread.preview} ${thread.cwd}`).includes(normalizedQuery)
  })

  let flatIndex = 0
  const menuSections: Array<{ id: string; label: string; items: MenuItem[] }> = []
  const appendThreadSection = (id: string, label: string, threads: UiThread[]): void => {
    if (threads.length === 0) return
    menuSections.push({
      id,
      label,
      items: threads.map((thread) => ({
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
  if (normalizedQuery) {
    appendThreadSection('threads', '任务', matchingThreads.slice(0, 20))
  } else {
    const attentionThreads = matchingThreads
      .filter((thread) => thread.inProgress || thread.unread)
      .sort(compareAttentionThreads)
      .slice(0, 6)
    const recentLimit = Math.min(8, Math.max(4, 10 - attentionThreads.length))
    const normalRecentThreads = matchingThreads
      .filter((thread) => !thread.inProgress && !thread.unread)
      .slice(0, recentLimit)
    appendThreadSection('attention', '需要关注', attentionThreads)
    appendThreadSection('threads', '最近任务', normalRecentThreads)
  }
  return menuSections
})

const results = computed(() => sections.value.flatMap((section) => section.items))
const activeResultId = computed(() => results.value.length > 0 ? resultId(activeIndex.value) : undefined)
const fileSearchStatus = computed(() => {
  if (mode.value !== 'files') return null
  if (!normalizedCwd.value) {
    return { title: '当前没有可搜索的工作区', detail: '返回后选择一个项目再试' }
  }
  if (!query.value.trim()) {
    if (recentWorkspaceFiles.value.length > 0) return null
    return { title: '输入文件名开始搜索', detail: '仅搜索当前工作区，不会扫描其他目录' }
  }
  if (fileSearchState.value === 'loading') {
    if (visibleFileSuggestions.value.length > 0) return null
    return { title: '正在查找文件…', detail: normalizedCwd.value }
  }
  if (fileSearchState.value === 'error') {
    return { title: '文件搜索暂时不可用', detail: '请稍后重试或返回工作台浏览文件' }
  }
  if (fileSearchState.value === 'ready' && visibleFileSuggestions.value.length === 0) {
    return { title: '没有匹配的文件', detail: '换个文件名或路径片段试试' }
  }
  return null
})

watch(() => props.open, (open) => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockBackgroundScroll()
    resetMenu(props.initialMode)
    void nextTick(() => focusInitialControl())
    return
  }
  resetFileSearch()
  restoreModalEnvironment()
}, { immediate: true })

watch(() => props.modeRequestId, () => {
  if (!props.open) return
  resetMenu(props.initialMode)
  void nextTick(() => focusInitialControl())
})

watch(normalizedCwd, (cwd) => {
  if (!cwd && mode.value === 'files') enterRootMode()
})

watch([query, mode, normalizedCwd, () => props.open], ([value, currentMode, cwd, open]) => {
  invalidateFileSearch()
  const normalizedQuery = value.trim()
  if (!open || currentMode !== 'files' || !cwd) return
  if (!normalizedQuery) {
    fileSuggestions.value = []
    settledFileQuery.value = ''
    fileSearchState.value = 'idle'
    activeIndex.value = recentWorkspaceFiles.value.length > 0 ? 1 : 0
    return
  }

  const token = fileSearchToken
  fileSearchState.value = 'loading'
  if (activeIndex.value > 0) {
    activeIndex.value = Math.min(activeIndex.value, visibleFileSuggestions.value.length)
  }
  fileSearchTimer = setTimeout(async () => {
    try {
      const rows = await searchComposerFiles(cwd, normalizedQuery, 12)
      if (token !== fileSearchToken || mode.value !== 'files' || !props.open) return
      const activeFilePath = results.value[activeIndex.value]?.file?.path
      fileSuggestions.value = rows
      settledFileQuery.value = normalizedQuery
      fileSearchState.value = 'ready'
      const retainedFileIndex = activeFilePath
        ? rows.findIndex((row) => row.path === activeFilePath)
        : -1
      activeIndex.value = retainedFileIndex >= 0
        ? retainedFileIndex + 1
        : (rows.length > 0 ? 1 : 0)
    } catch {
      if (token !== fileSearchToken || mode.value !== 'files' || !props.open) return
      fileSuggestions.value = []
      settledFileQuery.value = ''
      fileSearchState.value = 'error'
      activeIndex.value = 0
    }
  }, 160)
})

watch(results, (items) => {
  if (items.length === 0) {
    activeIndex.value = 0
    return
  }
  activeIndex.value = Math.min(activeIndex.value, items.length - 1)
})

onMounted(() => {
  window.addEventListener('focusin', onWindowFocusIn, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('focusin', onWindowFocusIn, true)
  resetFileSearch()
  restoreModalEnvironment()
})

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')
}

function compactPreview(value: string): string {
  const compact = value.trim().replace(/\s+/gu, ' ')
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact
}

function fileName(path: string): string {
  const segments = path.replace(/\\/gu, '/').split('/').filter(Boolean)
  return segments.at(-1) || path
}

function normalizeFileLocation(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.replace(/\\/gu, '/').replace(/\/+$/gu, '').toLocaleLowerCase() || '/'
}

function loadRecentFiles(): RecentFileEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_FILE_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is RecentFileEntry => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as Partial<RecentFileEntry>
        return typeof candidate.cwd === 'string'
          && Boolean(candidate.cwd.trim())
          && typeof candidate.path === 'string'
          && Boolean(candidate.path.trim())
          && typeof candidate.openedAtMs === 'number'
          && Number.isFinite(candidate.openedAtMs)
      })
      .sort((left, right) => right.openedAtMs - left.openedAtMs)
      .slice(0, MAX_RECENT_FILES)
  } catch {
    return []
  }
}

function rememberRecentFile(path: string): void {
  const cwd = normalizedCwd.value
  const normalizedPath = path.trim()
  if (!cwd || !normalizedPath) return
  const cwdKey = normalizeFileLocation(cwd)
  const pathKey = normalizeFileLocation(normalizedPath)
  recentFiles.value = [
    { cwd, path: normalizedPath, openedAtMs: Date.now() },
    ...recentFiles.value.filter((entry) => (
      normalizeFileLocation(entry.cwd) !== cwdKey
      || normalizeFileLocation(entry.path) !== pathKey
    )),
  ].slice(0, MAX_RECENT_FILES)
  try {
    window.localStorage.setItem(RECENT_FILE_STORAGE_KEY, JSON.stringify(recentFiles.value))
  } catch {
    // Quick Open must stay usable when browser storage is unavailable or full.
  }
}

function resultId(index: number): string {
  return `command-menu-result-${index}`
}

function restoreFocus(): void {
  const target = previousFocus
  previousFocus = null
  if (!target?.isConnected) return
  target.focus({ preventScroll: true })
}

function lockBackgroundScroll(): void {
  if (ownsBodyScrollLock) return
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  ownsBodyScrollLock = true
}

function restoreModalEnvironment(): void {
  if (ownsBodyScrollLock) {
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = ''
    ownsBodyScrollLock = false
  }
  restoreFocus()
}

function getFocusableElements(): HTMLElement[] {
  return Array.from(panelRef.value?.querySelectorAll<HTMLElement>(COMMAND_MENU_FOCUSABLE_SELECTOR) ?? [])
}

function focusInitialControl(): void {
  const target = inputRef.value ?? getFocusableElements()[0] ?? panelRef.value
  target?.focus({ preventScroll: true })
}

function onWindowFocusIn(event: FocusEvent): void {
  if (!props.open || !panelRef.value) return
  if (event.target instanceof Node && panelRef.value.contains(event.target)) return
  focusInitialControl()
}

function invalidateFileSearch(): void {
  if (fileSearchTimer) {
    clearTimeout(fileSearchTimer)
    fileSearchTimer = null
  }
  fileSearchToken += 1
}

function resetFileSearch(): void {
  invalidateFileSearch()
  fileSuggestions.value = []
  settledFileQuery.value = ''
  fileSearchState.value = 'idle'
}

function resetMenu(requestedMode: CommandMenuMode | undefined): void {
  mode.value = requestedMode === 'files' && normalizedCwd.value ? 'files' : 'root'
  query.value = ''
  activeIndex.value = mode.value === 'files' && recentWorkspaceFiles.value.length > 0 ? 1 : 0
  resetFileSearch()
}

function enterFileMode(): void {
  if (!normalizedCwd.value) return
  mode.value = 'files'
  query.value = ''
  activeIndex.value = recentWorkspaceFiles.value.length > 0 ? 1 : 0
  void nextTick(() => inputRef.value?.focus())
}

function enterRootMode(): void {
  mode.value = 'root'
  query.value = ''
  activeIndex.value = 0
  resetFileSearch()
  void nextTick(() => inputRef.value?.focus())
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (mode.value === 'files') {
      enterRootMode()
      return
    }
    emit('close')
    return
  }
  if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const panel = panelRef.value
    if (!panel) return
    const focusable = getFocusableElements()
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) {
      event.preventDefault()
      panel.focus({ preventScroll: true })
      return
    }
    const activeElement = document.activeElement
    if (!panel.contains(activeElement)) {
      event.preventDefault()
      const wrapTarget = event.shiftKey ? last : first
      wrapTarget.focus({ preventScroll: true })
      return
    }
    if (event.shiftKey && activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
      return
    }
    if (!event.shiftKey && activeElement === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
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
  if (event.key === 'Enter') {
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
  if (item.action === 'search-files') {
    enterFileMode()
    return
  }
  if (item.action === 'back') {
    enterRootMode()
    return
  }
  if (item.file) rememberRecentFile(item.file.path)
  emit('close')
  if (item.file) {
    emit('openFile', item.file.path)
    return
  }
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
.command-menu-item-shortcut,
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

.command-menu-result-icon--file {
  color: var(--ui-text-primary);
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

.command-menu-result-waiting-dot,
.command-menu-result-state-dot,
.command-menu-result-unread-dot {
  @apply h-1.5 w-1.5 rounded-full;
  background: var(--ui-success);
}

.command-menu-result-waiting-dot {
  background: var(--ui-warning);
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

.command-menu-empty--files {
  min-height: 148px;
}

.command-menu-loading-indicator {
  @apply mb-3 h-5 w-5 rounded-full border-2;
  border-color: var(--ui-border-strong);
  border-top-color: var(--ui-accent);
  animation: command-menu-loading 720ms linear infinite;
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
.command-menu-item-shortcut,
.command-menu-footer kbd {
  min-width: 18px;
  padding-inline: 4px;
  line-height: 17px;
}

.command-menu-enter-hint {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-surface);
}

.command-menu-item-shortcut {
  @apply ml-auto shrink-0;
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
:root.dark .command-menu-item-shortcut,
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

@keyframes command-menu-loading {
  to {
    transform: rotate(360deg);
  }
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

  .command-menu-item-shortcut {
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

  .command-menu-loading-indicator {
    animation: none;
  }
}
</style>
