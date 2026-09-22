<template>
  <aside class="thread-side-panel" aria-label="当前会话侧边面板">
    <header class="thread-side-panel-header">
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

    <div class="thread-side-panel-tabs" role="tablist" aria-label="当前会话侧边工具">
      <button
        class="thread-side-panel-tab"
        :class="{ 'is-active': mode === 'chat' }"
        type="button"
        role="tab"
        :aria-selected="mode === 'chat'"
        @click="emit('update:mode', 'chat')"
      >
        <span class="thread-side-panel-tab-icon" aria-hidden="true">◌</span>
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

    <section v-if="mode === 'chat'" class="thread-side-chat" role="tabpanel" aria-label="当前会话侧边聊天">
      <div ref="chatMessagesRef" class="thread-side-chat-messages" aria-live="polite">
        <div v-if="chatMessages.length === 0" class="thread-side-chat-empty">
          <span class="thread-side-chat-empty-icon" aria-hidden="true">◌</span>
          <strong>在当前会话旁边继续聊天</strong>
          <span>这里使用同一个会话上下文，发送内容会同步到主对话。</span>
        </div>
        <article
          v-for="message in chatMessages"
          :key="message.id"
          class="thread-side-chat-message"
          :data-role="message.role"
        >
          <span class="thread-side-chat-message-role">{{ message.role === 'user' ? '你' : 'Codex' }}</span>
          <p class="thread-side-chat-message-text">{{ message.text || (message.images?.length ? '[图片]' : '') }}</p>
        </article>
      </div>
      <form class="thread-side-chat-form" @submit.prevent="sendChatMessage">
        <textarea
          ref="chatInputRef"
          v-model="chatDraft"
          class="thread-side-chat-input"
          rows="3"
          :disabled="!threadId || isSending"
          placeholder="向当前会话发送消息…"
          aria-label="侧边聊天输入框"
          @keydown.enter.exact.prevent="sendChatMessage"
        />
        <div class="thread-side-chat-form-footer">
          <span class="thread-side-chat-hint">Enter 发送 · Shift + Enter 换行</span>
          <button
            class="thread-side-chat-send"
            type="submit"
            :disabled="!threadId || isSending || chatDraft.trim().length === 0"
          >
            {{ isSending ? '发送中…' : '发送' }}
          </button>
        </div>
      </form>
    </section>

    <section v-else class="thread-side-terminal" role="tabpanel" aria-label="当前会话侧边终端">
      <div class="thread-side-terminal-context" :title="cwd">
        <span>工作目录</span>
        <code>{{ cwd || '当前会话未提供工作目录' }}</code>
      </div>
      <div ref="terminalOutputRef" class="thread-side-terminal-output" aria-live="polite">
        <div v-if="terminalEntries.length === 0" class="thread-side-terminal-empty">
          <span class="thread-side-terminal-empty-icon" aria-hidden="true">&gt;_</span>
          <strong>还没有命令</strong>
          <span>在下方输入命令并按 Enter 执行。</span>
          <small>命令限制在当前会话工作区，并通过 Codex App Server 沙箱执行。</small>
        </div>
        <article
          v-for="entry in terminalEntries"
          :key="entry.id"
          class="thread-side-terminal-entry"
          :data-status="entry.status"
        >
          <div class="thread-side-terminal-command-line">
            <span class="thread-side-terminal-prompt" aria-hidden="true">{{ promptLabel }}</span>
            <code :title="entry.command">{{ entry.command }}</code>
            <span class="thread-side-terminal-entry-meta">
              {{ entry.status === 'running' ? '执行中…' : formatEntryMeta(entry) }}
            </span>
          </div>
          <pre v-if="entry.stdout" class="thread-side-terminal-output-text">{{ entry.stdout }}</pre>
          <pre v-if="entry.stderr" class="thread-side-terminal-output-text is-stderr">{{ entry.stderr }}</pre>
          <p v-if="entry.status === 'running'" class="thread-side-terminal-entry-note">正在等待命令输出…</p>
        </article>
      </div>
      <form class="thread-side-terminal-form" @submit.prevent="runCommand">
        <span class="thread-side-terminal-form-prompt" aria-hidden="true">{{ promptLabel }}</span>
        <input
          ref="commandInputRef"
          v-model="commandInput"
          class="thread-side-terminal-input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="isTerminalRunning || !cwd"
          :placeholder="isTerminalRunning ? '命令执行中…' : '输入命令，例如 git status'"
          aria-label="侧边终端命令输入框"
          @keydown="onCommandKeydown"
        />
        <button
          class="thread-side-terminal-submit"
          type="submit"
          :disabled="isTerminalRunning || !cwd || commandInput.trim().length === 0"
          aria-label="执行命令"
          title="执行命令"
        >
          ↵
        </button>
      </form>
      <div class="thread-side-terminal-footer">
        <span>↑ / ↓ 浏览命令历史</span>
        <button
          type="button"
          class="thread-side-terminal-clear"
          :disabled="isTerminalRunning || terminalEntries.length === 0"
          @click="clearTerminalHistory"
        >
          清空
        </button>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { executeTerminalCommand } from '../../api/codexGateway'
