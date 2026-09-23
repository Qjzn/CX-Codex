<template>
  <aside
    class="thread-side-panel"
    :class="{
      'thread-side-panel--terminal': mode === 'terminal',
      'thread-side-panel--embedded': !showHeader,
    }"
    aria-label="当前会话侧边面板"
  >
    <header v-if="showHeader" class="thread-side-panel-header">
      <div class="thread-side-panel-heading">
        <span class="thread-side-panel-kicker">当前会话</span>
        <strong class="thread-side-panel-title" :title="title">{{ title || '未命名会话' }}</strong>
      </div>
      <button
        class="thread-side-panel-close"
        type="button"
        aria-label="关闭侧边面板"
        title="关闭侧边面板"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div v-if="showChat && showModeTabs" class="thread-side-panel-tabs" role="tablist" aria-label="当前会话侧边工具">
      <button
        v-if="showChat"
        class="thread-side-panel-tab"
        :class="{ 'is-active': mode === 'chat' }"
        type="button"
        role="tab"
        :aria-selected="mode === 'chat'"
        @click="emit('update:mode', 'chat')"
      >
        <IconTablerMessageCircle class="thread-side-panel-tab-icon" />
        <span>侧边聊天</span>
      </button>
      <button
        class="thread-side-panel-tab"
        :class="{ 'is-active': mode === 'terminal' }"
        type="button"
        role="tab"
        :aria-selected="mode === 'terminal'"
        @click="emit('update:mode', 'terminal')"
      >
        <span class="thread-side-panel-tab-icon thread-side-panel-tab-icon--terminal" aria-hidden="true">&gt;_</span>
        <span>侧边终端</span>
      </button>
    </div>

    <section v-if="showChat && mode === 'chat'" class="thread-side-chat" role="tabpanel" aria-label="当前会话侧边聊天">
      <div ref="chatMessagesRef" class="thread-side-chat-messages" aria-live="polite">
        <div v-if="chatMessages.length === 0" class="thread-side-chat-empty">
          <IconTablerMessageCircle class="thread-side-chat-empty-icon" />
          <strong>在当前会话旁边继续聊天</strong>
          <span>这是独立的侧边会话，不会把消息写入主聊天。</span>
        </div>
        <article
          v-for="message in chatMessages"
          :key="message.id"
          class="thread-side-chat-message"
          :data-role="message.role"
        >
          <span class="thread-side-chat-message-role">{{ message.role === 'user' ? '你' : 'Codex' }}</span>
          <p class="thread-side-chat-message-text">{{ message.text }}</p>
        </article>
      </div>
      <ThreadComposer
        class="thread-side-chat-composer"
        :active-thread-id="sideChatComposerContextId"
        :cwd="cwd"
        :models="models"
        :available-models="availableModels"
        :selected-model="sideChatModel"
        :selected-reasoning-effort="sideChatReasoningEffort"
        :selected-speed-mode="sideChatSpeedMode"
        :selected-collaboration-mode="sideChatCollaborationMode"
        :thread-goal="undefined"
        :skills="skills"
        :has-loaded-skills="hasLoadedSkills"
        :plugins="plugins"
        :is-loading-plugins="isLoadingPlugins"
        :has-loaded-plugins="hasLoadedPlugins"
        :disabled="false"
        :is-turn-in-progress="false"
        :is-interrupting-turn="false"
        :send-with-enter="sendWithEnter"
        :dictation-click-to-toggle="dictationClickToToggle"
        :dictation-auto-send="dictationAutoSend"
        :show-dictation-button="showDictationButton"
        :dictation-language="dictationLanguage"
        @submit="onSubmitSideChatComposer"
        @update:selected-model="selectSideChatModel"
        @update:selected-reasoning-effort="selectSideChatReasoningEffort"
        @update:selected-speed-mode="sideChatSpeedMode = $event"
        @update:selected-collaboration-mode="sideChatCollaborationMode = $event"
        @refresh-plugins="emit('refresh-plugins')"
        @reload-plugins="emit('reload-plugins')"
        @login-plugin="emit('login-plugin', $event)"
      />
    </section>

    <section v-else class="thread-side-terminal" role="tabpanel" aria-label="当前会话侧边终端">
      <div class="thread-side-terminal-context" :title="cwd">
        <span>工作目录</span>
        <code>{{ cwd || '当前会话未提供工作目录' }}</code>
      </div>
      <div class="thread-side-terminal-emulator-wrap">
        <div
          ref="terminalElementRef"
          class="thread-side-terminal-emulator"
          aria-label="侧边真实终端"
        />
        <div v-if="!terminalReady" class="thread-side-terminal-status-overlay" role="status">
          {{ terminalStatusLabel }}
        </div>
      </div>
      <div class="thread-side-terminal-footer">
        <span>{{ terminalStatus }}</span>
        <button
          type="button"
          class="thread-side-terminal-clear"
          :disabled="!terminalReady"
          @click="clearTerminalScreen"
        >
          清屏
        </button>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  closeSideThread,
  forkSideThread,
  getLatestThreadTurn,
  SIDE_DEVELOPER_INSTRUCTIONS,
  startSideThread,
  startThreadTurn,
  subscribeCodexNotifications,
} from '../../api/codexGateway'
import type { RpcNotification } from '../../api/codexGateway'
import IconTablerMessageCircle from '../icons/IconTablerMessageCircle.vue'
import ThreadComposer, { type SubmitPayload } from './ThreadComposer.vue'
import type {
  CollaborationMode,
  ComposerModelInfo,
  ComposerPluginInfo,
  ReasoningEffort,
  SpeedMode,
} from '../../types/codex'

