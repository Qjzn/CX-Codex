<template>
  <div ref="rootRef" class="composer-dropdown">
    <button
      class="composer-dropdown-trigger"
      type="button"
      :disabled="disabled"
      :aria-label="triggerAriaLabelText"
      @click="onToggle"
    >
      <component :is="selectedPrefixIcon" v-if="selectedPrefixIcon" class="composer-dropdown-prefix-icon" />
      <span class="composer-dropdown-value">{{ selectedLabel }}</span>
      <IconTablerChevronDown class="composer-dropdown-chevron" />
    </button>

    <div
      v-if="isOpen"
      class="composer-dropdown-menu-wrap"
      :class="isMobileViewport
        ? 'composer-dropdown-menu-wrap-dialog'
        : openDirection === 'up'
          ? 'composer-dropdown-menu-wrap-up'
          : 'composer-dropdown-menu-wrap-down'"
      @click.self="closeMenu"
    >
      <div ref="menuRef" class="composer-dropdown-menu" :style="mobileDialogStyle">
        <div v-if="isMobileViewport" class="composer-dropdown-dialog-head">
          <div class="composer-dropdown-dialog-handle" aria-hidden="true" />
          <p class="composer-dropdown-dialog-title">{{ menuTitleLabel || placeholder?.trim() || '请选择' }}</p>
        </div>

        <div v-if="enableSearch" class="composer-dropdown-search-wrap">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            class="composer-dropdown-search-input"
            type="text"
            :placeholder="searchPlaceholderText"
            @keydown.esc.prevent="onEscapeSearch"
          />
        </div>

        <ul class="composer-dropdown-options" role="listbox">
          <li v-for="option in filteredOptions" :key="option.value">
            <button
              class="composer-dropdown-option"
              :class="{ 'is-selected': option.value === modelValue }"
              type="button"
              @click="onSelect(option.value)"
            >
              <span class="composer-dropdown-option-copy">
                <span class="composer-dropdown-option-label">{{ option.label }}</span>
                <span v-if="option.description" class="composer-dropdown-option-description">
                  {{ option.description }}
                </span>
              </span>
            </button>
          </li>
          <li v-if="filteredOptions.length === 0" class="composer-dropdown-empty">
            没有匹配的项目
          </li>
        </ul>

        <div v-if="showAddAction" class="composer-dropdown-add-wrap">
          <template v-if="isAdding">
            <input
              ref="addInputRef"
              v-model="addDraft"
              class="composer-dropdown-add-input"
              type="text"
              :placeholder="addPlaceholderText"
              @keydown.enter.prevent="onConfirmAdd"
              @keydown.esc.prevent="onCancelAdd"
            />
            <div class="composer-dropdown-add-actions">
              <button type="button" class="composer-dropdown-add-btn" @click="onConfirmAdd">打开</button>
              <button type="button" class="composer-dropdown-add-btn" @click="onCancelAdd">取消</button>
            </div>
          </template>
          <button
            v-else
            type="button"
            class="composer-dropdown-add"
            @click="onStartAdd"
          >
            {{ addActionLabelText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'

type DropdownOption = {
  value: string
  label: string
  description?: string
}

const props = defineProps<{
  modelValue: string
  options: DropdownOption[]
  placeholder?: string
  triggerDisplayLabel?: string
  triggerAriaLabel?: string
  disabled?: boolean
  selectedPrefixIcon?: Component | null
  openDirection?: 'up' | 'down'
  enableSearch?: boolean
  searchPlaceholder?: string
  showAddAction?: boolean
  addActionLabel?: string
  defaultAddValue?: string
  addPlaceholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  add: [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const addInputRef = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const searchQuery = ref('')
const isAdding = ref(false)
const addDraft = ref('')
const viewportHeight = ref(typeof window !== 'undefined'
  ? window.visualViewport?.height ?? window.innerHeight
  : 0)
const isMobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth < 640 : false)

const selectedLabel = computed(() => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  const triggerLabel = props.triggerDisplayLabel?.trim()
  if (triggerLabel) return triggerLabel
  if (selected) return selected.label
  return props.placeholder?.trim() || ''
})
const menuTitleLabel = computed(() => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  if (selected) return selected.label
  return props.placeholder?.trim() || ''
})
const triggerAriaLabelText = computed(() =>
  props.triggerAriaLabel?.trim()
  || selectedLabel.value
  || props.placeholder?.trim()
  || '选择项目',
)

const openDirection = computed(() => props.openDirection ?? 'down')
const enableSearch = computed(() => props.enableSearch === true)
const showAddAction = computed(() => props.showAddAction === true)
const searchPlaceholderText = computed(() => props.searchPlaceholder?.trim() || '快速搜索项目')
const addActionLabelText = computed(() => props.addActionLabel?.trim() || '新增项目')
const addPlaceholderText = computed(() => props.addPlaceholder?.trim() || '项目名或绝对路径')
const mobileDialogStyle = computed(() => {
  if (!isMobileViewport.value) return undefined
  const maxHeight = Math.max(280, Math.floor(viewportHeight.value - 72))
  return { maxHeight: `${maxHeight}px` }
})
const filteredOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter((option) => {
    return option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)
  })
})

function updateViewportMetrics(): void {
  if (typeof window === 'undefined') return
  isMobileViewport.value = window.innerWidth < 640
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight
}

