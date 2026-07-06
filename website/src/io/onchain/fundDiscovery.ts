import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS, { hub } from '@puppet/contracts/deployments'
import { CONTRACT_EVENT_MAP } from '@puppet/contracts/events'
import type { ChainId } from '@puppet/sdk/const'
import { type Address, decodeAbiParameters, getAddress, type Hex, parseAbiItem, toEventSelector, toHex } from 'viem'
import { readCacheJson, SHARED_VIEW_BUCKET, writeCacheJson } from '../../app/swCache.js'
import { homePublicClient } from '../../wallet/wallet.js'
import context from '../context.js'
import { viewCall } from './viewRead.js'

// Boot-time discovery of the funds a wallet MASTERS, straight off the chain — no indexer in the path. A fund's canonical
// creation is a single hub-chain event (Issue.createShareToken → PuppetEventLog "CreateShareToken" on the Dictate log
// address). `master` rides the abi-encoded payload, NOT a topic, so the node can only filter to "all CreateShareToken
// logs"; ownership is the client-side filter `master === PA`. That set is global (identical for every wallet), so it's
// cached device-wide with a safe-head block cursor: the first boot pays a deploy→head scan, every boot after scans only
// the new tail. The chain is the cross-device sync layer — a new device or a stale one both just reconcile forward.

const CREATE_SHARE_TOKEN = CONTRACT_EVENT_MAP.Issue.CreateShareToken
const DEPLOY_PUPPET_ACCOUNT = CONTRACT_EVENT_MAP.Account.DeployPuppetAccount
const PUPPET_EVENT_TOPIC0 = toEventSelector(
  parseAbiItem('event PuppetEventLog(address indexed source, string indexed method, bytes data)')
)

const DICTATE = getAddress(DEPLOYMENTS[`Dictate:${HUB_CHAIN_ID}`].address)
const DEPLOY_BLOCK = BigInt(DEPLOYMENTS[`Dictate:${HUB_CHAIN_ID}`].block)
const HUB = HUB_CHAIN_ID as ChainId

// Advance the cursor to head − CONFIRMATIONS so a reorg never strands a creation above it, and re-scan REORG_OVERLAP
// blocks below the stored cursor each pass so a reorg within the confirmation window is absorbed (union dedups by key).
const CONFIRMATIONS = 12n
const REORG_OVERLAP = 64n

// Persisted in the SW's shared view bucket — the same place `global: true` view reads live, since these records are
// global/deterministic (immutable once mined, identical for every wallet). Riding that bucket means the app's existing
// lifecycle applies for free: it survives reloads and wallet switches, and is wiped on SW activation (a new deploy /
// universe change), which is exactly when the cursor should reset to a full deploy→head scan.
const CACHE_KEY = '/fund-discovery/chainScan:v2'

// All-hex-string records round-trip through the JSON cache verbatim (stored checksummed at decode).
interface IFundCreation {
  fund: Address
  master: Address
  baseToken: Address
  name: Hex
  shareToken: Address
}

// One hub DeployPuppetAccount record: the chain's own user→signer registry (route derives from account).
export interface IPuppetDeploy {
  user: Address
  signer: Address
  account: Address
}

interface IChainScan {
  cursor: number
  funds: IFundCreation[]
  deploys: IPuppetDeploy[]
}

const readScanCache = (): Promise<IChainScan> =>
  readCacheJson<IChainScan>(SHARED_VIEW_BUCKET, CACHE_KEY, { cursor: 0, funds: [], deploys: [] })

