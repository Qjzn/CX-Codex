<template>
  <section class="assistant-page" aria-label="助手">
    <p v-if="loading" class="assistant-page-note" role="status">正在读取助手身份…</p>
    <p v-else-if="saving && rereading" class="assistant-page-note" role="status">正在重新读取助手身份…</p>
    <p v-else-if="saving" class="assistant-page-note" role="status">正在保存助手身份…</p>

    <section v-if="savedIdentity" class="assistant-page-block" aria-labelledby="assistant-saved-heading">
      <h2 id="assistant-saved-heading" class="assistant-page-heading">已保存的身份</h2>
      <dl class="assistant-page-summary">
        <div class="assistant-page-summary-row">
          <dt class="assistant-page-summary-label">助手名称</dt>
          <dd class="assistant-page-summary-value">{{ savedIdentity.name }}</dd>
        </div>
        <div class="assistant-page-summary-row">
          <dt class="assistant-page-summary-label">工作区</dt>
          <dd class="assistant-page-summary-value" :title="savedIdentity.cwd">{{ savedIdentity.cwd }}</dd>
        </div>
      </dl>
      <p class="assistant-page-note">
        身份已保存；{{ capabilities.conversation ? '主对话使用受限协调角色。' : '主对话尚未接入。' }}
      </p>
    </section>

    <p v-else-if="authorityKnown && !loading" class="assistant-page-note">
      未设置助手。填写名称并选择已配置的工作区后，可保存助手身份。
    </p>

    <AssistantConversationEntry
      :identity="savedIdentity"
      :connected="capabilities.conversation"
      :main-conversation="mainConversation"
      @state="onConversationState"
      @open-thread="emit('open-thread', $event)"
    />

    <section class="assistant-page-block" aria-labelledby="assistant-tasks-heading">
      <h2 id="assistant-tasks-heading" class="assistant-page-heading">派发任务</h2>
      <div class="assistant-page-actions">
        <button
          id="assistant-refresh-tasks"
          type="button"
          class="assistant-page-button"
          :disabled="loading || saving"
          :aria-busy="loading ? 'true' : undefined"
          @click="onRefreshTasks"
        >
          刷新
        </button>
      </div>
      <p v-if="taskRows.length === 0" class="assistant-page-note">暂无派发任务</p>
      <div v-else class="assistant-page-summary">
        <div v-for="task in taskRows" :key="task.key" class="assistant-page-summary-row">
          <div class="assistant-page-summary-value">
            <p class="assistant-page-note">{{ task.title }}</p>
            <p class="assistant-page-hint">{{ task.statusLabel }} · 只读文本分析</p>
            <p v-if="task.reportLabel" class="assistant-page-hint">{{ task.reportLabel }}</p>
            <p v-if="task.stopRequested" class="assistant-page-hint">
              已请求停止；服务端确认前该任务仍可能继续。
            </p>
            <p v-if="task.requiresReview" class="assistant-page-hint">
              需要人工复核后再采用结果。
            </p>
            <button
              v-if="task.threadId"
              type="button"
              class="assistant-page-button"
              @click="emit('open-worker-thread', task.threadId)"
            >
              查看执行记录
            </button>
          </div>
        </div>
      </div>
    </section>

    <p v-if="alertText" class="assistant-page-note assistant-page-note--alert" role="alert">{{ alertText }}</p>

    <div v-if="!authorityKnown && !loading" class="assistant-page-block">
      <p class="assistant-page-note">还没有读到服务端当前的助手身份，保存已停用。</p>
      <div class="assistant-page-actions">
        <button
          id="assistant-retry-read"
          type="button"
          class="assistant-page-button"
          :disabled="loading || saving"
          @click="onRetryRead"
        >
          重试读取
        </button>
      </div>
    </div>

    <form class="assistant-page-form" @submit.prevent="onSubmit">
      <h2 id="assistant-form-heading" class="assistant-page-heading">
        {{ savedIdentity ? '编辑助手身份' : '设置助手身份' }}
      </h2>

      <div class="assistant-page-field">
        <label class="assistant-page-label" for="assistant-name">助手名称</label>
        <input
          id="assistant-name"
          v-model="draftName"
          class="assistant-page-control"
          type="text"
          name="assistant-name"
          maxlength="80"
          autocomplete="off"
          spellcheck="false"
          :disabled="saving"
          @input="draftDirty = true"
        />
      </div>

      <div class="assistant-page-field">
        <label class="assistant-page-label" for="assistant-workspace">工作区</label>
        <select
          id="assistant-workspace"
          v-model="draftCwd"
          class="assistant-page-control"
          name="assistant-workspace"
          :disabled="saving || workspaceLocked"
          @change="draftDirty = true"
        >
          <option value="" disabled>请选择工作区</option>
          <option v-if="draftCwdNotConfigured" :value="draftCwd" disabled>
            {{ draftCwd }}（当前已保存，不在可选列表）
          </option>
          <option v-for="workspace in allowedWorkspaces" :key="workspace" :value="workspace">{{ workspace }}</option>
        </select>
        <p v-if="draftCwdNotConfigured" class="assistant-page-hint">
          当前身份记录的工作区不在服务端给出的可选列表中，改选列表中的工作区后即可保存。
        </p>
        <p v-else-if="allowedWorkspaces.length === 0" class="assistant-page-hint">
          请先在现有会话入口配置工作区，再重新打开此页。
        </p>
        <p v-if="workspaceLocked" class="assistant-page-hint">
          主对话已绑定工作区，暂时不能更换。
        </p>
      </div>

      <p v-if="invalidReason" class="assistant-page-hint">{{ invalidReason }}</p>

      <div class="assistant-page-actions">
        <button
          id="assistant-save"
          type="submit"
          class="assistant-page-button assistant-page-button--primary"
          :disabled="!canSave"
          :aria-busy="saving ? 'true' : undefined"
        >
          {{ saving ? '保存中' : '保存助手' }}
        </button>
        <button id="assistant-open-board" type="button" class="assistant-page-button" @click="onOpenBoard">
          打开任务看板
        </button>
      </div>

      <p v-if="saveError" class="assistant-page-note assistant-page-note--alert" role="alert">{{ saveError }}</p>
      <p v-if="statusMessage" class="assistant-page-note" role="status">{{ statusMessage }}</p>
    </form>

    <section class="assistant-page-block" aria-labelledby="assistant-capabilities-heading">
      <h2 id="assistant-capabilities-heading" class="assistant-page-heading">功能状态</h2>
      <dl class="assistant-page-capabilities">
        <div v-for="row in capabilityRows" :key="row.label" class="assistant-page-capability-row">
          <dt class="assistant-page-capability-label">{{ row.label }}</dt>
          <dd class="assistant-page-capability-value">{{ row.connected ? '已接入' : '未接入' }}</dd>
        </div>
      </dl>
      <p class="assistant-page-note">{{ capabilityNote }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  AssistantGatewayError,
  getAssistantState,
  saveAssistantIdentity,
} from '../../api/assistantGateway'
import type { AssistantIdentity, AssistantState, AssistantTaskSummary } from '../../api/assistantGateway'
import AssistantConversationEntry from './AssistantConversationEntry.vue'

