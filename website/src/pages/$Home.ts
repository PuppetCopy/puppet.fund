import { type IStream, map, op, start } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import {
  $custom,
  $element,
  $node,
  $text,
  $wrapNativeElement,
  attr,
  component,
  fromEventTarget,
  type I$Node,
  motion,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette, theme } from 'aelea/ui-components-theme'
import {
  $check,
  $gitbook,
  $github,
  $gmx,
  $icon,
  $puppeteer,
  $smartContract,
  $twitter,
  $wallet,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { $heading2, $heading3 } from '../common/$text.js'
import { $card, $mockWindow } from '../common/elements/$common.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { $fundOrGetFundedCta, $navPill, $pillAnchor } from './$FundQuickstart.js'
import { $body, $terminal } from './$onboarding.js'

const TWITTER_URL = 'https://twitter.com/PuppetCopy'

const $vortexBackground = (): I$Node => {
  const sentinel = document.createElement('div')
  const canvas = document.createElement('canvas')
  canvas.setAttribute(
    'style',
    'position:absolute;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:0.4;-webkit-mask-image:linear-gradient(to bottom, transparent 0%, black 15%, black 62%, transparent 90%);mask-image:linear-gradient(to bottom, transparent 0%, black 15%, black 62%, transparent 90%)'
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) return $wrapNativeElement(sentinel)(style({ display: 'none' }))()

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  let w = window.innerWidth
  let h = window.innerHeight
  const resize = () => {
    w = window.innerWidth
    h = window.innerHeight
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduced) {
    window.addEventListener('resize', resize)
    document.body.appendChild(canvas)
  }

  const hues = ['236, 72, 130', '139, 92, 246']
  type IFlow = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; c: string }
  const spawn = (): IFlow => {
    const fromLeft = Math.random() < 0.5
    const max = 360 + Math.random() * 420
    return {
      x: (fromLeft ? 0 : w) + (Math.random() - 0.5) * 40,
      y: Math.random() * h,
      vx: (fromLeft ? 1 : -1) * (0.15 + Math.random() * 0.35),
      vy: (Math.random() - 0.5) * 0.25,
      life: max,
      max,
      r: 0.5 + Math.random() ** 2 * 2.6,
      c: hues[fromLeft ? 0 : 1]!
    }
  }
  const count = reduced ? 0 : Math.min(120, Math.round((w * h) / 14000))
  const flows: IFlow[] = []

  let everConnected = false
  let raf = 0
  let t = 0
  let grown = 0
  const cleanup = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    canvas.remove()
  }
  const frame = () => {
    if (sentinel.isConnected) everConnected = true
    else if (everConnected) return cleanup()
    t += 0.004
    const light = theme.name === 'light'
    canvas.style.opacity = light ? '0.8' : '0.4'
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = light ? 0.12 : 0.07
    ctx.fillStyle = light ? theme.palette.horizon : '#101217'
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
    if (!light) ctx.globalCompositeOperation = 'lighter'
    const cx = w / 2
    const cy = h / 2
    const ringR = Math.min(300, Math.min(w, h) / 2 - 40)
    grown = Math.min(count, grown + 0.08)
    if (flows.length < grown) flows.push(spawn())
    for (const p of flows) {
      const dx = cx - p.x
      const dy = cy - p.y
      const dist = Math.hypot(dx, dy) + 0.001
      const nx = dx / dist
      const ny = dy / dist
      const radial = Math.max(-0.16, Math.min(0.16, (dist - ringR) * 0.0006))
      const swirl = 0.22
      p.vx = p.vx * 0.92 + nx * radial - ny * swirl + Math.sin(p.y * 0.008 + t) * 0.012
      p.vy = p.vy * 0.92 + ny * radial + nx * swirl + Math.cos(p.x * 0.008 + t) * 0.012
      p.x += p.vx
      p.y += p.vy
      p.life -= 1
      const fade = Math.max(0, Math.min(1, p.life / p.max, (p.max - p.life) / 30))
      const r = light ? p.r * 1.8 : p.r
      const glowR = r * 7
      const glowC = light ? '255, 255, 255' : p.c
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
      g.addColorStop(0, `rgba(${glowC}, ${(light ? 0.4 : 0.18) * fade})`)
      g.addColorStop(1, `rgba(${glowC}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = light ? `rgba(${p.c}, ${0.7 * fade})` : `rgba(255, 255, 255, ${0.4 * fade})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (p.life <= 0 || dist < 16) Object.assign(p, spawn())
    }
    raf = requestAnimationFrame(frame)
  }
  if (!reduced) raf = requestAnimationFrame(frame)

  return $wrapNativeElement(sentinel)(style({ display: 'none' }))()
}