// eth_getLogs over an explicit topic filter (topic0 = PuppetEventLog, topic2 = the method hashes as an OR-list); topic1
// (source) is left open. One request covers both event kinds; topic2 discriminates the decode.
async function scanRange(from: bigint, to: bigint, out: IChainScan): Promise<void> {
  const logs = (await homePublicClient.request({
    method: 'eth_getLogs',
    params: [
      {
        address: DICTATE,
        topics: [PUPPET_EVENT_TOPIC0, null, [CREATE_SHARE_TOKEN.hash as Hex, DEPLOY_PUPPET_ACCOUNT.hash as Hex]],
        fromBlock: toHex(from),
        toBlock: toHex(to)
      }
    ]
  })) as unknown as { data: Hex; topics: Hex[] }[]
  for (const log of logs) {
    // Raw log data = abi.encode(bytes payload) — peel the envelope, then decode the event args per topic2.
    const payload = decodeAbiParameters([{ type: 'bytes' }], log.data)[0] as Hex
    if (log.topics[2] === CREATE_SHARE_TOKEN.hash) {
      const [fund, master, baseToken, name, shareToken] = decodeAbiParameters(CREATE_SHARE_TOKEN.args, payload)
      out.funds.push({
        fund: getAddress(fund as string),
        master: getAddress(master as string),
        baseToken: getAddress(baseToken as string),
        name: name as Hex,
        shareToken: getAddress(shareToken as string)
      })
    } else {
      const [user, signer, account] = decodeAbiParameters(DEPLOY_PUPPET_ACCOUNT.args, payload)
      out.deploys.push({
        user: getAddress(user as string),
        signer: getAddress(signer as string),
        account: getAddress(account as string)
      })
    }
  }
}

// Sparse events over a huge range: try the whole window in one request, bisect only when the provider rejects it (a
// block-range or result-count cap). Two hard bounds keep a DEGRADED transport (proxy down, public-RPC fallback with a
// tiny getLogs cap) from fracturing the scan into a request flood: a per-pass request budget, and a bisection floor —
// a window this small failing is a real outage, not a cap, so it aborts the pass instead of splitting further.
const SCAN_REQUEST_BUDGET = 128
const MIN_SCAN_WINDOW = 512n

async function scanAdaptive(from: bigint, to: bigint, out: IChainScan, budget: { left: number }): Promise<void> {
  if (from > to) return
  if (--budget.left < 0) throw new Error('scan aborted: request budget exhausted (degraded RPC)')
  try {
    await scanRange(from, to, out)
  } catch (err) {
    if (to - from < MIN_SCAN_WINDOW) throw err
    const mid = from + (to - from) / 2n
    await scanAdaptive(from, mid, out, budget)
    await scanAdaptive(mid + 1n, to, out, budget)
  }
}

// The global scan is shared: one in-flight promise coalesces the boot call and any concurrent callers. A failed pass
// (budget abort, outage) backs the scan off: subsequent callers get the cached set immediately instead of each caller
// (warm-up, recovery, discovery) re-launching its own doomed blast against a degraded transport.
const SCAN_FAIL_BACKOFF_MS = 60_000
let scanInflight: Promise<IChainScan> | null = null
let scanBackoffUntil = 0

async function refreshGlobalSet(): Promise<IChainScan> {
  if (scanInflight) return scanInflight
  if (Date.now() < scanBackoffUntil) return readScanCache()
  scanInflight = (async () => {
    const cached = await readScanCache()
    const byFund = new Map<Address, IFundCreation>(cached.funds.map(r => [r.fund, r]))
    const byAccount = new Map<Address, IPuppetDeploy>(cached.deploys.map(r => [r.account, r]))
    const current = (cursor: number): IChainScan => ({ cursor, funds: [...byFund.values()], deploys: [...byAccount.values()] })

    // Reuse the head the app already tracks (getChainLiveness, TTL-cached) instead of a fresh getBlockNumber round-trip.
    // Hub unreachable (no live head) => serve the cached set, don't scan.
    const head = (await context.getChainLiveness()).chains[HUB_CHAIN_ID]?.block.number
    if (head === undefined) return current(cached.cursor)
    const safeHead = head - CONFIRMATIONS
    const overlapFrom = BigInt(cached.cursor) - REORG_OVERLAP
    const from = cached.cursor > 0 && overlapFrom > DEPLOY_BLOCK ? overlapFrom : DEPLOY_BLOCK
    if (safeHead < from) return current(cached.cursor)

    const fresh: IChainScan = { cursor: Number(safeHead), funds: [], deploys: [] }
    try {
      await scanAdaptive(from, safeHead, fresh, { left: SCAN_REQUEST_BUDGET })
    } catch (err) {
      scanBackoffUntil = Date.now() + SCAN_FAIL_BACKOFF_MS
      throw err
    }
    for (const r of fresh.funds) byFund.set(r.fund, r)
    for (const r of fresh.deploys) byAccount.set(r.account, r)

    // Rows and the advanced cursor persist together in one blob — a write failure leaves the cursor unmoved and the next
    // boot re-scans the same tail rather than skipping past unstored logs.
    const result = current(Number(safeHead))
    await writeCacheJson<IChainScan>(SHARED_VIEW_BUCKET, CACHE_KEY, result)
    return result
  })().finally(() => {
    scanInflight = null
  })
  return scanInflight
}

