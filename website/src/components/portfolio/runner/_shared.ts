import { HUB_CHAIN_ID } from '@puppet/contracts/const'

import type { IAccountLib__AccountInitParams, IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { resolveDispatchChainId } from '@puppet/sdk/attestation'
import { awaitWhile } from '@puppet/sdk/core'
import { 
  chainHeadBlock,
  getAcceptableRelayFee,
  type IChainLiveness,
  type ISubaccountState,
  type ITokenRegistryMap,MIN_TTL_MS,
  randomNonce
} from '@puppet/sdk/state'
import { getPublicClient, getWalletClient } from '@wagmi/core'
import { getAddress, type Hex, type PublicClient } from 'viem'
import type { Address } from 'viem/accounts'
import { getCallsStatus, getCapabilities, getGasPrice } from 'viem/actions'
import context from '../../../io/context.js'
import { fetchMasterPoolState } from '../../../io/datastore/query.js'
import { readSubaccountState } from '../../../io/datastore/walletState.js'
import { homePublicClient, type IConnectedWallet, type ISessionKey, wagmi } from '../../../wallet/index.js'

export const DEFAULT_DEADLINE_SEC = 5 * 60
export const SESSION_BIND_KEY = 'session-bind'

export interface ExecContext {
  tokenRegistry: ITokenRegistryMap
  wallet: IConnectedWallet
  session: ISessionKey
  gasPrice: bigint
  chainLiveness: IChainLiveness
}

type IRelayRouter = Parameters<typeof getAcceptableRelayFee>[1]
type IRelayMethod = Parameters<typeof getAcceptableRelayFee>[2]

export function stepMetadata(
  ctx: ExecContext,
  chainId?: number
): { blockNumber: bigint; deadline: bigint; nonce: bigint } {
  return {
    blockNumber: chainHeadBlock(ctx.chainLiveness, resolveDispatchChainId(chainId)),
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    nonce: randomNonce()
  }
}

// chainId is REQUIRED and the gas price is fetched HERE, paired to it — a separate gasPrice param let a caller mix a
// dest chain with the hub's gas (the misdenomination pitfall). MIN_TTL_MS: step-run fee legs price against a fresh
// gas/rate basis, never the 5-minute display cache.
export function publicClientForChain(chainIdNum: number): PublicClient {
  const client = chainIdNum === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: chainIdNum })
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client as PublicClient
}

export async function resolveRelayFee(
  ctx: ExecContext,
  chainId: number,
  router: IRelayRouter,
  method: IRelayMethod,
  token: Address,
  unitCount?: bigint
): Promise<bigint> {
  const [gasPrice, tokenPerNativeToken] = await Promise.all([
    chainId === HUB_CHAIN_ID ? ctx.gasPrice : getGasPrice(publicClientForChain(chainId)),
    context.getTokenPerNativeToken(chainId, token, MIN_TTL_MS)
  ])
  return getAcceptableRelayFee(gasPrice, router, method, tokenPerNativeToken, unitCount)
}

export interface IFundIntentEnvelope {
  params: IAccountLib__AccountInitParams
  fundParams: IFundAccountLib__FundAccountInitParams
  blockNumber: bigint
  deadline: bigint
  nonce: bigint
  acceptableRelayFee: bigint
}

export async function buildFundIntentEnvelope(
  ctx: ExecContext,
  opts: { masterAccount: Address; baseToken: Hex; method: IRelayMethod; unitCount?: bigint }
): Promise<{ envelope: IFundIntentEnvelope; fund: ISubaccountState }> {
  const [fund, pool, acceptableRelayFee] = await Promise.all([
    readSubaccountState(ctx.tokenRegistry, getAddress(opts.masterAccount)),
    fetchMasterPoolState(opts.masterAccount),
    resolveRelayFee(ctx, HUB_CHAIN_ID, 'HubGate', opts.method, opts.baseToken, opts.unitCount)
  ])
  if (!fund) throw new Error(`fund ${opts.masterAccount} not in datastore`)
  if (!pool) throw new Error(`fund ${opts.masterAccount} pool state not in datastore`)
  return {
    fund,
    envelope: {
      params: { user: ctx.wallet.address, signer: ctx.session.signer },
      fundParams: { master: fund.signer, baseToken: opts.baseToken, name: pool.name as Hex },
      ...stepMetadata(ctx),
      acceptableRelayFee
    }
  }
}

export async function walletClientForChain(
  current: IConnectedWallet['walletClient'],
  chainId: number
): Promise<IConnectedWallet['walletClient']> {
  if (current.chain?.id === chainId) {
    const live = await current.getChainId().catch(() => null)
    if (live === chainId) return current
  }
  await current.switchChain({ id: chainId })
  for (let attempt = 0; attempt < 15; attempt++) {
    const next = await getWalletClient(wagmi, { chainId })
    const live = await next.getChainId().catch(() => null)
    if (live === chainId) return next
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`wallet did not switch to chain ${chainId}; switch in your wallet and retry`)
}

export async function supportsAtomicBatch(
  walletClient: IConnectedWallet['walletClient'],
  chainId: number
): Promise<boolean> {
  try {
    const caps = await getCapabilities(walletClient, { chainId })
    return caps.atomic?.status === 'supported' || caps.atomic?.status === 'ready'
  } catch {
    return false
  }
}

export async function pollCallsStatus(
  walletClient: IConnectedWallet['walletClient'],
  id: string,
  pollMs = 1_000,
  timeoutMs = 90_000
): Promise<Awaited<ReturnType<typeof getCallsStatus>>> {
  return awaitWhile(
    async () => {
      const status = await getCallsStatus(walletClient, { id })
      return status.status && status.status !== 'pending' ? status : undefined
    },
    { timeoutMs, pollMs, timeoutMessage: `getCallsStatus did not settle for id ${id} within ${timeoutMs}ms` }
  )
}
