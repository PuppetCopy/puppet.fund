import { router__accountGenesisGas, router__gasLimit, router__loopGas, router__withdrawProviderGas } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, type Chain, type Client, type Hex, size, type Transport } from 'viem'
import { type ChainId, deploymentAddress } from '../const/index.js'
import type { IGetRate } from '../evaluate/types.js'
import type { IActionKind, IScheduledKind } from '../intent/shared.js'
import { nativePrecisionOf, nativeSymbolOf, symbolOf } from './tokenRegistry.js'

export type FeeClient = Client<Transport, Chain | undefined>

export type RelayGate = 'SpokeGate' | 'HubGate'

const GATE_GAS = { ...router__gasLimit.SpokeGate, ...router__gasLimit.HubGate } as const

export type IGasKind = keyof typeof GATE_GAS

const LOOP_GAS: Partial<Record<IGasKind, bigint>> = router__loopGas

export const GAS_KIND_LIST = Object.keys(GATE_GAS) as IGasKind[]

export interface IFollowUp {
  chainId: ChainId
  kind: IScheduledKind
}

export function followUpOf(kind: IGasKind, creditChainId: ChainId | null): IFollowUp | null {
  if (kind === 'sell') return { chainId: HUB_CHAIN_ID, kind: 'claim' }
  if ((kind === 'allocate' || kind === 'createFund') && creditChainId !== null && creditChainId !== HUB_CHAIN_ID) {
    return { chainId: creditChainId, kind: 'fulfil' }
  }
  return null
}

export function gateOf(kind: IGasKind, chainId: ChainId): RelayGate {
  const hosted: RelayGate = chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate'
  if (!(kind in router__gasLimit[hosted])) throw new Error(`${kind} does not dispatch on ${hosted}, the gate chain ${chainId} hosts`)
  return hosted
}

const BODY_SAFETY_FACTOR = 2n

export const FEE_MARGIN_BPS = 1_000n
const BASIS_POINTS = 10_000n

const SUBCALL_GAS_BUDGET: Partial<Record<IGasKind, bigint>> = {
  depositAcross: 4_300_894n,
  fundSwap: 4_300_894n,
  withdraw: 4_726_690n
}

const GAS_LIMIT_BILLED_CHAIN: Record<ChainId, boolean> = {
  10: false,
  42161: false
}

const CALLDATA_GAS_PER_BYTE = 16n

export const declaredCallGas = (callList: readonly { gasLimit: bigint }[]): bigint =>
  callList.reduce((total, call) => {
    if (call.gasLimit === 0n) {
      throw new Error('a relayed call must declare a gasLimit; 0 forwards the whole remaining budget unpriced')
    }
    return total + call.gasLimit
  }, 0n)

export const dynamicCalldataBytes = (parts: readonly Hex[]): bigint =>
  parts.reduce((total, part) => total + BigInt(size(part)), 0n)

const SUBCALL_RESERVE_NUMERATOR = 64n
const SUBCALL_RESERVE_DENOMINATOR = 63n

export const gateAddress = (kind: IGasKind, chainId: ChainId): Address => deploymentAddress(gateOf(kind, chainId), chainId)

function gateBodyGas(kind: IGasKind, unitCount: bigint, calldataByteLength: bigint): bigint {
  const loop = LOOP_GAS[kind]
  const base = loop === undefined ? GATE_GAS[kind] : GATE_GAS[kind] - loop + loop * unitCount
  return kind === 'withdraw' && calldataByteLength > 0n ? base + router__withdrawProviderGas : base
}

const genesisGas = (kind: IGasKind, carriesGenesis: boolean): bigint =>
  carriesGenesis && kind !== 'createFund' ? router__accountGenesisGas : 0n

function subcallGas(kind: IGasKind, innerGasLimit: bigint): bigint {
  const budget = SUBCALL_GAS_BUDGET[kind]
  if (budget === undefined) return innerGasLimit
  if (innerGasLimit > 0n) {
    throw new Error(`${kind} carries a declared subcall budget; innerGasLimit must be 0, got ${innerGasLimit}`)
  }
  return budget
}

export function dispatchGasLimit(
  kind: IGasKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const reserved =
    gateBodyGas(kind, unitCount, calldataByteLength) * BODY_SAFETY_FACTOR +
    genesisGas(kind, carriesGenesis) +
    subcallGas(kind, innerGasLimit) +
    CALLDATA_GAS_PER_BYTE * calldataByteLength
  return (reserved * SUBCALL_RESERVE_NUMERATOR) / SUBCALL_RESERVE_DENOMINATOR + 1n
}

function billedRelayGas(
  chainId: ChainId,
  kind: IGasKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const billsGasLimit = GAS_LIMIT_BILLED_CHAIN[chainId]
  if (billsGasLimit === undefined) throw new Error(`no relay gas billing model declared for chain ${chainId}`)
  if (billsGasLimit) return dispatchGasLimit(kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength)
  const measured =
    gateBodyGas(kind, unitCount, calldataByteLength) +
    genesisGas(kind, carriesGenesis) +
    innerGasLimit +
    CALLDATA_GAS_PER_BYTE * calldataByteLength
  return (measured * (BASIS_POINTS + FEE_MARGIN_BPS)) / BASIS_POINTS
}

export const RELAY_RATE_MAX_STALE_MS = 60_000

export async function tokenPerNativeToken(
  getRate: IGetRate,
  chainId: ChainId,
  token: Address,
  maxStaleMs: number
): Promise<bigint> {
  const nativeSymbol = nativeSymbolOf(chainId)
  const feeSymbol = symbolOf(chainId, token)
  if (feeSymbol === nativeSymbol) return nativePrecisionOf(chainId)
  const rate = await getRate(nativeSymbol, feeSymbol, maxStaleMs)
  const ageMs = Date.now() - rate.time * 1000
  if (ageMs > maxStaleMs) {
    throw new Error(
      `${nativeSymbol}/${feeSymbol} rate is ${ageMs}ms old, past the ${maxStaleMs}ms this fee quote asked for`
    )
  }
  return (nativePrecisionOf(chainId) * rate.token0) / rate.token1
}

export function computeRelayFee(
  chainId: ChainId,
  kind: IGasKind,
  carriesGenesis: boolean,
  gasPrice: bigint,
  tokenPerNativeTokenRate: bigint,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const gas = billedRelayGas(chainId, kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength)
  const nativePrecision = nativePrecisionOf(chainId)
  return (gas * gasPrice * tokenPerNativeTokenRate + nativePrecision - 1n) / nativePrecision
}

export type IRelayFeeQuote = (
  kind: IActionKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
) => bigint

export const getRelayFeeQuoteSource =
  (chainId: ChainId, gasPrice: bigint, tokenPerNativeTokenRate: bigint): IRelayFeeQuote =>
  (kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength) =>
    computeRelayFee(chainId, kind, carriesGenesis, gasPrice, tokenPerNativeTokenRate, unitCount, innerGasLimit, calldataByteLength)
