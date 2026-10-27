import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountCall__HubGate_createFund } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual, size } from 'viem'
import { ACCOUNT_CALL_MAP, decodeAccountCall, fundSymbolOf, gridOf, type IFundProfile, type IStoredAccountCall } from '../account/index.js'
import type { ChainId } from '../const/index.js'
import { readChronicleChains } from '../datastore/index.js'
import { acrossDepositOf, dependenciesOf, isAllocationRecord } from '../fold/index.js'
import { GENESIS_NONCE, type ITermsDeps } from '../intent/index.js'
import { listedTokensOf, wrappedNativeAddressOf } from '../state/index.js'
import { type IViewRead, readTokenBalance } from './account.js'
import { CHAINS, storedCalls, syncCalls } from './archive.js'
import type { IAccountBalance, IRootState } from './root.js'
import { fundRecordsOf, type IFund, type IKeyStore, selectedFundOf } from './walletKeys.js'

export interface IDeviceStore {
  read<T>(key: string): Promise<{ value: T; at: number } | null>
  write(key: string, value: unknown, ttlMs?: number): Promise<void>
}

export interface IJournalDeps extends Pick<ITermsDeps, 'clients'> {
  chronicleUrl: string
  viewCall: IViewRead
  storage: IKeyStore
  store: IDeviceStore
}

async function pinned<T>(read: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await read()
    } catch (err) {
      last = err
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  throw last
}

interface IJournalState {
  entries: Map<ChainId, IStoredAccountCall[]>
}

const bodiesKey = (owner: Address): string => `bodies:${getAddress(owner)}`

const storedBodies = async (store: IDeviceStore, owner: Address): Promise<Address[] | null> => {
  const held = await store.read<string[]>(bodiesKey(owner))
  return held === null ? null : held.value.map(account => getAddress(account))
}

const bodiesIn = (owner: Address, states: ReadonlyMap<Address, IJournalState>): Address[] =>
  [...states]
    .flatMap(([account, state]) => {
      const genesis = state.entries.get(HUB_CHAIN_ID as ChainId)?.[0]
      if (genesis === undefined) return []
      const decoded = decodeAccountCall(genesis)
      return decoded.selector === ACCOUNT_CALL_MAP.AccountModule.createAccount.selector && 'parent' in decoded && isAddressEqual(decoded.parent, owner)
        ? [{ account, block: genesis.blockNumber, log: genesis.logIndex }]
        : []
    })
    .sort((a, b) => (a.block !== b.block ? (a.block < b.block ? -1 : 1) : a.log - b.log))
    .map(body => body.account)

const profileOf = (state: IJournalState): IFundProfile | null => {
  for (const call of state.entries.get(HUB_CHAIN_ID as ChainId) ?? []) {
    const decoded = decodeAccountCall(call)
    if (decoded.selector === ACCOUNT_CALL_MAP.HubGate.createFund.selector) return decoded as IAccountCall__HubGate_createFund
  }
  return null
}

function fundListOf(storage: IKeyStore, user: Address, bodies: readonly { account: Address; profile: IFundProfile | null }[]): Pick<IRootState, 'fund' | 'funds'> {
  const held = fundRecordsOf(storage, user)
  const selected = selectedFundOf(storage, user)
  const isSelected = (fund: IFund): boolean => selected !== null && isAddressEqual(fund.account, selected)
  const next = BigInt(bodies.length)
  const pending = held.find(record => record.fund === next)
  const list: IFund[] = [
    ...bodies.flatMap(({ account, profile }, index) => {
      if (profile !== null) return [{ account, fund: BigInt(index), symbol: fundSymbolOf(profile), cells: gridOf(profile) }]
      const record = held.find(heldRecord => isAddressEqual(heldRecord.account, account))
      return record === undefined ? [] : [{ account, fund: BigInt(index), symbol: record.symbol, cells: record.cells }]
    }),
    ...(pending === undefined ? [] : [{ account: pending.account, fund: next, symbol: pending.symbol, cells: pending.cells }])
  ]
  return { fund: list.find(isSelected) ?? list[0] ?? null, funds: { list, next } }
}

const recordedBalances = (state: IJournalState): IAccountBalance[] =>
  [...state.entries].flatMap(([chainId, list]) => {
    const listed = listedTokensOf(chainId)
    const latest = new Map<Address, bigint>()
    for (const call of list) for (const b of call.balanceList) latest.set(getAddress(b.token), b.amount)
    return [...latest].flatMap(([token, balance]) =>
      balance > 0n && listed.some(r => isAddressEqual(r, token)) ? [{ chainId, token, balance }] : []
    )
  })

