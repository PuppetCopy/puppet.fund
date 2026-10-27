import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeAbiParameters, decodeFunctionData, getAddress, type Hex, isAddress, isAddressEqual, isHex, size, slice, stringToHex, toFunctionSelector, zeroAddress, zeroHash } from 'viem'
import { readContract } from 'viem/actions'
import type { ChainId } from '../../const/index.js'
import { CompactError } from '../../compact/error.js'
import { readableAddress } from '../../core/format.js'
import { readTokenProfiles } from '../../core/token.js'
import { readableContractName, readableUsd } from '../../core/readable.js'
import { tokenMetaByChainToken, tokenMetaKey } from '../../state/tokenRegistry.js'
import { isRegisteredToken } from '../erc20.js'
import type { IDappScreenReason, IGuardReason, IOperateStep, IScreenContext, IVenue, IVenueFacts } from '../types.js'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_ADMITTED_ORDER_TYPES, GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_MAX_SWAP_PATH_LENGTH, GMX_ONE_CLICK_MESSAGE, GMX_ORDER_CUSTODY_TYPES, GMX_ORDER_TYPE, GMX_ORDER_VAULT, GMX_REFERRAL_CODE, GMX_REFERRAL_STORAGE, GMX_REFERRAL_STORAGE_ABI, GMX_RELAY_DOMAIN_NAME, GMX_RELAY_ROUTER, GMX_ROUTER, GMX_SUBACCOUNT_APPROVAL_TYPES, GMX_SUBACCOUNT_ORDER_ACTION, GMX_SUBACCOUNT_RELAY_ROUTER, GMX_SWAP_TYPES, GMX_TOKEN_SPENDER, GMX_UI_FEE_RECEIVER, GMX_V2_CHAIN_ID, GMX_WNT } from './contracts.js'
import { gmxOutflows, routerApproval, traceSwapPathOutput, unwrapRouterCalls } from './decode.js'
import { gmxPositions } from './evaluate.js'
import { readGmxMarkets } from './market.js'
import { resolveGmxOneClickApproval } from './oneClick.js'
import { gmxOrderOutcome } from './outcome.js'

const PLATFORM = 'gmx'
const MULTICALL_SELECTOR = '0xac9650d8'
const BYTES_LIST_HEAD = '0x0000000000000000000000000000000000000000000000000000000000000020'

type ICreateOrderParams = {
  addresses: {
    receiver: Address
    cancellationReceiver: Address
    callbackContract: Address
    uiFeeReceiver: Address
    market: Address
    initialCollateralToken: Address
    swapPath: readonly Address[]
  }
  numbers: { sizeDeltaUsd: bigint; initialCollateralDeltaAmount: bigint; triggerPrice: bigint; acceptablePrice: bigint; executionFee: bigint }
  orderType: number
  decreasePositionSwapType: number
  isLong: boolean
  shouldUnwrapNativeToken: boolean
  referralCode: Hex
  dataList: readonly Hex[]
}

