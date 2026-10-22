
import { empty, type IStream, map, nowWith, o, op, skipRepeats, switchLatest, tap } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  effectProp,
  type I$Node,
  type I$Op,
  type I$Slottable,
  type INode,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette, theme, themeList } from 'aelea/ui-components-theme'
import { setTheme } from 'aelea/ui-components-theme-browser'
import { $externalMark, $eye, $eyeOff, $icon, $logout, $moreDots, $sun, keyActivate, text } from '@/ui-components'
import type { IWalletIntent } from '../wallet/connect.js'
import type { IFund, IWalletPair } from '../wallet/index.js'
import { endDappLinks } from '../wallet/walletLink.js'
import { $fundProfile } from './$AccountProfile.js'

const $menuGlyph = (path: I$Node): I$Node => $icon({ $content: path, width: '16px', viewBox: '0 0 24 24' })

const $menuItem = (glyph: I$Slottable, label: I$Slottable, click: I$Op, danger = false): I$Node =>
  $row(
    spacing.small,
    attr({ role: 'menuitem', tabindex: '0' }),
    style({
      alignItems: 'center',
      cursor: 'pointer',
      padding: '8px 10px',
      borderRadius: '8px',
      color: palette.foreground,
      fill: palette.foreground,
      userSelect: 'none'
    }),
    stylePseudo(':hover', {
      backgroundColor: colorShade(palette.foreground, 12),
      color: danger ? palette.negative : palette.message,
      fill: danger ? palette.negative : palette.message
    }),
    keyActivate(),
    click
  )(
    $node(style({ display: 'flex', flexShrink: 0 }))(glyph),
    $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))(label)
  )

export interface I$AccountMenu {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  fund: IStream<IFund | null>
}

export const $AccountMenu = ({ hideBalances, walletPair, fund }: I$AccountMenu) =>
  component(
    (
      [open, openTether]: IBehavior<INode, PointerEvent>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<INode, boolean>,
      [walletIntent, walletIntentTether]: IBehavior<INode, IWalletIntent>
    ) => {
      const next = themeList[(themeList.findIndex(t => t.name === theme.name) + 1) % themeList.length]
      const connected = op(
        walletPair,
        map(pair => pair.wallet !== null),
        skipRepeats
      )

      const $menu = (): I$Node =>
        $column(attr({ role: 'menu' }), style({ gap: '2px', minWidth: '200px', padding: '4px' }))(
          switchLatest(
            map(
              held =>
                held === null
                  ? empty
                  : $node(style({ display: 'contents' }))(
                      o(
                        attr({ role: 'menuitem', title: 'Public page' }),
                        style({ padding: '8px 10px', borderRadius: '8px' }),
                        stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 12) })
                      )($fundProfile(held.account, held.cells, held.symbol, $externalMark())),
                      $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 12), margin: '4px 0' }))()
                    ),
              fund
            )
          ),
          switchLatest(
            map(
              hidden =>
                $menuItem(
                  $menuGlyph(hidden ? $eyeOff : $eye),
                  $text(hidden ? 'Show balances' : 'Hide balances'),
                  changeHideBalancesTether(
                    nodeEvent('click'),
                    map(() => !hidden)
                  )
                ),
              hideBalances
            )
          ),
          $menuItem(
            $menuGlyph($sun),
            $text(`${next.name.charAt(0).toUpperCase()}${next.name.slice(1)} theme`),
            effectProp(
              'onclick',
              nowWith(() => () => {
                setTheme(themeList, next)
                location.reload()
              })
            )
          ),
          switchLatest(
            map(
              present =>
                present
                  ? $node(style({ display: 'contents' }))(
                      $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 12), margin: '4px 0' }))(),
                      $menuItem(
                        $menuGlyph($logout),
                        $text('Disconnect'),
                        walletIntentTether(
                          nodeEvent('click'),
                          tap(() => {
                            void endDappLinks()
                          }),
                          map((): IWalletIntent => 'disconnect')
                        ),
                        true
                      )
                    )
                  : empty,
              connected
            )
          )
        )

      return [
        $Popover({
          $open: map(() => $menu(), open),
          dismiss: empty,
          $target: $row(
            attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'menu', 'aria-label': 'Account menu' }),
            style({
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%',
              border: `1px solid ${colorShade(palette.foreground, 40)}`
            }),
            stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) }),
            keyActivate(),
            openTether(nodeEvent('click'))
          )($icon({ $content: $moreDots, viewBox: '0 0 32 32', width: '16px', fill: palette.foreground }))
        })({}),
        { changeHideBalances, walletIntent }
      ]
    }
  )
