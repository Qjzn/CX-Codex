<template>
  <section class="task-board" aria-label="任务看板">
    <div class="task-board-toolbar">
      <p class="task-board-scope">
        仅显示当前已加载会话的最近任务状态
        <span class="task-board-scope-count">已加载 {{ loadedThreadCount }} 个会话，当前筛选 {{ projection.total }} 个</span>
      </p>

      <div class="task-board-filters">
        <div class="task-board-field">
          <label class="task-board-field-label" for="task-board-search">搜索会话</label>
          <input
            id="task-board-search"
            v-model="query"
            class="task-board-control task-board-input"
            type="search"
            autocomplete="off"
            placeholder="按标题或项目筛选"
          />
        </div>
        <div class="task-board-field">
          <label class="task-board-field-label" for="task-board-project">项目</label>
          <select id="task-board-project" v-model="projectCwd" class="task-board-control task-board-select">
            <option value="">全部项目</option>
            <option v-for="option in projectOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <button
          type="button"
          class="task-board-control task-board-refresh"
          :disabled="loading"
          :aria-busy="loading ? 'true' : undefined"
          @click="onRefresh"
        >
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="task-board-feedback">
      <p v-if="offline" class="task-board-note task-board-note--warning" role="status">
        当前浏览器处于离线状态，任务状态可能不是最新的。
      </p>
      <p v-if="loading && projection.total === 0" class="task-board-note" role="status">
        正在读取当前已加载会话的任务状态…共 {{ loadedThreadCount }} 个会话。
      </p>
      <p v-else-if="loading" class="task-board-note" role="status">正在刷新，下面仍显示上一次确认的状态。</p>
      <p v-if="error" class="task-board-note task-board-note--error" role="alert">
        状态读取未完全成功：{{ error }}下面的卡片可能仍是此前缓存的旧状态，已经过期，可点击刷新重试。
      </p>
      <p v-if="missingCount > 0" class="task-board-note">
        其中 {{ missingCount }} 个会话的状态未确认或需要同步，看板按“状态未确认”“待同步”把它们放在需关注列。
      </p>
      <p v-if="!loading && !error && projection.total === 0" class="task-board-note">
        当前筛选下没有可展示的会话。看板只读取侧栏已加载的会话，不会拉取全机任务。
      </p>
    </div>

    <div class="task-board-columns">
      <section
        v-for="column in projection.columns"
        :key="column.id"
        class="task-board-column"
        :aria-label="`${column.title}，${column.cards.length} 个会话`"
      >
        <h3 class="task-board-column-title">
          <span>{{ column.title }}</span>
          <span class="task-board-column-count">{{ column.cards.length }}</span>
        </h3>

        <p v-if="column.cards.length === 0" class="task-board-column-empty">暂无会话</p>
        <ul v-else class="task-board-card-list">
          <li v-for="card in visibleCards(column.id, column.cards)" :key="card.threadId" class="task-board-card-item">
            <button type="button" class="task-board-card" :title="`打开会话：${displayTitle(card)}`" @click="emit('open-thread', card.threadId)">
              <span class="task-board-card-title">{{ displayTitle(card) }}</span>
              <span class="task-board-card-meta">
                <span class="task-board-card-project" :title="card.cwd">{{ projectLabel(card) }}</span>
                <span class="task-board-card-state" :data-column="column.id">{{ card.stateLabel }}</span>
                <span class="task-board-card-time" :title="card.updatedAtIso">{{ formatTimestamp(card.updatedAtIso) }}</span>
              </span>
            </button>
          </li>
        </ul>

        <div v-if="column.cards.length > CARD_LIMIT" class="task-board-column-actions">
          <button
            v-if="remainingCards(column.id, column.cards) > 0"
            type="button"
            class="task-board-show-more"
            @click="showMoreCards(column.id, column.cards.length)"
          >
            显示后 {{ Math.min(CARD_LIMIT, remainingCards(column.id, column.cards)) }} 个
          </button>
          <button
            v-if="isColumnExpanded(column.id)"
            type="button"
            class="task-board-show-more"
            @click="collapseColumn(column.id)"
          >
            收起
          </button>
          <span class="task-board-column-progress">
            已显示 {{ visibleCards(column.id, column.cards).length }}/{{ column.cards.length }}
          </span>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import { useThreadTaskBoard } from '../../composables/useThreadTaskBoard'
