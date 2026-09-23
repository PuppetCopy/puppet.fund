import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { constant, type IStream, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import type { Address } from 'viem'
import { $amountDisplay, $ButtonPrimary, $defaultMiniButtonPrimary } from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { formatUsd, priceFor } from '../../io/price.js'
import type { IAllocateDraft } from './draft.js'

export interface I$EscrowedRow {
  hideBalances: IStream<boolean>
  chainId: ChainId
  token: Address
  amount: bigint
}

export const $EscrowedRow = ({ hideBalances, chainId, token, amount }: I$EscrowedRow) =>
  component(([fundRound, fundRoundTether]: IBehavior<PointerEvent, IAllocateDraft>) => [
    $row(spacing.default, style({ alignItems: 'center', padding: '10px 0', width: '100%' }))(
      $tokenProfile(chainId, token, 32, chainId !== HUB_CHAIN_ID),
      $ButtonPrimary({ $container: $defaultMiniButtonPrimary, $content: $text('Fund a round') })({
        click: fundRoundTether(
          constant<IAllocateDraft>({ kind: 'allocate', id: 'allocate', escrowChainId: chainId, escrowToken: token, contribution: amount, backers: 0n, identity: null })
        )
      }),
      $node(style({ flex: 1 }))(),
      $amountDisplay({
        hideBalances,
        usd: map(price => formatUsd(amount, price), priceFor(chainId, token)),
        amount: readableTokenAmountLabel(getTokenDescription(chainId, token), amount),
        align: 'flex-end'
      })
    ),
    { fundRound }
  ])
