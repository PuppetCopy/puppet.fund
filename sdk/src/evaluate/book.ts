import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, erc20Abi, isAddressEqual, type PublicClient } from 'viem'
import type { ChainId } from '../const/index.js'
import { GMX_V2_CHAIN_ID } from '../gmx/market.js'
import {
  makeOnchainGmxClaimableProvider,
  makeOnchainGmxOrderProvider,
  makeOnchainGmxPositionProvider
} from '../gmx/onchainPositions.js'
import { symbolOf, tokenKeyOf } from '../state/tokenRegistry.js'
import { HYPERLIQUID_CHAIN_ID } from '../venue/hyperliquid/contracts.js'

export const VALUE_KEY = 'USDC'

import { evaluateAccountNav } from './evaluation.js'
import { gmxEvaluator } from './platform/gmx.js'
import { hyperliquidEvaluator } from './platform/hyperliquid.js'
import type { IEvaluationConfig, IGetRate, INavHolding, INavKind, INavResult } from './types.js'

export interface IBookValuationParams {
  client: PublicClient
  chainId: ChainId
  account: Address
  holdingTokens: readonly Address[]
  blockNumber: bigint
  blockTimestamp: number
  kind: INavKind
  getRate: IGetRate
  nowSec?: number
  config?: Partial<IEvaluationConfig>
}

export async function evaluateBookAt(p: IBookValuationParams): Promise<INavResult> {
  const erc20 = p.holdingTokens.filter(t => !isAddressEqual(t, PROTOCOL.nativeToken))
  const native = p.holdingTokens.some(t => isAddressEqual(t, PROTOCOL.nativeToken))
  const [balances, nativeBalance] = await Promise.all([
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
    native ? p.client.getBalance({ address: p.account, blockNumber: p.blockNumber }) : Promise.resolve(0n)
  ])
  const held: INavHolding[] = erc20.map((token, i) => ({
    chainId: p.chainId,
    token,
    symbol: symbolOf(p.chainId, token),
    balance: balances[i]!
  }))
  if (native) {
    held.push({ chainId: p.chainId, token: PROTOCOL.nativeToken, symbol: symbolOf(p.chainId, PROTOCOL.nativeToken), balance: nativeBalance })
  }
  const cash = held.filter(h => tokenKeyOf(p.chainId, h.token) === VALUE_KEY)
  const holdings = held.filter(h => !cash.includes(h))

  const venue = p.chainId === GMX_V2_CHAIN_ID
  const [positions, orders, claimables] = venue
    ? await Promise.all([
        makeOnchainGmxPositionProvider(p.client, p.getRate, p.blockNumber)(p.account),
        makeOnchainGmxOrderProvider(p.client, p.blockNumber)(p.account),
        makeOnchainGmxClaimableProvider(p.client, p.blockNumber)(p.account)
      ])
    : [[], [], []]

  return evaluateAccountNav({
    master: p.account,
    baseKey: VALUE_KEY,
    blockNumber: p.blockNumber,
    blockTimestamp: p.blockTimestamp,
    kind: p.kind,
    platforms: [...(venue ? [gmxEvaluator] : []), ...(p.chainId === HYPERLIQUID_CHAIN_ID ? [hyperliquidEvaluator] : [])],
    publicClient: p.client,
    getRate: p.getRate,
    positions,
    orders,
    claimables,
    nowSec: p.nowSec,
    config: p.config,
    cashLeg: cash.map(h => ({ chainId: p.chainId, balance: h.balance, reachable: true })),
    holdings
  })
}
