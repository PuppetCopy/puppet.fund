import { type Address, formatUnits, type Hex, isAddressEqual, parseAbiItem, parseUnits, type PublicClient, type TypedDataDefinition, zeroAddress } from 'viem'
import { USD_DECIMALS, USD_SYMBOL } from '../../const/common.js'
import { readableUnitAmount, readableUsd } from '../../core/readable.js'
import { ttlCached, ttlCachedByKey } from '../../state/cache.js'
import { TOKEN_META } from '../../const/network.js'
import type { IVenuePosition, IVenueValueParams } from '../types.js'
import { CCTP_CORE_DEPOSIT_WALLET, CCTP_HYPEREVM_DOMAIN, CCTP_TOKEN_MESSENGER, CCTP_TOKEN_MESSENGER_ABI, hyperCoreRecipientOf } from '../cctp.js'
import { HYPERLIQUID_BRIDGE, HYPERLIQUID_DEPOSIT_TOKEN, HYPERLIQUID_INFO_URL, HYPERLIQUID_UNIFIED_MODES } from './contracts.js'

const HYPERLIQUID_INFO_TIMEOUT_MS = 10_000
const HYPERLIQUID_READ_SKEW_MS = 10_000
const HYPERLIQUID_SHARED_TTL_MS = 60_000
const HYPERLIQUID_WEIGHT_WINDOW_MS = 60_000
const HYPERLIQUID_INFO_WEIGHT: Readonly<Record<string, number>> = {
  clearinghouseState: 2,
  spotClearinghouseState: 2,
  l2Book: 2,
  allMids: 2,
  orderStatus: 2,
  exchangeStatus: 2,
  userRole: 60
}
const HYPERLIQUID_OTHER_INFO_WEIGHT = 20
const HYPERLIQUID_ITEMS_PER_WEIGHT = 20
const HYPERLIQUID_ITEM_WEIGHTED = new Set(['userNonFundingLedgerUpdates'])
const HYPERLIQUID_SPOT_TAKER_BPS = 7n
const HYPERLIQUID_BRIDGE_WINDOW_BLOCKS = 14_400n
const LOG_CHUNK_BLOCKS = 5_000n
const LOG_HEAD_LAG_BLOCKS = 20n
const COLLATERAL = TOKEN_META.USDC.symbol
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const DEPOSIT_FOR_BURN_EVENT = CCTP_TOKEN_MESSENGER_ABI[1]
const FINALIZED_WITHDRAWAL_EVENT = parseAbiItem(
  'event FinalizedWithdrawal(address indexed user, address destination, uint64 usd, uint64 nonce, bytes32 message)'
)
const REQUESTED_WITHDRAWAL_EVENT = parseAbiItem(
  'event RequestedWithdrawal(address indexed user, address destination, uint64 usd, uint64 nonce, bytes32 message, uint64 requestedTime)'
)

export async function hyperliquidWithdrawLanding(
  client: PublicClient,
  account: Address,
  typedData: TypedDataDefinition,
  _due: bigint,
  fromBlock: bigint
): Promise<{ block: bigint; txHash: Hex } | null> {
  const nonce = BigInt((typedData.message as { time: bigint | number }).time) * 1_000n
  const landed = (await client.getLogs({ address: HYPERLIQUID_BRIDGE, event: FINALIZED_WITHDRAWAL_EVENT, args: { user: account }, fromBlock, strict: true })).find(log => log.args.nonce === nonce)
  return landed === undefined ? null : { block: landed.blockNumber, txHash: landed.transactionHash }
}

interface IHyperliquidPosition {
  position: {
    coin: string
    szi: string
    entryPx: string | null
    leverage: { type: string; value: number }
    liquidationPx: string | null
    unrealizedPnl: string
    positionValue: string
    marginUsed: string
    cumFunding: { allTime: string; sinceOpen: string; sinceChange: string }
  }
}

interface IHyperliquidPerpState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string }
  withdrawable: string
  assetPositions: IHyperliquidPosition[]
  time: number
}

