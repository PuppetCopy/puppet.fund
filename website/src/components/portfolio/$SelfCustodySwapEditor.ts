import { PROTOCOL } from '@puppet/contracts/const'
import { type IOperateSwapDraft, type ITradeDraft, OPERATE_SWAP_SLIPPAGE_BPS } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import { CHAIN_ID_LIST, CHAIN_TOKEN_MAP, type ChainId, CROSS_CHAIN_MIN_USD } from '@puppet/sdk/const'
import { getTokenDescription, type ITokenProfile, readableTokenAmountLabel } from '@puppet/sdk/core'
import { DEFAULT_EVALUATION_CONFIG, USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { clientOf, quoteAcrossDeposit } from '@puppet/sdk/intent'
import { chainTokenOfKey, declaredCallGas, dynamicCalldataBytes, listedTokensOf, tokenKeyOf } from '@puppet/sdk/state'
import {
  acrossBridgeCalls,
  acrossVenue,
  type IAcrossBridge,
  type IUniswapPool,
  type IUniswapQuote,
  UNISWAP_POOLS,
  uniswapPools,
  uniswapQuotes,
  uniswapSwapCalls,
  withAllowancePolicy
} from '@puppet/sdk/venue'
import { combine, debounce, empty, filter, filterNull, type IStream, just, map, merge, op, reduce, sampleMap, skipRepeats, start, switchMap, take, until } from 'aelea/stream'
import { type IBehavior, promiseState, type PromiseState, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, component, style, styleBehavior } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { type Address, type Hex, isAddressEqual } from 'viem'
import { chainName } from '../../common/$chain.js'
import { clientDeps } from '../../io/clientDeps.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { freshPrice, usdOf } from '../../io/price.js'
import { $DraftSave, blockTimeLabel, etaLabel, feeParts, type IRouteOption, usdNumber } from './$DraftSave.js'
import { $SourceAmountInput } from './$SourceAmountInput.js'
import type { ISwapTargetOption } from './$SwapTargetFlow.js'
import { submitOn } from './editorUtils.js'

export interface I$SelfCustodySwapEditor {
  chainId: ChainId
  account: Address
  token: Address
  profile: ITokenProfile
  balance: bigint
  draft: IStream<IOperateSwapDraft | null>
}

interface ISwapQuote {
  amount: bigint
  target: ISwapTargetOption | null
  quote: IUniswapQuote
  price: bigint
  fee: bigint
  bridge: { leg: IAcrossBridge; limits: { minDeposit: bigint; maxDeposit: bigint }; isAmountTooLow: boolean; etaSec: number | undefined } | null
}

const floorOf = (quoted: bigint): bigint => (quoted * (10_000n - OPERATE_SWAP_SLIPPAGE_BPS)) / 10_000n

export const $SelfCustodySwapEditor = ({ chainId, account, token, profile, balance, draft }: I$SelfCustodySwapEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [commitAmount, commitAmountTether]: IBehavior<bigint>,
      [pickTarget, pickTargetTether]: IBehavior<ISwapTargetOption>,
      [selectingTarget, selectingTargetTether]: IBehavior<boolean>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const pinned = UNISWAP_POOLS[chainId]
      if (pinned === undefined) throw new Error(`no Uniswap pools are pinned on chain ${chainId}`)
      const client = clientOf(clientDeps, chainId)
      const pools: Promise<IUniswapPool[]> = client.getBlockNumber().then(block => uniswapPools(client, pinned, chainId, token, block))
      const originKeys = new Set(Object.keys(CHAIN_TOKEN_MAP[chainId]))
      const options: readonly ISwapTargetOption[] = (acrossVenue.chains.includes(chainId) ? [chainId, ...CHAIN_ID_LIST.filter(each => each !== chainId)] : [chainId]).flatMap(target =>
        (listedTokensOf(target) as Hex[])
          .filter(id => !isAddressEqual(id, PROTOCOL.nativeToken) && originKeys.has(tokenKeyOf(target, id)))
          .map(id => ({ chainId: target, id, symbol: tokenKeyOf(target, id) }))
      )
      const amount: IStream<bigint> = state(
        0n,
        merge(
          changeAmount,
          op(
            draft,
            filterNull,
            map(d => d.inputAmount)
          )
        )
      )
      const restored: IStream<ISwapTargetOption | null> = op(
        draft,
        filterNull,
        map(
          d =>
            options.find(o =>
              d.bridge === null ? o.chainId === chainId && isAddressEqual(o.id, d.outputToken) : o.chainId === d.bridge.destinationChainId && isAddressEqual(o.id, d.bridge.outputToken)
            ) ?? null
        )
      )
      const quoteSwap = async (sold: bigint, target: ISwapTargetOption | null): Promise<ISwapQuote | null> => {
        const into = target === null ? null : chainTokenOfKey(chainId, tokenKeyOf(target.chainId, target.id))
        const quotes = (await uniswapQuotes(client, pinned, token, await pools, sold, await client.getBlockNumber())).filter(quote => into === null || isAddressEqual(quote.token, into))
        if (quotes.length === 0) return null
        const priced = (await Promise.all(quotes.map(async quote => ({ quote, price: await freshPrice(chainId, quote.token) })))).flatMap(each =>
          each.price === null ? [] : [{ quote: each.quote, price: each.price }]
        )
        const best = priced.reduce<(typeof priced)[number] | null>((top, each) => (top === null || each.price * each.quote.quoted > top.price * top.quote.quoted ? each : top), null)
        if (best === null) throw new Error(`the oracle prices none of the tokens a Uniswap pool would return for ${profile.symbol}`)
        const floor = floorOf(best.quote.quoted)
        const swapCalls = uniswapSwapCalls(chainId, token, sold, best.quote, floor)
        const feeOf = await context.getRelayFeeQuote(chainId, best.quote.token, DISPLAY_QUOTE_TTL_MS)
        const feeFor = (calls: ReturnType<typeof uniswapSwapCalls>): bigint => {
          const policed = withAllowancePolicy(chainId, calls)
          return feeOf('operate', false, BigInt(policed.length), declaredCallGas(policed), dynamicCalldataBytes(policed.map(call => call.callData)))
        }
        if (target === null || target.chainId === chainId) return { amount: sold, target, quote: best.quote, price: best.price, fee: feeFor(swapCalls), bridge: null }
        const lane = {
          chainId,
          destinationChainId: BigInt(target.chainId),
          inputToken: best.quote.token,
          outputToken: target.id,
          timing: await context.getAcrossTiming(chainId)
        }
        const whole = await quoteAcrossDeposit(clientDeps.swapEndpoints.across, account, { ...lane, inputAmount: floor })
        const fee = feeFor([
          ...swapCalls,
          ...acrossBridgeCalls(chainId, account, best.quote.token, {
            inputAmount: floor,
            destinationChainId: target.chainId,
            outputToken: target.id,
            outputAmount: whole.outputAmount,
            route: whole.route,
            fillDeadline: whole.fillDeadline
          })
        ])
        if (fee >= floor) return { amount: sold, target, quote: best.quote, price: best.price, fee, bridge: null }
        const bridged = await quoteAcrossDeposit(clientDeps.swapEndpoints.across, account, { ...lane, inputAmount: floor - fee })
        return {
          amount: sold,
          target,
          quote: best.quote,
          price: best.price,
          fee,
          bridge: {
            leg: {
              inputAmount: floor - fee,
              destinationChainId: target.chainId,
              outputToken: target.id,
              outputAmount: bridged.outputAmount,
              route: bridged.route,
              fillDeadline: bridged.fillDeadline
            },
            limits: bridged.limits,
            isAmountTooLow: bridged.isAmountTooLow,
            etaSec: bridged.etaSec
          }
        }
      }
      const counterpart: IStream<ISwapTargetOption | null> = op(
        draft,
        take(1),
        switchMap((d): IStream<PromiseState<ISwapQuote | null>> => (d === null ? promiseState(just(quoteSwap(balance, null))) : empty)),
        filter(quoted => quoted.status !== PromiseStatus.PENDING),
        map(quoted => {
          if (quoted.status !== PromiseStatus.DONE || quoted.value === null) return null
          const pair = quoted.value.quote.token
          return options.find(o => o.chainId === chainId && isAddressEqual(o.id, pair)) ?? null
        }),
        until(merge(pickTarget, restored))
      )
      const picked: IStream<ISwapTargetOption | null> = state()(merge(pickTarget, restored, counterpart))
      const settled: IStream<bigint> = op(merge(commitAmount, op(amount, debounce(300))), skipRepeats)
      const swap: IStream<PromiseState<ISwapQuote | null>> = op(
        combine({ sold: settled, target: picked }),
        map(p => (p.sold === 0n ? Promise.resolve(null) : quoteSwap(p.sold, p.target))),
        promiseState,
        state()
      )
      const current: IStream<ISwapQuote | null> = map(
        p => (p.swap.status === PromiseStatus.DONE && p.swap.value !== null && p.swap.value.amount === p.amount && p.swap.value.target === p.target ? p.swap.value : null),
        combine({ amount, target: picked, swap })
      )
      const shown: IStream<ISwapTargetOption | null> = map(p => {
        if (p.target !== null) return p.target
        const quoted = p.current
        return quoted === null ? null : (options.find(o => o.chainId === chainId && isAddressEqual(o.id, quoted.quote.token)) ?? null)
      }, combine({ target: picked, current }))
      const alert: IStream<string | null> = op(
        combine({ amount, target: picked, swap }),
        map(p => {
          if (p.amount === 0n) return null
          if (p.amount > balance) return `Exceeds the ${readableTokenAmountLabel(profile, balance)} your fund holds`
          if (p.swap.status === PromiseStatus.ERROR) return `Quote unavailable: ${formatThrownError(p.swap.error)}`
          if (p.swap.status !== PromiseStatus.DONE) return null
          if (p.swap.value === null) {
            const into = p.target === null ? '' : ` into ${tokenKeyOf(p.target.chainId, p.target.id)}`
            return `No Uniswap v3 pool on ${chainName(chainId)} takes this much ${profile.symbol}${into}`
          }
          const { quote, price, fee, bridge } = p.swap.value
          if (quote.quoted === 0n) return `Too small: the Uniswap pool returns nothing for this much ${profile.symbol}`
          if (fee >= floorOf(quote.quoted)) return 'The swap returns less than its relay fee'
          if (bridge === null) return null
          const unit = getTokenDescription(chainId, quote.token)
          if (bridge.isAmountTooLow) return `Below bridge minimum ${readableTokenAmountLabel(unit, bridge.limits.minDeposit)}`
          if (bridge.leg.inputAmount > bridge.limits.maxDeposit) return `Exceeds bridge maximum ${readableTokenAmountLabel(unit, bridge.limits.maxDeposit)}`
          if (bridge.leg.inputAmount * price < CROSS_CHAIN_MIN_USD * 10n ** BigInt(USD_PRICE_DECIMALS)) return `Cross-chain moves start at $${CROSS_CHAIN_MIN_USD}`
          const kept = DEFAULT_EVALUATION_CONFIG.bridgeMaxSlippageBps
          if (bridge.leg.outputAmount * 10_000n < bridge.leg.inputAmount * (10_000n - kept)) return `Across keeps more than ${Number(kept) / 100}% of this amount`
          return null
        }),
        state(null)
      )
      const disabled: IStream<boolean> = op(
        combine({ amount, alert, current }),
        map(p => p.amount === 0n || p.alert !== null || p.current === null),
        state(true)
      )
      const listing: IStream<boolean> = start(false, selectingTarget)
      const $whileListed = $node(style({ display: 'contents' }), styleBehavior(map(open => (open ? { display: 'none' } : null), listing)))
      const valueOut = (q: ISwapQuote): bigint => (q.quote.averaged === null || q.quote.averaged > q.quote.quoted ? q.quote.quoted : q.quote.averaged)
      const optionOf = (q: ISwapQuote, fetching: boolean): IRouteOption => {
        const out = q.bridge === null ? getTokenDescription(chainId, q.quote.token) : getTokenDescription(q.bridge.leg.destinationChainId, q.bridge.leg.outputToken)
        const delivered = q.bridge === null ? q.quote.quoted : q.quote.quoted - (q.bridge.leg.inputAmount - q.bridge.leg.outputAmount)
        const eta = q.bridge === null ? blockTimeLabel(chainId) : etaLabel({ etaSec: q.bridge.etaSec, fillDeadline: q.bridge.leg.fillDeadline }, chainId, q.bridge.leg.destinationChainId)
        return {
          status: 'ok',
          label: `Uniswap ${q.quote.fee / 10_000}%${q.bridge === null ? '' : ' · Across'}`,
          fee: Promise.resolve(feeParts(usdNumber(valueOut(q), q.price), usdNumber(delivered, q.price), false)),
          minReceived: readableTokenAmountLabel(out, q.bridge === null ? floorOf(q.quote.quoted) - q.fee : q.bridge.leg.outputAmount),
          fetching,
          eta: eta.text,
          etaWarn: eta.warn
        }
      }
      const quoteOption: IStream<IRouteOption> = op(
        combine({ amount, target: picked, swap }),
        reduce(
          (last: IRouteOption, p: { amount: bigint; target: ISwapTargetOption | null; swap: PromiseState<ISwapQuote | null> }): IRouteOption => {
            if (p.amount === 0n) return { status: 'pending', label: '' }
            if (p.swap.status === PromiseStatus.PENDING) return last.status === 'ok' ? { ...last, fetching: true } : { status: 'pending', label: 'Uniswap' }
            if (p.swap.status === PromiseStatus.ERROR) return { status: 'error', label: 'Uniswap', detail: formatThrownError(p.swap.error) }
            if (p.swap.value === null) return { status: 'error', label: 'Uniswap', detail: `No Uniswap v3 pool on ${chainName(chainId)} quotes this much ${profile.symbol}` }
            return optionOf(p.swap.value, p.swap.value.amount !== p.amount || p.swap.value.target !== p.target)
          },
          { status: 'pending', label: '' } as IRouteOption
        )
      )
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $whileListed(
            $SourceAmountInput({
              locked: just(false),
              label: 'Swap',
              decimals: just(profile.decimals),
              amount,
              max: just(balance),
              alert,
              note: map(q => (q === null ? '-' : usdOf(valueOut(q), Promise.resolve(q.price))), current),
              listing
            })({ change: changeAmountTether(), enter: enterPressTether(), commit: commitAmountTether() })
          ),
          $DraftSave({
            target: { value: shown, optionList: just(options), source: just({ chainId, symbol: profile.symbol }) },
            request: just(null),
            quote: quoteOption,
            active: just(true),
            alert,
            disabled
          })({ select: pickTargetTether(), selecting: selectingTargetTether(), save: clickSaveTether() })
        ),
        {
          changeTradeDraft: op(
            sampleMap(q => q, current, submitOn(disabled, clickSave, enterPress)),
            filterNull,
            map(
              (q): ITradeDraft => ({
                kind: 'operateSwap',
                id: `operateSwap:${chainId}:${token}`,
                chainId,
                inputToken: token,
                outputToken: q.quote.token,
                poolFee: q.quote.fee,
                inputAmount: q.amount,
                outputAmount: q.quote.quoted,
                relayFee: q.fee,
                bridge: q.bridge === null ? null : q.bridge.leg
              })
            )
          )
        }
      ]
    }
  )
