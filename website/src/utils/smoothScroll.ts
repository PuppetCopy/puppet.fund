const LINE_HEIGHT = 100 / 6

const PRECISION_DELTA = 40
const PRECISION_GAP_MS = 60
const PRECISION_STREAK = 3

const normalizeWheelDelta = (event: WheelEvent, viewport: number): number => {
  if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT
  if (event.deltaMode === 2) return event.deltaY * viewport
  return event.deltaY
}

const innerCanScroll = (start: EventTarget | null, boundary: HTMLElement, delta: number): boolean => {
  let node = start instanceof HTMLElement ? start : null
  while (node && node !== boundary) {
    if (node.hasAttribute('data-smooth-prevent')) return true
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const atTop = node.scrollTop <= 0
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1
        if (!((delta < 0 && atTop) || (delta > 0 && atBottom))) return true
      }
    }
    node = node.parentElement
  }
  return false
}

export interface ISmoothScrollOptions {
  lerp?: number
  wheelMultiplier?: number
}

export const enableSmoothScroll = ({ lerp = 0.12, wheelMultiplier = 1 }: ISmoothScrollOptions = {}): (() => void) => {
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement
  let target = window.scrollY
  let current = target
  let running = false
  let raf = 0
  let lastTime = 0

  let maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
  let lastRendered = -1
  const recomputeMax = (): void => {
    maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
  }

  const tick = (now: number): void => {
    const dt = lastTime ? Math.min(0.064, (now - lastTime) / 1000) : 1 / 60
    lastTime = now
    const diff = target - current
    if (Math.abs(diff) < 0.3) {
      current = target
      running = false
      lastTime = 0
    } else {
      current += diff * (1 - Math.exp(-lerp * 60 * dt))
    }
    const y = Math.round(current)
    if (y !== lastRendered) {
      lastRendered = y
      window.scrollTo(0, y)
    }
    if (running) raf = requestAnimationFrame(tick)
  }

  const startLoop = (): void => {
    if (running) return
    running = true
    lastTime = 0
    raf = requestAnimationFrame(tick)
  }

  const stopLoop = (): void => {
    if (!running) return
    running = false
    lastTime = 0
    cancelAnimationFrame(raf)
    current = window.scrollY
    target = current
    lastRendered = Math.round(current)
  }

  let precisionDevice = false
  let precisionStreak = 0
  let lastWheelTs = 0

  const isPrecisionDevice = (event: WheelEvent): boolean => {
    const gap = event.timeStamp - lastWheelTs
    lastWheelTs = event.timeStamp
    if (gap >= PRECISION_GAP_MS) {
      precisionStreak = 0
      precisionDevice = false
    }
    if (event.deltaX !== 0) {
      precisionDevice = true
    } else if (!precisionDevice && event.deltaMode === 0 && Math.abs(event.deltaY) < PRECISION_DELTA) {
      if (++precisionStreak >= PRECISION_STREAK) precisionDevice = true
    }
    return precisionDevice
  }

  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) return
    if (isPrecisionDevice(event)) {
      stopLoop()
      return
    }
    const delta = normalizeWheelDelta(event, window.innerHeight) * wheelMultiplier
    if (innerCanScroll(event.target, document.body, delta)) return
    event.preventDefault()
    const next = target + delta
    if (delta > 0 && next > maxScroll) recomputeMax()
    target = Math.max(0, Math.min(maxScroll, next))
    startLoop()
  }

  const onScroll = (): void => {
    const y = window.scrollY
    if (!running) {
      current = y
      target = y
    } else if (Math.abs(y - lastRendered) > 1) {
      stopLoop()
    }
  }

  const onResize = (): void => {
    recomputeMax()
    target = Math.max(0, Math.min(maxScroll, target))
    current = Math.max(0, Math.min(maxScroll, current))
  }

  const contentObserver = new ResizeObserver(recomputeMax)
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

  const attach = (): void => {
    contentObserver.observe(document.documentElement)
    contentObserver.observe(document.body)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
  }

  const detach = (): void => {
    stopLoop()
    contentObserver.disconnect()
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
  }

  const onReducedMotionChange = (): void => {
    if (mql.matches) detach()
    else attach()
  }

  mql.addEventListener('change', onReducedMotionChange)
  if (!mql.matches) attach()

  return () => {
    mql.removeEventListener('change', onReducedMotionChange)
    detach()
  }
}
