const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export type ModalEnvironmentRelease = () => void

export function ownModalEnvironment(
  panel: HTMLElement,
  previousFocus: HTMLElement | null,
  scrollOwner: HTMLElement = document.documentElement,
  additionalInertTargets: Iterable<HTMLElement> = [],
): ModalEnvironmentRelease {
  const previousOverflow = scrollOwner.style.overflow
  const portalRoot = panel.parentElement
  const inertedBodySiblings = portalRoot?.parentElement === document.body
    ? Array.from(document.body.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement && element !== portalRoot && !element.inert,
      )
    : []
  const inertedAdditionalTargets = Array.from(additionalInertTargets).filter(
    (element) => element !== panel && !panel.contains(element) && !element.inert,
  )
  const inertedElements = Array.from(new Set([...inertedBodySiblings, ...inertedAdditionalTargets]))
  scrollOwner.style.overflow = 'hidden'
  for (const element of inertedElements) element.inert = true

  const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
  const focusInitial = () => {
    ;(getFocusable()[0] ?? panel).focus({ preventScroll: true })
  }
  const isExternalSurface = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const surface = target.closest<HTMLElement>('[role="dialog"][aria-modal="true"], [role="menu"]')
    return Boolean(surface && surface !== panel && !panel.contains(surface))
  }
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Node && panel.contains(event.target)) return
    if (!isExternalSurface(event.target)) focusInitial()
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const focusable = getFocusable()
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    const target = event.shiftKey ? last : first
    if (!first || !last || !panel.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault()
      ;(target ?? panel).focus({ preventScroll: true })
    }
  }

  window.addEventListener('focusin', onFocusIn, true)
  panel.addEventListener('keydown', onKeydown)
  focusInitial()

  return () => {
    window.removeEventListener('focusin', onFocusIn, true)
    panel.removeEventListener('keydown', onKeydown)
    scrollOwner.style.overflow = previousOverflow
    for (const element of inertedElements) element.inert = false
    if (previousFocus?.isConnected && !isExternalSurface(document.activeElement)) {
      previousFocus.focus({ preventScroll: true })
    }
  }
}
