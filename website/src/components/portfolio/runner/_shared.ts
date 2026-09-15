import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import type { IActionKind } from '@puppet/sdk/intent'
import {
  computeRelayFee,
  type IChainLiveness,
  type ITokenRegistryMap,
  RELAY_RATE_MAX_STALE_MS,
  tokenInfoFor
} from '@puppet/sdk/state'
import { getPublicClient, getWalletClient, switchChain } from '@wagmi/core'
import type { PublicClient } from 'viem'
import type { Address } from 'viem/accounts'
import context from '../../../io/context.js'
import { journal } from '../../../io/journal/journal.js'
import { homePublicClient, type IBodyKeys, type IConnectedWallet, type IRootState, wagmi } from '../../../wallet/index.js'

export const DEFAULT_DEADLINE_SEC = 5 * 60

export interface ExecContext {
  tokenRegistry: ITokenRegistryMap
  wallet: IConnectedWallet
  root: IRootState | null
  createAccount: () => Promise<IRootState>
  bodyKeys: IBodyKeys | null
  chainLiveness: IChainLiveness
}

export const rootOf = (ctx: ExecContext): Promise<IRootState> =>
  ctx.root !== null && ctx.bodyKeys !== null && ctx.bodyKeys.accountOf(ctx.wallet.address) !== null
    ? Promise.resolve(ctx.root)
    : ctx.createAccount()

export function publicClientForChain(chainIdNum: number): PublicClient {
  const client = chainIdNum === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: chainIdNum })
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client as PublicClient
}

export const envelopeNonce = (account: Address, chainId: ChainId = HUB_CHAIN_ID): Promise<bigint> => journal(account).nonce(chainId)

export async function quoteRelayFee(
  chainId: ChainId,
  kind: IActionKind,
  carriesGenesis: boolean,
  token: Address,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): Promise<bigint> {
  const [tokenRegistry, gasPrice, tokenPerNativeToken] = await Promise.all([
    context.getTokenRegistry(),
    context.getChainGasPrice(chainId),
    context.getTokenPerNativeToken(chainId, token, RELAY_RATE_MAX_STALE_MS)
  ])
  tokenInfoFor(tokenRegistry, chainId, token)
  return computeRelayFee(chainId, kind, carriesGenesis, gasPrice, tokenPerNativeToken, unitCount, innerGasLimit, calldataByteLength)
}

export async function walletClientForChain(
  current: IConnectedWallet['walletClient'],
  chainId: ChainId
): Promise<IConnectedWallet['walletClient']> {
  if (current.chain?.id === chainId) {
    const live = await current.getChainId().catch(() => null)
    if (live === chainId) return current
  }
  await switchChain(wagmi, { chainId })
  let lastError: unknown = null
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const next = await getWalletClient(wagmi, { chainId })
      if ((await next.getChainId()) === chainId) return next
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(
    `wallet did not switch to chain ${chainId}; switch in your wallet and retry${lastError instanceof Error ? ` (${lastError.message})` : ''}`
  )
}



