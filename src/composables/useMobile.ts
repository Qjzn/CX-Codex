import { computed, onMounted, onUnmounted, ref } from 'vue'

const MOBILE_BREAKPOINT = 768
const TOUCH_DUAL_PANE_MIN_WIDTH = 680
const TOUCH_DUAL_PANE_MAX_WIDTH = 1180
const TOUCH_DUAL_PANE_MAX_LONG_EDGE = 1800

type WindowWithViewportSegments = Window & {
  getWindowSegments?: () => Array<{ width: number; height: number }>
}

function readViewportWidth(): number {
  if (typeof window === 'undefined') return 0
  return window.innerWidth || document.documentElement.clientWidth || 0
}

function readViewportHeight(): number {
  if (typeof window === 'undefined') return 0
  return window.innerHeight || document.documentElement.clientHeight || 0
}

function readViewportSegmentCount(): number {
  if (typeof window === 'undefined') return 0
  const getWindowSegments = (window as WindowWithViewportSegments).getWindowSegments
  if (typeof getWindowSegments !== 'function') return 0
  try {
    return getWindowSegments.call(window).length
  } catch {
    return 0
  }
}

export function useMobile() {
  const viewportWidth = ref(readViewportWidth())
  const viewportHeight = ref(readViewportHeight())
  const viewportSegmentCount = ref(readViewportSegmentCount())
  const isCoarsePointer = ref(false)
  const stableDualPaneMobile = ref(false)

  let coarsePointerMql: MediaQueryList | null = null

  function isDualPaneCandidate(width: number, height: number, segmentCount: number): boolean {
    const shortEdge = Math.min(width, height)
    const longEdge = Math.max(width, height)
    const hasFoldableSegments = segmentCount > 1
    return (
      isCoarsePointer.value
      && shortEdge >= TOUCH_DUAL_PANE_MIN_WIDTH
      && shortEdge <= TOUCH_DUAL_PANE_MAX_WIDTH
      && (longEdge <= TOUCH_DUAL_PANE_MAX_LONG_EDGE || hasFoldableSegments)
    )
  }

  function canKeepStableDualPane(width: number, height: number, segmentCount: number): boolean {
    const longEdge = Math.max(width, height)
    const hasFoldableSegments = segmentCount > 1
    return (
      stableDualPaneMobile.value
      && isCoarsePointer.value
      && width >= TOUCH_DUAL_PANE_MIN_WIDTH
      && width <= TOUCH_DUAL_PANE_MAX_WIDTH
      && (longEdge <= TOUCH_DUAL_PANE_MAX_LONG_EDGE || hasFoldableSegments)
    )
  }

  function refreshViewport(): void {
    const width = readViewportWidth()
    const height = readViewportHeight()
    const segmentCount = readViewportSegmentCount()
    viewportWidth.value = width
    viewportHeight.value = height
    viewportSegmentCount.value = segmentCount

    if (isDualPaneCandidate(width, height, segmentCount)) {
      stableDualPaneMobile.value = true
    } else if (!canKeepStableDualPane(width, height, segmentCount)) {
      stableDualPaneMobile.value = false
    }
  }

  function onCoarsePointerChange(event: MediaQueryListEvent): void {
    isCoarsePointer.value = event.matches
    refreshViewport()
  }

  const isDualPaneMobile = computed(() => stableDualPaneMobile.value)

  const isMobile = computed(() => (
    viewportWidth.value < MOBILE_BREAKPOINT
    && !isDualPaneMobile.value
  ))

  onMounted(() => {
    refreshViewport()
    coarsePointerMql = window.matchMedia('(pointer: coarse)')
    isCoarsePointer.value = coarsePointerMql.matches
    coarsePointerMql.addEventListener('change', onCoarsePointerChange)
    window.addEventListener('resize', refreshViewport, { passive: true })
    window.addEventListener('orientationchange', refreshViewport, { passive: true })
    window.addEventListener('pageshow', refreshViewport, { passive: true })
    window.visualViewport?.addEventListener('resize', refreshViewport, { passive: true })
    window.visualViewport?.addEventListener('scroll', refreshViewport, { passive: true })
    window.screen.orientation?.addEventListener('change', refreshViewport)
  })

  onUnmounted(() => {
    coarsePointerMql?.removeEventListener('change', onCoarsePointerChange)
    window.removeEventListener('resize', refreshViewport)
    window.removeEventListener('orientationchange', refreshViewport)
    window.removeEventListener('pageshow', refreshViewport)
    window.visualViewport?.removeEventListener('resize', refreshViewport)
    window.visualViewport?.removeEventListener('scroll', refreshViewport)
    window.screen.orientation?.removeEventListener('change', refreshViewport)
  })

  return {
    isMobile,
    isDualPaneMobile,
    isCoarsePointer,
    viewportWidth,
    viewportHeight,
    viewportSegmentCount,
  }
}