type SidePanelMode = 'chat' | 'terminal'
type SideChatSkill = { name: string; description: string; path: string }
type SideChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}
type PersistedSideChatState = {
  threadId: string
  baselineMessageIds: string[]
  messages: SideChatMessage[]
  model: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
  collaborationMode: CollaborationMode
}

const props = withDefaults(defineProps<{
  threadId: string
  cwd: string
  title: string
  storageKey?: string
  mode: SidePanelMode
  model?: string
  models?: string[]
  availableModels?: ComposerModelInfo[]
  selectedReasoningEffort?: ReasoningEffort | ''
  skills?: SideChatSkill[]
  hasLoadedSkills?: boolean
  plugins?: ComposerPluginInfo[]
  isLoadingPlugins?: boolean
  hasLoadedPlugins?: boolean
  sendWithEnter?: boolean
  dictationClickToToggle?: boolean
  dictationAutoSend?: boolean
  showDictationButton?: boolean
  dictationLanguage?: string
  showChat?: boolean
  showHeader?: boolean
  showModeTabs?: boolean
}>(), {
  model: '',
  storageKey: '',
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
  showChat: true,
  showHeader: true,
  showModeTabs: true,
})

const emit = defineEmits<{
  close: []
  'update:mode': [mode: SidePanelMode]
  'refresh-plugins': []
  'reload-plugins': []
  'login-plugin': [pluginId: string]
}>()

const chatMessagesRef = ref<HTMLElement | null>(null)
const chatMessages = ref<SideChatMessage[]>([])
const sideChatThreadId = ref('')
const sideChatBaselineMessageIds = ref<string[]>([])
const sideChatError = ref('')
const sideChatModel = ref('')
const sideChatReasoningEffort = ref<ReasoningEffort | ''>('')
const sideChatSpeedMode = ref<SpeedMode>('standard')
const sideChatCollaborationMode = ref<CollaborationMode>('execute')
let sideChatRequestGeneration = 0
type SideChatTurnWaiter = {
  threadId: string
  turnId: string
  deltaItemIds: Set<string>
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: number
  startedAtMs: number
}
const sideChatTurnWaiters = new Set<SideChatTurnWaiter>()
let sideChatNotificationCleanup: (() => void) | null = null
let sideChatThreadCreationPromise: Promise<string> | null = null
const sideChatDeltaTextByItemId = new Map<string, string>()
const terminalElementRef = ref<HTMLElement | null>(null)
const terminalEmulator = shallowRef<Terminal | null>(null)
const terminalFitAddon = shallowRef<FitAddon | null>(null)
const terminalSocket = ref<WebSocket | null>(null)
const terminalReady = ref(false)
const terminalStatus = ref('未连接')
let terminalDataDisposable: { dispose: () => void } | null = null
let terminalResizeObserver: ResizeObserver | null = null
let terminalResizeFrame: number | null = null

const terminalStatusLabel = computed(() => terminalReady.value ? '真实终端已连接' : terminalStatus.value)
const sideChatStorageKey = computed(() => {
  const threadId = props.threadId.trim()
  const instanceKey = props.storageKey?.trim() ?? ''
  if (!threadId) return ''
  return `codex-web-local.side-chat.v2:${encodeURIComponent(threadId)}${instanceKey ? `:${encodeURIComponent(instanceKey)}` : ''}`
})
const sideChatReasoningValues: ReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]

const sideChatComposerContextId = computed(() => {
  const threadId = props.threadId.trim()
  return threadId ? `side-chat:${threadId}` : ''
})

const sideChatSelectedModelInfo = computed(() => (
  props.availableModels.find((model) => model.model === sideChatModel.value || model.id === sideChatModel.value)
))

function resolveSideChatReasoningEffort(preferred: ReasoningEffort | ''): ReasoningEffort | '' {
  const supported = sideChatSelectedModelInfo.value?.supportedReasoningEfforts ?? []
  if (supported.length === 0) return preferred
  if (preferred && supported.some((option) => option.value === preferred)) return preferred
  const defaultEffort = sideChatSelectedModelInfo.value?.defaultReasoningEffort
  if (defaultEffort && supported.some((option) => option.value === defaultEffort)) return defaultEffort
  return supported[0]?.value ?? ''
}

