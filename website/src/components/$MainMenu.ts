
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import {
  combine,
  constant,
  empty,
  filter,
  type IStream,
  map,
  merge,
  o,
  op,
  skipRepeats,
  start,
  switchLatest,
  tap
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  effectRun,
  type INode,
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
import { $defaultAnchor, $Link, href, isContaining, locationChange } from 'aelea/ui-router'
import {
  $alertIntermediateSpinnerContainer,
  $anchor,
  $ButtonSecondary,
  $gitbook,
  $github,
  $icon,
  $intermediatePromise,
  $intermediateText,
  intermediateState,
  keyActivate,
  maskBalance,
  $moreDots,
  softNavClick,
  $intermediateCircle,
  text,
  $twitter,
  $wallet
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $puppetLogo } from '../common/$icons.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { formatUsdNumber } from '../io/price.js'
import { $separator2 } from '../pages/common.js'
import type { IWalletControl, IWalletIntent } from '../wallet/connect.js'
import type { IConnectedWallet, IWalletPair } from '../wallet/index.js'
import { $accountLabel } from './$AccountProfile.js'
import { $ServicesConnectivity } from './$ServicesConnectivity.js'
import { $ThemePicker } from './$ThemePicker.js'
import { $WalletConnect } from './$WalletConnect.js'

export interface I$MainMenu {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  shownPair: IStream<IWalletPair>
  walletValue: IStream<Promise<number | { note: string } | null>>
  walletControl: IWalletControl
}

export const $MainMenu =({ hideBalances, walletPair, shownPair, walletValue, walletControl }: I$MainMenu) =>
  component(
    (
      [clickPopoverClaim, clickPopoverClaimTether]: IBehavior<any, any>,
      [changeTheme, changeThemeTether]: IBehavior<ISlottable, Theme>,
      [targetClick, targetClickTether]: IBehavior<INode, PointerEvent>,
      [escapeExtra, escapeExtraTether]: IBehavior<INode, KeyboardEvent>,
      [enableSession, enableSessionTether]: IBehavior<INode, PointerEvent>,
      [walletIntent, walletIntentTether]: IBehavior<IWalletIntent>
    ) => {
      let extraTriggerEl: HTMLElement | null = null
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
      const iconCircularOpen = stylePseudo('[aria-expanded="true"]', {
        borderColor: colorShade(palette.foreground, 50),
        filter: 'brightness(1.4)'
      })
      const iconCircularActive = stylePseudo(':active', { filter: 'brightness(1.15)' })

      const $iconAnchor = $anchor(layoutSheet.displayFlex, iconCircularStyle, iconCircularHover, iconCircularOpen, iconCircularActive)

      const $iconCircular = $node(layoutSheet.displayFlex, iconCircularStyle, iconCircularHover, iconCircularOpen, iconCircularActive)

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

      const themeState = state(theme, changeTheme)
      const $extraMenuPopover = $Popover({
        $container: $iconCircular,
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
        dismiss: merge(locationChange, escapeExtra),
        $target: $icon({
          svgOps: o(
            clickPopoverClaimTether(nodeEvent('click')),
            escapeExtraTether(onEscape(() => extraTriggerEl)),
            attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'menu', 'aria-label': 'More menu' }),
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
          label: 'More options'
        })
      })({})

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
            flexShrink: 0,
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
        switchLatest(
          map(
            inWallet =>
              inWallet
                ? empty
                : $row(
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
                        $anchor: $defaultAnchor(
                          attr({ 'aria-label': 'Home' }),
                          style({ display: 'inline-flex', cursor: 'pointer' })
                        ),
                        $content: $icon({ $content: $puppetLogo, width: '45px', viewBox: '0 0 32 32' })
                      })({})
                    ),

                    $row(spacing.default, style({ flex: 1, alignItems: 'center', placeContent: 'center' }))(
                      $ServicesConnectivity()({}),
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
                                return $WalletConnect({ control: walletControl })({ walletIntent: walletIntentTether() })
                              }, targetClick)
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

                          const totalState = op(combine({ value: intermediateState(walletValue), pair: walletPair }), state())
                          const totalSettled = op(
                            totalState,
                            filter(p => p.value.status !== PromiseStatus.PENDING),
                            state()
                          )
                          const totalKind = op(
                            totalSettled,
                            map(p => (p.value.status === PromiseStatus.DONE && p.value.value === null ? 'none' : p.value.status === PromiseStatus.DONE && typeof p.value.value === 'object' ? 'note' : 'number')),
                            start('number'),
                            skipRepeats
                          )
                          const $totalUsd = $node(
                            style({ fontSize: text.xs, fontWeight: '600', color: palette.message, lineHeight: '1.1' })
                          )(
                            switchLatest(
                              map(kind => {
                                if (kind === 'number') {
                                  return $intermediateText(maskBalance(map(value => value.then(v => (typeof v === 'number' ? formatUsdNumber(v) : '-')), walletValue), hideBalances))
                                }
                                if (kind === 'none') return $node(style({ color: palette.foreground }))($text('-'))
                                return switchLatest(
                                  map(p => {
                                    if (p.value.status !== PromiseStatus.DONE || p.value.value === null || typeof p.value.value === 'number') return empty
                                    const note = p.value.value.note
                                    if (p.pair.keys === null || p.pair.keys.sessionOf(connection.address, HUB_CHAIN_ID) !== null) {
                                      return $node(attr({ title: note }), style({ color: palette.negative }))($text('Value unknown'))
                                    }
                                    return $node(
                                      attr({ role: 'button', title: `Sign a session so your fund's venues can be read: ${note}.` }),
                                      style({ color: palette.primary, cursor: 'pointer', pointerEvents: 'auto', textDecorationLine: 'underline', textDecorationColor: `color-mix(in srgb, ${palette.foreground} 35%, transparent)`, textUnderlineOffset: '3px' }),
                                      enableSessionTether(
                                        nodeEvent('click'),
                                        tap(event => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                        })
                                      )
                                    )($text('Enable session'))
                                  }, totalSettled)
                                )
                              }, totalKind)
                            )
                          )

                          return $element('a')(
                            attr({ 'aria-label': 'Account', href: href(routeSchema.portfolio) }),
                            style({
                              display: 'inline-flex',
                              alignItems: 'center',
                              borderRadius: '50px',
                              border: `1px solid ${colorShade(palette.foreground, 40)}`,
                              padding: '0',
                              minWidth: '165px',
                              cursor: 'pointer',
                              color: palette.message,
                              textDecoration: 'none'
                            }),
                            stylePseudo(':hover', { borderColor: palette.foreground }),
                            softNavClick(href(routeSchema.portfolio))
                          )(
                            $row(
                              spacing.small,
                              style({ alignItems: 'center', alignSelf: 'stretch', pointerEvents: 'none', paddingRight: '16px', flex: 1 })
                            )(
                              $node($circle)($jazzicon(connection.address)),
                              $column(spacing.tiny, style({ minWidth: '0', flex: 1 }))(
                                $accountLabel({ address: connection.address, primarySize: 0.75 }),
                                $separator2,
                                $totalUsd
                              )
                            )
                          )
                        }, walletControl.query)
                      }),
                      $intermediatePromise({
                        $loader: $intermediateCircle(32),
                        $$fail: () => empty,
                        $display: map(async pair => {
                          const root = await pair.root
                          const fund = root === null || root.fund === null || 'unknown' in root.fund ? null : root.fund
                          const label = fund !== null ? `${fund.symbol} wallet` : root !== null && root.fund === null ? 'Create fund' : 'Wallet'
                          return $Link({
                            route: routeSchema.wallet,
                            $anchor: $defaultAnchor(attr({ 'aria-label': label, title: label }), style({ display: 'inline-flex' })),
                            $content:
                              fund === null
                                ? $node(
                                    style({
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '32px',
                                      height: '32px',
                                      borderRadius: '50%',
                                      backgroundColor: colorShade(palette.foreground, 25)
                                    }),
                                    stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 35) })
                                  )($icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '16px' }))
                                : $fundAvatar(fund.cells, 32)
                          })({})
                        }, shownPair)
                      })
                    ),

                    $row(spacing.big, style({ flex: 1, placeContent: 'flex-end', alignItems: 'center' }))(
                      $extraMenuPopover,
                      ...(isDesktopScreen ? $socialLinkList : [])
                    )
                  ),
            isContaining(routeSchema.wallet)
          )
        ),
        { enableSession, walletIntent }
      ]
    }
  )

