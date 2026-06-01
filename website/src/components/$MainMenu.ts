import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { readableTokenAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ISubaccountState, type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import {
  combine,
  constant,
  empty,
  type IStream,
  map,
  merge,
  nowWith,
  o,
  op,
  start,
  switchLatest,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  effectProp,
  type I$Node,
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
import { $defaultAnchor, $Link, locationChange, pushUrl, type RouteNode, type RouteSpec } from 'aelea/ui-router'
import type { Address } from 'viem'
import {
  $alertIntermediateSpinnerContainer,
  $anchor,
  $ButtonSecondary,
  $caretDown,
  $gitbook,
  $github,
  $icon,
  $intermediatePromise,
  $moreDots,
  $puppeteer,
  $twitter,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import * as context from '../io/context.js'
import { type connectWallet, type IConnectedWallet, walletQuery } from '../wallet/index.js'
import { $disconnectedWalletDisplay, $profileAvatar, $profileDisplay, readableAccountName } from './$AccountProfile.js'
import { $ThemePicker } from './$ThemePicker.js'
import { $WalletConnect } from './$WalletConnect.js'

interface I$MainMenu {
  subaccountList: IStream<Promise<ISubaccountState[]>>
  selectedSubaccount: IStream<ISubaccountState | null>
}

const $accountTypeIcon = (isMaster: boolean, size = 14) =>
  $icon({
    $content: isMaster ? $puppeteer : $puppetLogo,
    width: `${size}px`,
    fill: palette.foreground,
    viewBox: '0 0 32 32'
  })

const accountUsdLabel = (registry: ITokenRegistryMap, acc: ISubaccountState): string => {
  const desc = getTokenDescription(tokenInfoFor(registry, HUB_CHAIN_ID, acc.baseTokenId).token)
  const hub = acc.chains.get(HUB_CHAIN_ID)
  return `$${readableTokenAmount(desc.decimals, hub?.signedBalance ?? acc.signedBalance)}`
}

export const $MainMenu = ({ subaccountList, selectedSubaccount }: I$MainMenu) =>
  component(
    (
      [clickPopoverClaim, clickPopoverClaimTether]: IBehavior<any, any>,
      [changeTheme, changeThemeTether]: IBehavior<ISlottable, Theme>,
      [selectConnector, selectConnectorTether]: IBehavior<Address[]>, //
      [targetClick, targetClickTether]: IBehavior<INode, PointerEvent>,
      [openAccounts, openAccountsTether]: IBehavior<INode, PointerEvent>,
      [changeActiveSubaccount, changeActiveSubaccountTether]: IBehavior<INode, Address>,
      // Wiring this through is what subscribes $WalletConnect's click → map(connectWallet)
      // operator chain. Without it, button clicks don't fire connect. Value is unused here.
      [_connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>
    ) => {
      const subaccountListState: IStream<ISubaccountState[]> = op(subaccountList, switchPromises, state())

      const $menuItem = $node(
        style({ borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' }),
        stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 12) })
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
        $iconAnchor(attr({ href: 'https://docs.puppet.fund', 'aria-label': 'Documentation' }))(
          $icon({ $content: $gitbook, width: '22px', viewBox: '0 0 32 32' })
        ),
        $iconAnchor(attr({ href: 'https://twitter.com/PuppetCopy', 'aria-label': 'Twitter' }))(
          $icon({ $content: $twitter, width: '22px', viewBox: '0 0 24 24' })
        ),
        $iconAnchor(attr({ href: 'https://github.com/PuppetCopy/monorepo', 'aria-label': 'GitHub' }))(
          $icon({ $content: $github, width: '22px', viewBox: '0 0 32 32' })
        )
      ]

      const themeState = start(theme, changeTheme)
      const $extraMenuPopover = $Popover({
        $container: $iconCircular,
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
        dismiss: locationChange,
        $target: $icon({
          svgOps: o(
            clickPopoverClaimTether(nodeEvent('click')),
            style({
              padding: '6px',
              cursor: 'pointer',
              alignSelf: 'center',
              transform: 'rotate(90deg)'
            })
          ),
          width: '32px',
          $content: $moreDots,
          viewBox: '0 0 32 32'
        })
      })({})

      const $target = $row(
        spacing.small,
        style({
          borderRadius: '50px',
          border: `1px solid ${colorShade(palette.foreground, 40)}`,
          alignItems: 'center',
          paddingRight: '16px',
          cursor: 'pointer'
        }),
        stylePseudo(':hover', {
          border: `1px solid ${palette.foreground}`
        }),
        targetClickTether(nodeEvent('pointerdown'))
      )(
        $disconnectedWalletDisplay(),
        $node(
          style({
            width: '1px',
            alignSelf: 'stretch',
            backgroundColor: colorShade(palette.foreground, 40)
          })
        )(),
        $column(style({ fontSize: text.xs }))($text('Click to'), style({ fontWeight: 'bold' })($node($text('Connect'))))
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

          $row(style({ flex: 1, alignItems: 'center', placeContent: 'center' }))(
            $intermediatePromise({
              $loader: $node(style({ position: 'relative', display: 'inline-flex', borderRadius: '999px' }))(
                style({ position: 'relative', borderRadius: 'inherit' })($target),
                style({
                  position: 'absolute',
                  inset: '0px',
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 0,
                  borderRadius: 'inherit'
                })(
                  style({ width: '100%', height: '100%', borderRadius: 'inherit', overflow: 'hidden' })(
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

                const $caret = () =>
                  $icon({
                    $content: $caretDown,
                    width: '12px',
                    fill: palette.foreground,
                    viewBox: '0 0 32 32',
                    svgOps: style({ position: 'relative' })
                  })
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
                const $plainRight = $node($circle)($caret())
                const $spinningRight = $node($circle)(
                  $node(
                    style({
                      position: 'absolute',
                      top: '-50%',
                      left: '-50%',
                      width: '200%',
                      height: '200%',
                      animation: 'rotate 3.5s linear infinite',
                      background: `conic-gradient(from 0deg, ${palette.indeterminate}, ${colorShade(palette.foreground, 40)}, ${colorShade(palette.foreground, 40)}, ${palette.indeterminate})`
                    })
                  )(),
                  $node(
                    style({ position: 'absolute', inset: '1px', borderRadius: '50%', background: palette.horizon })
                  )(),
                  $caret()
                )
                const $rightSlot = switchLatest(
                  map(
                    p =>
                      p.list.length === 0
                        ? $spinningRight
                        : p.sub
                          ? $node($circle)($profileAvatar({ address: connection.address, size: 45, pixel: false }))
                          : $plainRight,
                    combine({ sub: selectedSubaccount, list: subaccountListState })
                  )
                )

                const shortAddress = (a: string) => `${a.slice(0, 6)}..${a.slice(-4)}`
                const $identitySlot = switchLatest(
                  map(
                    p => {
                      const sub = p.sub
                      if (!sub) return $profileDisplay({ address: connection.address, pixel: false })
                      const subLabel = readableAccountName(sub.name) ?? shortAddress(sub.account)
                      const usdLabel = accountUsdLabel(p.registry, sub)
                      return $row(spacing.small, style({ alignItems: 'center' }))(
                        $profileAvatar({ address: sub.account, size: 45 }),
                        $column(style({ minWidth: '0', gap: '3px' }))(
                          $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.1' }))(
                            $text(shortAddress(connection.address))
                          ),
                          $row(spacing.small, style({ alignItems: 'center' }))(
                            $node(style({ fontSize: text.base, color: palette.message, lineHeight: '1.1' }))(
                              $text(subLabel)
                            ),
                            $accountTypeIcon(sub.isMaster, 14),
                            $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.1' }))(
                              $text(usdLabel)
                            )
                          )
                        )
                      )
                    },
                    combine({ sub: selectedSubaccount, registry: switchPromises(context.tokenRegistryQuery) })
                  )
                )

                return $Popover({
                  $target: $node(
                    style({
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: '50px',
                      border: `1px solid ${colorShade(palette.foreground, 40)}`,
                      padding: '0',
                      cursor: 'pointer'
                    }),
                    stylePseudo(':hover', { borderColor: palette.foreground }),
                    openAccountsTether(nodeEvent('click'))
                  )(
                    $row(spacing.small, style({ alignItems: 'center', alignSelf: 'stretch', pointerEvents: 'none' }))(
                      $identitySlot,
                      $rightSlot
                    )
                  ),
                  $contentContainer: $defaultPopoverContentContainer(
                    style({ padding: '6px', borderRadius: '16px', minWidth: '300px' })
                  ),
                  $open: map(
                    () =>
                      $column(spacing.tiny)(
                        $menuItem(
                          effectProp(
                            'onclick',
                            nowWith(() => () => pushUrl('/portfolio'))
                          )
                        )(
                          $row(spacing.small, style({ alignItems: 'center' }))(
                            $node(style({ fontWeight: '600', color: palette.message }))($text('Portfolio')),
                            $node(style({ flex: 1 }))(),
                            $node(style({ fontSize: text.xs, color: palette.foreground }))($text('All accounts'))
                          )
                        ),
                        $node(
                          style({
                            height: '1px',
                            backgroundColor: colorShade(palette.foreground, 15),
                            margin: '2px 8px'
                          })
                        )(),
                        switchLatest(
                          map(
                            p => {
                              const otherList = p.sub
                                ? p.list.filter(acc => acc.account.toLowerCase() !== p.sub?.account.toLowerCase())
                                : p.list
                              return p.list.length === 0
                                ? $node(style({ color: palette.foreground, fontSize: text.sm, padding: '10px 12px' }))(
                                    $text('No accounts yet - create one below')
                                  )
                                : $column(spacing.tiny)(
                                    ...otherList.map(acc =>
                                      $menuItem(
                                        changeActiveSubaccountTether(nodeEvent('click'), constant(acc.account))
                                      )(
                                        $row(spacing.small, style({ alignItems: 'center' }))(
                                          $profileDisplay({ address: acc.account, name: acc.name, profileSize: 28 }),
                                          $accountTypeIcon(acc.isMaster, 14),
                                          $node(style({ flex: 1 }))(),
                                          $node(style({ fontSize: text.sm, color: palette.message }))(
                                            $text(accountUsdLabel(p.registry, acc))
                                          )
                                        )
                                      )
                                    )
                                  )
                            },
                            combine({
                              list: subaccountListState,
                              sub: selectedSubaccount,
                              registry: switchPromises(context.tokenRegistryQuery)
                            })
                          )
                        ),
                        $node(
                          style({
                            height: '1px',
                            backgroundColor: colorShade(palette.foreground, 15),
                            margin: '2px 8px'
                          })
                        )(),
                        $menuItem(
                          effectProp(
                            'onclick',
                            nowWith(() => () => pushUrl('/hello'))
                          )
                        )(
                          $row(spacing.small, style({ alignItems: 'center' }))(
                            $node(
                              style({
                                width: '20px',
                                textAlign: 'center',
                                fontSize: '22px',
                                lineHeight: '1',
                                color: palette.message
                              })
                            )($text('+')),
                            $node(style({ fontWeight: '600', color: palette.message }))($text('Create account'))
                          )
                        )
                      ),
                    openAccounts
                  ),
                  dismiss: merge(locationChange, changeActiveSubaccount)
                })({})
              }, walletQuery)
            })
          ),

          $row(spacing.big, style({ flex: 1, placeContent: 'flex-end', alignItems: 'center' }))(
            $extraMenuPopover,
            ...(isDesktopScreen ? $socialLinkList : [])
          )
        ),

        { changeActiveSubaccount }
      ]
    }
  )

interface I$PageLink {
  route: RouteNode<RouteSpec>
  params?: Record<string, string>
  $container?: INodeCompose<HTMLAnchorElement>
  $content: I$Node
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
