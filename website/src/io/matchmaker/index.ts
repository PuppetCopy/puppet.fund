import { PROTOCOL } from '@puppet/contracts/const'
import { createCompact, type ICompact } from '@puppet/sdk/compact'
import type { Address } from 'viem'

declare const __RELAYER_ADDRESS__: Address

export const matchmakerUrl = '/api/matchmaker'

export const relayerAddress = __RELAYER_ADDRESS__

export const attestorAddress = PROTOCOL.attestor

export const compact: ICompact = createCompact({ matchmakerUrl })
