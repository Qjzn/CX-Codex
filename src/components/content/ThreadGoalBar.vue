<template>
  <section class="thread-goal" :data-state="goal?.status || 'empty'" aria-label="持续目标">
    <div v-if="isLoading && !goal" class="thread-goal-loading" role="status">
      <span class="thread-goal-spinner" aria-hidden="true" />
      正在读取持续目标…
    </div>

    <div v-if="error" class="thread-goal-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" :disabled="isLoading || isUpdating" @click="$emit('retry')">重试</button>
    </div>

    <template v-if="goal">
      <div class="thread-goal-summary">
        <span class="thread-goal-status-dot" aria-hidden="true" />
        <button
          class="thread-goal-objective"
          type="button"
          :aria-expanded="isEditing"
          :title="goal.objective"
          @click="openEditor"
        >
          <span class="thread-goal-kicker">
            持续目标 · {{ statusLabel }}<template v-if="executionHint"> · {{ executionHint }}</template>
          </span>
          <span class="thread-goal-text">{{ goal.objective }}</span>
          <span v-if="usageLabel" class="thread-goal-usage-mobile">{{ usageLabel }}</span>
        </button>
        <span v-if="usageLabel" class="thread-goal-usage">{{ usageLabel }}</span>
        <div class="thread-goal-actions">
          <button
            v-if="goal.status === 'active'"
            type="button"
            class="thread-goal-action thread-goal-action-primary"
            :disabled="isUpdating || disabled"
            aria-label="暂停持续目标"
            title="暂停持续目标"
            @click="requestStatus('paused')"
          >{{ isUpdating && pendingAction === 'pause' ? '暂停中…' : '暂停' }}</button>
          <button
            v-else-if="goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'usageLimited'"
            type="button"
            class="thread-goal-action thread-goal-action-primary"
            :disabled="isUpdating || disabled"
            aria-label="继续持续目标"
            title="继续持续目标"
            @click="requestStatus('active')"
          >{{ isUpdating && pendingAction === 'resume' ? '继续中…' : '继续' }}</button>
          <button
            type="button"
            class="thread-goal-action thread-goal-action-secondary"
            :disabled="isUpdating || disabled"
            @click="openEditor"
          >编辑</button>
          <button
            type="button"
            class="thread-goal-action thread-goal-action-secondary thread-goal-action-danger"
            :disabled="isUpdating || disabled"
            @click="requestClear"
          >清除</button>
          <div ref="moreRootRef" class="thread-goal-more">
            <button
              ref="moreTriggerRef"
              type="button"
              class="thread-goal-action thread-goal-more-trigger"
              :aria-expanded="isMoreOpen"
              aria-haspopup="menu"
              aria-label="更多持续目标操作"
              :disabled="isUpdating || disabled"
              @click="toggleMoreMenu"
              @keydown.arrow-down.prevent="openMoreMenu(false)"
              @keydown.arrow-up.prevent="openMoreMenu(true)"
            >•••</button>
            <div
              v-if="isMoreOpen"
              ref="moreMenuRef"
              class="thread-goal-more-menu"
              role="menu"
              @keydown="onMoreMenuKeydown"
            >
              <button type="button" role="menuitem" @click="openEditor">编辑目标</button>
              <button type="button" role="menuitem" class="is-danger" @click="requestClear">清除目标</button>
            </div>
          </div>
        </div>
      </div>

      <p v-if="planModeActive && goal.status === 'active'" class="thread-goal-scope-note" role="status">
        计划模式只影响新消息；持续目标仍会推进，可随时暂停。
      </p>

      <div v-if="isConfirmingClear" class="thread-goal-confirm" role="alert">
        <span>确定清除“{{ objectivePreview }}”？清除后不会自动继续。</span>
        <div>
          <button type="button" :disabled="isUpdating" @click="cancelClear">取消</button>
          <button type="button" class="is-danger" :disabled="isUpdating" @click="confirmClear">
            {{ isUpdating ? '清除中…' : '确认清除' }}
          </button>
        </div>
      </div>
    </template>

    <button
      v-else-if="!isLoading && !isEditing"
      type="button"
      class="thread-goal-create"
      :disabled="isUpdating || disabled"
      @click="openEditor"
    >
      <span aria-hidden="true">◎</span>
      设置持续目标
    </button>

    <form v-if="isEditing" class="thread-goal-editor" @submit.prevent="save">
      <label class="thread-goal-editor-label" for="thread-goal-objective">
        {{ goal ? '编辑持续目标' : '设置要持续追求的目标' }}
      </label>
      <textarea
        id="thread-goal-objective"
        ref="editorRef"
        v-model="draft"
        rows="2"
        maxlength="2000"
        :disabled="isUpdating || disabled"
        placeholder="描述目标和可衡量的成果"
        @keydown.escape.prevent="cancelEditor"
      />
      <p class="thread-goal-help">任务空闲时，CX-Codex 将继续推进；暂停后不会自动恢复。</p>
      <div class="thread-goal-editor-actions">
        <button type="button" :disabled="isUpdating" @click="cancelEditor">取消</button>
        <button type="submit" class="is-primary" :disabled="!canSave">
          {{ saveButtonLabel }}
        </button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UiThreadGoal, UiThreadGoalStatus } from '../../types/codex'

