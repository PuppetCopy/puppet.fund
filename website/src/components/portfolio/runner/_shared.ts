import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import type { IActionKind, ITermsDeps } from '@puppet/sdk/intent'
import {
  chainTokenOfKey,
  computeRelayFee,
  followUpOf,
  type IChainLiveness,
  type ITokenRegistryMap,
  RELAY_RATE_MAX_STALE_MS,
  tokenInfoFor,
  tokenKeyOf
} from '@puppet/sdk/state'
import { getWalletClient, switchChain } from '@wagmi/core'
import type { PublicClient } from 'viem'
import type { Address } from 'viem/accounts'
import context, { getRate } from '../../../io/context.js'
import { client as chronicle } from '../../../io/datastore/reads.js'
import { journal } from '../../../io/journal/journal.js'
import { type IConnectedWallet, type IRootState, type IWalletKeys, wagmi } from '../../../wallet/index.js'
import { appClientMap } from '../../../wallet/wallet.js'


export interface ExecContext {
  tokenRegistry: ITokenRegistryMap
  wallet: IConnectedWallet
  root: IRootState | null
  loadRoot: () => Promise<IRootState>
  keys: IWalletKeys | null
  chainLiveness: IChainLiveness
}

export const rootOf = (ctx: ExecContext): Promise<IRootState> => (ctx.root !== null ? Promise.resolve(ctx.root) : ctx.loadRoot())

export function publicClientForChain(chainIdNum: number): PublicClient {
  const client = appClientMap[chainIdNum as ChainId]
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client
}

export const envelopeNonce = (account: Address, user: Address, chainId: ChainId = HUB_CHAIN_ID): Promise<bigint> =>
  journal(account, user).nonce(chainId)

export async function quoteRelayFee(
  chainId: ChainId,
  kind: IActionKind,
  carriesGenesis: boolean,
  token: Address,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint,
  creditChainId: ChainId | null
): Promise<bigint> {
  const [tokenRegistry, gasPrice, tokenPerNativeToken] = await Promise.all([
    context.getTokenRegistry(),
    context.getChainGasPrice(chainId),
    context.getTokenPerNativeToken(chainId, token, RELAY_RATE_MAX_STALE_MS)
  ])
  tokenInfoFor(tokenRegistry, chainId, token)
  const fee = computeRelayFee(chainId, kind, carriesGenesis, gasPrice, tokenPerNativeToken, unitCount, innerGasLimit, calldataByteLength)
  const next = followUpOf(kind, creditChainId)
  if (next === null) return fee
  const [nextGasPrice, nextTokenPerNativeToken] = await Promise.all([
    context.getChainGasPrice(next.chainId),
    context.getTokenPerNativeToken(next.chainId, chainTokenOfKey(next.chainId, tokenKeyOf(chainId, token)), RELAY_RATE_MAX_STALE_MS)
  ])
  return fee + computeRelayFee(next.chainId, next.kind, false, nextGasPrice, nextTokenPerNativeToken, 0n, 0n, 0n)
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

export const terms: ITermsDeps = { chronicle, clients: appClientMap, getRate, getTokenRegistry: context.getTokenRegistry }
