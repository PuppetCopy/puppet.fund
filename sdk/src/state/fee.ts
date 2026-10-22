import { router__accountGenesisGas, router__gasLimit, router__loopGas, router__userGenesisGas, router__withdrawProviderGas } from '@puppet/contracts'
import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { type Address, type Chain, type Client, type Hex, isAddressEqual, size, slice, toFunctionSelector, type Transport } from 'viem'
import { type ChainId, deploymentAddress, USD_DECIMALS, USD_SYMBOL } from '../const/index.js'
import type { IGetRate } from '../evaluate/types.js'
import type { IWithdrawRoute } from '../intent/route/swap.js'
import { tokenMetaOf, wrappedNativeAddressOf } from './tokenRegistry.js'

export type FeeClient = Client<Transport, Chain | undefined>

export type RelayGate = 'SpokeGate' | 'HubGate'

const GATE_GAS = { ...router__gasLimit.SpokeGate, ...router__gasLimit.HubGate } as const

export type IGasKind = keyof typeof GATE_GAS

const LOOP_GAS: Partial<Record<IGasKind, bigint>> = router__loopGas

export const GAS_KIND_LIST = Object.keys(GATE_GAS) as IGasKind[]

export function gateOf(kind: IGasKind, chainId: ChainId): RelayGate {
  const hosted: RelayGate = chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate'
  if (!(kind in router__gasLimit[hosted])) throw new Error(`${kind} does not dispatch on ${hosted}, the gate chain ${chainId} hosts`)
  return hosted
}

const BODY_SAFETY_FACTOR = 2n

export const MAX_TX_GAS = 16_777_216n

const SUBCALL_GAS_BUDGET: Partial<Record<IGasKind, bigint>> = {
  depositAcross: 4_300_894n,
  fundSwap: 4_300_894n,
  withdraw: 4_726_690n
}

export const TYPICAL_SUBCALL_GAS = 1_200_000n

export const WRAP_SUBCALL_GAS = 60_000n

const WRAP_SELECTOR = toFunctionSelector('function deposit()')
const UNWRAP_SELECTOR = toFunctionSelector('function withdraw(uint256)')

export function wrapSubcallGas(chainId: ChainId, route: IWithdrawRoute): bigint {
  if (route.kind !== 'swap' || !isAddressEqual(route.provider, wrappedNativeAddressOf(chainId))) return 0n
  const length = size(route.providerCallData)
  const selector = length < 4 ? null : slice(route.providerCallData, 0, 4).toLowerCase()
  return (selector === WRAP_SELECTOR && length === 4) || (selector === UNWRAP_SELECTOR && length === 36) ? WRAP_SUBCALL_GAS : 0n
}

export const USD_PER_MILLION_GAS: Record<ChainId, bigint> = {
  10: 12n * 10n ** 27n,
  137: 39n * 10n ** 27n,
  4663: 74n * 10n ** 27n,
  42161: 74n * 10n ** 27n
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

const BODY_GENESIS_KIND_LIST: readonly IGasKind[] = ['operate', 'fundSwap']

const genesisGas = (kind: IGasKind, carriesGenesis: boolean): bigint => {
  if (!carriesGenesis || kind === 'createFund') return 0n
  if (kind === 'fulfil') return router__accountGenesisGas
  return BODY_GENESIS_KIND_LIST.includes(kind) ? router__accountGenesisGas + router__userGenesisGas : router__userGenesisGas
}

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
  const rows = kind === 'allocate' || kind === 'createFund' || kind === 'redeem' || kind === 'redeemCohort' ? router__loopGas[kind] * unitCount : 0n
  const reserved =
    (gateBodyGas(kind, unitCount, calldataByteLength) - rows) * BODY_SAFETY_FACTOR +
    rows +
    genesisGas(kind, carriesGenesis) +
    subcallGas(kind, innerGasLimit) +
    CALLDATA_GAS_PER_BYTE * calldataByteLength +
    (kind === 'redeem' || kind === 'redeemCohort' ? 2n * PROTOCOL.transferGasLimit : 0n)
  return (reserved * SUBCALL_RESERVE_NUMERATOR) / SUBCALL_RESERVE_DENOMINATOR + 1n
}

