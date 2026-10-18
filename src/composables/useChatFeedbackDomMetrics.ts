import { onBeforeUnmount, onMounted, onUpdated, watch, type Ref } from 'vue'
import { isChatFeedbackDomMetricPending, markChatFeedbackDomVisible, type ChatFeedbackDomIdentity } from './chatFeedbackMetrics'

const FEEDBACK_SELECTOR = '[data-chat-feedback-kind]'
const MAX_OBSERVED_FEEDBACK_ELEMENTS = 128

/** Tests actual layout against the window, scrollport, and any clipped/hidden ancestor. */
export function isChatFeedbackElementVisible(element: HTMLElement, root: HTMLElement): boolean {
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view || doc.visibilityState !== 'visible' || !element.isConnected || !root.isConnected) return false
  if (element.getClientRects().length === 0) return false
  const bounds = element.getBoundingClientRect()
  const rootBounds = root.getBoundingClientRect()
  let left = Math.max(0, bounds.left, rootBounds.left)
  let right = Math.min(view.innerWidth, bounds.right, rootBounds.right)
  let top = Math.max(0, bounds.top, rootBounds.top)
  let bottom = Math.min(view.innerHeight, bounds.bottom, rootBounds.bottom)
  let insideRoot = false
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor === root) insideRoot = true
    const style = view.getComputedStyle(ancestor)
    if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || (style.opacity !== '' && Number(style.opacity) === 0)) return false
    if (ancestor === element) continue
    const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX)
    const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY)
    if (clipX || clipY) {
      const clip = ancestor.getBoundingClientRect()
      if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
      if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    }
  }
  return insideRoot && right > left && bottom > top
}

function readIdentity(element: HTMLElement, threadId: string): ChatFeedbackDomIdentity | null {
  const data = element.dataset
  const kind = data.chatFeedbackKind
  if (!threadId || data.chatFeedbackThreadId !== threadId || !['user', 'running', 'assistant'].includes(kind ?? '')) return null
  return {
    kind: kind as ChatFeedbackDomIdentity['kind'], threadId,
    turnId: data.chatFeedbackTurnId,
    itemId: data.chatFeedbackItemId,
    clientMessageId: data.chatFeedbackClientMessageId,
    optimisticMessageId: data.chatFeedbackOptimisticMessageId,
  }
}

/** Returns only still-pending mounted elements that need future intersection observations. */
export function measureChatFeedbackDomMetrics(root: HTMLElement, threadId: string): HTMLElement[] {
  if (!root.isConnected || root.ownerDocument.visibilityState !== 'visible') return []
  const pending: HTMLElement[] = []
  let measuredPendingCount = 0
  for (const element of root.querySelectorAll<HTMLElement>(FEEDBACK_SELECTOR)) {
    const identity = readIdentity(element, threadId)
    if (!identity || !isChatFeedbackDomMetricPending(identity)) continue
    // The budget belongs to live milestones, not to expanded historical DOM preceding them.
    if (measuredPendingCount >= MAX_OBSERVED_FEEDBACK_ELEMENTS) break
    measuredPendingCount += 1
    if (isChatFeedbackElementVisible(element, root)) markChatFeedbackDomVisible(identity)
    if (isChatFeedbackDomMetricPending(identity)) pending.push(element)
  }
  return pending
}

/** Observe only rendered projection nodes; this never infers a turn or execution state. */
export function useChatFeedbackDomMetrics(options: {
  root: Ref<HTMLElement | null>
  threadId: () => string
}): void {
  let active = false
  let frame: number | null = null
  let boundRoot: HTMLElement | null = null
  let observer: IntersectionObserver | null = null
  const observed = new Set<HTMLElement>()

  function measure(): void {
    frame = null
    const root = options.root.value
    if (!active || !root || document.visibilityState !== 'visible') return
    const elements = measureChatFeedbackDomMetrics(root, options.threadId())
    if (elements.length === 0) {
      observer?.disconnect()
      observed.clear()
      return
    }
    const mounted = new Set(elements)
    for (const element of observed) {
      if (mounted.has(element)) continue
      observer?.unobserve(element)
      observed.delete(element)
    }
    for (const element of elements) {
      if (!observed.has(element)) {
        observer?.observe(element)
        observed.add(element)
      }
    }
  }

  function schedule(): void {
    if (!active || frame !== null || document.visibilityState !== 'visible') return
    frame = window.requestAnimationFrame(measure)
  }

  function bindRoot(): void {
    if (boundRoot === options.root.value) { schedule(); return }
    boundRoot?.removeEventListener('scroll', schedule, true)
    observer?.disconnect()
    observed.clear()
    boundRoot = options.root.value
    observer = boundRoot && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(schedule, { root: boundRoot, threshold: 0 })
      : null
    boundRoot?.addEventListener('scroll', schedule, { capture: true, passive: true })
    schedule()
  }

  watch([options.root, options.threadId], bindRoot, { flush: 'post' })
  onMounted(() => {
    active = true
    bindRoot()
    window.addEventListener('resize', schedule, { passive: true })
    document.addEventListener('visibilitychange', schedule)
  })
  onUpdated(schedule)
  onBeforeUnmount(() => {
    active = false
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    observer?.disconnect()
    observed.clear()
    boundRoot?.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('visibilitychange', schedule)
  })
}
