import { type AbiParameterToPrimitiveType, type Address, encodeAbiParameters, getAddress, type Hex, isAddressEqual, keccak256, type PublicClient } from 'viem'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_EVENT_EMITTER, GMX_EVENT_EMITTER_BLOCK, GMX_EVENT_LOG_ABI } from './contracts.js'
import { readAllGmxMarkets } from './market.js'
import type { IGmxClaimableProvider, IGmxClaimableRow, IGmxOrderProvider, IGmxPositionProvider, IGmxPositionRow } from './rows.js'

export type { IGmxClaimableRow, IGmxOrderRow } from './rows.js'

const READER = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const READER_ABI = GMX_V2_CONTRACT_MAP.GmxReaderV2.abi
const DATA_STORE = GMX_V2_CONTRACT_MAP.GmxDatastore.address

const gmxPositionKey = (account: Address, market: Address, collateralToken: Address, isLong: boolean): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'bool' }],
      [account, market, collateralToken, isLong]
    )
  )

const GET_UINT_ABI = [
  {
    inputs: [{ name: 'key', type: 'bytes32' }],
    name: 'getUint',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const CLAIMABLE_FUNDING_AMOUNT = keccak256(encodeAbiParameters([{ type: 'string' }], ['CLAIMABLE_FUNDING_AMOUNT']))

const claimableFundingKey = (market: Address, token: Address, account: Address): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }],
      [CLAIMABLE_FUNDING_AMOUNT, market, token, account]
    )
  )

export function makeOnchainGmxClaimableProvider(publicClient: PublicClient, blockNumber?: bigint): IGmxClaimableProvider {
  return async account => {
    const pairs = [...(await readAllGmxMarkets(publicClient, blockNumber))].flatMap(([market, m]) => [...new Set([m.longToken, m.shortToken])].map(token => ({ market, token })))
    const amounts = await publicClient.multicall({
      contracts: pairs.map(p => ({
        address: DATA_STORE,
        abi: GET_UINT_ABI,
        functionName: 'getUint' as const,
        args: [claimableFundingKey(p.market, p.token, account)] as const
      })),
      allowFailure: false,
      blockNumber
    })
    return pairs.flatMap((p, i): IGmxClaimableRow[] => (amounts[i] > 0n ? [{ ...p, amount: amounts[i] }] : []))
  }
}

export function makeOnchainGmxOrderProvider(publicClient: PublicClient, blockNumber?: bigint): IGmxOrderProvider {
  return async account => {
    const infos = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountOrders',
      args: [DATA_STORE, account, 0n, 1000n],
      blockNumber
    })
    return infos.map(info => ({
      orderKey: info.orderKey,
      market: info.order.addresses.market,
      collateralToken: info.order.addresses.initialCollateralToken,
      isLong: info.order.flags.isLong,
      orderType: Number(info.order.numbers.orderType),
      sizeDeltaUsd: info.order.numbers.sizeDeltaUsd,
      collateralDeltaAmount: info.order.numbers.initialCollateralDeltaAmount,
      executionFee: info.order.numbers.executionFee,
      triggerPrice: info.order.numbers.triggerPrice,
      isFrozen: info.order.flags.isFrozen
    }))
  }
}

export function makeOnchainGmxPositionProvider(publicClient: PublicClient, blockNumber?: bigint): IGmxPositionProvider {
  return async account => {
    const props = await publicClient.readContract({
      address: READER,
      abi: READER_ABI,
      functionName: 'getAccountPositions',
      args: [DATA_STORE, account, 0n, 1000n],
      blockNumber
    })
    return props.map(p => ({
      positionKey: gmxPositionKey(account, p.addresses.market, p.addresses.collateralToken, p.flags.isLong),
      market: p.addresses.market,
      collateralToken: p.addresses.collateralToken,
      isLong: p.flags.isLong,
      sizeInUsd: p.numbers.sizeInUsd,
      sizeInTokens: p.numbers.sizeInTokens,
      collateralAmount: p.numbers.collateralAmount,
      increasedAtTime: Number(p.numbers.increasedAtTime),
      decreasedAtTime: Number(p.numbers.decreasedAtTime)
    }))
  }
}

const GMX_LOG_WINDOW = 10_000_000n
const [GMX_EVENT_LOG_1, GMX_EVENT_LOG_2] = GMX_EVENT_LOG_ABI
const openingByState = new Map<string, { fee: bigint; executionFee: bigint } | string>()

const itemOf = <T>(group: { items: readonly { key: string; value: T }[] }, key: string): T => {
  const item = group.items.find(entry => entry.key === key)
  if (item === undefined) throw new Error(`a GMX event carries no ${key}`)
  return item.value
}

