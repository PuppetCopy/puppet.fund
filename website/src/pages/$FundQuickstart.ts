import type { ISubaccountState } from '@puppet/sdk/state'
import type { IStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $element, $node, $text, component, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Link, type Route } from 'aelea/ui-router'
import { $icon, $puppeteer, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { $heading1 } from '../common/$text.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IFundSwapDraft,
  IRedeemDraft,
  ISellDraft
} from '../components/portfolio/draft.js'
import type { IConnectedWallet } from '../wallet/index.js'
import { $HelloPage } from './$HelloPage.js'

// The fund quickstart, shared by the Home "Get started" section and the standalone /quickstart page: the guide itself
// ($FundQuickstart = heading + the embedded create-and-fund flow) and the trader/investor CTA pair ($fundOrGetFundedCta
// = "Create a Fund" OR "Funds leaderboard"), plus the pill primitives they are built from.

export const $pillAnchor = (filled: boolean, borderColor?: string) =>
  $element('a')(
    style({
      display: 'inline-flex',
      cursor: 'pointer',
      alignItems: 'center',
      height: '48px',
      padding: '0 28px',
      borderRadius: '30px',
      backgroundColor: filled ? palette.primary : palette.background,
      color: filled ? 'white' : palette.message,
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

export const $pillLabel = (label: string, $glyph?: I$Node, filled = false): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    ...($glyph
      ? [$icon({ $content: $glyph, width: '20px', viewBox: '0 0 32 32', fill: filled ? 'white' : palette.message })]
      : []),
    $text(label)
  )

export const $navPill = (label: string, route: Route, filled: boolean, borderColor?: string, $glyph?: I$Node): I$Node =>
  $Link({ route, $content: $pillLabel(label, $glyph, filled), $anchor: $pillAnchor(filled, borderColor) })({})

// "Create a Fund" (for traders) OR "Funds leaderboard" (for investors); create navigates to the /quickstart page.
export const $fundOrGetFundedCta = (): I$Node =>
  $row(
    spacing.default,
    style({
      flexDirection: isDesktopScreen ? 'row' : 'column',
      alignItems: isDesktopScreen ? 'flex-start' : 'center',
      justifyContent: 'center',
      paddingTop: '4px'
    })
  )(
    $column(spacing.small, style({ flexDirection: isDesktopScreen ? 'column' : 'column-reverse', alignItems: 'center' }))(
      $navPill('Create a Fund', routeSchema.quickstart, true, undefined, $puppeteer),
      $node(style({ fontSize: text.xs, color: palette.foreground }))($text('For Traders'))
    ),
    $node(
      style({
        display: 'flex',
        alignItems: 'center',
        height: isDesktopScreen ? '48px' : 'auto',
        fontSize: text.xs,
        fontWeight: 'bold',
        color: palette.foreground
      })
    )($text('OR')),
    $column(spacing.small, style({ alignItems: 'center' }))(
      $navPill('Funds leaderboard', routeSchema.leaderboard, false, palette.primary, $puppetLogo),
      $node(style({ fontSize: text.xs, color: palette.foreground }))($text('For Investors'))
    )
  )

export interface I$FundQuickstart {
  hideBalances: IStream<boolean>
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<Promise<ISubaccountState | null>>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftSwapList: IStream<IFundSwapDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
}

// The quickstart guide: heading + the embedded create-and-fund flow, draft outputs bubbling to the host page.
export const $FundQuickstart = (config: I$FundQuickstart) =>
  component(
    (
      [changeAllocateDraft, changeAllocateDraftTether]: IBehavior<IAllocateDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<IFundSwapDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>
    ) => [
      $column(spacing.big, style({ width: '100%' }))(
        $column(spacing.small, style({ alignItems: 'center', textAlign: 'center', width: '100%' }))(
          $heading1($text('Start your fund')),
          $node(
            style({ fontSize: text.base, lineHeight: '1.6', color: palette.message, maxWidth: '560px' })
          )($text('Trade exactly as you do today, and earn more: backer capital rides your trades and pays you performance fees.')),
          $node(
            style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.primary })
          )($text('No seed phrase · You keep your keys · Agents welcome'))
        ),
        $HelloPage({ ...config, embedded: true })({
          changeAllocateDraft: changeAllocateDraftTether(),
          changeSwapDraft: changeSwapDraftTether(),
          changeRedeemDraft: changeRedeemDraftTether(),
          changeFulfillDraft: changeFulfillDraftTether()
        })
      ),
      { changeAllocateDraft, changeSwapDraft, changeRedeemDraft, changeFulfillDraft }
    ]
  )