import { projectThreadTaskBoard } from '../../task-board/projectThreadTaskBoard'
import type { ThreadTaskBoardCard } from '../../task-board/projectThreadTaskBoard'

const props = defineProps<{
  groups: UiProjectGroup[]
}>()

const emit = defineEmits<{
  (event: 'open-thread', threadId: string): void
}>()

/** Bounded first render per column; the rest stays one click away. */
const CARD_LIMIT = 20
const UNNAMED_THREAD_TITLE = '未命名会话'

const query = ref('')
const projectCwd = ref('')
const visibleLimitByColumn = ref<Record<string, number>>({})
const offline = ref(typeof navigator !== 'undefined' ? navigator.onLine === false : false)

/** Flatten the parent's already-filtered project groups and drop duplicate ids locally. */
const boardThreads = computed<UiThread[]>(() => {
  const seen = new Set<string>()
  const threads: UiThread[] = []
  for (const group of Array.isArray(props.groups) ? props.groups : []) {
    for (const thread of Array.isArray(group?.threads) ? group.threads : []) {
      const threadId = typeof thread?.id === 'string' ? thread.id.trim() : ''
      if (!threadId || seen.has(threadId)) continue
      seen.add(threadId)
      threads.push(thread)
    }
  }
  return threads
})

const loadedThreadCount = computed(() => boardThreads.value.length)

const { snapshotsByThreadId, loading, error, missingCount, refresh } = useThreadTaskBoard(boardThreads)

const projection = computed(() => projectThreadTaskBoard({
  threads: boardThreads.value,
  snapshotsByThreadId: snapshotsByThreadId.value,
  query: query.value,
  projectCwd: projectCwd.value,
}))

const projectOptions = computed(() => {
  const labelByCwd = new Map<string, string>()
  for (const thread of boardThreads.value) {
    const cwd = typeof thread.cwd === 'string' ? thread.cwd.trim() : ''
    if (!cwd || labelByCwd.has(cwd)) continue
    const projectName = typeof thread.projectName === 'string' ? thread.projectName.trim() : ''
    labelByCwd.set(cwd, projectName)
  }
  return [...labelByCwd.entries()]
    .map(([value, label]) => ({ value, label: label || shortCwd(value) }))
    .sort((left, right) => left.label.localeCompare(right.label))
})

// A project that left the loaded set must not stay as a dead filter value.
watch(projectOptions, (options) => {
  if (projectCwd.value === '') return
  if (!options.some((option) => option.value === projectCwd.value)) projectCwd.value = ''
})

const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function shortCwd(value: string): string {
  const normalized = String(value ?? '').replace(/\\/gu, '/').replace(/\/+$/u, '')
  const segment = normalized.split('/').filter(Boolean).pop()
  return segment ?? ''
}

function displayTitle(card: ThreadTaskBoardCard): string {
  const title = typeof card.title === 'string' ? card.title.trim() : ''
  return title || UNNAMED_THREAD_TITLE
}

function projectLabel(card: ThreadTaskBoardCard): string {
  const projectName = typeof card.projectName === 'string' ? card.projectName.trim() : ''
  return projectName || shortCwd(card.cwd) || '未知项目'
}

function formatTimestamp(value: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '时间未知'
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return '时间未知'
  return timestampFormatter.format(new Date(parsed))
}

function visibleCards(columnId: string, cards: ThreadTaskBoardCard[]): ThreadTaskBoardCard[] {
  return cards.slice(0, cardLimit(columnId))
}

function cardLimit(columnId: string): number {
  const limit = visibleLimitByColumn.value[columnId]
  return typeof limit === 'number' && Number.isFinite(limit) && limit > CARD_LIMIT ? Math.floor(limit) : CARD_LIMIT
}

