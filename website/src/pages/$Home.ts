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
import { $check, $gitbook, $github, $gmx, $icon, $smartContract, $twitter, $wallet, text } from '@/ui-components'
import { $puppetLogo } from '../common/$icons.js'
import { $heading2, $heading3 } from '../common/$text.js'
import { $card, $mockWindow } from '../common/elements/$common.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { $body, $launchCta, $pillAnchor, $terminal } from './$onboarding.js'

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

const $featureIcon = ($glyph: I$Node, accent: string, viewBox: string): I$Node =>
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
      )(
        $text('A shared wallet,'),
        $node(style({ display: 'block' }))($text('operated by humans and agents'))
      ),
      $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '660px' }))(
        $text(
          'Top traders seamlessly earn more. Puppets (investors) add capital and share the gains, within rules they set once and any EVM chain enforces.'
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
      )($text('Back the best. Or become one.')),
      $launchCta()
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

const $reveal = $node(attr({ 'data-reveal': '' }), style({ width: '100%' }))

const $panel = $card(
  style({ flex: '1 1 260px', minWidth: '240px', border: `1px solid ${colorShade(palette.foreground, 14)}` })
)

const $panelBody = $node(style({ fontSize: text.sm, lineHeight: '1.6', color: palette.foreground }))

const $pillar = ($glyph: I$Node, viewBox: string, title: string, body: string): I$Node =>
  $panel($featureIcon($glyph, palette.primary, viewBox), $heading3($text(title)), $panelBody($text(body)))

const $pillars = (): I$Node =>
  $section(
    $sectionHeading('What you get', 'Your wallet, backed.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $pillar(
        $wallet,
        '0 0 32 32',
        'One address everywhere',
        'A self-custody wallet with the same address on every chain and venue. Trade GMX on Arbitrum today; the hub on Optimism keeps every fund and pays every redemption.'
      ),
      $pillar(
        $puppetLogo,
        '0 0 32 32',
        'Backing under your rules',
        'Backers deposit once on the hub under mandates they sign: which trader, how much per round, how often, until when. Each round the trader funds takes their share and buys them units in the trader\'s fund.'
      ),
      $pillar(
        $smartContract,
        '0 0 24 24',
        'One price for everyone',
        'Every unit in a fund is priced at the valuation the attestor verified. Stakes buy units and redemptions pay them out at that price, so nobody exits ahead of anyone else.'
      )
    )
  )

const $chip = (label: string): I$Node =>
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
      title: 'Open your account',
      body: 'One signature derives it. Deposit on Arbitrum and your first trade opens your fund, carrying as much backing as your own stake allows.',
      vs: 'Instead of a Telegram group and a screenshot.'
    },
    puppet: {
      title: 'Deposit',
      body: 'Deposit on the Optimism hub and browse the leaderboard. Every trader shows their fund, valuations and redemptions straight from the chain.',
      vs: 'Instead of wiring funds to a stranger.'
    }
  },
  {
    t: 0.42,
    master: {
      title: 'Get backed',
      body: 'Mandates match your trades as you make them. Backing is escrowed on the hub, is never transferred to you, and can never exceed the share of your pool your skin allows.',
      vs: 'Instead of holding anyone else\'s money.'
    },
    puppet: {
      title: 'Sign a mandate',
      body: 'One signature sets your rules: which trader, how much of your deposit per round, how often, and when it expires. Nothing moves until the trader funds a round, and signing a new mandate replaces the old one.',
      vs: 'Instead of trusting a promise.'
    }
  },
  {
    t: 0.66,
    master: {
      title: 'Trade, then redeem',
      body: 'By hand on GMX or through your agent, exactly as you do today. Every order is checked before it signs, and your fee is paid when backer units pay out.',
      vs: 'Instead of winning quietly, alone.'
    },
    puppet: {
      title: 'Sell when you choose',
      body: 'Sell units into the trader\'s redemption queue and get paid to your hub deposit as it drains, at the same price as everyone else, gains and losses alike.',
      vs: 'Instead of asking for a payout.'
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
      $storyCell(MASTER_COLOR, 'You trade', beat.master, true)
    ),
    $node(style({ position: 'relative', flex: `0 0 ${STORY_SPINE.w}px`, alignSelf: 'stretch' }))(
      ...$trailMark(progress, beat.t, MASTER_COLOR, STORY_SPINE, 'left', probe, register, geom),
      ...$trailMark(progress, beat.t, PUPPET_COLOR, STORY_SPINE, 'right', probe, register, geom)
    ),
    $node(attr({ 'data-reveal': 'r' }), style({ flex: '1', minWidth: '0', display: 'flex' }))(
      $storyCell(PUPPET_COLOR, 'You back', beat.puppet, false)
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
    $heading2($text('One wallet between them.')),
    $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.foreground, maxWidth: '520px' }))(
      $text('The trader operates it, the backer rules it, the chain prices both.')
    ),
    $row(spacing.small, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $chip('Backing capped by the trader\'s skin'),
      $chip('One unit price, for everyone'),
      $chip('Your keys on both sides')
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
        'You trade',
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
        'You back',
        'right',
        beat.puppet,
        probe,
        register,
        geom
      )
    ])

  return $section(
    $sectionHeading('How it works', 'Three steps, seen from both sides.'),
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
    $storyConverge(),
    $launchCta()
  )
}

