<template>
  <section class="assistant-conversation" aria-label="助手主对话">
    <h2 class="assistant-conversation-heading">主对话</h2>

    <div v-if="mainThreadId" class="assistant-conversation-actions">
      <button
        id="assistant-open-conversation"
        type="button"
        class="assistant-conversation-button assistant-conversation-button--primary"
        @click="onOpenConversation"
      >
        进入主对话
      </button>
    </div>

    <p v-if="!connected" class="assistant-conversation-note" role="status">主对话尚未就绪。</p>
    <p v-else-if="!identity && !mainThreadId" class="assistant-conversation-note" role="status">
      主对话尚未就绪：请先保存助手身份。
    </p>

    <template v-if="!mainThreadId">
      <p v-if="reservationStateText" class="assistant-conversation-note" role="status">
        {{ reservationStateText }}
      </p>
      <p v-if="attemptOpen" class="assistant-conversation-hint">
        本次提交的记录已保留，不会自动重发。
      </p>

      <div v-if="formVisible" class="assistant-conversation-form">
        <label class="assistant-conversation-label" for="assistant-first-message">第一条消息</label>
        <textarea
          id="assistant-first-message"
          v-model="text"
          class="assistant-conversation-control"
          name="assistant-first-message"
          rows="3"
          :maxlength="MAX_MESSAGE_LENGTH"
          :disabled="formLocked"
          aria-describedby="assistant-first-message-hint"
        ></textarea>
        <p id="assistant-first-message-hint" class="assistant-conversation-hint">
          发送后可在主对话中继续交流。
        </p>
        <div v-if="!frozenRequest" class="assistant-conversation-actions">
          <button
            id="assistant-start-conversation"
            type="button"
            class="assistant-conversation-button assistant-conversation-button--primary"
            :disabled="!canSubmit"
            :aria-busy="submitting ? 'true' : undefined"
            @click="onStart"
          >
            {{ submitting ? '提交中' : '开始对话' }}
          </button>
        </div>
      </div>

      <div v-if="showCheck" class="assistant-conversation-actions">
        <button id="assistant-check-conversation" type="button" class="assistant-conversation-button" @click="onCheck">
          核对会话
        </button>
      </div>

      <p v-if="errorText" class="assistant-conversation-note assistant-conversation-note--alert" role="alert">
        {{ errorText }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  AssistantGatewayError,
  beginAssistantConversation,
  getAssistantState,
} from '../../api/assistantGateway'
import type { AssistantIdentity, AssistantState } from '../../api/assistantGateway'

const props = defineProps<{
  identity: AssistantIdentity | null
  connected: boolean
  mainConversation: AssistantState['mainConversation']
}>()

const emit = defineEmits<{
  (event: 'state', state: AssistantState): void
  (event: 'open-thread', threadId: string): void
}>()

const MAX_MESSAGE_LENGTH = 16000
const POLL_INTERVAL_MS = 1000
const MAX_POLL_READS = 30

interface FrozenRequest {
  revision: number
  clientMessageId: string
  text: string
}

const text = ref('')
const submitting = ref(false)
/** Frozen at the first explicit submit; a rejected request is never rewritten. */
const frozenRequest = ref<FrozenRequest | null>(null)
/** True once a submit ended without a confirmed conversation; offers GET check only. */
const attemptOpen = ref(false)
const errorText = ref('')

let submitController: AbortController | null = null
let pollController: AbortController | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollReads = 0
let readInFlight = false
let submitGeneration = 0
let pollGeneration = 0
let disposed = false

const mainThreadId = computed(
  () => props.identity?.mainThreadId || props.mainConversation?.threadId || null,
)

const formVisible = computed(
  () =>
    props.connected &&
    Boolean(props.identity) &&
    !mainThreadId.value &&
    !props.mainConversation,
)

const formLocked = computed(() => submitting.value || frozenRequest.value !== null)

const canSubmit = computed(
  () => formVisible.value && !formLocked.value && text.value.trim().length > 0,
)

const showCheck = computed(
  () => !mainThreadId.value && (Boolean(props.mainConversation) || attemptOpen.value),
)

const reservationStateText = computed(() => {
  if (mainThreadId.value) return ''
  const reservation = props.mainConversation
  if (reservation) {
    switch (reservation.status) {
      case 'pending_start':
      case 'starting':
        return '正在创建主对话。'
      case 'start_uncertain':
        return '结果待确认，请核对会话。'
      case 'failed':
        return '创建未完成。'
      default:
        return '正在确认主对话状态。'
    }
  }
  return attemptOpen.value ? '提交结果未确认，请核对会话。' : ''
})

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

function isRejectedRequest(error: unknown): boolean {
  return (
    error instanceof AssistantGatewayError && error.status >= 400 && error.status < 500
  )
}

function clearPoll(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  if (pollController) {
    pollController.abort()
    pollController = null
  }
  readInFlight = false
  pollGeneration += 1
}

function schedulePoll(token: number): void {
  if (disposed || token !== pollGeneration) return
  pollTimer = setTimeout(() => {
    pollTimer = null
    void pollOnce(token)
  }, POLL_INTERVAL_MS)
}

