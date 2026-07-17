<template>
  <div
    class="desktop-layout"
    :class="{ 'is-mobile': isMobile, 'is-dual-pane-touch': isDualPaneMobile }"
    :style="layoutStyle"
  >
    <Teleport v-if="isMobile" to="body">
      <Transition name="drawer">
        <div v-if="!isSidebarCollapsed" class="mobile-drawer-backdrop" @click="$emit('close-sidebar')">
          <aside class="mobile-drawer" @click.stop>
            <slot name="sidebar" />
          </aside>
        </div>
      </Transition>
    </Teleport>

    <template v-if="!isMobile">
      <aside v-if="!isSidebarCollapsed" class="desktop-sidebar">
        <slot name="sidebar" />
      </aside>
      <button
        v-if="!isSidebarCollapsed"
        class="desktop-resize-handle"
        type="button"
        aria-label="Resize sidebar"
        @pointerdown="onResizeHandlePointerDown"
      />
    </template>

    <section class="desktop-main">
      <slot name="content" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMobile } from '../../composables/useMobile'

const props = withDefaults(
  defineProps<{
    isSidebarCollapsed?: boolean
  }>(),
  {
    isSidebarCollapsed: false,
  },
)

defineEmits<{
  'close-sidebar': []
}>()

const { isMobile, isDualPaneMobile, viewportWidth } = useMobile()

const SIDEBAR_WIDTH_KEY = 'codex-web-local.sidebar-width.v1'
const MIN_SIDEBAR_WIDTH = 260
const MAX_SIDEBAR_WIDTH = 420
const DEFAULT_SIDEBAR_WIDTH = 356
const TOUCH_DUAL_PANE_MIN_SIDEBAR_WIDTH = 236
const TOUCH_DUAL_PANE_MAX_SIDEBAR_WIDTH = 340
const TOUCH_DUAL_PANE_SIDEBAR_RATIO = 0.31
const TOUCH_DUAL_PANE_MIN_CONTENT_WIDTH = 430
const RESIZE_HANDLE_WIDTH = 6

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

function clampTouchDualPaneSidebarWidth(value: number): number {
  return Math.min(TOUCH_DUAL_PANE_MAX_SIDEBAR_WIDTH, Math.max(TOUCH_DUAL_PANE_MIN_SIDEBAR_WIDTH, value))
}

function loadSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH
  return clampSidebarWidth(parsed)
}

const sidebarWidth = ref(loadSidebarWidth())
const touchDualPaneMaxSidebarWidth = computed(() => Math.max(
  TOUCH_DUAL_PANE_MIN_SIDEBAR_WIDTH,
  viewportWidth.value - TOUCH_DUAL_PANE_MIN_CONTENT_WIDTH,
))
const resolvedSidebarWidth = computed(() => {
  if (!isDualPaneMobile.value) return sidebarWidth.value
  const ratioWidth = Math.round(viewportWidth.value * TOUCH_DUAL_PANE_SIDEBAR_RATIO)
  const preferredWidth = sidebarWidth.value === DEFAULT_SIDEBAR_WIDTH ? ratioWidth : sidebarWidth.value
  return clampTouchDualPaneSidebarWidth(Math.min(preferredWidth, touchDualPaneMaxSidebarWidth.value))
})
const layoutStyle = computed(() => {
  if (isMobile.value || props.isSidebarCollapsed) {
    return {
      '--sidebar-width': '0px',
      '--layout-columns': 'minmax(0, 1fr)',
    }
  }
  if (isDualPaneMobile.value) {
    return {
      '--sidebar-width': `${resolvedSidebarWidth.value}px`,
      '--layout-columns': `var(--sidebar-width) ${RESIZE_HANDLE_WIDTH}px minmax(0, 1fr)`,
    }
  }
  return {
    '--sidebar-width': `${resolvedSidebarWidth.value}px`,
    '--layout-columns': `var(--sidebar-width) ${RESIZE_HANDLE_WIDTH}px minmax(0, 1fr)`,
  }
})