const emit = defineEmits<{
  (event: 'open-board'): void
  (event: 'open-thread', threadId: string): void
  (event: 'open-worker-thread', threadId: string): void
}>()

const MAX_NAME_LENGTH = 80

/** Authoritative server state; a draft edit never overwrites it. */
const savedIdentity = ref<AssistantIdentity | null>(null)
const allowedWorkspaces = ref<string[]>([])
const capabilities = ref<{
  conversation: boolean
  dispatch: boolean
  backgroundExecution: boolean
  resultReturn?: boolean
}>({
  conversation: false,
  dispatch: false,
  backgroundExecution: false,
  resultReturn: false,
})

/** Read-only dispatches reported by the server; this page never dispatches one. */
const tasks = ref<AssistantTaskSummary[]>([])

/** Main-conversation reservation reported by the server; null when none. */
const mainConversation = ref<AssistantState['mainConversation']>(null)

/** Editing draft; survives every failed request and every re-read. */
const draftName = ref('')
const draftCwd = ref('')
const draftDirty = ref(false)

const loading = ref(false)
const saving = ref(false)
const rereading = ref(false)
const authorityKnown = ref(false)

const readError = ref('')
const saveError = ref('')
const conflictNotice = ref('')
const statusMessage = ref('')

/** Monotonic operation token: a late response from an older operation is dropped. */
let generation = 0
let activeController: AbortController | null = null
let disposed = false

