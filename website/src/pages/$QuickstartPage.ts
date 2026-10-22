import { constant, empty, type IStream, map, nowWith, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, effectProp, type I$Node, type INode, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { $icon, $infoTooltip, $puppeteer, $smartContract, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import tradeAdjustVideo from '../assets/video/trade-adjust.mp4'
import { $puppetLogo } from '../common/$icons.js'
import { $heading2 } from '../common/$text.js'
import { $venueIcon } from '../common/$operationView.js'
import { $card, $defaultMockWindow, $mockWindow } from '../common/elements/$common.js'
import { DOCS_URL } from '../const/links.js'
import { canInstallApp, promptInstallApp } from '../utils/pwaInstall.js'
import { $body, $bulletList, $callout, $linkButton, $stageHeader } from './$onboarding.js'
import { $video } from './common.js'

type IMasterMode = 'human' | 'agent'

export const $QuickstartPage = () =>
  component(
    (
      [selectMode, selectModeTether]: IBehavior<INode, IMasterMode>
    ) => {
      const modeState: IStream<IMasterMode> = state('human' as IMasterMode, selectMode)

      const $choiceCard = (mode: IMasterMode, $iconNode: I$Node, kicker: string, title: string, desc: string, accent: string): I$Node =>
        $column(
          spacing.small,
          style({
            flex: '1',
            minWidth: '240px',
            padding: '18px',
            borderRadius: '12px',
            backgroundColor: colorShade(palette.foreground, 6),
            cursor: 'pointer',
            border: `1px solid ${colorShade(palette.foreground, 18)}`,
            transition: 'border-color 120ms ease-out, transform 120ms ease-out'
          }),
          stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 45), transform: 'translateY(-2px)' }),
          styleBehavior(map(m => (m === mode ? { borderColor: accent } : {}), modeState)),
          selectModeTether(nodeEvent('click'), constant(mode))
        )(
          $row(spacing.default, style({ alignItems: 'center' }))(
            $icon({ $content: $iconNode, width: '40px', fill: accent, viewBox: '0 0 32 32' }),
            $column(spacing.tiny, style({ flex: '1', minWidth: '0' }))(
              $node(style({ fontSize: text.xs, color: palette.foreground, textTransform: 'uppercase', letterSpacing: '0.08em' }))($text(kicker)),
              $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title))
            ),
            $node(style({ color: accent, fontSize: text.lg, fontWeight: '600' }))($text('→'))
          ),
          $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text(desc))
        )

      const $chooser: I$Node = $row(spacing.default, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
        $choiceCard(
          'human',
          $puppeteer,
          'Trade by hand',
          'You place the trades',
          'Trade on GMX, Hyperliquid or Uniswap by linking your trading account over WalletConnect. Every valuation of your fund builds your public record.',
          palette.positive
        ),
        $choiceCard(
          'agent',
          $smartContract,
          'Run your agent',
          'Your agent places the trades',
          'Your own agent operates your fund through this app, with your session. You see every request and can remove it, and the protocol checks each one.',
          palette.primary
        )
      )

      const $separator = (): I$Node => $node(style({ height: '48px', width: '100%' }))()

      const $flow: I$Node = switchLatest(
        map(
          mode =>
            $column(spacing.big)(
              $separator(),
              $column(spacing.default)(
                $stageHeader(2, mode === 'agent' ? 'Run your agent' : 'Trade'),
                mode === 'agent' ? $spinUpStep() : $tradeStep()
              ),
              switchLatest(map(can => (can ? $column(spacing.big)($separator(), $installStep) : empty), canInstallApp)),
              $separator(),
              $column(spacing.default)($stageHeader(3, 'From here'), mode === 'agent' ? $agentNextStep() : $humanNextStep())
            ),
          modeState
        )
      )

      const $card1 = $card(spacing.big, style({ width: '100%', padding: isDesktopScreen ? '62px' : '16px' }))(
        $stageHeader(1, 'Choose your style'),
        $chooser,
        $flow
      )
      return [$column(spacing.big, style({ width: '100%' }))($heading2($text('Quickstart')), $card1), {}]
    }
  )