const arrivalsOf = (account: Address, state: IJournalState): { chainId: ChainId; token: Address }[] => {
  const seen = new Map<string, { chainId: ChainId; token: Address; deadline: number }>()
  for (const [chainId, list] of state.entries) {
    for (const call of list) {
      const d = decodeAccountCall(call)
      if (d.selector !== ACCOUNT_CALL_MAP.Deposit.depositAcross.selector || d.destinationChainId === BigInt(chainId)) continue
      const deposit = acrossDepositOf({ chainId, account, siblingLogs: call.siblingLogs, logIndex: call.logIndex })
      if (deposit === null) throw new Error(`the bridge of ${account} at ${call.transactionHash} on chain ${chainId} emitted no Across deposit`)
      const destination = Number(d.destinationChainId) as ChainId
      const output = getAddress(d.outputToken)
      const wrapped = wrappedNativeAddressOf(destination)
      const family = isAddressEqual(output, PROTOCOL.nativeToken) || isAddressEqual(output, wrapped) ? [getAddress(PROTOCOL.nativeToken), wrapped] : [output]
      for (const token of family) {
        if (!listedTokensOf(destination).some(r => isAddressEqual(r, token))) continue
        const held = seen.get(`${destination}:${token}`)
        seen.set(`${destination}:${token}`, { chainId: destination, token, deadline: held === undefined || held.deadline < deposit.fillDeadline ? deposit.fillDeadline : held.deadline })
      }
    }
  }
  return [...seen.values()]
    .filter(arrival => !(state.entries.get(arrival.chainId) ?? []).some(call => call.blockTimestamp > arrival.deadline && call.balanceList.some(b => isAddressEqual(b.token, arrival.token))))
    .map(arrival => ({ chainId: arrival.chainId, token: arrival.token }))
}

const cursorOf = (state: IJournalState, chainId: ChainId): bigint => {
  const list = state.entries.get(chainId)
  return list === undefined || list.length === 0 ? 0n : list[list.length - 1]!.blockNumber
}

const nonceOf = (state: IJournalState, chainId: ChainId): bigint => {
  const list = state.entries.get(chainId)
  if (list === undefined) return GENESIS_NONCE
  return GENESIS_NONCE + BigInt(list.filter(e => size(e.signature) >= 130 && !isAllocationRecord(decodeAccountCall(e))).length)
}

async function loadState(deps: Pick<IJournalDeps, 'store'>, root: Address): Promise<IJournalState> {
  const state: IJournalState = { entries: new Map() }
  await Promise.all(
    CHAINS.map(async chainId => {
      const stored = await storedCalls(deps.store, chainId, root).catch((err: unknown) => {
        console.error(`journal cache read failed for ${root} chain ${chainId}; rebuilding from chain`, err)
        return [] as IStoredAccountCall[]
      })
      if (stored.length === 0) return
      if (stored[0]!.accountPrevBlock !== 0n) {
        console.error(`stored calls for ${root} on ${chainId} start after block ${stored[0]!.accountPrevBlock}, not genesis; they are ignored and the next sync walks the history again`)
        return
      }
      state.entries.set(chainId, stored)
    })
  )
  return state
}

export const PROBE_MAX_AGE_MS = 5_000
const SETTLE_CATCHUP_MS = 30_000
const SETTLE_RETRY_MS = 1_500
const CHRONICLE_STATUS_TIMEOUT_MS = 10_000

