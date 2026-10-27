import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { AGENT_TEMPLATES, agentLinkLineOf, type IAgentReply, randomHex } from '@puppet/sdk/agent'
import { CHAIN_TOKEN_MAP, type ChainId, PRECISION } from '@puppet/sdk/const'
import { readableAddress } from '@puppet/sdk/core'
import { randomCells, randomSymbol, robotCellsOf } from '@puppet/sdk/ui-components'
import { GMX_ROUTER } from '@puppet/sdk/venue'
import { type IStream, just, map, merge, op, skipRepeats, start, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $custom, $element, $node, $text, $wrapNativeElement, attr, attrBehavior, component, fromEventTarget, type I$Node, type INode, motion, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $defaultInputContainer, $defaultNumberTickerSlot, $defaultPopoverContentContainer, $NumberTicker, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette, theme } from 'aelea/ui-components-theme'
import {
  $Baseline,
  $browser,
  $ButtonPrimary,
  $ButtonSecondary,
  $check,
  $copy,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $document,
  $download,
  $DropMenu,
  $gitbook,
  $github,
  $icon,
  $infoTooltip,
  $labeledDivider,
  $puppet,
  $puppeteer,
  $robinhood,
  $robot,
  $smartContract,
  $spacex,
  $terminal,
  $twitter,
  $wallet,
  keyActivate,
  text
} from '@/ui-components'
import type { IAgentIdentity } from '../app/localStoreSchema.js'
import kevinWarshPhoto from '../assets/home/kevin-warsh.jpg'
import leaderboardPickTradersVideo from '../assets/video/leaderboard-pick-traders.mp4'
import { $jazzicon } from '../common/$avatar.js'
import { chainName } from '../common/$chain.js'
import { $tokenIcon, $tokenProfile } from '../common/$common.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $defaultTextFieldContainer, $FieldLabeled } from '../ui-components/form/$TextField.js'
import { $puppetLogo } from '../common/$icons.js'
import { $venueIcon } from '../common/$operationView.js'
import { $heading2, $heading3 } from '../common/$text.js'
import { $card, $card2, $mockWindow } from '../common/elements/$common.js'
import { $agentRequestRow, $agentStatus, agentActionOf, type IAgentStatus } from '../components/$AgentLink.js'
import { $sessionRow } from '../components/$sessionRow.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { MINUS, signedDollar } from '../io/price.js'
import { $launchCta, $navPill, $pillAnchor } from './$onboarding.js'
import { routeSchema } from '../app/routeSchema.js'
import { $stack, $video } from './common.js'

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

  const hues = ['236, 72, 130', '139, 92, 246']
  const sprites = new Map<string, HTMLCanvasElement>()
  for (const rgb of [...hues, '255, 255, 255']) {
    const sprite = document.createElement('canvas')
    sprite.width = 64
    sprite.height = 64
    const sctx = sprite.getContext('2d')
    if (!sctx) return $wrapNativeElement(sentinel)(style({ display: 'none' }))()
    const glow = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    glow.addColorStop(0, `rgba(${rgb}, 1)`)
    glow.addColorStop(1, `rgba(${rgb}, 0)`)
    sctx.fillStyle = glow
    sctx.fillRect(0, 0, 64, 64)
    sprites.set(rgb, sprite)
  }

  let w = window.innerWidth
  let h = window.innerHeight
  const resize = () => {
    w = window.innerWidth
    h = window.innerHeight
    canvas.width = w
    canvas.height = h
  }
  resize()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduced) {
    window.addEventListener('resize', resize)
    document.body.appendChild(canvas)
  }

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
  let visible = true
  let raf = 0
  let t = 0
  let grown = 0
  let shownLight: boolean | null = null
  const cleanup = () => {
    cancelAnimationFrame(raf)
    seen.disconnect()
    window.removeEventListener('resize', resize)
    canvas.remove()
  }
  const frame = () => {
    raf = 0
    if (sentinel.isConnected) everConnected = true
    else if (everConnected) return cleanup()
    if (!visible) return
    t += 0.004
    const light = theme.name === 'light'
    if (light !== shownLight) {
      shownLight = light
      canvas.style.opacity = light ? '0.8' : '0.4'
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = light ? 0.12 : 0.07
    ctx.fillStyle = light ? theme.palette.horizon : '#101217'
    ctx.fillRect(0, 0, w, h)
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
      ctx.globalAlpha = (light ? 0.4 : 0.18) * fade
      ctx.drawImage(sprites.get(light ? '255, 255, 255' : p.c)!, p.x - glowR, p.y - glowR, glowR * 2, glowR * 2)
      ctx.globalAlpha = 1
      ctx.fillStyle = light ? `rgba(${p.c}, ${0.7 * fade})` : `rgba(255, 255, 255, ${0.4 * fade})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (p.life <= 0 || dist < 16) Object.assign(p, spawn())
    }
    raf = requestAnimationFrame(frame)
  }
  const seen = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    if (!sentinel.isConnected && everConnected) return cleanup()
    if (visible && raf === 0) raf = requestAnimationFrame(frame)
  })
  if (!reduced) {
    seen.observe(canvas)
    raf = requestAnimationFrame(frame)
  }

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
    $row(style({ alignItems: 'center', gap: '10px', fontSize: text.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.12em', color: palette.foreground }))(
      ...(isDesktopScreen ? [$node(style({ width: '18px', height: '2px', borderRadius: '2px', flexShrink: '0', backgroundColor: PUPPET_COLOR }))()] : []),
      $text(kicker)
    ),
    $heading2($text(title))
  )

const $section = (...$children: I$Node[]): I$Node => $column(spacing.big, style({ width: '100%' }))(...$children)

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
          'Top traders seamlessly earn more, trading on any DeFi dApp. Investors allocate capital and share the gains, within rules they sign once and the EVM enforces.'
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
      )($text('Allocate to the best. Or become one.')),
      $launchCta()
    ),
    $node(
      style({ position: 'relative', zIndex: '2', width: '100%', maxWidth: '680px', perspective: '1400px' }),
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
      )($video(leaderboardPickTradersVideo))
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
[data-orb]::before, [data-orb]::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
[data-orb]::before { box-shadow: 0 0 12px 2px rgba(236, 72, 130, 0.5); animation: puppetOrbPulse 2.8s ease-in-out -1.4s infinite; }
[data-orb]::after { box-shadow: 0 0 28px 8px rgba(139, 92, 246, 0.55); opacity: 0; animation: puppetOrbPulse 2.8s ease-in-out infinite; }
@keyframes puppetOrbPulse {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  [data-reveal], [data-orb]::before, [data-orb]::after { animation: none; }
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

const MASTER_COLOR = 'rgb(139, 92, 246)'
const PUPPET_COLOR = 'rgb(236, 72, 130)'

const PERFORMANCE_FEE = Number(PROTOCOL.performanceFee) / Number(PRECISION.basisPoints)
const MASTER_FEE = PERFORMANCE_FEE * (1 - Number(PROTOCOL.protocolFeeShare) / Number(PRECISION.basisPoints))
const EXAMPLE_STAKE = 1_000
const EXAMPLE_RETURN = 0.4
const randomAddress = (): `0x${string}` =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('')}`
const EXAMPLE_NAMES: string[] = []
while (EXAMPLE_NAMES.length < 4) {
  const name = randomSymbol()
  if (!EXAMPLE_NAMES.includes(name)) EXAMPLE_NAMES.push(name)
}
const EXAMPLE_FUND_NAME = EXAMPLE_NAMES[0]!
const EXAMPLE_PUPPET_ADDRESS = randomAddress()
const EXAMPLE_FUND = robotCellsOf(randomAddress())
const SPRING = { stiffness: 90, damping: 19, precision: 0.0005 }
const USD_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd = (v: number): string => USD_FORMAT.format(v)
const signedUsd = (v: number): string => `${signedDollar(v < 0 ? MINUS : '')}${usd(Math.abs(v)).slice(1)}`
const percent = (f: number): string => `${Number((f * 100).toFixed(1))}%`

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

type IStorySpine = { w: number; xL: number; xR: number; converge: number; amp: number }

const STORY_SPINE: IStorySpine = { w: 96, xL: 28, xR: 68, converge: 200, amp: 2 }
const STORY_SPINE_M: IStorySpine = { w: 40, xL: 12, xR: 28, converge: 150, amp: 1.5 }

const RECORD_START = 1_782_864_000
const RECORD_STEP = 14_400
const RECORD_WINDOW = 180
const RECORD_VALUES: number[] = (() => {
  const values = [0]
  let seed = 29
  let momentum = 0
  let swing = 0
  for (let step = 1; step <= RECORD_WINDOW; step++) {
    seed = (seed * 16807) % 2147483647
    const shock = seed / 2147483647 - 0.5
    momentum = momentum * 0.85 + shock * 0.011
    swing = swing * 0.95 + momentum
    values.push(0.6 * (step / RECORD_WINDOW) ** 1.4 + swing + shock * 0.009)
  }
  const last = values[RECORD_WINDOW]!
  return [...Array.from({ length: RECORD_WINDOW }, () => 0), ...values.map(v => (v * EXAMPLE_RETURN) / last)]
})()
const recordEnd = (l: number): number => RECORD_WINDOW + Math.min(1, l / 0.9) * RECORD_WINDOW
const recordAt = (l: number): number => RECORD_VALUES[Math.round(recordEnd(l))]!
const RECORD = RECORD_VALUES.map((value, step) => ({ time: RECORD_START + step * RECORD_STEP, value }))
const SPARK_DAYS = 29
const sparkOf = (target: number, seed: number): number[] => {
  const values = [0]
  let state = seed
  for (let day = 1; day <= SPARK_DAYS; day++) {
    state = (state * 16807) % 2147483647
    values.push(values[day - 1]! + target / SPARK_DAYS + (state / 2147483647 - 0.5) * target * 0.14)
  }
  const last = values[SPARK_DAYS]!
  return [...Array.from({ length: SPARK_DAYS }, () => 0), ...values.map(v => (v * target) / last)]
}
const EXAMPLE_DEPOSIT = 1_000
const EXAMPLE_PEER = robotCellsOf(randomAddress())
const EXAMPLE_THIRD = robotCellsOf(randomAddress())
const EXAMPLE_LAGGARD = robotCellsOf(randomAddress())
const ALLOCATIONS = [
  { name: EXAMPLE_FUND_NAME, cells: EXAMPLE_FUND, rate: 0.25, monthReturn: EXAMPLE_RETURN },
  { name: EXAMPLE_NAMES[1]!, cells: EXAMPLE_PEER, rate: 0.25, monthReturn: 2 },
  { name: EXAMPLE_NAMES[2]!, cells: EXAMPLE_THIRD, rate: 0.25, monthReturn: 7 }
].map((b, i, all) => {
  const left = all.slice(0, i).reduce((rest, prior) => rest * (1 - prior.rate), EXAMPLE_DEPOSIT)
  return { ...b, left, stake: b.rate * left, growth: 1 + b.monthReturn * (1 - PERFORMANCE_FEE) }
})
const PUPPET_LIST = (
  [
    { name: 'alice.eth', address: '0xa11ce5a100000000000000000000000000000000', balance: 3_000, rate: 0.5, skin: 2 },
    { name: 'bob.eth', address: '0xb0b0b0b000000000000000000000000000000000', balance: 4_000, rate: 0.4, skin: 1 },
    { name: readableAddress(EXAMPLE_PUPPET_ADDRESS), address: EXAMPLE_PUPPET_ADDRESS, balance: EXAMPLE_DEPOSIT, rate: ALLOCATIONS[0]!.rate, skin: 2 }
  ] satisfies { name: string; address: `0x${string}`; balance: number; rate: number; skin: number }[]
).map(b => ({ ...b, amount: Math.min(b.balance * b.rate, EXAMPLE_STAKE * b.skin) }))
const ALLOCATED = PUPPET_LIST.reduce((sum, b) => sum + b.amount, 0)
const STAKE_GAIN = EXAMPLE_STAKE * EXAMPLE_RETURN
const TRADER_EARNED = STAKE_GAIN + ALLOCATED * EXAMPLE_RETURN * MASTER_FEE
const PUPPET_NET = ALLOCATIONS.reduce((sum, b) => sum + b.stake * (b.growth - 1), 0)
const POSITIONS: { lead: () => I$Node; title: string; detail: string; venueIcon: () => I$Node; venue: string; chainId: ChainId; collateral: number }[] = [
  { lead: () => $tokenIcon('ETH', '28px'), title: 'ETH', detail: 'Long · 50x', venueIcon: () => $venueIcon('hyperliquid', 12), venue: 'Hyperliquid', chainId: 42161, collateral: 400 },
  {
    lead: () =>
      $element('img')(
        attr({ src: kevinWarshPhoto, alt: 'Kevin Warsh' }),
        style({ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', flexShrink: '0' })
      )(),
    title: 'Fed cuts in December',
    detail: 'Yes',
    venueIcon: () => $venueIcon('polymarket', 12),
    venue: 'Polymarket',
    chainId: 42161,
    collateral: 250
  },
  {
    lead: () =>
      $row(
        style({
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          flexShrink: '0',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.message
        })
      )($icon({ $content: $spacex, size: '18px', viewBox: '0 0 24 24', fill: palette.background })),
    title: 'SPACEX',
    detail: 'Stock token',
    venueIcon: () => $icon({ $content: $robinhood, size: '12px', viewBox: '0 0 24 24', fill: palette.message }),
    venue: 'Robinhood',
    chainId: 4663,
    collateral: 150
  }
]
const DEPLOYED = POSITIONS.reduce((sum, position) => sum + position.collateral, 0)
const FUND_WALLET: { chainId: ChainId; token: `0x${string}`; rest: number }[] = [
  { chainId: 42161, token: CHAIN_TOKEN_MAP[42161].USDC, rest: 100 },
  { chainId: 4663, token: CHAIN_TOKEN_MAP[4663].ETH, rest: 100 }
]
const opened = (l: number, i: number): number => grow((l - i * 0.1) / 0.4)
const joined = (l: number, i: number): number => grow((l - (0.25 + i * 0.18)) / 0.3)
const puppetJoined = (l: number, i: number): number => grow((l - PUPPET_ARRIVALS[i]!) / 0.2)
const poolAt = (l: number): number => EXAMPLE_STAKE + PUPPET_LIST.reduce((sum, b, i) => sum + b.amount * puppetJoined(l, i), 0)
const IDLE = EXAMPLE_DEPOSIT - ALLOCATIONS.reduce((sum, b) => sum + b.stake, 0)
const EXITED_TOTAL = IDLE + ALLOCATIONS.reduce((sum, b) => sum + b.stake * b.growth, 0)
const allocatedAt = (l: number): number => ALLOCATIONS.reduce((sum, b, i) => sum + b.stake * joined(l, i), 0)
const drained = (l: number, i: number): number => grow((l - i * 0.12) / 0.7)
const exitingAt = (l: number): number => ALLOCATIONS.reduce((sum, b, i) => sum + b.stake * b.growth * (1 - drained(l, i)), 0)
const STORY_SPAN = 360
const PUPPET_ARRIVALS = PUPPET_LIST.map((_, i) => 0.15 + i * 0.16)

const grow = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3
const lit = (local: IStream<number>, from: number, to: number) =>
  styleBehavior(map(l => ({ opacity: (0.3 + 0.7 * Math.min(1, Math.max(0, (l - from) / (to - from)))).toFixed(3) }), local))

const $visCard = $card2(
  style({
    width: '100%',
    maxWidth: '380px',
    gap: '14px',
    padding: isDesktopScreen ? '20px' : '16px',
    textAlign: 'left',
    border: `1px solid ${colorShade(palette.foreground, 12)}`
  })
)
const $visRow = $row(style({ width: '100%', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }))
const $visLabel = $node(style({ fontSize: text.sm, color: palette.foreground }))
const $figure = (value: IStream<number>, parser: (v: number) => string, fontSize: string): I$Node =>
  $NumberTicker({
    value,
    parser,
    slots: 9,
    incrementColor: palette.positive,
    decrementColor: palette.foreground,
    $slot: $defaultNumberTickerSlot(style({ fontSize, fontWeight: '700', fontFamily: 'var(--font-numbers)', color: palette.message }))
  })
const $statusPill = $node(
  style({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: '14px',
    fontSize: text.xs,
    fontWeight: '700',
    whiteSpace: 'nowrap'
  })
)
const $positionRow = ($lead: I$Node, title: string, detail: string, $venueIcon: I$Node, venue: string, value: IStream<number>, parser: (v: number) => string): I$Node =>
  $visRow(
    $row(spacing.small, style({ alignItems: 'center', flex: '1', minWidth: '0' }))(
      $lead,
      $column(style({ gap: '2px', minWidth: '0' }))(
        $node(style({ fontWeight: '700', color: palette.message, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }))(
          $text(title)
        ),
        $row(style({ alignItems: 'center', gap: '4px', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
          $text(`${detail} on`),
          $venueIcon,
          $text(venue)
        )
      )
    ),
    $node(style({ flexShrink: '0' }))($figure(value, parser, text.base))
  )
const $holderRow = ($avatar: I$Node, $name: I$Node, detail: string, share: IStream<number>, amount: IStream<number>, color: string): I$Node =>
  $column(style({ gap: '6px', width: '100%' }))(
    $visRow(
      $row(spacing.small, style({ alignItems: 'center' }))(
        $avatar,
        $column(style({ gap: '2px' }))(
          $name,
          $node(style({ fontSize: text.xs, color: palette.foreground }))($text(detail))
        )
      ),
      $figure(amount, usd, text.base)
    ),
    $node(style({ height: '4px', borderRadius: '4px', backgroundColor: colorShade(palette.foreground, 20) }))(
      $node(
        style({ height: '4px', borderRadius: '4px', backgroundColor: color }),
        styleBehavior(map(v => ({ width: `${(100 * v).toFixed(2)}%` }), share))
      )()
    )
  )

type IStoryVoice = { title: string; body: string; vs: string; visual: (local: IStream<number>) => I$Node }
type IStoryBeat = { t: number; master: IStoryVoice; puppet: IStoryVoice }

const STORY_BEATS: IStoryBeat[] = [
  {
    t: 0.18,
    master: {
      title: 'Launch your fund',
      body: 'Trade on any EVM chain and venue, with lower fees on GMX and Hyperliquid. Every trade builds your public record.',
      vs: 'Instead of a Telegram group and a screenshot.',
      visual: local =>
        $visCard(
          $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.foreground }))($text('Wallet')),
          ...FUND_WALLET.map(held =>
            $visRow(
              $tokenProfile(held.chainId, held.token, 28, true, chainName(held.chainId)),
              $figure(
                map(
                  l => held.rest + POSITIONS.reduce((sum, position, i) => (position.chainId === held.chainId ? sum + position.collateral * (1 - opened(l, i)) : sum), 0),
                  local
                ),
                usd,
                text.base
              )
            )
          ),
          $visRow(
            $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.foreground }))($text('Positions')),
              $statusPill(lit(local, 0.3, 0.6), style({ opacity: '0.3', backgroundColor: colorShade(palette.positive, 16), color: palette.positive }))(
                $text('Live')
              )
            ),
            $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.foreground }))($text('Collateral'))
          ),
          ...POSITIONS.map((position, i) =>
            $positionRow(
              position.lead(),
              position.title,
              position.detail,
              position.venueIcon(),
              position.venue,
              map(l => position.collateral * opened(l, i), local),
              usd
            )
          )
        )
    },
    puppet: {
      title: 'Manage your portfolio',
      body: 'Pick the best funds and set the rules, without handing over your money.',
      vs: 'Instead of wiring funds to a stranger.',
      visual: local =>
        $visCard(
          $visRow(
            $column(style({ gap: '4px' }))(
              $node(style({ fontSize: text.xs, color: palette.foreground }))($text('Deposited')),
              $tokenProfile(HUB_CHAIN_ID, CHAIN_TOKEN_MAP[HUB_CHAIN_ID].USDC, 22)
            ),
            $figure(map(l => EXAMPLE_DEPOSIT * grow(l / 0.45), local), usd, text.base)
          ),
          $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.foreground }))(
            $text('Leaderboard')
          ),
          ...[
            ...ALLOCATIONS.map(b => ({ name: b.name, cells: b.cells, roi: b.monthReturn, picked: true })),
            { name: EXAMPLE_NAMES[3]!, cells: EXAMPLE_LAGGARD, roi: -0.18, picked: false }
          ].map((b, i) => {
            const values = sparkOf(b.roi, 11 + i * 17)
            const points = values.map((value, day) => ({ time: RECORD_START + day * 86_400, value }))
            const day = op(
              local,
              map(l => Math.round(SPARK_DAYS + Math.min(1, Math.max(0, l / 0.8)) * SPARK_DAYS)),
              skipRepeats
            )
            const roiAt = (d: number): number => values[d]!
            return $visRow(
              $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                $row(spacing.small, style({ alignItems: 'center', fontWeight: '700', fontSize: text.xs, color: palette.message }))($fundAvatar(b.cells, 30), $text(b.name)),
                ...(b.picked
                  ? [
                      $statusPill(lit(local, 0.35 + i * 0.2, 0.6 + i * 0.2), style({ opacity: '0.3', backgroundColor: PUPPET_COLOR, color: 'white' }))(
                        $text('Picked')
                      )
                    ]
                  : [$defaultMiniButtonPrimary(style({ pointerEvents: 'none' }), attr({ tabindex: '-1', 'aria-hidden': 'true' }))($text('Mandate'))])
              ),
              $row(style({ position: 'relative', width: '120px', height: '44px', flexShrink: '0', overflow: 'hidden', isolation: 'isolate' }))(
                $node(style({ position: 'absolute', inset: '0px', display: 'flex', pointerEvents: 'none' }))(
                  $Baseline({
                    series: map(d => points.slice(d - SPARK_DAYS, d + 1), day),
                    baseline: 0,
                    scaleFloor: Math.abs(b.roi) * 0.2,
                    margin: 0.12,
                    headroom: '0px',
                    lineWidth: 1,
                    tip: false,
                    axis: null,
                    under: null
                  })({})
                ),
                $row(
                  style({
                    position: 'absolute',
                    inset: '0',
                    zIndex: '6',
                    alignItems: 'center',
                    pointerEvents: 'none',
                    background: `linear-gradient(to right, ${palette.middleground} 0%, ${palette.middleground} 32%, transparent 100%)`
                  })
                )(
                  $stack(
                    $node(
                      style({ fontWeight: '700', fontSize: text.sm }),
                      styleBehavior(map(d => ({ color: roiAt(d) > 0 ? palette.positive : roiAt(d) < 0 ? palette.negative : palette.foreground }), day))
                    )($text(map(d => `${roiAt(d) < 0 ? MINUS : ''}${percent(Math.abs(roiAt(d)))}`, day))),
                    $node(style({ fontSize: text.xs, color: palette.foreground }))($text('ROI · 30d')),
                    'flex-start'
                  )
                )
              )
            )
          })
        )
    }
  },
  {
    t: 0.42,
    master: {
      title: 'Get allocations',
      body: 'Allocate to a round and puppets join at the same price, capped by your shares.',
      vs: 'Instead of holding anyone else\'s money.',
      visual: local =>
        $visCard(
          $visRow(
            $visLabel($text('Capital in your round')),
            $figure(map(poolAt, local), usd, text.base)
          ),
          $holderRow(
            $fundAvatar(EXAMPLE_FUND, 28),
            $row(spacing.tiny, style({ alignItems: 'center', fontWeight: '700', color: palette.message }))(
              $text('You'),
              $icon({ $content: $puppeteer, width: '13px', viewBox: '0 0 32 32', fill: palette.foreground })
            ),
            'Your shares · set each puppet\'s cap',
            map(l => EXAMPLE_STAKE / poolAt(l), local),
            just(EXAMPLE_STAKE),
            palette.message
          ),
          ...PUPPET_LIST.map((b, i) =>
            $holderRow(
              $jazzicon(b.address, 28),
              $row(spacing.tiny, style({ alignItems: 'center', fontWeight: '700', color: palette.message }))(
                $text(b.name),
                ...(b.address === EXAMPLE_PUPPET_ADDRESS ? [$icon({ $content: $puppet, width: '13px', viewBox: '0 0 32 32', fill: palette.foreground })] : [])
              ),
              b.amount < b.balance * b.rate ? `Capped at ${b.skin}x your shares` : `Up to ${percent(b.rate)} of ${usd(b.balance)}`,
              map(l => (b.amount * puppetJoined(l, i)) / poolAt(l), local),
              map(l => b.amount * puppetJoined(l, i), local),
              palette.foreground
            )
          )
        )
    },
    puppet: {
      title: 'Sign your mandates',
      body: 'Pace how much of your balance each round takes, capped by the master\'s own stake. Nothing moves until the master allocates.',
      vs: 'Instead of trusting a promise.',
      visual: local =>
        $visCard(
          $visRow(
            $row(spacing.small, style({ alignItems: 'center' }))(
              $jazzicon(EXAMPLE_PUPPET_ADDRESS, 20),
              $node(style({ fontWeight: '700', color: palette.message }))($text('Mandates')),
              $statusPill(lit(local, 0.1, 0.3), style({ opacity: '0.3', backgroundColor: colorShade(palette.positive, 16), color: palette.positive }))(
                $text('Signed')
              )
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))($text('6-hour cooldown'))
          ),
          ...ALLOCATIONS.map((b, i) =>
            $visRow(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $fundAvatar(b.cells, 28),
                $column(style({ gap: '2px' }))(
                  $node(style({ fontWeight: '700', color: palette.message }))($text(b.name)),
                  $node(style({ fontSize: text.xs, color: palette.foreground }))($text(`Up to ${percent(b.rate)} of ${usd(b.left)}`))
                )
              ),
              $figure(map(l => b.stake * joined(l, i), local), usd, text.base)
            )
          ),
          $row(
            style({
              width: '100%',
              height: '10px',
              gap: '2px',
              borderRadius: '5px',
              overflow: 'hidden',
              backgroundColor: colorShade(palette.foreground, 14)
            })
          )(
            ...ALLOCATIONS.map((b, i) =>
              $node(
                style({ height: '100%', flexShrink: '0', backgroundColor: colorShade(PUPPET_COLOR, 100 - i * 28) }),
                styleBehavior(map(l => ({ width: `${((100 * b.stake * joined(l, i)) / EXAMPLE_DEPOSIT).toFixed(2)}%` }), local))
              )()
            )
          ),
          $visRow(
            $column(style({ gap: '2px' }))(
              $node(style({ fontSize: text.sm, color: PUPPET_COLOR }))($text('Allocated')),
              $figure(map(allocatedAt, local), usd, text.base)
            ),
            $column(style({ gap: '2px', alignItems: 'flex-end' }))(
              $visLabel($text('In your account')),
              $figure(map(l => EXAMPLE_DEPOSIT - allocatedAt(l), local), usd, text.base)
            )
          )
        )
    }
  },
  {
    t: 0.66,
    master: {
      title: 'Trade, then redeem',
      body: `Trade in the apps you know. Redeem exits and earn ${percent(MASTER_FEE)} of puppets' gains.`,
      vs: 'Instead of winning quietly, alone.',
      visual: local =>
        $visCard(
          $visRow(
            $row(style({ alignItems: 'center', gap: '6px', fontSize: text.sm, color: palette.foreground, whiteSpace: 'nowrap' }))(
              $fundAvatar(EXAMPLE_FUND, 18),
              $node(style({ fontWeight: '700', color: palette.message }))($text(EXAMPLE_FUND_NAME)),
              $text('earnings')
            ),
            $figure(map(l => EXAMPLE_STAKE * recordAt(l) + Math.max(0, ALLOCATED * recordAt(l)) * MASTER_FEE, local), signedUsd, text.base)
          ),
          $row(style({ position: 'relative', width: '100%', height: '72px', overflow: 'hidden', isolation: 'isolate' }))(
            $node(style({ position: 'absolute', inset: '0px', display: 'flex', pointerEvents: 'none' }))(
              $Baseline({
                series: op(local, map(l => Math.round(recordEnd(l))), skipRepeats, map(d => RECORD.slice(d - RECORD_WINDOW, d + 1))),
                baseline: 0,
                scaleFloor: 0.08,
                margin: 0.12,
                headroom: '0px',
                lineWidth: 1,
                tip: false,
                axis: null,
                under: null
              })({})
            ),
            $row(
              style({
                position: 'absolute',
                inset: '0',
                zIndex: '6',
                alignItems: 'center',
                paddingLeft: '4px',
                pointerEvents: 'none',
                background: `linear-gradient(to right, ${palette.middleground} 0%, ${palette.middleground} 38%, transparent 100%)`
              })
            )(
              $stack(
                $node(
                  style({ fontWeight: '700', fontFamily: 'var(--font-numbers)' }),
                  styleBehavior(
                    map(l => {
                      const v = recordAt(l)
                      return { color: v > 0 ? palette.positive : v < 0 ? palette.negative : palette.foreground }
                    }, local)
                  )
                )(
                  $text(
                    map(l => {
                      const pnl = recordAt(l) * (EXAMPLE_STAKE + ALLOCATED)
                      return `${signedDollar(pnl < 0 ? MINUS : '')}${usd(Math.abs(pnl)).slice(1)}`
                    }, local)
                  )
                ),
                $node(style({ fontSize: text.xs, color: palette.foreground }))(
                  $text(map(l => `${recordAt(l) < 0 ? MINUS : ''}${percent(Math.abs(recordAt(l)))} ROI · 30d`, local))
                ),
                'flex-start'
              )
            )
          ),
          ...POSITIONS.map(position =>
            $positionRow(
              position.lead(),
              position.title,
              position.detail,
              position.venueIcon(),
              position.venue,
              map(l => (recordAt(l) * (EXAMPLE_STAKE + ALLOCATED) * position.collateral) / DEPLOYED, local),
              signedUsd
            )
          )
        )
    },
    puppet: {
      title: 'Sell when you choose',
      body: "Sell into the exit queue. The fund's next redemption pays the whole queue at one price.",
      vs: 'Instead of trusting a master to pay everyone fairly.',
      visual: local =>
        $visCard(
          $visRow(
            $row(spacing.small, style({ alignItems: 'center' }))(
              $jazzicon(EXAMPLE_PUPPET_ADDRESS, 20),
              $node(style({ fontWeight: '700', color: palette.message }))($text('Exit queue'))
            ),
            $statusPill(style({ backgroundColor: colorShade(palette.foreground, 12), color: palette.message }))(
              $text('Same price as everyone')
            )
          ),
          ...ALLOCATIONS.map((b, i) =>
            $visRow(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $fundAvatar(b.cells, 28),
                $column(style({ gap: '2px' }))(
                  $node(style({ fontWeight: '700', color: palette.message }))($text(b.name)),
                  $node(style({ fontSize: text.xs, color: palette.foreground }))($text(`${percent(b.monthReturn)} ROI · 30d`))
                )
              ),
              $figure(map(l => b.stake * (b.growth - 1) * drained(l, i), local), usd, text.base)
            )
          ),
          $row(
            style({
              width: '100%',
              height: '10px',
              gap: '2px',
              borderRadius: '5px',
              overflow: 'hidden',
              backgroundColor: colorShade(palette.foreground, 14)
            })
          )(
            ...ALLOCATIONS.map((b, i) =>
              $node(
                style({ height: '100%', flexShrink: '0', backgroundColor: colorShade(PUPPET_COLOR, 100 - i * 28) }),
                styleBehavior(map(l => ({ width: `${((100 * b.stake * b.growth * (1 - drained(l, i))) / EXITED_TOTAL).toFixed(2)}%` }), local))
              )()
            )
          ),
          $visRow(
            $column(style({ gap: '2px' }))(
              $node(style({ fontSize: text.sm, color: PUPPET_COLOR }))($text('Allocated')),
              $figure(map(exitingAt, local), usd, text.base)
            ),
            $column(style({ gap: '2px', alignItems: 'flex-end' }))(
              $visLabel($text('In your account')),
              $figure(map(l => EXITED_TOTAL - exitingAt(l), local), usd, text.base)
            )
          )
        )
    }
  }
]

