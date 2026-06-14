import { FLOAT_PRECISION, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { computeClaimable, computeQueuedShares, type ISubaccountState, type ITokenRegistryMap } from '@puppet/sdk/state'
import {
  combine,
  constant,
  empty,
  filter,
  type IStream,
  map,
  merge,
  nowWith,
  o,
  op,
  start,
  switchPromises,
  tap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  attrBehavior,
  component,
  effectProp,
  effectRun,
  type I$Slottable,
  type INode,
  type INodeCompose,
  type ISlottable,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import {
  $column,
  $defaultPopoverContentContainer,
  $Popover,
  $row,
  isDesktopScreen,
  isMobileScreen,
  layoutSheet,
  spacing
} from 'aelea/ui-components'
import { colorShade, palette, type Theme, theme } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link, locationChange, pushUrl, type Route } from 'aelea/ui-router'
import { type Address, formatUnits, getAddress, type Hex } from 'viem'
import {
  $alertIntermediateSpinnerContainer,
  $anchor,
  $ButtonSecondary,
  $gitbook,
  $github,
  $icon,
  $intermediatePromise,
  $loadingValue,
  $moreDots,
  $twitter,
  keyActivate,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $puppetLogo } from '../common/$icons.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import * as context from '../io/context.js'
import { latestPriceMap } from '../io/gmx/priceFeed.js'
import { matchmakerStatus } from '../io/matchmaker/index.js'
import { $separator2 } from '../pages/common.js'
import { type connectWallet, type IConnectedWallet, walletQuery } from '../wallet/index.js'
import { $accountLabel } from './$AccountProfile.js'
import { $ServicesConnectivity } from './$ServicesConnectivity.js'
import { $WalletLink } from './$WalletLink.js'
import { $ThemePicker } from './$ThemePicker.js'
import { $WalletConnect } from './$WalletConnect.js'

interface I$MainMenu {
  walletState: IStream<ISubaccountState | null>
}

export const $MainMenu = ({ walletState }: I$MainMenu) =>
  component(
    (
      [clickPopoverClaim, clickPopoverClaimTether]: IBehavior<any, any>,
      [changeTheme, changeThemeTether]: IBehavior<ISlottable, Theme>,
      [selectConnector, selectConnectorTether]: IBehavior<Address[]>, //
      [targetClick, targetClickTether]: IBehavior<INode, PointerEvent>,
      // Capture the extra menu's dismiss output so aria-expanded can mirror open/closed state.
      [extraDismiss, extraDismissTether]: IBehavior<unknown>,
      // Escape keydown inside the extra menu (popover:'manual' suppresses native Escape close);
      // fed back into the popover's `dismiss` prop to close it.
      [escapeExtra, escapeExtraTether]: IBehavior<INode, KeyboardEvent>,
      // Wiring this through is what subscribes $WalletConnect's click → map(connectWallet)
      // operator chain. Without it, button clicks don't fire connect. Value is unused here.
      [_connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>
    ) => {
      // Trigger handle for returning focus when Escape closes the extra menu.
      let extraTriggerEl: HTMLElement | null = null
      // Open/closed stream: true on trigger click, false on the popover's dismiss event.
      const extraOpen = merge(constant(true, clickPopoverClaim), constant(false, extraDismiss))
      // Escape keydown → close: filters Escape, returns focus to the trigger, emits a dismiss.
      const onEscape = (getTrigger: () => HTMLElement | null) =>
        o(
          nodeEvent('keydown'),
          filter((e: KeyboardEvent) => e.key === 'Escape'),
          tap((e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            getTrigger()?.focus()
          })
        )

      const iconCircularStyle = style({
        padding: '0 4px',
        border: `1px solid ${colorShade(palette.foreground, 40)}`,
        borderRadius: '50%',
        alignItems: 'center',
        placeContent: 'center',
        height: '42px',
        width: '42px',
        cursor: 'pointer',
        transition: 'filter 120ms ease-out, border-color 120ms ease-out'
      })
      const iconCircularHover = stylePseudo(':hover', {
        borderColor: colorShade(palette.foreground, 50),
        filter: 'brightness(1.4)'
      })
      const iconCircularActive = stylePseudo(':active', { filter: 'brightness(1.15)' })

      const $iconAnchor = $anchor(layoutSheet.displayFlex, iconCircularStyle, iconCircularHover, iconCircularActive)

      const $iconCircular = $node(layoutSheet.displayFlex, iconCircularStyle, iconCircularHover, iconCircularActive)

      const $socialLinkList = [
        $iconAnchor(attr({ href: DOCS_URL, 'aria-label': 'Documentation' }))(
          $icon({ $content: $gitbook, width: '22px', viewBox: '0 0 32 32' })
        ),
        $iconAnchor(attr({ href: 'https://twitter.com/PuppetCopy', 'aria-label': 'Twitter' }))(
          $icon({ $content: $twitter, width: '22px', viewBox: '0 0 24 24' })
        ),
        $iconAnchor(attr({ href: GITHUB_REPO_URL, 'aria-label': 'GitHub' }))(
          $icon({ $content: $github, width: '22px', viewBox: '0 0 32 32' })
        )
      ]

      const themeState = start(theme, changeTheme)
      const $extraMenuPopover = $Popover({
        $container: $iconCircular,
        // Announced as a menu; popover:'manual' suppresses native Escape, so wire it explicitly.
        $contentContainer: $defaultPopoverContentContainer(
          attr({ role: 'menu', tabindex: '-1' }),
          escapeExtraTether(onEscape(() => extraTriggerEl))
        ),
        $open: constant(
          $column(spacing.default)(
            isMobileScreen
              ? $row(spacing.big, style({ flexWrap: 'wrap', placeContent: 'center' }))(...$socialLinkList)
              : empty,
            $ButtonSecondary({
              $content: $ThemePicker(themeState)({
                changeTheme: changeThemeTether()
              })
            })({})
          ),
          clickPopoverClaim
        ),
        // Close on route change OR Escape pressed inside the menu/trigger.
        dismiss: merge(locationChange, escapeExtra),
        $target: $icon({
          svgOps: o(
            clickPopoverClaimTether(nodeEvent('click')),
            escapeExtraTether(onEscape(() => extraTriggerEl)),
            attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'menu', 'aria-label': 'More menu' }),
            attrBehavior(map(open => ({ 'aria-expanded': open ? 'true' : 'false' }), extraOpen)),
            keyActivate(),
            effectRun((el: unknown) => {
              extraTriggerEl = el as HTMLElement
            }),
            style({
              padding: '6px',
              cursor: 'pointer',
              alignSelf: 'center',
              transform: 'rotate(90deg)'
            })
          ),
          width: '32px',
          $content: $moreDots,
          viewBox: '0 0 32 32',
          // Accessible name so the icon-only trigger is not silent to AT (and is not aria-hidden).
          // The svgOps above further refine role/aria-label for the menu-trigger semantics.
          label: 'More options'
        })
      })({ dismiss: extraDismissTether() })

      const $connectCircle = $node(
        style({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '45px',
          height: '45px',
          flexShrink: '0',
          borderRadius: '50%',
          color: palette.foreground,
          fontWeight: '800',
          fontSize: text.xl
        })
      )($text('?'))

      const $target = $row(
        style({
          borderRadius: '50px',
          border: `1px solid ${colorShade(palette.foreground, 40)}`,
          alignItems: 'center',
          cursor: 'pointer'
        }),
        stylePseudo(':hover', { borderColor: palette.foreground }),
        targetClickTether(nodeEvent('pointerdown'))
      )(
        $connectCircle,
        $node(
          style({
            width: '1px',
            alignSelf: 'stretch',
            backgroundColor: colorShade(palette.foreground, 40)
          })
        )(),
        $column(style({ fontSize: text.xs, padding: '0 16px', lineHeight: '1.3', whiteSpace: 'nowrap' }))(
          $node($text('Click to')),
          $node(style({ fontWeight: 'bold' }))($text('Connect'))
        )
      )

      return [
        $row(
          spacing.default,
          style({
            transition: 'width .3s ease-in-out',
            overflow: 'hidden',
            zIndex: 22,
            padding: '18px 12px',
            maxHeight: '100vh',
            flexShrink: 0,
            placeContent: 'space-between'
          })
        )(
          $column(
            spacing.big,
            style({ flex: 1, alignItems: 'flex-start' })
          )(
            $Link({
              route: routeSchema,
              $anchor: $defaultAnchor(attr({ 'aria-label': 'Home' })),
              $content: $icon({ $content: $puppetLogo, width: '45px', viewBox: '0 0 32 32' })
            })({})
          ),

          $row(spacing.default, style({ flex: 1, alignItems: 'center', placeContent: 'center' }))(
            $ServicesConnectivity({ matchmaker: matchmakerStatus })({}),
            $intermediatePromise({
              $loader: $node(style({ position: 'relative', display: 'inline-flex', borderRadius: '50px' }))(
                style({ position: 'relative' })($target),
                style({
                  position: 'absolute',
                  inset: '0px',
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 0,
                  borderRadius: '50px'
                })(
                  style({ width: '100%', height: '100%', borderRadius: '50px', overflow: 'hidden' })(
                    $alertIntermediateSpinnerContainer()
                  )
                )
              ),
              $display: map(async connectionQuery => {
                const connection: IConnectedWallet | null = await connectionQuery

                if (!connection?.address) {
                  return $Popover({
                    $target,
                    $open: map(() => {
                      return $WalletConnect()({ connect: connectTether() })
                    }, targetClick),
                    dismiss: selectConnector
                  })({})
                }

                const $circle = style({
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '45px',
                  height: '45px',
                  borderRadius: '50%',
                  flexShrink: '0',
                  overflow: 'hidden'
                })

                const registryState: IStream<ITokenRegistryMap> = op(
                  context.tokenRegistryQuery,
                  switchPromises,
                  state()
                )
                // Total account value, lensed off the root PA state: cash + per-position
                // value (claimable + held shares at fund NAV). The fund's own cash is the
                // backing of those shares, so position value IS the wallet's claim on it.
                const totalUsdText: IStream<string> = op(
                  combine({ root: walletState, prices: latestPriceMap, registry: registryState }),
                  map(p => {
                    if (!p.root) return '-'
                    const priceOf = (tokenId: Hex): bigint => {
                      const hubToken = p.registry.get(HUB_CHAIN_ID)?.get(tokenId)?.token
                      return (hubToken ? p.prices[hubToken]?.price : undefined) ?? 0n
                    }
                    const fundById = new Map(p.root.funds.map(f => [getAddress(f.fund), f] as const))
                    let total = 0n
                    for (const [tokenId, row] of p.root.balances) total += row.signedBalance * priceOf(tokenId)
                    for (const pos of p.root.positions) {
                      const fund = fundById.get(getAddress(pos.fund))
                      if (!fund) continue
                      const px = priceOf(fund.baseTokenId as Hex)
                      const redeemPos = {
                        sharesHeld: pos.sharesHeld,
                        stake: pos.stake,
                        cursor: pos.cursor,
                        accrued: pos.accrued,
                        accruedPerStake: fund.accruedPerStake,
                        totalStake: fund.totalStake,
                        queuedShares: fund.queuedShares
                      }
                      total +=
                        (computeClaimable(redeemPos) +
                          ((pos.sharesHeld + computeQueuedShares(redeemPos)) * fund.navPerShare) / FLOAT_PRECISION) *
                        px
                    }
                    return `$${Number(formatUnits(total, 30)).toFixed(2)}`
                  }),
                  start('-')
                )

                return $element('a')(
                  attr({ 'aria-label': 'Wallet Page', href: '/portfolio' }),
                  style({
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: '50px',
                    border: `1px solid ${colorShade(palette.foreground, 40)}`,
                    padding: '0',
                    cursor: 'pointer',
                    color: palette.message,
                    textDecoration: 'none'
                  }),
                  stylePseudo(':hover', { borderColor: palette.foreground }),
                  effectProp(
                    'onclick',
                    nowWith(() => (ev: MouseEvent) => {
                      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                      ev.preventDefault()
                      pushUrl('/portfolio')
                    })
                  )
                )(
                  $row(
                    spacing.small,
                    style({ alignItems: 'center', alignSelf: 'stretch', pointerEvents: 'none', paddingRight: '16px' })
                  )(
                    $node($circle)($jazzicon(connection.address)),
                    $column(spacing.tiny, style({ minWidth: '0' }))(
                      $accountLabel({ address: connection.address, primarySize: 0.75 }),
                      $separator2,
                      $node(style({ fontSize: text.xs, fontWeight: '600', color: palette.message, lineHeight: '1.1' }))(
                        $loadingValue(totalUsdText)
                      )
                    )
                  )
                )
              }, walletQuery)
            }),
            $WalletLink({ walletState: op(walletQuery, switchPromises, state()) })({})
          ),

          $row(spacing.big, style({ flex: 1, placeContent: 'flex-end', alignItems: 'center' }))(
            $extraMenuPopover,
            ...(isDesktopScreen ? $socialLinkList : [])
          )
        )
      ]
    }
  )

interface I$PageLink {
  route: Route
  params?: Record<string, string>
  $container?: INodeCompose<HTMLAnchorElement>
  $content: I$Slottable
}

const $pageLink = (config: I$PageLink) =>
  $Link({
    route: config.route,
    params: config.params,
    $anchor: (config.$container ?? $defaultAnchor(style({ padding: '11px 22px' })))(
      style({ borderRadius: '50px', border: `1px solid ${colorShade(palette.foreground, 40)}` })
    ),
    $content: config.$content
  })
