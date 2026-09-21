<template>
  <section class="sidebar-terminal" aria-label="侧栏终端">
    <header class="sidebar-terminal-header">
      <div class="sidebar-terminal-heading">
        <span class="sidebar-terminal-icon-wrap" aria-hidden="true">
          <IconTablerTerminal class="sidebar-terminal-icon" />
        </span>
        <div class="sidebar-terminal-heading-copy">
          <h2 class="sidebar-terminal-title">终端</h2>
          <p class="sidebar-terminal-subtitle">在当前工作区执行命令</p>
        </div>
      </div>
      <button
        class="sidebar-terminal-clear-button"
        type="button"
        :disabled="entries.length === 0 || isRunning"
        aria-label="清空终端历史"
        title="清空终端历史"
        @click="clearHistory"
      >
        清空
      </button>
    </header>

    <label class="sidebar-terminal-cwd-field">
      <span class="sidebar-terminal-cwd-label">工作目录</span>
      <input
        v-model="cwdInput"
        class="sidebar-terminal-cwd-input"
        type="text"
        spellcheck="false"
        placeholder="使用当前会话目录"
        :disabled="isRunning"
      />
    </label>

    <div ref="outputRef" class="sidebar-terminal-output" aria-live="polite">
      <div v-if="orderedEntries.length === 0" class="sidebar-terminal-empty">
        <IconTablerTerminal class="sidebar-terminal-empty-icon" aria-hidden="true" />
        <strong>还没有命令</strong>
        <span>输入命令后按 Enter 执行。</span>
        <span class="sidebar-terminal-empty-hint">命令通过 Codex App Server 沙箱执行。</span>
      </div>

      <article
        v-for="entry in orderedEntries"
        :key="entry.id"
        class="sidebar-terminal-entry"
        :data-status="entry.status"
      >
        <div class="sidebar-terminal-command-line">
          <span class="sidebar-terminal-prompt" aria-hidden="true">{{ promptLabel }}</span>
          <code class="sidebar-terminal-command">{{ entry.command }}</code>
          <span class="sidebar-terminal-entry-meta">
            {{ entry.status === 'running' ? '执行中…' : formatEntryMeta(entry) }}
          </span>
        </div>
        <pre v-if="entry.stdout" class="sidebar-terminal-output-text">{{ entry.stdout }}</pre>
        <pre v-if="entry.stderr" class="sidebar-terminal-output-text sidebar-terminal-output-text--stderr">{{ entry.stderr }}</pre>
        <p v-if="entry.status === 'error' && !entry.stderr" class="sidebar-terminal-entry-error">
          {{ entry.error || '命令执行失败' }}
        </p>
        <p v-if="entry.status === 'running'" class="sidebar-terminal-entry-running">正在等待命令输出…</p>
      </article>
    </div>

    <form class="sidebar-terminal-form" @submit.prevent="runCommand">
      <span class="sidebar-terminal-form-prompt" aria-hidden="true">{{ promptLabel }}</span>
      <input
        ref="commandInputRef"
        v-model="commandInput"
        class="sidebar-terminal-command-input"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :placeholder="isRunning ? '命令执行中…' : '输入命令，例如 git status'"
        :disabled="isRunning"
        aria-label="输入终端命令"
        @keydown="onCommandKeydown"
      />
      <button
        class="sidebar-terminal-submit"
        type="submit"
        :disabled="isRunning || commandInput.trim().length === 0"
        aria-label="执行命令"
        title="执行命令"
      >
        ↵
      </button>
    </form>
    <p class="sidebar-terminal-footnote">
      ↑ / ↓ 浏览历史 · 单条命令最长 5 分钟
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { executeTerminalCommand } from '../../api/codexGateway'
import IconTablerTerminal from '../icons/IconTablerTerminal.vue'

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

const props = withDefaults(defineProps<{ cwd?: string }>(), { cwd: '' })

const STORAGE_KEY = 'codex-web-local.sidebar-terminal.v1'
const MAX_ENTRIES = 30
const MAX_OUTPUT_CHARS = 24_000
const commandInput = ref('')
const cwdInput = ref(props.cwd.trim())
const entries = ref<TerminalEntry[]>(loadEntries())
const isRunning = ref(false)
const historyCursor = ref(-1)
const commandInputRef = ref<HTMLInputElement | null>(null)
const outputRef = ref<HTMLElement | null>(null)

