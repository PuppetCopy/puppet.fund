import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $card } from '../common/elements/$common.js'
import type { connectWallet } from '../wallet/index.js'
import { $WalletConnect } from './$WalletConnect.js'

// `connect` output is bubbled up so the operator chain inside $WalletConnect stays
// subscribed — without an external wiring, button clicks don't trigger connectWallet.
export const $ConnectWalletCard = component(([connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>) => {
  return [
    $card(spacing.big)(
      $column(spacing.big, style({ alignItems: 'center', textAlign: 'center', padding: '24px' }))(
        $column(spacing.default, style({ alignItems: 'center' }))(
          $node(style({ fontSize: text.xl, fontWeight: '600' }))($text('Connect a wallet')),
          $node(style({ color: palette.foreground }))($text('To manage your puppet account and copy top traders'))
        ),

        $WalletConnect()({ connect: connectTether() })
      )
    ),
    { connect }
  ]
})
