import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { Address, Hex } from 'viem'
import { getBlockNumber as fetchBlockNumber, getGasPrice as fetchGasPrice, readContract } from 'viem/actions'
import { ttlCachedByKey } from './cache.js'

const ACCOUNT = DEPLOYMENTS[`Account:${HUB_CHAIN_ID}`]

import type { IGetRate } from '../evaluate/index.js'
import { type FeeClient, getRelayFeeQuoteSource, } from './fee.js'
import type { IChainLiveness } from './health.js'
import type { ITokenRegistryMap } from './tokenRegistry.js'

export function createSdkContext(
  publicClients: Record<number, FeeClient>,
  // The token registry and chain liveness are sourced per app, injected here so the context itself stays free of any
  // data-store coupling — it only owns the on-chain/fee reads.
  config: {
    getRate: IGetRate
    getTokenRegistry: () => Promise<ITokenRegistryMap>
    // Optional: only apps that anchor against a chain head + run staleness gates need it (the website runner). The
    // matchmaker omits it — its attestation reads the per-intent request-chain head directly, no global liveness
    // snapshot. Defaulted to a thrower so a consumer that DOES read it without providing one fails loudly.
    getChainLiveness?: () => Promise<IChainLiveness>
    getTokenPerNativeToken: (chainId: number, tokenId: Hex) => Promise<bigint>
  },
  homeChainId = HUB_CHAIN_ID
) {
  const { getTokenRegistry, getRate, getTokenPerNativeToken: tokenPerNativeTokenProvider } = config
  const getChainLiveness =
    config.getChainLiveness ??
    ((): Promise<IChainLiveness> => {
      throw new Error('createSdkContext: getChainLiveness was not configured')
    })

  const clientFor = (chainId: number): FeeClient => {
    const client = publicClients[chainId]
    if (!client) throw new Error(`createSdkContext: no public client for chain ${chainId}`)
    return client
  }

  const getChainGasPrice = ttlCachedByKey(200, (chainId: number) => fetchGasPrice(clientFor(chainId)))
  // On-demand live chain head per chain (lazy: a chain is only polled when an intent for it
  // arrives, so adding chains costs nothing until they see traffic). Off-chain mirror of the
  // contract's block.number for the maxBlockDelay / StaleSignature anchor-freshness check.
  const getBlockNumber = ttlCachedByKey(350, (chainId: number) => fetchBlockNumber(clientFor(chainId)))
  // Keyed by (dispatch chain, token): the fee's rate is token per the DISPATCH chain's native (the coin the relayer
  // actually burns), not the hub's — pricing an Arbitrum dispatch with a token-per-MON rate under-quotes ~ETH/MON x
  // and floors small fees to zero.
  const tokenPerNativeByKey = ttlCachedByKey(60_000, (key: string) => {
    const sep = key.indexOf('|')
    return tokenPerNativeTokenProvider(Number(key.slice(0, sep)), key.slice(sep + 1) as Hex)
  })
  // chainId is REQUIRED (no hub default): a fee rate is meaningless without the chain whose native the relayer burns —
  // an optional chain is a buried hub assumption, the exact shape of the misdenomination bug.
  const getTokenPerNativeToken = (chainId: number, tokenId: Hex, maxAgeMs?: number) =>
    tokenPerNativeByKey(`${chainId}|${tokenId}`, maxAgeMs)

  // Mirrors the contract's nonce replay guard (Account.dispatch consumes the nonce keyed by the executing account;
  // reverts NonceLib__InvalidNonceForAccount on reuse). isNonceConsumed lives on the shared Account module, keyed per
  // account, so it answers even for not-yet-deployed accounts.
  // NEVER cached: this gates whether the matchmaker APPROVES a dispatch, and it must not approve off a memoized answer.
  // The read is at `latest`, so a head reorg can flip it either way — re-read fresh on every check so the decision
  // always reflects the live tip (the on-chain NonceLib consume is the atomic backstop behind it).
  const getNonceConsumed = (chainId: number, account: Address, nonce: bigint): Promise<boolean> =>
    readContract(clientFor(chainId), {
      address: ACCOUNT.address,
      abi: ACCOUNT.abi,
      functionName: 'isNonceConsumed',
      args: [account, nonce]
    })

  const getRelayFeeMap = async (chainId: number, tokenId: Hex, ttlMs = 350) => {
    const [gas, rate] = await Promise.all([
      getChainGasPrice(chainId, ttlMs),
      getTokenPerNativeToken(chainId, tokenId, ttlMs)
    ])
    return getRelayFeeQuoteSource(rate, gas)
  }

  return {
    getTokenRegistry,
    getRate,
    getChainGasPrice,
    getTokenPerNativeToken,
    getRelayFeeMap,
    getNonceConsumed,
    getBlockNumber,
    getChainLiveness
  }
}
