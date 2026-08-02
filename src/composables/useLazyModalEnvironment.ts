import { nextTick, onBeforeUnmount, watch, type WatchSource } from 'vue'
import type { ModalEnvironmentRelease } from '../utils/modalEnvironment'

export function useLazyModalEnvironment<State>(
  source: WatchSource<State | null | false>,
  resolvePanel: (state: State) => HTMLElement | null,
  resolvePreviousFocus: () => HTMLElement | null,
  resolveScrollOwner?: () => HTMLElement,
  isModal?: (state: State) => boolean,
  resolveInertTargets?: () => Iterable<HTMLElement>,
): void {
  let release: ModalEnvironmentRelease | null = null
  let generation = 0

  watch(source, async (state) => {
    const currentGeneration = ++generation
    release?.()
    release = null
    if (!state) return
    const previousFocus = resolvePreviousFocus()
    await nextTick()
    const panel = resolvePanel(state)
    if (!panel) return
    if (isModal && !isModal(state)) {
      panel.focus({ preventScroll: true })
      return
    }
    const { ownModalEnvironment } = await import('../utils/modalEnvironment')
    if (currentGeneration !== generation || resolvePanel(state) !== panel) return
    release = ownModalEnvironment(
      panel,
      previousFocus,
      resolveScrollOwner?.(),
      resolveInertTargets?.(),
    )
  }, { immediate: true })

  onBeforeUnmount(() => {
    generation += 1
    release?.()
  })
}
