<template>
  <aside
    ref="workspaceElement"
    class="thread-side-workspace"
    :class="{ 'is-resizing': isResizing }"
    :style="workspaceStyle"
    aria-label="当前会话侧边工作区"
  >
    <button
      class="thread-side-workspace-resizer"
      type="button"
      role="separator"
      aria-label="调整主聊天和侧边区域宽度"
      aria-orientation="vertical"
      :aria-valuenow="Math.round(widthPercent)"
      aria-valuemin="24"
      aria-valuemax="52"
      title="拖动调整左右区域宽度"
      @pointerdown="onResizePointerDown"
    >
      <span aria-hidden="true" />
    </button>
    <header class="thread-side-workspace-header">
      <div
        ref="tabsElement"
        class="thread-side-workspace-tabs"
        role="tablist"
        aria-label="侧边工作区标签页"
        @scroll="onTabsScroll"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="thread-side-workspace-tab"
          :class="{ 'is-active': tab.id === activeTabId }"
          :data-tab-id="tab.id"
          type="button"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          :title="tab.kind === 'chat' ? '侧边聊天' : '侧边终端'"
          @click="activateTab(tab.id)"
        >
          <IconTablerMessageCircle v-if="tab.kind === 'chat'" class="thread-side-workspace-tab-icon" />
          <span v-else class="thread-side-workspace-tab-icon thread-side-workspace-tab-icon--terminal" aria-hidden="true">&gt;_</span>
          <span class="thread-side-workspace-tab-label">{{ tab.title }}</span>
          <span
            class="thread-side-workspace-tab-close"
            role="button"
            tabindex="0"
            aria-label="关闭标签页"
            @click.stop="closeTab(tab.id)"
            @keydown.enter.stop.prevent="closeTab(tab.id)"
            @keydown.space.stop.prevent="closeTab(tab.id)"
          >
            ×
          </span>
        </button>
        <button
          ref="addTabElement"
          class="thread-side-workspace-add-tab"
          type="button"
          aria-label="新建侧边标签页"
          title="新建聊天或终端"
          :aria-expanded="isNewTabMenuOpen"
          @click="toggleNewTabMenu"
        >
          +
        </button>
      </div>
      <div class="thread-side-workspace-actions">
        <button
          class="thread-side-workspace-action thread-side-workspace-action--back"
          type="button"
          aria-label="返回主聊天"
          title="返回主聊天"
          @click="emit('close')"
        >
          <span aria-hidden="true">←</span>
          <span class="thread-side-workspace-back-label">主聊天</span>
        </button>
        <button
          class="thread-side-workspace-action thread-side-workspace-action--close"
          type="button"
          aria-label="关闭侧边工作区"
          title="关闭侧边工作区"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div
      v-if="isNewTabMenuOpen"
      ref="newTabMenuElement"
      class="thread-side-workspace-new-tab-menu"
      role="menu"
      :style="newTabMenuStyle"
    >
      <button type="button" role="menuitem" @click="addTab('chat')">
        <IconTablerMessageCircle class="thread-side-workspace-menu-icon" />
        <span>新建聊天</span>
      </button>
      <button type="button" role="menuitem" @click="addTab('terminal')">
        <span class="thread-side-workspace-menu-icon thread-side-workspace-menu-icon--terminal" aria-hidden="true">&gt;_</span>
        <span>新建终端</span>
      </button>
    </div>

    <div class="thread-side-workspace-content">
      <template v-for="tab in tabs" :key="tab.id">
        <ThreadSidePanel
          v-if="tab.id === activeTabId"
          :thread-id="tab.threadId"
          :cwd="tab.cwd"
          :title="tab.title"
          :storage-key="tab.id"
          :mode="tab.kind"
          :model="model"
          :models="models"
          :available-models="availableModels"
          :selected-reasoning-effort="selectedReasoningEffort"
          :skills="skills"
          :has-loaded-skills="hasLoadedSkills"
          :plugins="plugins"
          :is-loading-plugins="isLoadingPlugins"
          :has-loaded-plugins="hasLoadedPlugins"
          :send-with-enter="sendWithEnter"
          :dictation-click-to-toggle="dictationClickToToggle"
          :dictation-auto-send="dictationAutoSend"
          :show-dictation-button="showDictationButton"
          :dictation-language="dictationLanguage"
          :show-chat="tab.kind === 'chat'"
          :show-header="false"
          :show-mode-tabs="false"
          @refresh-plugins="emit('refresh-plugins')"
          @reload-plugins="emit('reload-plugins')"
          @login-plugin="emit('login-plugin', $event)"
          @close="closeTab(tab.id)"
        />
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import IconTablerMessageCircle from '../icons/IconTablerMessageCircle.vue'
import ThreadSidePanel from './ThreadSidePanel.vue'
import type {
  CollaborationMode,
  ComposerModelInfo,
  ComposerPluginInfo,
  ReasoningEffort,
  SpeedMode,
} from '../../types/codex'

