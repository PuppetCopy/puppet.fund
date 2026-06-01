import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { symbolForBaseTokenId } from '@puppet/sdk/account'
import { computeAllocation } from '@puppet/sdk/attestation'
import { ADDRESS_ZERO, CHAIN_LIST, type ChainId } from '@puppet/sdk/const'
import {
  getMappedValueFallback,
  readableAddress,
  readableTokenAmount,
  readableTokenAmountLabel
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  getPuppetRedeemPosition,
  type ISubaccountState,
  type ITokenRegistryMap,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  debounce,
  empty,
  filter,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  op,
  sampleMap,
  skipRepeatsWith,
  start,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $defaultPopoverContentContainer, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import {
  $ButtonSecondary,
  $DropSelect,
  $defaultDropdownContainer,
  $defaultDropSelectAnchor,
  $defaultMiniButtonSecondary,
  $defaultSliderContainer,
  $icon,
  $labeledValue,
  $noteTooltip,
  $Slider,
  $TokenAmountInput,
  $tokenIconMap,
  $unknown,
  $wallet,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { $route } from '../../common/$common.js'
import { fetchTokenBalances } from '../../io/chain/balances.js'
import * as context from '../../io/context.js'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../io/indexer/query.js'
import { sqlClient } from '../../io/indexer/sql.js'
import type { IConnectedWallet } from '../../wallet/index.js'
import { $FulfillEditor } from './$FulfillEditor.js'
import { $RedeemEditor } from './$RedeemEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  ICreateMasterDraft,
  IFulfillDraft,
  IMasterFundStep,
  ISellDraft
} from './draft.js'
import { DEFAULT_DEADLINE_SEC, walletClientForChain } from './runner/_shared.js'

interface ITokenInputOption {
  symbol: string
  chainId: number
  address: Address
  balance: bigint | null
  decimals: number
  usdValue?: IStream<string>
}

const $tokenIconBySymbol = (sym: string, size = '28px'): I$Node =>
  $icon({
    $content: getMappedValueFallback($tokenIconMap, sym, $unknown),
    size,
    fill: palette.message,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })

const $optionRow = (opt: ITokenInputOption): I$Node => {
  const balanceText = opt.balance && opt.balance > 0n ? readableTokenAmount(opt.decimals, opt.balance) : '-'
  return $row(
    spacing.default,
    style({
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
      padding: '8px',
      minWidth: '280px',
      gap: '16px'
    })
  )(
    $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
      $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '40px'), opt.chainId, 40, 18),
      $column(style({ gap: '1px', minWidth: '0' }))(
        $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
        $node(style({ fontSize: text.xs, color: palette.foreground }))($text(chainName(opt.chainId)))
      )
    ),
    $column(style({ alignItems: 'flex-end', gap: '1px' }))(
      $node(style({ fontWeight: '600', fontSize: text.sm, color: palette.message }))(
        $text(opt.usdValue ?? balanceText)
      ),
      opt.usdValue ? $node(style({ color: palette.foreground, fontSize: text.xs }))($text(balanceText)) : $node()
    )
  )
}

export interface I$MasterAccountEditor {
  account: IStream<ISubaccountState>
  walletAccount: IConnectedWallet
  tokenRegistry: ITokenRegistryMap
  activeMaster: IStream<Address | null>
}

