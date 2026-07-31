<template>
  <Teleport to="body">
    <div v-if="visible" class="favorites-overlay" @click.self="$emit('close')">
      <div
        ref="panelRef"
        class="favorites-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorites-modal-title"
        tabindex="-1"
      >
        <div class="favorites-header">
          <div class="favorites-title-wrap">
            <p class="favorites-kicker">全局收藏</p>
            <h3 id="favorites-modal-title" class="favorites-title">我的收藏</h3>
          </div>
          <button class="favorites-close" type="button" aria-label="关闭收藏列表" @click="$emit('close')">
            <IconTablerX class="favorites-close-icon" />
          </button>
        </div>

        <div class="favorites-toolbar">
          <input
            v-model="searchQuery"
            class="favorites-search"
            type="text"
            placeholder="搜索收藏内容或会话标题"
          />
          <button
            class="favorites-filter"
            type="button"
            :class="{ 'is-active': currentThreadOnly }"
            :disabled="!activeThreadId"
            @click="currentThreadOnly = !currentThreadOnly"
          >
            仅当前会话
          </button>
        </div>

        <p class="favorites-summary">
          {{ filteredFavorites.length }} 条收藏
          <span v-if="statusText" class="favorites-status">{{ statusText }}</span>
        </p>

        <div v-if="filteredFavorites.length === 0" class="favorites-empty">
          <p class="favorites-empty-title">还没有收藏内容</p>
          <p class="favorites-empty-text">在消息卡片右上角点击收藏后，这里会统一显示所有记录。</p>
        </div>

        <div v-else class="favorites-list">
          <article v-for="record in filteredFavorites" :key="record.id" class="favorites-card">
            <div class="favorites-card-head">
              <div class="favorites-card-title-wrap">
                <p class="favorites-card-title">{{ record.threadTitle || '未命名会话' }}</p>
                <p class="favorites-card-meta">收藏于 {{ formatFavoriteTime(record.favoritedAtIso) }}</p>
              </div>
              <button class="favorites-remove" type="button" aria-label="取消收藏" title="取消收藏" @click="$emit('remove', record)">
                <IconTablerBookmark class="favorites-remove-icon" filled />
              </button>
            </div>

            <p class="favorites-card-text">{{ record.text }}</p>

            <div class="favorites-card-actions">
              <button class="favorites-action" type="button" @click="$emit('copy', record)">
                <IconTablerCopy class="favorites-action-icon" />
                <span>复制内容</span>
              </button>
              <button class="favorites-action favorites-action-primary" type="button" @click="$emit('open', record)">
                <IconTablerChevronRight class="favorites-action-icon" />
                <span>跳转会话</span>
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerBookmark from '../icons/IconTablerBookmark.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import type { FavoriteRecord } from '../../composables/useFavorites'

const props = defineProps<{
  visible: boolean
  favorites: FavoriteRecord[]
  activeThreadId?: string
  statusText?: string
}>()

const emit = defineEmits<{
  close: []
  copy: [record: FavoriteRecord]
  open: [record: FavoriteRecord]
  remove: [record: FavoriteRecord]
}>()

const searchQuery = ref('')
const currentThreadOnly = ref(false)
const panelRef = ref<HTMLElement | null>(null)
let previousFocusedElement: HTMLElement | null = null
let previousBodyOverflow = ''
let ownsBodyScrollLock = false

const filteredFavorites = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return props.favorites.filter((record) => {
    if (currentThreadOnly.value && props.activeThreadId && record.threadId !== props.activeThreadId) {
      return false
    }
    if (!query) return true
    return (
      record.text.toLowerCase().includes(query) ||
      record.preview.toLowerCase().includes(query) ||
      record.threadTitle.toLowerCase().includes(query)
    )
  })
})

watch(() => props.visible, (visible) => {
  if (!visible) {
    searchQuery.value = ''
    currentThreadOnly.value = false
    restoreModalEnvironment()
    return
  }

  if (typeof document === 'undefined') return
  previousFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  ownsBodyScrollLock = true
  void nextTick(() => {
    panelRef.value?.focus({ preventScroll: true })
  })
}, { immediate: true })

function restoreModalEnvironment(): void {
  if (typeof document === 'undefined') return
  if (ownsBodyScrollLock) {
    document.body.style.overflow = previousBodyOverflow
    ownsBodyScrollLock = false
    previousBodyOverflow = ''
  }
  const focusTarget = previousFocusedElement
  previousFocusedElement = null
  if (focusTarget?.isConnected) {
    focusTarget.focus({ preventScroll: true })
  }
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (!props.visible || event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeyDown, { capture: true })
  restoreModalEnvironment()
})

function formatFavoriteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<style scoped>
@reference "tailwindcss";

.favorites-overlay {
  @apply fixed inset-0 z-50 bg-black/40 px-3 py-4 sm:p-6 flex items-end justify-center sm:items-center;
  backdrop-filter: blur(3px);
}

.favorites-panel {
  @apply w-full max-w-[min(92vw,760px)] max-h-[min(86vh,820px)] rounded-[28px] border border-[#e7dcc8] bg-[#fffdf8] shadow-2xl flex flex-col;
}

.favorites-header {
  @apply flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5;
}

.favorites-title-wrap {
  @apply flex flex-col gap-1;
}

.favorites-kicker {
  @apply m-0 text-[11px] font-semibold tracking-[0.08em] text-[#9b8b73];
}

.favorites-title {
  @apply m-0 text-lg sm:text-xl font-semibold text-[#2b241d];
}

.favorites-close {
  @apply inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#e4d8c3] bg-[#fffaf0] text-[#645949] transition-colors hover:bg-white hover:border-[#d0bfa3];
}

.favorites-close-icon {
  @apply h-5 w-5;
}

.favorites-toolbar {
  @apply flex flex-col sm:flex-row gap-2 px-4 sm:px-5 pt-3;
}

.favorites-search {
  @apply min-w-0 flex-1 rounded-2xl border border-[#ddd3c2] bg-white px-3.5 py-2.5 text-sm text-[#2b241d] outline-none transition-colors;
}

.favorites-search:focus {
  @apply border-[#ccb89c];
}

.favorites-filter {
  @apply inline-flex items-center justify-center rounded-2xl border border-[#e1d6c4] bg-[#fffaf0] px-3.5 py-2.5 text-sm font-medium text-[#6f6253] transition-colors hover:border-[#ccb89c] hover:bg-white disabled:cursor-not-allowed disabled:opacity-55;
}

.favorites-filter.is-active {
  @apply border-[#c9b189] bg-[#f5ecdd] text-[#2b241d];
}

.favorites-summary {
  @apply m-0 px-4 sm:px-5 pt-3 text-xs text-[#8b7d67] flex flex-wrap items-center gap-2;
}

.favorites-status {
  @apply rounded-full border border-[#d7eadf] bg-[#eef8f5] px-2 py-0.5 text-[#0f766e];
}

.favorites-empty {
  @apply px-4 sm:px-5 py-10 text-center text-[#8f8577];
}

.favorites-empty-title {
  @apply m-0 text-base font-medium text-[#564c40];
}

.favorites-empty-text {
  @apply m-0 mt-2 text-sm leading-6;
}

.favorites-list {
  @apply flex-1 overflow-y-auto px-3 sm:px-4 py-4 flex flex-col gap-3;
}

.favorites-card {
  @apply rounded-[24px] border border-[#ece2d2] bg-white px-4 py-3.5 flex flex-col gap-3;
}

.favorites-card-head {
  @apply flex items-start justify-between gap-3;
}

.favorites-card-title-wrap {
  @apply min-w-0 flex flex-col gap-1;
}

.favorites-card-title {
  @apply m-0 text-sm sm:text-[15px] font-semibold text-[#2b241d] truncate;
}

.favorites-card-meta {
  @apply m-0 text-xs text-[#8f8577];
}

.favorites-remove {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ead9b5] bg-[#fff8ea] p-0 text-[#8a4a0d] transition-colors hover:bg-[#fff0cf];
}

.favorites-remove-icon {
  @apply h-4 w-4;
}

.favorites-card-text {
  @apply m-0 whitespace-pre-wrap break-words text-sm leading-[1.7] text-[#2b241d];
}

.favorites-card-actions {
  @apply flex flex-wrap gap-2;
}

.favorites-action {
  @apply inline-flex items-center gap-1.5 rounded-full border border-[#ddd5c7] bg-[#fffdf8] px-3 py-1.5 text-xs font-medium text-[#5c5144] transition-colors hover:border-[#cdbfa9] hover:bg-[#f4ede1];
}

.favorites-action-primary {
  @apply border-[#cce6de] bg-[#eef8f5] text-[#0f766e] hover:border-[#a7d5c7] hover:bg-[#e4f4ee];
}

.favorites-action-icon {
  @apply h-3.5 w-3.5;
}

@media (max-width: 767px) {
  .favorites-panel {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    max-height: min(82vh, 720px);
  }
}
</style>