type SideWorkspaceTabKind = 'chat' | 'terminal'
type SideWorkspaceSkill = { name: string; description: string; path: string }
type SideWorkspaceTab = {
  id: string
  kind: SideWorkspaceTabKind
  title: string
  threadId: string
  cwd: string
}

const props = withDefaults(defineProps<{
  threadId: string
  cwd: string
  title: string
  initialMode: SideWorkspaceTabKind
  widthPercent?: number
  model?: string
  models?: string[]
  availableModels?: ComposerModelInfo[]
  selectedReasoningEffort?: ReasoningEffort | ''
  skills?: SideWorkspaceSkill[]
  hasLoadedSkills?: boolean
  plugins?: ComposerPluginInfo[]
  isLoadingPlugins?: boolean
  hasLoadedPlugins?: boolean
  sendWithEnter?: boolean
  dictationClickToToggle?: boolean
  dictationAutoSend?: boolean
  showDictationButton?: boolean
  dictationLanguage?: string
}>(), {
  model: '',
  widthPercent: 38,
  models: () => [],
  availableModels: () => [],
  selectedReasoningEffort: '',
  skills: () => [],
  hasLoadedSkills: false,
  plugins: () => [],
  isLoadingPlugins: false,
  hasLoadedPlugins: false,
  sendWithEnter: true,
  dictationClickToToggle: false,
  dictationAutoSend: false,
  showDictationButton: true,
  dictationLanguage: 'auto',
})

const emit = defineEmits<{
  close: []
  'update:active-kind': [kind: SideWorkspaceTabKind]
  resize: [widthPercent: number]
  'refresh-plugins': []
  'reload-plugins': []
  'login-plugin': [pluginId: string]
}>()

const tabs = ref<SideWorkspaceTab[]>([])
const activeTabId = ref('')
const isNewTabMenuOpen = ref(false)
const tabsElement = ref<HTMLElement | null>(null)
const addTabElement = ref<HTMLButtonElement | null>(null)
const newTabMenuElement = ref<HTMLElement | null>(null)
const newTabMenuStyle = ref<Record<string, string>>({})
const workspaceElement = ref<HTMLElement | null>(null)
const isResizing = ref(false)
let resizePointerId: number | null = null
let tabSequence = 0
let currentScopeKey = ''

const widthPercent = computed(() => Math.min(52, Math.max(24, Number(props.widthPercent) || 38)))
const workspaceStyle = computed(() => ({
  '--thread-side-workspace-width': `${String(widthPercent.value)}%`,
}))

function createTab(kind: SideWorkspaceTabKind): SideWorkspaceTab {
  tabSequence += 1
  const sameKindCount = tabs.value.filter((tab) => tab.kind === kind).length + 1
  return {
    id: `side-workspace-tab-${Date.now()}-${tabSequence}`,
    kind,
    title: kind === 'chat' ? `侧边聊天${sameKindCount > 1 ? ` ${sameKindCount}` : ''}` : `终端${sameKindCount > 1 ? ` ${sameKindCount}` : ''}`,
    threadId: props.threadId.trim(),
    cwd: props.cwd.trim(),
  }
}

function activeTab(): SideWorkspaceTab | undefined {
  return tabs.value.find((tab) => tab.id === activeTabId.value)
}

