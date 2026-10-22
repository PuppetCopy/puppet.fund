import { type Address, getAddress, isAddressEqual, type PublicClient, slice } from 'viem'
import { CompactError } from '../../compact/error.js'
import { IMPLEMENTATION_SLOT } from '../../const/common.js'
import { asBigInt, refuse } from '../typedFields.js'
import type { IDappScreenReason, IDappTypedData, IGuardReason } from '../types.js'
import {
  PAPERTRADE_DEPOSIT_PROXY_FACTORY,
  PAPERTRADE_EXCHANGE,
  PAPERTRADE_EXCHANGE_ABI,
  PAPERTRADE_EXECUTOR,
  PAPERTRADE_FACTORY_ABI,
  PAPERTRADE_FEE_CAP,
  PAPERTRADE_ORACLE,
  PAPERTRADE_PINNED_IMPLEMENTATIONS,
  PAPERTRADE_PINNED_INSTRUMENTS,
  PAPERTRADE_SESSION_KEY_MANAGER,
  PAPERTRADE_SESSION_KEY_MANAGER_CALLER_SLOT,
  papertradeProxyOf
} from './contracts.js'

const NO_CLIENT = "no HyperEVM client was handed in, so Papertrade's code and settings cannot be read at co-sign"

async function pinnedDriftOf(client: PublicClient, blockNumber: bigint): Promise<string | null> {
  const read = { address: PAPERTRADE_EXCHANGE, abi: PAPERTRADE_EXCHANGE_ABI, blockNumber } as const
  const [slots, oracle, executor, factory, sessionKeys, sessionCaller] = await Promise.all([
    Promise.all([...PAPERTRADE_PINNED_IMPLEMENTATIONS].map(async ([proxy, implementation]) => ({ proxy, implementation, live: await client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT, blockNumber }) }))),
    client.readContract({ ...read, functionName: 'oracle' }),
    client.readContract({ ...read, functionName: 'authorizedExecutor' }),
    client.readContract({ ...read, functionName: 'proxyFactory' }),
    client.readContract({ ...read, functionName: 'sessionKeyManager' }),
    client.getStorageAt({ address: PAPERTRADE_SESSION_KEY_MANAGER, slot: PAPERTRADE_SESSION_KEY_MANAGER_CALLER_SLOT, blockNumber })
  ])
  const upgraded = slots.filter(slot => slot.live === undefined || !isAddressEqual(getAddress(slice(slot.live, 12)), slot.implementation))
  if (upgraded.length > 0) return `Papertrade changed the code behind ${upgraded.map(slot => slot.proxy).join(', ')} since it was pinned`
  const repointed = [
    ...(isAddressEqual(oracle, PAPERTRADE_ORACLE) ? [] : [`oracle ${oracle}`]),
    ...(isAddressEqual(executor, PAPERTRADE_EXECUTOR) ? [] : [`executor ${executor}`]),
    ...(isAddressEqual(factory, PAPERTRADE_DEPOSIT_PROXY_FACTORY) ? [] : [`deposit proxy factory ${factory}`]),
    ...(isAddressEqual(sessionKeys, PAPERTRADE_SESSION_KEY_MANAGER) ? [] : [`session key manager ${sessionKeys}`]),
    ...(sessionCaller !== undefined && isAddressEqual(getAddress(slice(sessionCaller, 12)), PAPERTRADE_EXCHANGE) ? [] : [`session key manager caller ${String(sessionCaller)}`])
  ]
  return repointed.length === 0 ? null : `Papertrade's Exchange now points at ${repointed.join(', ')} instead of the pinned contracts`
}

export async function attestPapertradeOpen(client: PublicClient | undefined, td: IDappTypedData): Promise<IDappScreenReason[]> {
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', NO_CLIENT, 'server')
  const instrument = asBigInt(td.message.instrumentId)
  const pinned = instrument === null ? undefined : PAPERTRADE_PINNED_INSTRUMENTS.get(instrument)
  if (instrument === null || pinned === undefined) return refuse('DAPP_ACTION_NOT_ADMITTED', `instrument ${String(td.message.instrumentId)} has no pinned settings`)
  const blockNumber = await client.getBlockNumber()
  const read = { address: PAPERTRADE_EXCHANGE, abi: PAPERTRADE_EXCHANGE_ABI, blockNumber } as const
  const [drift, winFee, lossFee, liquidationFee, config] = await Promise.all([
    pinnedDriftOf(client, blockNumber),
    client.readContract({ ...read, functionName: 'winFeeRate' }),
    client.readContract({ ...read, functionName: 'lossFeeRate' }),
    client.readContract({ ...read, functionName: 'liquidationFeeRate' }),
    client.readContract({ ...read, functionName: 'instruments', args: [Number(instrument)] })
  ])
  if (drift !== null) return refuse('DAPP_ACTION_NOT_ADMITTED', `${drift}; opens stay refused until it is pinned again`)
  const [rateMultiplier, positionMultiplier, assetIndex, , , bustBuffer, baseRate, referenceNotional] = config
  const worse = [
    ...(winFee > PAPERTRADE_FEE_CAP ? [`win fee ${winFee}`] : []),
    ...(lossFee > PAPERTRADE_FEE_CAP ? [`loss fee ${lossFee}`] : []),
    ...(liquidationFee > PAPERTRADE_FEE_CAP ? [`liquidation fee ${liquidationFee}`] : []),
    ...(assetIndex !== pinned.assetIndex ? [`asset index ${assetIndex}`] : []),
    ...(baseRate > pinned.baseRate ? [`base rate ${baseRate}`] : []),
    ...(referenceNotional > pinned.referenceNotional ? [`reference notional ${referenceNotional}`] : []),
    ...(bustBuffer > pinned.bustBuffer ? [`bust buffer ${bustBuffer}`] : []),
    ...(rateMultiplier < pinned.rateMultiplier ? [`rate multiplier ${rateMultiplier}`] : []),
    ...(positionMultiplier < pinned.positionMultiplier ? [`position multiplier ${positionMultiplier}`] : [])
  ]
  return worse.length === 0
    ? []
    : refuse('DAPP_ACTION_NOT_ADMITTED', `Papertrade's owner moved settings against the fund since they were pinned (${worse.join(', ')}); opens stay refused until they are pinned again`)
}

export async function attestPapertradeDeposit(client: PublicClient | undefined, account: Address): Promise<IGuardReason[]> {
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', NO_CLIENT, 'server')
  const blockNumber = await client.getBlockNumber()
  const [drift, derived] = await Promise.all([
    pinnedDriftOf(client, blockNumber),
    client.readContract({ address: PAPERTRADE_DEPOSIT_PROXY_FACTORY, abi: PAPERTRADE_FACTORY_ABI, functionName: 'computeProxyAddress', args: [account], blockNumber })
  ])
  if (drift !== null) return [{ code: 'VENUE_CODE_CHANGED', detail: `${drift}; deposits stay refused until it is pinned again` }]
  const pinned = papertradeProxyOf(account)
  return isAddressEqual(derived, pinned)
    ? []
    : [{ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `Papertrade's factory now derives ${derived} as this fund's deposit address, not the pinned ${pinned}; a deposit to the pinned one would strand` }]
}