interface IHyperliquidSpotState {
  balances: { coin: string; token: number; total: string; hold: string }[]
  tokenToAvailableAfterMaintenance?: [number, string][]
}

interface IHyperliquidLedgerUpdate {
  time: number
  hash: Hex
  delta: { type: string; usdc?: string; nonce?: number; fee?: string; user?: Address; destination?: Address; token?: string; amount?: string }
}

interface IHyperliquidVaultEquity {
  vaultAddress: Address
  equity: string
}

interface IHyperliquidLendState {
  tokenToState: [number, { borrow: { value: string }; supply: { value: string } }][]
}

interface IHyperliquidDexBook {
  dex: string
  perp: IHyperliquidPerpState
  collateral: string
}

interface IHyperliquidSubAccount {
  name: string
  subAccountUser: Address
  clearinghouseState: IHyperliquidPerpState
  spotState: IHyperliquidSpotState
}

const spent: { at: number; weight: number }[] = []

export function hyperliquidWeightSpent(): number {
  const now = Date.now()
  return spent.reduce((total, read) => (now - read.at < HYPERLIQUID_WEIGHT_WINDOW_MS ? total + read.weight : total), 0)
}

export async function hyperliquidInfo<T>(body: Record<string, unknown>): Promise<T> {
  const type = String(body.type)
  const sentAt = Date.now()
  while (spent.length > 0 && sentAt - spent[0]!.at >= HYPERLIQUID_WEIGHT_WINDOW_MS) spent.shift()
  spent.push({ at: sentAt, weight: HYPERLIQUID_INFO_WEIGHT[type] ?? HYPERLIQUID_OTHER_INFO_WEIGHT })
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HYPERLIQUID_INFO_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`hyperliquid info ${type} answered ${res.status}`)
  const answer: unknown = await res.json()
  if (HYPERLIQUID_ITEM_WEIGHTED.has(type) && Array.isArray(answer)) spent.push({ at: Date.now(), weight: Math.floor(answer.length / HYPERLIQUID_ITEMS_PER_WEIGHT) })
  return answer as T
}

const readPerpDexs = () => hyperliquidInfo<({ name: string } | null)[]>({ type: 'perpDexs' })
const readSpotMeta = () =>
  hyperliquidInfo<{ tokens: { index: number; name: string }[]; universe: { name: string; tokens: [number, number] }[] }>({ type: 'spotMeta' })
const readDexMeta = (dex: string) => hyperliquidInfo<{ collateralToken: number }>({ type: 'meta', dex })
const sharedPerpDexs = ttlCached(readPerpDexs, HYPERLIQUID_SHARED_TTL_MS)
const sharedSpotMeta = ttlCached(readSpotMeta, HYPERLIQUID_SHARED_TTL_MS)
const sharedDexMeta = ttlCachedByKey(HYPERLIQUID_SHARED_TTL_MS, readDexMeta)

