import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountBalance } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import type { IPriceSource } from '@puppet/sdk/evaluate'
import { type Address, formatUnits } from 'viem'
import type { escrowSurplus, IHoldingView } from './datastore/own.js'

const usdOf = (amount: bigint, price: bigint): number => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

export async function walletValueUsd(
  price: (chainId: ChainId, token: Address) => Promise<IPriceSource>,
  holdings: readonly IHoldingView[],
  balances: readonly IAccountBalance[],
  escrowed: ReturnType<typeof escrowSurplus>
): Promise<number | null> {
  let usd = 0
  const eth = holdings.length === 0 ? null : (await price(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH)).price
  for (const holding of holdings) {
    const standing = holding.standing
    if (standing.kind === 'behind') return null
    usd += usdOf(standing.value + standing.queuedValue, eth!)
    if (standing.payout !== null) usd += usdOf(standing.payout.amount, (await price(HUB_CHAIN_ID as ChainId, standing.payout.token)).price)
  }
  for (const row of balances) {
    if (row.balance <= 0n) continue
    usd += usdOf(row.balance, (await price(row.chainId, row.token)).price)
  }
  for (const row of escrowed) usd += usdOf(row.amount, (await price(row.chainId, row.token)).price)
  return usd
}