/** Bounded read-only confirmation; never posts and never outlives the window. */
function startPolling(immediate: boolean): void {
  if (disposed) return
  clearPoll()
  pollReads = 0
  const token = pollGeneration
  if (immediate) {
    void pollOnce(token)
    return
  }
  schedulePoll(token)
}

async function pollOnce(token: number): Promise<void> {
  if (disposed || token !== pollGeneration || readInFlight) return
  readInFlight = true
  const controller = new AbortController()
  pollController = controller
  let keepGoing = true
  try {
    const state = await getAssistantState({ signal: controller.signal })
    if (disposed || token !== pollGeneration) return
    emit('state', state)
    const threadId = state.data?.mainThreadId || state.mainConversation?.threadId || null
    const status = state.mainConversation?.status ?? null
    if (threadId || status === 'failed' || status === 'start_uncertain') keepGoing = false
  } catch (error) {
    if (disposed || token !== pollGeneration || isAbortError(error)) return
    errorText.value = `核对会话未成功：${describeError(error)}内容已保留，可稍后再次点击「核对会话」。`
    keepGoing = false
  } finally {
    readInFlight = false
    pollController = null
  }
  if (disposed || token !== pollGeneration || !keepGoing) return
  pollReads += 1
  if (pollReads >= MAX_POLL_READS) return
  schedulePoll(token)
}

async function onStart(): Promise<void> {
  const identity = props.identity
  if (!canSubmit.value || !identity) return
  submitting.value = true
  errorText.value = ''
  clearPoll()
  const request: FrozenRequest = frozenRequest.value ?? {
    revision: identity.revision,
    clientMessageId: crypto.randomUUID(),
    text: text.value.trim(),
  }
  frozenRequest.value = request
  const token = ++submitGeneration
  const controller = new AbortController()
  submitController = controller
  try {
    const state = await beginAssistantConversation(
      {
        revision: request.revision,
        clientMessageId: request.clientMessageId,
        text: request.text,
      },
      { signal: controller.signal },
    )
    if (disposed || token !== submitGeneration) return
    emit('state', state)
    const threadId = state.data?.mainThreadId || state.mainConversation?.threadId || null
    if (!threadId) startPolling(false)
  } catch (error) {
    if (disposed || token !== submitGeneration || isAbortError(error)) return
    attemptOpen.value = true
    errorText.value = isRejectedRequest(error)
      ? `开始对话未成功：${describeError(error)}内容已保留，不会自动重发。`
      : `提交结果未确认：${describeError(error)}内容已保留，请点击「核对会话」确认。`
  } finally {
    if (token === submitGeneration) {
      submitting.value = false
      submitController = null
    }
  }
}

function onCheck(): void {
  if (disposed || submitting.value) return
  errorText.value = ''
  attemptOpen.value = true
  startPolling(true)
}

function onOpenConversation(): void {
  const threadId = mainThreadId.value
  if (threadId) emit('open-thread', threadId)
}

// Keyed only on the reservation's clientMessageId: repeated state emissions for
// the same reservation must not restart the bounded poll window.
watch(
  () => (props.connected && !mainThreadId.value ? props.mainConversation?.clientMessageId : undefined),
  (id) => {
    if (id) startPolling(true)
    else clearPoll()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  disposed = true
  submitGeneration += 1
  clearPoll()
  if (submitController) {
    submitController.abort()
    submitController = null
  }
})
</script>

<style scoped>
.assistant-conversation {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
  color: var(--ui-text-primary);
  font-size: 13px;
  line-height: 1.5;
}

.assistant-conversation-heading {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ui-text-primary);
}

.assistant-conversation-note {
  margin: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ui-text-secondary);
  overflow-wrap: anywhere;
}

.assistant-conversation-note--alert {
  color: var(--ui-text-primary);
}

.assistant-conversation-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  max-width: 30rem;
}

.assistant-conversation-label {
  font-size: 11.5px;
  line-height: 1.2;
  color: var(--ui-text-tertiary);
}

.assistant-conversation-control {
  box-sizing: border-box;
  width: 100%;
  min-height: 88px;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

.assistant-conversation-control:hover,
.assistant-conversation-control:focus-visible {
  background: var(--ui-bg-surface-muted);
}

.assistant-conversation-control:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.assistant-conversation-control:disabled,
.assistant-conversation-control:disabled:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
}

.assistant-conversation-hint {
  margin: 0;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ui-text-tertiary);
  overflow-wrap: anywhere;
}

.assistant-conversation-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.assistant-conversation-button {
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

.assistant-conversation-button:hover,
.assistant-conversation-button:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
}

.assistant-conversation-button:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.assistant-conversation-button--primary {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-weight: 600;
}

.assistant-conversation-button--primary:hover,
.assistant-conversation-button--primary:focus-visible {
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
}

.assistant-conversation-button:disabled,
.assistant-conversation-button:disabled:hover {
  cursor: default;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
  font-weight: 500;
}

@media (max-width: 480px) {
  .assistant-conversation-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .assistant-conversation-button {
    width: 100%;
  }

  .assistant-conversation-form {
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-conversation-control,
  .assistant-conversation-button {
    transition: none;
  }
}
</style>
