import { GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import { op } from 'aelea/stream'
import { multicast, spreadArray } from 'aelea/stream-extended'
import type { PublicClient } from 'viem'
import { watchContractEvent } from '../core/stream/web3.js'

export function createGmxEventLog1Stream(client: PublicClient) {
  return op(
    watchContractEvent(client, {
      abi: GMX_V2_CONTRACT_MAP.GmxEventEmitter.abi,
      address: GMX_V2_CONTRACT_MAP.GmxEventEmitter.address,
      eventName: 'EventLog1'
    }),
    spreadArray,
    multicast
  )
}

export function createGmxEventLog2Stream(client: PublicClient) {
  return op(
    watchContractEvent(client, {
      abi: GMX_V2_CONTRACT_MAP.GmxEventEmitter.abi,
      address: GMX_V2_CONTRACT_MAP.GmxEventEmitter.address,
      eventName: 'EventLog2'
    }),
    spreadArray,
    multicast
  )
}
