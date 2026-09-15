import { HUB_CHAIN_ID, SPOKE_CHAIN_IDS } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { accountTable } from '@puppet/sdk/schema'
import { bondTokenOf } from '@puppet/sdk/state'
import { type Address, getAddress, type Hex, isAddressEqual, size } from 'viem'
import type { IAccountBalance, IRootState } from '../../wallet/root.js'
import { client as chronicle } from '../datastore/reads.js'
import { accountHead, walkAccount } from './archive.js'
import type { IStoredAccountCall } from './callStore.js'
import { readAccountCalls } from './callStore.js'
import { foldOwnAccount, type IOwnState } from './localFold.js'

const CHAINS = [HUB_CHAIN_ID, ...SPOKE_CHAIN_IDS] as ChainId[]

export async function pinned<T>(read: () => Promise<T>): Promise<T> {
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

export type IChronicleStanding = { behind: Map<ChainId, number> } | { unreachable: string } | { disagrees: string }

async function witnessedBy(root: Address, state: IJournalState, unreachable: ReadonlySet<ChainId>): Promise<IChronicleStanding> {
  let rows: { chainId: bigint; lastBlock: number; lastLogIndex: number }[]
  try {
    rows = await chronicle.select(accountTable, { where: { account: root } })
  } catch (err) {
    return { unreachable: err instanceof Error ? err.message : String(err) }
  }
  const behind = new Map<ChainId, number>()
  for (const chainId of CHAINS) {
    if (unreachable.has(chainId)) continue
    const held = state.entries.get(chainId)
    const list = held === undefined ? [] : held
    const row = rows.find(r => Number(r.chainId) === chainId)
    if (row === undefined) {
      behind.set(chainId, list.length)
      continue
    }
    const at = list.findIndex(e => e.blockNumber === BigInt(row.lastBlock) && e.logIndex === row.lastLogIndex)
    if (at < 0) {
      return { disagrees: `the chronicle folded ${root} on chain ${chainId} to block ${row.lastBlock}#${row.lastLogIndex}, an entry the chain does not hold for it` }
    }
    behind.set(chainId, list.length - 1 - at)
  }
  return { behind }
}

const cursorOf = (state: IJournalState, chainId: ChainId): bigint => {
  const list = state.entries.get(chainId)
  return list === undefined || list.length === 0 ? 0n : list[list.length - 1]!.blockNumber
}

const FRESH_INTENT_NONCE = 1n

const nonceOf = (state: IJournalState, chainId: ChainId): bigint => {
  const list = state.entries.get(chainId)
  if (list === undefined) return FRESH_INTENT_NONCE
  return FRESH_INTENT_NONCE + BigInt(list.filter(e => size(e.signature) >= 130).length)
}

async function loadState(root: Address): Promise<IJournalState> {
  const state: IJournalState = { entries: new Map() }
  await Promise.all(
    CHAINS.map(async chainId => {
      const stored = await readAccountCalls(chainId, root).catch((err: unknown) => {
        console.error(`journal cache read failed for ${root} chain ${chainId}; rebuilding from chain`, err)
        return [] as IStoredAccountCall[]
      })
      if (stored.length === 0) return
      if (stored[0]!.accountPrevBlock !== 0n) {
        throw new Error(`cached calls for ${root} on ${chainId} start after block ${stored[0]!.accountPrevBlock}, not genesis; the account history must be complete`)
      }
      state.entries.set(chainId, stored)
    })
  )
  return state
}

export const PROBE_MAX_AGE_MS = 5_000
const SETTLE_CATCHUP_MS = 30_000
const SETTLE_RETRY_MS = 1_500

function openJournal(root: Address) {
  let loaded: Promise<IJournalState> | null = null
  let mutex: Promise<unknown> = Promise.resolve()
  let deployedSet: Set<ChainId> = new Set()
  let unreachableSet: Set<ChainId> = new Set()
  let chronicleStanding: IChronicleStanding = { unreachable: 'the journal has not synced yet' }
  let probeMaxAge = PROBE_MAX_AGE_MS

  const load = () => (loaded ??= loadState(root))

  const advance = () => {
    const run = mutex.then(async () => {
      const state = await load()
      try {
        const maxAge = probeMaxAge
        probeMaxAge = PROBE_MAX_AGE_MS
        const heads = new Map<ChainId, bigint>()
        const deployed = new Set<ChainId>()
        const unreachable = new Set<ChainId>()
        await Promise.all(
          CHAINS.map(async chainId => {
            try {
              const head = await accountHead(chainId, root, maxAge)
              heads.set(chainId, head)
              if (head > 0n) deployed.add(chainId)
            } catch (err) {
              if (chainId === HUB_CHAIN_ID) throw err
              unreachable.add(chainId)
              console.error(`journal spoke ${chainId} probe failed; its body and balances there are unknown this sync`, err)
            }
          })
        )
        for (const c of CHAINS) if (state.entries.has(c)) deployed.add(c)

        for (const chainId of CHAINS) {
          const head = heads.get(chainId) ?? 0n
          if (head <= cursorOf(state, chainId)) continue
          try {
            const stored = await walkAccount(chainId, root, head)
            if (stored.length === 0) {
              throw new Error(`walked calls for ${root} on ${chainId} came back empty while its log head is block ${head}`)
            }
            if (stored[0]!.accountPrevBlock !== 0n) {
              throw new Error(`walked calls for ${root} on ${chainId} start after block ${stored[0]!.accountPrevBlock}, not genesis; the account history must be complete`)
            }
            state.entries.set(chainId, stored)
          } catch (err) {
            if (chainId === HUB_CHAIN_ID) throw err
            unreachable.add(chainId)
            console.error(`journal spoke ${chainId} sync failed; entries retried next sync`, err)
          }
        }
        deployedSet = deployed
        unreachableSet = unreachable
        chronicleStanding = await witnessedBy(root, state, unreachable)
        return state
      } catch (err) {
        loaded = null
        throw err
      }
    })
    mutex = run.catch(() => {})
    return run
  }

  let folded: { cursors: string; own: Promise<IOwnState> } | null = null
  const foldOwn = (state: IJournalState): Promise<IOwnState> => {
    const cursors = CHAINS.map(c => `${c}:${cursorOf(state, c)}`).join('|')
    if (folded?.cursors === cursors) return folded.own
    const own = foldOwnAccount({ account: root, entries: state.entries })
    folded = { cursors, own }
    return own
  }

  const ledgerBalances = async (state: IJournalState): Promise<IAccountBalance[]> =>
    (await foldOwn(state)).deposits
      .filter(row => row.deposit > 0n)
      .map(row => ({ chainId: Number(row.chainId) as ChainId, token: getAddress(row.token), balance: row.deposit }))

  const bondedAmount = async (state: IJournalState): Promise<bigint> => {
    const token = bondTokenOf(HUB_CHAIN_ID)
    const row = (await foldOwn(state)).bonds.find(r => Number(r.chainId) === HUB_CHAIN_ID && isAddressEqual(r.token, token))
    return row === undefined ? 0n : row.bond
  }

  const foldOf = async (state: IJournalState) => ({
    balances: await ledgerBalances(state),
    deployed: deployedSet,
    unreachable: unreachableSet,
    chronicle: chronicleStanding,
    heads: new Map<ChainId, bigint>(CHAINS.map(c => [c, cursorOf(state, c)]))
  })

  return {
    async sync() {
      await advance()
    },
    async refresh() {
      const state = await advance()
      return foldOf(state)
    },
    async entries(): Promise<Map<ChainId, IStoredAccountCall[]>> {
      const state = await load()
      return new Map([...state.entries].map(([chainId, list]) => [chainId, [...list]]))
    },
    async nonce(chainId: ChainId): Promise<bigint> {
      return nonceOf(await load(), chainId)
    },
    async chronicle(): Promise<IChronicleStanding> {
      const standing = await witnessedBy(root, await load(), unreachableSet)
      if (!('disagrees' in standing)) return standing
      probeMaxAge = 0
      return witnessedBy(root, await advance(), unreachableSet)
    },
    async holds(chainId: ChainId, digest: Hex): Promise<boolean> {
      const list = (await load()).entries.get(chainId)
      return list !== undefined && list.some(e => e.digest === digest)
    },
    async settle(landed?: { chainId: ChainId; block: bigint }) {
      const deadline = Date.now() + SETTLE_CATCHUP_MS
      for (;;) {
        probeMaxAge = 0
        const state = await pinned(() => advance())
        if (landed === undefined || cursorOf(state, landed.chainId) >= landed.block || Date.now() > deadline) return foldOf(state)
        await new Promise(r => setTimeout(r, SETTLE_RETRY_MS))
      }
    },
    async own(): Promise<IOwnState> {
      return foldOwn(await load())
    },
    async root(user: Address): Promise<IRootState> {
      const state = await advance()
      return {
        account: root,
        user,
        deployed: deployedSet,
        unreachable: unreachableSet,
        chronicle: chronicleStanding,
        balances: await ledgerBalances(state),
        bonded: await bondedAmount(state),
        settled: null,
        pending: []
      }
    }
  }
}

export type ISettleFold = Awaited<ReturnType<ReturnType<typeof openJournal>['settle']>>

const instances = new Map<Address, ReturnType<typeof openJournal>>()

export function journal(root: Address) {
  let j = instances.get(root)
  if (!j) {
    j = openJournal(root)
    instances.set(root, j)
  }
  return j
}
