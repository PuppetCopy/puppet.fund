import type { IFundSwapDraft, ITradeDraft } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { clientOf } from '@puppet/sdk/intent'
import { declaredCallGas, dynamicCalldataBytes, listedTokensOf } from '@puppet/sdk/state'
import { type IVenue, type IVenueDeposit, resolveOperate, screenOperate, withAllowancePolicy } from '@puppet/sdk/venue'
import { combine, combineMap, constant, empty, filter, fromIterable, type IStream, joinMap, just, map, merge, op, sampleMap, skipRepeats, start, switchLatest, take } from 'aelea/stream'
import { type IBehavior, promiseState, type PromiseState, type PromiseStateDone, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { uiStorage } from '@/ui-storage'
import { editorChoiceKey, type IChainAddress } from '../../app/localStoreSchema.js'
import { intermediateState, text } from '@/ui-components'
import { chainName } from '../../common/$chain.js'
import { clientDeps } from '../../io/clientDeps.js'
import context, { DISPLAY_QUOTE_TTL_MS } from '../../io/context.js'
import { priceFor } from '../../io/price.js'
import { $DraftSave } from './$DraftSave.js'
import { $FundSwapEditor } from './$FundSwapEditor.js'
import { $SourceAmountInput } from './$SourceAmountInput.js'
import { $TokenSelectFlow, type ITokenInputOption } from './$tokenOption.js'
import { amountUsdLabel, $editorFlowContainer, $intermediateEditor, submitOn } from './editorUtils.js'

interface ISource {
  chainId: ChainId
  token: Address
  fundBalance: bigint
}

export interface I$VenueDepositEditor {
  hideBalances: IStream<boolean>
  account: Address
  venue: IVenue
  deposit: IVenueDeposit
  sources: readonly ISource[]
}

export const $VenueDepositEditor = ({ hideBalances, account, venue, deposit, sources }: I$VenueDepositEditor) =>
  component(
    (
      [changeAmount, changeAmountTether]: IBehavior<bigint>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [pickSource, pickSourceTether]: IBehavior<ITokenInputOption, ISource>,
      [selecting, selectingTether]: IBehavior<boolean>,
      [swapSaved, swapSavedTether]: IBehavior<ITradeDraft>
    ) => {
      const token = getTokenDescription(deposit.chainId, deposit.token)
      const isVenueToken = (source: ISource): boolean => source.chainId === deposit.chainId && isAddressEqual(source.token, deposit.token)
      const held = sources.find(isVenueToken)
      const fundBalance = held === undefined ? 0n : held.fundBalance
      const direct: ISource = { chainId: deposit.chainId, token: deposit.token, fundBalance }
      const options: readonly ISource[] = [direct, ...sources.filter(source => !isVenueToken(source) && source.fundBalance > 0n)]
      const swapId = `${venue.venueId}:deposit:swap`
      const amount: IStream<bigint> = state(0n, changeAmount)
      const listing: IStream<boolean> = start(false, selecting)
      const feeQuote = op(just(context.getRelayFeeQuote(deposit.chainId, deposit.token, DISPLAY_QUOTE_TTL_MS)), promiseState, state())
      const sample = deposit.callsOf(account, deposit.min)
      const priced = withAllowancePolicy(deposit.chainId, sample)
      const venueCheck = resolveOperate(clientOf(clientDeps, deposit.chainId), deposit.chainId, sample, undefined).then(facts =>
        screenOperate({ chainId: deposit.chainId, callList: sample, account, registeredTokens: listedTokensOf(deposit.chainId), facts })
      )
      const fee: IStream<bigint | null> = map(
        q => (q.status === PromiseStatus.DONE ? q.value('operate', false, BigInt(priced.length), declaredCallGas(priced), dynamicCalldataBytes(priced.map(call => call.callData))) : null),
        feeQuote
      )
      const alert: IStream<string | null> = map(
        p => {
          if (p.q.status === PromiseStatus.ERROR) return `Relay fee unavailable: ${formatThrownError(p.q.error)}`
          if (p.amount === 0n) return null
          if (p.amount < deposit.min) return `${venue.name} takes deposits of at least ${readableTokenAmountLabel(token, deposit.min)}`
          if (p.fee !== null && p.amount + p.fee > fundBalance) return `Exceeds the ${readableTokenAmountLabel(token, fundBalance > p.fee ? fundBalance - p.fee : 0n)} your fund holds on ${chainName(deposit.chainId)} after the relay fee`
          return null
        },
        combine({ amount, fee, q: feeQuote })
      )
      const disabled: IStream<boolean> = map(p => p.alert !== null || p.amount === 0n || p.fee === null, combine({ alert, amount, fee }))
      const max: IStream<bigint> = map(f => (f === null || fundBalance <= f ? 0n : fundBalance - f), fee)
      const directDraft = sampleMap(
        (p): ITradeDraft => ({
          kind: 'operate',
          id: `${venue.venueId}:deposit`,
          chainId: deposit.chainId,
          feeToken: deposit.token,
          callList: deposit.callsOf(account, p.amount),
          sweepInto: p.amount === p.max ? venue.venueId : null,
          acceptedFee: null
        }),
        combine({ amount, max }),
        submitOn(disabled, clickSave, enterPress)
      )
      const sweepOf = (swap: IFundSwapDraft): ITradeDraft => ({
        kind: 'operate',
        id: `${venue.venueId}:deposit`,
        chainId: deposit.chainId,
        feeToken: deposit.token,
        callList: deposit.callsOf(account, swap.expectedOutput),
        sweepInto: venue.venueId,
        acceptedFee: null
      })
      const hiddenWhileListing = styleBehavior(map(shown => (shown ? { display: 'none' } : null), listing))
      const sourcePrices = options.map(source => ({ source, price: priceFor(source.chainId, source.token) }))
      const optionOf = (source: ISource): ITokenInputOption => {
        const description = getTokenDescription(source.chainId, source.token)
        return {
          symbol: description.symbol,
          chainId: source.chainId,
          address: source.token,
          token: source.token,
          balance: source.fundBalance,
          decimals: description.decimals,
          price: sourcePrices.find(each => each.source === source)?.price,
          caption: isVenueToken(source) ? `Straight into ${venue.name}` : `Swapped into ${token.symbol} on ${chainName(deposit.chainId)} first`
        }
      }
      const $sourceFrame =
        (source: IStream<ISource>) =>
        ($amount: I$Node): I$Node =>
          $TokenSelectFlow({
            hideBalances,
            selection: map(picked => ({ chainId: picked.chainId, address: picked.token }), source),
            value: map(optionOf, source),
            optionList: map(picked => options.map(option => ({ ...optionOf(option), selected: option === picked })), source),
            destinationChainId: deposit.chainId,
            listLabel: 'Select what to deposit',
            $balanceLead: empty,
            $container: $editorFlowContainer,
            $inputContent: $anchor => $node(style({ display: 'contents' }))($amount, $anchor)
          })({
            select: pickSourceTether(
              map(picked => {
                const found = options.find(option => option.chainId === picked.chainId && isAddressEqual(option.token, picked.address))
                if (found === undefined) throw new Error(`${picked.symbol} on chain ${picked.chainId} is not a fund holding`)
                return found
              })
            ),
            selecting: selectingTether()
          })
      const $direct = (source: IStream<ISource>): I$Node =>
        $column(spacing.default)(
          $SourceAmountInput({
            locked: just(false),
            label: 'Deposit',
            decimals: just(token.decimals),
            amount,
            max,
            alert,
            note: amountUsdLabel(amount, priceFor(deposit.chainId, deposit.token)),
            $frame: $sourceFrame(source),
            listing
          })({ change: changeAmountTether(), enter: enterPressTether() }),
          $node(style({ display: 'contents' }), hiddenWhileListing)(
            $DraftSave({ target: null, request: just(null), active: just(false), alert, disabled })({ save: clickSaveTether() })
          )
        )
      const floor: IStream<PromiseState<{ amount: bigint; reason: string }>> = op(
        combine({ q: feeQuote, fee }),
        map((p): PromiseState<{ amount: bigint; reason: string }> => {
          if (p.q.status === PromiseStatus.ERROR) return p.q
          if (p.fee === null) return { status: PromiseStatus.PENDING }
          return {
            status: PromiseStatus.DONE,
            value: {
              amount: deposit.min + p.fee,
              reason: `${venue.name} takes deposits of at least ${readableTokenAmountLabel(token, deposit.min)}, so this route must deliver at least ${readableTokenAmountLabel(token, deposit.min + p.fee)} to also cover the ${readableTokenAmountLabel(token, p.fee)} deposit fee`
            }
          }
        }),
        state()
      )
      const $swap = (source: IStream<ISource>, picked: ISource): I$Node =>
        $column(spacing.small)(
          $FundSwapEditor({
            account,
            chainId: picked.chainId,
            token: picked.token,
            fundBalance: picked.fundBalance,
            draft: just(null),
            preset: { destinationChainId: deposit.chainId, outputToken: deposit.token, amount: 0n, locked: true },
            floor,
            $frame: $sourceFrame(source),
            listing
          })({ changeTradeDraft: swapSavedTether() }),
          $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }), hiddenWhileListing)(
            $text(`Then all the ${token.symbol} that arrives on ${chainName(deposit.chainId)} goes into ${venue.name}.`)
          ),
          $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }), hiddenWhileListing)(
            $text(
              map(
                f =>
                  f.status === PromiseStatus.DONE
                    ? `${venue.name} takes at least ${readableTokenAmountLabel(token, deposit.min)}, plus the ${readableTokenAmountLabel(token, f.value.amount - deposit.min)} deposit fee.`
                    : `${venue.name} takes at least ${readableTokenAmountLabel(token, deposit.min)}, plus its deposit fee.`,
                floor
              )
            )
          )
        )
      const storedSource: IStream<ISource> = op(
        uiStorage.replayWrite<IChainAddress | null>(
          editorChoiceKey(account, `venueDepositSource:${venue.venueId}`), null,
          map(picked => ({ chainId: picked.chainId, address: picked.token }), pickSource)
        ),
        map(stored => (stored === null ? undefined : options.find(option => option.chainId === stored.chainId && isAddressEqual(option.token, stored.address)))),
        filter((option): option is ISource => option !== undefined)
      )
      const $editorOf = (first: ISource): I$Node => {
        const source = state(first, merge(pickSource, storedSource))
        return switchLatest(map(picked => (isVenueToken(picked) ? $direct(source) : $swap(source, picked)), source))
      }
      const $editor =
        options.length === 1 || fundBalance >= deposit.min
          ? $editorOf(direct)
          : switchLatest(
              op(
                combineMap((...ats: Promise<bigint | null>[]) => Promise.allSettled(ats), ...sourcePrices.slice(1).map(each => each.price)),
                intermediateState,
                filter((s): s is PromiseStateDone<PromiseSettledResult<bigint | null>[]> => s.status === PromiseStatus.DONE),
                take(1),
                map(s => {
                  const valued = sourcePrices.slice(1).map((each, i) => {
                    const at = s.value[i]!
                    return { source: each.source, usd: at.status === 'fulfilled' && at.value !== null ? each.source.fundBalance * at.value : null }
                  })
                  const best = valued.reduce((top, each) => (each.usd !== null && (top.usd === null || each.usd > top.usd) ? each : top))
                  return $editorOf(best.source)
                }),
                start($intermediateEditor)
              )
            )
      const refusal: IStream<string | null> = op(
        just(venueCheck),
        promiseState,
        map(check =>
          check.status === PromiseStatus.ERROR
            ? `${venue.name} deposits could not be checked: ${formatThrownError(check.error)}`
            : check.status === PromiseStatus.DONE && check.value !== null && !check.value.ok
              ? check.value.reasons[0]!.detail
              : null
        ),
        skipRepeats
      )
      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          switchLatest(map(detail => (detail === null ? $editor : $node(style({ fontSize: text.sm, lineHeight: '1.4', color: palette.negative }))($text(detail))), refusal))
        ),
        {
          changeTradeDraft: merge(
            directDraft,
            op(
              swapSaved,
              filter((draft): draft is IFundSwapDraft => draft.kind === 'fundSwap'),
              joinMap(swap => fromIterable<ITradeDraft>([{ ...swap, id: swapId }, sweepOf(swap)]))
            )
          ),
          releaseDraft: constant(swapId, directDraft)
        }
      ]
    }
  )