function activateTab(id: string): void {
  const tab = tabs.value.find((candidate) => candidate.id === id)
  if (!tab) return
  activeTabId.value = tab.id
  isNewTabMenuOpen.value = false
  emit('update:active-kind', tab.kind)
  void nextTick(() => {
    tabsElement.value?.querySelector<HTMLElement>(`.thread-side-workspace-tab[data-tab-id="${CSS.escape(tab.id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  })
}

function updateNewTabMenuPosition(): void {
  if (!isNewTabMenuOpen.value) return
  const workspace = workspaceElement.value
  const addTab = addTabElement.value
  if (!workspace || !addTab) return
  const workspaceRect = workspace.getBoundingClientRect()
  const addTabRect = addTab.getBoundingClientRect()
  const menuWidth = newTabMenuElement.value?.getBoundingClientRect().width || 136
  const edgePadding = 8
  const maxLeft = Math.max(edgePadding, workspaceRect.width - menuWidth - edgePadding)
  const left = Math.min(maxLeft, Math.max(edgePadding, addTabRect.left - workspaceRect.left))
  const top = Math.max(edgePadding, addTabRect.bottom - workspaceRect.top + 4)
  newTabMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    right: 'auto',
  }
}

function onTabsScroll(): void {
  updateNewTabMenuPosition()
}

function toggleNewTabMenu(): void {
  isNewTabMenuOpen.value = !isNewTabMenuOpen.value
  if (isNewTabMenuOpen.value) void nextTick(updateNewTabMenuPosition)
}

function onResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || window.matchMedia('(max-width: 1023px)').matches) return
  event.preventDefault()
  resizePointerId = event.pointerId
  isResizing.value = true
  window.addEventListener('pointermove', onResizePointerMove)
  window.addEventListener('pointerup', onResizePointerUp)
  window.addEventListener('pointercancel', onResizePointerUp)
}

function onResizePointerMove(event: PointerEvent): void {
  if (!isResizing.value || resizePointerId !== event.pointerId) return
  const workspace = workspaceElement.value?.parentElement
  if (!workspace) return
  const bounds = workspace.getBoundingClientRect()
  if (bounds.width <= 0) return
  const sideWidth = bounds.right - event.clientX
  const nextPercent = Math.min(52, Math.max(24, (sideWidth / bounds.width) * 100))
  emit('resize', Math.round(nextPercent * 10) / 10)
}

function onResizePointerUp(event: PointerEvent): void {
  if (resizePointerId !== null && event.pointerId !== resizePointerId) return
  resizePointerId = null
  isResizing.value = false
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointercancel', onResizePointerUp)
}

function addTab(kind: SideWorkspaceTabKind): void {
  const tab = createTab(kind)
  tabs.value = [...tabs.value, tab]
  activeTabId.value = tab.id
  isNewTabMenuOpen.value = false
  emit('update:active-kind', kind)
  void nextTick(() => {
    tabsElement.value?.querySelector<HTMLElement>(`.thread-side-workspace-tab[data-tab-id="${CSS.escape(tab.id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  })
}

function closeTab(id: string): void {
  const index = tabs.value.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const wasActive = activeTabId.value === id
  const nextTabs = tabs.value.filter((tab) => tab.id !== id)
  tabs.value = nextTabs
  if (nextTabs.length === 0) {
    activeTabId.value = ''
    emit('close')
    return
  }
  if (wasActive) {
    const nextTab = nextTabs[Math.min(index, nextTabs.length - 1)]
    if (nextTab) activateTab(nextTab.id)
  }
}

function resetTabs(kind: SideWorkspaceTabKind): void {
  const tab = createTab(kind)
  tabs.value = [tab]
  activeTabId.value = tab.id
  emit('update:active-kind', kind)
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!isNewTabMenuOpen.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if ((event.currentTarget as Window).document.documentElement.contains(target)) {
    const menu = (event.currentTarget as Window).document.querySelector('.thread-side-workspace-new-tab-menu')
    const action = (event.currentTarget as Window).document.querySelector('.thread-side-workspace-add-tab')
    if (!menu?.contains(target) && !action?.contains(target)) isNewTabMenuOpen.value = false
  }
}

watch(
  () => [props.threadId, props.cwd] as const,
  ([threadId, cwd]) => {
    const nextScopeKey = `${threadId.trim()}\n${cwd.trim()}`
    if (!nextScopeKey.trim() || nextScopeKey === currentScopeKey) return
    currentScopeKey = nextScopeKey
    resetTabs(props.initialMode)
  },
  { immediate: true },
)

watch(
  () => props.initialMode,
  (kind) => {
    if (tabs.value.length === 0) {
      resetTabs(kind)
      return
    }
    const matchingTab = tabs.value.find((tab) => tab.kind === kind)
    if (matchingTab) activateTab(matchingTab.id)
    else addTab(kind)
  },
)

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown)
  window.addEventListener('resize', updateNewTabMenuPosition)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown)
  window.removeEventListener('resize', updateNewTabMenuPosition)
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointercancel', onResizePointerUp)
})
</script>