function selectSideChatModel(model: string): void {
  sideChatModel.value = model
  sideChatReasoningEffort.value = resolveSideChatReasoningEffort(sideChatReasoningEffort.value)
  persistSideChatState()
}
function selectSideChatReasoningEffort(effort: ReasoningEffort | ''): void {
  sideChatReasoningEffort.value = resolveSideChatReasoningEffort(effort)
  persistSideChatState()
}

function defaultSideChatModel(): string {
  const preferred = props.model?.trim() ?? ''
  if (preferred) return preferred
  return props.availableModels[0]?.model?.trim() || props.models[0]?.trim() || ''
}

function releaseSideChatThread(reason: string): void {
  sideChatRequestGeneration += 1
  sideChatThreadCreationPromise = null
  const activeTurnIds = [...sideChatTurnWaiters]
    .map((waiter) => waiter.turnId.trim())
    .filter((turnId, index, values) => Boolean(turnId) && values.indexOf(turnId) === index)
  cancelSideChatTurnWaiters(new Error(reason))
  sideChatDeltaTextByItemId.clear()
  const threadId = sideChatThreadId.value.trim()
  sideChatThreadId.value = ''
  sideChatNotificationCleanup?.()
  sideChatNotificationCleanup = null
  if (threadId) {
    void closeSideThread(threadId, activeTurnIds).catch((error) => {
      console.warn(`Failed to close the side chat thread while ${reason}`, error)
    })
  }
}

watch(
  () => [props.threadId, props.cwd] as const,
  () => {
    releaseSideChatThread('侧边会话已切换')
    resetSideChatState()
    closeTerminalSocket()
    terminalReady.value = false
    terminalStatus.value = props.cwd.trim() ? '未连接' : '当前会话未提供工作目录'
    if (props.mode === 'chat') disposeTerminalEmulator()
    void nextTick(() => {
      if (props.mode === 'terminal' && props.cwd.trim()) {
        ensureTerminalEmulator()
        terminalEmulator.value?.reset()
        connectTerminalSocket()
        scheduleTerminalFit()
        terminalEmulator.value?.focus()
      }
    })
    void scrollChatToBottom()
    if (props.mode === 'chat' && props.threadId.trim()) {
      sideChatNotificationCleanup = subscribeCodexNotifications(onSideChatNotification)
      prepareSideChatThread()
    }
  },
  { immediate: true },
)

watch(
  () => [props.model, props.models, props.availableModels] as const,
  () => {
    if (!sideChatModel.value.trim()) {
      const model = defaultSideChatModel()
      if (model) sideChatModel.value = model
    }
    const effort = resolveSideChatReasoningEffort(sideChatReasoningEffort.value)
    if (effort !== sideChatReasoningEffort.value) sideChatReasoningEffort.value = effort
    persistSideChatState()
  },
  { deep: true },
)

watch(() => props.mode, (mode, previousMode) => {
  if (mode !== previousMode && mode !== 'chat') {
    releaseSideChatThread('侧边聊天已切换到侧边终端')
  }
  if (mode === 'chat') {
    if (!sideChatNotificationCleanup) {
      sideChatNotificationCleanup = subscribeCodexNotifications(onSideChatNotification)
    }
    closeTerminalSocket()
    disposeTerminalEmulator()
    if (props.threadId.trim()) prepareSideChatThread()
    return
  }
  void nextTick(() => {
    ensureTerminalEmulator()
    if (props.cwd.trim() && !terminalSocket.value) connectTerminalSocket()
    scheduleTerminalFit()
    terminalEmulator.value?.focus()
  })
})

onMounted(() => {
  if (props.mode === 'chat') {
    if (!sideChatNotificationCleanup) {
      sideChatNotificationCleanup = subscribeCodexNotifications(onSideChatNotification)
    }
    if (props.threadId.trim()) prepareSideChatThread()
  } else {
    void nextTick(() => {
      ensureTerminalEmulator()
      if (props.cwd.trim()) connectTerminalSocket()
      scheduleTerminalFit()
      terminalEmulator.value?.focus()
    })
  }
})

onUnmounted(() => {
  releaseSideChatThread('侧边聊天已关闭')
  closeTerminalSocket()
  disposeTerminalEmulator()
})

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function onSubmitSideChatComposer(payload: SubmitPayload): void {
  const text = payload.text.trim()
  const attachmentSummary = [
    payload.imageUrls.length > 0 ? `${payload.imageUrls.length} 张图片` : '',
    payload.fileAttachments.length > 0 ? `${payload.fileAttachments.length} 个附件` : '',
  ].filter(Boolean).join('、')
  const displayText = text || (attachmentSummary ? `[${attachmentSummary}]` : '')
  if (!displayText || !props.threadId.trim()) return
  chatMessages.value = [...chatMessages.value, { id: createId('side-chat-user'), role: 'user' as const, text: displayText }].slice(-30)
  sideChatError.value = ''
  persistSideChatState()
  void scrollChatToBottom()
  void sendSideChatTurn(payload)
}

function sideChatErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : '侧边聊天创建失败'
  return /failed to fetch/i.test(rawMessage)
    ? '侧边聊天连接失败，请检查 Codex 服务连接后重试。'
    : rawMessage
}

function appendSideChatSystemMessage(text: string): void {
  const normalizedText = text.trim()
  if (!normalizedText) return
  const lastMessage = chatMessages.value[chatMessages.value.length - 1]
  if (lastMessage?.role === 'system' && lastMessage.text === normalizedText) return
  chatMessages.value = [
    ...chatMessages.value,
    { id: createId('side-chat-error'), role: 'system' as const, text: normalizedText },
  ].slice(-30)
  persistSideChatState()
}

function prepareSideChatThread(): void {
  if (props.mode !== 'chat' || !props.threadId.trim()) return
  const generation = sideChatRequestGeneration
  void ensureSideChatThread().catch((error) => {
    // A close or parent switch intentionally invalidates an in-flight create.
    // Its cleanup is owned by ensureSideChatThread; do not surface a stale
    // transport error in the newly selected side panel.
    if (generation !== sideChatRequestGeneration) return
    const message = sideChatErrorMessage(error)
    sideChatError.value = message
    appendSideChatSystemMessage(message)
  })
}

function resetSideChatState(): void {
  sideChatDeltaTextByItemId.clear()
  const state = loadSideChatState()
  sideChatThreadId.value = state.threadId
  sideChatBaselineMessageIds.value = state.baselineMessageIds
  chatMessages.value = state.messages
  sideChatModel.value = state.model || defaultSideChatModel()
  sideChatReasoningEffort.value = resolveSideChatReasoningEffort(state.reasoningEffort)
  sideChatSpeedMode.value = state.speedMode
  sideChatCollaborationMode.value = state.collaborationMode
  sideChatError.value = ''
}

function normalizeSideChatMessage(value: unknown): SideChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : ''
  if (!text.trim()) return null
  const role: SideChatMessage['role'] =
    record.role === 'assistant' || record.role === 'system' ? record.role : 'user'
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id : createId('side-chat'),
    role,
    text,
  }
}

function loadSideChatState(): PersistedSideChatState {
  const emptyState: PersistedSideChatState = {
    threadId: '',
    baselineMessageIds: [],
    messages: [],
    model: defaultSideChatModel(),
    reasoningEffort: props.selectedReasoningEffort ?? '',
    speedMode: 'standard',
    collaborationMode: 'execute',
  }
  if (typeof window === 'undefined' || !sideChatStorageKey.value) return emptyState
  try {
    const parsed = JSON.parse(window.localStorage.getItem(sideChatStorageKey.value) ?? '') as unknown
    if (Array.isArray(parsed)) {
      return {
        ...emptyState,
        messages: parsed.map(normalizeSideChatMessage).filter((message): message is SideChatMessage => message !== null).slice(-30),
      }
    }
    if (!parsed || typeof parsed !== 'object') return emptyState
    const record = parsed as Record<string, unknown>
    return {
      // Side threads are ephemeral. Never revive an id from localStorage after
      // a reload: it may already have been unsubscribed with the old page.
      threadId: '',
      baselineMessageIds: Array.isArray(record.baselineMessageIds)
        ? record.baselineMessageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [],
      messages: Array.isArray(record.messages)
        ? record.messages.map(normalizeSideChatMessage).filter((message): message is SideChatMessage => message !== null).slice(-30)
        : [],
      model: typeof record.model === 'string' ? record.model.trim() : '',
      reasoningEffort: typeof record.reasoningEffort === 'string'
        && sideChatReasoningValues.includes(record.reasoningEffort as ReasoningEffort)
        ? record.reasoningEffort as ReasoningEffort
        : '',
      speedMode: record.speedMode === 'fast' ? 'fast' : 'standard',
      collaborationMode: record.collaborationMode === 'plan' ? 'plan' : 'execute',
    }
  } catch {
    return emptyState
  }
}

function persistSideChatState(): void {
  if (typeof window === 'undefined' || !sideChatStorageKey.value) return
  try {
    window.localStorage.setItem(sideChatStorageKey.value, JSON.stringify({
      // The server-side side thread is ephemeral. Persist only the visible
      // transcript and composer preferences; never leave an id that could be
      // mistaken for a resumable conversation after a reload.
      threadId: '',
      baselineMessageIds: sideChatBaselineMessageIds.value,
      messages: chatMessages.value.slice(-30),
      model: sideChatModel.value,
      reasoningEffort: sideChatReasoningEffort.value,
      speedMode: sideChatSpeedMode.value,
      collaborationMode: sideChatCollaborationMode.value,
    } satisfies PersistedSideChatState))
  } catch {
    // Embedded WebViews and private browsing may disable localStorage.
  }
}