const $storyCell = (accent: string, kicker: string, voice: IStoryVoice, mirror: boolean, local: IStream<number>): I$Node =>
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
    $node(style({ width: '100%', display: 'flex', justifyContent: mirror ? 'flex-end' : 'flex-start', paddingTop: '10px' }))(
      voice.visual(local)
    ),
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
  const yRef = { v: -1 }
  const reached = (p: number): boolean => p >= (geom.len > 1 && yRef.v >= 0 ? Math.min(1, (TRAIL_REVEAL_END * yRef.v) / geom.len) : t)
  register(() => {
    const r = dotEl.getBoundingClientRect()
    if (r.height === 0) return
    const y = r.top + r.height / 2 - probe.getBoundingClientRect().top
    const x = trailWaveX(spine, side, y)
    dotEl.style.left = `${(x - 5.5).toFixed(1)}px`
    if (side === 'left') tetherEl.style.width = `${(x - 7).toFixed(1)}px`
    else tetherEl.style.left = `${(x + 7).toFixed(1)}px`
    yRef.v = y
  })
  return [
    $wrapNativeElement(tetherEl)(
      style({
        position: 'absolute',
        top: '7px',
        height: '1px',
        transition: 'background-color 500ms',
        backgroundColor: colorShade(palette.foreground, 18),
        ...(side === 'left' ? { left: '5px', width: `${x0 - 7}px` } : { left: `${x0 + 7}px`, right: '5px' })
      }),
      styleBehavior(
        map(
          p => ({ backgroundColor: reached(p) ? colorShade(color, 75) : colorShade(palette.foreground, 18) }),
          progress
        )
      )
    )(),
    $wrapNativeElement(dotEl)(
      style({
        position: 'absolute',
        top: '2px',
        left: `${x0 - 5.5}px`,
        width: '11px',
        height: '11px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '2px solid',
        backgroundColor: palette.background,
        borderColor: colorShade(palette.foreground, 35),
        transition: 'background-color 400ms, border-color 400ms, box-shadow 400ms'
      }),
      styleBehavior(
        map(
          p =>
            reached(p)
              ? { backgroundColor: color, borderColor: color, boxShadow: `0 0 0 4px ${colorShade(color, 22)}, 0 0 14px ${colorShade(color, 70)}` }
              : { backgroundColor: palette.background, borderColor: colorShade(palette.foreground, 35), boxShadow: 'none' },
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
  lit.svg.style.strokeDashoffset = '100000'
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
    if (h > 0 && Math.abs(h - geom.h) > 1) requestAnimationFrame(() => rebuild(h))
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
        opacity: '0',
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
        opacity: '0',
        background: `linear-gradient(135deg, ${PUPPET_COLOR}, ${MASTER_COLOR})`
      }),
      styleBehavior(map(p => ({ opacity: Math.min(1, Math.max(0, (p / TRAIL_REVEAL_END - 0.9) / 0.1)).toFixed(3) }), progress))
    )($icon({ $content: $puppetLogo, width: '16px', viewBox: '0 0 32 32', fill: 'white' }))
  )
}

