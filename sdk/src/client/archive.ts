import { accountmoduleAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, SPOKE_CHAIN_IDS } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { accountCallEvent } from '@puppet/contracts/events'
import { type Address, decodeEventLog, getAddress, type Hex, isAddressEqual, keccak256, pad, stringToHex } from 'viem'
import { ACCOUNT_CALL_MAP, ACCOUNT_CALL_TOPIC, GENESIS_TIP, type IStoredAccountCall, nextTip } from '../account/index.js'
import { decode, encode, formatThrownError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { dependenciesOf, FUNDS_DEPOSITED } from '../fold/index.js'
import { acrossSpokePoolOf, clientOf } from '../intent/index.js'
import type { IDeviceStore, IJournalDeps } from './journal.js'

export const CHAINS = [HUB_CHAIN_ID, ...SPOKE_CHAIN_IDS] as ChainId[]

const callsKey = (chainId: ChainId, account: Address): string => `calls:${chainId}:${getAddress(account)}`

export async function storedCalls(store: IDeviceStore, chainId: ChainId, account: Address): Promise<IStoredAccountCall[]> {
  return (await store.read<IStoredAccountCall[]>(callsKey(chainId, account)))?.value ?? []
}

async function storeCalls(store: IDeviceStore, chainId: ChainId, account: Address, entries: readonly IStoredAccountCall[]): Promise<void> {
  if (entries.length === 0) return
  const byEntry = new Map<string, IStoredAccountCall>()
  for (const entry of [...(await storedCalls(store, chainId, account)), ...entries]) byEntry.set(`${entry.transactionHash}-${entry.logIndex}`, entry)
  await store.write(
    callsKey(chainId, account),
    [...byEntry.values()].sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex))
  )
}

export interface IAccountTip {
  blockNumber: bigint
  digest: Hex
}

export function accountModuleOf(chainId: ChainId): { address: Address; block: bigint } {
  const deployed = (DEPLOYMENTS as Record<string, { address: Address; block: number } | undefined>)[`AccountModule:${chainId}`]
  if (!deployed) throw new Error(`no AccountModule deployment recorded for chain ${chainId}`)
  return { address: deployed.address, block: BigInt(deployed.block) }
}

export const RECORDS_FINGERPRINT = keccak256(
  stringToHex(encode({ spines: CHAINS.map(chainId => ({ chainId, ...accountModuleOf(chainId) })), record: accountCallEvent, decode: ACCOUNT_CALL_MAP }))
).slice(2, 10)

export async function accountHeads(deps: Pick<IJournalDeps, 'clients'>, chainId: ChainId, accounts: readonly Address[]): Promise<IAccountTip[]> {
  const address = accountModuleOf(chainId).address
  const tips = await clientOf(deps, chainId).multicall({
    allowFailure: false,
    contracts: accounts.map(account => ({ address, abi: accountmoduleAbi, functionName: 'accountTipMap', args: [account] }) as const)
  })
  return tips.map(([blockNumber, digest]) => ({ blockNumber, digest }))
}

