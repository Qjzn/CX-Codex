<template>
  <div ref="rootRef" class="search-dropdown">
    <button
      class="search-dropdown-trigger"
      :class="{ 'is-icon': isIconTrigger, 'has-selection': triggerSelectedCount > 0 }"
      type="button"
      :disabled="disabled"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      @click="onToggle"
    >
      <slot v-if="isIconTrigger" name="trigger-icon" />
      <span class="search-dropdown-value">{{ displayLabel }}</span>
      <span v-if="isIconTrigger && triggerSelectedCount > 0" class="search-dropdown-count" aria-hidden="true">
        {{ triggerSelectedCountLabel }}
      </span>
      <IconTablerChevronDown v-if="!isIconTrigger" class="search-dropdown-chevron" />
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        class="search-dropdown-mobile-overlay"
        :class="{ 'is-mobile': isMobileViewport, 'is-desktop': !isMobileViewport }"
        :style="overlayStyle"
        @click.self="closeMenu"
      >
        <div ref="menuRef" class="search-dropdown-mobile-dialog" :style="mobileDialogStyle">
          <div class="search-dropdown-dialog-head">
            <div class="search-dropdown-dialog-handle" aria-hidden="true" />
            <div class="search-dropdown-dialog-title-row">
              <p class="search-dropdown-dialog-title">选择技能</p>
              <button
                class="search-dropdown-dialog-close"
                type="button"
                aria-label="关闭技能弹窗"
                @click="closeMenu"
              >
                关闭
              </button>
            </div>
          </div>
          <div class="search-dropdown-search-wrap">
            <input
              ref="searchRef"
              v-model="searchQuery"
              class="search-dropdown-search"
              type="text"
              :placeholder="searchPlaceholder"
              @keydown.escape.prevent="closeMenu"
              @keydown.enter.prevent="selectHighlighted"
              @keydown.arrow-down.prevent="moveHighlight(1)"
              @keydown.arrow-up.prevent="moveHighlight(-1)"
            />
          </div>
          <ul
            v-if="filtered.length > 0"
            class="search-dropdown-list"
            :style="mobileListStyle"
            role="listbox"
          >
            <li v-for="(opt, idx) in filtered" :key="opt.value">
              <button
                class="search-dropdown-option"
                :class="{
                  'is-selected': selected.has(opt.value),
                  'is-highlighted': idx === highlightIdx,
                }"
                type="button"
                @click="onSelect(opt)"
                @pointerenter="highlightIdx = idx"
              >
                <span class="search-dropdown-option-check">{{ selected.has(opt.value) ? '✓' : '' }}</span>
                <span class="search-dropdown-option-label">{{ opt.label }}</span>
                <span v-if="opt.description" class="search-dropdown-option-desc">{{ opt.description }}</span>
              </button>
            </li>
          </ul>
          <div v-else class="search-dropdown-empty">没有结果</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'

export type SearchDropdownOption = {
  value: string
  label: string
  description?: string
}

const props = defineProps<{
  options: SearchDropdownOption[]
  selectedValues: string[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  openDirection?: 'up' | 'down'
  triggerVariant?: 'text' | 'icon'
  triggerAriaLabel?: string
  triggerDisplayLabel?: string
  selectedCount?: number
}>()

const emit = defineEmits<{
  toggle: [value: string, checked: boolean]
}>()

const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const searchQuery = ref('')
const highlightIdx = ref(0)
const viewportHeight = ref(typeof window !== 'undefined'
  ? window.visualViewport?.height ?? window.innerHeight
  : 0)
const viewportBottomInset = ref(0)
const isMobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth < 640 : false)

const selected = computed(() => new Set(props.selectedValues))
const isIconTrigger = computed(() => props.triggerVariant === 'icon')
const triggerLabel = computed(() => props.triggerAriaLabel || displayLabel.value)
const triggerSelectedCount = computed(() => Math.max(0, props.selectedCount ?? props.selectedValues.length))
const triggerSelectedCountLabel = computed(() => (
  triggerSelectedCount.value > 9 ? '9+' : String(triggerSelectedCount.value)
))
const overlayStyle = computed(() => {
  const baseInset = isMobileViewport.value ? 12 : 20
  return {
    paddingBottom: `${Math.max(baseInset, viewportBottomInset.value + baseInset)}px`,
  }
})
const mobileDialogStyle = computed(() => {
  const maxHeight = isMobileViewport.value
    ? Math.max(280, Math.floor(viewportHeight.value - 24))
    : Math.max(320, Math.min(560, Math.floor(viewportHeight.value - 40)))
  return {
    maxHeight: `${maxHeight}px`,
    minHeight: '0px',
  }
})
const mobileListStyle = computed(() => {
  if (!isMobileViewport.value) return undefined
  const defaultRowsHeight = 6 * 52
  const availableHeight = Math.max(180, Math.floor(viewportHeight.value - 152))
  return {
    maxHeight: `${Math.min(defaultRowsHeight, availableHeight)}px`,
  }
})

const displayLabel = computed(() => {
  if (props.triggerDisplayLabel) return props.triggerDisplayLabel
  if (props.selectedValues.length === 0) return props.placeholder || '请选择...'
  if (props.selectedValues.length === 1) {
    const opt = props.options.find((o) => o.value === props.selectedValues[0])
    return opt?.label || props.placeholder || '请选择...'
  }
  return `已选 ${props.selectedValues.length} 项`
})

const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      (o.description?.toLowerCase().includes(q) ?? false),
  )
})

function updateViewportMetrics(): void {
  if (typeof window === 'undefined') return
  const visualViewport = window.visualViewport
  isMobileViewport.value = window.innerWidth < 640
  viewportHeight.value = visualViewport?.height ?? window.innerHeight
  viewportBottomInset.value = Math.max(
    0,
    window.innerHeight - ((visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0)),
  )
}