function screenCreateOrder(ctx: IScreenContext, order: ICreateOrderParams): IGuardReason[] {
  const reasons: IGuardReason[] = []
  const { addresses } = order
  const orderType = Number(order.orderType)
  const collateral = addresses.initialCollateralToken
  const swapPath = addresses.swapPath
  const arrives = (token: Address | undefined): boolean =>
    token !== undefined &&
    (isAddressEqual(token, GMX_WNT) ? isRegisteredToken(ctx, order.shouldUnwrapNativeToken ? PROTOCOL.nativeToken : GMX_WNT) : isRegisteredToken(ctx, token))
  const swapOutput = swapPath.length > 0 ? traceSwapPathOutput(ctx.facts.markets, collateral, swapPath) : undefined

  if (!GMX_ADMITTED_ORDER_TYPES.has(orderType)) {
    reasons.push({ code: 'ORDER_TYPE_FORBIDDEN', detail: `order type ${orderType} is not an admitted GMX order type` })
  }
  if (GMX_SWAP_TYPES.has(orderType)) {
    if (swapPath.length === 0) reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: 'a swap order carries no swap path, so nothing arrives' })
    else if (!arrives(swapOutput)) {
      reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: `swap output ${swapOutput ?? 'untraceable'} is not a registered token; it would arrive unvalued` })
    }
  } else {
    if (!ctx.facts.markets.has(getAddress(addresses.market))) {
      reasons.push({ code: 'UNKNOWN_MARKET', detail: `market ${addresses.market} is not a GMX market: the GMX Reader returns none for it` })
    }
    if (GMX_INCREASE_TYPES.has(orderType)) {
      const positionCollateral = swapPath.length > 0 ? swapOutput : collateral
      if (!arrives(positionCollateral)) {
        reasons.push({
          code: 'COLLATERAL_NOT_REGISTERED',
          detail: `position collateral ${positionCollateral ?? 'missing'} is not a registered token; it would come back unvalued`
        })
      }
    } else if (GMX_DECREASE_TYPES.has(orderType)) {
      const market = ctx.facts.markets.get(getAddress(addresses.market))
      const pnlToken = market === undefined ? undefined : order.isLong ? market.longToken : market.shortToken
      if (!arrives(collateral)) {
        reasons.push({ code: 'COLLATERAL_NOT_REGISTERED', detail: `collateral ${collateral} is not a registered token; it would come back unvalued` })
      }
      if (!arrives(pnlToken)) {
        reasons.push({
          code: 'PNL_TOKEN_NOT_REGISTERED',
          detail: `pnl token ${pnlToken ?? 'unknown'} of a ${order.isLong ? 'long' : 'short'} on ${addresses.market} is not a registered token; profit would arrive unvalued`
        })
      }
      if (swapPath.length > 0 && !arrives(swapOutput)) {
        reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: `swap output ${swapOutput ?? 'untraceable'} is not a registered token; it would arrive unvalued` })
      }
    }
  }
  if (!isAddressEqual(addresses.receiver, ctx.account)) {
    reasons.push({ code: 'RECEIVER_NOT_ACCOUNT', detail: `receiver ${addresses.receiver} must equal the account ${ctx.account}` })
  }
  if (!isAddressEqual(addresses.cancellationReceiver, zeroAddress) && !isAddressEqual(addresses.cancellationReceiver, ctx.account)) {
    reasons.push({ code: 'CANCEL_RECEIVER_NOT_ACCOUNT', detail: `cancellationReceiver ${addresses.cancellationReceiver} must be zero or the account ${ctx.account}` })
  }
  if (!isAddressEqual(addresses.callbackContract, zeroAddress)) {
    reasons.push({ code: 'CALLBACK_FORBIDDEN', detail: `callbackContract ${addresses.callbackContract} must be zero` })
  }
  if (!isAddressEqual(addresses.uiFeeReceiver, zeroAddress) && !isAddressEqual(addresses.uiFeeReceiver, GMX_UI_FEE_RECEIVER)) {
    reasons.push({ code: 'UI_FEE_FORBIDDEN', detail: `uiFeeReceiver ${addresses.uiFeeReceiver} must be zero or the GMX UI marker ${GMX_UI_FEE_RECEIVER}` })
  }
  if (swapPath.length > GMX_MAX_SWAP_PATH_LENGTH) {
    reasons.push({ code: 'SWAPPATH_TOO_LONG', detail: `swapPath length ${swapPath.length} exceeds ${GMX_MAX_SWAP_PATH_LENGTH}` })
  }
  for (const hop of swapPath) {
    if (!ctx.facts.markets.has(getAddress(hop))) {
      reasons.push({ code: 'SWAPPATH_UNKNOWN_MARKET', detail: `swapPath hop ${hop} is not a GMX market: the GMX Reader returns none for it` })
    }
  }
  if (order.referralCode.toLowerCase() !== GMX_REFERRAL_CODE.toLowerCase()) {
    reasons.push({
      code: 'REFERRAL_CODE_FORBIDDEN',
      detail: `referralCode ${order.referralCode} must be the protocol code ${GMX_REFERRAL_CODE}; any other code routes affiliate rebates on the account's fees elsewhere`
    })
  }
  if (order.dataList.length > 0) {
    reasons.push({
      code: 'DATALIST_FORBIDDEN',
      detail: `dataList carries ${order.dataList.length} entries; GMX defines it as follow-up actions on the output, such as bridging it to another chain, and an account order needs none`
    })
  }
  return reasons
}