const props = withDefaults(defineProps<{
  goal: UiThreadGoal | null
  isLoading?: boolean
  isUpdating?: boolean
  disabled?: boolean
  error?: string
  executionHint?: string
  planModeActive?: boolean
}>(), {
  isLoading: false,
  isUpdating: false,
  disabled: false,
  error: '',
  executionHint: '',
  planModeActive: false,
})

const emit = defineEmits<{
  setGoal: [objective: string]
  setStatus: [status: Extract<UiThreadGoalStatus, 'active' | 'paused'>]
  clearGoal: []
  retry: []
}>()

const editorRef = ref<HTMLTextAreaElement | null>(null)
const moreRootRef = ref<HTMLElement | null>(null)
const moreTriggerRef = ref<HTMLButtonElement | null>(null)
const moreMenuRef = ref<HTMLElement | null>(null)
const isEditing = ref(false)
const isMoreOpen = ref(false)
const isConfirmingClear = ref(false)
const draft = ref('')
const pendingAction = ref<'pause' | 'resume' | 'save' | 'clear' | ''>('')

const statusLabel = computed(() => {
  switch (props.goal?.status) {
    case 'active': return '进行中'
    case 'paused': return '已暂停'
    case 'budgetLimited': return '预算已用完'
    case 'usageLimited': return '用量受限'
    case 'blocked': return '已阻塞'
    case 'complete': return '已完成'
    default: return ''
  }
})

const usageLabel = computed(() => {
  const goal = props.goal
  if (!goal) return ''
  const tokens = goal.tokenBudget && goal.tokenBudget > 0
    ? `预算已用 ${Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100))}%`
    : goal.tokensUsed > 0
      ? `已用 ${formatCount(goal.tokensUsed)} tokens`
      : ''
  const time = goal.timeUsedSeconds > 0 ? formatDuration(goal.timeUsedSeconds) : ''
  return [tokens, time].filter(Boolean).join(' · ')
})

const objectivePreview = computed(() => {
  const objective = props.goal?.objective.trim() ?? ''
  return objective.length > 42 ? `${objective.slice(0, 42)}…` : objective
})

const canSave = computed(() => (
  draft.value.trim().length > 0
  && draft.value.trim() !== (props.goal?.objective ?? '')
  && !props.isUpdating
  && !props.disabled
))

const saveButtonLabel = computed(() => {
  if (props.isUpdating) return props.goal ? '保存中…' : '启动中…'
  return props.goal ? '保存' : '保存并开始'
})

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value)
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
  return `${Math.round(seconds / 360) / 10}小时`
}

function openEditor(): void {
  if (props.disabled) return
  closeMoreMenu()
  cancelClear()
  draft.value = props.goal?.objective ?? ''
  isEditing.value = true
  void nextTick(() => editorRef.value?.focus())
}

function cancelEditor(): void {
  draft.value = props.goal?.objective ?? ''
  isEditing.value = false
}

function save(): void {
  if (!canSave.value) return
  pendingAction.value = 'save'
  emit('setGoal', draft.value.trim())
}

function cancelClear(): void {
  isConfirmingClear.value = false
}

