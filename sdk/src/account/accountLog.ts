import { fundaccountAbi } from '@puppet/contracts/abi'
import { PROTOCOL } from '@puppet/contracts/const'
import { ACCOUNT_CALL_MAP, accountCallEvent } from '@puppet/contracts/events'
import type { IAccountCall__Deposit_fundSwap, IAccountCallEntry, IBalanceLib__Balance, IIAccount__Call } from '@puppet/contracts/types'
import type { AbiParameter, Address, Chain, Client, Hex, TransactionReceipt, Transport } from 'viem'
import { concat, decodeAbiParameters, decodeEventLog, getAddress, hexToBigInt, isAddressEqual, keccak256, size, slice, toEventSelector } from 'viem'
import { getTransactionReceipt, readContract } from 'viem/actions'
import type { ChainId } from '../const/index.js'
import { wrappedNativeAddressOf } from '../state/tokenRegistry.js'

export const ACCOUNT_CALL_TOPIC: Hex = toEventSelector(accountCallEvent)
if (
  ACCOUNT_CALL_TOPIC !==
  toEventSelector(
    'AccountCall(address,address,uint256,uint256,uint256,bytes32,bytes,bytes,(address,uint256,uint256,bytes)[],bytes[],(address,uint256)[])'
  )
) {
  throw new Error(
    `stale @puppet/contracts events artifact: accountCallEvent topic0 ${ACCOUNT_CALL_TOPIC} does not match the AccountCall shape this decode was written against - bun run generate in ops`
  )
}

export type { IAccountCallEntry }
export { ACCOUNT_CALL_MAP }

type AccountClient = Client<Transport, Chain | undefined>

export function accountNonce(client: AccountClient, account: Address): Promise<bigint> {
  return readContract(client, { address: account, abi: fundaccountAbi, functionName: 'nonce' })
}


export interface IReceiptLog {
  address: Address
  topics: readonly Hex[]
  data: Hex
  logIndex: number
}

export const GENESIS_TIP: Hex = `0x${'00'.repeat(24)}`

export const nextTip = (prev: Hex, source: Address, data: Hex): Hex => slice(keccak256(concat([prev, source, data])), 0, 24)

export interface IReceiptAccountCall {
  chainId: number
  account: Address
  modulePrevBlock: bigint
  accountPrevBlock: bigint
  source: Address
  digest: Hex
  signature: Hex
  executionData: Hex
  callList: IIAccount__Call[]
  resultList: Hex[]
  balanceList: IBalanceLib__Balance[]
  data: Hex
  blockNumber: bigint
  blockTimestamp: number
  blockHash: Hex
  logIndex: number
  transactionHash: Hex
}

export interface IStoredAccountCall extends Omit<IReceiptAccountCall, 'chainId' | 'account' | 'blockHash'> {
  siblingLogs: IReceiptLog[]
}

export interface IAccountCallLog {
  address: Address
  topics: readonly Hex[]
  data: Hex
  blockNumber: bigint
  blockHash: Hex
  logIndex: number
  transactionHash: Hex
}

export function accountCallFromLog(chainId: number, log: IAccountCallLog): IReceiptAccountCall {
  const { args } = decodeEventLog({ abi: [accountCallEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] })
  return {
    chainId,
    account: getAddress(args.account),
    modulePrevBlock: args.modulePrevBlock,
    accountPrevBlock: args.accountPrevBlock,
    source: getAddress(args.source),
    digest: args.digest,
    executionData: args.executionData,
    callList: args.callList.map(c => ({ target: getAddress(c.target), value: c.value, gasLimit: c.gasLimit, callData: c.callData })),
    resultList: [...args.resultList],
    balanceList: args.balanceList.map(b => ({ token: getAddress(b.token), amount: b.amount })),
    data: log.data,
    signature: args.signature,
    blockNumber: log.blockNumber,
    blockTimestamp: Number(args.blockTimestamp),
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash
  }
}

export function accountCallsFromReceipt(chainId: number, receipt: TransactionReceipt): IReceiptAccountCall[] {
  const rows: IReceiptAccountCall[] = []
  for (const log of receipt.logs) {
    if (log.topics[0] !== ACCOUNT_CALL_TOPIC) continue
    rows.push(
      accountCallFromLog(chainId, {
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        logIndex: log.logIndex,
        transactionHash: receipt.transactionHash
      })
    )
  }
  return rows
}

