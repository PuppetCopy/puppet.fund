import type { PublicClient } from 'viem'
import { type Hex, toHex } from 'viem'
import type { IVenueOutcomeParams } from '../types.js'
import { makeOnchainGmxOrderProvider } from './onchainPositions.js'

type IGmxOrderOutcome = 'open' | 'frozen' | 'executed' | 'cancelled' | 'unknown'

const GMX_EVENT_EMITTER = '0xC8ee91A54287DB53897056e12D9819156D3822Fb'
const EVENT_LOG_2 = '0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5'
const ORDER_EVENT: Record<string, IGmxOrderOutcome> = {
  '0x680f10f06595d3d707241f604672ec4b6ae50eb82728ec2f3c65f6789e897760': 'executed',
  '0xc7bb288dfd646d5b6c69d5099dd75b72f9c8c09ec9d40984c8ad8182357ae4b2': 'cancelled',
  '0x073fdba4e5f6b272d64068005c56e7adbaa6d8de035ca1f7b08422c6dc9fe606': 'frozen'
}

const finalOutcome = new Map<Hex, IGmxOrderOutcome>()

export async function gmxOrderOutcome({ account, key, fromBlock, publicClient }: IVenueOutcomeParams): Promise<IGmxOrderOutcome> {
  const known = finalOutcome.get(key)
  if (known !== undefined) return known
  const client: PublicClient = publicClient
  const logs = await client.request({
    method: 'eth_getLogs',
    params: [
      {
        address: GMX_EVENT_EMITTER,
        fromBlock: toHex(fromBlock),
        toBlock: 'latest',
        topics: [EVENT_LOG_2, Object.keys(ORDER_EVENT) as Hex[], key]
      }
    ]
  })
  const last = logs.at(-1)
  const nameHash = last?.topics[1]
  const outcome = nameHash === undefined ? undefined : ORDER_EVENT[nameHash]
  if (outcome === 'executed' || outcome === 'cancelled') {
    finalOutcome.set(key, outcome)
    return outcome
  }
  const open = (await makeOnchainGmxOrderProvider(client)(account)).find(o => o.orderKey.toLowerCase() === key.toLowerCase())
  if (open !== undefined) return open.isFrozen ? 'frozen' : 'open'
  return outcome === undefined ? 'unknown' : outcome
}