async function walkPointers(
  deps: Pick<IJournalDeps, 'clients'>,
  chainId: ChainId,
  account: Address,
  head: bigint,
  floor: bigint,
  afterBlock: bigint
): Promise<IStoredAccountCall[]> {
  const module = accountModuleOf(chainId).address
  const out: IStoredAccountCall[] = []
  let block = head
  while (block > afterBlock) {
    if (block < floor) throw new Error(`the log of ${account} on ${chainId} points at block ${block} below the AccountModule floor ${floor}`)
    const logs = await deps.clients[chainId].getLogs({
      address: [module, acrossSpokePoolOf(chainId)],
      events: [accountCallEvent, FUNDS_DEPOSITED],
      fromBlock: block,
      toBlock: block
    })
    const own = logs.flatMap(log => {
      if (!isAddressEqual(log.address, module) || log.topics[0] !== ACCOUNT_CALL_TOPIC) return []
      const { args } = decodeEventLog({ abi: [accountCallEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      return isAddressEqual(args.account, account) ? [{ log, args }] : []
    })
    if (own.length === 0) throw new Error(`block ${block} carries no AccountCall for ${account} on ${chainId}; its block link chain is broken`)
    let next = block
    for (const { log, args } of own) {
      if (args.accountPrevBlock < next) next = args.accountPrevBlock
      out.push({
        modulePrevBlock: args.modulePrevBlock,
        accountPrevBlock: args.accountPrevBlock,
        source: getAddress(args.source),
        digest: args.digest,
        signature: args.signature,
        executionData: args.executionData,
        data: log.data,
        balanceList: args.balanceList.map(b => ({ token: getAddress(b.token), amount: b.amount })),
        siblingLogs: logs
          .filter(sibling => sibling.transactionHash === log.transactionHash)
          .map(sibling => ({ address: getAddress(sibling.address), topics: [...sibling.topics], data: sibling.data, logIndex: sibling.logIndex })),
        callList: args.callList.map(c => ({ target: c.target, value: c.value, gasLimit: c.gasLimit, callData: c.callData })),
        resultList: [...args.resultList],
        blockNumber: log.blockNumber,
        blockTimestamp: Number(args.blockTimestamp),
        logIndex: log.logIndex,
        transactionHash: log.transactionHash
      })
    }
    if (next === block) throw new Error(`every AccountCall of ${account} in block ${block} points at its own block; the chain is broken`)
    block = next
  }
  return out.sort((a, b) => (a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex))
}

type IServedCall = Pick<IStoredAccountCall, 'source' | 'data' | 'blockNumber' | 'logIndex' | 'transactionHash' | 'siblingLogs'>

const CALLS_PAGE_TIMEOUT_MS = 20_000

async function servedCalls(
  deps: Pick<IJournalDeps, 'chronicleUrl'>,
  owner: Address | null,
  chains: readonly ChainId[],
  held: ReadonlyMap<Address, ReadonlyMap<ChainId, bigint>>
): Promise<Map<Address, Map<ChainId, IStoredAccountCall[]>>> {
  const cursors = new Map([...held].map(([account, after]) => [account, new Map(after)]))
  const served = new Map<Address, Map<ChainId, IStoredAccountCall[]>>()
  for (;;) {
    const res = await fetch(`${deps.chronicleUrl}/calls`, {
      method: 'POST',
      body: encode({ owner, chainIds: chains, accounts: [...cursors].map(([account, after]) => ({ account, after: [...after].map(([chainId, block]) => ({ chainId, block })) })) }),
      signal: AbortSignal.timeout(CALLS_PAGE_TIMEOUT_MS)
    })
    if (res.status !== 200) throw new Error(`the chronicle answered ${res.status} for the calls of ${owner ?? [...cursors.keys()].join(', ')}: ${await res.text()}`)
    const page = decode(await res.text()) as { slices: { chainId: ChainId; account: Address; calls: IServedCall[] }[]; complete: boolean }
    const known = cursors.size
    let advanced = false
    for (const slice of page.slices) {
      if (slice.calls.length === 0) continue
      const account = getAddress(slice.account)
      const calls = slice.calls.map((call): IStoredAccountCall => {
        const { args } = decodeEventLog({ abi: [accountCallEvent], data: call.data, topics: [ACCOUNT_CALL_TOPIC, pad(account), pad(call.source)] })
        return {
          modulePrevBlock: args.modulePrevBlock,
          accountPrevBlock: args.accountPrevBlock,
          source: getAddress(call.source),
          digest: args.digest,
          signature: args.signature,
          executionData: args.executionData,
          data: call.data,
          balanceList: args.balanceList.map(b => ({ token: getAddress(b.token), amount: b.amount })),
          siblingLogs: call.siblingLogs,
          callList: args.callList.map(c => ({ target: c.target, value: c.value, gasLimit: c.gasLimit, callData: c.callData })),
          resultList: [...args.resultList],
          blockNumber: call.blockNumber,
          blockTimestamp: Number(args.blockTimestamp),
          logIndex: call.logIndex,
          transactionHash: call.transactionHash
        }
      })
      const byChain = served.get(account) ?? new Map<ChainId, IStoredAccountCall[]>()
      byChain.set(slice.chainId, [...(byChain.get(slice.chainId) ?? []), ...calls])
      served.set(account, byChain)
      const after = cursors.get(account) ?? new Map<ChainId, bigint>()
      const prior = after.get(slice.chainId)
      const last = calls[calls.length - 1]!.blockNumber
      if (prior === undefined || last > prior) advanced = true
      after.set(slice.chainId, last)
      cursors.set(account, after)
      if (owner === null) continue
      for (const call of calls) for (const reached of dependenciesOf({ account, source: call.source, executionData: call.executionData })) if (!cursors.has(getAddress(reached))) cursors.set(getAddress(reached), new Map())
    }
    if (page.complete) return served
    if (!advanced && cursors.size === known) {
      throw new Error(`the chronicle answered an incomplete page of calls that moved no account forward; asking again would loop for ${owner ?? [...cursors.keys()].join(', ')}`)
    }
  }
}

export async function accountCalls(
  deps: Pick<IJournalDeps, 'clients' | 'store'>,
  chainId: ChainId,
  account: Address,
  head: IAccountTip,
  served: readonly IStoredAccountCall[]
): Promise<IStoredAccountCall[]> {
  const cached = await storedCalls(deps.store, chainId, account)
  const after = cached.length > 0 ? cached[cached.length - 1]!.blockNumber : 0n
  if (head.blockNumber <= after && cached.reduce((prev, s) => nextTip(prev, s.source, s.data), GENESIS_TIP).toLowerCase() === head.digest.toLowerCase()) return cached

  const fresh = served.filter(call => call.blockNumber > after && call.blockNumber <= head.blockNumber)
  const bases = fresh.length > 0 ? [[...cached, ...fresh], cached] : [cached]
  for (const base of cached.length > 0 ? [...bases, []] : bases) {
    const last = base.length > 0 ? base[base.length - 1]!.blockNumber : 0n
    const all = [...base, ...(await walkPointers(deps, chainId, account, head.blockNumber, accountModuleOf(chainId).block, last))]
    if (all.reduce((prev, s) => nextTip(prev, s.source, s.data), GENESIS_TIP).toLowerCase() !== head.digest.toLowerCase()) continue
    if (all.some((call, i) => call.blockNumber !== (i + 1 < all.length ? all[i + 1]!.accountPrevBlock : head.blockNumber))) continue
    const stored = base.length === 0 && cached.length > 0 ? deps.store.write(callsKey(chainId, account), all) : storeCalls(deps.store, chainId, account, all.slice(cached.length))
    await stored.catch((err: unknown) =>
      console.error(`journal cache write failed for ${account}; entries refetch next sync`, err)
    )
    return all
  }
  throw new Error(`the history of ${account} on ${chainId} does not hash to the AccountModule tip ${head.digest} at block ${head.blockNumber} with each entry at the block its successor names, neither as served by the chronicle nor as walked from the chain`)
}

export async function syncCalls(
  deps: Pick<IJournalDeps, 'chronicleUrl' | 'clients' | 'store'>,
  owner: Address | null,
  chains: readonly ChainId[],
  accounts: readonly Address[],
  check: 'all' | 'changed'
): Promise<{ calls: Map<Address, Map<ChainId, PromiseSettledResult<IStoredAccountCall[]>>>; unreachable: string | null }> {
  const first = [...new Set(accounts.map(account => getAddress(account)))]
  const held = new Map(
    await Promise.all(
      first.map(
        async account =>
          [
            account,
            new Map(
              (await Promise.all(chains.map(async chainId => [chainId, await storedCalls(deps.store, chainId, account)] as const))).flatMap(([chainId, cached]) =>
                cached.length === 0 ? [] : [[chainId, cached[cached.length - 1]!.blockNumber] as const]
              )
            )
          ] as const
      )
    )
  )
  const answer = await servedCalls(deps, owner, chains, held).then(
    served => ({ served, unreachable: null }),
    (err: unknown) => {
      console.warn(`the chronicle could not serve the calls of ${owner ?? first.join(', ')}; walking the chain: ${formatThrownError(err)}`)
      return { served: new Map<Address, Map<ChainId, IStoredAccountCall[]>>(), unreachable: formatThrownError(err) }
    }
  )
  const trusted = check === 'changed' && answer.unreachable === null
  const calls = new Map<Address, Map<ChainId, PromiseSettledResult<IStoredAccountCall[]>>>()
  for (let frontier = [...new Set([...first, ...answer.served.keys()])]; frontier.length > 0; ) {
    const wanted = chains.map(chainId => frontier.filter(account => !trusted || (answer.served.get(account)?.get(chainId)?.length ?? 0) > 0))
    const reads = await Promise.allSettled(chains.map((chainId, c) => (wanted[c]!.length === 0 ? Promise.resolve([]) : accountHeads(deps, chainId, wanted[c]!))))
    await Promise.all(
      frontier.map(async account => {
        const settled = await Promise.allSettled(
          chains.map(async (chainId, c) => {
            const at = wanted[c]!.indexOf(account)
            if (at < 0) return storedCalls(deps.store, chainId, account)
            const read = reads[c]!
            if (read.status === 'rejected') throw read.reason
            return accountCalls(deps, chainId, account, read.value[at]!, answer.served.get(account)?.get(chainId) ?? [])
          })
        )
        calls.set(account, new Map(chains.map((chainId, c) => [chainId, settled[c]!])))
      })
    )
    if (owner === null) break
    frontier = [
      ...new Set(
        frontier.flatMap(account =>
          [...calls.get(account)!].flatMap(([chainId, result]) =>
            result.status === 'rejected'
              ? []
              : result.value
                  .filter(call => call.blockNumber > (held.get(account)?.get(chainId) ?? 0n))
                  .flatMap(call => dependenciesOf({ account, source: call.source, executionData: call.executionData }).map(reached => getAddress(reached)))
          )
        )
      )
    ].filter(account => !calls.has(account))
  }
  return { calls, unreachable: answer.unreachable }
}