<style scoped>
.thread-side-workspace {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  /* Keep the pane width in the same percentage range exposed by the divider. */
  width: clamp(24%, var(--thread-side-workspace-width, 38%), 52%);
  flex: 0 0 clamp(24%, var(--thread-side-workspace-width, 38%), 52%);
  flex-direction: column;
  overflow: visible;
  background: var(--ui-bg-surface);
}

.thread-side-workspace-resizer {
  position: absolute;
  z-index: 4;
  top: 0;
  bottom: 0;
  left: -0.45rem;
  display: flex;
  width: 0.9rem;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}

.thread-side-workspace-resizer span {
  width: 1px;
  height: 100%;
  background: var(--ui-border-subtle);
  transition: width 120ms ease, background-color 120ms ease;
}

.thread-side-workspace-resizer:hover span,
.thread-side-workspace-resizer:focus-visible span,
.thread-side-workspace.is-resizing .thread-side-workspace-resizer span {
  width: 3px;
  background: var(--ui-border-strong);
}

.thread-side-workspace-header {
  display: flex;
  min-width: 0;
  min-height: 2.5rem;
  align-items: center;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: transparent;
}

.thread-side-workspace-tabs {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.3rem;
  overflow-x: auto;
  padding: 0.25rem 0.15rem;
  scrollbar-width: none;
}

.thread-side-workspace-tabs::-webkit-scrollbar {
  display: none;
}

.thread-side-workspace-tab {
  display: inline-flex;
  min-width: clamp(5.75rem, 24%, 8rem);
  max-width: 14rem;
  flex: 1 1 clamp(6rem, 10vw, 10rem);
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem 0.35rem 0.65rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 0.65rem;
  background: transparent;
  color: var(--ui-text-secondary);
  cursor: pointer;
  font-size: 0.7rem;
  text-align: left;
}

.thread-side-workspace-tab:hover,
.thread-side-workspace-tab:focus-visible,
.thread-side-workspace-tab.is-active {
  border-color: var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text-primary);
}

.thread-side-workspace-tab-icon,
.thread-side-workspace-menu-icon {
  display: inline-flex;
  width: 0.95rem;
  height: 0.95rem;
  flex: 0 0 0.95rem;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  line-height: 1;
}

.thread-side-workspace-tab-icon--terminal,
.thread-side-workspace-menu-icon--terminal {
  font-family: var(--font-mono-ui);
  font-size: 0.68rem;
  transform: translateY(1px);
}

.thread-side-workspace-tab-label {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-side-workspace-tab-close {
  display: inline-flex;
  width: 1.15rem;
  height: 1.15rem;
  flex: 0 0 1.15rem;
  align-items: center;
  justify-content: center;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-tertiary);
  font-size: 0.9rem;
  line-height: 1;
}

.thread-side-workspace-tab-close:hover,
.thread-side-workspace-tab-close:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-workspace-add-tab {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 1.75rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}

.thread-side-workspace-add-tab:hover,
.thread-side-workspace-add-tab:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-workspace-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.1rem;
  padding: 0 0.35rem;
}

.thread-side-workspace-action {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}

.thread-side-workspace-action:hover,
.thread-side-workspace-action:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-workspace-action--close {
  font-size: 1.2rem;
}

.thread-side-workspace-action--back {
  width: auto;
  gap: 0.2rem;
  padding: 0 0.35rem;
  font-size: 0.72rem;
}

@media (min-width: 1024px) {
  .thread-side-workspace-action--back {
    display: none;
  }
}

.thread-side-workspace-new-tab-menu {
  position: absolute;
  z-index: 5;
  top: 2.35rem;
  left: 0.5rem;
  display: grid;
  min-width: 8.5rem;
  padding: 0.25rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.thread-side-workspace-new-tab-menu button {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2rem;
  padding: 0.25rem 0.45rem;
  border: 0;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-secondary);
  cursor: pointer;
  font-size: 0.7rem;
  text-align: left;
}

.thread-side-workspace-new-tab-menu button:hover,
.thread-side-workspace-new-tab-menu button:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-workspace-content {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.thread-side-workspace-content :deep(.thread-side-panel) {
  width: 100%;
  flex: 1 1 auto;
}

@media (max-width: 1023px) {
  .thread-side-workspace {
    position: absolute;
    z-index: 20;
    inset: 0;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
    border-left: 0;
    box-shadow: none;
  }

  .thread-side-workspace-resizer {
    display: none;
  }
}

@media (max-width: 767px) {
  .thread-side-workspace-tab-close {
    width: 1rem;
    flex-basis: 1rem;
  }

}
</style>
