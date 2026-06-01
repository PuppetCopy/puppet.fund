import { GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { Address, Hex, PublicClient } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'
import { applyFactor } from '../core/math.js'
import { hashData, hashString } from './gmxUtils.js'

const datastoreAddress = GMX_V2_CONTRACT_MAP.GmxDatastore.address
const datastoreAbi = GMX_V2_CONTRACT_MAP.GmxDatastore.abi
const positionKeyTypes = [{ type: 'bytes32' }, { type: 'string' }] as const

export function getDatastoreUint(client: PublicClient, key: Hex) {
  return client.readContract({
    address: datastoreAddress,
    abi: datastoreAbi,
    functionName: 'getUint',
    args: [key]
  })
}

export function getDatastoreUintByName(client: PublicClient, key: string) {
  return getDatastoreUint(client, hashData(['string'], [key]))
}

export function getPositionSizeInUsd(client: PublicClient, positionKey: Hex) {
  return getDatastoreUint(client, keccak256(encodeAbiParameters(positionKeyTypes, [positionKey, 'SIZE_IN_USD'])))
}

export function getPositionSizeInTokens(client: PublicClient, positionKey: Hex) {
  return getDatastoreUint(client, keccak256(encodeAbiParameters(positionKeyTypes, [positionKey, 'SIZE_IN_TOKENS'])))
}

export function getPositionCollateralAmount(client: PublicClient, positionKey: Hex) {
  return getDatastoreUint(client, keccak256(encodeAbiParameters(positionKeyTypes, [positionKey, 'COLLATERAL_AMOUNT'])))
}

export function getPriceFeedMultiplier(client: PublicClient, token: Address) {
  return getDatastoreUint(client, hashData(['bytes32', 'address'], [hashString('PRICE_FEED_MULTIPLIER'), token]))
}

export function getMinCollateralFactor(client: PublicClient, market: Address) {
  return getDatastoreUint(client, hashData(['bytes32', 'address'], [hashString('MIN_COLLATERAL_FACTOR'), market]))
}

export interface IGasLimitsConfig {
  estimatedGasFeeBaseAmount: bigint
  estimatedGasFeePerOraclePrice: bigint
  estimatedGasFeeMultiplierFactor: bigint
  increaseOrderGasLimit: bigint
  decreaseOrderGasLimit: bigint
  singleSwapGasLimit: bigint
}

export async function getGasLimitsConfig(client: PublicClient): Promise<IGasLimitsConfig> {
  const [
    estimatedGasFeeBaseAmount,
    estimatedGasFeePerOraclePrice,
    estimatedGasFeeMultiplierFactor,
    increaseOrderGasLimit,
    decreaseOrderGasLimit,
    singleSwapGasLimit
  ] = await Promise.all([
    getDatastoreUintByName(client, 'ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1'),
    getDatastoreUintByName(client, 'ESTIMATED_GAS_FEE_PER_ORACLE_PRICE'),
    getDatastoreUintByName(client, 'ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR'),
    getDatastoreUintByName(client, 'INCREASE_ORDER_GAS_LIMIT'),
    getDatastoreUintByName(client, 'DECREASE_ORDER_GAS_LIMIT'),
    getDatastoreUintByName(client, 'SINGLE_SWAP_GAS_LIMIT')
  ])

  return {
    estimatedGasFeeBaseAmount,
    estimatedGasFeePerOraclePrice,
    estimatedGasFeeMultiplierFactor,
    increaseOrderGasLimit,
    decreaseOrderGasLimit,
    singleSwapGasLimit
  }
}

export function calculateExecutionFee(
  gasLimitsConfig: IGasLimitsConfig,
  gasPrice: bigint,
  actionGasLimit: bigint,
  oraclePriceCount = 3n
): bigint {
  const baseGasLimit =
    gasLimitsConfig.estimatedGasFeeBaseAmount + gasLimitsConfig.estimatedGasFeePerOraclePrice * oraclePriceCount
  const gasLimit = baseGasLimit + applyFactor(gasLimitsConfig.estimatedGasFeeMultiplierFactor, actionGasLimit)

  return gasLimit * gasPrice
}
