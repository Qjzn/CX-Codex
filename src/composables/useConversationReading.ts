import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'

// A bounded copy of the mounted presentation, never another source of turn facts.
// Keeping text unchanged also keeps v-html from replacing the user's selection.
export function useConversationReading<T>(
  root: Ref<HTMLElement | null>,
  capture: () => Map<string, T[]>,
) {
  const frozen = shallowRef(new Map<string, T[]>())
  const protectedReading = shallowRef(false)
  function protect(): void {
    if (protectedReading.value) return
    frozen.value = capture()
    protectedReading.value = true
  }
  function reset(): void {
    frozen.value = new Map()
    protectedReading.value = false
  }
  function refresh(turnKey: string, entries: T[]): void {
    if (!protectedReading.value) return
    retainMounted()
    frozen.value = new Map(frozen.value).set(turnKey, entries)
  }
  function retainMounted(): void {
    if (frozen.value.size === 0) return
    const mountedKeys = new Set(capture().keys())
    frozen.value = new Map([...frozen.value].filter(([key]) => mountedKeys.has(key)))
  }
  function onSelectionChange(): void {
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed
      && root.value?.contains(selection.anchorNode) && root.value.contains(selection.focusNode)) protect()
  }
  function onFocusIn(event: FocusEvent): void {
    const target = event.target
    if (target instanceof Element && target.closest('.turn-process')) protect()
  }
  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
  })
  watch(root, (value, previous) => {
    previous?.removeEventListener('focusin', onFocusIn)
    value?.addEventListener('focusin', onFocusIn)
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    root.value?.removeEventListener('focusin', onFocusIn)
  })
  return { frozen, protectedReading, protect, reset, refresh, retainMounted }
}