const $storyRow = (
  progress: IStream<number>,
  beat: IStoryBeat,
  probe: HTMLElement,
  register: (fn: () => void) => void,
  geom: ITrailGeom
): I$Node => {
  const anchor = document.createElement('div')
  const top = { v: 0 }
  register(() => {
    top.v = anchor.getBoundingClientRect().top - probe.getBoundingClientRect().top
  })
  const local = map(p => Math.min(1, Math.max(0, (p * geom.h - top.v) / STORY_SPAN)), progress)
  return $row(style({ width: '100%', alignItems: 'flex-start' }))(
    $node(style({ flex: '1', minWidth: '0', display: 'flex' }))(
      $storyCell(MASTER_COLOR, 'You trade', beat.master, true, local)
    ),
    $node(style({ position: 'relative', flex: `0 0 ${STORY_SPINE.w}px`, alignSelf: 'stretch' }))(
      $wrapNativeElement(anchor)(style({ position: 'absolute', top: '0', left: '0', width: '0', height: '0' }))(),
      ...$trailMark(progress, beat.t, MASTER_COLOR, STORY_SPINE, 'left', probe, register, geom),
      ...$trailMark(progress, beat.t, PUPPET_COLOR, STORY_SPINE, 'right', probe, register, geom)
    ),
    $node(style({ flex: '1', minWidth: '0', display: 'flex' }))(
      $storyCell(PUPPET_COLOR, 'You invest', beat.puppet, false, local)
    )
  )
}

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
  const yRef = { v: -1 }
  const reached = (p: number): boolean => p >= (geom.len > 1 && yRef.v >= 0 ? Math.min(1, (TRAIL_REVEAL_END * yRef.v) / geom.len) : t)
  const top = { v: 0 }
  register(() => {
    const r = dotEl.getBoundingClientRect()
    if (r.height === 0) return
    const y = r.top + r.height / 2 - probe.getBoundingClientRect().top
    top.v = r.top - probe.getBoundingClientRect().top
    const x = trailWaveX(spine, side, y)
    dotEl.style.left = `${(x - 52 - 5.5).toFixed(1)}px`
    tetherEl.style.left = `${(x - 52 + 5).toFixed(1)}px`
    tetherEl.style.width = `${(52 - x - 15).toFixed(1)}px`
    yRef.v = y
  })
  return $node(style({ position: 'relative', width: '100%' }))(
    $wrapNativeElement(dotEl)(
      style({
        position: 'absolute',
        top: '3px',
        left: `${x0 - 52 - 5.5}px`,
        width: '11px',
        height: '11px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '2px solid',
        backgroundColor: palette.background,
        borderColor: colorShade(palette.foreground, 35),
        transition: 'background-color 400ms, border-color 400ms, box-shadow 400ms'
      }),
      styleBehavior(
        map(
          p =>
            reached(p)
              ? { backgroundColor: accent, borderColor: accent, boxShadow: `0 0 0 4px ${colorShade(accent, 22)}, 0 0 14px ${colorShade(accent, 70)}` }
              : { backgroundColor: palette.background, borderColor: colorShade(palette.foreground, 35), boxShadow: 'none' },
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
        transition: 'background-color 500ms',
        backgroundColor: colorShade(palette.foreground, 18)
      }),
      styleBehavior(
        map(
          p => ({ backgroundColor: reached(p) ? colorShade(accent, 45) : colorShade(palette.foreground, 18) }),
          progress
        )
      )
    )(),
    $storyCell(
      accent,
      kicker,
      voice,
      false,
      map(p => Math.min(1, Math.max(0, (p * geom.h - top.v) / STORY_SPAN)), progress)
    )
  )
}