// Warm the scan at module load (fire-and-forget): the deploy→head getLogs overlaps wagmi reconnect and first paint
// instead of gating a fresh device's signer recovery. The in-flight coalescing makes any later caller join this pass,
// and a warmed cursor turns every subsequent boot into a cheap tail scan.
void refreshGlobalSet().catch(() => {})

// The chain's own user→signer recovery: a returning wallet on a fresh device (no stored session) still resolves its PA
// identity from the hub DeployPuppetAccount log, so state DISPLAYS without a signature; signing stays lazy in the
// drawer (bindSession at action, deriving the same signer deterministically). Undefined => never deployed on hub.
// CACHE-FIRST: a deploy record is immutable, so a cached hit is final — serve it without awaiting the tail scan and
// keep the boot seed off the getLogs critical path. Only a miss (fresh device, or deployed since the last scan) pays
// the live reconcile.
export async function recoverPuppetIdentity(user: Address): Promise<IPuppetDeploy | undefined> {
  const target = getAddress(user)
  const cached = await readScanCache()
  const hit = cached.deploys.find(d => d.user === target)
  if (hit) return hit
  return (await refreshGlobalSet()).deploys.find(d => d.user === target)
}

// A discovered fund: creation identity + the on-chain economics that HAVE a getter, all authoritative. Excludes
// navPerShare (attested NAV / supply — no getter; needs oracle valuation) and totalAllocated (lifetime cumulative — no
// getter; needs an Allocate-log replay); those stay the caller's concern.
export interface IDiscoveredFund extends IFundCreation {
  totalShareSupply: bigint
  queuedShares: bigint
  epoch: bigint
  accruedPerWeight: bigint
  weight: bigint
  liquidationRate: bigint
  // Proxy: the pool is seeded once shares exist. (The indexer's flag never resets on full redemption; this does.)
  seeded: boolean
}

// queuedShares = the shares the RedeemStore custodies (Redeem.sol `_storeShares = shareToken.balanceOf(store)`); pool
// primitives from RedeemStore.getPool / liquidationRateMap; supply from the fund's own ShareToken clone. `global: true`
// caches in the shared bucket — this state is fund-scoped, not per-wallet.
async function hydrate(f: IFundCreation): Promise<IDiscoveredFund> {
  const store = hub.RedeemStore
  const shareAbi = hub.ShareToken.abi
  const [totalShareSupply, queuedShares, pool, liquidationRate] = await Promise.all([
    viewCall({ chainId: HUB, address: f.shareToken, abi: shareAbi, functionName: 'totalSupply', global: true }) as Promise<bigint>,
    viewCall({
      chainId: HUB,
      address: f.shareToken,
      abi: shareAbi,
      functionName: 'balanceOf',
      args: [store.address],
      global: true
    }) as Promise<bigint>,
    viewCall({ chainId: HUB, address: store.address, abi: store.abi, functionName: 'getPool', args: [f.fund], global: true }) as Promise<{
      epoch: bigint
      accruedPerWeight: bigint
      weight: bigint
    }>,
    viewCall({
      chainId: HUB,
      address: store.address,
      abi: store.abi,
      functionName: 'liquidationRateMap',
      args: [f.fund],
      global: true
    }) as Promise<bigint>
  ])
  return {
    ...f,
    totalShareSupply,
    queuedShares,
    epoch: pool.epoch,
    accruedPerWeight: pool.accruedPerWeight,
    weight: pool.weight,
    liquidationRate,
    seeded: totalShareSupply > 0n
  }
}

// The funds `pa` masters, reconciled from the chain and hydrated via cache-first getters. A fund whose reads fail is
// dropped (not emitted with fabricated zeros) so the caller keeps its prior row rather than showing a fake-empty fund.
export async function discoverMasteredFunds(pa: Address): Promise<IDiscoveredFund[]> {
  const target = getAddress(pa)
  const mastered = (await refreshGlobalSet()).funds.filter(r => r.master === target)
  const hydrated = await Promise.all(mastered.map(f => hydrate(f).catch(() => null)))
  return hydrated.filter(h => h !== null)
}