const $installWindow: I$Node = $mockWindow(
  $column(
    style({
      aspectRatio: '1',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: '16px',
      cursor: 'pointer',
      backgroundColor: colorShade(palette.foreground, 4)
    }),
    stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 10) }),
    effectProp(
      'onclick',
      nowWith(() => () => {
        void promptInstallApp()
      })
    )
  )(
    $node(style({ fontSize: text.xs, fontWeight: '600', color: palette.foreground, textAlign: 'center' }))($text('Add to your apps')),
    $row(
      style({
        width: '88px',
        height: '88px',
        borderRadius: '20px',
        backgroundColor: palette.primary,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '#00000040 0px 6px 16px 0px'
      })
    )($icon({ $content: $puppetLogo, width: '52px', viewBox: '0 0 32 32', fill: '#ffffff' }))
  ),
  $defaultMockWindow(style({ width: '160px', border: `1px solid ${colorShade(palette.foreground, 20)}` }))
)

const $benefitChip = $row(
  style({
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px 6px 8px',
    borderRadius: '20px',
    backgroundColor: colorShade(palette.foreground, 8),
    fontSize: isDesktopScreen ? text.sm : text.xs,
    color: palette.message,
    whiteSpace: 'nowrap'
  })
)

const $venueStep = (step: number, title: string, line: string, ...$visual: I$Node[]): I$Node =>
  $row(style({ gap: '16px', alignItems: 'flex-start', width: '100%' }))(
    $row(
      style({
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        flexShrink: '0',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: text.sm,
        fontWeight: '700',
        color: palette.message,
        border: `1px solid ${colorShade(palette.foreground, 30)}`
      })
    )($text(String(step))),
    $column(style({ gap: '6px', flex: '1', minWidth: '0' }))(
      $node(style({ fontSize: text.lg, fontWeight: '700', color: palette.message }))($text(title)),
      $node(style({ fontSize: text.base, lineHeight: '1.5', color: palette.foreground }))($text(line)),
      ...($visual.length === 0 ? [] : [$node(style({ paddingTop: '6px' }))(...$visual)])
    )
  )

const $tradeStep = (): I$Node =>
  $column(spacing.big)(
    $row(spacing.big, style({ flexWrap: 'wrap', alignItems: 'center' }))(
      $column(style({ flex: '1 1 320px', minWidth: '260px', gap: '28px' }))(
        $venueStep(
          1,
          'Pick WalletConnect in the venue',
          'On GMX, Hyperliquid or Uniswap, choose WalletConnect and copy its link.',
          $row(style({ alignItems: 'center', gap: '12px' }))($venueIcon('gmx', 24), $venueIcon('hyperliquid', 24), $venueIcon('uniswap', 24)),
          $column(style({ alignItems: 'flex-start', gap: '8px', paddingTop: '14px' }))(
            $benefitChip(
              $venueIcon('gmx', 16),
              $node(style({ fontWeight: '600' }))($text('GMX fees currently 10% lower')),
              $infoTooltip(
                'Puppet\'s GMX referral applies to every fund from its first GMX trade, with nothing to set up. It lowers opening and closing fees, not borrowing or funding. GMX pays Puppet another 15% of those fees as referral revenue, and sets both rates, which it can change.'
              )
            ),
            $benefitChip(
              $venueIcon('hyperliquid', 16),
              $node(style({ fontWeight: '600' }))($text('Hyperliquid fees currently 4% lower')),
              $infoTooltip(
                'Puppet\'s Hyperliquid referral is bound when your fund starts trading on Hyperliquid, with nothing to set up. It lowers trading fees by 4% on the fund\'s first $25M of volume. Hyperliquid sets the rate and can change it.'
              )
            )
          )
        ),
        $venueStep(2, 'Paste it into Puppet', 'Paste it into the link button next to your fund in your wallet. Your fund connects as the wallet. No new app, no extension.'),
        $venueStep(3, 'Trade exactly as before', 'Classic orders are checked before your fund signs them. GMX Express and One-Click orders are relayed by GMX, so Puppet cannot check each one; it tracks what they pull from your fund instead.')
      ),
      $node(style({ flex: '1 1 320px', minWidth: '260px' }))($video(tradeAdjustVideo))
    ),
    $callout(
      'The attestor co-signs each order your fund signs. It can refuse one that breaks the rules but never place one or move value, and withdrawals pay only their owners\' own wallets.'
    )
  )