const orderedEntries = computed(() => [...entries.value].reverse())
const platformLabel = ref('')
const promptLabel = computed(() => platformLabel.value === 'win32' ? 'PS>' : '$')

watch(() => props.cwd, (value) => {
  cwdInput.value = value.trim()
})

watch(entries, () => {
  persistEntries()
  void scrollOutputToBottom()
}, { deep: true })

onMounted(() => {
  void scrollOutputToBottom()
  commandInputRef.value?.focus()
})

function loadEntries(): TerminalEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is Partial<TerminalEntry> => value !== null && typeof value === 'object')
      .map((value) => ({
        id: typeof value.id === 'string' ? value.id : createId(),
        command: typeof value.command === 'string' ? value.command : '',
        cwd: typeof value.cwd === 'string' ? value.cwd : '',
        stdout: typeof value.stdout === 'string' ? value.stdout.slice(-MAX_OUTPUT_CHARS) : '',
        stderr: typeof value.stderr === 'string' ? value.stderr.slice(-MAX_OUTPUT_CHARS) : '',
        exitCode: typeof value.exitCode === 'number' ? value.exitCode : null,
        status: value.status === 'completed' || value.status === 'error' ? value.status : 'completed',
        error: typeof value.error === 'string' ? value.error : '',
        startedAtIso: typeof value.startedAtIso === 'string' ? value.startedAtIso : new Date().toISOString(),
        durationMs: typeof value.durationMs === 'number' ? value.durationMs : null,
      }))
      .filter((value) => value.command.trim().length > 0)
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function persistEntries(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value.slice(0, MAX_ENTRIES)))
  } catch {
    // Local storage may be unavailable in a private or embedded WebView.
  }
}

function createId(): string {
  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function clearHistory(): void {
  if (isRunning.value) return
  entries.value = []
}

function onCommandKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp' && !event.shiftKey) {
    event.preventDefault()
    const commands = entries.value.map((entry) => entry.command)
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
    commandInput.value = entries.value[historyCursor.value]?.command ?? ''
  }
}