const $featureIcon =($glyph: I$Node, accent: string, viewBox = '0 0 32 32'): I$Node =>
  $row(
    style({
      width: '56px',
      height: '56px',
      borderRadius: '14px',
      placeContent: 'center',
      alignItems: 'center',
      flexShrink: '0',
      backgroundColor: colorShade(accent, 15)
    })
  )($icon({ $content: $glyph, width: '30px', fill: accent, viewBox }))

const $sectionHeading = (kicker: string, title: string): I$Node =>
  $column(spacing.small, style({ alignItems: 'center', textAlign: 'center', width: '100%' }))(
    $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.primary }))(
      $text(kicker)
    ),
    $heading2($text(title))
  )

const $section = (...$children: I$Node[]): I$Node => $column(spacing.big, style({ width: '100%' }))(...$children)

const $video = (src: string): I$Node => {
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.preload = 'none'
  video.setAttribute('playsinline', '')
  video.setAttribute('muted', '')
  video.style.cssText =
    'width:100%;display:block;aspect-ratio:1/1;object-fit:cover;opacity:0;transition:opacity 700ms ease'
  let loaded = false
  const load = () => {
    if (loaded) return
    loaded = true
    requestAnimationFrame(() => {
      video.src = src
      video.load()
    })
  }
  const play = () => {
    Promise.resolve(video.play()).catch(() => {})
  }
  video.addEventListener('loadeddata', () => {
    video.style.opacity = '1'
    play()
  })
  video.addEventListener('canplay', play)
  video.addEventListener('pause', () => {
    if (video.isConnected) play()
  })
  const io = new IntersectionObserver(
    entries => {
      if (entries.some(e => e.isIntersecting)) {
        load()
        io.disconnect()
      }
    },
    { rootMargin: '300px' }
  )
  io.observe(video)
  return $mockWindow($wrapNativeElement(video)())
}

const HERO_TILT_DEG = 40

const $hero = (): I$Node => {
  const reveal: IStream<number> = start(
    0,
    op(
      fromEventTarget(window, 'scroll'),
      map(() => {
        const top = document.scrollingElement?.scrollTop ?? window.scrollY
        return Math.min(1, top / (window.innerHeight * 0.7))
      })
    )
  )

  return $column(
    style({
      alignItems: 'center',
      width: '100%',
      height: isDesktopScreen ? '100dvh' : 'auto'
    })
  )(
    $column(
      spacing.big,
      ...(isDesktopScreen
        ? [
            styleBehavior(
              map(
                p => ({
                  transform: `translateY(${(-p * 140).toFixed(1)}px)`,
                  opacity: Math.max(0, 1 - p * 1.8).toFixed(3)
                }),
                reveal
              )
            )
          ]
        : []),
      style({
        alignItems: 'center',
        textAlign: 'center',
        width: '100%',
        minHeight: isDesktopScreen ? 'calc(100dvh - 215px)' : 'calc(100dvh - 175px)',
        justifyContent: 'center'
      })
    )(
      $custom('h1')(
        style({
          fontSize: isDesktopScreen ? text.display : text.xxl,
          fontWeight: '900',
          letterSpacing: '0.01em',
          lineHeight: '1.12',
          margin: '0',
          maxWidth: '760px',
          color: palette.message
        })
      )($text('A fund wallet, operated by humans and agents.')),
      $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '660px' }))(
        $text(
          'Fund top traders and share their gains, or run your own fund and trade exactly as you do today. You keep your keys. Your capital moves only under rules you sign, and the chain enforces them on every action.'
        )
      ),
      $node(
        style({
          fontSize: text.xs,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: palette.foreground,
          paddingTop: '8px'
        })
      )($text('Fund or get funded')),
      $fundOrGetFundedCta()
    ),
    $node(
      style({ width: '100%', maxWidth: '680px', perspective: '1400px' }),
      ...(isDesktopScreen
        ? [styleBehavior(map(p => ({ transform: `translateY(${Math.round(-p * 600)}px)` }), reveal))]
        : [])
    )(
      $node(
        style({ transformOrigin: 'center top', transition: 'transform 80ms linear' }),
        ...(isDesktopScreen
          ? [
              styleBehavior(
                map(
                  p => ({ transform: `rotateX(${((1 - Math.min(1, p * 1.6)) * HERO_TILT_DEG).toFixed(2)}deg)` }),
                  reveal
                )
              )
            ]
          : [style({ transform: 'none' })])
      )($video('assets/video/leaderboard-pick-traders.mp4'))
    )
  )
}

const $personaKicker = (accent: string, label: string): I$Node =>
  $node(
    style({
      fontSize: text.xs,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      fontWeight: '700',
      color: accent
    })
  )($text(label))

