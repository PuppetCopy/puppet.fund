import { TOKEN_META } from '@puppet/contracts/const'
import { type Address, type Hex, isAddressEqual, keccak256, type PublicClient, parseAbiItem, parseUnits, toHex, zeroAddress } from 'viem'
import { usdPriceFromRate, usdToBase } from '../../evaluate/precision.js'
import type { INavPosition, IPlatformValuation, IVenueFacets } from '../../evaluate/types.js'
import type { IVenueValueParams } from '../types.js'
import {
  CCTP_CORE_DEPOSIT_WALLET,
  CCTP_HYPEREVM_DOMAIN,
  CCTP_TOKEN_MESSENGER,
  CCTP_TOKEN_MESSENGER_ABI,
  HYPERLIQUID_BRIDGE,
  HYPERLIQUID_DEPOSIT_TOKEN,
  hyperCoreRecipientOf
} from './contracts.js'

const PLATFORM = 'hyperliquid'
const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'
const HYPERLIQUID_BRIDGE_WINDOW_SEC = 3600
const HYPERLIQUID_BRIDGE_WINDOW_BLOCKS = 14_400n
const LOG_CHUNK_BLOCKS = 5_000n
const USD_PROXY = TOKEN_META.USDC.symbol
const USD_DECIMALS = 30
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const DEPOSIT_FOR_BURN_EVENT = CCTP_TOKEN_MESSENGER_ABI[1]
const FINALIZED_WITHDRAWAL_EVENT = parseAbiItem(
  'event FinalizedWithdrawal(address indexed user, address destination, uint64 usd, uint64 nonce, bytes32 message)'
)

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
  }
}

interface IHyperliquidPerpState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string }
  withdrawable: string
  assetPositions: IHyperliquidPosition[]
  time: number
}

interface IHyperliquidSpotState {
  balances: { coin: string; token: number; total: string; hold: string }[]
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
}

interface IHyperliquidSubAccount {
  name: string
  subAccountUser: Address
  clearinghouseState: IHyperliquidPerpState
  spotState: IHyperliquidSpotState
}

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`hyperliquid info ${String(body.type)} answered ${res.status}`)
  return (await res.json()) as T
}

const UNIFIED_MODES: ReadonlySet<string> = new Set(['unifiedAccount', 'portfolioMargin'])

async function readHyperliquidState(account: Address, ledgerSinceMs: number) {
  const [perp, spot, ledger, vaults, subAccounts, lending, dexList, abstraction] = await Promise.all([
    info<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account }),
    info<IHyperliquidSpotState>({ type: 'spotClearinghouseState', user: account }),
    info<IHyperliquidLedgerUpdate[]>({ type: 'userNonFundingLedgerUpdates', user: account, startTime: ledgerSinceMs }),
    info<IHyperliquidVaultEquity[]>({ type: 'userVaultEquities', user: account }),
    info<IHyperliquidSubAccount[] | null>({ type: 'subAccounts', user: account }),
    info<IHyperliquidLendState>({ type: 'borrowLendUserState', user: account }),
    info<({ name: string } | null)[]>({ type: 'perpDexs' }),
    info<string>({ type: 'userAbstraction', user: account })
  ])
  const dexes: IHyperliquidDexBook[] = await Promise.all(
    dexList
      .filter((d): d is { name: string } => d !== null)
      .map(async d => ({ dex: d.name, perp: await info<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account, dex: d.name }) }))
  )
  return { perp, spot, ledger, vaults, subAccounts: subAccounts ?? [], lending, dexes, unified: UNIFIED_MODES.has(abstraction) }
}

const usd = (decimal: string): bigint => parseUnits(decimal, USD_DECIMALS)
const positionKey = (account: Address, tag: string): Hex => keccak256(toHex(`${PLATFORM}:${account}:${tag}`))