import type { UiMessage } from '../../types/codex'

type SidePanelMode = 'chat' | 'terminal'
type TerminalEntryStatus = 'running' | 'completed' | 'error'
type TerminalEntry = {
  id: string
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  status: TerminalEntryStatus
  error: string
  startedAtIso: string
  durationMs: number | null
}

const props = withDefaults(defineProps<{
  threadId: string
  cwd: string
  title: string
  messages: UiMessage[]
  mode: SidePanelMode
  isSending?: boolean
}>(), {
  isSending: false,
})

const emit = defineEmits<{
  close: []
  'update:mode': [mode: SidePanelMode]
  send: [text: string]
}>()

const MAX_TERMINAL_ENTRIES = 30
const MAX_OUTPUT_CHARS = 24_000
const chatDraft = ref('')
const chatMessagesRef = ref<HTMLElement | null>(null)
const chatInputRef = ref<HTMLTextAreaElement | null>(null)
const commandInput = ref('')
const commandInputRef = ref<HTMLInputElement | null>(null)
const terminalOutputRef = ref<HTMLElement | null>(null)
const terminalEntries = ref<TerminalEntry[]>([])
const isTerminalRunning = ref(false)
const historyCursor = ref(-1)
const platformLabel = ref('')

const chatMessages = computed(() => props.messages.slice(-30))
const promptLabel = computed(() => platformLabel.value === 'win32' ? 'PS>' : '$')
const terminalStorageKey = computed(() => {
  const threadId = props.threadId.trim()
  return threadId ? `codex-web-local.side-terminal.v1:${encodeURIComponent(threadId)}` : ''
})

watch(
  () => [props.threadId, props.cwd] as const,
  () => {
    chatDraft.value = ''
    commandInput.value = ''
    historyCursor.value = -1
    terminalEntries.value = loadTerminalEntries()
    void scrollChatToBottom()
    void scrollTerminalToBottom()
  },
  { immediate: true },
)

watch(
  () => props.messages.length,
  () => { void scrollChatToBottom() },
)

watch(terminalEntries, () => {
  persistTerminalEntries()
  void scrollTerminalToBottom()
}, { deep: true })

watch(() => props.mode, (mode) => {
  if (mode === 'chat') {
    void nextTick(() => chatInputRef.value?.focus())
  } else {
    void nextTick(() => commandInputRef.value?.focus())
  }
})

onMounted(() => {
  if (props.mode === 'chat') chatInputRef.value?.focus()
  else commandInputRef.value?.focus()
})

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sendChatMessage(): void {
  const text = chatDraft.value.trim()
  if (!text || !props.threadId.trim() || props.isSending) return
  chatDraft.value = ''
  emit('send', text)
}

function loadTerminalEntries(): TerminalEntry[] {
  if (typeof window === 'undefined' || !terminalStorageKey.value) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(terminalStorageKey.value) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is Partial<TerminalEntry> => value !== null && typeof value === 'object')
      .map((value) => ({
        id: typeof value.id === 'string' ? value.id : createId('terminal'),
        command: typeof value.command === 'string' ? value.command : '',
        cwd: typeof value.cwd === 'string' ? value.cwd : props.cwd,
        stdout: typeof value.stdout === 'string' ? value.stdout.slice(-MAX_OUTPUT_CHARS) : '',
        stderr: typeof value.stderr === 'string' ? value.stderr.slice(-MAX_OUTPUT_CHARS) : '',
        exitCode: typeof value.exitCode === 'number' ? value.exitCode : null,
        status: normalizeTerminalStatus(value.status),
        error: typeof value.error === 'string' ? value.error : '',
        startedAtIso: typeof value.startedAtIso === 'string' ? value.startedAtIso : new Date().toISOString(),
        durationMs: typeof value.durationMs === 'number' ? value.durationMs : null,
      }))
      .filter((entry) => entry.command.trim().length > 0)
      .slice(-MAX_TERMINAL_ENTRIES)
  } catch {
    return []
  }
}

