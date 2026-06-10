import { router__gasLimit } from '@puppet/contracts'
import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import { ACCOUNT_GATE_INTENTS, HUB_GATE_INTENTS, MASTER_GATE_INTENTS } from '@puppet/contracts/intents'
import { combine, type IStream, just, map, op } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import type { Address, Chain, Client, Hex, Transport } from 'viem'
import { isAddressEqual } from 'viem'
import { readContract } from 'viem/actions'
import { periodicRun } from '../core/stream/recover.js'

// Minimum client shape we rely on: transport + chain. Accepts viem's
// PublicClient, wagmi's raw client (from Config.getClient), and any other
// viem-compatible client used to call getGasPrice / readContract actions.
// chain is `Chain | undefined` to match viem's PublicClient default.
export type FeeClient = Client<Transport, Chain | undefined>

const ROUTER_GAS = {
  AccountGate: router__gasLimit.AccountGate,
  MasterGate: router__gasLimit.MasterGate,
  HubGate: router__gasLimit.HubGate
} as const

export type RelayRouter = keyof typeof ROUTER_GAS
export type RelayMethod = { [R in RelayRouter]: keyof (typeof ROUTER_GAS)[R] }[RelayRouter]
export type RelayFeeMap = Record<RelayMethod, FeeQuote>

// Marginal gas per scaling unit: per matched puppet (allocate), per forwarded call
// (operate), per rule (subscribe). The base already covers the single-unit path;
// this is added on top as gas(n) = base + perUnit*n. Hardcoded estimates until
// per-unit benches exist; biased high so the relay fee never under-quotes a large batch.
const PER_UNIT_GAS: Partial<Record<RelayMethod, bigint>> = {
  allocate: 45_000n,
  operate: 15_000n,
  subscribe: 10_000n
}

export function relayRouterForKind(kind: RelayMethod): RelayRouter {
  if (kind in HUB_GATE_INTENTS) return 'HubGate'
  if (kind in MASTER_GATE_INTENTS) return 'MasterGate'
  if (kind in ACCOUNT_GATE_INTENTS) return 'AccountGate'
  throw new Error(`unknown relay kind ${kind}`)
}

function relayGas(router: RelayRouter, method: RelayMethod, unitCount: bigint): bigint {
  const base = (ROUTER_GAS[router] as Record<string, bigint>)[method]
  if (base === undefined) throw new Error(`no gas limit for ${router}.${method}`)
  return base + (PER_UNIT_GAS[method] ?? 0n) * unitCount
}

const WEI_PER_ETH = 10n ** 18n

// User-side ceiling buffer over the base quote. The matchmaker requotes against
// live gas/rate at submit time; this margin absorbs drift between sign and
// submit. The matchmaker still charges the live base — not the ceiling — so the
// surplus is only "headroom we didn't need" not extra fee paid.
const ACCEPTABLE_FEE_MARGIN_BPS = 2500n
const withMargin = (base: bigint): bigint => (base * (10_000n + ACCEPTABLE_FEE_MARGIN_BPS)) / 10_000n

const CHAINLINK_ETH_USD_ARBITRUM: Address = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'

const aggregatorAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' }
    ]
  }
] as const

export interface FeeQuote {
  relayFee: bigint
}

export async function getAcceptableRelayFee(
  gasPrice: bigint,
  router: RelayRouter,
  method: RelayMethod,
  feeToken: Address,
  oracleClient: FeeClient,
  unitCount = 0n
): Promise<bigint> {
  const rate = await getTokenPerEth(oracleClient, feeToken)
  return withMargin((relayGas(router, method, unitCount) * gasPrice * rate) / WEI_PER_ETH)
}

export function getRelayFeeQuoteSource(tokenPerEth: bigint, gasPrice: bigint): RelayFeeMap {
  const map = {} as RelayFeeMap
  for (const router of ['AccountGate', 'MasterGate', 'HubGate'] as const) {
    for (const [method, gas] of Object.entries(ROUTER_GAS[router])) {
      map[method as RelayMethod] = { relayFee: withMargin((gas * gasPrice * tokenPerEth) / WEI_PER_ETH) }
    }
  }
  return map
}

const WETH_ADDRESSES: readonly Address[] = Object.values(CHAIN_TOKEN_MAP).map(c => c.WETH as Address)
const USDC_ADDRESSES: readonly Address[] = Object.values(CHAIN_TOKEN_MAP).map(c => c.USDC as Address)

