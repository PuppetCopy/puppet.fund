import {
  $custom,
  $element,
  $node,
  $text,
  $wrapNativeElement,
  attr,
  component,
  effectProp,
  type I$Node,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Link, type Route } from 'aelea/ui-router'
import { type IStream, nowWith } from 'aelea/stream'
import { type IBehavior } from 'aelea/stream-extended'
import type { ISubaccountState } from '@puppet/sdk/state'
import {
  $bull,
  $gitbook,
  $github,
  $gmx,
  $icon,
  $moneyBag,
  $puppeteer,
  $smartContract,
  $twitter,
  $wallet,
  text
} from '@/ui-components'
import { $heading1, $heading2, $heading3 } from '../common/$text.js'
import { $card, $mockWindow } from '../common/elements/$common.js'
import { routeSchema } from '../app/routeSchema.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { $body } from './$onboarding.js'
import { $HelloPage } from './$HelloPage.js'
import type { IAllocateDraft, IClaimDraft, IRedeemDraft, ISellDraft, ISwapDraft } from '../components/portfolio/draft.js'
import { type IConnectedWallet } from '../wallet/index.js'

export interface I$Home {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<ISubaccountState | null>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
  draftSwapList: IStream<ISwapDraft[]>
}

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
      r: 46 + Math.random() * 70,
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
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(16, 18, 23, 0.07)'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    const cx = w / 2
    const cy = h / 2 - 300
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
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
      g.addColorStop(0, `rgba(${p.c}, ${0.04 * fade})`)
      g.addColorStop(1, `rgba(${p.c}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
      if (p.life <= 0 || dist < 16) Object.assign(p, spawn())
    }
    raf = requestAnimationFrame(frame)
  }
  if (!reduced) raf = requestAnimationFrame(frame)

  return $wrapNativeElement(sentinel)(style({ display: 'none' }))()
}

const $pillAnchor = (filled: boolean, borderColor?: string) =>
  $element('a')(
    style({
      display: 'inline-flex',
      cursor: 'pointer',
      alignItems: 'center',
      height: '48px',
      padding: '0 28px',
      borderRadius: '30px',
      backgroundColor: filled ? palette.primary : palette.background,
      color: palette.message,
      fontWeight: 'bold',
      fontSize: text.base,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      border: filled ? 'none' : `1px solid ${borderColor ?? colorShade(palette.foreground, 30)}`
    }),
    stylePseudo(
      ':hover',
      filled
        ? { filter: 'brightness(1.1)' }
        : borderColor
          ? { backgroundColor: colorShade(palette.primary, 12) }
          : { borderColor: colorShade(palette.foreground, 60) }
    )
  )

const $scrollPill = (label: string, targetId: string, filled: boolean, borderColor?: string): I$Node =>
  $pillAnchor(filled, borderColor)(
    effectProp(
      'onclick',
      nowWith(() => () => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    )
  )($text(label))

const $navSecondary = (label: string, route: Route): I$Node =>
  $Link({ route, $content: $text(label), $anchor: $pillAnchor(false) })({})

const $navAccent = (label: string, route: Route): I$Node =>
  $Link({ route, $content: $text(label), $anchor: $pillAnchor(false, palette.primary) })({})

const $extSecondary = (label: string, href: string): I$Node =>
  $pillAnchor(false)(attr({ href, target: '_blank', rel: 'noopener' }))($text(label))

const $featureIcon = ($glyph: I$Node, accent: string, viewBox = '0 0 32 32'): I$Node =>
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
    $heading1($text(title))
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

const $hero = (): I$Node =>
  $column(
    spacing.big,
    style({ alignItems: 'center', textAlign: 'center', width: '100%', paddingTop: isDesktopScreen ? '48px' : '24px' })
  )(
    $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.18em', color: palette.foreground }))(
      $text('Non-custodial copy-trading, live on Arbitrum')
    ),
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
    )($text('A shared wallet, operated by humans and agents.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '660px' }))(
      $text(
        'Fund top traders and share their gains, or run your own fund and trade/invest exactly as you do today, universally across any EVM chain, against any verifiable contract. You keep your keys. Every funding runs under rules you sign.'
      )
    ),
    $row(spacing.default, style({ flexWrap: 'wrap', justifyContent: 'center', paddingTop: '4px' }))(
      $scrollPill('Create Wallet', 'hello-create', true),
      $navAccent('Copy Top Traders', routeSchema.leaderboard)
    ),
    $node(style({ width: '100%', maxWidth: '680px', perspective: '1400px', paddingTop: '16px' }))(
      $node(style({ transform: isDesktopScreen ? 'rotateX(22deg)' : 'none', transformOrigin: 'center top' }))(
        $video('assets/video/leaderboard-pick-traders.mp4')
      )
    )
  )

const $sideCard = (
  accent: string,
  $glyph: I$Node,
  viewBox: string,
  kicker: string,
  title: string,
  lines: string[],
  $cta: I$Node
): I$Node =>
  $card(spacing.default, style({ flex: '1', minWidth: '280px', border: `1px solid ${colorShade(palette.foreground, 20)}` }))(
    $featureIcon($glyph, accent, viewBox),
    $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.08em', color: palette.foreground }))(
      $text(kicker)
    ),
    $heading2($text(title)),
    ...lines.map($body),
    $row(style({ paddingTop: '6px' }))($cta)
  )

const $twoSides = (): I$Node =>
  $section(
    $sectionHeading('Two ways in', 'Put capital to work, or put your trading to work.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $sideCard(
        palette.primary,
        $moneyBag,
        '0 0 32 32',
        'For backers',
        'Back a trader',
        [
          'Fund top traders and share their gains. Browse the leaderboard, pick by track record, and back them in a single deposit.',
          'You keep your keys, and you set the rules: how much, how fast, how often.'
        ],
        $navSecondary('Copy Top Traders', routeSchema.leaderboard)
      ),
      $sideCard(
        palette.positive,
        $puppeteer,
        '0 0 32 32',
        'For traders',
        'Run your own fund',
        [
          'Trade exactly as you do today, on any chain and any dapp. Backer capital rides your trades and pays you performance fees.',
          'Never hold or manage anyone else’s money. The protocol does the accounting.'
        ],
        $scrollPill('Get started', 'hello-create', false)
      )
    )
  )

const $stepCard = (n: number, accent: string, $glyph: I$Node, viewBox: string, title: string, desc: string): I$Node =>
  $card(spacing.default, style({ flex: '1', minWidth: '340px', border: `1px solid ${colorShade(palette.foreground, 18)}` }))(
    $row(spacing.default, style({ alignItems: 'center', justifyContent: 'space-between' }))(
      $featureIcon($glyph, accent, viewBox),
      $node(style({ fontSize: text.display, fontWeight: '900', lineHeight: '1', color: colorShade(palette.foreground, 22) }))(
        $text(String(n))
      )
    ),
    $heading3($text(title)),
    $node(style({ fontSize: text.sm, lineHeight: '1.6', color: palette.foreground }))($text(desc))
  )

const $howItWorks = (): I$Node =>
  $section(
    $sectionHeading('How it works', 'One deposit, bounded by your signature.'),
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $stepCard(
        1,
        palette.primary,
        $wallet,
        '0 0 32 32',
        'Fund',
        'Deposit once. Back any trader, or your own fund. Capital is pulled only when a trade actually fires.'
      ),
      $stepCard(
        2,
        palette.positive,
        $puppeteer,
        '0 0 32 32',
        'Operate',
        'A human trades by hand, or an agent runs headless, on GMX perpetuals and beyond.'
      ),
      $stepCard(
        3,
        palette.indeterminate,
        $smartContract,
        '0 0 24 24',
        'Co-sign',
        'Every action is checked against the rules you signed, or it never executes.'
      ),
      $stepCard(
        4,
        palette.positive,
        $bull,
        '0 0 32 32',
        'Earn',
        'Share the gains and redeem your shares whenever you want. Traders earn performance fees.'
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
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
      $trustCard($wallet, '0 0 32 32', 'You keep custody', 'Funds stay in smart accounts you control, never in the protocol.'),
      $trustCard(
        $smartContract,
        '0 0 24 24',
        'Rules you sign',
        'Every action is co-signed against the limits you set, or it never executes.'
      ),
      $trustCard(
        $gmx,
        '0 0 32 32',
        'A real venue, live',
        'GMX perpetuals on Arbitrum today. Any venue we can screen for trust comes next.'
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
    $heading1($text('Get backed to trade.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.6', color: palette.message, maxWidth: '560px' }))(
      $text('Fund the trader, human or machine, without ever giving up your money.')
    ),
    $row(spacing.default, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
      $scrollPill('Create Wallet', 'hello-create', true),
      $navAccent('Copy Top Traders', routeSchema.leaderboard),
      $extSecondary('Read the docs', DOCS_URL)
    ),
    $row(spacing.default, style({ alignItems: 'center', paddingTop: '12px' }))(
      $socialIcon($github, '0 0 32 32', GITHUB_REPO_URL),
      $socialIcon($twitter, '0 0 24 24', TWITTER_URL),
      $socialIcon($gitbook, '0 0 32 32', DOCS_URL)
    )
  )

export const $Home = ({ walletQuery, walletState, draftAllocateList, draftRedeemList, draftSwapList }: I$Home) =>
  component(
    (
      [changeAllocateDraft, changeAllocateDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<ISwapDraft>
    ) => {
      const $create = $column(attr({ id: 'hello-create' }), spacing.big, style({ width: '100%', scrollMarginTop: '90px' }))(
        $sectionHeading('Get started', 'Create your wallet and fund it.'),
        $HelloPage({ walletQuery, walletState, draftAllocateList, draftRedeemList, draftSwapList, embedded: true })({
          changeAllocateDraft: changeAllocateDraftTether(),
          changeRedeemDraft: changeRedeemDraftTether(),
          changeFulfillDraft: changeFulfillDraftTether(),
          changeSwapDraft: changeSwapDraftTether()
        })
      )
      return [
        $column(style({ width: '100%', gap: isDesktopScreen ? '80px' : '56px', padding: isDesktopScreen ? '0' : '0 16px' }))(
          $vortexBackground(),
          $hero(),
          $create,
          $twoSides(),
          $howItWorks(),
          $trust(),
          $finalCta()
        ),
        { changeAllocateDraft, changeRedeemDraft, changeFulfillDraft, changeSwapDraft }
      ]
    }
  )