async function readHyperliquidState(account: Address, ledgerSinceMs: number, sharedReads: boolean) {
  for (let retried = false; ; retried = true) {
    const [perp, spot, vaults, subAccounts, lending, dexList, abstraction] = await Promise.all([
      hyperliquidInfo<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account }),
      hyperliquidInfo<IHyperliquidSpotState>({ type: 'spotClearinghouseState', user: account }),
      hyperliquidInfo<IHyperliquidVaultEquity[]>({ type: 'userVaultEquities', user: account }),
      hyperliquidInfo<IHyperliquidSubAccount[] | null>({ type: 'subAccounts', user: account }),
      hyperliquidInfo<IHyperliquidLendState>({ type: 'borrowLendUserState', user: account }),
      sharedReads ? sharedPerpDexs() : readPerpDexs(),
      hyperliquidInfo<string>({ type: 'userAbstraction', user: account })
    ])
    const books = await Promise.all(
      dexList
        .filter((d): d is { name: string } => d !== null)
        .map(async d => ({ dex: d.name, perp: await hyperliquidInfo<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account, dex: d.name }) }))
    )
    const used = books.filter(b => b.perp.assetPositions.length > 0 || usd(b.perp.marginSummary.accountValue) !== 0n)
    const [metas, spotMeta, ledger] = await Promise.all([
      Promise.all(used.map(b => (sharedReads ? sharedDexMeta(b.dex) : readDexMeta(b.dex)))),
      used.length === 0 ? null : sharedReads ? sharedSpotMeta() : readSpotMeta(),
      hyperliquidInfo<IHyperliquidLedgerUpdate[]>({ type: 'userNonFundingLedgerUpdates', user: account, startTime: ledgerSinceMs })
    ])
    const moved = ledger.find(e => e.time > perp.time - HYPERLIQUID_READ_SKEW_MS)
    if (moved !== undefined) {
      if (retried) {
        throw new Error(`hyperliquid kept moving value (${moved.delta.type} at ${new Date(moved.time).toISOString()}) while the books of ${account} were read; the next sync reads them again`)
      }
      await new Promise(resolve => setTimeout(resolve, moved.time + HYPERLIQUID_READ_SKEW_MS - perp.time))
      continue
    }
    const dexes: IHyperliquidDexBook[] = used.map((b, i) => {
      const token = spotMeta!.tokens.find(t => t.index === metas[i]!.collateralToken)
      if (token === undefined) throw new Error(`hyperliquid dex ${b.dex} margins in spot token ${metas[i]!.collateralToken}, which spotMeta does not list`)
      return { ...b, collateral: token.name }
    })
    return { perp, spot, ledger, vaults, subAccounts: subAccounts ?? [], lending, dexes, unified: HYPERLIQUID_UNIFIED_MODES.has(abstraction) }
  }
}

export const perpCashKeyOf = (tag: string): string => `${tag}:perp-cash`
export const spotKeyOf = (tag: string, coin: string): string => `${tag}:spot:${coin}`

const usd = (decimal: string): bigint => parseUnits(decimal, USD_DECIMALS)

const coinAmount = (decimal: string): bigint => parseUnits(decimal, USD_DECIMALS)

export interface IHyperliquidObservation {
  unified: boolean
  books: {
    tag: string
    holder: Address
    collateral: string
    rawUsd: bigint
    positions: { coin: string; size: bigint; entry: bigint; leverage: number; isolatedMargin: bigint | null }[]
  }[]
  spot: { tag: string; holder: Address; coin: string; cash: bigint }[]
  lending: { token: number; supply: bigint; borrow: bigint }[]
  vaults: { vaultAddress: Address; equity: bigint }[]
  transits: { key: string; contract: Address | undefined; label: string; amount: bigint; note: string }[]
}

const USD_UNIT = 10n ** BigInt(USD_DECIMALS)

export function hyperliquidCollateralUsd(symbol: string, rate: { token0: bigint; token1: bigint }): (amount: bigint) => bigint {
  const meta = Object.values(TOKEN_META).find(m => m.symbol === symbol)
  if (meta === undefined) throw new Error(`hyperliquid holds margin in ${symbol}, which the oracle does not price`)
  if (rate.token1 === 0n) throw new Error(`rate ${symbol}/${USD_SYMBOL} has a zero denominator`)
  const scale = 10n ** BigInt(USD_DECIMALS - meta.decimals)
  return amount => (amount * rate.token0) / (rate.token1 * scale)
}

