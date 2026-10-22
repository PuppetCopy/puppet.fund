import { PROTOCOL } from '@puppet/contracts/const'
import type { IFundSwapDraft, ITradeDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ChainId, PRECISION } from '@puppet/sdk/const'
import { getTokenDescription, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import { wrapCallData } from '@puppet/sdk/intent'
import { symbolOf, tokenKeyOf, wrappedNativeAddressOf, wrapSubcallGas } from '@puppet/sdk/state'
import { combine, empty, filter, filterNull, type IStream, just, map, merge, op, sampleMap, start } from 'aelea/stream'
import { type IBehavior, promiseState, type PromiseState, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, component, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { type Address, isAddressEqual } from 'viem'
import { uiStorage } from '@/ui-storage'
import { editorChoiceKey, type IStoredPath } from '../../app/localStoreSchema.js'
import type { ISwapRequest } from '../../io/bridge/swapQuote.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import { $DraftSave, type ISelectedRoute } from './$DraftSave.js'
import { $SourceAmountInput } from './$SourceAmountInput.js'
import { type ISwapTargetOption, withdrawTargetOptions } from './$SwapTargetFlow.js'
import { amountUsdLabel, submitOn } from './editorUtils.js'

export interface I$FundSwapEditor {
  account: Address
  chainId: ChainId
  token: Address
  fundBalance: bigint
  draft: IStream<IFundSwapDraft | null>
  preset: { destinationChainId: ChainId; outputToken: Address; amount: bigint; locked: boolean } | null
  floor?: IStream<PromiseState<{ amount: bigint; reason: string }>>
  $frame?: ($amount: I$Node) => I$Node
  listing?: IStream<boolean>
}

export const $FundSwapEditor = ({ account, chainId, token, fundBalance, draft, preset, floor, $frame, listing }: I$FundSwapEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [commitAmount, commitAmountTether]: IBehavior<bigint>,
      [pickTarget, pickTargetTether]: IBehavior<ISwapTargetOption>,
      [selectingTarget, selectingTargetTether]: IBehavior<boolean>,
      [selectRoute, selectRouteTether]: IBehavior<ISelectedRoute>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const input = getTokenDescription(chainId, token)
      const listed = withdrawTargetOptions(chainId, token).filter(o => o.chainId !== chainId || !isAddressEqual(o.id, token))
      const options = preset !== null && preset.locked ? listed.filter(o => o.chainId === preset.destinationChainId && isAddressEqual(o.id, preset.outputToken)) : listed
      const wrapped = wrappedNativeAddressOf(chainId)
      const counterpart = isAddressEqual(token, PROTOCOL.nativeToken) ? wrapped : isAddressEqual(token, wrapped) ? PROTOCOL.nativeToken : null
      const presetTarget = preset === null ? undefined : options.find(o => o.chainId === preset.destinationChainId && isAddressEqual(o.id, preset.outputToken))
      const initial =
        presetTarget ??
        (counterpart === null ? undefined : options.find(o => o.chainId === chainId && isAddressEqual(o.id, counterpart))) ??
        options.find(o => o.chainId !== chainId && tokenKeyOf(o.chainId, o.id) === tokenKeyOf(chainId, token)) ??
        options[0]
      if (initial === undefined) throw new Error(`${input.symbol} on chain ${chainId} has no token to swap into`)
      const storedTarget: IStream<ISwapTargetOption> = op(
        combine({
          path: uiStorage.replayWrite<IStoredPath | null>(
            editorChoiceKey(account, 'fundSwap'), null,
            map(o => ({ source: { chainId, address: token }, dest: { chainId: o.chainId, address: o.id } }), pickTarget)
          ),
          draft
        }),
        map(p =>
          presetTarget !== undefined || p.draft !== null || p.path === null || p.path.source.chainId !== chainId || !isAddressEqual(p.path.source.address, token)
            ? undefined
            : options.find(o => o.chainId === p.path!.dest.chainId && isAddressEqual(o.id, p.path!.dest.address))
        ),
        filter((o): o is ISwapTargetOption => o !== undefined)
      )
      const target: IStream<ISwapTargetOption> = state(
        initial,
        merge(
          pickTarget,
          storedTarget,
          presetTarget === undefined
            ? op(
                draft,
                filterNull,
                map(d => options.find(o => o.chainId === d.destinationChainId && isAddressEqual(o.id, d.outputToken))),
                filter((o): o is ISwapTargetOption => o !== undefined)
              )
            : empty
        )
      )
      const value: IStream<bigint> = state(
        preset === null || presetTarget === undefined ? 0n : preset.amount,
        merge(
          changeAmount,
          preset === null || presetTarget === undefined
            ? op(
                draft,
                filterNull,
                map(d => d.inputAmount)
              )
            : empty
        )
      )
      const relayFee = op(just(context.getRelayFeeQuote(chainId, token, DISPLAY_QUOTE_TTL_MS)), promiseState, state())
      const request: IStream<ISwapRequest | null> = map(
        p => {
          if (p.fee.status !== PromiseStatus.DONE) return null
          const wrap = p.target.chainId === chainId ? wrapCallData(chainId, token, p.target.id, p.amount) : null
          const net = p.amount - p.fee.value('fundSwap', false, 0n, wrap === null ? 0n : wrapSubcallGas(chainId, { kind: 'swap', provider: wrapped, providerCallData: wrap }), 0n)
          return net <= 0n
            ? null
            : {
                originChainId: chainId,
                destinationChainId: p.target.chainId,
                inputToken: token,
                outputToken: p.target.id,
                inputAmount: net,
                depositor: account,
                recipient: account
              }
        },
        combine({ amount: value, target, fee: relayFee })
      )
      const route: IStream<ISelectedRoute> = state()(selectRoute)
      const minimum: IStream<PromiseState<{ amount: bigint; reason: string }> | null> = floor === undefined ? just(null) : floor
      const alert: IStream<string | null> = op(
        combine({ amount: value, fee: relayFee, route, target, floor: minimum }),
        map(p => {
          if (p.amount === 0n) return null
          if (p.amount > fundBalance) return `Exceeds the fund balance ${readableTokenAmountLabel(input, fundBalance)}`
          if (p.fee.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(p.fee.error)}`
          const wrap = p.target.chainId === chainId ? wrapCallData(chainId, token, p.target.id, p.amount) : null
          const fee =
            p.fee.status === PromiseStatus.DONE
              ? p.fee.value('fundSwap', false, 0n, wrap === null ? 0n : wrapSubcallGas(chainId, { kind: 'swap', provider: wrapped, providerCallData: wrap }), 0n)
              : null
          if (fee !== null && p.amount <= fee) {
            return `Swap more than the ${readableTokenAmountLabel(input, fee)} relay fee, which comes out of the amount`
          }
          if (fee !== null && fee * PRECISION.basisPoints > p.amount * PROTOCOL.maxSwapRelayFeeBps) {
            const floor = (fee * PRECISION.basisPoints + PROTOCOL.maxSwapRelayFeeBps - 1n) / PROTOCOL.maxSwapRelayFeeBps
            return `Swap at least ${readableTokenAmountLabel(input, floor)}: the relay fee is capped at ${readablePercentage(PROTOCOL.maxSwapRelayFeeBps)}`
          }
          if (p.floor !== null && p.floor.status === PromiseStatus.ERROR) return `Deposit fee unavailable: ${formatThrownError(p.floor.error)}`
          if (p.floor !== null && p.floor.status === PromiseStatus.DONE && p.route.plan !== null && p.route.plan.outputAmount < p.floor.value.amount) return p.floor.value.reason
          return p.route.error ?? p.route.limitError
        }),
        state(null)
      )
      const disabled: IStream<boolean> = op(
        combine({ amount: value, alert, route, floor: minimum }),
        map(p => p.amount === 0n || p.alert !== null || !p.route.ready || p.route.plan === null || (p.floor !== null && p.floor.status !== PromiseStatus.DONE)),
        state(true)
      )
      const hidden: IStream<boolean> = start(false, selectingTarget)
      const $whileListed = $node(style({ display: 'contents' }), styleBehavior(map(h => (h ? { display: 'none' } : null), hidden)))
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $whileListed(
            $SourceAmountInput({
              locked: just(false),
              label: 'Swap',
              decimals: just(input.decimals),
              amount: value,
              max: just(fundBalance),
              alert,
              note: amountUsdLabel(value, priceFor(chainId, token)),
              $anchor: empty,
              $frame,
              listing
            })({ change: changeAmountTether(), enter: enterPressTether(), commit: commitAmountTether() })
          ),
          $node(style({ display: 'contents' }), ...(listing === undefined ? [] : [styleBehavior(map(open => (open ? { display: 'none' } : null), listing))]))(
            $DraftSave({
              target: { value: target, optionList: just(options), source: just({ chainId, symbol: symbolOf(chainId, token) }) },
              request,
              commit: commitAmount,
              active: just(true),
              alert,
              disabled
            })({ select: pickTargetTether(), selecting: selectingTargetTether(), selectRoute: selectRouteTether(), save: clickSaveTether() })
          )
        ),
        {
          changeTradeDraft: op(
            sampleMap(p => p, combine({ amount: value, target, route }), submitOn(disabled, clickSave, enterPress)),
            map(p =>
              p.route.ready && p.route.plan !== null ? { amount: p.amount, target: p.target, plan: p.route.plan } : null
            ),
            filterNull,
            map(
              (p): ITradeDraft => ({
                kind: 'fundSwap',
                id: `fundSwap:${chainId}:${token}`,
                chainId,
                destinationChainId: p.target.chainId,
                inputToken: token,
                outputToken: p.target.id,
                inputAmount: p.amount,
                routeInput: p.plan.inputAmount,
                outputAmount: p.plan.outputAmount,
                expectedOutput: p.plan.expectedOutputAmount,
                route: p.plan.route,
                fillDeadline: Math.floor(p.plan.fillDeadline)
              })
            )
          )
        }
      ]
    }
  )
