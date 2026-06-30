import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { computeClaimable, computeQueuedShares, type ISubaccountState, type ITokenRegistryMap } from '@puppet/sdk/state'
import { combine, combineMap, type IStream, just, op, start, switchMap } from 'aelea/stream'
import { type Address, formatUnits, getAddress, type Hex } from 'viem'
import { priceFor } from './gmx/priceFeed.js'

// Live total account value in USD, lensed off the root PA state: cash balances (signedBalance) + per-position value
// (claimable + held shares at fund NAV) + mastered-fund AUM, each leg priced by its OWN token's live price. Emits null
// while any leg's price is still loading (never folds a missing price to a fabricated 0), and null when there is no
// account. Drives both the menu's total text and the wallet-page chart headline, so a settled withdraw moves the live
// value the instant walletState folds it.
export function liveTotalUsdValue(
  walletState: IStream<ISubaccountState | null>,
  registry: IStream<ITokenRegistryMap>
): IStream<number | null> {
  return op(
    combine({ root: walletState, registry }),
    switchMap(p => {
      if (!p.root) return just<number | null>(null)
      const fundById = new Map(p.root.funds.map(f => [getAddress(f.fund), f] as const))
      const positionedFunds = new Set(p.root.positions.map(pos => getAddress(pos.fund)))
      const legs: { amount: bigint; address: Address }[] = []
      for (const [token, row] of p.root.balances) {
        const reg = p.registry.get(Number(row.chainId) as ChainId)?.get(token)
        if (reg) legs.push({ amount: row.signedBalance, address: getAddress(token) })
      }
      for (const pos of p.root.positions) {
        const fund = fundById.get(getAddress(pos.fund))
        if (!fund) continue
        const baseToken = p.registry.get(HUB_CHAIN_ID)?.get(fund.baseToken as Hex)?.token
        if (!baseToken) continue
        legs.push({
          amount:
            computeClaimable(pos, fund) +
            ((pos.sharesHeld + computeQueuedShares(pos, fund)) * fund.navPerShare) / PRECISION.floatPrecisionExp,
          address: getAddress(baseToken)
        })
      }
      for (const fund of p.root.funds) {
        if (getAddress(fund.master) !== getAddress(p.root.account)) continue
        // Skip a mastered fund the account ALSO holds a position in: that position (above) already counts the master's
        // stake at masterShares * NAV. Counting the full fund AUM here too would double it (and over-count outside
        // investors). The full-AUM leg stays only for a mastered fund with no position row, so its value isn't invisible.
        if (positionedFunds.has(getAddress(fund.fund))) continue
        const baseToken = p.registry.get(HUB_CHAIN_ID)?.get(fund.baseToken as Hex)?.token
        if (!baseToken) continue
        legs.push({
          amount: (fund.totalShareSupply * fund.navPerShare) / PRECISION.floatPrecisionExp,
          address: getAddress(baseToken)
        })
      }
      if (legs.length === 0) return just<number | null>(0)
      return combineMap(
        (...prices: (bigint | null)[]) => {
          if (prices.some(price => price === null)) return null
          return Number(formatUnits(legs.reduce((acc, leg, i) => acc + leg.amount * prices[i]!, 0n), USD_PRICE_DECIMALS))
        },
        ...legs.map(l => priceFor(l.address))
      )
    }),
    start(null as number | null)
  )
}