export async function readHyperliquidObservation({ chainId, account, blockNumber, blockTimestamp, clients, sharedReads }: Omit<IVenueValueParams, 'getRate' | 'freshness' | 'nowSec'>) {
  const client = clients[chainId]
  if (client === undefined) throw new Error('hyperliquid bridge reconciliation needs a chain client')
  const fromBlock = blockNumber > HYPERLIQUID_BRIDGE_WINDOW_BLOCKS ? blockNumber - HYPERLIQUID_BRIDGE_WINDOW_BLOCKS : 0n
  const head = await client.getBlockNumber()
  const requestedBy = head - LOG_HEAD_LAG_BLOCKS > blockNumber ? head - LOG_HEAD_LAG_BLOCKS : blockNumber
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
  for (let from = fromBlock; from <= requestedBy; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n
    ranges.push({ fromBlock: from, toBlock: to < requestedBy ? to : requestedBy })
  }
  const marked = ranges.flatMap(r => (r.fromBlock > blockNumber ? [] : [{ fromBlock: r.fromBlock, toBlock: r.toBlock < blockNumber ? r.toBlock : blockNumber }]))
  const [sends, burnLogs, requests, landings, windowStart] = await Promise.all([
    Promise.all(
      marked.map(r => client.getLogs({ address: HYPERLIQUID_DEPOSIT_TOKEN, event: TRANSFER_EVENT, args: { from: account, to: HYPERLIQUID_BRIDGE }, ...r }))
    ).then(l => l.flat()),
    Promise.all(marked.map(r => client.getLogs({ address: CCTP_TOKEN_MESSENGER, event: DEPOSIT_FOR_BURN_EVENT, args: { depositor: account }, ...r }))).then(l =>
      l.flat()
    ),
    Promise.all(ranges.map(r => client.getLogs({ address: HYPERLIQUID_BRIDGE, event: REQUESTED_WITHDRAWAL_EVENT, args: { user: account }, ...r }))).then(l =>
      l.flat()
    ),
    Promise.all(marked.map(r => client.getLogs({ address: HYPERLIQUID_BRIDGE, event: FINALIZED_WITHDRAWAL_EVENT, args: { user: account }, ...r }))).then(l =>
      l.flat()
    ),
    client.getBlock({ blockNumber: fromBlock })
  ])
  const { perp, spot, ledger, vaults, subAccounts, lending, dexes, unified } = await readHyperliquidState(account, Number(windowStart.timestamp) * 1000, sharedReads)
  const lent = lending.tokenToState.filter(([, s]) => usd(s.supply.value) !== 0n || usd(s.borrow.value) !== 0n)
  const unpricedDebt = lent.find(([token, s]) => token !== 0 && usd(s.borrow.value) !== 0n)
  if (unpricedDebt !== undefined) throw new Error(`hyperliquid borrows token ${unpricedDebt[0]}, a debt the valuation does not price`)
  const usdcScale = 10n ** BigInt(USD_DECIMALS - TOKEN_META.USDC.decimals)
  const transits: IHyperliquidObservation['transits'] = []
  const transit = (key: string, contract: Address | undefined, label: string, amount: bigint, note: string): void => {
    transits.push({ key, contract, label, amount, note })
  }
  const credited = new Map(ledger.filter(e => e.delta.type === 'deposit').map(e => [e.hash.toLowerCase(), e]))
  const sentHashes = new Set(sends.map(s => s.transactionHash.toLowerCase()))
  const landedByMark = new Set(landings.map(l => l.args.nonce))
  for (const s of sends) {
    if (credited.has(s.transactionHash.toLowerCase())) continue
    transit(s.transactionHash, HYPERLIQUID_BRIDGE, 'Deposit to Hyperliquid', s.args.value! * usdcScale, `sent at block ${s.blockNumber}`)
  }
  for (const [hash, e] of credited) {
    if (sentHashes.has(hash)) continue
    const receipt = await client.getTransactionReceipt({ hash: e.hash })
    if (receipt.blockNumber <= blockNumber) continue
    transit(e.hash, HYPERLIQUID_BRIDGE, 'Deposit credited after the mark', -usd(e.delta.usdc!), `credited at block ${receipt.blockNumber}`)
  }
  const burns = await Promise.all(
    burnLogs
      .filter(l => l.args.destinationDomain === CCTP_HYPEREVM_DOMAIN && isAddressEqual(hyperCoreRecipientOf(l.args.hookData!)?.recipient ?? zeroAddress, account))
      .map(async l => ({ log: l, timeMs: Number((await client.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000 }))
  )
  const cctpCredits = ledger
    .filter(e => e.delta.type === 'send' && e.delta.token === COLLATERAL && isAddressEqual(e.delta.user!, CCTP_CORE_DEPOSIT_WALLET) && isAddressEqual(e.delta.destination!, account))
    .map(e => ({ entry: e, amount: parseUnits(e.delta.amount!, TOKEN_META.USDC.decimals) }))
    .sort((a, b) => a.entry.time - b.entry.time)
  const matched = new Set<number>()
  for (const b of burns.sort((x, y) => (x.log.blockNumber < y.log.blockNumber ? -1 : x.log.blockNumber > y.log.blockNumber ? 1 : x.log.logIndex - y.log.logIndex))) {
    const amount = b.log.args.amount!
    const maxFee = b.log.args.maxFee!
    const credit = cctpCredits.findIndex((c, i) => !matched.has(i) && c.entry.time >= b.timeMs && c.amount <= amount && amount - c.amount <= maxFee)
    if (credit !== -1) {
      matched.add(credit)
      continue
    }
    transit(b.log.transactionHash, CCTP_TOKEN_MESSENGER, 'Deposit to Hyperliquid (CCTP)', (amount - maxFee) * usdcScale, `burned at block ${b.log.blockNumber}`)
  }
  cctpCredits.forEach((c, i) => {
    if (matched.has(i) || c.entry.time <= blockTimestamp * 1000) return
    transit(c.entry.hash, CCTP_TOKEN_MESSENGER, 'CCTP deposit credited after the mark', -c.amount * usdcScale, `credited at ${Math.floor(c.entry.time / 1000)}`)
  })
  for (const r of requests) {
    if (landedByMark.has(r.args.nonce!)) continue
    transit(`withdraw:${r.args.nonce}`, HYPERLIQUID_BRIDGE, 'Withdrawal from Hyperliquid', r.args.usd! * usdcScale, `requested at block ${r.blockNumber}`)
  }
  const observed = observedBooksOf(
    [
      { tag: '', holder: account, perp, spot, collateral: COLLATERAL },
      ...subAccounts.map(s => ({ tag: `sub:${s.subAccountUser}`, holder: s.subAccountUser, perp: s.clearinghouseState, spot: s.spotState, collateral: COLLATERAL })),
      ...dexes.map(d => ({ tag: `dex:${d.dex}`, holder: account, perp: d.perp, spot: { balances: [] } as IHyperliquidSpotState, collateral: d.collateral }))
    ],
    unified
  )
  const observation: IHyperliquidObservation = {
    unified,
    books: observed.books,
    spot: observed.spot,
    lending: lent.map(([token, s]) => ({ token, supply: usd(s.supply.value), borrow: usd(s.borrow.value) })),
    vaults: vaults.map(v => ({ vaultAddress: v.vaultAddress, equity: usd(v.equity) })),
    transits
  }
  return { observation, marks: observed.marks, funding: observed.funding, time: Math.floor(perp.time / 1000) }
}

function observedBooksOf(books: readonly { tag: string; holder: Address; perp: IHyperliquidPerpState; spot: IHyperliquidSpotState; collateral: string }[], unified: boolean) {
  const holdOf = (holder: Address, coin: string): string => `${holder.toLowerCase()}:${coin}`
  const exposureIn = new Map<string, bigint>()
  const marks = new Map<string, bigint>()
  let funding = 0n
  const observedBooks = books.map(b => {
    const positions = b.perp.assetPositions.map(({ position }) => {
      const size = coinAmount(position.szi)
      const notional = usd(position.positionValue)
      if (position.entryPx === null) throw new Error(`hyperliquid reported ${position.coin} of ${b.holder} with no entry price`)
      exposureIn.set(holdOf(b.holder, b.collateral), (exposureIn.get(holdOf(b.holder, b.collateral)) ?? 0n) + (size < 0n ? -notional : notional))
      marks.set(position.coin, (notional * USD_UNIT) / (size < 0n ? -size : size))
      funding += usd(position.cumFunding.allTime)
      return {
        coin: position.coin,
        size,
        entry: usd(position.entryPx),
        leverage: position.leverage.value,
        isolatedMargin: position.leverage.type === 'isolated' ? usd(position.marginUsed) : null
      }
    })
    return { tag: b.tag, holder: b.holder, collateral: b.collateral, rawUsd: usd(b.perp.marginSummary.totalRawUsd), positions }
  })
  const spot = books.flatMap(b =>
    b.spot.balances.flatMap(balance => {
      const total = usd(balance.total)
      const unifiedCash = unified && balance.coin === COLLATERAL
      if (total === 0n && !unifiedCash) return []
      return [{ tag: b.tag, holder: b.holder, coin: balance.coin, cash: unifiedCash ? total - (exposureIn.get(holdOf(b.holder, balance.coin)) ?? 0n) : total }]
    })
  )
  return { books: observedBooks, spot, marks, funding }
}

export async function readHyperliquidCore(account: Address, unified: boolean) {
  const [perp, spot] = await Promise.all([
    hyperliquidInfo<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account }),
    hyperliquidInfo<IHyperliquidSpotState>({ type: 'spotClearinghouseState', user: account })
  ])
  const observed = observedBooksOf([{ tag: '', holder: account, perp, spot, collateral: COLLATERAL }], unified)
  return { book: observed.books[0]!, spot: observed.spot, marks: observed.marks, funding: observed.funding, time: Math.floor(perp.time / 1000) }
}