const trimmedDraftName = computed(() => draftName.value.trim())
const trimmedDraftCwd = computed(() => draftCwd.value.trim())

const draftCwdNotConfigured = computed(() => {
  const cwd = trimmedDraftCwd.value
  return Boolean(cwd) && !allowedWorkspaces.value.includes(cwd)
})

/** The workspace is fixed once the main conversation exists or is reserved. */
const workspaceLocked = computed(
  () => Boolean(mainConversation.value) || Boolean(savedIdentity.value?.mainThreadId),
)

const invalidReason = computed(() => {
  if (!authorityKnown.value) return ''
  if (!trimmedDraftName.value) return '填写助手名称后即可保存。'
  if (trimmedDraftName.value.length > MAX_NAME_LENGTH) {
    return `助手名称不能超过 ${MAX_NAME_LENGTH} 个字符。`
  }
  if (allowedWorkspaces.value.length === 0) return '服务端未提供可选工作区，暂时无法保存。'
  if (!trimmedDraftCwd.value) return '选择工作区后即可保存。'
  if (!allowedWorkspaces.value.includes(trimmedDraftCwd.value)) {
    return '请选择可选列表中的工作区后再保存。'
  }
  return ''
})

const canSave = computed(
  () =>
    authorityKnown.value &&
    !loading.value &&
    !saving.value &&
    invalidReason.value === '',
)

/** One alert slot: the most urgent message wins, never a stale reassurance. */
const alertText = computed(() => readError.value || conflictNotice.value)

const capabilityRows = computed(() => [
  { label: '主对话', connected: capabilities.value.conversation },
  { label: '任务派发', connected: capabilities.value.dispatch },
  { label: '后台执行', connected: capabilities.value.backgroundExecution },
  { label: '结果回传', connected: capabilities.value.resultReturn === true },
])

/** Honest copy: only what the server reports is offered, never more. */
const capabilityNote = computed(() => {
  if (capabilities.value.dispatch) {
    return capabilities.value.resultReturn === true
      ? '目前支持只读文本分析；通过主对话派发，刷新查看状态。任务结果将回到主对话。'
      : '目前支持只读文本分析；通过主对话派发，刷新查看状态。结果回传尚未开启。'
  }
  if (capabilities.value.conversation) {
    return '主对话已接入；此主对话尚未启用任务派发。'
  }
  return '本页只读取和保存身份，不发起对话、不派发任务，也不在后台执行任何内容。'
})

type TaskRow = {
  key: string
  title: string
  statusLabel: string
  reportLabel: string
  stopRequested: boolean
  requiresReview: boolean
  threadId: AssistantTaskSummary['threadId']
}

const TASK_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  pending: '等待中',
  pending_start: '准备中',
  starting: '准备中',
  start_uncertain: '待核对',
  interrupt_uncertain: '待核对',
  unknown: '待核对',
  verifying: '核对完成状态中',
  running: '执行中',
  in_progress: '执行中',
  stopping: '正在停止',
  stop_requested: '已请求停止',
  stopped: '已停止',
  completed: '已完成',
  succeeded: '已完成',
  failed: '未成功',
  cancelled: '已取消',
  canceled: '已取消',
}

/** Read-only projection of a server summary; nothing here mutates a task. */
const taskRows = computed<TaskRow[]>(() =>
  tasks.value.map((task) => ({
    key: task.taskId,
    title: task.title,
    statusLabel: TASK_STATUS_LABELS[task.executionStatus] ?? '状态未知',
    reportLabel: task.reportStatus === 'delivered' ? '已回传主对话' : task.reportStatus === 'pending' ? '等待主对话汇总' : task.reportStatus === 'attention' || task.reportStatus === 'unknown' ? '回传待核对，请勿重复派发' : '',
    stopRequested: task.stopRequested,
    requiresReview: task.requiresReview,
    threadId: task.threadId,
  })),
)

function onRefreshTasks(): void {
  if (loading.value || saving.value) return
  void loadAuthoritativeState({ reread: true })
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = typeof error.message === 'string' ? error.message.trim() : ''
    if (message) {
      return /[。！？]$/u.test(message) ? message : `${message}。`
    }
  }
  return '请求没有成功。'
}