function normalizeTerminalStatus(value: unknown): TerminalEntryStatus {
  return value === 'error' || value === 'running' ? value : 'completed'
}

function persistTerminalEntries(): void {
  if (typeof window === 'undefined' || !terminalStorageKey.value) return
  try {
    window.localStorage.setItem(terminalStorageKey.value, JSON.stringify(terminalEntries.value.slice(-MAX_TERMINAL_ENTRIES)))
  } catch {
    // Embedded WebViews and private browsing may disable localStorage.
  }
}

function clearTerminalHistory(): void {
  if (isTerminalRunning.value) return
  terminalEntries.value = []
}

function onCommandKeydown(event: KeyboardEvent): void {
  const commands = terminalEntries.value.map((entry) => entry.command).reverse()
  if (event.key === 'ArrowUp' && !event.shiftKey) {
    event.preventDefault()
    if (commands.length === 0) return
    historyCursor.value = Math.min(historyCursor.value + 1, commands.length - 1)
    commandInput.value = commands[historyCursor.value] ?? ''
    return
  }
  if (event.key === 'ArrowDown' && !event.shiftKey) {
    event.preventDefault()
    if (historyCursor.value <= 0) {
      historyCursor.value = -1
      commandInput.value = ''
      return
    }
    historyCursor.value -= 1
    commandInput.value = commands[historyCursor.value] ?? ''
  }
}

async function runCommand(): Promise<void> {
  const command = commandInput.value.trim()
  const cwd = props.cwd.trim()
  if (!command || !cwd || isTerminalRunning.value) return

  const startedAt = Date.now()
  const entry: TerminalEntry = {
    id: createId('terminal'),
    command,
    cwd,
    stdout: '',
    stderr: '',
    exitCode: null,
    status: 'running',
    error: '',
    startedAtIso: new Date(startedAt).toISOString(),
    durationMs: null,
  }
  terminalEntries.value = [...terminalEntries.value, entry].slice(-MAX_TERMINAL_ENTRIES)
  commandInput.value = ''
  historyCursor.value = -1
  isTerminalRunning.value = true

  try {
    const result = await executeTerminalCommand(command, cwd, 120_000, props.threadId)
    platformLabel.value = result.platform
    entry.stdout = result.stdout.slice(-MAX_OUTPUT_CHARS)
    entry.stderr = result.stderr.slice(-MAX_OUTPUT_CHARS)
    entry.exitCode = result.exitCode
    entry.status = result.exitCode === 0 ? 'completed' : 'error'
    entry.durationMs = Date.now() - startedAt
  } catch (error) {
    entry.status = 'error'
    entry.error = error instanceof Error ? error.message : '终端命令请求失败'
    entry.stderr = entry.error
    entry.durationMs = Date.now() - startedAt
  } finally {
    isTerminalRunning.value = false
    await nextTick()
    commandInputRef.value?.focus()
  }
}

function formatEntryMeta(entry: TerminalEntry): string {
  if (entry.status === 'error') return `退出 ${String(entry.exitCode ?? 1)}`
  if (entry.exitCode === null) return ''
  const duration = typeof entry.durationMs === 'number' ? ` · ${formatDuration(entry.durationMs)}` : ''
  return `退出 ${String(entry.exitCode)}${duration}`
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${String(value)}ms`
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}s`
}

async function scrollChatToBottom(): Promise<void> {
  await nextTick()
  if (chatMessagesRef.value) chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight
}

async function scrollTerminalToBottom(): Promise<void> {
  await nextTick()
  if (terminalOutputRef.value) terminalOutputRef.value.scrollTop = terminalOutputRef.value.scrollHeight
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

.thread-side-panel-header,
.thread-side-panel-tabs,
.thread-side-chat-form-footer,
.thread-side-terminal-command-line,
.thread-side-terminal-form,
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
  font-size: 1rem;
  line-height: 1;
}

.thread-side-panel-tab-icon--terminal,
.thread-side-terminal-prompt,
.thread-side-terminal-form-prompt,
.thread-side-terminal-command-line code,
.thread-side-terminal-input,
.thread-side-terminal-output-text,
.thread-side-terminal-context code {
  font-family: var(--font-mono-ui);
}

