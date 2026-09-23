import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, erc20Abi, isAddressEqual, type PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'
import { symbolOf, tokenKeyOf } from '../state/tokenRegistry.js'
import { venueSpenders } from '../venue/venues.js'

export const VALUE_KEY = 'USDC'

import { evaluateAccountNav } from './evaluation.js'
import type { IEvaluationConfig, IGetRate, INavHolding, INavKind, INavReserved, INavResult, ISignerGain } from './types.js'

interface IFundValuationParams {
  client: PublicClient
  chainId: ChainId
  account: Address
  holdingTokens: readonly Address[]
  blockNumber: bigint
  blockTimestamp: number
  kind: INavKind
  signerGain: ISignerGain | null
  getRate: IGetRate
  nowSec?: number
  config?: Partial<IEvaluationConfig>
}

export async function evaluateFundAt(p: IFundValuationParams): Promise<INavResult> {
  const erc20 = p.holdingTokens.filter(t => !isAddressEqual(t, PROTOCOL.nativeToken))
  const native = p.holdingTokens.some(t => isAddressEqual(t, PROTOCOL.nativeToken))
  const spenders = venueSpenders(p.chainId)
  const pairs = erc20.flatMap(token => spenders.map(spender => ({ token, spender })))
  const [balances, nativeBalance, allowances] = await Promise.all([
    erc20.length === 0
      ? Promise.resolve([] as bigint[])
      : p.client.multicall({
          contracts: erc20.map(token => ({
            address: token,
            abi: erc20Abi,
            functionName: 'balanceOf' as const,
            args: [p.account] as const
          })),
          allowFailure: false,
          blockNumber: p.blockNumber
        }),
    native ? p.client.getBalance({ address: p.account, blockNumber: p.blockNumber }) : Promise.resolve(0n),
    pairs.length === 0
      ? Promise.resolve([] as bigint[])
      : p.client.multicall({
          contracts: pairs.map(pair => ({
            address: pair.token,
            abi: erc20Abi,
            functionName: 'allowance' as const,
            args: [p.account, pair.spender] as const
          })),
          allowFailure: false,
          blockNumber: p.blockNumber
        })
  ])
  const allowanceOf = new Map(pairs.map((pair, i) => [`${pair.token}-${pair.spender}`, allowances[i] ?? 0n] as const))
  const reserved: INavReserved[] = erc20.flatMap((token, i) => {
    let remaining = balances[i]!
    const rows: INavReserved[] = []
    for (const spender of spenders) {
      const allowance = allowanceOf.get(`${token}-${spender}`) ?? 0n
      if (allowance === 0n || remaining === 0n) continue
      const amount = allowance < remaining ? allowance : remaining
      remaining -= amount
      rows.push({ holding: { chainId: p.chainId, token, symbol: symbolOf(p.chainId, token), balance: amount }, spender })
    }
    return rows
  })
  const reservedOf = (token: Address): bigint =>
    reserved.reduce((total, r) => (isAddressEqual(r.holding.token, token) ? total + r.holding.balance : total), 0n)
  const held: INavHolding[] = erc20.map((token, i) => ({
    chainId: p.chainId,
    token,
    symbol: symbolOf(p.chainId, token),
    balance: balances[i]! - reservedOf(token)
  }))
  if (native) {
    held.push({
      chainId: p.chainId,
      token: PROTOCOL.nativeToken,
      symbol: symbolOf(p.chainId, PROTOCOL.nativeToken),
      balance: nativeBalance
    })
  }
  const cash = held.filter(h => tokenKeyOf(p.chainId, h.token) === VALUE_KEY)
  const holdings = held.filter(h => !cash.includes(h))

  return evaluateAccountNav({
    master: p.account,
    chainId: p.chainId,
    baseKey: VALUE_KEY,
    blockNumber: p.blockNumber,
    blockTimestamp: p.blockTimestamp,
    kind: p.kind,
    signerGain: p.signerGain,
    publicClient: p.client,
    getRate: p.getRate,
    reserved,
    nowSec: p.nowSec,
    config: p.config,
    cashLeg: cash.map(h => ({ chainId: p.chainId, balance: h.balance, reachable: true })),
    holdings
  })
}