async function runCommand(): Promise<void> {
  const command = commandInput.value.trim()
  if (!command || isRunning.value) return
  const cwd = cwdInput.value.trim()
  const startedAt = Date.now()
  const entry: TerminalEntry = {
    id: createId(),
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
  entries.value = [entry, ...entries.value].slice(0, MAX_ENTRIES)
  commandInput.value = ''
  historyCursor.value = -1
  isRunning.value = true

  try {
    const result = await executeTerminalCommand(command, cwd, 120_000)
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
    isRunning.value = false
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

async function scrollOutputToBottom(): Promise<void> {
  await nextTick()
  if (outputRef.value) outputRef.value.scrollTop = outputRef.value.scrollHeight
}
</script>

<style scoped>
.sidebar-terminal {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.35rem 0.25rem 0.25rem;
  color: var(--ui-text-primary);
}

.sidebar-terminal-header,
.sidebar-terminal-heading,
.sidebar-terminal-command-line,
.sidebar-terminal-form {
  display: flex;
  align-items: center;
}

.sidebar-terminal-header {
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.15rem 0.35rem 0;
}

.sidebar-terminal-heading {
  min-width: 0;
  gap: 0.55rem;
}

.sidebar-terminal-icon-wrap {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-row-active);
  color: var(--ui-text-secondary);
}

.sidebar-terminal-icon {
  width: 1rem;
  height: 1rem;
}

.sidebar-terminal-heading-copy {
  min-width: 0;
}

.sidebar-terminal-title,
.sidebar-terminal-subtitle {
  margin: 0;
}

.sidebar-terminal-title {
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
}

.sidebar-terminal-subtitle {
  margin-top: 0.15rem;
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font-size: 0.68rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-terminal-clear-button,
.sidebar-terminal-submit {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.sidebar-terminal-clear-button {
  flex: 0 0 auto;
  padding: 0.3rem 0.45rem;
  border-radius: var(--ui-radius-control);
  font-size: 0.68rem;
}

.sidebar-terminal-clear-button:hover:not(:disabled),
.sidebar-terminal-clear-button:focus-visible,
.sidebar-terminal-submit:hover:not(:disabled),
.sidebar-terminal-submit:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.sidebar-terminal-clear-button:disabled,
.sidebar-terminal-submit:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.sidebar-terminal-cwd-field {
  display: grid;
  gap: 0.25rem;
  padding: 0 0.35rem;
}

.sidebar-terminal-cwd-label,
.sidebar-terminal-footnote {
  color: var(--ui-text-tertiary);
  font-size: 0.65rem;
}

.sidebar-terminal-cwd-input,
.sidebar-terminal-command-input {
  min-width: 0;
  border: 1px solid var(--ui-border-subtle);
  outline: none;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sidebar-terminal-cwd-input {
  width: 100%;
  padding: 0.38rem 0.5rem;
  border-radius: var(--ui-radius-control);
  font-size: 0.68rem;
}

.sidebar-terminal-cwd-input:focus,
.sidebar-terminal-command-input:focus {
  border-color: var(--ui-border-strong);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-border-strong) 18%, transparent);
}

.sidebar-terminal-output {
  min-height: 7rem;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface);
  scrollbar-width: thin;
}

.sidebar-terminal-empty {
  min-height: 11rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1.2rem 0.75rem;
  color: var(--ui-text-tertiary);
  text-align: center;
  font-size: 0.72rem;
}

.sidebar-terminal-empty strong {
  color: var(--ui-text-secondary);
  font-size: 0.78rem;
}

.sidebar-terminal-empty-icon {
  width: 1.4rem;
  height: 1.4rem;
  margin-bottom: 0.15rem;
  color: var(--ui-text-secondary);
}

.sidebar-terminal-empty-hint {
  max-width: 15rem;
  color: var(--ui-text-tertiary);
  font-size: 0.62rem;
  line-height: 1.45;
}

.sidebar-terminal-entry {
  padding: 0.55rem 0.35rem 0.65rem;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.sidebar-terminal-entry:last-child {
  border-bottom: 0;
}

.sidebar-terminal-command-line {
  min-width: 0;
  gap: 0.4rem;
  align-items: baseline;
}

.sidebar-terminal-prompt,
.sidebar-terminal-form-prompt {
  flex: 0 0 auto;
  color: var(--ui-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
}

.sidebar-terminal-command {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-terminal-entry-meta {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--ui-text-tertiary);
  font-size: 0.6rem;
}

.sidebar-terminal-entry[data-status='error'] .sidebar-terminal-entry-meta {
  color: var(--ui-danger, #b42318);
}

.sidebar-terminal-output-text {
  max-height: 15rem;
  overflow: auto;
  margin: 0.42rem 0 0;
  padding: 0.45rem 0.5rem;
  border-radius: calc(var(--ui-radius-control) - 2px);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.66rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.sidebar-terminal-output-text--stderr,
.sidebar-terminal-entry-error {
  color: var(--ui-danger, #b42318);
}

.sidebar-terminal-entry-running,
.sidebar-terminal-entry-error {
  margin: 0.4rem 0 0;
  font-size: 0.66rem;
  line-height: 1.4;
}

.sidebar-terminal-entry-running {
  color: var(--ui-text-tertiary);
}

.sidebar-terminal-form {
  gap: 0.4rem;
  padding: 0.35rem;
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface);
}

.sidebar-terminal-form-prompt {
  padding-left: 0.15rem;
}

.sidebar-terminal-command-input {
  width: 100%;
  padding: 0.22rem 0;
  border: 0;
  background: transparent;
  font-size: 0.72rem;
}

.sidebar-terminal-command-input:focus {
  border: 0;
  box-shadow: none;
}

.sidebar-terminal-command-input::placeholder {
  color: var(--ui-text-tertiary);
}

.sidebar-terminal-submit {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: var(--ui-radius-control);
  font-size: 1rem;
  line-height: 1;
}

.sidebar-terminal-footnote {
  margin: -0.25rem 0 0;
  padding: 0 0.35rem;
  line-height: 1.35;
}
</style>