export const $MasterAccountEditor = ({ account, walletAccount, tokenRegistry, activeMaster }: I$MasterAccountEditor) =>
  component(
    (
      [popEditor, popEditorTether]: IBehavior<PointerEvent, 'allocate' | 'redeem' | 'fulfill'>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>,
      [selectOption, selectOptionTether]: IBehavior<ITokenInputOption>
    ) => {
      const selectSource: IStream<number> = op(
        selectOption,
        map(opt => {
          void walletClientForChain(walletAccount.walletClient, opt.chainId).catch(err =>
            console.error('[master fund] wallet chain switch failed', err)
          )
          return opt.chainId
        })
      )
      const sourceChainId: IStream<number> = state(HUB_CHAIN_ID, selectSource)

      const balanceQuery = op(
        account,
        map(a => a.baseTokenId),
        skipRepeatsWith((a, b) => a === b),
        switchMap(bid =>
          fromPromise(
            fetchTokenBalances(
              walletAccount.address,
              CHAIN_LIST.flatMap(chain => {
                const ercAddr = tokenRegistry.get(chain.id as ChainId)?.get(bid)?.token
                return ercAddr ? [{ chainId: chain.id, tokenAddress: ercAddr }] : []
              }),
              walletAccount.walletClient
            )
          )
        ),
        state()
      )

      const balanceValue: IStream<bigint> = op(
        combine({ list: balanceQuery, chainId: sourceChainId, acc: account }),
        map(p => {
          const token = tokenInfoFor(tokenRegistry, p.chainId as ChainId, p.acc.baseTokenId).token
          return p.list.find(b => b.chainId === p.chainId && b.tokenAddress === token)?.balance ?? 0n
        }),
        state(0n)
      )
      const masterBalance: IStream<bigint> = op(
        account,
        map(acc => acc.chains.get(HUB_CHAIN_ID)?.signedBalance ?? 0n),
        state()
      )
      const sliderAmount: IStream<bigint> = sampleMap(
        (bal, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          return (bal * bp) / 10000n
        },
        balanceValue,
        sliderPercent
      )
      const maxAmount: IStream<bigint> = sampleMap(bal => bal, balanceValue, clickMax)
      const value: IStream<bigint> = op(merge(inputAmount, sliderAmount, maxAmount), state(0n))
      const settledValue: IStream<bigint> = debounce(160, value)

      const canSubmit: IStream<boolean> = map(
        p => p.value > 0n && p.value <= p.balance,
        combine({ value, balance: balanceValue })
      )
      const enterSubmit: IStream<unknown> = op(
        sampleMap((can, _evt) => can, canSubmit, enterPress),
        filter(Boolean)
      )

      const buildFundSteps = (
        acc: ISubaccountState,
        amount: bigint,
        srcChain: number,
        walletBalance: bigint
      ): IMasterFundStep[] => {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
        const params = { user: acc.user, name: acc.name, baseTokenId: acc.baseTokenId, signer: acc.signer }
        const transfer: IMasterFundStep = {
          kind: 'transferToMaster',
          input: { chainId: srcChain, master: acc.account, baseTokenId: acc.baseTokenId, amount, walletBalance }
        }
        if (srcChain === HUB_CHAIN_ID) return [transfer]
        const steps: IMasterFundStep[] = [transfer]
        if (!acc.chains.has(srcChain)) {
          steps.push({
            kind: 'createMasterAccount',
            input: {
              params,
              blockNumber: 0n,
              deadline,
              acceptableRelayFee: 0n,
              nonce: randomNonce(),
              chainId: BigInt(srcChain),
              initialDepositAmount: 0n,
              userDeploySig: '0x',
              userSignerProof: '0x'
            }
          })
        }
        steps.push({
          kind: 'bridge',
          input: {
            params,
            blockNumber: 0n,
            deadline,
            acceptableRelayFee: 0n,
            nonce: randomNonce(),
            chainId: BigInt(srcChain),
            fromTransientRoute: true,
            inputAmount: amount,
            destinationChainId: BigInt(HUB_CHAIN_ID),
            exclusiveRelayer: ADDRESS_ZERO,
            quoteTimestamp: 0,
            fillDeadline: 0,
            exclusivityDeadline: 0,
            outputAmount: 0n
          }
        })
        return steps
      }

      const changeDraft: IStream<IAllocateDraft | ICreateMasterDraft> = sampleMap(
        (params): IAllocateDraft | ICreateMasterDraft => {
          const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, params.acc.baseTokenId).token
          const master = params.acc.account
          const inputSteps = buildFundSteps(params.acc, params.amount, params.srcChain, params.balance)
          if (params.acc.lastEventBlock > 0n) {
            return {
              kind: 'allocate',
              id: `allocate:${master}`,
              account: master,
              title: 'Allocate',
              alert: null,
              master,
              baseToken,
              baseTokenId: params.acc.baseTokenId,
              masterAmount: params.amount,
              sourceChainId: params.srcChain,
              inputSteps
            }
          }
          return {
            kind: 'createMaster',
            id: `createMaster:${master}`,
            account: master,
            title: 'Create master account',
            alert: null,
            params: {
              user: params.acc.user,
              name: params.acc.name,
              baseTokenId: params.acc.baseTokenId,
              signer: params.acc.signer
            },
            master,
            baseToken,
            baseTokenId: params.acc.baseTokenId,
            masterAmount: params.amount,
            sourceChainId: params.srcChain,
            inputSteps
          }
        },
        combine({ acc: account, amount: value, srcChain: sourceChainId, balance: balanceValue }),
        merge(clickSave, enterSubmit)
      )

      const accountIdentity: IStream<ISubaccountState> = skipRepeatsWith(
        (a, b) => a.account === b.account && a.baseTokenId === b.baseTokenId,
        account
      )

      return [
        switchMap((initial: ISubaccountState) => {
          const baseToken = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, initial.baseTokenId).token
          const desc = getTokenDescription(baseToken)
          const masterAccount = initial.account
          const deployed = initial.lastEventBlock > 0n
          const tokenPrice = priceFor(baseToken)
          const symbol = symbolForBaseTokenId(initial.baseTokenId) ?? desc.symbol

          type SourceRef = { chainId: number; address: Address; symbol: string }
          const sources: SourceRef[] = CHAIN_LIST.flatMap(chain => {
            const ercAddr = tokenRegistry.get(chain.id as ChainId)?.get(initial.baseTokenId)?.token
            return ercAddr ? [{ chainId: chain.id, address: ercAddr, symbol }] : []
          })
          const usdText = (balance: bigint | null): IStream<string> =>
            balance === null ? just('-') : map(price => formatUsd(balance, price), tokenPrice)
          const toOption = (src: SourceRef, balance: bigint | null): ITokenInputOption => ({
            symbol: src.symbol,
            chainId: src.chainId,
            address: src.address,
            balance,
            decimals: desc.decimals,
            usdValue: usdText(balance)
          })
          const sourceSelection: IStream<SourceRef> = map(
            cid => sources.find(s => s.chainId === cid) ?? sources[0],
            sourceChainId
          )
          const selectedOption: IStream<ITokenInputOption> = map(
            p =>
              toOption(
                p.sel,
                p.list.find(b => b.chainId === p.sel.chainId && b.tokenAddress === p.sel.address)?.balance ?? null
              ),
            combine({ sel: sourceSelection, list: balanceQuery })
          )
          const optionList: IStream<readonly ITokenInputOption[]> = map(
            p =>
              sources
                .filter(s => s.chainId !== p.sel.chainId)
                .map(s =>
                  toOption(
                    s,
                    p.list.find(b => b.chainId === s.chainId && b.tokenAddress === s.address)?.balance ?? null
                  )
                ),
            combine({ sel: sourceSelection, list: balanceQuery })
          )

          const amountUsd: IStream<string> = map(
            p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)),
            combine({ amt: value, price: tokenPrice })
          )
          const relayFeeText: IStream<string> = map(
            p => formatUsd((deployed ? p.fm.allocate : p.fm.createMaster).relayFee, p.price),
            combine({ fm: context.relayFeeMapForToken(initial.baseTokenId), price: tokenPrice })
          )
          const $allocated = $row(spacing.default, style({ alignItems: 'center' }))(
            $route(desc, true),
            $column(style({ gap: '1px', alignItems: 'flex-start' }))(
              $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))(
                $text(map(p => formatUsd(p.bal, p.price), combine({ bal: masterBalance, price: tokenPrice })))
              ),
              $node(style({ color: palette.foreground, fontSize: text.xs }))(
                $text(map(bal => readableTokenAmount(desc, bal), masterBalance))
              )
            )
          )

          const data = Promise.all([fetchMasterSubscribers(masterAccount), fetchMasterPoolState(masterAccount)])

          const focused: IStream<boolean> = state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

          const emptyMatched = {
            puppetList: [] as Address[],
            bodyList: [] as Hex[],
            mandateList: [] as Hex[],
            matchedAmountList: [] as bigint[],
            totalMatched: 0n
          }
          const projection = op(
            settledValue,
            switchMap(async masterAmount => {
              try {
                const [puppets, pool] = await data
                const totalShareSupply = pool?.totalShareSupply ?? 0n
                const queuedShares = pool?.queuedShares ?? 0n
                const nav = totalShareSupply > 0n ? totalShareSupply : masterAmount > 0n ? masterAmount : 1n
                const matched = computeAllocation({
                  masterAmount,
                  acceptableNetAssetValue: nav,
                  totalShareSupply,
                  queuedShares,
                  now: Math.floor(Date.now() / 1000),
                  puppets
                })
                return { masterAmount, matched, totalPuppets: puppets.length }
              } catch (err) {
                console.error('allocation projection failed', err)
                return { masterAmount, matched: emptyMatched, totalPuppets: 0 }
              }
            }),
            state()
          )

          const alert: IStream<string | null> = op(
            combine({ value, balance: balanceValue }),
            map(p => {
              if (p.value === 0n) return null
              if (p.value > p.balance) return `Exceeds available ${readableTokenAmountLabel(desc, p.balance)}`
              return null
            }),
            state(null)
          )

          const disabled: IStream<boolean> = op(
            combine({ alert, value }),
            map(p => p.alert !== null || p.value === 0n),
            state(true)
          )

          const valueToShow: IStream<string> = map(
            (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(desc.decimals, p.amt)),
            filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: value, focused }))
          )

          const sliderValue: IStream<number> = map(
            p => (p.bal > 0n ? Number((p.amt * 10000n) / p.bal) / 10000 : 0),
            combine({ amt: value, bal: balanceValue })
          )
          const sliderDisabled: IStream<boolean> = map(b => b === 0n, balanceValue)
          const hasError: IStream<boolean> = map(a => a !== null, alert)

          const $field = $TokenAmountInput({ decimals: desc.decimals, valueToShow })({
            inputAmount: inputAmountTether(),
            focus: focusEvtTether(),
            blur: blurEvtTether(),
            enter: enterPressTether()
          })

          const $maxButton = switchMap(
            p => {
              if (p.amt !== 0n) return empty
              const ready = p.bal > 0n
              return $element('button')(
                attr({ type: 'button', disabled: ready ? null : 'true' }),
                style({
                  background: 'transparent',
                  border: `1px solid ${colorShade(palette.foreground, 25)}`,
                  borderRadius: '8px',
                  padding: '2px 8px',
                  fontSize: text.xs,
                  fontWeight: '600',
                  color: palette.foreground,
                  cursor: ready ? 'pointer' : 'not-allowed',
                  opacity: ready ? '1' : '0.4',
                  alignSelf: 'center',
                  flexShrink: '0'
                }),
                clickMaxTether(nodeEvent('click'))
              )($text('Max'))
            },
            combine({ amt: value, bal: balanceValue })
          )

          const $percentSlider = $Slider({
            value: sliderValue,
            step: 0.01,
            orientation: 'horizontal',
            ariaLabel: 'Allocation percentage',
            disabled: sliderDisabled,
            error: hasError,
            motion: { stiffness: 800, damping: 58 },
            $container: $defaultSliderContainer(
              style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
            )
          })({ change: sliderPercentTether() })

          const $alertSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))(
            switchMap(
              p =>
                p.msg
                  ? $noteTooltip($text(p.msg))
                  : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
              combine({ msg: alert, usd: start('', amountUsd) })
            )
          )

          const $picker = $DropSelect({
            $container: $defaultDropdownContainer(
              style({ alignItems: 'flex-end', minWidth: '160px', flexShrink: '0' })
            ),
            $anchor: $defaultDropSelectAnchor(
              stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 40) })
            ),
            value: selectedOption,
            optionList,
            $valueLabel: map((opt: ITokenInputOption) =>
              $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '32px'), opt.chainId, 32, 14),
                $column(style({ gap: '1px', minWidth: '0' }))(
                  $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
                  $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                    $icon({
                      $content: $wallet,
                      viewBox: '0 0 32 32',
                      fill: palette.foreground,
                      size: '12px',
                      svgOps: style({ display: 'block' })
                    }),
                    $text(opt.usdValue ?? (opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance)))
                  )
                )
              )
            ),
            $$option: map((opt: ITokenInputOption) => $optionRow(opt)),
            $optionContainer: $node(
              style({ cursor: 'pointer', padding: '4px 6px', borderRadius: '10px', display: 'block' }),
              stylePseudo(':hover', { backgroundColor: palette.horizon })
            ),
            $dropListContainer: $column(
              style({
                background: palette.background,
                border: `1px solid ${colorShade(palette.foreground, 60)}`,
                borderRadius: '14px',
                padding: '6px',
                gap: '2px',
                boxShadow: `0 8px 24px ${palette.shadow}`,
                minWidth: '260px'
              })
            )
          })({ select: selectOptionTether() })

          const $projectionRows = switchMap(p => {
            const matchedTotal = p.matched.totalMatched
            const $puppetRows = p.matched.puppetList.map((puppet, i) =>
              $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
                $node(style({ color: palette.foreground, fontFamily: 'monospace' }))($text(readableAddress(puppet))),
                $node(style({ flex: 1 }))(),
                $node(style({ color: palette.message }))(
                  $text(readableTokenAmount(desc, p.matched.matchedAmountList[i] ?? 0n))
                )
              )
            )
            return $column(spacing.small)(
              $labeledValue(
                `Matched (${p.matched.puppetList.length} / ${p.totalPuppets} puppets)`,
                $text(readableTokenAmount(desc, matchedTotal))
              ),
              ...$puppetRows,
              $labeledValue('Relay fee', $text(start('-', relayFeeText))),
              $node(style({ height: '1px', background: palette.horizon, margin: '4px 0' }))(),
              $row(spacing.small, style({ alignItems: 'center', fontWeight: '600' }))(
                $node(style({ fontSize: text.sm, color: palette.message }))($text('Total pool funding')),
                $node(style({ flex: 1 }))(),
                $node(style({ fontSize: text.sm, color: palette.message }))(
                  $text(readableTokenAmount(desc, p.masterAmount + matchedTotal))
                )
              )
            )
          }, projection)

          const $editor = $column(spacing.default, style({ minWidth: '380px' }))(
            $row(
              style({
                padding: '18px 28px',
                borderRadius: '22px 22px 0 0',
                background: palette.background,
                margin: '-28px -28px 0px',
                gap: '12px',
                alignItems: 'center'
              })
            )(
              $element('label')(
                style({
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'text',
                  flex: '1',
                  minWidth: '0',
                  gap: '4px'
                })
              )(
                $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))($text('Fund')),
                $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
                $alertSlot
              ),
              $picker
            ),
            $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
            $projectionRows,
            $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ flex: 1 }))(),
              $ButtonSecondary({ disabled, $content: $text('Save') })({ click: clickSaveTether() })
            )
          )

          const $redeemEditor = $RedeemEditor({
            puppet: masterAccount,
            masterAccount,
            baseToken,
            baseTokenId: initial.baseTokenId,
            tokenRegistry
          })({ changeDraft: changeRedeemDraftTether() })

          const $fulfillEditor = $FulfillEditor({
            master: masterAccount,
            masterAccount,
            account,
            baseToken,
            baseTokenId: initial.baseTokenId,
            tokenRegistry
          })({ changeDraft: changeFulfillDraftTether() })

          const redeemDisabled: IStream<boolean> = op(
            fromPromise(getPuppetRedeemPosition(sqlClient, masterAccount, masterAccount)),
            map(p => p.sharesHeld === 0n && computeClaimable(p) === 0n),
            state(true)
          )
          const fulfillDisabled: IStream<boolean> = op(
            fromPromise(data.then(([, pool]) => (pool?.queuedShares ?? 0n) === 0n)),
            state(true)
          )

          const fulfillButtonDisabled: IStream<boolean> = map(
            p => p.disabled || p.active !== masterAccount,
            combine({ disabled: fulfillDisabled, active: activeMaster })
          )
          const $fulfillSlot = $ButtonSecondary({
            $container: $defaultMiniButtonSecondary,
            disabled: fulfillButtonDisabled,
            $content: $text('Fulfill')
          })({ click: popEditorTether(constant('fulfill')) })

          return $Popover({
            $contentContainer: $defaultPopoverContentContainer(style({ width: '450px' })),
            dismiss: merge(changeDraft, changeRedeemDraft, changeFulfillDraft),
            $target: $row(spacing.default, style({ padding: '4px', borderRadius: '4px', alignItems: 'center' }))(
              $allocated,
              $row(spacing.small, style({ alignItems: 'center' }))(
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $text('Fund')
                })({ click: popEditorTether(constant('allocate')) }),
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  disabled: redeemDisabled,
                  $content: $text('Sell')
                })({ click: popEditorTether(constant('redeem')) }),
                $fulfillSlot
              )
            ),
            $open: map(
              which => (which === 'allocate' ? $editor : which === 'redeem' ? $redeemEditor : $fulfillEditor),
              popEditor
            )
          })({})
        }, accountIdentity),
        { changeDraft, changeRedeemDraft, changeFulfillDraft }
      ]
    }
  )
