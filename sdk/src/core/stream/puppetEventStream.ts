import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'
import { filterNull, type IStream, map, op } from 'aelea/stream'
import { multicast, spreadArray } from 'aelea/stream-extended'
import {
  type AbiParameter,
  type DecodeAbiParametersReturnType,
  decodeAbiParameters,
  type PublicClient,
  parseAbiItem
} from 'viem'
import { watchContractEvent } from './web3.js'

const puppetEventLogAbi = [
  parseAbiItem('event PuppetEventLog(address indexed source, string indexed method, bytes data)')
]

function createFilteredStream<const T extends readonly AbiParameter[]>(
  client: PublicClient,
  methodHash: `0x${string}`,
  args: T
): IStream<DecodeAbiParametersReturnType<T>> {
  return op(
    watchContractEvent(client, {
      abi: puppetEventLogAbi,
      address: PUPPET_CONTRACT_MAP.Dictate.address,
      eventName: 'PuppetEventLog'
    }),
    spreadArray,
    map(log => {
      if (log.args.method !== methodHash) return null
      return decodeAbiParameters(args, log.args.data!)
    }),
    filterNull,
    multicast
  )
}

type EventMap = typeof CONTRACT_EVENT_MAP
type ContractName = keyof EventMap
type EventName<C extends ContractName> = keyof EventMap[C]

type EventArgs<C extends ContractName, E extends EventName<C>> = EventMap[C][E] extends {
  args: infer A extends readonly AbiParameter[]
}
  ? A
  : never

export function createEventStream<C extends ContractName, E extends EventName<C>>(
  client: PublicClient,
  contract: C,
  event: E
): IStream<DecodeAbiParametersReturnType<EventArgs<C, E>>> {
  const def = (CONTRACT_EVENT_MAP[contract] as Record<string, { hash: `0x${string}`; args: readonly AbiParameter[] }>)[
    event as string
  ]!
  return createFilteredStream(client, def.hash, def.args) as IStream<DecodeAbiParametersReturnType<EventArgs<C, E>>>
}
