import { type IOps, join, just, map, op } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $text, component, type I$Node, type INodeCompose, style } from 'aelea/ui'
import { $Popover, $row, spacing } from 'aelea/ui-components'
import { $ButtonSecondary, $intermediatePromise } from '@/ui-components'
import { type IConnectedWallet, walletQuery } from '../wallet/index.js'
import { $WalletConnect } from './$WalletConnect.js'

export interface I$IntermediateConnectButton {
  $$display: IOps<IConnectedWallet | null, I$Node>
  $container?: INodeCompose
}

export const $IntermediateConnectButton = (config: I$IntermediateConnectButton) =>
  component(([openPopover, openPopoverTether]: IBehavior<PointerEvent>) => {
    const $container = config.$container || $row(style({ minHeight: '48px', minWidth: '0px' }))

    const $walletConnect = $WalletConnect()({})

    const $baseButton = $container(
      $ButtonSecondary({
        $content: $row(spacing.default, style({ alignItems: 'center' }))($text('Connect Wallet'))
      })({ click: openPopoverTether() })
    )

    const $content = op(
      walletQuery,
      map(async query => {
        const wallet = await query
        if (!wallet) {
          return $Popover({ $target: $baseButton, $open: map(() => $walletConnect, openPopover) })({})
        }
        return join(config.$$display(just(wallet)))
      })
    )

    return [$intermediatePromise({ $display: $content }), {}]
  })
