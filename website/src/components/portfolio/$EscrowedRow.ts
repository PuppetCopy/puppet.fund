import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAllocateDraft, IEscrowReturnDraft } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { constant, type IStream, just, map, op, periodic, skipRepeats, start, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import {
  $alertIntermediateContainer,
  $amountDisplay,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $infoTooltip,
  text
} from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { priceFor, usdOf } from '../../io/price.js'
import { shortDuration } from '../../pages/common.js'

export interface I$EscrowedRow {
  hideBalances: IStream<boolean>
  viewOnly: IStream<boolean>
  chainId: ChainId
  token: Address
  amount: bigint
  returnAt: bigint
}

export const $EscrowedRow = ({ hideBalances, viewOnly, chainId, token, amount, returnAt }: I$EscrowedRow) =>
  component(([fundRound, fundRoundTether]: IBehavior<PointerEvent, IAllocateDraft>, [escrowReturn, escrowReturnTether]: IBehavior<PointerEvent, IEscrowReturnDraft>) => {
    const clock: IStream<number> = op(periodic(1000), map(() => Math.floor(Date.now() / 1000)), start(Math.floor(Date.now() / 1000)))
    const ready: IStream<boolean> = op(
      clock,
      map(now => returnAt !== 0n && BigInt(now) >= returnAt),
      skipRepeats
    )
    const $returnAction = (phase: IEscrowReturnDraft['phase']) =>
      $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text(phase === 'request' ? 'Return' : 'Claim'), disabled: viewOnly })({
        click: escrowReturnTether(constant<IEscrowReturnDraft>({ kind: 'escrowReturn', id: `escrowReturn:${chainId}:${token}`, chainId, token, phase }))
      })
    return [
      $column(spacing.small, style({ padding: '10px 0', width: '100%' }))(
        $row(spacing.default, style({ alignItems: 'center' }))(
          $node(style({ opacity: '0.5', minWidth: '0' }))($tokenProfile(chainId, token, 28, chainId !== HUB_CHAIN_ID)),
          $node(style({ flex: 1 }))(),
          $node(style({ opacity: '0.5' }))(
            $amountDisplay({
              hideBalances,
              usd: map(price => usdOf(amount, price), priceFor(chainId, token)),
              amount: readableTokenAmountLabel(getTokenDescription(chainId, token), amount),
              align: 'flex-end'
            })
          )
        ),
        $alertIntermediateContainer(
          $row(spacing.tiny, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
            $node(style({ fontSize: text.xs, color: palette.indeterminate }))(
              $text(
                returnAt === 0n
                  ? just('In escrow for your fund, not in a round yet')
                  : op(
                      clock,
                      map(now => (BigInt(now) >= returnAt ? 'Return ready to claim' : `Return requested, claimable in ${shortDuration(Number(returnAt) - now)}`))
                    )
              )
            ),
            $infoTooltip(
              returnAt === 0n
                ? 'Allocate puts this escrow into your fund for shares. Return asks for it back, and a day later Claim sends it to your wallet. Escrowing more cancels a pending return.'
                : 'Allocate puts this escrow into your fund for shares, and Claim sends it to your wallet; whichever runs first takes it. Escrowing more cancels the pending return.'
            )
          ),
          $ButtonPrimary({ $container: $defaultMiniButtonPrimary, $content: $text('Allocate'), disabled: viewOnly })({
            click: fundRoundTether(constant<IAllocateDraft>({ kind: 'allocate', id: 'allocate', escrowChainId: chainId, escrowToken: token, contribution: amount, puppets: 0n, identity: null }))
          }),
          returnAt === 0n ? $returnAction('request') : switchLatest(map(isReady => (isReady ? $returnAction('claim') : $node()), ready))
        )
      ),
      { fundRound, escrowReturn }
    ]
  })
