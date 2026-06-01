export { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'

import { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'
import { decodeAbiParameters, type Hex } from 'viem'

export const eventKey = (contractName: string, eventHash: string) => `${contractName}:${eventHash}`

type Decoder = (data: Hex) => unknown

export const EVENT_DECODER_MAP: Record<string, Decoder> = Object.fromEntries(
  Object.entries(CONTRACT_EVENT_MAP).flatMap(([contractName, events]) =>
    Object.values(events).map(def => [
      eventKey(contractName, def.hash),
      (data: Hex) => decodeAbiParameters(def.args, data)
    ])
  )
)
