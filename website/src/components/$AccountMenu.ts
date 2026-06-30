import { empty, type IStream, map, nowWith, switchLatest } from 'aelea/stream'
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
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $eye, $eyeOff, $icon, $logout, $popoverCaret, keyActivate, text } from '@/ui-components'
import { disconnect, type IConnectedWallet, refreshWallet, revokeSessionKey } from '../wallet/index.js'

const $menuGlyph = (path: I$Node, viewBox = '0 0 24 24'): I$Node => $icon({ $content: path, width: '16px', viewBox })

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

export const $AccountMenu = ({
  walletState,
  hideBalances
}: {
  walletState: IStream<IConnectedWallet | null>
  hideBalances: IStream<boolean>
}) =>
  component(
    (
      [open, openTether]: IBehavior<INode, PointerEvent>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<INode, boolean>
    ) => [
      switchLatest(
        map((wallet: IConnectedWallet | null) => {
          if (!wallet) return empty

          const $menu = (): I$Node =>
            $column(attr({ role: 'menu' }), style({ gap: '2px', minWidth: '200px', padding: '4px' }))(
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
              $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 12), margin: '4px 0' }))(),
              $menuItem(
                $menuGlyph($logout),
                $text('Disconnect'),
                effectProp(
                  'onclick',
                  nowWith(() => async () => {
                    if (
                      !confirm(
                        'Disconnect revokes this session key. Any agent or dApp paired with it stops working, and you will need to sign a new session to reconnect. Continue?'
                      )
                    )
                      return
                    revokeSessionKey(wallet.address)
                    await disconnect()
                    refreshWallet()
                  })
                ),
                true
              )
            )

          return $Popover({
            $open: map(() => $menu(), open),
            dismiss: empty,
            $target: $row(
              attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'menu', 'aria-label': 'Settings' }),
              style({
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                padding: '6px 12px',
                borderRadius: '100px',
                border: `1px solid ${colorShade(palette.foreground, 40)}`,
                whiteSpace: 'nowrap'
              }),
              stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) }),
              keyActivate(),
              openTether(nodeEvent('click'))
            )($node(style({ fontSize: text.sm, color: palette.foreground }))($text('Settings')), $popoverCaret())
          })({})
        }, walletState)
      ),
      { changeHideBalances }
    ]
  )