function closeMenu(): void {
  isOpen.value = false
  searchQuery.value = ''
  isAdding.value = false
  addDraft.value = ''
}

function onToggle(): void {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (!isOpen.value) {
    closeMenu()
    return
  }
  searchQuery.value = ''
  isAdding.value = false
  addDraft.value = ''
}

function onSelect(value: string): void {
  emit('update:modelValue', value)
  closeMenu()
}

function onStartAdd(): void {
  isAdding.value = true
  addDraft.value = props.defaultAddValue?.trim() || ''
  nextTick(() => addInputRef.value?.focus())
}

function onEscapeSearch(): void {
  if (searchQuery.value.length > 0) {
    searchQuery.value = ''
    return
  }
  closeMenu()
}

function onConfirmAdd(): void {
  const value = addDraft.value.trim()
  if (!value) return
  emit('add', value)
  closeMenu()
}

function onCancelAdd(): void {
  closeMenu()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return
  const root = rootRef.value
  if (!root) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (root.contains(target)) return
  closeMenu()
}

watch(isOpen, (open) => {
  if (!open) return
  nextTick(() => {
    if (isAdding.value) {
      addInputRef.value?.focus()
      return
    }
    if (enableSearch.value) {
      searchInputRef.value?.focus()
    }
  })
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
})
</script>

<style scoped>
@reference "tailwindcss";

.composer-dropdown {
  @apply relative inline-flex min-w-0;
}

.composer-dropdown-trigger {
  @apply inline-flex h-7 min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-sm leading-none text-zinc-500 outline-none transition;
  font-family: var(--font-sans-ui);
  letter-spacing: 0;
}

.composer-dropdown-prefix-icon {
  @apply h-3.5 w-3.5 shrink-0 text-amber-500;
}

.composer-dropdown-trigger:disabled {
  @apply cursor-not-allowed text-zinc-500;
}

.composer-dropdown-value {
  @apply whitespace-nowrap text-left truncate;
}

.composer-dropdown-chevron {
  @apply mt-px h-3.5 w-3.5 shrink-0 text-zinc-500;
}

.composer-dropdown-menu-wrap-up,
.composer-dropdown-menu-wrap-down {
  @apply absolute left-0 z-[90];
}

.composer-dropdown-menu-wrap-down {
  @apply top-[calc(100%+8px)];
}

.composer-dropdown-menu-wrap-up {
  @apply bottom-[calc(100%+8px)];
}

.composer-dropdown-menu-wrap-dialog {
  @apply fixed inset-0 z-[120] flex items-center justify-center bg-black/24 p-4;
}

.composer-dropdown-menu {
  @apply min-w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg overflow-hidden;
  display: flex;
  flex-direction: column;
}

.composer-dropdown-dialog-head {
  @apply shrink-0 bg-white pt-2 pb-1;
}

.composer-dropdown-dialog-handle {
  @apply mx-auto mb-2 h-1 w-10 rounded-full bg-[#d8d0c2];
}

.composer-dropdown-dialog-title {
  @apply m-0 px-2 text-center text-sm font-semibold text-zinc-800;
  font-family: var(--font-sans-reading);
  letter-spacing: 0;
}

.composer-dropdown-search-wrap {
  @apply shrink-0 px-1 pb-1 bg-white;
  position: sticky;
  top: 0;
  z-index: 1;
}

.composer-dropdown-search-input {
  @apply w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none transition focus:border-zinc-400;
}

.composer-dropdown-options {
  @apply m-0 min-h-0 flex-1 list-none overflow-y-auto p-0;
  overscroll-behavior: contain;
}

.composer-dropdown-option {
  @apply flex w-full items-center justify-between gap-3 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100;
}

.composer-dropdown-option.is-selected {
  @apply bg-zinc-100;
}

.composer-dropdown-option.is-selected::after {
  content: '✓';
  @apply shrink-0 text-base leading-none text-zinc-600;
}

.composer-dropdown-option-copy {
  @apply min-w-0;
}

.composer-dropdown-option-label {
  @apply block truncate;
}

.composer-dropdown-option-description {
  @apply mt-0.5 block text-xs leading-snug text-zinc-500;
}

.composer-dropdown-empty {
  @apply px-2 py-1.5 text-xs text-zinc-500;
}

.composer-dropdown-add {
  @apply mt-1 flex w-full items-center rounded-lg border-0 border-t border-zinc-200 bg-transparent px-2 py-2 text-left text-sm font-medium text-zinc-800 transition hover:bg-zinc-100;
}

.composer-dropdown-add-wrap {
  @apply mt-1 border-t border-zinc-200 pt-1 shrink-0 bg-white;
}

.composer-dropdown-add-input {
  @apply w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none transition focus:border-zinc-400;
}

.composer-dropdown-add-actions {
  @apply mt-1 flex items-center gap-1;
}

.composer-dropdown-add-btn {
  @apply rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 transition hover:bg-zinc-100;
}

@media (max-width: 639px) {
  .composer-dropdown-menu {
    @apply w-full max-w-[28rem] rounded-[22px] shadow-[0_18px_40px_-24px_rgba(15,23,42,0.42)];
  }

  .composer-dropdown-option {
    @apply px-3 py-3 text-[15px];
  }

  .composer-dropdown-search-input,
  .composer-dropdown-add-input {
    @apply py-2 text-[15px];
  }
}
</style>