function clampResolvedSidebarWidth(value: number): number {
  if (!isDualPaneMobile.value) return clampSidebarWidth(value)
  return clampTouchDualPaneSidebarWidth(Math.min(value, touchDualPaneMaxSidebarWidth.value))
}

function saveSidebarWidth(value: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(value))
}

function onResizeHandlePointerDown(event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = resolvedSidebarWidth.value
  let nextWidth = startWidth
  let frameId: number | null = null
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const applyPendingWidth = () => {
    frameId = null
    sidebarWidth.value = nextWidth
  }

  const onPointerMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX
    nextWidth = clampResolvedSidebarWidth(startWidth + delta)
    if (frameId === null) {
      frameId = window.requestAnimationFrame(applyPendingWidth)
    }
  }

  const finishResize = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    sidebarWidth.value = nextWidth
    saveSidebarWidth(nextWidth)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finishResize)
    window.removeEventListener('pointercancel', finishResize)
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
}
</script>

<style scoped>
@reference "tailwindcss";

.desktop-layout {
  @apply grid text-slate-900 overflow-hidden;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  grid-template-columns: var(--layout-columns);
  background: var(--ui-bg-window);
}

.desktop-sidebar {
  @apply min-h-0 overflow-hidden border-r;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-sidebar);
}

.desktop-layout.is-dual-pane-touch .desktop-sidebar {
  background: var(--ui-bg-sidebar);
  box-shadow: none;
}

.desktop-resize-handle {
  @apply relative cursor-col-resize bg-transparent transition;
  touch-action: none;
}

.desktop-resize-handle::before {
  content: '';
  @apply absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 transition-colors;
  background: var(--ui-border-subtle);
}

.desktop-resize-handle:hover::before,
.desktop-resize-handle:focus-visible::before,
.desktop-resize-handle:active::before {
  background: var(--ui-border-strong);
}

.desktop-main {
  @apply relative min-h-0 min-w-0 overflow-y-hidden overflow-x-visible;
  background: var(--ui-bg-surface);
  touch-action: pan-y;
  overscroll-behavior: contain;
}

.mobile-drawer-backdrop {
  @apply fixed inset-0 z-[60] bg-[#1f2937]/28;
  overflow: hidden;
}

.mobile-drawer {
  @apply absolute top-0 left-0 bottom-0 w-full max-w-none overflow-hidden border-r;
  border-color: var(--ui-border-subtle);
  width: 100vw;
  max-width: 100vw;
  border-top-right-radius: 1.5rem;
  border-bottom-right-radius: 1.5rem;
  padding-left: max(0px, env(safe-area-inset-left));
  isolation: isolate;
  background: var(--ui-bg-sidebar);
  box-shadow: 0 16px 36px -34px rgba(31, 31, 31, 0.24);
}

@media (min-width: 768px) {
  .mobile-drawer {
    width: min(26rem, calc(100vw - 1rem));
    max-width: min(26rem, calc(100vw - 1rem));
  }
}

@media (max-width: 767px) {
  .mobile-drawer {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
}

.drawer-enter-active .mobile-drawer {
  transition:
    transform var(--motion-duration-panel) var(--motion-ease-out),
    opacity var(--motion-duration-base) var(--motion-ease-standard);
}

.drawer-leave-active .mobile-drawer {
  transition:
    transform var(--motion-duration-base) var(--motion-ease-standard),
    opacity var(--motion-duration-fast) var(--motion-ease-standard);
}

.drawer-enter-from {
  @apply opacity-0;
}

.drawer-enter-from .mobile-drawer {
  transform: translateX(-1rem);
  opacity: 0;
}

.drawer-leave-to {
  @apply opacity-0;
}

.drawer-leave-to .mobile-drawer {
  transform: translateX(-0.75rem);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .drawer-enter-from .mobile-drawer,
  .drawer-leave-to .mobile-drawer {
    transform: none;
  }
}
</style>