function screenRouterCall(ctx: IScreenContext, call: IIAccount__Call): IGuardReason[] {
  const reasons: IGuardReason[] = []
  const inner = unwrapRouterCalls(call.callData)
  if (!inner) return [{ code: 'UNDECODABLE_ROUTER_CALL', detail: 'GMX router call not decodable' }]
  const wnt = getAddress(GMX_WNT)
  const unrecorded = new Map<Address, bigint>()
  let sendWntTotal = 0n
  for (const dec of inner) {
    if (dec.functionName === 'createOrder') {
      const order = dec.args[0] as ICreateOrderParams
      reasons.push(...screenCreateOrder(ctx, order))
      if (GMX_ORDER_CUSTODY_TYPES.has(Number(order.orderType))) unrecorded.delete(getAddress(order.addresses.initialCollateralToken))
      unrecorded.delete(wnt)
    } else if (dec.functionName === 'updateOrder') {
      unrecorded.delete(wnt)
    } else if (dec.functionName === 'sendTokens') {
      const [token, receiver, amount] = dec.args as readonly [Address, Address, bigint]
      if (!isAddressEqual(receiver, GMX_ORDER_VAULT)) {
        reasons.push({ code: 'SENDTOKENS_BAD_RECEIVER', detail: `sendTokens receiver ${receiver} must be the GMX OrderVault` })
      }
      if (!isRegisteredToken(ctx, token)) {
        reasons.push({ code: 'SENDTOKENS_NOT_BASE', detail: `sendTokens token ${token} must be a registered token` })
      }
      unrecorded.set(getAddress(token), (unrecorded.get(getAddress(token)) ?? 0n) + amount)
    } else if (dec.functionName === 'sendWnt') {
      const [receiver, amount] = dec.args as readonly [Address, bigint]
      if (!isAddressEqual(receiver, GMX_ORDER_VAULT)) {
        reasons.push({ code: 'SENDWNT_BAD_RECEIVER', detail: `sendWnt receiver ${receiver} must be the GMX OrderVault` })
      }
      sendWntTotal += amount
      unrecorded.set(wnt, (unrecorded.get(wnt) ?? 0n) + amount)
    } else if (dec.functionName === 'cancelOrder') {
      if (unrecorded.size > 0) {
        reasons.push({
          code: 'TRANSFER_UNRECORDED',
          detail: `cancelOrder pays out of the OrderVault and books its unrecorded balance as the vault's own, while ${[...unrecorded.keys()].join(', ')} sent to it still awaits the order that records it`
        })
      }
    } else if (dec.functionName === 'claimFundingFees' || dec.functionName === 'claimCollateral') {
      const receiver = dec.args[dec.args.length - 1] as Address
      if (!isAddressEqual(receiver, ctx.account)) {
        reasons.push({ code: 'CLAIM_BAD_RECEIVER', detail: `${dec.functionName} receiver ${receiver} must be the account ${ctx.account}` })
      }
    } else {
      reasons.push({ code: 'ROUTER_FN_FORBIDDEN', detail: `GMX router fn "${dec.functionName}" not allowed` })
    }
  }
  for (const [token, amount] of unrecorded) {
    reasons.push({
      code: 'TRANSFER_UNRECORDED',
      detail: `${amount} of ${token} sent to the OrderVault is recorded by no later order of the account in this router call; the next GMX order in that token, from anyone, would take it`
    })
  }
  if (call.value !== sendWntTotal) {
    reasons.push({ code: 'NATIVE_VALUE_MISMATCH', detail: `router call value ${call.value} must equal the sendWnt total ${sendWntTotal} forwarded to the OrderVault` })
  }
  return reasons
}

const SET_REFERRAL_CODE = toFunctionSelector('setTraderReferralCodeByUser(bytes32)')

function screenReferralBinding(call: IIAccount__Call): IGuardReason[] {
  const reasons: IGuardReason[] = call.value === 0n ? [] : [{ code: 'NATIVE_VALUE_FORBIDDEN', detail: `the GMX referral binding forwards native value ${call.value}` }]
  if (size(call.callData) !== 36 || slice(call.callData, 0, 4).toLowerCase() !== SET_REFERRAL_CODE) {
    return [...reasons, { code: 'DAPP_ACTION_NOT_ADMITTED', detail: "GMX ReferralStorage admits only setTraderReferralCodeByUser with Puppet's code" }]
  }
  const { args } = decodeFunctionData({ abi: GMX_REFERRAL_STORAGE_ABI, data: call.callData })
  return args[0] === GMX_REFERRAL_CODE ? reasons : [...reasons, { code: 'REFERRAL_CODE_FORBIDDEN', detail: `GMX referral code ${args[0]} is not Puppet's own code` }]
}

function screenApproval(call: IIAccount__Call): IGuardReason[] {
  return call.value === 0n ? [] : [{ code: 'NATIVE_VALUE_FORBIDDEN', detail: `approve call to ${call.target} forwards native value ${call.value}` }]
}