export async function getTokenPerEth(oracleClient: FeeClient, token: Address): Promise<bigint> {
  if (WETH_ADDRESSES.some(a => isAddressEqual(token, a))) return WEI_PER_ETH
  if (USDC_ADDRESSES.some(a => isAddressEqual(token, a))) {
    if (oracleClient.chain?.id !== HUB_CHAIN_ID) {
      throw new Error('USDC fee quote requires Arbitrum oracle client')
    }
    const [, answer] = await readContract(oracleClient, {
      address: CHAINLINK_ETH_USD_ARBITRUM,
      abi: aggregatorAbi,
      functionName: 'latestRoundData'
    })
    if (answer <= 0n) throw new Error(`Chainlink ETH/USD returned non-positive answer ${answer}`)
    return answer / 100n
  }
  throw new Error(`Unsupported feeToken ${token}`)
}

// ─── consolidated relay-fee API ──────────────────────────────────────────────
// Single source of truth for the formula + rate caching. Used by both the user
// SDK (editors precompute per-token fee maps) and the matchmaker (per-request
// quote against the cached rate).

/** Canonical formula. fee = relayGas(router, method, unitCount) * gas * tokenPerEth / 1e18 */
export function computeRelayFee(
  router: RelayRouter,
  method: RelayMethod,
  gasPrice: bigint,
  tokenPerEth: bigint,
  unitCount = 0n
): bigint {
  return (relayGas(router, method, unitCount) * gasPrice * tokenPerEth) / WEI_PER_ETH
}

/** Tokens that can pay relay fees today (extend as registry grows). */
export const SUPPORTED_FEE_TOKEN_IDS = [TOKEN_ID.USDC, TOKEN_ID.WETH] as const

function feeTokenAddress(baseTokenId: Hex, chainId: number): Address {
  const tokens = CHAIN_TOKEN_MAP[chainId as keyof typeof CHAIN_TOKEN_MAP]
  if (!tokens) throw new Error(`no token map for chain ${chainId}`)
  if (baseTokenId === TOKEN_ID.USDC) return tokens.USDC as Address
  if (baseTokenId === TOKEN_ID.WETH) return tokens.WETH as Address
  throw new Error(`unsupported fee token ${baseTokenId}`)
}

/**
 * Per-baseTokenId tokenPerEth stream. WETH = identity (1e18) via short-circuit
 * in `getTokenPerEth`; USDC polls Chainlink at `rateIntervalMs`. Cached as `state()`
 * so multiple consumers share one subscription per token.
 */
export function createTokenPerEthSource(
  baseTokenId: Hex,
  oracleClient: FeeClient,
  rateIntervalMs = 60_000
): IStream<bigint> {
  const tokenAddr = feeTokenAddress(baseTokenId, oracleClient.chain?.id ?? HUB_CHAIN_ID)
  // Identity tokens don't need polling — emit once.
  if (WETH_ADDRESSES.some(a => isAddressEqual(tokenAddr, a))) return just(WEI_PER_ETH)
  return op(
    periodicRun({ interval: rateIntervalMs, actionOp: map(() => getTokenPerEth(oracleClient, tokenAddr)) }),
    state()
  )
}

/**
 * On-demand per-baseTokenId tokenPerEth fetch (no stream). Same address
 * resolution as `createTokenPerEthSource`; WETH short-circuits to identity in
 * `getTokenPerEth`, USDC reads Chainlink. For callers that cache per-request
 * instead of polling.
 */
export async function getTokenPerEthForId(baseTokenId: Hex, oracleClient: FeeClient): Promise<bigint> {
  const chainId = oracleClient.chain?.id
  if (chainId === undefined) {
    throw new Error('getTokenPerEthForId requires an oracle client bound to a chain')
  }
  const tokenAddr = feeTokenAddress(baseTokenId, chainId)
  return getTokenPerEth(oracleClient, tokenAddr)
}

/**
 * Per-baseTokenId fee-map stream. Editors look up `byToken.get(baseTokenId)`
 * and only subscribe to the token they need. Map structure is static.
 */
export function createRelayFeeMapByTokenSource(
  gas: IStream<bigint>,
  oracleClient: FeeClient,
  tokens: readonly Hex[] = SUPPORTED_FEE_TOKEN_IDS,
  rateIntervalMs = 60_000
): Map<Hex, IStream<RelayFeeMap>> {
  return new Map(
    tokens.map(token => {
      const rate = createTokenPerEthSource(token, oracleClient, rateIntervalMs)
      const feeMap = op(
        combine({ gas, rate }),
        map(p => getRelayFeeQuoteSource(p.rate, p.gas)),
        state()
      )
      return [token, feeMap]
    })
  )
}