export function createJournal(deps: IJournalDeps) {
  const states = new Map<Address, Promise<IJournalState>>()
  const ledger = (account: Address): Promise<IJournalState> => {
    const held = states.get(account)
    if (held !== undefined) return held
    const loading = loadState(deps, account)
    states.set(account, loading)
    loading.catch(() => {
      if (states.get(account) === loading) states.delete(account)
    })
    return loading
  }

  const closure = async (seed: readonly Address[]): Promise<Map<Address, IJournalState>> => {
    const held = new Map<Address, IJournalState>()
    for (let frontier = [...new Set(seed)]; frontier.length > 0; ) {
      const loaded = await Promise.all(frontier.map(account => ledger(account)))
      frontier.forEach((account, i) => held.set(account, loaded[i]!))
      frontier = [
        ...new Set(
          frontier.flatMap((account, i) =>
            [...loaded[i]!.entries.values()].flatMap(list => list.flatMap(call => dependenciesOf({ account, source: call.source, executionData: call.executionData }).map(reached => getAddress(reached))))
          )
        )
      ].filter(account => !held.has(account))
    }
    return held
  }

  const fundsIn = async (user: Address, bodies: readonly Address[]): Promise<Pick<IRootState, 'fund' | 'funds'>> =>
    fundListOf(deps.storage, user, await Promise.all(bodies.map(async account => ({ account, profile: profileOf(await ledger(account)) }))))

  const open = (root: Address) => {
    let mutex: Promise<unknown> = Promise.resolve()
    let deployedSet: Set<ChainId> = new Set()
    let unreachableSet: Set<ChainId> = new Set()
    let chronicleUnreachable: string | null = 'the journal has not synced yet'

    const sync = (check: 'all' | 'changed'): Promise<IJournalState> => {
      const run = mutex.then(async () => {
        const known = await closure([root, ...((await storedBodies(deps.store, root)) ?? [])])
        const synced = await syncCalls(deps, root, CHAINS, [...known.keys()], check)
        const unreachable = new Set<ChainId>()
        const held = new Map<Address, IJournalState>()
        for (const [account, byChain] of synced.calls) {
          const state = await ledger(account)
          held.set(account, state)
          for (const [chainId, result] of byChain) {
            if (result.status === 'fulfilled') {
              if (result.value.length > (state.entries.get(chainId)?.length ?? 0)) state.entries.set(chainId, result.value)
              continue
            }
            if (chainId === HUB_CHAIN_ID) throw result.reason
            console.error(`journal spoke ${chainId} sync of ${account} failed; its entries there are retried next sync`, result.reason)
            if (account === root) unreachable.add(chainId)
          }
        }
        const own = held.get(root)!
        deployedSet = new Set(CHAINS.filter(chainId => (own.entries.get(chainId)?.length ?? 0) > 0))
        unreachableSet = unreachable
        chronicleUnreachable = synced.unreachable
        if (synced.unreachable === null) {
          await deps.store.write(bodiesKey(root), bodiesIn(root, held)).catch((err: unknown) =>
            console.error(`journal could not store the bodies of ${root}; the next sync finds them again`, err)
          )
        }
        return own
      })
      mutex = run.catch(() => {})
      return run
    }

    const balancesOf = async (state: IJournalState, maxAge: number): Promise<IAccountBalance[]> => {
      const live = await Promise.all(
        arrivalsOf(root, state)
          .filter(arrival => !unreachableSet.has(arrival.chainId))
          .map(async arrival => ({ ...arrival, balance: await readTokenBalance(deps.viewCall, root, arrival.chainId, arrival.token, maxAge) }))
      )
      return [
        ...recordedBalances(state).filter(row => !live.some(l => l.chainId === row.chainId && isAddressEqual(l.token, row.token))),
        ...live.filter(l => l.balance > 0n)
      ]
    }

    const fundsOf = async (user: Address): Promise<Pick<IRootState, 'fund' | 'funds'>> => {
      const listed = await fundsIn(user, (await storedBodies(deps.store, root)) ?? [])
      if (chronicleUnreachable === null) return listed
      const unknown = `Your funds could not be looked up: the chronicle is unreachable (${chronicleUnreachable}). Retry once it answers.`
      return { fund: listed.fund ?? { unknown }, funds: { unknown } }
    }

    return {
      async sync(check: 'all' | 'changed') {
        await sync(check)
      },
      async entries(): Promise<Map<ChainId, IStoredAccountCall[]>> {
        const state = await ledger(root)
        return new Map([...state.entries].map(([chainId, list]) => [chainId, [...list]]))
      },
      async nonce(chainId: ChainId): Promise<bigint> {
        return nonceOf(await ledger(root), chainId)
      },
      async callOf(chainId: ChainId, digest: Hex): Promise<IStoredAccountCall | null> {
        return (await ledger(root)).entries.get(chainId)?.find(e => e.digest === digest) ?? null
      },
      async settle(owner: Address, landed: readonly { chainId: ChainId; block: bigint }[]) {
        const deadline = Date.now() + SETTLE_CATCHUP_MS
        for (;;) {
          const state = await pinned(() => sync('all'))
          if (landed.every(tx => cursorOf(state, tx.chainId) >= tx.block) || Date.now() > deadline) {
            const [balances, funds] = await Promise.all([balancesOf(state, 0), fundsOf(owner)])
            return { balances, deployed: deployedSet, unreachable: unreachableSet, ...funds }
          }
          await new Promise(r => setTimeout(r, SETTLE_RETRY_MS))
        }
      },
      async localRoot(user: Address): Promise<IRootState> {
        const state = await ledger(root)
        const bodies = await storedBodies(deps.store, root)
        const selected = selectedFundOf(deps.storage, user)
        const known = fundRecordsOf(deps.storage, user).find(record => selected === null || isAddressEqual(record.account, selected))
        const unknown = 'Your funds are syncing from the chronicle.'
        return {
          account: root,
          user,
          deployed: new Set(CHAINS.filter(chainId => state.entries.has(chainId))),
          unreachable: new Set(),
          balances: recordedBalances(state),
          ...(bodies === null
            ? { fund: known === undefined ? { unknown } : { account: known.account, fund: known.fund, symbol: known.symbol, cells: known.cells }, funds: { unknown } }
            : await fundsIn(user, bodies)),
          settled: null,
          syncError: null
        }
      },
      async root(user: Address, check: 'all' | 'changed'): Promise<IRootState> {
        const state = await sync(check)
        const [balances, funds] = await Promise.all([balancesOf(state, PROBE_MAX_AGE_MS), fundsOf(user)])
        return {
          account: root,
          user,
          deployed: deployedSet,
          unreachable: unreachableSet,
          balances,
          ...funds,
          settled: null,
          syncError: null
        }
      }
    }
  }

  const instances = new Map<Address, ReturnType<typeof open>>()
  return Object.assign(
    (account: Address) => {
      const key = getAddress(account)
      const held = instances.get(key)
      if (held !== undefined) return held
      const opened = open(key)
      instances.set(key, opened)
      return opened
    },
    { chains: () => readChronicleChains(deps.chronicleUrl, CHRONICLE_STATUS_TIMEOUT_MS) }
  )
}
  