function workspaceLabel(value: string): string {
  const normalized = String(value ?? '')
    .replace(/\\/gu, '/')
    .replace(/\/+$/u, '')
  const segment = normalized.split('/').filter(Boolean).pop()
  return segment ?? normalized
}

function abortActive(): void {
  if (activeController) {
    activeController.abort()
    activeController = null
  }
}

/** Starts a new operation and cancels whichever request it replaces. */
function beginOperation(): number {
  generation += 1
  abortActive()
  return generation
}

function isCurrent(token: number): boolean {
  return !disposed && token === generation
}

type DraftPolicy = 'adopt' | 'adopt-if-clean'

function applyAuthoritativeState(state: AssistantState, draftPolicy: DraftPolicy): void {
  savedIdentity.value = state.data
  allowedWorkspaces.value = Array.isArray(state.allowedWorkspaces)
    ? [...state.allowedWorkspaces]
    : []
  const stateTasks = (state as AssistantState & { tasks?: AssistantTaskSummary[] | null }).tasks
  tasks.value = Array.isArray(stateTasks) ? [...stateTasks] : []
  const stateCapabilities = state.capabilities as AssistantState['capabilities'] & {
    resultReturn?: boolean
  }
  capabilities.value = {
    conversation: stateCapabilities.conversation,
    dispatch: stateCapabilities.dispatch,
    backgroundExecution: stateCapabilities.backgroundExecution,
    resultReturn: stateCapabilities.resultReturn === true,
  }
  authorityKnown.value = true
  readError.value = ''
  mainConversation.value = state.mainConversation ?? null
  if (draftPolicy === 'adopt' || !draftDirty.value) {
    draftName.value = state.data ? state.data.name : ''
    draftCwd.value = state.data ? state.data.cwd : ''
    draftDirty.value = false
  }
}

async function loadAuthoritativeState(options: { reread?: boolean } = {}): Promise<void> {
  if (disposed) return
  const token = beginOperation()
  const controller = new AbortController()
  activeController = controller
  loading.value = true
  readError.value = ''
  try {
    const state = await getAssistantState({ signal: controller.signal })
    if (!isCurrent(token)) return
    applyAuthoritativeState(state, 'adopt-if-clean')
    if (options.reread) {
      statusMessage.value = '已重新读取助手身份。'
      if (conflictNotice.value) {
        conflictNotice.value =
          '保存冲突：助手配置已在其他会话更新。已重新读取服务端身份，你的草稿已保留，请确认后再次点击「保存助手」。'
      }
    }
  } catch (error) {
    if (!isCurrent(token) || isAbortError(error)) return
    authorityKnown.value = false
    readError.value = `助手配置读取未成功：${describeError(error)}在读取成功前不能保存。`
  } finally {
    if (isCurrent(token)) loading.value = false
  }
}

function onRetryRead(): void {
  if (loading.value || saving.value) return
  void loadAuthoritativeState({ reread: true })
}

async function handleConflict(token: number): Promise<void> {
  conflictNotice.value =
    '保存冲突：助手配置已在其他会话更新，你的草稿已保留。正在重新读取服务端身份…'
  rereading.value = true
  const controller = new AbortController()
  activeController = controller
  try {
    const state = await getAssistantState({ signal: controller.signal })
    if (!isCurrent(token)) return
    applyAuthoritativeState(state, 'adopt-if-clean')
    conflictNotice.value =
      '保存冲突：助手配置已在其他会话更新。已重新读取服务端身份，你的草稿已保留，请确认后再次点击「保存助手」。'
  } catch (error) {
    if (!isCurrent(token) || isAbortError(error)) return
    authorityKnown.value = false
    conflictNotice.value =
      '保存冲突：助手配置已在其他会话更新，你的草稿已保留；重新读取服务端身份未成功，需要先重试读取。'
    readError.value = `保存冲突后重新读取助手配置未成功：${describeError(error)}草稿已保留，在读取成功前不能保存。`
  } finally {
    if (isCurrent(token)) rereading.value = false
  }
}