export async function readHyperliquidBalance(account: Address): Promise<{ total: bigint; free: bigint }> {
  const [perp, spot, abstraction] = await Promise.all([
    hyperliquidInfo<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account }),
    hyperliquidInfo<IHyperliquidSpotState>({ type: 'spotClearinghouseState', user: account }),
    hyperliquidInfo<string>({ type: 'userAbstraction', user: account })
  ])
  if (!HYPERLIQUID_UNIFIED_MODES.has(abstraction)) return { total: usd(perp.marginSummary.accountValue), free: usd(perp.withdrawable) }
  const cash = spot.balances.find(balance => balance.coin === COLLATERAL)
  return cash === undefined ? { total: 0n, free: 0n } : { total: usd(cash.total), free: usd(cash.total) - usd(cash.hold) }
}

export async function readHyperliquidSpotBids(coins: readonly string[]): Promise<Map<string, (readonly [bigint, bigint])[]>> {
  if (coins.length === 0) return new Map()
  const meta = await sharedSpotMeta()
  const quote = meta.tokens.find(token => token.name === COLLATERAL)
  if (quote === undefined) throw new Error(`hyperliquid spotMeta lists no ${COLLATERAL}`)
  return new Map(
    await Promise.all(
      coins.map(async (coin): Promise<[string, (readonly [bigint, bigint])[]]> => {
        const token = meta.tokens.find(listed => listed.name === coin)
        if (token === undefined) throw new Error(`hyperliquid holds spot ${coin}, which spotMeta does not list`)
        const pair = meta.universe.find(market => market.tokens[0] === token.index && market.tokens[1] === quote.index)
        if (pair === undefined) return [coin, []]
        const book = await hyperliquidInfo<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>({ type: 'l2Book', coin: pair.name })
        return [coin, book.levels[0].map(level => [usd(level.px), coinAmount(level.sz)] as const)]
      })
    )
  )
}