function remainingCards(columnId: string, cards: ThreadTaskBoardCard[]): number {
  return Math.max(0, cards.length - Math.min(cardLimit(columnId), cards.length))
}

function isColumnExpanded(columnId: string): boolean {
  return cardLimit(columnId) > CARD_LIMIT
}

/** Grows one bounded chunk at a time so a huge column is never rendered in a single click. */
function showMoreCards(columnId: string, total: number): void {
  const next = Math.min(cardLimit(columnId) + CARD_LIMIT, total)
  visibleLimitByColumn.value = { ...visibleLimitByColumn.value, [columnId]: next }
}

function collapseColumn(columnId: string): void {
  visibleLimitByColumn.value = { ...visibleLimitByColumn.value, [columnId]: CARD_LIMIT }
}

function onRefresh(): void {
  if (loading.value) return
  void refresh()
}

function syncOfflineState(): void {
  offline.value = typeof navigator !== 'undefined' ? navigator.onLine === false : false
}

onMounted(() => {
  syncOfflineState()
  window.addEventListener('online', syncOfflineState)
  window.addEventListener('offline', syncOfflineState)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', syncOfflineState)
  window.removeEventListener('offline', syncOfflineState)
})
</script>

<style scoped>
.task-board {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.task-board-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  min-width: 0;
}

.task-board-scope {
  margin: 0;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ui-text-secondary);
}

.task-board-scope-count {
  display: block;
  color: var(--ui-text-tertiary);
}

.task-board-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  min-width: 0;
}

.task-board-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.task-board-field-label {
  font-size: 11px;
  line-height: 1;
  color: var(--ui-text-tertiary);
}

.task-board-control {
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 0.625rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.2;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

.task-board-control:hover,
.task-board-control:focus-visible {
  background: var(--ui-bg-surface-muted);
}

.task-board-control:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.task-board-input {
  width: 200px;
  max-width: 100%;
}

.task-board-select {
  max-width: 100%;
}

.task-board-refresh {
  min-width: 72px;
  cursor: pointer;
  color: var(--ui-text-secondary);
}

.task-board-refresh:disabled {
  cursor: default;
  color: var(--ui-text-tertiary);
}

.task-board-feedback {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.task-board-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ui-text-secondary);
}

.task-board-note--warning {
  color: var(--ui-text-primary);
}

.task-board-note--error {
  color: var(--ui-text-primary);
}

.task-board-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.task-board-column {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface);
}

.task-board-column-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ui-text-primary);
}

.task-board-column-count {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.task-board-column-empty {
  margin: 0;
  font-size: 11.5px;
  color: var(--ui-text-tertiary);
}

.task-board-card-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}

.task-board-card-item {
  min-width: 0;
}

.task-board-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  min-height: 44px;
  min-width: 0;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-card);
  background: var(--ui-bg-surface-muted);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

.task-board-card:hover,
.task-board-card:focus-visible {
  background: var(--ui-bg-surface);
}

.task-board-card:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.task-board-card-title {
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--ui-text-primary);
  overflow-wrap: anywhere;
}

.task-board-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.5rem;
  min-width: 0;
  font-size: 11px;
  line-height: 1.3;
  color: var(--ui-text-tertiary);
}

.task-board-card-project {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--ui-text-secondary);
}

.task-board-card-state {
  color: var(--ui-text-secondary);
}

.task-board-card-time {
  font-variant-numeric: tabular-nums;
}

.task-board-column-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  margin-top: auto;
}

.task-board-column-progress {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.task-board-show-more {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 0.625rem;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-control);
  background: transparent;
  color: var(--ui-text-secondary);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

.task-board-show-more:hover,
.task-board-show-more:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
}

.task-board-show-more:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

@media (max-width: 1180px) {
  .task-board-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1023px) {
  .task-board {
    box-sizing: border-box;
    width: 100%;
    padding: 1rem 1rem 0.5rem;
  }
}

@media (max-width: 640px) {
  .task-board-columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-board-input {
    width: 100%;
  }

  .task-board-field {
    flex: 1 1 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-board-control,
  .task-board-card,
  .task-board-show-more {
    transition: none;
  }
}
</style>