export async function valueHyperliquidAccount({
  account,
  blockNumber,
  blockTimestamp,
  nowSec,
  publicClient,
  getRate
}: IVenueValueParams): Promise<IPlatformValuation> {
  {
    if (publicClient === undefined) {
      return { platform: PLATFORM, positions: [], inFlight: [], available: false, unavailableReason: 'bridge reconciliation needs a chain client' }
    }
    const client: PublicClient = publicClient
    try {
      const fromBlock = blockNumber > HYPERLIQUID_BRIDGE_WINDOW_BLOCKS ? blockNumber - HYPERLIQUID_BRIDGE_WINDOW_BLOCKS : 0n
      const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
      for (let from = fromBlock; from <= blockNumber; from += LOG_CHUNK_BLOCKS) {
        const to = from + LOG_CHUNK_BLOCKS - 1n
        ranges.push({ fromBlock: from, toBlock: to < blockNumber ? to : blockNumber })
      }
      const [sends, burnLogs, landings] = await Promise.all([
        Promise.all(
          ranges.map(r =>
            client.getLogs({ address: HYPERLIQUID_DEPOSIT_TOKEN, event: TRANSFER_EVENT, args: { from: account, to: HYPERLIQUID_BRIDGE }, ...r })
          )
        ).then(l => l.flat()),
        Promise.all(
          ranges.map(r => client.getLogs({ address: CCTP_TOKEN_MESSENGER, event: DEPOSIT_FOR_BURN_EVENT, args: { depositor: account }, ...r }))
        ).then(l => l.flat()),
        Promise.all(
          ranges.map(r => client.getLogs({ address: HYPERLIQUID_BRIDGE, event: FINALIZED_WITHDRAWAL_EVENT, args: { user: account }, ...r }))
        ).then(l => l.flat())
      ])
      const state = await readHyperliquidState(account, (blockTimestamp - HYPERLIQUID_BRIDGE_WINDOW_SEC) * 1000)
      const { perp, spot, ledger, vaults, subAccounts, lending, dexes, unified } = state

      const credited = new Map(ledger.filter(e => e.delta.type === 'deposit').map(e => [e.hash.toLowerCase(), e]))
      const sentHashes = new Set(sends.map(s => s.transactionHash.toLowerCase()))
      const landedByMark = new Set(landings.map(l => l.args.nonce))
      const flows: string[] = []
      let bridgeUsd = 0n
      for (const s of sends) {
        if (credited.has(s.transactionHash.toLowerCase())) continue
        bridgeUsd += s.args.value! * 10n ** BigInt(USD_DECIMALS - TOKEN_META.USDC.decimals)
        flows.push(`deposit-in-flight ${s.transactionHash} ${s.args.value} at ${s.blockNumber}`)
      }
      for (const [hash, e] of credited) {
        if (sentHashes.has(hash)) continue
        const receipt = await client.getTransactionReceipt({ hash: e.hash })
        if (receipt.blockNumber <= blockNumber) continue
        bridgeUsd -= usd(e.delta.usdc!)
        flows.push(`deposit-after-mark ${e.hash} ${e.delta.usdc} at ${receipt.blockNumber}`)
      }
      const burns = await Promise.all(
        burnLogs
          .filter(l => l.args.destinationDomain === CCTP_HYPEREVM_DOMAIN && isAddressEqual(hyperCoreRecipientOf(l.args.hookData!)?.recipient ?? zeroAddress, account))
          .map(async l => ({ log: l, timeMs: Number((await client.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000 }))
      )
      const cctpCredits = ledger
        .filter(
          e =>
            e.delta.type === 'send' &&
            e.delta.token === USD_PROXY &&
            isAddressEqual(e.delta.user!, CCTP_CORE_DEPOSIT_WALLET) &&
            isAddressEqual(e.delta.destination!, account)
        )
        .map(e => ({ entry: e, amount: parseUnits(e.delta.amount!, TOKEN_META.USDC.decimals) }))
        .sort((a, b) => a.entry.time - b.entry.time)
      const matched = new Set<number>()
      for (const b of burns.sort((x, y) => (x.log.blockNumber < y.log.blockNumber ? -1 : x.log.blockNumber > y.log.blockNumber ? 1 : x.log.logIndex - y.log.logIndex))) {
        const amount = b.log.args.amount!
        const maxFee = b.log.args.maxFee!
        const credit = cctpCredits.findIndex(
          (c, i) => !matched.has(i) && c.entry.time >= b.timeMs && c.amount <= amount && amount - c.amount <= maxFee
        )
        if (credit !== -1) {
          matched.add(credit)
          continue
        }
        bridgeUsd += (amount - maxFee) * 10n ** BigInt(USD_DECIMALS - TOKEN_META.USDC.decimals)
        flows.push(`cctp-deposit-in-flight ${b.log.transactionHash} ${amount} at ${b.log.blockNumber}`)
      }
      cctpCredits.forEach((c, i) => {
        if (matched.has(i) || c.entry.time <= blockTimestamp * 1000) return
        bridgeUsd -= c.amount * 10n ** BigInt(USD_DECIMALS - TOKEN_META.USDC.decimals)
        flows.push(`cctp-deposit-after-mark ${c.entry.hash} ${c.entry.delta.amount} at ${c.entry.time}`)
      })
      for (const e of ledger) {
        if (e.delta.type !== 'withdraw' || landedByMark.has(BigInt(e.delta.nonce!))) continue
        bridgeUsd += usd(e.delta.usdc!)
        flows.push(`withdrawal-in-flight nonce ${e.delta.nonce} ${e.delta.usdc} at ${e.time}`)
      }

      const books = [
        { tag: '', perp, spot },
        ...subAccounts.map(s => ({ tag: `sub:${s.subAccountUser}`, perp: s.clearinghouseState, spot: s.spotState })),
        ...dexes.map(d => ({ tag: `dex:${d.dex}`, perp: d.perp, spot: { balances: [] } }))
      ]
      const spotHeld = books.flatMap(b => b.spot.balances.filter(x => usd(x.total) !== 0n).map(x => ({ tag: b.tag, ...x })))
      const lent = lending.tokenToState.filter(([, s]) => usd(s.supply.value) !== 0n || usd(s.borrow.value) !== 0n)
      const unpricedDebt = lent.find(([token, s]) => token !== 0 && usd(s.borrow.value) !== 0n)
      if (unpricedDebt !== undefined) {
        return {
          platform: PLATFORM,
          positions: [],
          inFlight: [],
          available: false,
          unavailableReason: `hyperliquid borrows token ${unpricedDebt[0]}, a debt the valuation does not price`
        }
      }
      const idle =
        books.every(b => b.perp.assetPositions.length === 0 && usd(b.perp.marginSummary.accountValue) === 0n) &&
        spotHeld.length === 0 &&
        vaults.length === 0 &&
        lent.length === 0 &&
        flows.length === 0
      if (idle) return { platform: PLATFORM, positions: [], inFlight: [], available: true }

      const basePrice = usdPriceFromRate(await getRate(USD_PROXY, USD_PROXY), TOKEN_META.USDC.decimals)
      const swappable: ReadonlySet<number> = spotHeld.some(b => b.coin !== USD_PROXY)
        ? new Set(
            (await info<{ universe: { tokens: [number, number] }[] }>({ type: 'spotMeta' })).universe
              .filter(pair => pair.tokens[1] === 0)
              .map(pair => pair.tokens[0])
          )
        : new Set()
      const positions: INavPosition[] = []
      const row = (tag: string, usdValue: bigint, pnlUsd: bigint, priceAgeSec: number, facets: IVenueFacets): void => {
        const collateralBase = usdToBase(usdValue, basePrice)
        const pnlBase = usdToBase(pnlUsd, basePrice)
        positions.push({
          platform: PLATFORM,
          positionKey: positionKey(account, tag),
          market: zeroAddress,
          collateralBase,
          pnlBase,
          netBase: collateralBase + pnlBase,
          priceAgeSec,
          facets
        })
      }
      for (const b of books) {
        const priceAgeSec = Math.max(0, nowSec - Math.floor(b.perp.time / 1000))
        let committed = 0n
        for (const { position } of b.perp.assetPositions) {
          const margin = usd(position.marginUsed)
          const pnl = usd(position.unrealizedPnl)
          committed += margin + pnl
          row(`${b.tag}:${position.coin}`, unified ? 0n : margin, unified ? 0n : pnl, priceAgeSec, {
            ...(unified ? { collateral: 'spot', marginUsd: position.marginUsed, pnlUsd: position.unrealizedPnl } : {}),
            coin: position.coin,
            side: usd(position.szi) < 0n ? 'short' : 'long',
            sizeUsd: usd(position.positionValue),
            leverageBps: BigInt(Math.round(position.leverage.value * 10_000)),
            liquidationPx: position.liquidationPx ?? undefined,
            subAccount: b.tag || undefined,
            book: b.tag || 'main'
          })
        }
        const free = usd(b.perp.marginSummary.accountValue) - committed
        if (!unified && free !== 0n) row(`${b.tag}:perp-cash`, free, 0n, priceAgeSec, { kind: 'venue-cash', subAccount: b.tag || undefined, book: b.tag || 'main' })
      }
      for (const balance of spotHeld) {
        const stable = balance.coin === USD_PROXY
        row(`${balance.tag}:spot:${balance.coin}`, stable ? usd(balance.total) : 0n, 0n, Math.max(0, nowSec - Math.floor(perp.time / 1000)), {
          kind: stable ? 'venue-cash' : swappable.has(balance.token) ? 'swap-required' : 'unpriced',
          coin: balance.coin,
          amount: balance.total,
          subAccount: balance.tag || undefined,
          book: balance.tag || 'main'
        })
      }
      for (const [token, s] of lent) {
        const stable = token === 0
        row(`lending:${token}`, stable ? usd(s.supply.value) - usd(s.borrow.value) : 0n, 0n, Math.max(0, nowSec - Math.floor(perp.time / 1000)), {
          kind: stable ? 'lending' : 'swap-required',
          token,
          supply: s.supply.value,
          borrow: s.borrow.value,
          book: 'main'
        })
      }
      for (const v of vaults) {
        row(`vault:${v.vaultAddress}`, usd(v.equity), 0n, Math.max(0, nowSec - Math.floor(perp.time / 1000)), { kind: 'vault', vault: v.vaultAddress, book: 'main' })
      }
      if (flows.length > 0) row('bridge', bridgeUsd, 0n, 0, { kind: 'venue-cash', bridge: flows.join('; '), book: 'main' })
      return { platform: PLATFORM, positions, inFlight: [], available: true }
    } catch (err) {
      return { platform: PLATFORM, positions: [], inFlight: [], available: false, unavailableReason: err instanceof Error ? err.message : String(err) }
    }
  }
}