const ORDER_STYLE: Record<number, string> = {
  [GMX_ORDER_TYPE.LimitIncrease]: 'limit',
  [GMX_ORDER_TYPE.StopIncrease]: 'stop',
  [GMX_ORDER_TYPE.LimitDecrease]: 'take profit',
  [GMX_ORDER_TYPE.StopLossDecrease]: 'stop loss'
}

const tokenNameOf = (facts: IVenueFacts, token: Address): string =>
  tokenMetaByChainToken.get(tokenMetaKey(GMX_V2_CHAIN_ID, token))?.symbol ?? facts.tokens.get(getAddress(token))?.symbol ?? readableAddress(token)

const indexOf = (facts: IVenueFacts, market: Address): { symbol: string; decimals: number | null } => {
  const indexToken = facts.markets.get(getAddress(market))?.indexToken
  if (indexToken === undefined) return { symbol: readableAddress(market), decimals: null }
  const meta = tokenMetaByChainToken.get(tokenMetaKey(GMX_V2_CHAIN_ID, indexToken)) ?? facts.tokens.get(indexToken)
  return meta === undefined ? { symbol: readableAddress(indexToken), decimals: null } : { symbol: meta.symbol, decimals: meta.decimals }
}

function describeRouterCall(facts: IVenueFacts, call: IIAccount__Call, returned: Hex | undefined, sent: Map<Address, bigint>): IOperateStep[] {
  const innerResults: readonly Hex[] =
    returned === undefined
      ? []
      : call.callData.startsWith(MULTICALL_SELECTOR)
        ? returned.startsWith(BYTES_LIST_HEAD)
          ? decodeAbiParameters([{ type: 'bytes[]' }], returned)[0]
          : []
        : [returned]
  const steps: IOperateStep[] = []
  ;(unwrapRouterCalls(call.callData) ?? []).forEach((dec, j) => {
    if (dec.functionName === 'sendTokens') {
      const [token, , amount] = dec.args as readonly [Address, Address, bigint]
      sent.set(getAddress(token), (sent.get(getAddress(token)) ?? 0n) + amount)
    } else if (dec.functionName === 'sendWnt') {
      const [, amount] = dec.args as readonly [Address, bigint]
      sent.set(GMX_WNT, (sent.get(GMX_WNT) ?? 0n) + amount)
    } else if (dec.functionName === 'createOrder') {
      const p = dec.args[0] as ICreateOrderParams
      const collateralToken = getAddress(p.addresses.initialCollateralToken)
      const swapPath = p.addresses.swapPath.map(h => getAddress(h))
      const increase = GMX_INCREASE_TYPES.has(Number(p.orderType))
      const funded = (sent.get(collateralToken) ?? 0n) - (isAddressEqual(collateralToken, GMX_WNT) ? p.numbers.executionFee : 0n)
      sent.clear()
      const key = innerResults[j]
      const collateralDelta = increase ? funded : p.numbers.initialCollateralDeltaAmount
      const delivered = swapPath.length > 0 ? traceSwapPathOutput(facts.markets, collateralToken, swapPath) : collateralToken
      const index = indexOf(facts, p.addresses.market)
      const style = ORDER_STYLE[Number(p.orderType)]
      const side = p.isLong ? 'long' : 'short'
      steps.push(
        {
          kind: 'venue',
          venueId: PLATFORM,
          key: key !== undefined && size(key) === 32 ? key : null,
          call: 'createOrder',
          label: `${style === undefined ? (increase ? 'Increase' : 'Decrease') : style[0]!.toUpperCase() + style.slice(1)} ${side} ${index.symbol}`,
          fields: [
            { label: 'market', value: index.symbol },
            { label: 'side', value: p.isLong ? 'long' : 'short' },
            { label: 'size', value: `$${readableUsd(p.numbers.sizeDeltaUsd)}` },
            ...(delivered === undefined || isAddressEqual(delivered, collateralToken) ? [] : [{ label: 'swapped to', value: tokenNameOf(facts, delivered) }]),
            ...(p.numbers.triggerPrice === 0n || index.decimals === null ? [] : [{ label: 'trigger', value: `$${readableUsd(p.numbers.triggerPrice * 10n ** BigInt(index.decimals))}` }]),
            ...(p.numbers.acceptablePrice === 0n || index.decimals === null ? [] : [{ label: 'acceptable', value: `$${readableUsd(p.numbers.acceptablePrice * 10n ** BigInt(index.decimals))}` }])
          ],
          flows: [
            ...(collateralDelta > 0n ? [{ token: collateralToken, delta: increase ? -collateralDelta : collateralDelta, exact: true }] : []),
            { token: PROTOCOL.nativeToken as Address, delta: -p.numbers.executionFee, exact: true }
          ],
          fees: p.numbers.executionFee === 0n ? [] : [{ payee: 'venue', token: PROTOCOL.nativeToken as Address, amount: p.numbers.executionFee, expected: null }]
        }
      )
    } else if (dec.functionName === 'cancelOrder') {
      const key = dec.args[0] as Hex
      steps.push(
        {
          kind: 'venue',
          venueId: PLATFORM,
          key,
          call: 'cancelOrder',
          label: 'Cancel order',
          fields: [{ label: 'order', value: key }],
          flows: [],
          fees: []
        }
      )
    } else if (dec.functionName === 'updateOrder') {
      const [key, sizeDeltaUsd] = dec.args as readonly [Hex, bigint, bigint, bigint]
      steps.push(
        {
          kind: 'venue',
          venueId: PLATFORM,
          key,
          call: 'updateOrder',
          label: 'Update order',
          fields: [
            { label: 'order', value: key },
            { label: 'size', value: `$${readableUsd(sizeDeltaUsd)}` }
          ],
          flows: [],
          fees: []
        }
      )
    } else if (dec.functionName === 'claimFundingFees' || dec.functionName === 'claimCollateral') {
      const [markets] = dec.args as readonly [readonly Address[], readonly Address[]]
      const funding = dec.functionName === 'claimFundingFees'
      steps.push(
        {
          kind: 'venue',
          venueId: PLATFORM,
          key: null,
          call: dec.functionName,
          label: funding ? 'Claim funding fees' : 'Claim collateral',
          fields: [{ label: 'markets', value: String(markets.length) }],
          flows: [],
          fees: []
        }
      )
    }
  })
  return steps
}

