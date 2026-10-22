import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { readContract, simulateCalls } from 'viem/actions'
import { type ChainId, chainNameOf, USD_DECIMALS, USD_SYMBOL } from '../../const/index.js'
import { getTokenDescription, readableTokenAmountLabel, readTokenProfiles } from '../../core/index.js'
import { DEFAULT_EVALUATION_CONFIG, usdPriceFromRate } from '../../evaluate/index.js'
import { clientOf } from '../../intent/index.js'
import { fetchTokenBalance, listedTokensOf, symbolOf, tokenMetaByChainToken, tokenMetaKey } from '../../state/index.js'
import {
  assertOperateSignable,
  describeOperate,
  GMX_V2_CHAIN_ID,
  gmxReferralBindingOf,
  type IVenueFacts,
  operateExchange,
  operateOutflows,
  resolveOperate,
  screenOperate,
  UNISWAP_POOLS,
  uniswapExits,
  uniswapPools,
  withProtocolReferral
} from '../../venue/index.js'
import { type ITokenFlowView, type ITokenProfiles, tokenMovesOf, tokenUnitOf, unregisteredTokensOf } from '../operation.js'
import type { IRootState, IWalletPair } from '../root.js'
import type { IClientDeps } from './_shared.js'
import { type IAttestation, quoteOperateFee, runOperateStep } from './steps.js'

export type IDappTransaction = { from?: Address; to?: string; value?: string; data?: string; gas?: string }

export interface IPendingCall {
  chainId: ChainId
  account: Address
  callList: readonly IIAccount__Call[]
  profiles: ITokenProfiles
  facts: IVenueFacts
  outs: readonly ITokenFlowView[]
  ins: readonly ITokenFlowView[]
  fee: ITokenFlowView
}

