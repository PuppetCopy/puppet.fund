import type { IIAccount__Call } from '@puppet/contracts/types'
import { getAddress, type Hex } from 'viem'
import type { ChainId } from '../const/index.js'
import { READERS } from './readers.js'
import type { IOperateStep } from './types.js'
import { VENUES } from './venues.js'

export function describeOperate(
  chainId: ChainId,
  callList: readonly IIAccount__Call[],
  endsWithFee: boolean,
  resultList?: readonly Hex[]
): IOperateStep[] {
  const byVenue = VENUES.map(venue => venue.describe(chainId, callList, resultList))
  const steps: IOperateStep[] = []
  callList.forEach((call, i) => {
    const described = byVenue.find(m => m.has(i))?.get(i)
    if (described !== undefined) {
      steps.push(...described)
      return
    }
    const last = endsWithFee && i === callList.length - 1
    const read = READERS.reduce<IOperateStep[] | null>((found, reader) => found ?? reader.read(chainId, call, last), null)
    if (read !== null) {
      steps.push(...read)
      return
    }
    steps.push({ kind: 'call', target: getAddress(call.target), selector: call.callData.slice(0, 10) as Hex, value: call.value })
  })
  return steps
}
