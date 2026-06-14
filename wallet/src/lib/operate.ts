import { createCompact, type ICompact } from '@puppet/sdk/compact'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { staticTokenRegistry } from '@puppet/sdk/state'
import { type IPassthroughTransaction, sendOperatePassthrough } from '@puppet/sdk/venue'
import { createPublicClient, type Hex, http, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ensureSignerKey, getState } from './state.js'

export interface IOperateConfig {
  matchmakerUrl: string
  puppetUrl: string
}

export type IDappTransaction = IPassthroughTransaction

interface IChannel {
  compact: ICompact
  publicClient: PublicClient
}

let channel: IChannel | null = null

function getChannel(config: IOperateConfig): IChannel {
  channel ??= {
    compact: createCompact({ matchmakerUrl: config.matchmakerUrl }),
    publicClient: createPublicClient({ chain: HUB_CHAIN, transport: http(HUB_CHAIN.rpcUrls.default.http[0]) })
  }
  return channel
}

// The static registry IS the live one: const.toml drives both this generated map and the
// on-chain registration of every universe, so no handshake copy is needed. Caps are not
// mirrored, which is fine client-side — the matchmaker enforces them on attest.
const tokenRegistry = staticTokenRegistry()

export async function sendOperateTransaction(tx: IDappTransaction, config: IOperateConfig): Promise<Hex> {
  const state = await getState()
  if (!state.user || !state.signer) throw new Error('No active Puppet account')
  const { compact, publicClient } = getChannel(config)
  return sendOperatePassthrough(
    {
      user: state.user,
      signer: privateKeyToAccount(await ensureSignerKey(config.puppetUrl)),
      compact,
      publicClient,
      tokenRegistry
    },
    tx
  )
}