const STORY_MOTION_CSS = `
@supports (animation-timeline: view()) {
  [data-reveal] { animation: puppetRiseC 1ms both; animation-timeline: view(); animation-range: entry 0% entry 28%; }
  [data-reveal="l"] { animation-name: puppetRiseL; }
  [data-reveal="r"] { animation-name: puppetRiseR; }
}
@keyframes puppetRiseC { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes puppetRiseL { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
@keyframes puppetRiseR { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
[data-orb] { animation: puppetOrbPulse 2.8s ease-in-out infinite; }
@keyframes puppetOrbPulse {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(236, 72, 130, 0.5); }
  50% { box-shadow: 0 0 28px 8px rgba(139, 92, 246, 0.55); }
}
@media (prefers-reduced-motion: reduce) {
  [data-reveal], [data-orb] { animation: none; }
}
`

const ensureStoryStyles = () => {
  if (document.getElementById('puppet-story-motion')) return
  const el = document.createElement('style')
  el.id = 'puppet-story-motion'
  el.textContent = STORY_MOTION_CSS
  document.head.appendChild(el)
}

const $fundChip = (label: string): I$Node =>
  $node(
    style({
      fontSize: text.xs,
      padding: '5px 12px',
      borderRadius: '14px',
      textAlign: 'center',
      backgroundColor: colorShade(palette.foreground, 12),
      color: palette.message
    })
  )($text(label))

const MASTER_COLOR = 'rgb(139, 92, 246)'
const PUPPET_COLOR = 'rgb(236, 72, 130)'
type IStorySpine = { w: number; xL: number; xR: number; converge: number; amp: number }

const STORY_SPINE: IStorySpine = { w: 96, xL: 28, xR: 68, converge: 200, amp: 2 }
const STORY_SPINE_M: IStorySpine = { w: 40, xL: 12, xR: 28, converge: 150, amp: 1.5 }

type IStoryVoice = { title: string; body: string; vs: string }
type IStoryBeat = { t: number; master: IStoryVoice; puppet: IStoryVoice }

const STORY_BEATS: IStoryBeat[] = [
  {
    t: 0.18,
    master: {
      title: 'Same self-custody wallet',
      body: 'Create a fund and it becomes your trading wallet. Connect it to GMX and trade exactly as you already do, while the fund runs public: ranked on the leaderboard, every position verifiable on-chain.',
      vs: 'Instead of skill buried in an address nobody reads.'
    },
    puppet: {
      title: 'Proof, not promises',
      body: 'Every fund is an open book: live returns, drawdown, and positions read straight from the chain. Back one by signing rules it must obey: how much of your balance per trade, how often, when to stop.',
      vs: 'Instead of a Telegram group and a screenshot.'
    }
  },
  {
    t: 0.42,
    master: {
      title: 'Multiply your capital',
      body: 'Backers subscribe under their own rules and their capital joins your trades automatically. Seed a fund with $100 and attract $500 of backing: $600 now trades as one, six times what you put in. A +20% run pays your $20 plus a 10% performance fee on backer gains, $30 instead of $20.',
      vs: 'Instead of an edge capped at your own wallet.'
    },
    puppet: {
      title: 'Money that never leaves',
      body: 'Your deposit never leaves your own account up front. When the fund opens a trade, the protocol pulls only your matched share, checks it against your signed rules, and mints you fund shares at a price verified on-chain.',
      vs: 'Instead of wiring funds away and hoping.'
    }
  },
  {
    t: 0.66,
    master: {
      title: 'A name that compounds',
      body: 'Wins build a public, verifiable track record, and the record brings subscribers, standing, and more capital behind every trade. The protocol keeps you honest: no exiting ahead of your backers, your shares redeem together with theirs.',
      vs: 'Instead of winning quietly, alone.'
    },
    puppet: {
      title: 'Watch live, exit anytime',
      body: 'Watch every position and the fund value live. Exit on your terms: sell your shares at the current on-chain price and claim the money straight back to your own wallet.',
      vs: 'Instead of no dashboard, no rules, no exit.'
    }
  }
]

const $storyCell = (accent: string, kicker: string, voice: IStoryVoice, mirror: boolean): I$Node =>
  $column(
    spacing.small,
    style({
      flex: '1',
      minWidth: '0',
      alignItems: mirror ? 'flex-end' : 'flex-start',
      textAlign: mirror ? 'right' : 'left'
    })
  )(
    $personaKicker(accent, kicker),
    $custom('h3')(
      style({
        fontSize: isDesktopScreen ? text.xxl : text.xl,
        fontWeight: '800',
        letterSpacing: '0.01em',
        lineHeight: '1.25',
        margin: '0',
        color: palette.message
      })
    )($text(voice.title)),
    $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.foreground }))($text(voice.body)),
    $node(
      style({
        fontSize: text.xs,
        fontStyle: 'italic',
        lineHeight: '1.5',
        color: colorShade(palette.foreground, 60),
        paddingTop: '2px'
      })
    )($text(voice.vs))
  )

const trailWaveX = (spine: IStorySpine, side: 'left' | 'right', y: number): number => {
  const base = spine.xL + spine.amp * Math.sin(y * 0.011 + 0.9)
  return side === 'left' ? base : spine.w - base
}