type IPayloadSpec = { selector: string; size: number | null; args: readonly AbiParameter[] }

const BY_SELECTOR: ReadonlyMap<Hex, readonly IPayloadSpec[]> = (() => {
  const map = new Map<Hex, IPayloadSpec[]>()
  for (const methods of Object.values(ACCOUNT_CALL_MAP)) {
    for (const spec of Object.values(methods) as IPayloadSpec[]) {
      const key = spec.selector as Hex
      const list = map.get(key)
      if (list) list.push(spec)
      else map.set(key, [spec])
    }
  }
  return map
})()

export function decodeAccountCall(entry: { source: Address; executionData: Hex }): IAccountCallEntry {
  const data = entry.executionData
  const byteLength = size(data)
  const selector = slice(data, 0, 4)
  const specs = BY_SELECTOR.get(selector)
  if (!specs) throw new Error(`unknown executionData selector ${selector} from source ${entry.source}`)
  const spec = specs.find(s => s.size === byteLength) ?? specs.find(s => s.size === null)
  if (!spec) throw new Error(`selector ${selector} has no payload schema for ${byteLength} bytes`)
  const [, ...values] = decodeAbiParameters([{ type: 'bytes4' }, ...spec.args], data)
  const decoded: Record<string, unknown> = { selector: spec.selector, size: spec.size ?? byteLength }
  spec.args.forEach((param, i) => {
    decoded[(param as { name: string }).name] = values[i]
  })
  return decoded as IAccountCallEntry
}

export const ERC20_TRANSFER_TOPIC: Hex = toEventSelector('Transfer(address,address,uint256)')

export const WRAPPED_NATIVE_DEPOSIT_TOPIC: Hex = toEventSelector('Deposit(address,uint256)')

export function swapDeliveryOf(chainId: number, entry: { source: Address; executionData: Hex }): Address | null {
  if (size(entry.executionData) < 4 || slice(entry.executionData, 0, 4) !== ACCOUNT_CALL_MAP.Deposit.fundSwap.selector) return null
  const swap = decodeAccountCall(entry) as IAccountCall__Deposit_fundSwap
  if (swap.destinationChainId !== BigInt(chainId) || isAddressEqual(swap.outputToken, PROTOCOL.nativeToken)) return null
  return getAddress(swap.outputToken)
}

export function swapDeliveryAmount(chainId: number, account: Address, token: Address, log: Pick<IReceiptLog, 'address' | 'topics' | 'data'>): bigint | null {
  if (!isAddressEqual(log.address, token) || size(log.data) !== 32) return null
  const recipient =
    log.topics[0] === ERC20_TRANSFER_TOPIC && log.topics.length === 3
      ? log.topics[2]!
      : log.topics[0] === WRAPPED_NATIVE_DEPOSIT_TOPIC && log.topics.length === 2 && isAddressEqual(token, wrappedNativeAddressOf(chainId as ChainId))
        ? log.topics[1]!
        : null
  return recipient !== null && isAddressEqual(slice(recipient, 12), account) ? hexToBigInt(log.data) : null
}

export async function swapDeliveryLogs(
  client: AccountClient,
  chainId: number,
  entries: readonly { account: Address; source: Address; executionData: Hex; transactionHash: Hex }[]
): Promise<(IReceiptLog & { transactionHash: Hex })[]> {
  const wanted = new Map<Hex, { account: Address; token: Address }[]>()
  for (const entry of entries) {
    const token = swapDeliveryOf(chainId, entry)
    if (token !== null) wanted.set(entry.transactionHash, [...(wanted.get(entry.transactionHash) ?? []), { account: getAddress(entry.account), token }])
  }
  const receipts = await Promise.all([...wanted].map(async ([hash, swaps]) => ({ swaps, receipt: await getTransactionReceipt(client, { hash }) })))
  return receipts.flatMap(({ swaps, receipt }) =>
    receipt.logs
      .filter(log => swaps.some(swap => swapDeliveryAmount(chainId, swap.account, swap.token, log) !== null))
      .map(log => ({ address: getAddress(log.address), topics: [...log.topics], data: log.data, logIndex: log.logIndex, transactionHash: receipt.transactionHash }))
  )
}