const $installStep: I$Node = $row(spacing.big, style({ alignItems: 'center', flexWrap: 'wrap', width: '100%' }))(
  $column(spacing.default, style({ flex: '1', minWidth: '220px' }))(
    $node(style({ fontSize: text.base, color: palette.message }))($text('Launch Puppet as an app')),
    $bulletList([
      ['Wallet link stays connected', 'venue requests reach your fund even when Puppet is not the focused window'],
      ['Background syncs', "your fund's venue positions keep updating while the app runs"]
    ])
  ),
  $node(style({ flexShrink: '0' }))($installWindow)
)

const $humanNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A funded trading account and a record that grows with every valuation. From here, performance is the work.'),
    $bulletList([
      ['Allocate your first round', 'Allocate moves your deposit into your fund; you sign its value, the attestor checks it, and the hub mints shares for you and joining puppets.'],
      ['Build a track record', 'Each valuation adds to a public history tied to this account. The chain is the proof.'],
      ['Attract outside capital', 'Once your record stands out, puppets sign mandates naming your fund, and their deposits join the rounds you allocate alongside your own.']
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))($linkButton('Funds', '/traders', true), $linkButton('Protocol docs', DOCS_URL, false))
  )

const $step = (n: number, label: string | I$Node, $extra?: I$Node): I$Node =>
  $column(spacing.small)(
    $row(spacing.small, style({ alignItems: 'baseline' }))(
      $node(style({ color: palette.primary, fontWeight: '700', fontSize: text.sm, minWidth: '18px' }))($text(`${n}.`)),
      $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6', flex: 1 }))(typeof label === 'string' ? $text(label) : label)
    ),
    ...(($extra ? [$extra] : []) as I$Node[])
  )

const $spinUpStep = (): I$Node =>
  $column(spacing.big)(
    $body('Describe your strategy in an instruction set, and your coding LLM builds your own agent to run it, under your oversight.'),
    $column(spacing.big)(
      $step(1, 'Allocate what your strategy trades from your wallet, on the chain it trades on.'),
      $step(
        2,
        'Create an agent: name it, choose its template, and write its instructions.',
        $row(spacing.small)($Link({ route: routeSchema.wallet.agent, $anchor: $defaultAnchor(style({ color: palette.message })), $content: $text('Create an agent') })({}))
      ),
      $step(3, 'Copy it into Claude Code or any coding LLM. It builds the agent and starts it on your computer.'),
      $step(4, 'Start it, and it shows up on its own while your wallet page is open; the first time, allow your browser’s prompt so this site can reach it. Sign one session to let it act, and keep the app open while it runs.')
    ),
    $column(
      spacing.default,
      style({
        padding: isDesktopScreen ? '18px 22px' : '14px 16px',
        borderRadius: '14px',
        backgroundColor: colorShade(palette.foreground, 6),
        border: `1px solid ${colorShade(palette.foreground, 13)}`
      })
    )(
      $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text('What your agent can do')),
      $bulletList([
        ['No key', 'it holds none of your fund’s keys and no session; this app signs each request with its own session.'],
        ['As safe as where it runs', 'it acts with your session in this fund, so run it where you would keep your keys; it can’t send money to an address of its choosing.'],
        ['Screened, one at a time', 'trades run only on screened venues, and requests run one at a time; the limits in your set are code your agent runs.'],
        ['Yours to oversee', 'Sessions on your wallet shows its latest requests; Pause, Remove or closing the app stops any further request. A Hyperliquid trading key it approved keeps trading until it expires or is replaced; trading is all it can do.']
      ])
    )
  )

const $agentNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('Your agent trades while you allocate and redeem in your wallet. From here, performance is the work.'),
    $bulletList([
      ['Keep this app open', 'your agent acts only while the app is open. After a restart it shows up again on its own and acts under your session until it ends.'],
      ['Build a track record', 'each valuation adds to your fund’s public history. The chain is the proof.'],
      ['Attract puppets', 'once your record stands out, puppets sign mandates naming your fund and join its rounds.']
    ]),
    $row(spacing.default, style({ paddingTop: '8px', flexWrap: 'wrap' }))(
      $linkButton('Wallet', '/wallet', true),
      $linkButton('Funds', '/traders', true),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
