<template>
  <div
    class="task-pet-preview"
    :class="{ 'is-expanded': expanded, 'is-minimized': minimized, 'is-docked': !expanded && !peekVisible }"
    aria-label="任务宠物预览"
  >
    <Transition name="task-pet-panel">
      <div v-if="expanded && !minimized" class="task-pet-preview-panel">
        <div class="task-pet-preview-header">
          <span class="task-pet-preview-heading">
            <strong>任务进展</strong>
            <small>{{ visibleItems.length > 0 ? `${visibleItems.length} 个任务 · 最新回复实时更新` : '当前空闲' }}</small>
          </span>
          <span v-if="!closeConfirmationVisible" class="task-pet-preview-header-actions">
            <button class="task-pet-preview-brand-action" type="button" aria-label="进入平台" @click.stop="$emit('enter')">
              <img src="/branding/cx-codex-logo.png" alt="" aria-hidden="true">
            </button>
            <button class="task-pet-preview-close-action" type="button" aria-label="关闭浮窗" @click.stop="showCloseConfirmation">×</button>
          </span>
        </div>
        <template v-if="!closeConfirmationVisible">
          <button
            v-for="item in visibleItems"
            :key="item.threadId"
            class="task-pet-preview-row"
            type="button"
            @click="openTask(item)"
          >
            <span class="task-pet-preview-dot" :data-state="item.state" />
            <span class="task-pet-preview-copy">
              <small class="task-pet-preview-context">
                {{ item.detail }}<template v-if="item.projectName"> · {{ item.projectName }}</template> · {{ item.title }}
              </small>
              <Transition name="task-pet-live" mode="out-in">
                <strong :key="taskReply(item)" class="task-pet-preview-reply-copy">{{ taskReply(item) }}</strong>
              </Transition>
              <small class="task-pet-preview-live" :class="{ 'is-no-progress': taskHasNoProgress(item) }">
                {{ taskFreshness(item) }}
              </small>
            </span>
            <span class="task-pet-preview-arrow" aria-hidden="true">›</span>
          </button>
          <p v-if="visibleItems.length === 0" class="task-pet-preview-empty">没有正在运行的任务</p>
        </template>
        <section v-else class="task-pet-preview-close-confirm" role="alertdialog" aria-label="确认关闭浮窗">
          <strong>关闭任务宠物浮窗？</strong>
          <p>关闭后不再显示，但可随时在设置中重新开启。</p>
          <div>
            <button type="button" @click="cancelCloseConfirmation">取消</button>
            <button type="button" data-tone="danger" @click="confirmClose">确认关闭</button>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="task-pet-compact">
      <button
        v-if="!expanded && !minimized && peekVisible && primaryItem"
        class="task-pet-preview-compact"
        type="button"
        :aria-label="`${taskReply(primaryItem)}，点击打开会话 ${primaryItem.title}`"
        @click="openTask(primaryItem)"
      >
        <small>
          {{ primaryItem.title }}<template v-if="primaryItem.projectName"> · {{ primaryItem.projectName }}</template>
        </small>
        <strong>{{ taskReply(primaryItem) }}</strong>
        <span>{{ taskFreshness(primaryItem) }} <b aria-hidden="true">›</b></span>
      </button>
    </Transition>

    <Transition name="task-pet-mode" mode="out-in">
      <button
        v-if="minimized"
        key="mini"
        class="task-pet-preview-mini"
        type="button"
        aria-label="恢复任务宠物"
        @click="restore"
      >
        <img :key="`mini-${mascotState}`" :src="mascotStaticAsset" alt="" aria-hidden="true">
        <span v-if="attentionCount > 0" class="task-pet-preview-mini-badge" :data-waiting="hasWaitingTask">
          {{ attentionCount > 9 ? '9+' : attentionCount }}
        </span>
      </button>
      <button
        v-else
        key="full"
        class="task-pet-preview-mascot"
        :data-state="mascotState"
        type="button"
        :aria-expanded="expanded"
        :aria-label="expanded ? '收起任务进展' : '展开任务进展'"
        @click="toggleExpanded"
      >
        <picture :key="mascotState" class="task-pet-preview-character-wrap">
          <source media="(prefers-reduced-motion: reduce)" :srcset="mascotStaticAsset">
          <img class="task-pet-preview-character" :src="mascotAnimatedAsset" alt="" aria-hidden="true">
        </picture>
        <span v-if="attentionCount > 0" class="task-pet-preview-badge" :data-waiting="hasWaitingTask">
          {{ attentionCount > 99 ? '99+' : attentionCount }}
        </span>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UiTaskPetItem, UiTaskPetRecentThread } from '../../types/codex'

