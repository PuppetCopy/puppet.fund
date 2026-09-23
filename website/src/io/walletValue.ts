import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { USD_PRICE_DECIMALS, VALUE_KEY } from '@puppet/sdk/evaluate'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { formatUnits } from 'viem'
import type { IAccountBalance } from '../wallet/root.js'
import { getPrice } from './context.js'
import type { escrowSurplus, IHoldingView } from './datastore/own.js'

const usdOf = (amount: bigint, price: bigint): number => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

export async function walletValueUsd(
  holdings: readonly IHoldingView[],
  balances: readonly IAccountBalance[],
  escrowed: ReturnType<typeof escrowSurplus>
): Promise<number | null> {
  const valuePrice = (await getPrice(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))).price
  let usd = 0
  for (const holding of holdings) {
    const standing = holding.standing
    if (standing.kind === 'behind') return null
    usd += usdOf(standing.value + standing.queuedValue + standing.payout - standing.payoutFee, valuePrice)
  }
  for (const row of balances) {
    if (row.balance <= 0n) continue
    usd += usdOf(row.balance, (await getPrice(row.chainId, row.token)).price)
  }
  for (const row of escrowed) usd += usdOf(row.amount, (await getPrice(row.chainId, row.token)).price)
  return usd
}