function requestClear(): void {
  closeMoreMenu()
  isEditing.value = false
  isConfirmingClear.value = true
}

function confirmClear(): void {
  if (props.isUpdating) return
  pendingAction.value = 'clear'
  emit('clearGoal')
}

function requestStatus(status: Extract<UiThreadGoalStatus, 'active' | 'paused'>): void {
  if (props.isUpdating || props.disabled) return
  pendingAction.value = status === 'active' ? 'resume' : 'pause'
  emit('setStatus', status)
}

function menuItems(): HTMLButtonElement[] {
  return moreMenuRef.value
    ? Array.from(moreMenuRef.value.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    : []
}

function focusMoreMenuItem(focusLast = false): void {
  const items = menuItems()
  const target = focusLast ? items[items.length - 1] : items[0]
  target?.focus()
}

function openMoreMenu(focusLast = false): void {
  if (props.isUpdating || props.disabled) return
  isMoreOpen.value = true
  void nextTick(() => focusMoreMenuItem(focusLast))
}

function closeMoreMenu(restoreFocus = false): void {
  if (!isMoreOpen.value) return
  isMoreOpen.value = false
  if (restoreFocus) void nextTick(() => moreTriggerRef.value?.focus())
}

function toggleMoreMenu(): void {
  if (isMoreOpen.value) closeMoreMenu(true)
  else openMoreMenu()
}

function onMoreMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMoreMenu(true)
    return
  }
  if (event.key === 'Tab') {
    closeMoreMenu()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = menuItems()
  if (items.length === 0) return
  if (event.key === 'Home') {
    items[0]?.focus()
    return
  }
  if (event.key === 'End') {
    items[items.length - 1]?.focus()
    return
  }
  const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
  const offset = event.key === 'ArrowDown' ? 1 : -1
  items[(currentIndex + offset + items.length) % items.length]?.focus()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isMoreOpen.value || moreRootRef.value?.contains(event.target as Node)) return
  closeMoreMenu()
}

function resetTransientState(): void {
  closeMoreMenu()
  cancelClear()
  isEditing.value = false
  pendingAction.value = ''
  draft.value = props.goal?.objective ?? ''
}

watch(() => props.goal?.objective, (objective) => {
  if (!isEditing.value) draft.value = objective ?? ''
})

watch(() => props.goal?.threadId, (threadId, previousThreadId) => {
  if (threadId !== previousThreadId) resetTransientState()
})

watch(() => props.goal, (goal, previous) => {
  if (previous && !goal) cancelClear()
})

watch(() => props.isUpdating, (updating, previous) => {
  if (previous && !updating && props.goal?.objective === draft.value.trim()) {
    isEditing.value = false
  }
  if (previous && !updating) pendingAction.value = ''
})

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  cancelClear()
})
</script>

<style scoped>
.thread-goal {
  box-sizing: border-box;
  width: min(100%, 860px);
  max-width: 100%;
  min-width: 0;
  margin: 0 auto 6px;
  color: var(--ui-text-primary);
}

.thread-goal-loading,
.thread-goal-create,
.thread-goal-summary,
.thread-goal-editor,
.thread-goal-error,
.thread-goal-confirm {
  box-sizing: border-box;
  max-width: 100%;
  border: 1px solid var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
}

.thread-goal-loading,
.thread-goal-create {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--ui-text-secondary);
  font: inherit;
  font-size: 12px;
}

.thread-goal-create { cursor: pointer; }

.thread-goal-create:hover,
.thread-goal-create:focus-visible,
.thread-goal-action:hover,
.thread-goal-action:focus-visible {
  border-color: var(--ui-border-strong);
  color: var(--ui-text-primary);
}

.thread-goal-error,
.thread-goal-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11px;
}

.thread-goal-scope-note {
  margin: 4px 4px 0;
  color: var(--ui-text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.thread-goal-error {
  border-color: color-mix(in srgb, var(--ui-danger) 30%, var(--ui-border-subtle));
  color: var(--ui-danger);
}

.thread-goal-error button,
.thread-goal-confirm button {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
}

.thread-goal-confirm > div { display: flex; flex: 0 0 auto; gap: 4px; }
.thread-goal-confirm .is-danger { border-color: var(--ui-danger); color: var(--ui-danger); }

.thread-goal-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  align-items: center;
  gap: 9px;
  padding: 5px 7px 5px 11px;
  border-radius: 10px;
}

.thread-goal-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-text-tertiary);
}