export async function planDappOperate(
  deps: Pick<IClientDeps, 'clients' | 'context' | 'getRate'>,
  pair: IWalletPair,
  root: IRootState,
  chainId: number,
  txList: readonly IDappTransaction[]
): Promise<IPendingCall> {
  if (txList.length === 0) throw new Error('The dApp sent no calls to run.')
  if (pair.wallet === null) throw new Error('Connect your wallet before trading through a linked dApp.')
  if (root.fund === null) throw new Error('Open a fund before trading through a linked dApp; the trade runs through the fund.')
  if ('unknown' in root.fund) throw new Error(root.fund.unknown)
  const spoke = chainId as ChainId
  const chainLabel = chainNameOf(spoke) ?? `Chain ${spoke}`
  const account = root.fund.account
  const client = clientOf(deps, spoke)
  const priceOf = async (token: Address): Promise<bigint> => usdPriceFromRate(await deps.getRate(symbolOf(spoke, token), USD_SYMBOL, DEFAULT_EVALUATION_CONFIG.maxPriceAgeSec * 1000), USD_DECIMALS)
  const dappCalls = txList.map(tx => {
    if (tx.to === undefined) throw new Error('Contract creation is not supported from a Puppet account.')
    const target = getAddress(tx.to)
    const callData = withProtocolReferral(target, (tx.data ?? '0x') as Hex)
    const value = tx.value === undefined ? 0n : BigInt(tx.value)
    return { target, value, gas: tx.gas, callData }
  })
  const binding = spoke === GMX_V2_CHAIN_ID ? await gmxReferralBindingOf(client, account, dappCalls) : null
  const calls = binding === null ? dappCalls : [{ ...binding, gas: undefined }, ...dappCalls]
  const listed = listedTokensOf(spoke)
  const screened = calls.map(call => ({ target: call.target, value: call.value, gasLimit: call.gas === undefined ? 0n : BigInt(call.gas), callData: call.callData }))
  const facts = await resolveOperate(client, spoke, screened, undefined)
  assertOperateSignable(screenOperate({ chainId: spoke, callList: screened, account, registeredTokens: listed, facts }))
  const value = calls.reduce((total, call) => total + call.value, 0n)
  if (value > 0n) {
    const nativeBalance = await fetchTokenBalance(client, PROTOCOL.nativeToken, account)
    if (value > nativeBalance) {
      const native = getTokenDescription(spoke, PROTOCOL.nativeToken)
      throw new Error(
        `This order pays ${readableTokenAmountLabel(native, value)} from your fund on ${chainLabel}, which holds ${readableTokenAmountLabel(native, nativeBalance)}. dApps like GMX take their execution fee in ETH, so swap some of your fund into ETH on ${chainLabel} first, then send the order again.`
      )
    }
  }
  const simulated = (await simulateCalls(client, { account, calls: calls.map(call => ({ to: call.target, value: call.value, data: call.callData })) })).results
  const callList = calls.map((call, i) => {
    const result = simulated[i]!
    if (result.status !== 'success') {
      throw new Error(`Call ${i + 1} of ${calls.length}, to ${call.target}, reverts when run from your fund: ${result.error?.message.split('\n')[0] ?? 'no reason given'}`)
    }
    if (call.gas === undefined) return { target: call.target, value: call.value, gasLimit: (result.gasUsed * 13n) / 10n, callData: call.callData }
    if (BigInt(call.gas) < result.gasUsed) {
      throw new Error(`Call ${i + 1} of ${calls.length}, to ${call.target}, sets gas ${BigInt(call.gas)} but uses ${result.gasUsed} when run from your fund`)
    }
    return { target: call.target, value: call.value, gasLimit: BigInt(call.gas), callData: call.callData }
  })
  const exchange = operateExchange(spoke, account, callList)
  const outflows = operateOutflows(account, callList)
  const funded = await Promise.all(
    listed.map(async token => {
      const committed = outflows.reduce((total, outflow) => (isAddressEqual(outflow.token, token) ? total + outflow.amount : total), 0n) + (exchange.spent.get(getAddress(token)) ?? 0n)
      const free = (await fetchTokenBalance(client, token, account)) + (exchange.received.get(getAddress(token)) ?? 0n) - committed
      return { token, free, value: free <= 0n ? 0n : free * (await priceOf(token)) }
    })
  )
  const richest = funded.reduce((best, h) => (h.value > best.value ? h : best))
  if (richest.value === 0n) {
    throw new Error(`After this trade your fund on ${chainLabel} keeps no token Puppet prices to pay the relay fee; lower the amount, or allocate in a round or move fund balance here first.`)
  }
  const steps = describeOperate(spoke, account, callList, false, undefined, facts)
  const [relayFee, profiles, block] = await Promise.all([
    quoteOperateFee(deps, pair.wallet.address, account, spoke, richest.token, callList),
    readTokenProfiles(req => readContract(client, req), spoke, unregisteredTokensOf(spoke, steps)),
    client.getBlockNumber()
  ])
  if (richest.free < relayFee) {
    const unit = getTokenDescription(spoke, richest.token)
    throw new Error(
      `This trade leaves your fund ${readableTokenAmountLabel(unit, richest.free)} on ${chainLabel}, short of the ${readableTokenAmountLabel(unit, relayFee)} relay fee. Lower the amount by at least ${readableTokenAmountLabel(unit, relayFee - richest.free)}, or keep another token there to pay the fee.`
    )
  }
  const pinned = UNISWAP_POOLS[spoke]
  const usdOf = async (token: Address, amount: bigint): Promise<bigint | null> => {
    if (tokenMetaByChainToken.has(tokenMetaKey(spoke, token))) return amount * (await priceOf(token))
    const exits = pinned === undefined ? [] : await uniswapExits(client, pinned, token, await uniswapPools(client, pinned, spoke, token, block), amount, block)
    const values = await Promise.all(exits.map(async exit => exit.amount * (await priceOf(exit.token))))
    return values.reduce<bigint | null>((best, value) => (best === null || value > best ? value : best), null)
  }
  const viewOf = async (token: Address, amount: bigint, exact: boolean): Promise<ITokenFlowView> => ({
    chainId: spoke,
    token,
    profile: tokenUnitOf(spoke, token, profiles),
    amount,
    exact,
    usd: await usdOf(token, amount)
  })
  const [views, fee] = await Promise.all([
    Promise.all(tokenMovesOf(steps).map(async move => ({ out: move.out, view: await viewOf(move.token, move.amount, move.exact) }))),
    viewOf(richest.token, relayFee, true)
  ])
  return {
    chainId: spoke,
    account,
    callList,
    profiles,
    facts,
    outs: views.filter(v => v.out).map(v => v.view),
    ins: views.filter(v => !v.out).map(v => v.view),
    fee
  }
}

export async function passthroughOperate(deps: IClientDeps, pair: IWalletPair, root: IRootState, call: IPendingCall): Promise<IAttestation> {
  if (pair.wallet === null) throw new Error('Connect your wallet before trading through a linked dApp.')
  if (root.fund === null) throw new Error('Open a fund before trading through a linked dApp; the trade runs through the fund.')
  if ('unknown' in root.fund) throw new Error(root.fund.unknown)
  if (!isAddressEqual(root.fund.account, call.account)) {
    throw new Error(`This request was checked for the fund ${call.account}, but ${root.fund.account} is open now. Ask the dApp to send it again.`)
  }
  if (pair.keys === null) throw new Error('This build carries no key service, so nothing can be signed for the fund.')
  await pair.keys.restoreFund(pair.wallet, root.fund)
  return runOperateStep(
    {
      kind: 'operate',
      id: `operate:${call.chainId}`,
      chainId: call.chainId,
      feeToken: call.fee.token,
      callList: [...call.callList],
      sweepInto: null,
      acceptedFee: call.fee.amount
    },
    { ...deps, wallet: pair.wallet, root, loadRoot: () => Promise.resolve(root), keys: pair.keys },
    []
  )
}