.thread-side-chat,
.thread-side-terminal {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.thread-side-chat-messages,
.thread-side-terminal-output {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.thread-side-chat-messages {
  padding: 0.65rem;
}

.thread-side-chat-empty,
.thread-side-terminal-empty {
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

.thread-side-chat-empty strong,
.thread-side-terminal-empty strong {
  color: var(--ui-text-secondary);
  font-size: 0.76rem;
}

.thread-side-chat-empty-icon,
.thread-side-terminal-empty-icon {
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

.thread-side-chat-form {
  flex: 0 0 auto;
  padding: 0.55rem;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
}

.thread-side-chat-input {
  display: block;
  width: 100%;
  min-height: 4.2rem;
  resize: vertical;
  padding: 0.5rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  outline: none;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-size: 0.74rem;
  line-height: 1.45;
}

.thread-side-chat-input:focus,
.thread-side-terminal-input:focus {
  border-color: var(--ui-border-strong);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-border-strong) 18%, transparent);
}

.thread-side-chat-form-footer {
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.35rem;
}

.thread-side-chat-hint,
.thread-side-terminal-footer,
.thread-side-terminal-context,
.thread-side-terminal-entry-meta {
  color: var(--ui-text-tertiary);
  font-size: 0.62rem;
}

.thread-side-chat-send,
.thread-side-terminal-submit {
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
  cursor: pointer;
  font-size: 0.68rem;
  font-weight: 650;
}

.thread-side-chat-send {
  padding: 0.3rem 0.65rem;
}

.thread-side-chat-send:hover:not(:disabled),
.thread-side-chat-send:focus-visible,
.thread-side-terminal-submit:hover:not(:disabled),
.thread-side-terminal-submit:focus-visible {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-side-chat-send:disabled,
.thread-side-terminal-submit:disabled,
.thread-side-terminal-clear:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.thread-side-terminal-context {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem 0.35rem;
}

.thread-side-terminal-context code {
  overflow: hidden;
  color: var(--ui-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-side-terminal-output {
  padding: 0 0.65rem;
}

.thread-side-terminal-empty small {
  max-width: 17rem;
  color: var(--ui-text-tertiary);
  font-size: 0.6rem;
}

.thread-side-terminal-entry {
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.thread-side-terminal-entry:last-child {
  border-bottom: 0;
}

.thread-side-terminal-command-line {
  min-width: 0;
  gap: 0.35rem;
  align-items: baseline;
}

.thread-side-terminal-prompt,
.thread-side-terminal-form-prompt {
  flex: 0 0 auto;
  color: var(--ui-text-tertiary);
  font-size: 0.68rem;
}

.thread-side-terminal-command-line code {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-side-terminal-entry-meta {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 0.58rem;
}

.thread-side-terminal-entry[data-status='error'] .thread-side-terminal-entry-meta,
.thread-side-terminal-output-text.is-stderr {
  color: var(--ui-danger, #b42318);
}

.thread-side-terminal-output-text {
  max-height: 14rem;
  overflow: auto;
  margin: 0.4rem 0 0;
  padding: 0.45rem;
  border-radius: calc(var(--ui-radius-control) - 2px);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-secondary);
  font-size: 0.64rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.thread-side-terminal-entry-note {
  margin: 0.35rem 0 0;
  color: var(--ui-text-tertiary);
  font-size: 0.64rem;
}

.thread-side-terminal-form {
  gap: 0.35rem;
  flex: 0 0 auto;
  margin: 0.55rem 0.65rem 0.35rem;
  padding: 0.3rem 0.35rem;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
}

.thread-side-terminal-form-prompt {
  padding-left: 0.15rem;
}

.thread-side-terminal-input {
  width: 100%;
  min-width: 0;
  padding: 0.15rem 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-text-primary);
  font-size: 0.68rem;
}

.thread-side-terminal-input:focus {
  box-shadow: none;
}

.thread-side-terminal-submit {
  display: inline-flex;
  width: 1.55rem;
  height: 1.55rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 0.95rem;
  line-height: 1;
}

.thread-side-terminal-footer {
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.65rem 0.55rem;
}

.thread-side-terminal-clear {
  padding: 0.15rem 0.3rem;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font-size: 0.62rem;
}

@media (max-width: 1023px) {
  .thread-side-panel {
    position: absolute;
    z-index: 30;
    top: 0.5rem;
    right: 0.5rem;
    bottom: 0.5rem;
    width: min(92vw, 22rem);
    box-shadow: 0 18px 46px rgb(0 0 0 / 0.2);
  }
}
</style>
