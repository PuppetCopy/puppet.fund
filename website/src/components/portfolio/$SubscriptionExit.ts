import { FLOAT_PRECISION, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { applyFactor, readableTokenAmountLabel } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  getFundPoolState,
  getPuppetRedeemPosition,
  type IFundPoolState,
  type IPuppetRedeemPosition,
  type ITokenRegistryMap,
  liveFundPoolState,
  livePuppetRedeemPosition,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  empty,
  fromPromise,
  type IStream,
  map,
  merge,
  op,
  skipRepeats,
  switchLatest
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $text, component, style } from 'aelea/ui'
import { $Popover, $row, spacing } from 'aelea/ui-components'
import type { Address, Hex } from 'viem'
import { $amountDisplay, $ButtonSecondary, text } from '@/ui-components'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { sqlClient } from '../../io/indexer/sql.js'
import { $ClaimEditor, $RedeemEditor } from './$RedeemEditor.js'
import type { IClaimDraft, ISellDraft } from './draft.js'

export interface I$SubscriptionExit {
  puppet: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  tokenRegistry: ITokenRegistryMap
}

const EMPTY_POSITION: IPuppetRedeemPosition = {
  sharesHeld: 0n,
  stake: 0n,
  cursor: 0n,
  accrued: 0n,
  accruedPerStake: 0n,
  totalStake: 0n,
  queuedShares: 0n
}

const EMPTY_POOL: IFundPoolState = {
  totalShareSupply: 0n,
  queuedShares: 0n,
  accruedPerStake: 0n,
  totalStake: 0n,
  closeRate: 0n,
  navPerShare: 0n
}

export const $SubscriptionExit = ({ puppet, masterAccount, baseToken, baseTokenId, tokenRegistry }: I$SubscriptionExit) =>
  component(
    (
      [sellDraft, sellDraftTether]: IBehavior<ISellDraft>,
      [claimDraft, claimDraftTether]: IBehavior<IClaimDraft>,
      [popSell, popSellTether]: IBehavior<PointerEvent>,
      [popClaim, popClaimTether]: IBehavior<PointerEvent>
    ) => {
      const editorProps = { puppet, masterAccount, baseToken, baseTokenId, tokenRegistry }
      const desc = getTokenDescription(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token)

      const position = op(
        merge(
          fromPromise(getPuppetRedeemPosition(sqlClient, puppet, masterAccount)),
          livePuppetRedeemPosition(sqlClient, puppet, masterAccount)
        ),
        state(EMPTY_POSITION)
      )
      const pool = op(
        merge(fromPromise(getFundPoolState(sqlClient, masterAccount)), liveFundPoolState(sqlClient, masterAccount)),
        state(EMPTY_POOL)
      )
      const settle = combine({ position, pool })

      const baseValue: IStream<bigint> = map(p => (p.position.sharesHeld * p.pool.navPerShare) / FLOAT_PRECISION, settle)
      const claimable: IStream<bigint> = map(
        p =>
          computeClaimable(p.position) +
          (p.pool.closeRate !== 0n ? applyFactor(p.pool.closeRate, p.position.sharesHeld) : 0n),
        settle
      )
      const hasShares: IStream<boolean> = map(p => p.sharesHeld > 0n, position)

      const $value = $amountDisplay({
        usd: map(p => formatUsd(p.v, p.price), combine({ v: baseValue, price: priceFor(baseToken) })),
        amount: map(v => readableTokenAmountLabel(desc, v), baseValue),
        usdFontSize: text.sm,
        align: 'flex-end'
      })

      const $sellPopover = $Popover({
        $target: $ButtonSecondary({ disabled: map(has => !has, hasShares), $content: $text('Sell') })({
          click: popSellTether()
        }),
        $open: constant($RedeemEditor(editorProps)({ changeDraft: sellDraftTether() }), popSell),
        dismiss: sellDraft
      })({})

      const $claimPopover = $Popover({
        $target: $ButtonSecondary({ $content: $text('Claim') })({ click: popClaimTether() }),
        $open: constant($ClaimEditor(editorProps)({ changeDraft: claimDraftTether() }), popClaim),
        dismiss: claimDraft
      })({})

      const $claimSlot = switchLatest(
        map(
          show => (show ? $claimPopover : empty),
          op(
            claimable,
            map(c => c > 0n),
            skipRepeats
          )
        )
      )

      return [
        $row(spacing.default, style({ alignItems: 'center' }))($value, $sellPopover, $claimSlot),
        { changeRedeemDraft: merge(sellDraft, claimDraft) }
      ]
    }
  )