.thread-goal[data-state='active'] .thread-goal-status-dot { background: var(--ui-accent); }
.thread-goal[data-state='complete'] .thread-goal-status-dot { background: var(--ui-success); }
.thread-goal[data-state='blocked'] .thread-goal-status-dot,
.thread-goal[data-state='budgetLimited'] .thread-goal-status-dot,
.thread-goal[data-state='usageLimited'] .thread-goal-status-dot { background: var(--ui-warning); }

.thread-goal-objective {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.thread-goal-kicker,
.thread-goal-text { display: block; }

.thread-goal-kicker {
  margin-bottom: 1px;
  color: var(--ui-text-secondary);
  font-size: 11px;
  line-height: 1.2;
}

.thread-goal-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 1.4;
}

.thread-goal-usage {
  color: var(--ui-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.thread-goal-usage-mobile { display: none; }

.thread-goal-actions,
.thread-goal-editor-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.thread-goal-action,
.thread-goal-editor-actions button {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.thread-goal-action-primary { border-color: var(--ui-border-subtle); }
.thread-goal-action-danger:hover,
.thread-goal-action-danger:focus-visible { color: var(--ui-danger); }

.thread-goal-more { position: relative; display: none; flex: 0 0 auto; }
.thread-goal-more-trigger { letter-spacing: 1px; }
.thread-goal-more-menu {
  box-sizing: border-box;
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: var(--ui-z-popover, 70);
  width: 132px;
  max-width: calc(100vw - 24px);
  padding: 4px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 9px;
  background: var(--ui-bg-surface);
  box-shadow: 0 6px 8px rgb(0 0 0 / .08);
}

.thread-goal-more-menu button {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-primary);
  text-align: left;
  font: inherit;
  font-size: 12px;
}

.thread-goal-more-menu button:hover,
.thread-goal-more-menu button:focus-visible { background: var(--ui-bg-row-hover); }
.thread-goal-more-menu button.is-danger { color: var(--ui-danger); }

.thread-goal-editor {
  padding: 10px;
  border-radius: 10px;
}

.thread-goal-editor-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
}

.thread-goal-editor textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 58px;
  resize: vertical;
  padding: 8px 9px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  outline: none;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}

.thread-goal-editor textarea:focus { border-color: var(--ui-accent); }
.thread-goal-help { margin: 6px 0 8px; color: var(--ui-text-secondary); font-size: 11px; }
.thread-goal-editor-actions { justify-content: flex-end; }
.thread-goal-editor-actions button { border-color: var(--ui-border-subtle); }
.thread-goal-editor-actions .is-primary { border-color: var(--ui-accent); background: var(--ui-accent); color: #fff; }

button:disabled,
textarea:disabled { cursor: not-allowed; opacity: .55; }

.thread-goal-spinner {
  width: 10px;
  height: 10px;
  border: 1px solid var(--ui-border-strong);
  border-top-color: var(--ui-accent);
  border-radius: 50%;
  animation: thread-goal-spin .8s linear infinite;
}

@keyframes thread-goal-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .thread-goal-summary {
    grid-template-columns: auto minmax(0, 1fr) auto;
    min-height: 52px;
    gap: 7px;
    padding: 5px 5px 5px 9px;
  }

  .thread-goal-usage { display: none; }
  .thread-goal-usage-mobile {
    display: block;
    margin-top: 2px;
    color: var(--ui-text-secondary);
    font-size: 11px;
    line-height: 1.3;
  }
  .thread-goal-action-secondary { display: none; }
  .thread-goal-more { display: block; }
  .thread-goal-action { min-width: 44px; min-height: 44px; padding-inline: 7px; }
  .thread-goal-create,
  .thread-goal-error button,
  .thread-goal-editor-actions button { min-height: 44px; }
  .thread-goal-confirm { align-items: flex-start; flex-direction: column; }
  .thread-goal-confirm > div { align-self: flex-end; }
  .thread-goal-confirm button { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .thread-goal-spinner { animation: none; }
}
</style>
