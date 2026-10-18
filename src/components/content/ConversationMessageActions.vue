<template>
  <div class="message-actions" :class="{ 'message-actions--user': align === 'end' }">
    <slot />
    <button v-if="text" type="button" class="message-action" :aria-label="copied ? '已复制' : `复制${label}`"
      :title="copied ? '已复制' : '复制'" :disabled="copying" @click="copy">
      <IconTablerCheck v-if="copied" aria-hidden="true" /><IconTablerCopy v-else aria-hidden="true" />
    </button>
    <button v-if="favorite !== undefined || rollback" ref="trigger" type="button" class="message-action"
      :class="{ 'is-open': open }" :aria-label="`${label}更多操作`" title="更多操作" aria-haspopup="menu"
      :aria-expanded="open" :aria-controls="open ? menuId : undefined" @click="toggle" @keydown.down.prevent="show">
      <IconTablerDots aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="open" :id="menuId" ref="menu" class="conversation-message-menu" role="menu"
        :aria-label="`${label}操作`" :style="position" @keydown="onMenuKeydown">
        <button v-if="favorite !== undefined" type="button" role="menuitem" @click="chooseFavorite">
          <IconTablerBookmark aria-hidden="true" />{{ favorite ? '取消收藏' : '收藏' }}
        </button>
        <button v-if="rollback" type="button" role="menuitem" :class="{ 'is-confirming': confirmingRollback }" @click="chooseRollback">
          <IconTablerArrowBackUp aria-hidden="true" />{{ confirmingRollback ? '确认回退' : '回退到此轮' }}
        </button>
      </div>
    </Teleport>
    <span class="action-announcement" role="status">{{ copied ? '已复制' : '' }}</span>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import IconTablerCheck from '../icons/IconTablerCheck.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerBookmark from '../icons/IconTablerBookmark.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import { copyTextToClipboard } from '../../utils/clipboard'

const props = withDefaults(defineProps<{
  text: string
  label?: string
  align?: 'start' | 'end'
  favorite?: boolean
  rollback?: boolean
  confirmingRollback?: boolean
}>(), { label: '回复', align: 'start', favorite: undefined })
const emit = defineEmits<{
  favorite: []
  rollback: []
  copyStatus: [payload: { message: string; tone: 'danger' }]
}>()
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const copied = ref(false)
const copying = ref(false)
const position = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })
const menuId = `message-menu-${useId()}`
let copyTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const dismissEvent = 'cx-dismiss-message-menus'

async function copy(): Promise<void> {
  if (copying.value) return
  clearTimeout(copyTimer)
  copied.value = false
  copying.value = true
  try {
    await copyTextToClipboard(props.text)
    if (disposed) return
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    if (!disposed) emit('copyStatus', { message: '复制失败，请手动选择内容', tone: 'danger' })
  } finally { copying.value = false }
}

function hide(restoreFocus = false): void {
  if (!open.value) return
  open.value = false
  if (restoreFocus && trigger.value?.isConnected) trigger.value.focus({ preventScroll: true })
}
async function show(): Promise<void> {
  if (!trigger.value || open.value) return
  window.dispatchEvent(new Event(dismissEvent))
  open.value = true
  position.value.visibility = 'hidden'
  await nextTick()
  if (!open.value || !menu.value || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const bounds = menu.value.getBoundingClientRect()
  const view = window.visualViewport
  const leftEdge = view?.offsetLeft ?? 0
  const topEdge = view?.offsetTop ?? 0
  const width = view?.width ?? window.innerWidth
  const height = view?.height ?? window.innerHeight
  const left = Math.max(leftEdge + 8, Math.min(anchor.right - bounds.width, leftEdge + width - bounds.width - 8))
  const below = anchor.bottom + 4
  const top = Math.max(topEdge + 8, below + bounds.height <= topEdge + height - 8 ? below : anchor.top - bounds.height - 4)
  position.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
  // Vue must remove visibility:hidden before this element can receive focus.
  await nextTick()
  if (!open.value || !menu.value) return
  menu.value.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}
function toggle(): void { if (open.value) hide(true); else void show() }
function chooseFavorite(): void { hide(true); emit('favorite') }
function chooseRollback(): void {
  // The owning turn retains its existing two-step confirmation and eligibility.
  if (props.confirmingRollback) hide(true)
  emit('rollback')
}
function onMenuKeydown(event: KeyboardEvent): void {
  const actions = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  const index = actions.indexOf(document.activeElement as HTMLButtonElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length
    actions[next]?.focus()
  } else if (event.key === 'Tab') hide(true)
}
function escape(event: Event): void {
  if (!open.value || (event as KeyboardEvent).key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  hide(true)
}
function outside(event: Event): void {
  if (!menu.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) hide()
}
function dismissOtherMenu(): void { hide() }
function viewportChanged(event?: Event): void {
  if (event?.target instanceof Node && menu.value?.contains(event.target)) return
  hide(menu.value?.contains(document.activeElement) ?? false)
}
watch(open, (value) => {
  const method = value ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside, true)
  document[method]('keydown', escape, true)
  document[method]('scroll', viewportChanged, true)
  window[method]('resize', viewportChanged)
  window[method](dismissEvent, dismissOtherMenu)
  window.visualViewport?.[method]('resize', viewportChanged)
  window.visualViewport?.[method]('scroll', viewportChanged)
}, { flush: 'sync' })
watch(() => [props.favorite, props.rollback], () => {
  if (props.favorite === undefined && !props.rollback) hide(true)
})
onBeforeUnmount(() => { disposed = true; hide(); clearTimeout(copyTimer) })
</script>

<style scoped>
.message-actions { display: flex; align-items: center; gap: 2px; min-height: 28px; margin-top: 4px; color: var(--ui-text-tertiary); }
.message-actions--user { justify-content: flex-end; }
.message-action { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; }
.message-action svg { width: 16px; height: 16px; }
.message-action:hover, .message-action.is-open { background: var(--ui-bg-row-hover); color: var(--ui-text-primary); }
.message-action:focus-visible, .conversation-message-menu button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.message-action:disabled { cursor: default; }
.conversation-message-menu { position: fixed; z-index: var(--ui-z-popover, 70); box-sizing: border-box; width: 176px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; padding: 4px; border: 1px solid var(--ui-border-subtle); border-radius: 10px; background: var(--ui-bg-surface); color: var(--ui-text-primary); box-shadow: var(--ui-shadow-float); }
.conversation-message-menu button { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 36px; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.conversation-message-menu button:hover, .conversation-message-menu button:focus { background: var(--ui-bg-row-hover); }
.conversation-message-menu button.is-confirming { color: var(--ui-danger); }
.conversation-message-menu svg { width: 16px; height: 16px; flex-shrink: 0; }
.action-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (pointer: coarse), (max-width: 767px) {
  .message-actions { min-height: 44px; }
  .message-action { width: 44px; height: 44px; padding: 12px; }
  .conversation-message-menu button { min-height: 44px; }
}
</style>