const $venueChip = ($glyph: I$Node, label: string): I$Node =>
  $row(
    spacing.small,
    style({
      alignItems: 'center',
      padding: '8px 14px',
      borderRadius: '20px',
      border: `1px solid ${colorShade(palette.foreground, 20)}`
    })
  )($glyph, $node(style({ fontSize: text.sm, color: palette.message }))($text(label)))

const $chainLogo = (chainId: number, alt: string): I$Node =>
  $element('img')(attr({ src: `assets/chain/${chainId}.svg`, alt }), style({ width: '18px', height: '18px' }))()

const $venues = (): I$Node =>
  $section(
    $sectionHeading('Trade where you already trade', 'The same wallet, on the venues you use.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'center' }))(
      $column(spacing.default, style({ flex: '1 1 300px', minWidth: '260px' }))(
        $body(
          'Connect the wallet to app.gmx.io over WalletConnect and it shows up as the connected account. You trade by hand, exactly as before, and the same address signs into Hyperliquid.'
        ),
        $body(
          'Every order is signed with the wallet\'s joint key: your share on your device, the attestor\'s share at the protocol. The attestor can refuse an order that breaks your rules. It cannot place one, and it cannot move value.'
        ),
        $row(spacing.small, style({ flexWrap: 'wrap', paddingTop: '4px' }))(
          $venueChip($icon({ $content: $gmx, width: '18px', viewBox: '0 0 32 32', fill: palette.message }), 'GMX'),
          $venueChip($chainLogo(42161, 'Arbitrum'), 'Arbitrum'),
          $venueChip($chainLogo(10, 'Optimism'), 'Optimism hub')
        )
      ),
      $node(style({ flex: '1 1 320px', minWidth: '280px' }))($video('assets/video/trade-adjust.mp4'))
    )
  )

const $guard = (label: string): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $icon({ $content: $check, width: '15px', viewBox: '0 0 24 24', fill: palette.positive }),
    $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.5' }))($text(label))
  )

const $agents = (): I$Node =>
  $section(
    $sectionHeading('Or hand it to an agent', 'The master does not have to be human.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'center' }))(
      $column(spacing.default, style({ flex: '1 1 320px', minWidth: '280px' }))(
        $terminal(['bunx @puppet.fund/templates my-operator gmx', 'bun run dev'], 'scaffold an operator'),
        $body(
          'One command scaffolds an operator and a local encrypted handshake pairs it to your wallet. The agent holds your share of the key in memory on the machine you run it on, so it acts exactly as you would, under exactly the same rules.'
        )
      ),
      $column(spacing.default, style({ flex: '1 1 260px', minWidth: '240px' }))(
        $guard('Your key share stays in its memory, never on disk'),
        $guard('Every order is screened against your rules before it signs'),
        $guard('Value can only ever return to your own wallet'),
        $node(style({ fontSize: text.base, fontWeight: '700', color: palette.message, paddingTop: '8px' }))(
          $text('Back the agent. Don\'t trust it.')
        )
      )
    )
  )

const $trustCard = ($glyph: I$Node, viewBox: string, title: string, desc: string): I$Node =>
  $panel($featureIcon($glyph, palette.foreground, viewBox), $heading3($text(title)), $panelBody($text(desc)))

const $trust = (): I$Node =>
  $section(
    $sectionHeading('Security', 'Nothing here can take your money.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $trustCard(
        $wallet,
        '0 0 32 32',
        'Your key, your wallet',
        'The wallet is an address only your key pair can sign for. The protocol holds no funds and never holds the whole key.'
      ),
      $trustCard(
        $smartContract,
        '0 0 24 24',
        'A veto, never a spender',
        'The attestor\'s share of the key can refuse an action. It cannot start one, and it cannot move value anywhere.'
      ),
      $trustCard(
        $puppetLogo,
        '0 0 32 32',
        'Value returns only to you',
        'Every withdrawal pays your own wallet address. There is no field for anyone else\'s.'
      ),
      $trustCard(
        $check,
        '0 0 24 24',
        'Exit without us',
        'Arm the seven-day clock from your wallet alone, and the chain returns your funds even if the protocol goes dark.'
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
    $heading2($text('Launch your trading wallet.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '560px' }))(
      $text('Back the traders you trust, or trade with backing from others. Your keys, your rules, human or agent.')
    ),
    $launchCta(),
    $pillAnchor(false)(attr({ href: DOCS_URL, target: '_blank', rel: 'noopener' }))($text('Read the docs')),
    $row(spacing.default, style({ alignItems: 'center', paddingTop: '12px' }))(
      $socialIcon($github, '0 0 32 32', GITHUB_REPO_URL),
      $socialIcon($twitter, '0 0 24 24', TWITTER_URL),
      $socialIcon($gitbook, '0 0 32 32', DOCS_URL)
    )
  )

export const $Home = () =>
  component(() => {
    ensureStoryStyles()
    return [
      $column(
        style({ width: '100%', gap: isDesktopScreen ? '80px' : '56px', padding: isDesktopScreen ? '0' : '0 16px' })
      )(
        $vortexBackground(),
        $hero(),
        $reveal($pillars()),
        $storyline(),
        $reveal($venues()),
        $reveal($agents()),
        $reveal($trust()),
        $reveal($finalCta())
      )
    ]
  })
