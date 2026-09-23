import { accountmoduleAbi } from '@puppet/contracts/abi'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { accountCallEvent } from '@puppet/contracts/events'
import { ACCOUNT_CALL_MAP, decodeAccountCall, type IReceiptLog } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { verifyAccountCall } from '@puppet/sdk/intent'
import { type Address, getAddress, type Log, zeroHash } from 'viem'
import { publicClientMap } from '../../wallet/wallet.js'
import { attestorAddress } from '../matchmaker/index.js'
import { viewCall } from '../onchain/viewRead.js'
import { type IStoredAccountCall, readAccountCalls, writeAccountCalls } from './callStore.js'

type IAccountCallLog = Log<bigint, number, false, typeof accountCallEvent, true>

interface ITxRecord {
  value: bigint
  logs: IReceiptLog[]
}

export function accountModuleOf(chainId: ChainId): { address: Address; block: bigint } {
  const deployed = (DEPLOYMENTS as Record<string, { address: Address; block: number } | undefined>)[`AccountModule:${chainId}`]
  if (!deployed) throw new Error(`no AccountModule deployment recorded for chain ${chainId}`)
  return { address: deployed.address, block: BigInt(deployed.block) }
}

export function accountHead(chainId: ChainId, account: Address, maxAge?: number): Promise<bigint> {
  return viewCall({
    chainId,
    address: accountModuleOf(chainId).address,
    abi: accountmoduleAbi,
    functionName: 'accountBlockMap',
    args: [account],
    maxAge
  })
}

const toStored = (log: IAccountCallLog, tx: ITxRecord): IStoredAccountCall => ({
  modulePrevBlock: log.args.modulePrevBlock,
  accountPrevBlock: log.args.accountPrevBlock,
  source: log.args.source,
  digest: log.args.digest,
  signature: log.args.signature,
  executionData: log.args.executionData,
  value: tx.value,
  logs: tx.logs,
  callList: log.args.callList.map(c => ({
    target: c.target,
    value: c.value,
    gasLimit: c.gasLimit,
    callData: c.callData
  })),
  resultList: [...log.args.resultList],
  blockNumber: log.blockNumber,
  blockTimestamp: Number(log.args.blockTimestamp),
  logIndex: log.logIndex,
  transactionHash: log.transactionHash
})

async function walkPointers(chainId: ChainId, account: Address, head: bigint, floor: bigint, afterBlock: bigint): Promise<IStoredAccountCall[]> {
  const module = accountModuleOf(chainId).address
  const out: IStoredAccountCall[] = []
  let block = head
  while (block > afterBlock) {
    if (block < floor) throw new Error(`the log of ${account} on ${chainId} points at block ${block} below the AccountModule floor ${floor}`)
    const logs = await publicClientMap[chainId].getLogs({
      address: module,
      event: accountCallEvent,
      args: { account },
      strict: true,
      fromBlock: block,
      toBlock: block
    })
    if (logs.length === 0) throw new Error(`block ${block} carries no AccountCall for ${account} on ${chainId}; its block link chain is broken`)
    const records = new Map(
      await Promise.all(
        [...new Set(logs.map(l => l.transactionHash))].map(async hash => {
          const [tx, receipt] = await Promise.all([
            publicClientMap[chainId].getTransaction({ hash }),
            publicClientMap[chainId].getTransactionReceipt({ hash })
          ])
          const record: ITxRecord = {
            value: tx.value,
            logs: receipt.logs.map(l => ({ address: getAddress(l.address), topics: [...l.topics], data: l.data, logIndex: l.logIndex }))
          }
          return [hash, record] as const
        })
      )
    )
    let next = block
    for (const log of logs) {
      const record = records.get(log.transactionHash)
      if (record === undefined) throw new Error(`transaction ${log.transactionHash} was not fetched for its AccountCall`)
      if (log.args.accountPrevBlock < next) next = log.args.accountPrevBlock
      out.push(toStored(log, record))
    }
    if (next === block) throw new Error(`every AccountCall of ${account} in block ${block} points at its own block; the chain is broken`)
    block = next
  }
  return out.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex))
}

export async function walkAccount(chainId: ChainId, account: Address, user: Address, head: bigint): Promise<IStoredAccountCall[]> {
  const cached = await readAccountCalls(chainId, account)
  const afterBlock = cached.length > 0 ? cached[cached.length - 1]!.blockNumber : 0n
  if (head <= afterBlock) return cached

  const fetched = await walkPointers(chainId, account, head, accountModuleOf(chainId).block, afterBlock)
  if (fetched.length === 0) return cached

  let prevBlock = afterBlock
  for (const f of fetched) {
    if (f.accountPrevBlock !== prevBlock) {
      throw new Error(`entry chain broken for ${account} at block ${f.blockNumber}: accountPrevBlock ${f.accountPrevBlock} does not link ${prevBlock}`)
    }
    prevBlock = f.blockNumber
  }

  let epoch = 0n
  for (const s of [...cached, ...fetched]) {
    const record = decodeAccountCall(s)
    if (record.selector === ACCOUNT_CALL_MAP.UserAccount.revokeSessions.selector) {
      epoch = record.epoch
      continue
    }
    if (s.digest === zeroHash) continue
    if (fetched.includes(s)) {
      await verifyAccountCall({ account, nonce: s.blockNumber, digest: s.digest, signature: s.signature }, { user, attestor: attestorAddress, epoch })
    }
  }

  await writeAccountCalls(chainId, account, fetched).catch((err: unknown) =>
    console.error(`journal cache write failed for ${account}; entries refetch next sync`, err)
  )
  return [...cached, ...fetched]
}