export async function readGmxOpenings(
  publicClient: PublicClient,
  account: Address,
  positions: readonly IGmxPositionRow[],
  blockNumber: bigint
): Promise<Map<Hex, { fee: bigint; executionFee: bigint } | string>> {
  const stateOf = (row: IGmxPositionRow): string => `${row.positionKey}:${row.increasedAtTime}:${row.decreasedAtTime}`
  const unread = positions.filter(row => !openingByState.has(stateOf(row)))
  if (unread.length > 0) {
    const topic = encodeAbiParameters([{ type: 'address' }], [account])
    const changes: { transactionHash: Hex; name: string; data: AbiParameterToPrimitiveType<(typeof GMX_EVENT_LOG_1)['inputs'][4]> }[] = []
    const created = new Map<Hex, { token: Address; amount: bigint; executionFee: bigint }>()
    const ownOf = (row: IGmxPositionRow) => {
      const own = changes.flatMap((change, at) => (change.name !== 'ExecutionFeeRefund' && itemOf(change.data.bytes32Items, 'positionKey') === row.positionKey ? [{ change, at }] : []))
      const opened = own.findLastIndex(({ change }) => change.name === 'PositionIncrease' && itemOf(change.data.uintItems, 'sizeInUsd') === itemOf(change.data.uintItems, 'sizeDeltaUsd'))
      return opened === -1 ? null : own.slice(opened)
    }
    for (let to = blockNumber; ; ) {
      const from = to - GMX_LOG_WINDOW + 1n > GMX_EVENT_EMITTER_BLOCK ? to - GMX_LOG_WINDOW + 1n : GMX_EVENT_EMITTER_BLOCK
      const [positionLogs, orderLogs] = await Promise.all([
        publicClient.getLogs({
          address: GMX_EVENT_EMITTER,
          event: GMX_EVENT_LOG_1,
          args: { eventNameHash: ['PositionIncrease', 'PositionDecrease', 'ExecutionFeeRefund'], topic1: topic },
          fromBlock: from,
          toBlock: to,
          strict: true
        }),
        publicClient.getLogs({ address: GMX_EVENT_EMITTER, event: GMX_EVENT_LOG_2, args: { eventNameHash: 'OrderCreated', topic2: topic }, fromBlock: from, toBlock: to, strict: true })
      ])
      changes.unshift(...positionLogs.map(log => ({ transactionHash: log.transactionHash, name: log.args.eventName, data: log.args.eventData })))
      for (const log of orderLogs) {
        const data = log.args.eventData
        created.set(itemOf(data.bytes32Items, 'key'), {
          token: getAddress(itemOf(data.addressItems, 'initialCollateralToken')),
          amount: itemOf(data.uintItems, 'initialCollateralDeltaAmount'),
          executionFee: itemOf(data.uintItems, 'executionFee')
        })
      }
      const traced = unread.every(row => ownOf(row)?.every(({ change }) => change.name !== 'PositionIncrease' || created.has(itemOf(change.data.bytes32Items, 'orderKey'))) === true)
      if (traced || from === GMX_EVENT_EMITTER_BLOCK) break
      to = from - 1n
    }
    const openingOf = (row: IGmxPositionRow): { fee: bigint; executionFee: bigint } | string => {
      const own = ownOf(row)
      if (own === null) return 'GMX logs hold no open of this position'
      let fee = 0n
      let executionFee = 0n
      let size = 0n
      for (const { change, at } of own) {
        const sizeInUsd = itemOf(change.data.uintItems, 'sizeInUsd')
        const sizeDeltaUsd = itemOf(change.data.uintItems, 'sizeDeltaUsd')
        const before = change.name === 'PositionIncrease' ? sizeInUsd - sizeDeltaUsd : sizeInUsd + sizeDeltaUsd
        if (before !== size) return 'GMX logs skip a change of this position'
        if (change.name === 'PositionDecrease') {
          fee = (fee * sizeInUsd) / before
          executionFee = (executionFee * sizeInUsd) / before
        } else {
          const order = created.get(itemOf(change.data.bytes32Items, 'orderKey'))
          if (order === undefined) return 'GMX logs hold no order behind an increase of this position'
          if (!isAddressEqual(order.token, row.collateralToken)) return `an increase swapped ${order.token} into the collateral`
          const refund = changes.slice(at + 1).find(other => other.transactionHash === change.transactionHash)
          fee += order.amount - itemOf(change.data.intItems, 'collateralDeltaAmount')
          executionFee += order.executionFee - (refund?.name === 'ExecutionFeeRefund' ? itemOf(refund.data.uintItems, 'refundFeeAmount') : 0n)
        }
        size = sizeInUsd
      }
      return size === row.sizeInUsd ? { fee, executionFee } : 'GMX logs disagree with the position size'
    }
    for (const row of unread) openingByState.set(stateOf(row), openingOf(row))
  }
  return new Map(positions.map(row => [row.positionKey, openingByState.get(stateOf(row))!]))
}