export const gmxVenue: IVenue = {
  venueId: PLATFORM,
  name: 'GMX',
  chains: [GMX_V2_CHAIN_ID],
  positions: gmxPositions,
  outcome: gmxOrderOutcome,
  dapp: { hosts: ['gmx.io'], chains: [GMX_V2_CHAIN_ID] },
  contracts: Object.entries(GMX_V2_CONTRACT_MAP as Record<string, { address: Address }>).map(([key, entry]) => ({
    chainId: GMX_V2_CHAIN_ID,
    address: entry.address,
    name: readableContractName('GMX', key),
    detail: 'a GMX contract',
    pullsTokens: isAddressEqual(entry.address, GMX_TOKEN_SPENDER) || key === 'GmxRouter',
    standing: isAddressEqual(entry.address, GMX_TOKEN_SPENDER)
  })).concat(
    {
      chainId: GMX_V2_CHAIN_ID,
      address: GMX_REFERRAL_STORAGE,
      name: 'GMX ReferralStorage',
      detail: "GMX's referral registry; a fund binds only Puppet's code",
      pullsTokens: false,
      standing: false
    },
    {
      chainId: GMX_V2_CHAIN_ID,
      address: GMX_RELAY_ROUTER,
      name: 'GMX Express relay router',
      detail: "relays GMX Express orders signed as a digest; GMX's Router allowance bounds what they can move",
      pullsTokens: false,
      standing: false
    },
    {
      chainId: GMX_V2_CHAIN_ID,
      address: GMX_SUBACCOUNT_RELAY_ROUTER,
      name: 'GMX One-Click relay router',
      detail: "relays orders from the fund's GMX One-Click trading subaccount",
      pullsTokens: false,
      standing: false
    }
  ),
  claims(ctx, call) {
    if (ctx.chainId !== GMX_V2_CHAIN_ID) return false
    if (isAddressEqual(call.target, GMX_ROUTER) || isAddressEqual(call.target, GMX_REFERRAL_STORAGE)) return true
    return isRegisteredToken(ctx, call.target) && routerApproval(call)
  },
  screen(ctx, call) {
    if (isAddressEqual(call.target, GMX_REFERRAL_STORAGE)) return screenReferralBinding(call)
    return isAddressEqual(call.target, GMX_ROUTER) ? screenRouterCall(ctx, call) : screenApproval(call)
  },
  outflows: gmxOutflows,
  exchange: () => ({ spent: [], received: [] }),
  async resolve(client, callList, blockNumber) {
    const named = callList.flatMap(call =>
      isAddressEqual(call.target, GMX_ROUTER)
        ? (unwrapRouterCalls(call.callData) ?? []).flatMap(dec => {
            if (dec.functionName !== 'createOrder') return []
            const order = dec.args[0] as ICreateOrderParams
            return [order.addresses.market, ...order.addresses.swapPath]
          })
        : []
    )
    const markets = await readGmxMarkets(client, named, blockNumber)
    const unlisted = [...new Set([...markets.values()].flatMap(market => [market.indexToken, market.longToken, market.shortToken]))].filter(
      token => !tokenMetaByChainToken.has(tokenMetaKey(GMX_V2_CHAIN_ID, token))
    )
    return { markets, tokens: await readTokenProfiles(req => readContract(client, req), GMX_V2_CHAIN_ID, unlisted), owners: new Map() }
  },
  describe(chainId: ChainId, _account, callList, resultList, facts) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== GMX_V2_CHAIN_ID) return out
    const sent = new Map<Address, bigint>()
    callList.forEach((call, i) => {
      if (!isAddressEqual(call.target, GMX_ROUTER)) return
      out.set(i, describeRouterCall(facts, call, resultList?.[i], sent))
    })
    return out
  },
  async readableTypedData(clients, account, nowSec, signedMessage, td) {
    const router = td.domain?.verifyingContract
    if (td.domain?.name !== GMX_RELAY_DOMAIN_NAME || td.primaryType !== 'Minified' || typeof router !== 'string' || !isAddress(router) || !isAddressEqual(router, GMX_SUBACCOUNT_RELAY_ROUTER)) return null
    const digest = td.message.digest
    if (typeof digest !== 'string' || !isHex(digest) || size(digest) !== 32) return null
    const client = clients[GMX_V2_CHAIN_ID]
    if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no client for chain ${GMX_V2_CHAIN_ID} to read GMX One-Click state`, 'server')
    const approval = await resolveGmxOneClickApproval(client, account, digest, signedMessage(stringToHex(GMX_ONE_CLICK_MESSAGE)), nowSec)
    if (approval === null) {
      throw new CompactError(
        'DAPP_ACTION_NOT_ADMITTED',
        "Puppet can read GMX's One-Click approval only at its default settings (7 days, 90 actions); set One-Click back to those defaults in GMX and enable it again",
        'hard'
      )
    }
    return approval
  },
  typedData(_account, td) {
    if (td.domain?.name !== GMX_RELAY_DOMAIN_NAME) return null
    const router = td.domain.verifyingContract
    if (String(td.domain.version) !== '1' || Number(td.domain.chainId) !== GMX_V2_CHAIN_ID || typeof router !== 'string' || !isAddress(router)) {
      return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: "GMX relay signatures are admitted only under GMX's own Arbitrum relay routers, version 1" }]
    }
    if (isAddressEqual(router, GMX_RELAY_ROUTER)) {
      return td.primaryType === 'Minified' && JSON.stringify(td.types?.Minified) === JSON.stringify([{ name: 'digest', type: 'bytes32' }])
        ? []
        : [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `${td.primaryType} under GMX's Express router is not the Express order digest GMX signs` }]
    }
    if (!isAddressEqual(router, GMX_SUBACCOUNT_RELAY_ROUTER)) {
      return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `GMX relay router ${router} is not one Puppet admits` }]
    }
    if (td.primaryType !== 'SubaccountApproval' || JSON.stringify(td.types) !== JSON.stringify(GMX_SUBACCOUNT_APPROVAL_TYPES)) {
      return [
        {
          code: 'DAPP_ACTION_NOT_ADMITTED',
          detail: `${td.primaryType} under GMX's One-Click router is not a One-Click approval Puppet can read; under this router Puppet signs only GMX's approval of a subaccount for orders on Arbitrum`
        }
      ]
    }
    const reasons: IDappScreenReason[] = []
    if (String(td.message.actionType).toLowerCase() !== GMX_SUBACCOUNT_ORDER_ACTION.toLowerCase()) {
      reasons.push({ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `the approval grants action ${String(td.message.actionType)}, not GMX's subaccount order action` })
    }
    if (BigInt(String(td.message.desChainId)) !== BigInt(GMX_V2_CHAIN_ID)) {
      reasons.push({ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `the approval targets chain ${String(td.message.desChainId)}, not Arbitrum` })
    }
    if (String(td.message.integrationId).toLowerCase() !== zeroHash) {
      reasons.push({ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `the approval names integration ${String(td.message.integrationId)}; only GMX's own One-Click is admitted` })
    }
    return reasons
  },
  message(_account, text) {
    return text === GMX_ONE_CLICK_MESSAGE ? [] : null
  }
}
