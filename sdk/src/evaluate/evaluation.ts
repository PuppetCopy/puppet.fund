import { composeBreakdown, computeNavValues } from './compose.js'
import { gmxEvaluator } from './platform/gmx.js'
import {
  DEFAULT_EVALUATION_CONFIG,
  type IEvaluateAccountParams,
  type IEvaluationConfig,
  type INavResult
} from './types.js'
import { checkNavGate } from './verify.js'

export const DEFAULT_PLATFORMS = [gmxEvaluator]

export async function evaluateAccountNav(params: IEvaluateAccountParams): Promise<INavResult> {
  const config: IEvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const platforms = params.platforms ?? DEFAULT_PLATFORMS

  const valuations = await Promise.all(
    platforms.map(p =>
      p.evaluate({
        account: params.master,
        baseToken: params.baseToken,
        nowSec,
        publicClient: params.publicClient,
        getRate: params.getRate,
        positions: params.positions
      })
    )
  )

  const breakdown = composeBreakdown(params.cashLeg, valuations)
  const { navMark, navFloor, navSigned } = computeNavValues(breakdown, params.kind, config)
  const gate = checkNavGate(breakdown, navSigned, config, { clientNav: params.clientNav, kind: params.kind })

  return { navMark, navFloor, navSigned, kind: params.kind, breakdown, gate }
}
