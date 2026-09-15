
import {
  constant,
  empty,
  filter,
  type IStream,
  map,
  merge,
  o,
  op,
  switchLatest,
  tap
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  attrBehavior,
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
import { $defaultAnchor, $Link, locationChange } from 'aelea/ui-router'
import {
  $alertIntermediateSpinnerContainer,
  $anchor,
  $ButtonSecondary,
  $gitbook,
  $github,
  $icon,
  $intermediatePromise,
  $moreDots,
  $twitter,
  keyActivate,
  softNavClick,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $puppetLogo } from '../common/$icons.js'
import { DOCS_URL, GITHUB_REPO_URL } from '../const/links.js'
import { $separator2 } from '../pages/common.js'
import { type IConnectedWallet, type IWalletPair, walletQuery } from '../wallet/index.js'
import { $accountLabel } from './$AccountProfile.js'
import { $ServicesConnectivity } from './$ServicesConnectivity.js'
import { $ThemePicker } from './$ThemePicker.js'
import { $WalletConnect } from './$WalletConnect.js'
import { $WalletLink } from './$WalletLink.js'

export interface I$MainMenu {
  walletPair: IStream<IWalletPair>
  walletValue: IStream<Promise<number | null>>
}

export const $MainMenu = ({ walletPair, walletValue }: I$MainMenu) =>
  component(
    (
      [clickPopoverClaim, clickPopoverClaimTether]: IBehavior<any, any>,
      [changeTheme, changeThemeTether]: IBehavior<ISlottable, Theme>,
      [targetClick, targetClickTether]: IBehavior<INode, PointerEvent>,
      [extraDismiss, extraDismissTether]: IBehavior<unknown>,
      [escapeExtra, escapeExtraTether]: IBehavior<INode, KeyboardEvent>
    ) => {
      let extraTriggerEl: HTMLElement | null = null
      const extraOpen = merge(constant(true, clickPopoverClaim), constant(false, extraDismiss))
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
                      return $WalletConnect()({})
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

                const $totalUsd = $node(
                  style({ fontSize: text.xs, fontWeight: '600', color: palette.message, lineHeight: '1.1' })
                )(
                  switchLatest(
                    map(
                      s =>
                        s.status === PromiseStatus.ERROR
                          ? $node(
                              attr({ title: `Value unavailable: ${s.error instanceof Error ? s.error.message : String(s.error)}` }),
                              style({ color: palette.negative })
                            )($text('!'))
                          : $node(style({ color: s.status === PromiseStatus.DONE && s.value !== null ? palette.message : palette.foreground }))(
                              $text(s.status === PromiseStatus.DONE && s.value !== null ? `$${s.value.toFixed(2)}` : '-')
                            ),
                      op(walletValue, promiseState)
                    )
                  )
                )

                return $element('a')(
                  attr({ 'aria-label': 'Account', href: '/portfolio' }),
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
                  softNavClick('/portfolio')
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
              }, walletQuery)
            }),
            $WalletLink({ walletPair })({})
          ),

          $row(spacing.big, style({ flex: 1, placeContent: 'flex-end', alignItems: 'center' }))(
            $extraMenuPopover,
            ...(isDesktopScreen ? $socialLinkList : [])
          )
        )
      ]
    }
  )

