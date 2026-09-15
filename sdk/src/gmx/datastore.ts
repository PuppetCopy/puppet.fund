import { GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { Hex, PublicClient } from 'viem'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem/utils'
import { applyFactor } from '../core/math.js'

const datastoreAddress = GMX_V2_CONTRACT_MAP.GmxDatastore.address
const datastoreAbi = GMX_V2_CONTRACT_MAP.GmxDatastore.abi

function hashData(types: string[], values: (string | number | bigint | boolean)[]) {
  return keccak256(encodeAbiParameters(parseAbiParameters(types) as any, values))
}

function getDatastoreUint(client: PublicClient, key: Hex) {
  return client.readContract({
    address: datastoreAddress,
    abi: datastoreAbi,
    functionName: 'getUint',
    args: [key]
  })
}

function getDatastoreUintByName(client: PublicClient, key: string) {
  return getDatastoreUint(client, hashData(['string'], [key]))
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