async function saveIdentity(): Promise<void> {
  if (disposed) return
  const token = beginOperation()
  const controller = new AbortController()
  activeController = controller
  saving.value = true
  rereading.value = false
  saveError.value = ''
  conflictNotice.value = ''
  statusMessage.value = ''

  const name = trimmedDraftName.value
  const cwd = trimmedDraftCwd.value
  // First save carries no revision; every later save carries the revision the
  // server last confirmed.
  const revision = savedIdentity.value ? savedIdentity.value.revision : null

  try {
    const state = await saveAssistantIdentity(
      { name, cwd, revision },
      { signal: controller.signal },
    )
    if (!isCurrent(token)) return
    applyAuthoritativeState(state, 'adopt')
    const savedName = state.data ? state.data.name : name
    const savedCwd = state.data ? state.data.cwd : cwd
    statusMessage.value = `已保存助手身份：${savedName}，工作区 ${workspaceLabel(savedCwd)}。`
  } catch (error) {
    if (!isCurrent(token) || isAbortError(error)) return
    if (error instanceof AssistantGatewayError && error.status === 409) {
      await handleConflict(token)
      return
    }
    saveError.value = `保存未成功：${describeError(error)}已保存的身份和当前填写的内容都保留着，修正后可以重新保存。`
  } finally {
    if (isCurrent(token)) {
      saving.value = false
      rereading.value = false
    }
  }
}

function onSubmit(): void {
  if (!canSave.value || saving.value) return
  void saveIdentity()
}

function onOpenBoard(): void {
  emit('open-board')
}

/** Child-reported authoritative state; the edited identity draft is preserved. */
function onConversationState(state: AssistantState): void {
  applyAuthoritativeState(state, 'adopt-if-clean')
}

onMounted(() => {
  void loadAuthoritativeState()
})

onBeforeUnmount(() => {
  disposed = true
  generation += 1
  abortActive()
})
</script>

<style scoped>
.assistant-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 720px;
  min-width: 0;
  margin: 0 auto;
  padding: 1rem;
  color: var(--ui-text-primary);
  font-size: 13px;
  line-height: 1.5;
}

.assistant-page-block,
.assistant-page-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.assistant-page-heading {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ui-text-primary);
}

.assistant-page-note {
  margin: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ui-text-secondary);
  overflow-wrap: anywhere;
}

.assistant-page-note--alert {
  color: var(--ui-text-primary);
}

.assistant-page-summary,
.assistant-page-capabilities {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  min-width: 0;
}

.assistant-page-summary-row,
.assistant-page-capability-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
  min-width: 0;
}

.assistant-page-summary-label,
.assistant-page-capability-label {
  flex: 0 0 4.5rem;
  min-width: 0;
  font-size: 11.5px;
  color: var(--ui-text-tertiary);
}

.assistant-page-summary-value {
  flex: 1 1 12rem;
  margin: 0;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ui-text-primary);
  overflow-wrap: anywhere;
}

.assistant-page-capability-value {
  flex: 1 1 12rem;
  margin: 0;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ui-text-secondary);
}

.assistant-page-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  max-width: 30rem;
}

.assistant-page-label {
  font-size: 11.5px;
  line-height: 1.2;
  color: var(--ui-text-tertiary);
}

.assistant-page-control {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 0.625rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.2;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

.assistant-page-control:hover,
.assistant-page-control:focus-visible {
  background: var(--ui-bg-surface-muted);
}

.assistant-page-control:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.assistant-page-control:disabled,
.assistant-page-control:disabled:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
}

.assistant-page-hint {
  margin: 0;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ui-text-tertiary);
  overflow-wrap: anywhere;
}

.assistant-page-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.assistant-page-button {
  box-sizing: border-box;
  min-height: 44px;
  min-width: 96px;
  padding: 0 0.875rem;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color 150ms ease-out, background-color 150ms ease-out,
    color 150ms ease-out;
}

.assistant-page-button:hover,
.assistant-page-button:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
}

.assistant-page-button:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.assistant-page-button--primary {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-weight: 600;
}

.assistant-page-button--primary:hover,
.assistant-page-button--primary:focus-visible {
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
}

.assistant-page-button:disabled,
.assistant-page-button:disabled:hover {
  cursor: default;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
}

.assistant-page-button--primary:disabled {
  font-weight: 500;
}

@media (max-width: 480px) {
  .assistant-page-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .assistant-page-button {
    width: 100%;
  }

  .assistant-page-field {
    max-width: none;
  }

  .assistant-page-summary-label,
  .assistant-page-capability-label {
    flex: 0 0 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-page-control,
  .assistant-page-button {
    transition: none;
  }
}
</style>
