import { getAddress } from 'viem'
import { tokenMetaByAddress } from '../state/tokenRegistry.js'
import { composeBreakdown, computeNavValues } from './compose.js'
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

export const DEFAULT_PLATFORMS = [gmxEvaluator]

// Non-base spot holdings priced into base wei via the injected pair rate. A holding whose priced asset IS the base's
// (native MON next to a WMON base) converts 1:1 without an oracle — wrapped and native are the same asset. An
// unpriceable holding values to 0 with priceAgeSec undefined, which the gate turns into a fail-closed STALE_ORACLE.
async function valueHoldings(
  holdings: INavHolding[],
  baseSymbol: string | undefined,
  getRate: IGetRate,
  nowSec: number
): Promise<INavValuedHolding[]> {
  const live = holdings.filter(h => h.signedBalance !== 0n || h.unrecognized !== 0n)
  return Promise.all(
    live.map(async h => {
      if (h.symbol === baseSymbol) {
        return { ...h, valueBase: h.signedBalance, unrecognizedBase: h.unrecognized, priceAgeSec: 0 }
      }
      const rate = baseSymbol ? await getRate(h.symbol, baseSymbol).catch(() => null) : null
      if (!rate || rate.token1 === 0n) {
        return { ...h, valueBase: 0n, unrecognizedBase: 0n, priceAgeSec: undefined }
      }
      return {
        ...h,
        valueBase: (h.signedBalance * rate.token0) / rate.token1,
        unrecognizedBase: (h.unrecognized * rate.token0) / rate.token1,
        priceAgeSec: Math.max(0, nowSec - rate.time)
      }
    })
  )
}

export async function evaluateAccountNav(params: IEvaluateAccountParams): Promise<INavResult> {
  const config: IEvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const platforms = params.platforms ?? DEFAULT_PLATFORMS

  const baseSymbol = tokenMetaByAddress.get(getAddress(params.baseToken))?.symbol
  const [valuations, holdings] = await Promise.all([
    Promise.all(
      platforms.map(p =>
        p.evaluate({
          account: params.master,
          baseToken: params.baseToken,
          nowSec,
          publicClient: params.publicClient,
          getRate: params.getRate,
          positions: params.positions,
          orders: params.orders,
          claimables: params.claimables
        })
      )
    ),
    valueHoldings(params.holdings ?? [], baseSymbol, params.getRate, nowSec)
  ])

  const breakdown = composeBreakdown(params.cashLeg, valuations, holdings)
  const { navMark, navFloor, navSigned } = computeNavValues(breakdown, params.kind, config)
  const gate = checkNavGate(breakdown, navSigned, config, { clientNav: params.clientNav, kind: params.kind })

  return { navMark, navFloor, navSigned, kind: params.kind, breakdown, gate }
}