const props = withDefaults(defineProps<{
  items: UiTaskPetItem[]
  recentThreads?: UiTaskPetRecentThread[]
  initiallyExpanded?: boolean
}>(), {
  recentThreads: () => [],
  initiallyExpanded: false,
})

const emit = defineEmits<{
  open: [threadId: string]
  enter: []
  close: []
  reply: [threadId: string, message: string]
}>()

const expanded = ref(props.initiallyExpanded && props.items.length > 0)
const minimized = ref(props.items.length === 0)
const peekVisible = ref(false)
const unreadReplyTaskKeys = ref<ReadonlySet<string>>(new Set())
const seenReplyEventSeqByTaskKey = new Map(
  props.items.map((item) => [taskKey(item), Math.max(0, item.latestReplyEventSeq ?? 0)]),
)
const closeConfirmationVisible = ref(false)
const nowMs = ref(Date.now())
let freshnessTimer: ReturnType<typeof setInterval> | null = null
let peekTimer: ReturnType<typeof setTimeout> | null = null
let stackTimer: ReturnType<typeof setTimeout> | null = null
const NO_PROGRESS_THRESHOLD_MS = 10 * 60_000
const REPLY_PEEK_TIMEOUT_MS = 5_000
const TASK_STACK_TIMEOUT_MS = 8_000

function stopFreshnessTimer(): void {
  if (freshnessTimer === null) return
  clearInterval(freshnessTimer)
  freshnessTimer = null
}

function startFreshnessTimer(): void {
  if (freshnessTimer !== null || (typeof document !== 'undefined' && document.hidden)) return
  nowMs.value = Date.now()
  freshnessTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 30_000)
}

function onFreshnessVisibilityChange(): void {
  if (document.hidden) {
    stopFreshnessTimer()
    return
  }
  startFreshnessTimer()
}

onBeforeUnmount(() => {
  stopPeekTimer()
  stopStackTimer()
  stopFreshnessTimer()
  document.removeEventListener('visibilitychange', onFreshnessVisibilityChange)
})
onMounted(() => {
  startFreshnessTimer()
  document.addEventListener('visibilitychange', onFreshnessVisibilityChange)
  if (expanded.value) scheduleStackCollapse()
})
const visibleItems = computed(() => props.items.slice(0, 3))
const primaryItem = computed(() => visibleItems.value[0] ?? null)
const hasWaitingTask = computed(() => props.items.some((item) => item.state === 'waiting'))
const attentionCount = computed(() => props.items.filter((item) => (
  item.state === 'waiting' || unreadReplyTaskKeys.value.has(taskKey(item))
)).length)
const mascotState = computed(() => hasWaitingTask.value ? 'waiting' : visibleItems.value.length > 0 ? 'working' : 'idle')
const mascotAnimatedAsset = computed(() => `/assets/task-pet/cx-pet-${mascotState.value}-animated.webp`)
const mascotStaticAsset = computed(() => `/assets/task-pet/cx-pet-${mascotState.value}.png`)

watch(() => props.items.length, (count) => {
  if (count > 0) {
    minimized.value = false
    return
  }
  peekVisible.value = false
  stopPeekTimer()
  if (!expanded.value && !closeConfirmationVisible.value) minimized.value = true
})