export function relayGasUsd(
  chainId: ChainId,
  kind: IGasKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  const usdPerMillionGas = USD_PER_MILLION_GAS[chainId]
  if (usdPerMillionGas === undefined) throw new Error(`no published gas price for chain ${chainId}`)
  if (SUBCALL_GAS_BUDGET[kind] !== undefined && innerGasLimit !== 0n && innerGasLimit !== WRAP_SUBCALL_GAS) {
    throw new Error(`${kind} bills a typical subcall or a wrap's ${WRAP_SUBCALL_GAS}; innerGasLimit must be 0 or wrapSubcallGas's answer, got ${innerGasLimit}`)
  }
  const subcall =
    SUBCALL_GAS_BUDGET[kind] === undefined || innerGasLimit === WRAP_SUBCALL_GAS ? innerGasLimit : kind !== 'withdraw' || calldataByteLength > 0n ? TYPICAL_SUBCALL_GAS : 0n
  return ((gateBodyGas(kind, unitCount, calldataByteLength) + genesisGas(kind, carriesGenesis) + subcall) * usdPerMillionGas) / 1_000_000n
}

export const RELAY_RATE_MAX_STALE_MS = 60_000

export type IFeeConvert = (usd: bigint) => bigint

export async function feeConverter(getRate: IGetRate, chainId: ChainId, token: Address, maxStaleMs: number): Promise<IFeeConvert> {
  const meta = tokenMetaOf(chainId, token)
  if (meta.isFiat) {
    const unit = 10n ** BigInt(USD_DECIMALS - meta.decimals)
    return usd => (usd + unit - 1n) / unit
  }
  const rate = await getRate(meta.symbol, USD_SYMBOL, maxStaleMs)
  const ageMs = Date.now() - rate.time * 1000
  if (ageMs > maxStaleMs) {
    throw new Error(`${meta.symbol}/${USD_SYMBOL} rate is ${ageMs}ms old, past the ${maxStaleMs}ms this fee quote asked for`)
  }
  return usd => (usd * rate.token1 + rate.token0 - 1n) / rate.token0
}

export function relayFeeOf(
  convert: IFeeConvert,
  chainId: ChainId,
  kind: IGasKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): bigint {
  return convert(relayGasUsd(chainId, kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength))
}

const NON_STABLE_FEE_FLOOR_BPS = 9_900n

export const RELAY_FEE_CEILING_MULTIPLE = 2n

export const relayFeeFloor = (chainId: ChainId, token: Address, table: bigint): bigint =>
  tokenMetaOf(chainId, token).isFiat ? table : (table * NON_STABLE_FEE_FLOOR_BPS) / 10_000n

export type IRelayFeeQuote = (
  kind: IGasKind,
  carriesGenesis: boolean,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
) => bigint

export function redeemFeeOf(convert: IFeeConvert, input: { holders: bigint; masterPaid: boolean }): bigint {
  const size = PROTOCOL.maxCohortSize
  const first = input.holders < size ? input.holders : size
  let gasUsd = relayGasUsd(HUB_CHAIN_ID, 'redeem', false, first, 0n, 0n)
  for (let left = input.holders - first; left > 0n; ) {
    const listed = left < size ? left : size
    gasUsd += relayGasUsd(HUB_CHAIN_ID, 'redeemCohort', false, listed, 0n, 0n)
    left -= listed
  }
  const recipients = input.holders + (input.masterPaid ? 1n : 0n)
  if (recipients === 0n) throw new Error('a redemption with no recipient has no fee to share')
  return (convert(gasUsd) + recipients - 1n) / recipients
}