function closeMenu(): void {
  isOpen.value = false
}

function onToggle(): void {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (!isOpen.value) return
  searchQuery.value = ''
  highlightIdx.value = 0
}

function onSelect(opt: SearchDropdownOption): void {
  emit('toggle', opt.value, !selected.value.has(opt.value))
  closeMenu()
}

function moveHighlight(delta: number): void {
  if (filtered.value.length === 0) return
  highlightIdx.value = (highlightIdx.value + delta + filtered.value.length) % filtered.value.length
}

function selectHighlighted(): void {
  const opt = filtered.value[highlightIdx.value]
  if (opt) onSelect(opt)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return
  const root = rootRef.value
  const menu = menuRef.value
  const target = event.target
  if (!(target instanceof Node)) return
  if (root?.contains(target)) return
  if (menu?.contains(target)) return
  closeMenu()
}

watch(searchQuery, () => {
  highlightIdx.value = 0
})

onMounted(() => {
  updateViewportMetrics()
  window.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('resize', updateViewportMetrics)
  window.visualViewport?.addEventListener('resize', updateViewportMetrics)
  window.visualViewport?.addEventListener('scroll', updateViewportMetrics)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('resize', updateViewportMetrics)
  window.visualViewport?.removeEventListener('resize', updateViewportMetrics)
  window.visualViewport?.removeEventListener('scroll', updateViewportMetrics)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
})

watch(
  () => [isOpen.value, isMobileViewport.value] as const,
  ([open, mobile]) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open && mobile ? 'hidden' : ''
  },
  { immediate: true },
)

</script>

<style scoped>
@reference "tailwindcss";

.search-dropdown {
  @apply relative inline-flex min-w-0;
}

.search-dropdown-trigger {
  @apply inline-flex h-7 items-center gap-1 border-0 bg-transparent p-0 text-sm leading-none text-zinc-500 outline-none transition;
}

.search-dropdown-trigger.is-icon {
  @apply relative justify-center gap-0;
}

.search-dropdown-trigger:disabled {
  @apply cursor-not-allowed text-zinc-500;
}

.search-dropdown-value {
  @apply whitespace-nowrap text-left;
}

.search-dropdown-trigger.is-icon .search-dropdown-value {
  @apply sr-only;
}

.search-dropdown-trigger.is-icon :slotted(svg) {
  @apply h-4 w-4;
}

.search-dropdown-count {
  @apply absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0f766e] px-1 text-[10px] font-semibold leading-none text-white shadow-sm;
}

.search-dropdown-chevron {
  @apply mt-px h-3.5 w-3.5 shrink-0 text-zinc-500;
}

.search-dropdown-menu-wrap {
  overscroll-behavior: contain;
}

.search-dropdown-mobile-overlay {
  @apply fixed inset-0 z-[220] flex justify-center bg-black/32 p-4;
}

.search-dropdown-mobile-overlay.is-mobile {
  @apply items-end px-3 pt-3;
}

.search-dropdown-mobile-overlay.is-desktop {
  @apply items-end px-4 pt-6;
}

.search-dropdown-mobile-dialog {
  @apply w-full max-w-[34rem] overflow-hidden rounded-[24px] border border-[#e5dccd] bg-[#fffdf8] shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)];
  display: flex;
  flex-direction: column;
}

.search-dropdown-dialog-head {
  @apply shrink-0 bg-[#fffdf8] px-3 pt-3 pb-2;
}

.search-dropdown-dialog-handle {
  @apply mx-auto mb-2 h-1 w-10 rounded-full bg-[#d8d0c2];
}

.search-dropdown-dialog-title-row {
  @apply flex items-center justify-between gap-3;
}

.search-dropdown-dialog-title {
  @apply m-0 text-sm font-semibold text-zinc-800;
}

.search-dropdown-dialog-close {
  @apply inline-flex h-8 shrink-0 items-center rounded-full border border-[#e5dccd] bg-white px-3 text-xs font-medium text-zinc-600 transition hover:bg-[#f6f1e8] hover:text-zinc-900;
}

.search-dropdown-search-wrap {
  @apply shrink-0 p-1.5 border-b border-zinc-100 bg-white;
  position: sticky;
  top: 0;
  z-index: 1;
}

.search-dropdown-search {
  @apply w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm text-zinc-800 outline-none placeholder-zinc-400 transition focus:border-zinc-300 focus:bg-white;
}

.search-dropdown-list {
  @apply m-0 min-h-0 flex-1 list-none overflow-y-auto p-1;
  overscroll-behavior: contain;
  max-height: 312px;
}

.search-dropdown-option {
  @apply flex w-full items-start gap-1.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100;
}

.search-dropdown-option.is-highlighted {
  @apply bg-zinc-100;
}

.search-dropdown-option.is-selected {
  @apply text-zinc-900;
}

.search-dropdown-option-check {
  @apply w-4 shrink-0 text-center text-xs leading-5 text-emerald-600;
}

.search-dropdown-option-label {
  @apply flex-1 min-w-0 truncate;
}

.search-dropdown-option-desc {
  @apply text-xs text-zinc-400 truncate max-w-32 max-sm:max-w-none max-sm:flex-1;
}

.search-dropdown-empty {
  @apply p-3 text-center text-sm text-zinc-400;
}

@media (max-width: 639px) {
  .search-dropdown-mobile-dialog {
    @apply max-w-[28rem];
  }

  .search-dropdown-option {
    @apply px-3 py-3 text-[15px];
  }

  .search-dropdown-search {
    @apply py-2 text-[15px];
  }
}
</style>