async function ensureSideChatThread(): Promise<string> {
  const existingThreadId = sideChatThreadId.value.trim()
  if (existingThreadId) return existingThreadId
  if (sideChatThreadCreationPromise) return sideChatThreadCreationPromise
  const parentThreadId = props.threadId.trim()
  const generation = sideChatRequestGeneration
  const creationPromise = (async () => {
    const nextThreadId = parentThreadId === '__new-thread__'
      ? await startSideThread(
        props.cwd.trim() || undefined,
        sideChatModel.value.trim() || props.model?.trim() || undefined,
      )
      : await forkSideThread(
        parentThreadId,
        props.cwd.trim() || undefined,
        sideChatModel.value.trim() || props.model?.trim() || undefined,
      )
    if (generation !== sideChatRequestGeneration) {
      await closeSideThread(nextThreadId).catch((error) => {
        console.warn('Failed to close a side chat thread created during a switch', error)
      })
      throw new Error('侧边会话已切换')
    }
    sideChatThreadId.value = nextThreadId
    // A fork inherits the parent history. Do not immediately read the complete
    // fork here: large parent threads make that response unnecessarily heavy and
    // can surface as a browser-level "Failed to fetch" through a prefix proxy.
    // The first side turn is isolated by its own turn id, and the compact final
    // read below recovers a reply if live deltas were missed.
    sideChatBaselineMessageIds.value = []
    persistSideChatState()
    return nextThreadId
  })()
  sideChatThreadCreationPromise = creationPromise
  try {
    return await creationPromise
  } finally {
    if (sideChatThreadCreationPromise === creationPromise) sideChatThreadCreationPromise = null
  }
}

function upsertSideChatReply(messageId: string, text: string): void {
  if (!text.trim()) return
  const id = `side-chat-reply:${messageId}`
  const nextMessage = { id, role: 'assistant' as const, text }
  const index = chatMessages.value.findIndex((message) => message.id === id)
  if (index < 0) {
    chatMessages.value = [...chatMessages.value, nextMessage].slice(-30)
    return
  }
  const nextMessages = [...chatMessages.value]
  nextMessages[index] = nextMessage
  chatMessages.value = nextMessages
}

function asNotificationRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function notificationString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function notificationTurnId(record: Record<string, unknown> | null): string {
  const directTurnId = notificationString(record, 'turnId')
  if (directTurnId) return directTurnId
  const turn = asNotificationRecord(record?.turn)
  return notificationString(turn, 'id')
}

function sideChatNotificationMatches(
  waiter: SideChatTurnWaiter,
  record: Record<string, unknown> | null,
): boolean {
  const threadId = notificationString(record, 'threadId')
  if (threadId !== waiter.threadId) return false
  const turnId = notificationTurnId(record)
  if (waiter.turnId && turnId && waiter.turnId !== turnId) return false
  if (!waiter.turnId && turnId) waiter.turnId = turnId
  return true
}

function completeSideChatTurnWaiter(waiter: SideChatTurnWaiter, error?: Error): void {
  if (!sideChatTurnWaiters.delete(waiter)) return
  window.clearTimeout(waiter.timeoutId)
  for (const itemId of waiter.deltaItemIds) sideChatDeltaTextByItemId.delete(itemId)
  if (error) waiter.reject(error)
  else waiter.resolve()
}

function cancelSideChatTurnWaiters(error: Error): void {
  for (const waiter of [...sideChatTurnWaiters]) completeSideChatTurnWaiter(waiter, error)
}