export function hyperliquidSpotExit(bids: readonly (readonly [bigint, bigint])[], amount: bigint): bigint {
  let left = amount
  let proceeds = 0n
  for (const [price, size] of bids) {
    if (left === 0n) break
    const sold = left < size ? left : size
    proceeds += (sold * price) / USD_UNIT
    left -= sold
  }
  return (proceeds * (10_000n - HYPERLIQUID_SPOT_TAKER_BPS)) / 10_000n
}

export async function readHyperliquidMarks(dexes: readonly string[]): Promise<Map<string, bigint>> {
  const marks = new Map<string, bigint>()
  for (const dex of ['', ...dexes]) {
    const [meta, contexts] = await hyperliquidInfo<[{ universe: { name: string }[] }, { markPx: string }[]]>(dex === '' ? { type: 'metaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex })
    meta.universe.forEach((asset, i) => {
      const context = contexts[i]
      if (context === undefined) throw new Error(`hyperliquid listed ${asset.name}${dex === '' ? '' : ` on ${dex}`} without its market context`)
      marks.set(asset.name, usd(context.markPx))
    })
  }
  return marks
}

export function hyperliquidRows(
  chainId: number,
  account: Address,
  observation: IHyperliquidObservation,
  markOf: (coin: string) => bigint,
  spotExitOf: (coin: string, amount: bigint) => bigint | undefined,
  usdOf: (collateral: string, amount: bigint) => bigint,
  time: number
): IVenuePosition[] {
  const rows: IVenuePosition[] = []
  const push = (row: Omit<IVenuePosition, 'holder' | 'fieldLabelList' | 'fieldValueList'> & { holder?: Address; fields?: [string, string][] }): void => {
    const { fields = [], holder = account, ...rest } = row
    rows.push({ ...rest, holder, fieldLabelList: fields.map(([label]) => label), fieldValueList: fields.map(([, value]) => value) })
  }
  for (const t of observation.transits) {
    push({
      chainId: t.contract === undefined ? undefined : BigInt(chainId),
      contract: t.contract,
      key: t.key,
      kind: 'transit',
      label: t.label,
      size: t.amount,
      unit: COLLATERAL,
      decimals: USD_DECIMALS,
      cost: usdOf(COLLATERAL, t.amount),
      value: usdOf(COLLATERAL, t.amount),
      fields: [['Status', t.note]],
      time
    })
  }
  const holdOf = (holder: Address, coin: string): string => `${holder.toLowerCase()}:${coin}`
  const committedIn = new Map<string, bigint>()
  const exposureIn = new Map<string, bigint>()
  for (const b of observation.books) {
    let committed = 0n
    let exposed = 0n
    for (const p of b.positions) {
      const mark = markOf(p.coin)
      const magnitude = p.size < 0n ? -p.size : p.size
      const notional = (magnitude * mark) / USD_UNIT
      const margin = p.isolatedMargin ?? notional / BigInt(p.leverage)
      const pnl = (p.size * (mark - p.entry)) / USD_UNIT
      committed += margin + pnl
      exposed += (p.size * mark) / USD_UNIT
      push({
        holder: b.holder,
        key: `${b.tag}:${p.coin}`,
        kind: 'perp',
        label: `${p.coin} ${p.size < 0n ? 'short' : 'long'}${b.tag === '' ? '' : ` (${b.tag})`}`,
        size: magnitude,
        unit: p.coin,
        decimals: USD_DECIMALS,
        cost: usdOf(b.collateral, margin),
        value: usdOf(b.collateral, margin + pnl),
        fields: [
          ['Leverage', `${p.leverage}x`],
          ['Notional', `$${readableUsd(notional)}`],
          ['Entry', `$${readableUnitAmount(Number(formatUnits(p.entry, USD_DECIMALS)))}`]
        ],
        time
      })
    }
    committedIn.set(holdOf(b.holder, b.collateral), (committedIn.get(holdOf(b.holder, b.collateral)) ?? 0n) + committed)
    exposureIn.set(holdOf(b.holder, b.collateral), (exposureIn.get(holdOf(b.holder, b.collateral)) ?? 0n) + exposed)
    if (!observation.unified) {
      const free = b.rawUsd + exposed - committed
      push({ holder: b.holder, key: perpCashKeyOf(b.tag), kind: 'cash', label: `Perp margin cash${b.tag === '' ? '' : ` (${b.tag})`}`, size: free, unit: b.collateral, decimals: USD_DECIMALS, cost: usdOf(b.collateral, free), value: usdOf(b.collateral, free), time })
    }
  }
  for (const s of observation.spot) {
    const stable = s.coin === COLLATERAL
    const unifiedCash = observation.unified && stable
    const total = unifiedCash ? s.cash + (exposureIn.get(holdOf(s.holder, s.coin)) ?? 0n) - (committedIn.get(holdOf(s.holder, s.coin)) ?? 0n) : s.cash
    if (total === 0n) continue
    const exit = stable ? total : spotExitOf(s.coin, total)
    push({
      holder: s.holder,
      key: spotKeyOf(s.tag, s.coin),
      kind: stable ? 'cash' : 'spot',
      label: `${s.coin}${s.tag === '' ? '' : ` (${s.tag})`}`,
      size: total,
      unit: s.coin,
      decimals: USD_DECIMALS,
      cost: stable ? usdOf(COLLATERAL, total) : undefined,
      value: exit === undefined ? undefined : usdOf(COLLATERAL, exit),
      fields: stable ? [] : [['Priced by', exit === undefined ? 'unpriced: its Hyperliquid spot book was not read' : `selling it into the Hyperliquid ${COLLATERAL} bids, less the taker fee`]],
      time
    })
  }
  for (const l of observation.lending) {
    const stable = l.token === 0
    const net = l.supply - l.borrow
    push({
      key: `lending:${l.token}`,
      kind: 'lend',
      label: stable ? 'USDC lent' : `Token ${l.token} lent`,
      size: net,
      unit: stable ? COLLATERAL : `token ${l.token}`,
      decimals: USD_DECIMALS,
      cost: stable ? usdOf(COLLATERAL, net) : undefined,
      value: stable ? usdOf(COLLATERAL, net) : undefined,
      fields: [
        ['Supplied', formatUnits(l.supply, USD_DECIMALS)],
        ['Borrowed', formatUnits(l.borrow, USD_DECIMALS)],
        ...(stable ? [] : ([['Priced by', 'unpriced: no priced exit for this lent token']] as [string, string][]))
      ],
      time
    })
  }
  for (const v of observation.vaults) {
    push({ key: `vault:${v.vaultAddress}`, kind: 'vault', label: `Vault ${v.vaultAddress}`, size: v.equity, unit: COLLATERAL, decimals: USD_DECIMALS, value: usdOf(COLLATERAL, v.equity), time })
  }
  return rows
}

export async function hyperliquidPositions(params: IVenueValueParams): Promise<IVenuePosition[]> {
  const { observation, marks, time } = await readHyperliquidObservation(params)
  const bids = await readHyperliquidSpotBids([...new Set(observation.spot.flatMap(held => (held.coin === COLLATERAL ? [] : [held.coin])))])
  const pricers = new Map(
    await Promise.all(
      [...new Set([COLLATERAL, ...observation.books.map(b => b.collateral)])].map(async symbol => {
        const rate = await params.getRate(symbol, USD_SYMBOL, params.freshness)
        return [symbol, { time: rate.time, of: hyperliquidCollateralUsd(symbol, rate) }] as const
      })
    )
  )
  const markOf = (coin: string): bigint => {
    const mark = marks.get(coin)
    if (mark === undefined) throw new Error(`hyperliquid read no mark for ${coin}`)
    return mark
  }
  const usdOf = (collateral: string, amount: bigint): bigint => {
    const pricer = pricers.get(collateral)
    if (pricer === undefined) throw new Error(`hyperliquid margin ${collateral} was not priced`)
    return pricer.of(amount)
  }
  const spotExitOf = (coin: string, amount: bigint): bigint | undefined => {
    const held = bids.get(coin)
    return held === undefined ? undefined : hyperliquidSpotExit(held, amount)
  }
  return hyperliquidRows(params.chainId, params.account, observation, markOf, spotExitOf, usdOf, Math.min(params.nowSec, time, ...[...pricers.values()].map(p => p.time)))
}
