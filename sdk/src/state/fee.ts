import { router__gasLimit } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { FUND_GATE_INTENTS, HUB_GATE_INTENTS, PUPPET_GATE_INTENTS } from '@puppet/contracts/intents'
import type { Chain, Client, Transport } from 'viem'
import { nativePrecisionOf } from './tokenRegistry.js'

// Minimum client shape we rely on: transport + chain. Accepts viem's
// PublicClient, wagmi's raw client (from Config.getClient), and any other
// viem-compatible client used to call getGasPrice / readContract actions.
// chain is `Chain | undefined` to match viem's PublicClient default.
export type FeeClient = Client<Transport, Chain | undefined>

const ROUTER_GAS = {
  PuppetGate: router__gasLimit.PuppetGate,
  FundGate: router__gasLimit.FundGate,
  HubGate: router__gasLimit.HubGate
} as const

export type RelayRouter = keyof typeof ROUTER_GAS
export type RelayMethod = { [R in RelayRouter]: keyof (typeof ROUTER_GAS)[R] }[RelayRouter]
export type RelayFeeMap = Record<RelayMethod, FeeQuote>

// Marginal gas per scaling unit: per matched puppet (allocate), per forwarded call
// (operate), per rule (mandate). The base already covers the single-unit path;
// this is added on top as gas(n) = base + perUnit*n. Hardcoded estimates until
// per-unit benches exist; biased high so the relay fee never under-quotes a large batch.
const PER_UNIT_GAS: Partial<Record<RelayMethod, bigint>> = {
  allocate: 45_000n,
  operate: 15_000n,
  mandate: 10_000n
}

// A dispatched intent kind resolves to the gate that hosts it (router) and the on-chain function /
// gas-limit key (method). `swap` and `recognize` each live on BOTH gates, so the kind disambiguates
// where membership can't: PA kinds (swap/recognize) → PuppetGate, FA kinds (fundSwap/fundRecognize) →
// FundGate's same-named function. Everything else is method === kind, routed by membership.
const KIND_DISPATCH: Partial<Record<string, { router: RelayRouter; method: RelayMethod }>> = {
  swap: { router: 'PuppetGate', method: 'swap' },
  fundSwap: { router: 'FundGate', method: 'swap' },
  wrap: { router: 'FundGate', method: 'wrap' },
  recognize: { router: 'PuppetGate', method: 'recognize' },
  fundRecognize: { router: 'FundGate', method: 'recognize' },
  operate: { router: 'FundGate', method: 'operate' }
}

export function relayDispatch(kind: string): { router: RelayRouter; method: RelayMethod } {
  const explicit = KIND_DISPATCH[kind]
  if (explicit) return explicit
  if (kind in HUB_GATE_INTENTS) return { router: 'HubGate', method: kind as RelayMethod }
  if (kind in PUPPET_GATE_INTENTS) return { router: 'PuppetGate', method: kind as RelayMethod }
  if (kind in FUND_GATE_INTENTS) return { router: 'FundGate', method: kind as RelayMethod }
  throw new Error(`unknown relay kind ${kind}`)
}

function relayGas(router: RelayRouter, method: RelayMethod, unitCount: bigint): bigint {
  const base = (ROUTER_GAS[router] as Record<string, bigint>)[method]
  if (base === undefined) throw new Error(`no gas limit for ${router}.${method}`)
  return base + (PER_UNIT_GAS[method] ?? 0n) * unitCount
}

// Methods that invoke EXTERNAL protocols (a DEX/bridge for swap, GMX for operate), whose real execution cost the
// single-shape forge base under-reports and the per-unit estimate can't capture (one GMX createOrder is ~400-600k, a
// deploy-on-first-use swap adds ~300k). A floor keeps a real call from OOGing while the base+perUnit shape still scales
// past it for large batches.
const DISPATCH_GAS_FLOOR: Partial<Record<RelayMethod, bigint>> = {
  operate: 2_000_000n,
  swap: 2_000_000n
}

// The gas cap for DISPATCH (writeContract), sized from the SAME scaling model the fee is quoted from
// (base + perUnit*unitCount) so a large batch never OOGs the tx the fee was collected for — a static base*N ignored
// unitCount and OOG'd a >~46-puppet allocate mid-loop. 2x headroom absorbs the hardcoded-estimate error; a per-method
// floor covers external-protocol calls. Never eth_call/estimateGas (that reintroduces the node-anomaly veto the sim
// deletion removed) — this is a pure static formula.
export function dispatchGasLimit(router: RelayRouter, method: RelayMethod, unitCount: bigint): bigint {
  const scaled = relayGas(router, method, unitCount) * 2n
  const floor = DISPATCH_GAS_FLOOR[method] ?? 0n
  return scaled > floor ? scaled : floor
}

// The fee scale: every supported chain's native is 18-decimals, so one precision constant serves all dispatch chains
// (the RATE is what must be chain-native-keyed, see getTokenPerNativeToken).
export const NATIVE_PRECISION = nativePrecisionOf(HUB_CHAIN_ID)

// CEILING division: a real gas cost must never floor to a ZERO fee (a sub-unit quote on a cheap chain once rounded to
// 0, was signed, co-signed and charged as 0 — the relayer worked for free and the anomaly stayed invisible). Rounding
// up costs the user at most one token unit and keeps "fee exists" an invariant of every priced dispatch.
const ceilByPrecision = (n: bigint): bigint => (n + NATIVE_PRECISION - 1n) / NATIVE_PRECISION

// User-side ceiling buffer over the base quote. The matchmaker requotes against
// live gas/rate at submit time; this margin absorbs drift between sign and
// submit. The matchmaker still charges the live base — not the ceiling — so the
// surplus is only "headroom we didn't need" not extra fee paid.
const ACCEPTABLE_FEE_MARGIN_BPS = 2500n
const withMargin = (base: bigint): bigint => (base * (10_000n + ACCEPTABLE_FEE_MARGIN_BPS)) / 10_000n


export interface FeeQuote {
  relayFee: bigint
}

export function getAcceptableRelayFee(
  gasPrice: bigint,
  router: RelayRouter,
  method: RelayMethod,
  tokenPerNativeToken: bigint,
  unitCount = 0n
): bigint {
  return withMargin(ceilByPrecision(relayGas(router, method, unitCount) * gasPrice * tokenPerNativeToken))
}

export function getRelayFeeQuoteSource(tokenPerNativeToken: bigint, gasPrice: bigint): RelayFeeMap {
  const map = {} as RelayFeeMap
  for (const router of ['PuppetGate', 'FundGate', 'HubGate'] as const) {
    for (const [method, gas] of Object.entries(ROUTER_GAS[router])) {
      map[method as RelayMethod] = { relayFee: withMargin(ceilByPrecision(gas * gasPrice * tokenPerNativeToken)) }
    }
  }
  return map
}

/** Canonical formula. fee = relayGas(router, method, unitCount) * gas * tokenPerNativeToken / 1e18 */
export function computeRelayFee(
  router: RelayRouter,
  method: RelayMethod,
  gasPrice: bigint,
  tokenPerNativeToken: bigint,
  unitCount = 0n
): bigint {
  return ceilByPrecision(relayGas(router, method, unitCount) * gasPrice * tokenPerNativeToken)
}