function waitForSideChatTurn(threadId: string): { waiter: SideChatTurnWaiter; completion: Promise<void> } {
  let waiter: SideChatTurnWaiter
  const completion = new Promise<void>((resolve, reject) => {
    waiter = {
      threadId,
      turnId: '',
      deltaItemIds: new Set<string>(),
      resolve,
      reject,
      timeoutId: 0,
      startedAtMs: 0,
    }
    waiter.timeoutId = window.setTimeout(() => {
      completeSideChatTurnWaiter(waiter, new Error('侧边会话响应超时，请稍后重试'))
    }, 300_000)
    sideChatTurnWaiters.add(waiter)
  })
  return { waiter: waiter!, completion }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function startNativeTurnReadFallback(threadId: string, turnId: string, waiter: SideChatTurnWaiter): void {
  if (!sideChatTurnWaiters.has(waiter) || waiter.threadId !== threadId || waiter.turnId !== turnId) return
  waiter.startedAtMs = Date.now()

  // The native event stream is authoritative for live deltas. A lightweight
  // latest-turn probe is only a recovery path for a websocket that connects
  // just after a fast turn has already emitted its notifications. It avoids
  // the full parent-history `thread/read` that can fail through /codex/ when
  // the fork contains a large conversation.
  void (async () => {
    await delay(1500)
    while (sideChatTurnWaiters.has(waiter)) {
      try {
        const turn = await getLatestThreadTurn(threadId)
        if (turn?.id === turnId) {
          appendSideChatTurnItems(turn.items, turnId)
          if (turn.status === 'failed' || turn.status === 'interrupted') {
            const error = asNotificationRecord(turn.error)
            completeSideChatTurnWaiter(waiter,
              new Error(notificationString(error, 'message') || `侧边会话${turn.status === 'failed' ? '执行失败' : '已中断'}`),
            )
            return
          } else if (turn.status === 'completed') {
            completeSideChatTurnWaiter(waiter)
            return
          }
        }
      } catch {
        // Keep waiting for the native notification or the next lightweight probe.
      }
      await delay(1500)
    }
  })()
}

function appendSideChatTurnItems(items: unknown[], turnId: string): void {
  for (const value of items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const item = value as Record<string, unknown>
    if (item.type !== 'agentMessage') continue
    const itemId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${turnId}-agent-message`
    const text = typeof item.text === 'string' ? item.text : ''
    if (text.trim()) upsertSideChatReply(itemId, text)
  }
  persistSideChatState()
  void scrollChatToBottom()
}

function onSideChatNotification(notification: RpcNotification): void {
  const record = asNotificationRecord(notification.params)
  const threadId = notificationString(record, 'threadId')
  const turnId = notificationTurnId(record)
  const waiter = [...sideChatTurnWaiters].find((candidate) => (
    candidate.threadId === threadId && (!turnId || !candidate.turnId || candidate.turnId === turnId)
  ))
  if (!waiter || !sideChatNotificationMatches(waiter, record)) return

  if (notification.method === 'turn/started') return

  if (notification.method === 'item/agentMessage/delta') {
    const itemId = notificationString(record, 'itemId')
    const delta = typeof record?.delta === 'string' ? record.delta : ''
    if (!itemId || !delta) return
    const nextText = `${sideChatDeltaTextByItemId.get(itemId) ?? ''}${delta}`
    sideChatDeltaTextByItemId.set(itemId, nextText)
    waiter.deltaItemIds.add(itemId)
    upsertSideChatReply(itemId, nextText)
    persistSideChatState()
    void scrollChatToBottom()
    return
  }

  if (notification.method === 'turn/completed') {
    const turn = asNotificationRecord(record?.turn)
    const status = notificationString(turn, 'status')
    if (status === 'failed' || status === 'interrupted') {
      const error = asNotificationRecord(turn?.error)
      const message = notificationString(error, 'message') || `侧边会话${status === 'failed' ? '执行失败' : '已中断'}`
      completeSideChatTurnWaiter(waiter, new Error(message))
    } else if (status === 'completed') {
      completeSideChatTurnWaiter(waiter)
    }
    return
  }

  if (notification.method === 'error') {
    const message = notificationString(record, 'message') || '侧边会话执行失败'
    completeSideChatTurnWaiter(waiter, new Error(message))
  }
}

async function sendSideChatTurn(payload: SubmitPayload): Promise<void> {
  const generation = sideChatRequestGeneration
  let waiter: SideChatTurnWaiter | null = null
  try {
    const threadId = await ensureSideChatThread()
    if (generation !== sideChatRequestGeneration) {
      await closeSideThread(threadId).catch((error) => {
        console.warn('Failed to close a side chat thread created during unmount', error)
      })
      return
    }
    persistSideChatState()
    const pendingTurn = waitForSideChatTurn(threadId)
    waiter = pendingTurn.waiter
    const turnId = await startThreadTurn(
      threadId,
      payload.text,
      payload.imageUrls,
      sideChatModel.value.trim() || props.model?.trim() || undefined,
      sideChatReasoningEffort.value || undefined,
      payload.skills,
      payload.fileAttachments,
      payload.collaborationMode,
      payload.turnOptions?.plugins,
      props.cwd.trim() || undefined,
      // Keep the native side-thread developer policy active. `null` means
      // "use the built-in instructions for the selected collaboration mode"
      // and would otherwise erase the policy installed by thread/fork.
      SIDE_DEVELOPER_INSTRUCTIONS,
    )
    if (sideChatTurnWaiters.has(waiter) && waiter.threadId === threadId) {
      waiter.turnId = turnId
      startNativeTurnReadFallback(threadId, turnId, waiter)
    }
    await pendingTurn.completion
    if (generation !== sideChatRequestGeneration) return

    // Live deltas normally already rendered the reply. If the transport
    // connected too late, recover only the completed latest turn instead of
    // hydrating the entire forked conversation.
    try {
      const turn = await getLatestThreadTurn(threadId)
      if (turn?.id === turnId) {
        appendSideChatTurnItems(turn.items, turn.id)
      }
    } catch {
      // A completed turn with live deltas is still a successful send. Do not
      // replace it with a raw browser-level `Failed to fetch` error.
    }
    persistSideChatState()
    void scrollChatToBottom()
  } catch (error) {
    if (generation !== sideChatRequestGeneration) return
    if (waiter) completeSideChatTurnWaiter(waiter, error instanceof Error ? error : new Error('侧边聊天发送失败'))
    sideChatError.value = sideChatErrorMessage(error)
    appendSideChatSystemMessage(sideChatError.value)
  } finally {
    if (generation === sideChatRequestGeneration) void scrollChatToBottom()
  }
}

function ensureTerminalEmulator(): void {
  const element = terminalElementRef.value
  if (!element || terminalEmulator.value) return

  const emulator = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.2,
    scrollback: 3000,
    theme: {
      background: '#0d1117',
      foreground: '#d7dde5',
      cursor: '#f0f6fc',
      selectionBackground: '#264f78',
    },
  })
  const fitAddon = new FitAddon()
  emulator.loadAddon(fitAddon)
  emulator.open(element)
  terminalEmulator.value = emulator
  terminalFitAddon.value = fitAddon
  terminalDataDisposable = emulator.onData((data) => {
    sendTerminalPayload({ type: 'input', data })
  })
  if (typeof ResizeObserver !== 'undefined') {
    terminalResizeObserver = new ResizeObserver(() => scheduleTerminalFit())
    terminalResizeObserver.observe(element)
  }
  scheduleTerminalFit()
}

function scheduleTerminalFit(): void {
  if (typeof window === 'undefined' || terminalResizeFrame !== null) return
  terminalResizeFrame = window.requestAnimationFrame(() => {
    terminalResizeFrame = null
    const element = terminalElementRef.value
    const emulator = terminalEmulator.value
    const fitAddon = terminalFitAddon.value
    if (!element || !emulator || !fitAddon || element.clientWidth <= 0 || element.clientHeight <= 0) return
    try {
      fitAddon.fit()
      sendTerminalPayload({ type: 'resize', cols: emulator.cols, rows: emulator.rows })
    } catch {
      // The terminal can be temporarily hidden while the side panel changes mode.
    }
  })
}

function disposeTerminalEmulator(): void {
  if (typeof window !== 'undefined' && terminalResizeFrame !== null) {
    window.cancelAnimationFrame(terminalResizeFrame)
    terminalResizeFrame = null
  }
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = null
  terminalDataDisposable?.dispose()
  terminalDataDisposable = null
  terminalEmulator.value?.dispose()
  terminalEmulator.value = null
  terminalFitAddon.value = null
}

function terminalWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}/codex-api/terminal/ws`)
  url.searchParams.set('cwd', props.cwd.trim())
  url.searchParams.set('threadId', props.threadId.trim())
  url.searchParams.set('cols', '120')
  url.searchParams.set('rows', '32')
  return url.toString()
}

function connectTerminalSocket(): void {
  if (typeof window === 'undefined' || !props.cwd.trim() || terminalSocket.value) return
  ensureTerminalEmulator()
  terminalStatus.value = '正在连接真实终端…'
  const socket = new WebSocket(terminalWebSocketUrl())
  terminalSocket.value = socket
  socket.addEventListener('open', () => {
    terminalStatus.value = '已连接'
    scheduleTerminalFit()
  })
  socket.addEventListener('message', (event) => {
    let payload: unknown
    try {
      payload = JSON.parse(String(event.data))
    } catch {
      writeTerminalOutput(String(event.data))
      return
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
    const record = payload as Record<string, unknown>
    if (record.type === 'ready') {
      terminalReady.value = true
      terminalStatus.value = '已连接'
      scheduleTerminalFit()
      terminalEmulator.value?.focus()
    } else if (record.type === 'output' && typeof record.data === 'string') {
      writeTerminalOutput(record.data)
    } else if (record.type === 'error') {
      terminalStatus.value = typeof record.message === 'string' ? record.message : '终端错误'
    } else if (record.type === 'exit') {
      terminalReady.value = false
      terminalStatus.value = '终端已退出'
    }
  })
  socket.addEventListener('error', () => {
    terminalReady.value = false
    terminalStatus.value = '真实终端连接失败'
  })
  socket.addEventListener('close', () => {
    if (terminalSocket.value === socket) terminalSocket.value = null
    terminalReady.value = false
    if (terminalStatus.value === '已连接') terminalStatus.value = '终端已断开'
  })
}

function closeTerminalSocket(): void {
  const socket = terminalSocket.value
  terminalSocket.value = null
  terminalReady.value = false
  if (!socket) return
  socket.close()
}

function sendTerminalPayload(payload: unknown): void {
  if (terminalSocket.value?.readyState !== WebSocket.OPEN) return
  terminalSocket.value.send(JSON.stringify(payload))
}

function writeTerminalOutput(data: string): void {
  terminalEmulator.value?.write(data)
}

function clearTerminalScreen(): void {
  terminalEmulator.value?.clear()
  terminalEmulator.value?.focus()
}

async function scrollChatToBottom(): Promise<void> {
  await nextTick()
  if (chatMessagesRef.value) chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight
}

</script>

<style scoped>
.thread-side-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 0 0 min(22rem, 34vw);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.thread-side-panel--terminal {
  flex-basis: 38rem;
}

.thread-side-panel--embedded {
  flex-basis: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.thread-side-panel-header,
.thread-side-panel-tabs,
.thread-side-terminal-footer {
  display: flex;
  align-items: center;
}

.thread-side-panel-header {
  min-width: 0;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem 0.55rem;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.thread-side-panel-heading {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}

.thread-side-panel-kicker {
  color: var(--ui-text-tertiary);
  font-size: 0.62rem;
}

.thread-side-panel-title {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-side-panel-close {
  display: inline-flex;
  width: 1.7rem;
  height: 1.7rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font-size: 1.15rem;
  line-height: 1;
}

.thread-side-panel-close:hover,
.thread-side-panel-close:focus-visible,
.thread-side-terminal-clear:hover:not(:disabled),
.thread-side-terminal-clear:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-panel-tabs {
  gap: 0.25rem;
  padding: 0.4rem 0.55rem;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
}

.thread-side-panel-tab {
  display: inline-flex;
  min-width: 0;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2rem;
  padding: 0.25rem 0.35rem;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-secondary);
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 600;
}

.thread-side-panel-tab:hover,
.thread-side-panel-tab:focus-visible,
.thread-side-panel-tab.is-active {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

.thread-side-panel-tab-icon {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  flex: 0 0 1rem;
  font-size: 1rem;
  line-height: 1;
}

.thread-side-panel-tab-icon--terminal,
.thread-side-terminal-context code {
  font-family: var(--font-mono-ui);
}

.thread-side-panel-tab-icon--terminal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translateY(1px);
}

.thread-side-chat,
.thread-side-terminal {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.thread-side-terminal {
  background: #0d1117;
  color: #d7dde5;
}

.thread-side-chat-messages,
.thread-side-terminal-emulator-wrap {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.thread-side-chat-messages {
  width: min(100%, var(--ui-content-max));
  margin-inline: auto;
  padding: 0.65rem;
}

.thread-side-terminal-emulator-wrap {
  position: relative;
  overflow: hidden;
  background: #0d1117;
}

.thread-side-terminal-emulator {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.thread-side-terminal-emulator :deep(.xterm) {
  height: 100%;
  padding: 0.55rem 0.45rem 0.7rem;
  box-sizing: border-box;
}

.thread-side-terminal-emulator :deep(.xterm-viewport) {
  background: #0d1117 !important;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.thread-side-terminal-emulator :deep(.xterm-viewport::-webkit-scrollbar) {
  display: none;
  width: 0;
  height: 0;
}

.thread-side-terminal-status-overlay {
  position: absolute;
  top: 0.75rem;
  left: 0.8rem;
  color: #8b949e;
  font-family: var(--font-mono-ui);
  font-size: 0.68rem;
  pointer-events: none;
}

.thread-side-chat-composer {
  flex: 0 0 auto;
  min-width: 0;
  width: min(100%, var(--ui-content-max));
  margin-inline: auto;
  padding: 0.55rem 0.65rem 0.65rem;
}

.thread-side-chat-composer :deep(.thread-composer) {
  max-width: none;
  padding: 0;
}

.thread-side-chat-composer :deep(.thread-composer-shell) {
  border-radius: var(--ui-radius-composer);
}

.thread-side-chat-empty {
  display: flex;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1rem;
  color: var(--ui-text-tertiary);
  text-align: center;
  font-size: 0.7rem;
  line-height: 1.45;
}

.thread-side-chat-empty strong {
  color: var(--ui-text-secondary);
  font-size: 0.76rem;
}

.thread-side-chat-empty-icon {
  color: var(--ui-text-secondary);
  font-size: 1.5rem;
}

.thread-side-chat-message {
  max-width: 92%;
  margin: 0 0 0.55rem;
  padding: 0.48rem 0.58rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface-muted);
}

.thread-side-chat-message[data-role='user'] {
  margin-left: auto;
  border-color: color-mix(in srgb, var(--ui-accent) 20%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-accent) 8%, var(--ui-bg-surface));
}

.thread-side-chat-message-role {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--ui-text-tertiary);
  font-size: 0.6rem;
  font-weight: 700;
}

.thread-side-chat-message-text {
  margin: 0;
  color: var(--ui-text-primary);
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.thread-side-terminal-footer,
.thread-side-terminal-context {
  color: var(--ui-text-tertiary);
  font-size: 0.62rem;
}

.thread-side-terminal-context {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem 0.35rem;
  border-bottom: 1px solid #30363d;
  background: #161b22;
}

.thread-side-terminal-context code {
  overflow: hidden;
  color: #c9d1d9;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-side-terminal-footer {
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.65rem 0.55rem;
  background: #0d1117;
}

.thread-side-terminal-clear {
  padding: 0.15rem 0.3rem;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: #8b949e;
  cursor: pointer;
  font-size: 0.62rem;
}

</style>
