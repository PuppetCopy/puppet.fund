import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex } from 'viem'
import type { ChainId } from '../const/index.js'
import { decodeErc20 } from './erc20.js'
import type { IOperateStep } from './types.js'
import { VENUES } from './venues.js'

export function describeOperate(chainId: ChainId, callList: readonly IIAccount__Call[], resultList?: readonly Hex[]): IOperateStep[] {
  const byVenue = VENUES.map(venue => venue.describe(chainId, callList, resultList))
  const steps: IOperateStep[] = []
  callList.forEach((c, i) => {
    const target = getAddress(c.target)
    const last = i === callList.length - 1
    if (c.callData === '0x') {
      steps.push({ kind: 'release', token: null, to: target, amount: c.value })
      return
    }
    const described = byVenue.find(m => m.has(i))?.get(i)
    if (described !== undefined) {
      steps.push(...described)
      return
    }
    const erc20 = decodeErc20(c.callData)
    if (erc20?.functionName === 'approve') return
    if (erc20?.functionName === 'transfer') {
      const [to, amount] = erc20.args as readonly [Address, bigint]
      if (last) steps.push({ kind: 'fee', token: target, amount })
      else steps.push({ kind: 'release', token: target, to: getAddress(to), amount })
      return
    }
    steps.push({ kind: 'call', target, selector: c.callData.slice(0, 10) as Hex, value: c.value })
  })
  return steps
}