watch(
  () => props.items.map((item) => `${taskKey(item)}:${Math.max(0, item.latestReplyEventSeq ?? 0)}`).join('|'),
  () => {
    const currentTaskKeys = new Set(props.items.map(taskKey))
    const nextUnreadTaskKeys = new Set(
      [...unreadReplyTaskKeys.value].filter((key) => currentTaskKeys.has(key)),
    )
    const primaryTaskKey = primaryItem.value ? taskKey(primaryItem.value) : ''
    let primaryReplyChanged = false

    for (const item of props.items) {
      const key = taskKey(item)
      const eventSeq = Math.max(0, item.latestReplyEventSeq ?? 0)
      const previousEventSeq = seenReplyEventSeqByTaskKey.get(key) ?? 0
      if (eventSeq > previousEventSeq) {
        nextUnreadTaskKeys.add(key)
        if (key === primaryTaskKey) primaryReplyChanged = true
      }
      seenReplyEventSeqByTaskKey.set(key, Math.max(previousEventSeq, eventSeq))
    }

    unreadReplyTaskKeys.value = nextUnreadTaskKeys
    if (primaryReplyChanged && !expanded.value) {
      minimized.value = false
      showReplyPeek()
    }
  },
)

function taskKey(item: UiTaskPetItem): string {
  return `${item.threadId}\u0000${item.activityId || item.startedAtMs || ''}`
}

function openTask(item: UiTaskPetItem): void {
  const key = taskKey(item)
  if (unreadReplyTaskKeys.value.has(key)) {
    const nextUnreadTaskKeys = new Set(unreadReplyTaskKeys.value)
    nextUnreadTaskKeys.delete(key)
    unreadReplyTaskKeys.value = nextUnreadTaskKeys
  }
  emit('open', item.threadId)
}

function restore() {
  minimized.value = false
  expanded.value = true
  peekVisible.value = false
  scheduleStackCollapse()
}

function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) {
    peekVisible.value = false
    stopPeekTimer()
    scheduleStackCollapse()
    return
  }
  stopStackTimer()
  peekVisible.value = false
  stopPeekTimer()
  if (!expanded.value && props.items.length === 0) {
    minimized.value = true
  }
}

function stopPeekTimer() {
  if (!peekTimer) return
  clearTimeout(peekTimer)
  peekTimer = null
}

function stopStackTimer() {
  if (!stackTimer) return
  clearTimeout(stackTimer)
  stackTimer = null
}

function showReplyPeek() {
  stopPeekTimer()
  if (!primaryItem.value || minimized.value || expanded.value) return
  peekVisible.value = true
  peekTimer = setTimeout(() => {
    peekTimer = null
    peekVisible.value = false
  }, REPLY_PEEK_TIMEOUT_MS)
}

function scheduleStackCollapse() {
  stopStackTimer()
  if (!expanded.value) return
  stackTimer = setTimeout(() => {
    stackTimer = null
    if (closeConfirmationVisible.value) return
    expanded.value = false
    peekVisible.value = false
    if (props.items.length === 0 && !closeConfirmationVisible.value) minimized.value = true
  }, TASK_STACK_TIMEOUT_MS)
}

function showCloseConfirmation() {
  stopStackTimer()
  closeConfirmationVisible.value = true
}

function cancelCloseConfirmation() {
  closeConfirmationVisible.value = false
  if (expanded.value) scheduleStackCollapse()
}

function taskReply(item: UiTaskPetItem): string {
  return item.latestReply || item.latestActivity || item.detail || '正在等待新的回复…'
}

function taskAgeMs(item: UiTaskPetItem): number {
  const updatedAtMs = Date.parse(item.updatedAtIso)
  if (!Number.isFinite(updatedAtMs)) return 0
  return Math.max(0, nowMs.value - updatedAtMs)
}

function taskHasNoProgress(item: UiTaskPetItem): boolean {
  return taskAgeMs(item) >= NO_PROGRESS_THRESHOLD_MS
}

