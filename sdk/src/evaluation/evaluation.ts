import { getSubaccountState } from '../state/metric.js'
import type { IIndexerClient } from '../state/shared.js'
import { composeCashLeg } from './cashLeg.js'
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

export async function evaluateAccountNav(sql: IIndexerClient, params: IEvaluateAccountParams): Promise<INavResult> {
  const config: IEvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...params.config }
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const platforms = params.platforms ?? DEFAULT_PLATFORMS

  const [subaccount, valuations] = await Promise.all([
    params.subaccount ? Promise.resolve(params.subaccount) : getSubaccountState(sql, params.master),
    Promise.all(
      platforms.map(p =>
        p.evaluate({
          sql,
          account: params.master,
          baseToken: params.baseToken,
          nowSec,
          publicClient: params.publicClient
        })
      )
    )
  ])

  const chains = composeCashLeg(subaccount, params.health, params.baseTokenId)
  const breakdown = composeBreakdown(chains, valuations)
  const { navMark, navFloor, navSigned } = computeNavValues(breakdown, params.kind, config)
  const gate = checkNavGate(breakdown, navSigned, config, { clientNav: params.clientNav, kind: params.kind })

  return { navMark, navFloor, navSigned, kind: params.kind, breakdown, gate }
}