const $storyConverge = (): I$Node =>
  $column(spacing.default, style({ alignItems: 'center', textAlign: 'center', width: '100%' }))(
    $heading2($text('One wallet between them.')),
    $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.foreground, maxWidth: '520px' }))(
      $text('The master operates it, each puppet\'s mandate caps what it puts in, and the chain adds up a value the attestor checked.')
    ),
    $row(spacing.small, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $chip('Allocations capped by the master\'s shares'),
      $chip('One share price, for everyone'),
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
  const progress: IStream<number> = state()(motion(SPRING, scrollTarget))
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
        'You invest',
        'right',
        beat.puppet,
        probe,
        register,
        geom
      )
    ])

  const earned = map(p => 1 - (1 - Math.min(1, Math.max(0, (p - 0.04) / 0.86))) ** 2, progress)
  const $ticker = $row(
    style({
      alignItems: 'center',
      gap: '14px',
      padding: '12px 24px 12px 12px',
      borderRadius: '40px',
      backgroundColor: colorShade(palette.background, 88),
      border: `1px solid ${colorShade(palette.foreground, 16)}`,
      boxShadow: '0 10px 30px rgb(0 0 0 / 35%), 0 2px 10px rgb(0 0 0 / 25%)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap'
    })
  )
  const $tickerRole = $column(style({ gap: '4px', lineHeight: '1.2', minWidth: '0', overflow: 'hidden' }))
  const $tickerName = $node(style({ fontSize: text.base, fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis' }))
  const $tickerSub = $node(style({ fontSize: text.xs, color: palette.foreground }))
  const $tickerValue = $column(style({ alignItems: 'flex-end', gap: '4px', lineHeight: '1.2', marginLeft: 'auto', textAlign: 'right', flexShrink: '0' }))
  const $tickerBar = ($masterValue: I$Node, $puppetValue: I$Node): I$Node => {
    const avatarSize = isDesktopScreen ? 52 : 32
    const $roleMark = $row(
      style({
        position: 'absolute',
        right: '-4px',
        bottom: '-4px',
        width: isDesktopScreen ? '26px' : '22px',
        height: isDesktopScreen ? '26px' : '22px',
        borderRadius: '50%',
        placeContent: 'center',
        alignItems: 'center',
        backgroundColor: palette.background
      })
    )
    const $masterIdentity = $node(style({ position: 'relative', display: 'flex', flexShrink: '0' }))(
      $fundAvatar(EXAMPLE_FUND, avatarSize),
      $roleMark(style({ border: `1px solid ${colorShade(MASTER_COLOR, 50)}` }))(
        $icon({ $content: $puppeteer, width: isDesktopScreen ? '17px' : '14px', viewBox: '0 0 32 32', fill: MASTER_COLOR })
      )
    )
    const $puppetIdentity = $node(style({ position: 'relative', display: 'flex', flexShrink: '0' }))(
      $jazzicon(EXAMPLE_PUPPET_ADDRESS, avatarSize),
      $roleMark(style({ border: `1px solid ${colorShade(PUPPET_COLOR, 50)}` }))(
        $icon({ $content: $puppet, width: isDesktopScreen ? '17px' : '14px', viewBox: '0 0 32 32', fill: PUPPET_COLOR })
      )
    )
    return $column(style({ width: '100%', alignItems: 'center', pointerEvents: 'none' }))(
      isDesktopScreen
        ? $row(style({ width: '100%', alignItems: 'center' }))(
            $row(style({ flex: '1', minWidth: '0', justifyContent: 'flex-end' }))(
              $ticker(style({ width: '100%', maxWidth: '430px' }))(
                $masterIdentity,
                $tickerRole($tickerName(style({ color: MASTER_COLOR }))($text(EXAMPLE_FUND_NAME)), $tickerSub($text('My Fund'))),
                $masterValue
              )
            ),
            $node(style({ flex: `0 0 ${STORY_SPINE.w}px` }))(),
            $row(style({ flex: '1', minWidth: '0', justifyContent: 'flex-start' }))(
              $ticker(style({ width: '100%', maxWidth: '430px' }))(
                $puppetIdentity,
                $tickerRole($tickerName(style({ color: PUPPET_COLOR }))($text(readableAddress(EXAMPLE_PUPPET_ADDRESS))), $tickerSub($text('My Account'))),
                $puppetValue
              )
            )
          )
        : $ticker(style({ width: '100%', gap: '10px', padding: '8px 14px 8px 8px' }))(
            $row(style({ flex: '1', minWidth: '0', alignItems: 'center', gap: '8px' }))($masterIdentity, $masterValue),
            $node(style({ width: '1px', alignSelf: 'stretch', backgroundColor: colorShade(palette.foreground, 16) }))(),
            $row(style({ flex: '1', minWidth: '0', alignItems: 'center', gap: '8px' }))($puppetIdentity, $puppetValue)
          )
    )
  }

  return $section(
    $sectionHeading('How it works', 'One fund, two perspectives.'),
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
        $tickerBar(
          $tickerValue($figure(just(EXAMPLE_STAKE), usd, isDesktopScreen ? text.xl : text.lg), $tickerSub($text('Initial Deposit'))),
          $tickerValue($figure(just(EXAMPLE_DEPOSIT), usd, isDesktopScreen ? text.xl : text.lg), $tickerSub($text('Initial Deposit')))
        ),
        ...(isDesktopScreen ? STORY_BEATS.map(b => $storyRow(progress, b, probe, register, geom)) : mobileBlocks()),
        $tickerBar(
          $tickerValue(
            $node(style({ minWidth: `${usd(EXAMPLE_STAKE + TRADER_EARNED).length}ch` }))(
              $figure(map(g => EXAMPLE_STAKE + TRADER_EARNED * g, earned), usd, isDesktopScreen ? text.xl : text.lg)
            ),
            $tickerSub(style({ color: palette.positive, minWidth: `${usd(TRADER_EARNED - STAKE_GAIN).length + 6}ch` }))(
              $text(map(g => `${usd((TRADER_EARNED - STAKE_GAIN) * g)} fees`, earned))
            )
          ),
          $tickerValue(
            $node(style({ minWidth: `${usd(EXAMPLE_DEPOSIT + PUPPET_NET).length}ch` }))(
              $figure(map(g => EXAMPLE_DEPOSIT + PUPPET_NET * g, earned), usd, isDesktopScreen ? text.xl : text.lg)
            ),
            $tickerSub(style({ color: palette.positive, minWidth: '10ch' }))(
              $text(map(g => `${percent((PUPPET_NET / EXAMPLE_DEPOSIT) * g)} ROI`, earned))
            )
          )
        )
      )
    ),
    $storyConverge(),
    $launchCta()
  )
}