function taskFreshness(item: UiTaskPetItem): string {
  const ageMs = taskAgeMs(item)
  if (ageMs >= NO_PROGRESS_THRESHOLD_MS) {
    return `${Math.max(10, Math.floor(ageMs / 60_000))} 分钟无新进展`
  }
  if (ageMs < 15_000) return item.latestReply ? '最新回复 · 刚刚' : '等待新的回复 · 刚刚'
  if (ageMs < 60_000) return item.latestReply ? '最新回复 · 1 分钟内' : '等待新的回复 · 1 分钟内'
  const minutes = Math.max(1, Math.floor(ageMs / 60_000))
  return item.latestReply ? `最新回复 · ${minutes} 分钟前` : `等待新的回复 · ${minutes} 分钟前`
}

function confirmClose() {
  stopPeekTimer()
  stopStackTimer()
  closeConfirmationVisible.value = false
  expanded.value = false
  emit('close')
}
</script>

<style scoped>
.task-pet-preview {
  display: flex;
  min-height: 100px;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-bg-secondary, #f4f5f7) 88%, transparent);
  border-radius: 12px;
}

.task-pet-preview-panel {
  width: min(248px, calc(100% - 64px));
  padding: 10px;
  background: var(--color-bg-primary, #fff);
  border-radius: 14px;
  box-shadow: 0 4px 8px rgb(15 23 42 / 12%);
  transform-origin: right bottom;
}

.task-pet-preview-compact {
  display: flex;
  width: min(224px, calc(100% - 64px));
  min-width: 0;
  min-height: 60px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 7px 11px;
  border: 0;
  border-radius: 14px;
  background: var(--color-bg-primary, #fff);
  box-shadow: 0 4px 12px rgb(15 23 42 / 14%);
  color: var(--color-text-primary, #1e2430);
  text-align: left;
  transition: background-color 120ms ease, transform 120ms ease;
}

.task-pet-preview-compact:hover {
  background: color-mix(in srgb, var(--color-bg-primary, #fff) 92%, var(--color-accent, #2a72e8));
}

.task-pet-preview-compact:active {
  transform: scale(0.985);
}

.task-pet-preview-compact:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
}

.task-pet-preview-compact small {
  overflow: hidden;
  color: var(--color-text-secondary, #596579);
  font-size: 9px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-pet-preview-compact strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.42;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.task-pet-preview-compact > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: color-mix(in srgb, var(--color-accent, #2a72e8) 78%, #263449);
  font-size: 9px;
}

.task-pet-preview-compact b {
  font-size: 16px;
  font-weight: 500;
  line-height: 10px;
}

.task-pet-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  color: var(--color-text-primary, #1d2430);
  font-size: 13px;
}

.task-pet-preview-header > span {
  color: var(--color-text-secondary, #596579);
  font-size: 11px;
}

.task-pet-preview-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.task-pet-preview-header small {
  color: var(--color-text-secondary, #596579);
  font-size: 9px;
  font-weight: 500;
}

.task-pet-preview-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-pet-preview-header-actions button {
  display: grid;
  width: 48px;
  height: 48px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--color-bg-secondary, #eef2f7);
  color: var(--color-text-secondary, #4a586d);
  font-size: 24px;
  transition: background-color 120ms ease, transform 120ms ease;
}

.task-pet-preview-header-actions .task-pet-preview-brand-action {
  background: color-mix(in srgb, var(--color-accent, #2a72e8) 10%, white);
}

.task-pet-preview-brand-action img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.task-pet-preview-close-action {
  color: #6f7785;
  font-weight: 400;
}

.task-pet-preview-header-actions button:active {
  transform: scale(0.96);
}

.task-pet-preview-header-actions button:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
}

.task-pet-preview-close-confirm button {
  min-height: 48px;
  border: 0;
  border-radius: 11px;
  background: color-mix(in srgb, var(--color-accent, #2a72e8) 10%, white);
  color: color-mix(in srgb, var(--color-accent, #2a72e8) 82%, #263449);
  font-size: 12px;
  font-weight: 750;
  transition: transform 120ms ease, filter 120ms ease;
}

.task-pet-preview-close-confirm button[data-tone='danger'] {
  background: #fdf0ef;
  color: #9f3e39;
}

.task-pet-preview-close-confirm button:active {
  transform: scale(0.97);
}

.task-pet-preview-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-height: 64px;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: var(--color-bg-secondary, #f2f5f9);
  color: inherit;
  text-align: left;
  transition: background-color 140ms ease, transform 140ms ease;
}

.task-pet-preview-row:hover {
  background: color-mix(in srgb, var(--color-bg-secondary, #f2f5f9) 82%, var(--color-accent, #2a72e8));
}

.task-pet-preview-row:active {
  transform: scale(0.985);
}

.task-pet-preview-row:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
}

.task-pet-preview-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 999px;
  background: #2a72e8;
}

.task-pet-preview-dot[data-state='waiting'] {
  background: #c16f12;
}

.task-pet-preview-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.task-pet-preview-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-pet-preview-copy .task-pet-preview-reply-copy {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-primary, #1e2430);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.42;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.task-pet-preview-copy small {
  color: var(--color-text-secondary, #596579);
  font-size: 10px;
}

.task-pet-preview-copy .task-pet-preview-live {
  color: color-mix(in srgb, var(--color-accent, #2a72e8) 78%, #263449);
  font-size: 9px;
}

.task-pet-preview-copy .task-pet-preview-live.is-no-progress {
  color: #a75c12;
  font-weight: 700;
}

.task-pet-preview-copy .task-pet-preview-context {
  font-size: 9px;
  font-weight: 650;
}

.task-pet-preview-arrow {
  color: var(--color-text-secondary, #596579);
  font-size: 20px;
}

.task-pet-preview-empty {
  margin: 8px 0 2px;
  color: var(--color-text-secondary, #596579);
  font-size: 12px;
}

.task-pet-preview-recents {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.task-pet-preview-recents > strong {
  color: var(--color-text-secondary, #596579);
  font-size: 11px;
}

.task-pet-preview-recents button {
  display: grid;
  min-width: 0;
  min-height: 48px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: #f7f8fb;
  color: var(--color-text-primary, #1e2430);
  text-align: left;
  touch-action: manipulation;
}

.task-pet-preview-recents button span:first-child {
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-pet-preview-recents button small {
  color: var(--color-text-secondary, #596579);
  font-size: 9px;
}

.task-pet-preview-reply {
  display: grid;
  gap: 7px;
  margin-top: 8px;
  padding: 10px;
  border-radius: 11px;
  background: var(--color-bg-secondary, #f2f5f9);
}

.task-pet-preview-reply > strong {
  overflow: hidden;
  color: var(--color-text-primary, #1e2430);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-pet-preview-reply textarea {
  min-height: 58px;
  resize: none;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--color-text-secondary, #596579) 18%, transparent);
  border-radius: 9px;
  background: var(--color-bg-primary, #fff);
  color: var(--color-text-primary, #1e2430);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
}

.task-pet-preview-reply > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.task-pet-preview-reply button {
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  background: var(--color-bg-primary, #fff);
  color: var(--color-text-secondary, #596579);
  font-size: 11px;
  font-weight: 700;
}

.task-pet-preview-reply button[type='submit'] {
  background: var(--color-accent, #2a72e8);
  color: #fff;
}

.task-pet-preview-reply button:disabled {
  opacity: 0.48;
}

.task-pet-preview-close-confirm {
  margin-top: 8px;
  padding: 11px;
  border-radius: 12px;
  background: #fdf0ef;
  color: #622a27;
}

.task-pet-preview-close-confirm > strong {
  font-size: 13px;
}

.task-pet-preview-close-confirm p {
  margin: 5px 0 8px;
  color: #7e4a46;
  font-size: 11px;
  line-height: 1.5;
}

.task-pet-preview-close-confirm > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.task-pet-preview-mascot {
  position: relative;
  width: 56px;
  height: 62px;
  flex: none;
  border: 0;
  background: transparent;
  color: #241f1c;
  touch-action: none;
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), opacity 100ms ease-out;
}

.task-pet-preview-mascot:active {
  transform: scale(0.97);
}

.task-pet-preview-mascot:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 2px;
  border-radius: 12px;
}

.task-pet-preview-character-wrap {
  position: absolute;
  inset: 0;
  width: 56px;
  height: 60px;
  filter: drop-shadow(0 4px 5px rgb(43 31 24 / 18%));
  transform-origin: 50% 82%;
  transition: opacity 120ms ease-out;
}

.task-pet-preview-character {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.task-pet-preview-mascot[data-state='working'] .task-pet-preview-character-wrap {
  animation: task-pet-working 420ms ease-out 1;
}

.task-pet-preview-mascot[data-state='waiting'] .task-pet-preview-character-wrap {
  animation: task-pet-waiting 520ms ease-out 1;
}

.task-pet-preview-badge {
  position: absolute;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-weight: 700;
}

.task-pet-preview-badge {
  top: 1px;
  right: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  background: #2a72e8;
  color: white;
  font-size: 10px;
}

.task-pet-preview-badge[data-waiting='true'] {
  background: #b9670c;
}

.task-pet-preview-mini {
  position: relative;
  display: grid;
  width: 48px;
  height: 48px;
  flex: none;
  place-items: center;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 4px 12px rgb(15 23 42 / 18%);
  touch-action: none;
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-preview-mini img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.task-pet-preview-mini:active {
  transform: scale(0.94);
}

.task-pet-preview-mini:focus-visible {
  outline: 2px solid var(--color-accent, #2a72e8);
  outline-offset: 3px;
}

.task-pet-preview-mini-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  display: grid;
  min-width: 19px;
  height: 19px;
  place-items: center;
  padding: 0 4px;
  border-radius: 999px;
  background: #2a72e8;
  color: white;
  font-size: 9px;
  font-weight: 800;
}

.task-pet-preview-mini-badge[data-waiting='true'] {
  background: #b9670c;
}

.task-pet-preview.is-docked .task-pet-preview-mini,
.task-pet-preview.is-docked .task-pet-preview-mascot {
  transform: translateX(16px);
}

.task-pet-preview.is-docked .task-pet-preview-mini:active,
.task-pet-preview.is-docked .task-pet-preview-mascot:active {
  transform: translateX(16px) scale(0.96);
}

.task-pet-mode-enter-active,
.task-pet-mode-leave-active {
  transition: opacity 120ms ease-out, transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-compact-enter-active,
.task-pet-compact-leave-active {
  transition: opacity 120ms ease-out, transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-compact-enter-from,
.task-pet-compact-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.task-pet-mode-enter-from,
.task-pet-mode-leave-to {
  opacity: 0;
  transform: scale(0.78);
}

@keyframes task-pet-working {
  0%, 100% { transform: translateY(0) rotate(-0.5deg); }
  50% { transform: translateY(-3px) rotate(0.5deg); }
}

@keyframes task-pet-waiting {
  0%, 70%, 100% { transform: rotate(0deg); }
  78% { transform: rotate(-2deg); }
  86% { transform: rotate(2deg); }
}

.task-pet-panel-enter-active {
  transition: opacity 160ms ease-out, transform 190ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-panel-leave-active {
  transition: opacity 110ms ease-in, transform 130ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-panel-enter-from,
.task-pet-panel-leave-to {
  opacity: 0;
  transform: translateY(5px) scaleY(0.94);
}

.task-pet-live-enter-active,
.task-pet-live-leave-active {
  transition: opacity 100ms ease-out, transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-pet-live-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.task-pet-live-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (max-width: 420px) {
  .task-pet-preview {
    align-items: flex-end;
  }

  .task-pet-preview-panel {
    width: calc(100% - 64px);
  }

  .task-pet-preview-copy small {
    max-width: 22ch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-pet-preview *,
  .task-pet-preview *::before,
  .task-pet-preview *::after {
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
  }
}
</style>
