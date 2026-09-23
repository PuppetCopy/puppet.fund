import type { Hex } from 'viem'
import { chainTokenOfKey, symbolOfKey } from '../state/tokenRegistry.js'
import { VENUES } from '../venue/venues.js'
import { composeBreakdown } from './compose.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluateAccountParams,
  type IEvaluationConfig,
  type IGetRate,
  type INavHolding,
  type INavResult,
  type INavValuedHolding,
  type IPlatformValuation
} from './types.js'
import { checkNavGate } from './verify.js'

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

const ALLOWANCE_PLATFORM = 'allowance'

export async function evaluateAccountNav(params: IEvaluateAccountParams): Promise<INavResult> {
  const config: IEvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const platforms = VENUES.filter(venue => venue.chains.includes(params.chainId))

  const baseSymbol = symbolOfKey(params.baseKey)
  const [valuations, holdings, reserved] = await Promise.all([
    Promise.all(
      platforms.map(venue =>
        venue.value({
          chainId: params.chainId,
          account: params.master,
          baseToken: chainTokenOfKey(params.chainId, params.baseKey),
          blockNumber: params.blockNumber,
          blockTimestamp: params.blockTimestamp,
          nowSec,
          publicClient: params.publicClient,
          getRate: params.getRate
        })
      )
    ),
    valueHoldings(params.holdings, baseSymbol, params.getRate, nowSec, config.maxPriceAgeSec),
    valueHoldings(
      params.reserved.map(r => r.holding),
      baseSymbol,
      params.getRate,
      nowSec,
      config.maxPriceAgeSec
    )
  ])
  const reservedValuation: IPlatformValuation = {
    platform: ALLOWANCE_PLATFORM,
    positions: reserved.map((h, i) => {
      const spender = params.reserved[i]!.spender
      return {
        platform: ALLOWANCE_PLATFORM,
        positionKey: `${h.token}${spender.slice(2)}` as Hex,
        market: h.token,
        collateralBase: h.mark.valueBase,
        pnlBase: 0n,
        netBase: h.mark.valueBase,
        priceAgeSec: h.mark.priceAgeSec,
        facets: { kind: 'allowance', token: h.token, spender }
      }
    }),
    inFlight: [],
    available: true
  }

  const breakdown = composeBreakdown(params.cashLeg, [...valuations, reservedValuation], holdings)
  const navMark = breakdown.unitedCashBase + breakdown.holdingMarkBase + breakdown.positionMarkBase
  const gate = checkNavGate(breakdown, navMark, config, { clientNav: params.clientNav, kind: params.kind })

  return gate.ok
    ? { kind: params.kind, breakdown, ok: true, navMark }
    : { kind: params.kind, breakdown, ok: false, reasons: gate.reasons }
}