const AGENT_T0 = Date.now() - 5 * 60_000
const AGENT: IAgentIdentity = {
  secret: randomHex(32),
  port: 43_000 + Math.floor(Math.random() * 7_000),
  name: 'AGENT7',
  cells: randomCells(),
  fund: randomAddress(),
  proven: true
}
const AGENT_STRATEGY = 'Trade ETH on GMX at 3x leverage or less, and close any position that is down 5%.'
const AGENT_PEER: IAgentIdentity = { ...AGENT, secret: randomHex(32), port: AGENT.port + 1, name: 'AGENT3', cells: randomCells() }
const AGENT_LINKED: IAgentStatus = { kind: 'linked', expiry: BigInt(Math.floor(AGENT_T0 / 1000) + 7 * 86_400) }
const AGENT_REQUESTS: { identity: IAgentIdentity; time: number; frame: { kind: string } & Record<string, unknown>; reply: IAgentReply }[] = [
  {
    identity: AGENT,
    time: AGENT_T0 + 60_000,
    frame: { kind: 'operate', chainId: 42161, calls: [{ to: GMX_ROUTER, data: '0xac9650d8' }] },
    reply: { type: 'done', id: AGENT_T0 + 60_000, chainId: 42161, block: '391204557', txHash: `0x${randomHex(32)}`, fees: [{ chainId: 42161, token: CHAIN_TOKEN_MAP[42161].USDC, amount: '41250' }] }
  },
  {
    identity: AGENT,
    time: AGENT_T0 + 110_000,
    frame: { kind: 'sign', typedData: { domain: { name: 'Polymarket CTF Exchange', version: '1', chainId: 137 }, primaryType: 'Order' } },
    reply: { type: 'signed', id: AGENT_T0 + 110_000, signature: `0x${randomHex(65)}` }
  },
  {
    identity: AGENT,
    time: AGENT_T0 + 170_000,
    frame: { kind: 'operate', chainId: 42161, calls: [{ to: GMX_ROUTER, data: '0xac9650d8' }] },
    reply: { type: 'failed', id: AGENT_T0 + 170_000, code: 'SENDTOKENS_BAD_RECEIVER', detail: `SENDTOKENS_BAD_RECEIVER: sendTokens receiver ${randomAddress()} must be the GMX OrderVault` }
  },
  {
    identity: AGENT_PEER,
    time: AGENT_T0 + 230_000,
    frame: { kind: 'venueWithdraw', venue: 'hyperliquid', amount: '250000000' },
    reply: { type: 'submitted', id: AGENT_T0 + 230_000 }
  }
]
const ramp = (l: number, from: number, to: number): number => Math.min(1, Math.max(0, (l - from) / (to - from)))
const appear = (local: IStream<number>, at: number) =>
  styleBehavior(
    map(l => {
      const k = ramp(l, at, at + 0.06)
      return { opacity: k.toFixed(3), transform: `translateY(${((1 - k) * 6).toFixed(1)}px)` }
    }, local)
  )

