import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { owedFor } from '@puppet/sdk/backing'
import type { ChainId } from '@puppet/sdk/const'
import { USD_PRICE_DECIMALS, VALUE_KEY } from '@puppet/sdk/evaluate'
import type { IBondRow, IDepositRow } from '@puppet/sdk/schema'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { formatUnits, getAddress } from 'viem'
import { getPrice } from './context.js'
import type { IBackingView } from './datastore/own.js'
import type { ITradeView } from './datastore/trading.js'

const usdOf = (amount: bigint, price: bigint): number => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))

export async function walletValueUsd(
  views: readonly ITradeView[],
  backings: readonly IBackingView[],
  deposits: readonly IDepositRow[],
  bonds: readonly IBondRow[]
): Promise<number | null> {
  const valuePrice = (await getPrice(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))).price
  let usd = 0
  const marked = new Set<string>()
  for (const view of views) {
    if (view.book.cycle <= view.settledCycle) continue
    if (view.mark === undefined || view.mark.pending || view.mark.closeValue === undefined) return null
    const ledger = {
      totalShares: view.book.totalShares,
      totalPending: view.book.totalPending,
      backing: view.book.backed,
      masterShares: view.book.masterShares,
      masterPending: view.book.masterPending
    }
    const owed = owedFor(ledger, view.mark.closeValue, view.mark.closeValue, view.backers).reduce((acc, o) => acc + o.owed, 0n)
    usd += usdOf(view.mark.closeValue - owed, valuePrice)
    marked.add(`${Number(view.book.chainId)}:${getAddress(view.book.master)}`)
  }
  for (const backing of backings) {
    if (backing.pnl === null) return null
    usd += usdOf(backing.pnl, valuePrice)
  }
  for (const row of bonds) {
    if (row.bond === 0n) continue
    usd += usdOf(row.bond, (await getPrice(Number(row.chainId) as ChainId, getAddress(row.token))).price)
  }
  for (const row of deposits) {
    if (row.deposit <= 0n) continue
    const chainId = Number(row.chainId) as ChainId
    if (marked.has(`${chainId}:${getAddress(row.account)}`)) continue
    usd += usdOf(row.deposit, (await getPrice(chainId, getAddress(row.token))).price)
  }
  return usd
}
