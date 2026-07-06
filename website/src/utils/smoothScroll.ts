const LINE_HEIGHT = 100 / 6

const PRECISION_DELTA = 40
const PRECISION_GAP_MS = 60
const PRECISION_STREAK = 3
const LERP = 0.12

const normalizeWheelDelta = (event: WheelEvent, viewport: number): number => {
  if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT
  if (event.deltaMode === 2) return event.deltaY * viewport
  return event.deltaY
}

// One lerp-RAF scroller over a read/write pair — the body drives window scroll, each inner scrollable drives its own
// scrollTop. `sync` follows external scrolls (scrollbar drag, keyboard): adopt the position when idle, yield when a
// live animation diverges from what it rendered.
interface ISmoother {
  wheel(delta: number, max: number): void
  sync(y: number): void
  stop(): void
}

const createSmoother = (read: () => number, write: (y: number) => void): ISmoother => {
  let target = 0
  let current = 0
  let running = false
  let raf = 0
  let lastTime = 0
  let lastRendered = -1

  const tick = (now: number): void => {
    const dt = lastTime ? Math.min(0.064, (now - lastTime) / 1000) : 1 / 60
    lastTime = now
    const diff = target - current
    if (Math.abs(diff) < 0.3) {
      current = target
      running = false
      lastTime = 0
    } else {
      current += diff * (1 - Math.exp(-LERP * 60 * dt))
    }
    const y = Math.round(current)
    if (y !== lastRendered) {
      lastRendered = y
      write(y)
    }
    if (running) raf = requestAnimationFrame(tick)
  }

  const stop = (): void => {
    if (!running) return
    running = false
    lastTime = 0
    cancelAnimationFrame(raf)
    current = read()
    target = current
    lastRendered = Math.round(current)
  }

  return {
    wheel(delta: number, max: number): void {
      if (!running) {
        current = read()
        target = current
        lastRendered = Math.round(current)
      }
      target = Math.max(0, Math.min(max, target + delta))
      if (!running) {
        running = true
        lastTime = 0
        raf = requestAnimationFrame(tick)
      }
    },
    sync(y: number): void {
      if (!running) {
        current = y
        target = y
        lastRendered = Math.round(y)
      } else if (Math.abs(y - lastRendered) > 1) {
        stop()
      }
    },
    stop
  }
}

// Inner scrollables (popovers, dropdowns, lists) get their OWN smoother, created lazily on first wheel and owned by the
// element (WeakMap + listeners on the element itself, so a dismissed popover garbage-collects the lot).
const innerSmoothers = new WeakMap<HTMLElement, ISmoother>()
const innerSmootherFor = (el: HTMLElement): ISmoother => {
  let smoother = innerSmoothers.get(el)
  if (!smoother) {
    const created = createSmoother(
      () => el.scrollTop,
      y => {
        el.scrollTop = y
      }
    )
    el.addEventListener('scroll', () => created.sync(el.scrollTop), { passive: true })
    innerSmoothers.set(el, created)
    smoother = created
  }
  return smoother
}

// The scroll surface a wheel event should drive: the nearest scrollable ancestor that can still consume `delta`, else
// the body. 'native' = leave the event alone entirely (explicit opt-out, or an at-edge scrollable whose
// overscroll-behavior forbids chaining to the page — matching what native containment would do).
const resolveSurface = (start: EventTarget | null, delta: number): HTMLElement | 'native' | 'body' => {
  let node = start instanceof HTMLElement ? start : null
  while (node && node !== document.body) {
    if (node.hasAttribute('data-smooth-prevent')) return 'native'
    if (node.scrollHeight > node.clientHeight + 1) {
      const css = getComputedStyle(node)
      if (css.overflowY === 'auto' || css.overflowY === 'scroll') {
        const atTop = node.scrollTop <= 0
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1
        const atEdge = (delta < 0 && atTop) || (delta > 0 && atBottom)
        if (!atEdge) return node
        if (css.overscrollBehaviorY === 'contain' || css.overscrollBehaviorY === 'none') return 'native'
      }
    }
    node = node.parentElement
  }
  return 'body'
}

export const enableSmoothScroll = (): (() => void) => {
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement
  const body = createSmoother(
    () => window.scrollY,
    y => {
      window.scrollTo(0, y)
    }
  )
  body.sync(window.scrollY)

  // The body max is cached (recomputed on resize/content growth) — reading root.scrollHeight per wheel would thrash
  // layout on the hottest path. Inner elements read their own max per wheel: small subtrees, content changes freely.
  let maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
  const recomputeMax = (): void => {
    maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
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
      body.stop()
      return
    }
    const delta = normalizeWheelDelta(event, window.innerHeight)
    const surface = resolveSurface(event.target, delta)
    if (surface === 'native') return
    event.preventDefault()
    if (surface === 'body') {
      if (delta > 0) recomputeMax()
      body.wheel(delta, maxScroll)
      return
    }
    innerSmootherFor(surface).wheel(delta, surface.scrollHeight - surface.clientHeight)
  }

  const onScroll = (): void => {
    body.sync(window.scrollY)
  }

  const onResize = (): void => {
    recomputeMax()
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
    body.stop()
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