const $agentRow = (identity: IAgentIdentity, current: IAgentStatus | undefined): I$Node => {
  const action = agentActionOf(current)
  return $sessionRow(
    $fundAvatar(identity.cells, 24),
    identity.name,
    $agentStatus(current),
    action === null
      ? $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Remove') })({})
      : $DropMenu({
          label: action.label,
          optionList: [
            { label: action.label, description: action.title },
            { label: 'Remove', description: 'Deletes it from this browser, so it can no longer link' }
          ]
        })({})
  )
}

const $createScene = (local: IStream<number>): I$Node =>
  component(([pickTemplate, pickTemplateTether]: IBehavior<INode, number>, [pickFile, pickFileTether]: IBehavior<INode, string>) => {
    const chosen = op(
      merge(
        just(
          op(
            local,
            map(l => (l < 0.42 ? 0 : l < 0.66 ? 1 : 2))
          )
        ),
        map(at => just(at), pickTemplate)
      ),
      switchLatest,
      skipRepeats,
      state()
    )
    const typed = op(
      local,
      map(l => Math.round(AGENT_STRATEGY.length * ramp(l, 0.1, 0.34))),
      skipRepeats,
      map(n => AGENT_STRATEGY.slice(0, n))
    )
    const typing = op(local, map(l => l > 0.1 && l < 0.36), skipRepeats)
    const saved = op(local, map(l => l >= 0.36), skipRepeats)
    const $fileIcon = (path: string, size: string): I$Node =>
      path.endsWith('.ts')
        ? $icon({ $content: $terminal, viewBox: '0 0 24 24', size, svgOps: style({ color: palette.positive }) })
        : $icon({ $content: $document, viewBox: '0 0 24 24', size, svgOps: style({ color: palette.primary }) })
    const $code = (content: string): I$Node =>
      $node(style({ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: text.xs, lineHeight: '1.6', color: palette.foreground }))($text(content))
    const $preview = $node(style({ height: '260px', overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 65%, transparent)' }))
    const overlap = isDesktopScreen ? 56 : 36
    return [
      $column(style({ width: '100%', maxWidth: '680px' }))(
        $card(spacing.big, style({ width: '100%', boxSizing: 'border-box' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Templates')),
            $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))($text('Pick a template, write your instructions into it, and paste the link line into the .env beside it.'))
          ),
          $column(spacing.default)(
            $row(spacing.tiny, style({ flexWrap: 'wrap' }))(
              ...AGENT_TEMPLATES.map((template, i) =>
                $node(
                  attr({ role: 'button', tabindex: '0', title: template.detail }),
                  style({ cursor: 'pointer', borderRadius: '100px', border: '1px solid', padding: '4px 12px', fontSize: text.sm, whiteSpace: 'nowrap', transition: 'border-color 300ms, color 300ms' }),
                  styleBehavior(map(at => (at === i ? { borderColor: palette.primary, color: palette.message } : { borderColor: colorShade(palette.foreground, 25), color: palette.foreground }), chosen)),
                  attrBehavior(map(at => ({ 'aria-pressed': at === i ? 'true' : 'false' }), chosen)),
                  keyActivate(),
                  pickTemplateTether(
                    nodeEvent('click'),
                    map(() => i)
                  )
                )($text(template.name))
              )
            ),
            switchLatest(
              map(at => {
                const files = AGENT_TEMPLATES[at].files({ instructions: '\u0000' })
                const [main] = files
                const shown = state(main.path, pickFile)
                return $column(spacing.small, style({ animation: 'promptIn 350ms ease-out' }))(
                  $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                    $node(style({ flex: '1 1 240px', minWidth: '0' }))(
                      files.length === 1
                        ? $labeledDivider($row(spacing.tiny, style({ alignItems: 'center', border: '1px solid transparent', padding: '3px 0', fontFamily: 'monospace', fontSize: text.xs, color: palette.message }))($fileIcon(main.path, '14px'), $text(main.path)))
                        : $row(spacing.tiny, style({ overflowX: 'auto', scrollbarWidth: 'none' }))(
                            ...files.map(file =>
                              $row(
                                spacing.tiny,
                                attr({ role: 'button', tabindex: '0', title: file.path }),
                                style({
                                  cursor: 'pointer',
                                  alignItems: 'center',
                                  borderRadius: '100px',
                                  border: '1px solid',
                                  padding: '3px 10px',
                                  fontSize: text.xs,
                                  fontFamily: 'monospace',
                                  whiteSpace: 'nowrap'
                                }),
                                styleBehavior(
                                  map(path => (path === file.path ? { borderColor: palette.primary, color: palette.message } : { borderColor: colorShade(palette.foreground, 25), color: palette.foreground }), shown)
                                ),
                                attrBehavior(map(path => ({ 'aria-pressed': path === file.path ? 'true' : 'false' }), shown)),
                                keyActivate(),
                                pickFileTether(
                                  nodeEvent('click'),
                                  map(() => file.path)
                                )
                              )($fileIcon(file.path, '13px'), $text(file.path.slice(file.path.lastIndexOf('/') + 1)))
                            )
                          )
                    ),
                    $row(spacing.tiny, attr({ inert: '' }), style({ alignItems: 'center', marginLeft: 'auto' }))(
                      ...(files.length === 1
                        ? [
                            $ButtonSecondary({
                              $container: $defaultMiniButtonSecondary,
                              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $copy, viewBox: '0 0 24 24', width: '14px' }), $text('Copy'))
                            })({})
                          ]
                        : []),
                      $ButtonPrimary({
                        $container: $defaultMiniButtonPrimary,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $download, viewBox: '0 0 24 24', width: '14px' }), $text('Download'))
                      })({})
                    )
                  ),
                  switchLatest(
                    map(path => {
                      const file = files.find(entry => entry.path === path)
                      if (file === undefined) throw new Error(`${path} is not a file of the ${AGENT_TEMPLATES[at].name} template`)
                      if (file !== main) return $preview($code(file.content))
                      const [before, after] = main.content.split('\u0000')
                      return $preview(
                        ...(before.trim() === '' ? [] : [$code(before.replace(/\n+$/, ''))]),
                        $node(
                          style({
                            margin: '10px 0',
                            minHeight: '3lh',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid',
                            backgroundColor: palette.background,
                            fontFamily: 'monospace',
                            fontSize: text.xs,
                            lineHeight: '1.6',
                            whiteSpace: 'pre-wrap'
                          }),
                          styleBehavior(map(on => ({ borderColor: on ? palette.primary : colorShade(palette.foreground, 25) }), typing)),
                          styleBehavior(map(line => ({ color: line === '' ? palette.foreground : palette.message }), typed))
                        )($text(map(line => (line === '' ? 'Paste or write your agent’s instructions' : line), typed))),
                        $code(after.replace(/^\n+/, ''))
                      )
                    }, shown)
                  )
                )
              }, chosen)
            )
          ),
          $node(style({ height: `${overlap}px`, flexShrink: '0' }))()
        ),
        $defaultPopoverContentContainer(
          attr({ inert: '' }),
          style({
            position: 'relative',
            zIndex: '1',
            alignSelf: 'flex-end',
            width: `calc(100% - ${isDesktopScreen ? 40 : 12}px)`,
            marginTop: `-${overlap}px`,
            boxSizing: 'border-box',
            boxShadow: `0 18px 40px ${palette.shadow}, 0 0 10px 0 ${palette.shadow}`
          })
        )(
          $column(spacing.default)(
            $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ flex: '1', minWidth: '0' }))($labeledDivider('Sessions')),
              $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Done') })({})
            ),
            $column(spacing.small)(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $fundAvatar(AGENT.cells, 24),
                $node(style({ flex: '0 1 280px', minWidth: '0' }))(
                  $FieldLabeled({
                    label: null,
                    placeholder: AGENT.name,
                    value: just(AGENT.name),
                    $container: $defaultTextFieldContainer(style({ alignItems: 'stretch' })),
                    $input: $defaultInputContainer(style({ flex: '1', minWidth: '0', paddingRight: '96px' })),
                    $$field: $field =>
                      $node(style({ position: 'relative', display: 'flex', width: '100%' }))(
                        $field,
                        $node(style({ position: 'absolute', right: '8px', top: '0', bottom: '0', display: 'flex', alignItems: 'center' }))($agentStatus(undefined))
                      )
                  })({})
                ),
                switchLatest(map(on => $ButtonPrimary({ $container: $defaultMiniButtonPrimary, $content: $text(on ? 'Saved' : 'Save'), disabled: just(on) })({}), saved))
              ),
              $row(
                spacing.small,
                style({ alignItems: 'center', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${colorShade(palette.foreground, 25)}`, backgroundColor: palette.background })
              )(
                $node(style({ flex: '1', minWidth: '0', fontFamily: 'monospace', fontSize: text.xs, lineHeight: '1.5', color: palette.message, wordBreak: 'break-all' }))(
                  $text(agentLinkLineOf({ port: AGENT.port, secret: AGENT.secret, account: AGENT.fund }))
                ),
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $copy, viewBox: '0 0 24 24', width: '14px' }), $text('Copy')),
                  disabled: map(on => !on, saved)
                })({})
              ),
              $node(style({ fontSize: text.xs, lineHeight: '1.5', color: palette.foreground }))($text('Save it, then paste the line into the .env beside your agent and start it. Templates are in the Quickstart.'))
            )
          )
        )
      ),
      {}
    ]
  })({})

const $runScene = (local: IStream<number>): I$Node => {
  const linked = op(local, map(l => l >= 0.28), skipRepeats)
  const command = '$ bun agent.ts'
  const requests = AGENT_REQUESTS.filter(request => request.identity === AGENT).map((request, i) => ({ ...request, at: 0.4 + 0.15 * i }))
  const lines = [
    { text: `waiting for the Puppet app on ws://127.0.0.1:${AGENT.port}`, at: 0.1 },
    { text: JSON.stringify({ at: new Date(AGENT_T0).toISOString(), linked: AGENT.fund }), at: 0.28 },
    ...requests.flatMap(request => [
      { text: JSON.stringify({ at: new Date(request.time).toISOString(), id: request.reply.id, request: request.frame }), at: request.at },
      { text: JSON.stringify({ at: new Date(request.time + 2_000).toISOString(), id: request.reply.id, reply: request.reply }), at: request.at + 0.08 }
    ])
  ]
  const overlap = isDesktopScreen ? 56 : 36
  return $column(attr({ inert: '' }), style({ width: '100%', maxWidth: '680px' }))(
    $mockWindow(
      $column(
        style({
          gap: '4px',
          padding: `12px 16px ${overlap + 16}px`,
          fontFamily: 'monospace',
          fontSize: text.xs,
          lineHeight: '1.6',
          backgroundColor: palette.middleground
        })
      )(
        $node(style({ color: palette.message, whiteSpace: 'pre' }))(
          $text(
            op(
              local,
              map(l => Math.round(command.length * ramp(l, 0, 0.1))),
              skipRepeats,
              map(n => command.slice(0, n))
            )
          )
        ),
        ...lines.map(line => $node(style({ color: palette.foreground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }), appear(local, line.at))($text(line.text)))
      )
    ),
    $defaultPopoverContentContainer(
      style({
        position: 'relative',
        zIndex: '1',
        alignSelf: 'flex-end',
        width: `calc(100% - ${isDesktopScreen ? 40 : 12}px)`,
        marginTop: `-${overlap}px`,
        boxSizing: 'border-box',
        boxShadow: `0 18px 40px ${palette.shadow}, 0 0 10px 0 ${palette.shadow}`
      })
    )(
      $column(spacing.default)(
        $labeledDivider('Sessions'),
        switchLatest(map(on => $agentRow(AGENT, on ? AGENT_LINKED : undefined), linked)),
        $column(spacing.small)(
          $labeledDivider($node(style({ fontSize: text.sm }))($text('Activity'))),
          $column(spacing.tiny)(
            ...[...requests]
              .reverse()
              .map(request =>
                $node(appear(local, request.at + 0.08))($agentRequestRow({ secret: AGENT.secret, at: request.time, kind: request.frame.kind, reply: request.reply }, AGENT))
              )
          )
        )
      )
    )
  )
}

const $overseeScene = (local: IStream<number>): I$Node => {
  const paused = op(local, map(l => l >= 0.55 && l < 0.85), skipRepeats)
  return $defaultPopoverContentContainer(attr({ inert: '' }), style({ width: '100%', maxWidth: '400px', boxSizing: 'border-box' }))(
    $column(spacing.default)(
      $row(spacing.small, style({ alignItems: 'center' }))(
        $icon({ $content: $browser, viewBox: '0 0 24 24', size: '24px', svgOps: style({ color: palette.foreground, flexShrink: '0' }) }),
        $column(style({ flex: '1', gap: '2px', minWidth: '0' }))(
          $node(style({ fontSize: text.sm, color: palette.message }))($text('This browser')),
          $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
            $node($text('ends in 6d 23h')),
            $infoTooltip('Your wallet granted this session to this browser; your agents act through it.', palette.foreground)
          )
        ),
        $DropMenu({ label: 'Sign out', optionList: [{ label: 'Sign out', description: "Forgets this browser's key and disconnects your wallet; no gas" }] })({})
      ),
      $row(spacing.small, style({ alignItems: 'center' }))(
        $node(style({ flex: '1', minWidth: '0' }))(
          $labeledDivider($row(spacing.tiny, style({ alignItems: 'center' }))($node($text('Sessions')), $infoTooltip("Agents act for this fund through this browser's session.", palette.foreground)))
        ),
        $ButtonSecondary({
          $container: $defaultMiniButtonSecondary,
          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $robot, width: '14px' }), $text('New agent'))
        })({})
      ),
      $column(spacing.small)(
        switchLatest(map(off => $agentRow(AGENT, off ? { kind: 'paused' } : AGENT_LINKED), paused)),
        $agentRow(AGENT_PEER, AGENT_LINKED)
      ),
      $column(spacing.small)(
        $labeledDivider($node(style({ fontSize: text.sm }))($text('Activity'))),
        $column(spacing.tiny)(
          ...[...AGENT_REQUESTS]
            .reverse()
            .map((request, i) =>
              $node(appear(local, 0.1 + 0.06 * i))(
                $agentRequestRow({ secret: request.identity.secret, at: request.time, kind: request.frame.kind, reply: request.reply }, request.identity)
              )
            )
        )
      )
    )
  )
}

