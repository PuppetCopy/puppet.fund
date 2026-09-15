import { router__accountGenesisGas, router__gasLimit } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, type Chain, type Client, type Hex, size, type Transport } from 'viem'
import { type ChainId, deploymentAddress } from '../const/index.js'
import type { IGetRate } from '../evaluate/types.js'
import type { IActionKind } from '../intent/shared.js'
import { nativePrecisionOf, nativeSymbolOf, symbolOf } from './tokenRegistry.js'

export type FeeClient = Client<Transport, Chain | undefined>

export type RelayGate = 'CoreGate' | 'HubGate'

const GATE_GAS = { ...router__gasLimit.CoreGate, ...router__gasLimit.HubGate } as const satisfies Record<
  IActionKind,
  bigint
>

const LOOP_GAS: Partial<Record<IActionKind, bigint>> = {}

const ACTION_GATE = {
  ...Object.fromEntries(Object.keys(router__gasLimit.CoreGate).map(action => [action, 'CoreGate'])),
  ...Object.fromEntries(Object.keys(router__gasLimit.HubGate).map(action => [action, 'HubGate']))
} as Record<IActionKind, RelayGate>

export const ACTION_KIND_LIST = Object.keys(ACTION_GATE) as IActionKind[]

export function gateOf(kind: IActionKind): RelayGate {
  return ACTION_GATE[kind]
}

const BODY_SAFETY_FACTOR = 2n

const SUBCALL_GAS_BUDGET: Partial<Record<IActionKind, bigint>> = {
  depositAcross: 4_300_894n,
  withdraw: 4_726_690n
}

const GAS_LIMIT_BILLED_CHAIN: Record<ChainId, boolean> = {
  143: true,
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

export function gateAddress(kind: IActionKind, chainId: ChainId): Address {
  const gate: RelayGate = ACTION_GATE[kind]
  if (gate === 'HubGate' && chainId !== HUB_CHAIN_ID) {
    throw new Error(`${kind} dispatches on HubGate, hub chain only; got ${chainId}`)
  }
  return deploymentAddress(gate, chainId)
}

export function resolveDispatchChain(kind: IActionKind, requestChainId: ChainId): ChainId {
  if (ACTION_GATE[kind] !== 'HubGate') return requestChainId
  if (requestChainId !== HUB_CHAIN_ID) {
    throw new Error(`${kind} dispatches on HubGate, hub chain only; got ${requestChainId}`)
  }
  return HUB_CHAIN_ID
}

function gateBodyGas(kind: IActionKind, unitCount: bigint): bigint {
  const loop = LOOP_GAS[kind]
  return loop === undefined ? GATE_GAS[kind] : GATE_GAS[kind] - loop + loop * unitCount
}

const genesisGas = (carriesGenesis: boolean): bigint => (carriesGenesis ? router__accountGenesisGas : 0n)

function subcallGas(kind: IActionKind, innerGasLimit: bigint): bigint {
  const budget = SUBCALL_GAS_BUDGET[kind]
  if (budget === undefined) return innerGasLimit
  if (innerGasLimit > 0n) {
    throw new Error(`${kind} carries a declared subcall budget; innerGasLimit must be 0, got ${innerGasLimit}`)
  }
  return budget
}

export function dispatchGasLimit(
  kind: IActionKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const reserved =
    gateBodyGas(kind, unitCount) * BODY_SAFETY_FACTOR +
    genesisGas(carriesGenesis) +
    subcallGas(kind, innerGasLimit) +
    CALLDATA_GAS_PER_BYTE * calldataByteLength
  return (reserved * SUBCALL_RESERVE_NUMERATOR) / SUBCALL_RESERVE_DENOMINATOR + 1n
}

export function billedRelayGas(
  chainId: ChainId,
  kind: IActionKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const billsGasLimit = GAS_LIMIT_BILLED_CHAIN[chainId]
  if (billsGasLimit === undefined) throw new Error(`no relay gas billing model declared for chain ${chainId}`)
  if (billsGasLimit) return dispatchGasLimit(kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength)
  return (
    gateBodyGas(kind, unitCount) * BODY_SAFETY_FACTOR +
    genesisGas(carriesGenesis) +
    innerGasLimit +
    CALLDATA_GAS_PER_BYTE * calldataByteLength
  )
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
  kind: IActionKind,
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
