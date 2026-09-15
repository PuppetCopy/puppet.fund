import { chainTokenOfKey, symbolOfKey } from '../state/tokenRegistry.js'
import { composeBreakdown } from './compose.js'
import { gmxEvaluator } from './platform/gmx.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluateAccountParams,
  type IEvaluationConfig,
  type IGetRate,
  type INavHolding,
  type INavResult,
  type INavValuedHolding
} from './types.js'
import { checkNavGate } from './verify.js'

const DEFAULT_PLATFORMS = [gmxEvaluator]

async function valueHoldings(
  holdings: INavHolding[],
  baseSymbol: string,
  getRate: IGetRate,
  nowSec: number,
  maxPriceAgeSec: number
): Promise<INavValuedHolding[]> {
  const live = holdings.filter(h => h.balance !== 0n)
  return Promise.all(
    live.map(async h => {
      if (h.symbol === baseSymbol) {
        return { ...h, mark: { valueBase: h.balance, priceAgeSec: 0 } }
      }
      const rate = await getRate(h.symbol, baseSymbol, maxPriceAgeSec * 1000)
      if (rate.token1 === 0n) throw new Error(`rate ${h.symbol}/${baseSymbol} has a zero denominator`)
      return {
        ...h,
        mark: { valueBase: (h.balance * rate.token0) / rate.token1, priceAgeSec: Math.max(0, nowSec - rate.time) }
      }
    })
  )
}

export async function evaluateAccountNav(params: IEvaluateAccountParams): Promise<INavResult> {
  const config: IEvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const platforms = params.platforms ?? DEFAULT_PLATFORMS

  const baseSymbol = symbolOfKey(params.baseKey)
  const [valuations, holdings] = await Promise.all([
    Promise.all(
      platforms.map(p =>
        p.evaluate({
          chainId: p.chainId,
          account: params.master,
          baseToken: chainTokenOfKey(p.chainId, params.baseKey),
          blockNumber: params.blockNumber,
          blockTimestamp: params.blockTimestamp,
          nowSec,
          publicClient: params.publicClient,
          getRate: params.getRate,
          positions: params.positions,
          orders: params.orders,
          claimables: params.claimables
        })
      )
    ),
    valueHoldings(params.holdings, baseSymbol, params.getRate, nowSec, config.maxPriceAgeSec)
  ])

  const breakdown = composeBreakdown(params.cashLeg, valuations, holdings)
  const navMark = breakdown.unitedCashBase + breakdown.holdingMarkBase + breakdown.positionMarkBase
  const gate = checkNavGate(breakdown, navMark, config, { clientNav: params.clientNav, kind: params.kind })

  return gate.ok
    ? { kind: params.kind, breakdown, ok: true, navMark }
    : { kind: params.kind, breakdown, ok: false, reasons: gate.reasons }
}