type IAgentStep = { title: string; body: string; scene: (local: IStream<number>) => I$Node }

const AGENT_STEPS: IAgentStep[] = [
  {
    title: 'Create an agent',
    body: "In your wallet, open Sessions, press New agent and save it, then copy its link line into your agent's .env. Start from a template, from one AGENTS.md in your own words to a full Bun agent that runs its strategy every hour and journals each step for you and your coding agent to improve. Tap a template to look inside.",
    scene: $createScene
  },
  {
    title: 'Run it, every request screened',
    body: "Start it on your computer, and your wallet links to it while it is open; the first time, allow your browser's prompt. Each request is screened and simulated like your own before the app signs it, so money moves only to screened venues, back to your fund or to exits.",
    scene: $runScene
  },
  {
    title: 'Yours to oversee',
    body: "Your agents act through this browser's session. Each one lists under Sessions, and every request it makes under Activity. Pause, resume or remove any of them any time, and keep your wallet open while they run.",
    scene: $overseeScene
  }
]

const $agentStepBlock = (agentStep: IAgentStep, i: number, tip: IStream<number | null>): I$Node => {
  const block = document.createElement('div')
  const local: IStream<number> = state()(
    motion(
      SPRING,
      start(
        0,
        op(
          fromEventTarget(window, 'scroll'),
          map(() => ramp(window.innerHeight * 0.85 - block.getBoundingClientRect().top, 0, window.innerHeight * 0.7))
        )
      )
    )
  )
  const markSize = isDesktopScreen ? 40 : 28
  return $wrapNativeElement(block)(style({ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }))(
    $row(
      style({
        position: 'absolute',
        top: '0',
        left: `-${isDesktopScreen ? 56 : 40}px`,
        width: `${markSize}px`,
        height: `${markSize}px`,
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '2px solid',
        placeContent: 'center',
        alignItems: 'center',
        fontFamily: 'var(--font-numbers)',
        fontWeight: '700',
        fontSize: isDesktopScreen ? text.base : text.sm,
        backgroundColor: palette.background,
        transition: 'border-color 300ms, color 300ms, box-shadow 300ms'
      }),
      styleBehavior(
        op(
          tip,
          map(y => y !== null && y >= block.offsetTop),
          skipRepeats,
          map(touched =>
            touched
              ? { borderColor: palette.foreground, color: palette.message, boxShadow: `0 0 0 4px ${colorShade(palette.foreground, 18)}, 0 0 14px ${colorShade(palette.foreground, 50)}` }
              : { borderColor: colorShade(palette.foreground, 30), color: palette.foreground, boxShadow: 'none' }
          )
        )
      )
    )($text(String(i + 1))),
    $column(style({ gap: '6px', minHeight: `${markSize}px`, justifyContent: 'center' }))(
      $custom('h3')(
        style({ fontSize: isDesktopScreen ? text.xxl : text.xl, fontWeight: '800', letterSpacing: '0.01em', lineHeight: '1.25', margin: '0', color: palette.message })
      )($text(agentStep.title)),
      $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.foreground, maxWidth: '640px' }))($text(agentStep.body))
    ),
    $node(style({ display: 'flex', width: '100%' }))(agentStep.scene(local))
  )
}

