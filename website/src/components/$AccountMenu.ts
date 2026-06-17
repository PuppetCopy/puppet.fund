import { TOKEN_ID } from '@puppet/contracts/const'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { readableAddress } from '@puppet/sdk/core'
import { BYTES32_ZERO } from '@puppet/sdk/const'
import { empty, type IStream, map, nowWith, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  effectProp,
  type I$Node,
  type I$Slottable,
  type INode,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import {
  $check,
  $copy,
  $eye,
  $eyeOff,
  $icon,
  $logout,
  $popoverCaret,
  hideBalances,
  keyActivate,
  text,
  toggleHideBalances
} from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { subject } from '../utils/subject.js'
import { disconnect, type IConnectedWallet, refreshWallet, revokeSessionKey } from '../wallet/index.js'

const $menuGlyph = (path: I$Node, viewBox = '0 0 24 24'): I$Node => $icon({ $content: path, width: '16px', viewBox })

const $menuItem = (glyph: I$Slottable, label: I$Slottable, onClick: () => void, danger = false): I$Node =>
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
    effectProp('onclick', nowWith(() => onClick))
  )($node(style({ display: 'flex', flexShrink: 0 }))(glyph), $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))(label))

export const $AccountMenu = ({ walletState }: { walletState: IStream<IConnectedWallet | null> }) =>
  component(([open, openTether]: IBehavior<INode, PointerEvent>) => [
    switchLatest(
      map((wallet: IConnectedWallet | null) => {
        if (!wallet) return empty
        const fund = wallet.session
          ? predictFundAccount({
              master: predictPuppetAccount({ user: wallet.session.user, signer: wallet.session.signer }),
              baseTokenId: TOKEN_ID.WETH,
              name: BYTES32_ZERO
            })
          : null
        const id: Address = fund ?? wallet.address
        const copied = subject<boolean>()
        const copiedState = state(false, copied.stream)

        const $menu = (): I$Node =>
          $column(attr({ role: 'menu' }), style({ gap: '2px', minWidth: '230px', padding: '4px' }))(
            $menuItem(
              switchLatest(map(hidden => $menuGlyph(hidden ? $eyeOff : $eye), hideBalances)),
              switchLatest(map(hidden => $text(hidden ? 'Show balances' : 'Hide balances'), hideBalances)),
              toggleHideBalances
            ),
            $menuItem(
              switchLatest(map(c => $menuGlyph(c ? $check : $copy), copiedState)),
              switchLatest(map(c => $text(c ? 'Copied' : `Copy ${readableAddress(id)}`), copiedState)),
              () => {
                void navigator.clipboard?.writeText(id)
                copied.push(true)
                setTimeout(() => copied.push(false), 2000)
              }
            ),
            $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 12), margin: '4px 0' }))(),
            $menuItem(
              $menuGlyph($logout),
              $text('Disconnect'),
              async () => {
                if (
                  !confirm(
                    'Disconnect revokes this session key. Any agent or dApp paired with it stops working, and you will need to sign a new session to reconnect. Continue?'
                  )
                )
                  return
                revokeSessionKey(wallet.address)
                await disconnect()
                refreshWallet()
              },
              true
            )
          )

        return $Popover({
          $open: map(() => $menu(), open),
          dismiss: empty,
          $target: $row(
            attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'menu' }),
            style({
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              padding: '5px 10px 5px 6px',
              borderRadius: '100px',
              border: `1px solid ${colorShade(palette.foreground, 40)}`,
              whiteSpace: 'nowrap'
            }),
            stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) }),
            keyActivate(),
            openTether(nodeEvent('click'))
          )(
            $jazzicon(id, 22),
            $node(style({ fontSize: text.sm, color: palette.message }))($text(fund ? 'Your fund' : 'Your wallet')),
            $popoverCaret()
          )
        })({})
      }, walletState)
    ),
    {}
  ])