type ITrailGeom = { h: number; len: number }

const $trailMark = (
  progress: IStream<number>,
  t: number,
  color: string,
  spine: IStorySpine,
  side: 'left' | 'right',
  probe: HTMLElement,
  register: (fn: () => void) => void,
  geom: ITrailGeom
): I$Node[] => {
  const x0 = side === 'left' ? spine.xL : spine.xR
  const tetherEl = document.createElement('div')
  const dotEl = document.createElement('div')
  const tRef = { v: t }
  register(() => {
    const r = dotEl.getBoundingClientRect()
    if (r.height === 0) return
    const y = r.top + r.height / 2 - probe.getBoundingClientRect().top
    const x = trailWaveX(spine, side, y)
    dotEl.style.left = `${(x - 4.5).toFixed(1)}px`
    if (side === 'left') tetherEl.style.width = `${(x - 7).toFixed(1)}px`
    else tetherEl.style.left = `${(x + 7).toFixed(1)}px`
    if (geom.len > 1) tRef.v = Math.min(1, (TRAIL_REVEAL_END * y) / geom.len)
  })
  return [
    $wrapNativeElement(tetherEl)(
      style({
        position: 'absolute',
        top: '7px',
        height: '1px',
        transition: 'background-color 500ms',
        ...(side === 'left' ? { left: '5px', width: `${x0 - 7}px` } : { left: `${x0 + 7}px`, right: '5px' })
      }),
      styleBehavior(
        map(
          p => ({ backgroundColor: p >= tRef.v ? colorShade(color, 75) : colorShade(palette.foreground, 18) }),
          progress
        )
      )
    )(),
    $wrapNativeElement(dotEl)(
      style({
        position: 'absolute',
        top: '3px',
        left: `${x0 - 4.5}px`,
        width: '9px',
        height: '9px',
        borderRadius: '50%',
        transition: 'background-color 500ms, box-shadow 500ms'
      }),
      styleBehavior(
        map(
          p =>
            p >= tRef.v
              ? { backgroundColor: color, boxShadow: `0 0 12px ${color}` }
              : { backgroundColor: colorShade(palette.foreground, 35), boxShadow: 'none' },
          progress
        )
      )
    )()
  ]
}

const TRAIL_REVEAL_END = 0.95

