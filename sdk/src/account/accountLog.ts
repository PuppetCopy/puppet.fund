import { fundaccountAbi } from '@puppet/contracts/abi'
import { ACCOUNT_CALL_MAP, accountCallEvent } from '@puppet/contracts/events'
import type { IAccountCallEntry, IIAccount__Call } from '@puppet/contracts/types'
import type { AbiParameter, Address, Chain, Client, Hex, TransactionReceipt, Transport } from 'viem'
import { decodeAbiParameters, decodeEventLog, getAddress, size, slice, toEventSelector } from 'viem'
import { readContract } from 'viem/actions'

export const ACCOUNT_CALL_TOPIC: Hex = toEventSelector(accountCallEvent)
if (
  ACCOUNT_CALL_TOPIC !==
  toEventSelector(
    'AccountCall(address,address,bytes32,uint256,uint256,uint256,bytes,bytes,(address,uint256,uint256,bytes)[],bytes[])'
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
  blockNumber: bigint
  blockTimestamp: number
  blockHash: Hex
  logIndex: number
  transactionHash: Hex
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
  const spec =
    specs.length === 1 ? specs[0]! : (specs.find(s => s.size === byteLength) ?? specs.find(s => s.size === null))
  if (!spec) throw new Error(`selector ${selector} has no payload schema for ${byteLength} bytes`)
  const [, ...values] = decodeAbiParameters([{ type: 'bytes4' }, ...spec.args], data)
  const decoded: Record<string, unknown> = { selector: spec.selector, size: byteLength }
  spec.args.forEach((param, i) => {
    decoded[(param as { name: string }).name] = values[i]
  })
  return decoded as IAccountCallEntry
}