const $agentTour = (): I$Node => {
  const container = document.createElement('div')
  const filled: IStream<number> = state()(
    motion(
      SPRING,
      start(
        0,
        op(
          fromEventTarget(window, 'scroll'),
          map(() => {
            const r = container.getBoundingClientRect()
            return ramp(window.innerHeight * 0.6 - r.top, 0, r.height)
          })
        )
      )
    )
  )
  const railTop = isDesktopScreen ? 20 : 14
  return $wrapNativeElement(container)(style({ position: 'relative', width: '100%', paddingLeft: `${isDesktopScreen ? 56 : 40}px`, boxSizing: 'border-box' }))(
    $node(
      style({
        position: 'absolute',
        left: `${isDesktopScreen ? 19 : 13}px`,
        top: `${railTop}px`,
        bottom: '0',
        width: '2px',
        borderRadius: '2px',
        backgroundColor: colorShade(palette.foreground, 14)
      })
    )(
      $node(
        style({ width: '100%', borderRadius: '2px', backgroundColor: palette.foreground, boxShadow: `0 0 8px ${palette.foreground}` }),
        styleBehavior(map(p => ({ height: `${(100 * p).toFixed(2)}%` }), filled))
      )()
    ),
    $column(style({ width: '100%', gap: isDesktopScreen ? '72px' : '48px' }))(
      ...AGENT_STEPS.map((agentStep, i) =>
        $agentStepBlock(
          agentStep,
          i,
          map(p => (p > 0 ? railTop + p * (container.offsetHeight - railTop) : null), filled)
        )
      )
    )
  )
}

const $agentSection = (): I$Node =>
  $section(
    $sectionHeading('Agents', 'Bring your own agent.'),
    $node(style({ alignSelf: 'center', maxWidth: '620px', textAlign: 'center', fontSize: text.lg, lineHeight: '1.6', color: palette.foreground }))(
      $text("It runs on your computer and holds none of your fund's keys. The app screens and simulates every request like your own.")
    ),
    $agentTour(),
    $row(spacing.small, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $chip('No fund keys'),
      $chip('Screened, one at a time'),
      $chip('As safe as where it runs'),
      $chip('Pause or remove any time')
    ),
    $row(spacing.default, style({ flexDirection: isDesktopScreen ? 'row' : 'column', alignItems: 'center', justifyContent: 'center' }))(
      $navPill('Create an agent', routeSchema.wallet, true),
      $navPill('Open the quickstart', routeSchema.quickstart.agent, false, palette.primary)
    )
  )

const $trustCard = ($glyph: I$Node, viewBox: string, title: string, desc: string): I$Node =>
  $panel($featureIcon($glyph, palette.foreground, viewBox), $heading3($text(title)), $panelBody($text(desc)))

const $trust = (): I$Node =>
  $section(
    $sectionHeading('Security', 'Nobody can move your funds anywhere but back to you, exceed your mandate, or trade outside screened venues.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $trustCard(
        $wallet,
        '0 0 32 32',
        'Your key, your wallet',
        'Every account signs with your key. Nothing moves without your signature, and the protocol never holds the whole key.'
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
        'Limits you set',
        'Each round takes at most your mandate\'s share of your balance, with a cooldown in between, and you can revoke it any time.'
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
      $text('Allocate to the funds you trust, or trade with allocations from others. Your keys, your rules, run by you or your agent.')
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
        style({ width: '100%', gap: isDesktopScreen ? '80px' : '56px', ...(isDesktopScreen ? {} : { padding: '0 16px', overflowX: 'clip' }) })
      )(
        $vortexBackground(),
        $hero(),
        $node(style({ position: 'relative', zIndex: '1', width: '100%' }))($storyline()),
        $agentSection(),
        $section(
          $sectionHeading('No seed phrase · You keep your keys · Bring your own agent', 'Start trading with allocations'),
          $row(style({ justifyContent: 'center' }))($navPill('Open the quickstart', routeSchema.quickstart, true))
        ),
        $reveal($trust()),
        $reveal($finalCta())
      ),
      {}
    ]
  }
  )