const buildTrailPath = (spine: IStorySpine, H: number, mirror: boolean): string => {
  const n = (v: number): string => v.toFixed(1)
  const xC = (spine.xL + spine.xR) / 2
  const mir = (x: number): number => (mirror ? spine.w - x : x)
  const conv = spine.converge
  const y0 = Math.max(40, H - conv)
  const tailEnd = y0 + conv - 14
  const wave = (y: number): number => mir(spine.xL + spine.amp * Math.sin(y * 0.011 + 0.9))
  const pts: [number, number][] = [[wave(0), 0]]
  for (let y = 170; y < y0 - 50; y += 170) pts.push([wave(y), y])
  pts.push([mir(spine.xL), y0])
  for (let y = y0 + 6; y < tailEnd; y += 6) {
    const k = (y - y0) / (tailEnd - y0)
    pts.push([mir(xC + (spine.xL - xC) * (1 - k) * Math.cos(k * Math.PI * 4)), y])
  }
  pts.push([mir(xC), tailEnd])
  let d = `M ${n(pts[0]![0])} ${n(pts[0]![1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    d += ` Q ${n(px)} ${n(py)}, ${n((px + nx) / 2)} ${n((py + ny) / 2)}`
  }
  const last = pts[pts.length - 1]!
  d += ` L ${n(last[0])} ${n(last[1])}`
  return d
}

const $trailLayer = (
  progress: IStream<number>,
  spine: IStorySpine,
  centered: boolean,
  probe: HTMLElement,
  geom: ITrailGeom
): I$Node => {
  const ns = 'http://www.w3.org/2000/svg'
  const xC = (spine.xL + spine.xR) / 2
  const mkLayer = (glowing: boolean): { svg: SVGSVGElement; master: SVGPathElement; puppet: SVGPathElement } => {
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('fill', 'none')
    svg.style.cssText = 'position:absolute;top:0;left:0;overflow:visible'
    const mk = (color: string): SVGPathElement => {
      const path = document.createElementNS(ns, 'path')
      path.style.stroke = color
      path.style.strokeWidth = '2'
      path.style.strokeLinecap = 'round'
      if (glowing) path.style.filter = `drop-shadow(0 0 4px ${color})`
      svg.appendChild(path)
      return path
    }
    const dim = colorShade(palette.foreground, 15)
    return { svg, master: mk(glowing ? MASTER_COLOR : dim), puppet: mk(glowing ? PUPPET_COLOR : dim) }
  }
  const base = mkLayer(false)
  const lit = mkLayer(true)
  const rebuild = (H: number): void => {
    geom.h = H
    for (const { svg } of [base, lit]) {
      svg.setAttribute('width', String(spine.w))
      svg.setAttribute('height', String(H))
      svg.setAttribute('viewBox', `0 0 ${spine.w} ${H}`)
    }
    const dMaster = buildTrailPath(spine, H, false)
    const dPuppet = buildTrailPath(spine, H, true)
    base.master.setAttribute('d', dMaster)
    base.puppet.setAttribute('d', dPuppet)
    lit.master.setAttribute('d', dMaster)
    lit.puppet.setAttribute('d', dPuppet)
    geom.len = lit.master.getTotalLength()
    lit.svg.style.strokeDasharray = String(geom.len)
    window.dispatchEvent(new Event('scroll'))
  }
  const ro = new ResizeObserver(entries => {
    if (!probe.isConnected && geom.h > 0) {
      ro.disconnect()
      return
    }
    const h = entries[0]?.contentRect.height ?? 0
    if (h > 0 && Math.abs(h - geom.h) > 1) rebuild(h)
  })
  ro.observe(probe)

  const $tip = (color: string, master: boolean): I$Node =>
    $node(
      style({
        position: 'absolute',
        top: '0',
        left: '0',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 14px ${color}`,
        willChange: 'transform'
      }),
      styleBehavior(
        map(p => {
          const pe = Math.min(1, p / TRAIL_REVEAL_END)
          if (geom.h === 0 || pe <= 0.004 || pe >= 0.99) return { opacity: '0' }
          const pt = lit.master.getPointAtLength(pe * geom.len)
          const x = master ? pt.x : spine.w - pt.x
          return { opacity: '1', transform: `translate(${(x - 4).toFixed(1)}px, ${(pt.y - 4).toFixed(1)}px)` }
        }, progress)
      )
    )()

  return $node(
    style({
      position: 'absolute',
      top: '0',
      bottom: '-48px',
      width: `${spine.w}px`,
      pointerEvents: 'none',
      maskImage: 'linear-gradient(to bottom, transparent, black 48px)',
      ...(centered ? { left: '50%', transform: 'translateX(-50%)' } : { left: '0' })
    })
  )(
    $wrapNativeElement(base.svg)(style({}))(),
    $wrapNativeElement(lit.svg)(
      styleBehavior(
        map(p => {
          const pe = Math.min(1, p / TRAIL_REVEAL_END)
          return { strokeDashoffset: (geom.len * (1 - pe)).toFixed(1) }
        }, progress)
      )
    )(),
    $tip(MASTER_COLOR, true),
    $tip(PUPPET_COLOR, false),
    $node(
      attr({ 'data-orb': '' }),
      style({
        position: 'absolute',
        bottom: '48px',
        left: `${xC - 14}px`,
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${PUPPET_COLOR}, ${MASTER_COLOR})`,
        transition: 'opacity 400ms, transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)'
      }),
      styleBehavior(
        map(p => {
          const hit = p / TRAIL_REVEAL_END >= 0.99
          return hit ? { opacity: '1', transform: 'scale(1)' } : { opacity: '0', transform: 'scale(0.5)' }
        }, progress)
      )
    )($icon({ $content: $puppetLogo, width: '16px', viewBox: '0 0 32 32', fill: 'white' }))
  )
}

const $storyRow = (
  progress: IStream<number>,
  beat: IStoryBeat,
  probe: HTMLElement,
  register: (fn: () => void) => void,
  geom: ITrailGeom
): I$Node =>
  $row(style({ width: '100%', alignItems: 'flex-start' }))(
    $node(attr({ 'data-reveal': 'l' }), style({ flex: '1', minWidth: '0', display: 'flex' }))(
      $storyCell(MASTER_COLOR, 'The trader', beat.master, true)
    ),
    $node(style({ position: 'relative', flex: `0 0 ${STORY_SPINE.w}px`, alignSelf: 'stretch' }))(
      ...$trailMark(progress, beat.t, MASTER_COLOR, STORY_SPINE, 'left', probe, register, geom),
      ...$trailMark(progress, beat.t, PUPPET_COLOR, STORY_SPINE, 'right', probe, register, geom)
    ),
    $node(attr({ 'data-reveal': 'r' }), style({ flex: '1', minWidth: '0', display: 'flex' }))(
      $storyCell(PUPPET_COLOR, 'The backer', beat.puppet, false)
    )
  )

const $storyBlockM = (
  progress: IStream<number>,
  t: number,
  accent: string,
  kicker: string,
  side: 'left' | 'right',
  voice: IStoryVoice,
  probe: HTMLElement,
  register: (fn: () => void) => void,
  geom: ITrailGeom
): I$Node => {
  const spine = STORY_SPINE_M
  const x0 = side === 'left' ? spine.xL : spine.xR
  const dotEl = document.createElement('div')
  const tetherEl = document.createElement('div')
  const tRef = { v: t }
  register(() => {
    const r = dotEl.getBoundingClientRect()
    if (r.height === 0) return
    const y = r.top + r.height / 2 - probe.getBoundingClientRect().top
    const x = trailWaveX(spine, side, y)
    dotEl.style.left = `${(x - 52 - 4.5).toFixed(1)}px`
    tetherEl.style.left = `${(x - 52 + 5).toFixed(1)}px`
    tetherEl.style.width = `${(52 - x - 15).toFixed(1)}px`
    if (geom.len > 1) tRef.v = Math.min(1, (TRAIL_REVEAL_END * y) / geom.len)
  })
  return $node(attr({ 'data-reveal': 'c' }), style({ position: 'relative', width: '100%' }))(
    $wrapNativeElement(dotEl)(
      style({
        position: 'absolute',
        top: '4px',
        left: `${x0 - 52 - 4.5}px`,
        width: '9px',
        height: '9px',
        borderRadius: '50%',
        transition: 'background-color 500ms, box-shadow 500ms'
      }),
      styleBehavior(
        map(
          p =>
            p >= tRef.v
              ? { backgroundColor: accent, boxShadow: `0 0 12px ${accent}` }
              : { backgroundColor: colorShade(palette.foreground, 35), boxShadow: 'none' },
          progress
        )
      )
    )(),
    $wrapNativeElement(tetherEl)(
      style({
        position: 'absolute',
        top: '8px',
        left: `${x0 - 52 + 5}px`,
        width: `${52 - x0 - 15}px`,
        height: '1px',
        transition: 'background-color 500ms'
      }),
      styleBehavior(
        map(
          p => ({ backgroundColor: p >= tRef.v ? colorShade(accent, 45) : colorShade(palette.foreground, 18) }),
          progress
        )
      )
    )(),
    $storyCell(accent, kicker, voice, false)
  )
}

const $storyConverge = (): I$Node =>
  $column(spacing.default, style({ alignItems: 'center', textAlign: 'center', width: '100%' }))(
    $heading2($text('One shared wallet.')),
    $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.foreground, maxWidth: '520px' }))(
      $text('One wallet between them: the trader operates it, the backer rules it, the chain enforces both.')
    ),
    $row(spacing.small, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $fundChip('$600 AUM'),
      $fundChip('10% performance fee'),
      $fundChip('$30 instead of $20 on a winning run')
    )
  )

const $storyline = (): I$Node => {
  ensureStoryStyles()
  const probe = document.createElement('div')
  const scrollTarget: IStream<number> = op(
    fromEventTarget(window, 'scroll'),
    map(() => {
      const r = probe.getBoundingClientRect()
      if (r.height === 0) return 0
      const focus = window.innerHeight * 0.62
      return Math.min(1, Math.max(0, (focus - r.top) / r.height))
    })
  )
  const progress: IStream<number> = state(0, motion({ stiffness: 26, damping: 13, precision: 0.0005 }, scrollTarget))
  const spine = isDesktopScreen ? STORY_SPINE : STORY_SPINE_M
  const geom: ITrailGeom = { h: 0, len: 1 }
  const aligners: (() => void)[] = []
  const register = (fn: () => void): void => {
    aligners.push(fn)
  }
  const alignObserver = new ResizeObserver(() => {
    if (!probe.isConnected) {
      alignObserver.disconnect()
      return
    }
    requestAnimationFrame(() => {
      for (const align of aligners) align()
      window.dispatchEvent(new Event('scroll'))
    })
  })
  alignObserver.observe(probe)

  const mobileBlocks = (): I$Node[] =>
    STORY_BEATS.flatMap((beat, i) => [
      $storyBlockM(
        progress,
        0.1 + i * 2 * 0.12,
        MASTER_COLOR,
        'The trader',
        'left',
        beat.master,
        probe,
        register,
        geom
      ),
      $storyBlockM(
        progress,
        0.1 + (i * 2 + 1) * 0.12,
        PUPPET_COLOR,
        'The backer',
        'right',
        beat.puppet,
        probe,
        register,
        geom
      )
    ])

  return $section(
    $sectionHeading('How it works', 'Two sides. One wallet.'),
    $node(style({ position: 'relative', width: '100%' }))(
      $wrapNativeElement(probe)(style({ position: 'absolute', inset: '0', pointerEvents: 'none' }))(),
      $trailLayer(progress, spine, isDesktopScreen, probe, geom),
      $column(
        style({
          position: 'relative',
          width: '100%',
          gap: isDesktopScreen ? '52px' : '36px',
          paddingTop: '12px',
          paddingBottom: `${spine.converge + 28}px`,
          ...(isDesktopScreen ? {} : { paddingLeft: '52px' })
        })
      )(
        ...(isDesktopScreen ? STORY_BEATS.map(b => $storyRow(progress, b, probe, register, geom)) : mobileBlocks())
      )
    ),
    $storyConverge()
  )
}

const journeySteps: { invest: [string, string]; operate: [string, string] }[] = [
  {
    invest: [
      'Deposit once',
      'Fund your own account and browse the leaderboard. Pick funds by their live on-chain record: ROI, drawdown, positions, history.'
    ],
    operate: [
      'Create your fund',
      'Name it, pick a base token, seed it with your own capital. It lands on the public leaderboard from day one.'
    ]
  },
  {
    invest: [
      'Sign your rules',
      'How much per trade, how often, when to stop. One signature, no capital moves yet, revoke anytime.'
    ],
    operate: [
      'Get backed',
      'Backers subscribe to your fund under their own signed rules. You never hold or manage anyone’s money.'
    ]
  },
  {
    invest: [
      'Your capital follows',
      'When the trader trades, your matched amount is pulled and you get fund shares at a price verified on-chain. Out of budget or on cooldown? The match simply skips.'
    ],
    operate: [
      'Trade as you always do',
      'By hand on GMX or through an agent. Backer capital rides your position, and every action is checked against their rules before it executes.'
    ]
  },
  {
    invest: [
      'Exit anytime',
      'Sell your shares into the exit queue and claim back to your wallet, at the same on-chain-verified price.'
    ],
    operate: [
      'Earn on the upside',
      'Your capital compounds and your record is public. You can never exit ahead of your backers: your shares redeem pro-rata with theirs.'
    ]
  }
]

const $stepBadge = (n: number): I$Node =>
  $row(
    style({
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      flexShrink: '0',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colorShade(palette.foreground, 18),
      fontSize: text.sm,
      fontWeight: '600',
      color: palette.message
    })
  )($text(String(n)))

const $spine = (n: number, first: boolean, last: boolean, center: boolean): I$Node =>
  $column(style({ alignItems: 'center', width: center ? '56px' : '44px', flexShrink: '0', alignSelf: 'stretch' }))(
    $node(
      style({
        width: '2px',
        flex: center ? '1' : '0 0 0px',
        backgroundColor: first ? 'transparent' : colorShade(palette.foreground, 25)
      })
    )(),
    $stepBadge(n),
    $node(
      style({ width: '2px', flex: '1', backgroundColor: last ? 'transparent' : colorShade(palette.foreground, 25) })
    )()
  )

const $ladderCell = (accent: string, kicker: string, title: string, body: string, pad: boolean): I$Node =>
  $column(spacing.small, style({ flex: '1', minWidth: '0', paddingBottom: pad ? '36px' : '0' }))(
    $personaKicker(accent, kicker),
    $heading3($text(title)),
    $node(style({ fontSize: text.sm, lineHeight: '1.6', color: palette.foreground }))($text(body))
  )

const $journeys = (): I$Node =>
  $section(
    $sectionHeading('Side by side', 'The same trade, seen from both sides.'),
    $column(style({ width: '100%' }))(
      ...journeySteps.map((step, i) => {
        const first = i === 0
        const last = i === journeySteps.length - 1
        return isDesktopScreen
          ? $row(style({ width: '100%' }))(
              $ladderCell(palette.primary, 'You invest', step.invest[0], step.invest[1], !last),
              $spine(i + 1, first, last, true),
              $ladderCell(palette.positive, 'You operate', step.operate[0], step.operate[1], !last)
            )
          : $row(style({ width: '100%' }))(
              $spine(i + 1, first, last, false),
              $column(spacing.default, style({ flex: '1', minWidth: '0', paddingBottom: last ? '0' : '36px' }))(
                $ladderCell(palette.primary, 'You invest', step.invest[0], step.invest[1], false),
                $ladderCell(palette.positive, 'You operate', step.operate[0], step.operate[1], false)
              )
            )
      })
    ),
    isDesktopScreen
      ? $row(style({ width: '100%' }))(
          $row(style({ flex: '1', justifyContent: 'center' }))(
            $navPill('Puppet Funds', routeSchema.leaderboard, false, palette.primary, $puppetLogo)
          ),
          $node(style({ width: '56px', flexShrink: '0' }))(),
          $row(style({ flex: '1', justifyContent: 'center' }))(
            $navPill('Create a Fund', routeSchema.quickstart, true, undefined, $puppeteer)
          )
        )
      : $column(spacing.default, style({ alignItems: 'center' }))(
          $navPill('Puppet Funds', routeSchema.leaderboard, false, palette.primary, $puppetLogo),
          $navPill('Create a Fund', routeSchema.quickstart, true, undefined, $puppeteer)
        )
  )

const $tradeToday = (): I$Node =>
  $section(
    $sectionHeading('Run it your way', 'Trade exactly as you do today.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'center' }))(
      $column(spacing.default, style({ flex: '1 1 280px', minWidth: '260px' }))(
        $body(
          'Connect your fund to app.gmx.io through WalletConnect and the fund itself shows up as the connected wallet. You trade by hand, exactly as before.'
        ),
        $body(
          'Under the hood every order needs two signatures: yours and the protocol’s, which checks the trade is on GMX and inside each backer’s signed rules before it executes. Backer capital rides along automatically.'
        ),
        $row(style({ paddingTop: '4px' }))($navPill('Get started', routeSchema.quickstart, false))
      ),
      $node(style({ flex: '1 1 320px', minWidth: '280px' }))($video('assets/video/trade-adjust.mp4'))
    )
  )

const $agentGuard = (label: string): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $icon({ $content: $check, width: '15px', viewBox: '0 0 24 24', fill: palette.positive }),
    $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.5' }))($text(label))
  )

const $agentSection = (): I$Node =>
  $section(
    $sectionHeading('Or go headless', 'The operator doesn’t have to be human.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'center' }))(
      $column(spacing.default, style({ flex: '1 1 320px', minWidth: '280px' }))(
        $terminal(['bunx @puppet.fund/templates my-operator gmx', 'bun run dev'], 'scaffold an operator'),
        $body(
          'One command scaffolds a running agent, and a local encrypted handshake pairs it to your fund in minutes. In the LLM template, Claude proposes long, flat, or close, and deterministic code enforces every cap. The model can never size, route, or withdraw.'
        )
      ),
      $column(spacing.default, style({ flex: '1 1 260px', minWidth: '240px' }))(
        $agentGuard('Dry-run by default, flip to live when ready'),
        $agentGuard('On-chain stop that fires even if the operator is offline'),
        $agentGuard('Drawdown halt and cost budget'),
        $agentGuard('The operator key can never withdraw'),
        $node(style({ fontSize: text.base, fontWeight: '700', color: palette.message, paddingTop: '8px' }))(
          $text('Fund the agent. Don’t trust it.')
        )
      )
    )
  )

const $trustCard = ($glyph: I$Node, viewBox: string, title: string, desc: string): I$Node =>
  $card(spacing.default, style({ flex: '1', minWidth: '240px' }))(
    $featureIcon($glyph, palette.foreground, viewBox),
    $heading3($text(title)),
    $node(style({ fontSize: text.sm, lineHeight: '1.6', color: palette.foreground }))($text(desc))
  )

const $trust = (): I$Node =>
  $section(
    $sectionHeading('Security', 'Your money never leaves your control.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $trustCard(
        $wallet,
        '0 0 32 32',
        'You keep custody',
        'Your capital sits in a smart account only you can withdraw from. The protocol never holds it, and funds can only ever return to your own wallet.'
      ),
      $trustCard(
        $smartContract,
        '0 0 24 24',
        'Operators can’t withdraw',
        'A trader or agent opens and manages positions for you, but can never move funds out of your account. Every action is co-signed against the rules you set, or it never executes.'
      ),
      $trustCard(
        $gmx,
        '0 0 32 32',
        'Only verifiable venues',
        'Funds flow only through venues the protocol can screen for safety, like GMX perpetuals on Arbitrum today. Anything it cannot verify on-chain is rejected.'
      )
    )
  )

const $socialIcon = ($glyph: I$Node, viewBox: string, href: string): I$Node =>
  $element('a')(
    attr({ href, target: '_blank', rel: 'noopener' }),
    style({ display: 'inline-flex', padding: '8px', borderRadius: '8px', cursor: 'pointer' }),
    stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 12) })
  )($icon({ $content: $glyph, width: '22px', fill: palette.foreground, viewBox }))

const $finalCta = (): I$Node =>
  $column(
    spacing.big,
    style({ alignItems: 'center', textAlign: 'center', width: '100%', paddingTop: isDesktopScreen ? '8px' : '0' })
  )(
    $heading2($text('Fund or get funded.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '560px' }))(
      $text('Back a trader, human or machine, without ever handing over your money. Or run the fund, and get backed to trade.')
    ),
    $row(spacing.default, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $navPill('Create a Fund', routeSchema.quickstart, true, undefined, $puppeteer),
      $navPill('Puppet Funds', routeSchema.leaderboard, false, palette.primary, $puppetLogo),
      $pillAnchor(false)(attr({ href: DOCS_URL, target: '_blank', rel: 'noopener' }))($text('Read the docs'))
    ),
    $row(spacing.default, style({ alignItems: 'center', paddingTop: '12px' }))(
      $socialIcon($github, '0 0 32 32', GITHUB_REPO_URL),
      $socialIcon($twitter, '0 0 24 24', TWITTER_URL),
      $socialIcon($gitbook, '0 0 32 32', DOCS_URL)
    )
  )

export const $Home = () =>
  component(() => [
    $column(
      style({ width: '100%', gap: isDesktopScreen ? '80px' : '56px', padding: isDesktopScreen ? '0' : '0 16px' })
    )($vortexBackground(), $hero(), $storyline(), $journeys(), $tradeToday(), $agentSection(), $trust(), $finalCta())
  ])
