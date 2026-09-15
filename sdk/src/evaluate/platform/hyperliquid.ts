import { TOKEN_META } from '@puppet/contracts/const'
import { type Address, type Hex, keccak256, type PublicClient, parseAbiItem, parseUnits, toHex, zeroAddress } from 'viem'
import { HYPERLIQUID_BRIDGE, HYPERLIQUID_CHAIN_ID, HYPERLIQUID_DEPOSIT_TOKEN } from '../../venue/hyperliquid/contracts.js'
import { usdPriceFromRate, usdToBase } from '../precision.js'
import type { INavPosition, IPlatformEvalParams, IPlatformEvaluator, IPlatformValuation, IVenueFacets } from '../types.js'

const PLATFORM = 'hyperliquid'
export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'
export const HYPERLIQUID_BRIDGE_WINDOW_SEC = 3600
export const HYPERLIQUID_BRIDGE_WINDOW_BLOCKS = 14_400n
const LOG_CHUNK_BLOCKS = 5_000n
const USD_PROXY = TOKEN_META.USDC.symbol
const USD_DECIMALS = 30
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const FINALIZED_WITHDRAWAL_EVENT = parseAbiItem(
  'event FinalizedWithdrawal(address indexed user, address destination, uint64 usd, uint64 nonce, bytes32 message)'
)

export interface IHyperliquidPosition {
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

export interface IHyperliquidPerpState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string }
  withdrawable: string
  assetPositions: IHyperliquidPosition[]
  time: number
}

export interface IHyperliquidSpotState {
  balances: { coin: string; total: string; hold: string }[]
}

export interface IHyperliquidLedgerUpdate {
  time: number
  hash: Hex
  delta: { type: string; usdc?: string; nonce?: number; fee?: string }
}

export interface IHyperliquidVaultEquity {
  vaultAddress: Address
  equity: string
}

export interface IHyperliquidSubAccount {
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

export async function readHyperliquidState(account: Address, ledgerSinceMs: number) {
  const [perp, spot, ledger, vaults, subAccounts] = await Promise.all([
    info<IHyperliquidPerpState>({ type: 'clearinghouseState', user: account }),
    info<IHyperliquidSpotState>({ type: 'spotClearinghouseState', user: account }),
    info<IHyperliquidLedgerUpdate[]>({ type: 'userNonFundingLedgerUpdates', user: account, startTime: ledgerSinceMs }),
    info<IHyperliquidVaultEquity[]>({ type: 'userVaultEquities', user: account }),
    info<IHyperliquidSubAccount[] | null>({ type: 'subAccounts', user: account })
  ])
  return { perp, spot, ledger, vaults, subAccounts: subAccounts ?? [] }
}

const usd = (decimal: string): bigint => parseUnits(decimal, USD_DECIMALS)
const positionKey = (account: Address, tag: string): Hex => keccak256(toHex(`${PLATFORM}:${account}:${tag}`))

export const hyperliquidEvaluator: IPlatformEvaluator = {
  platform: PLATFORM,
  chainId: HYPERLIQUID_CHAIN_ID,
  async evaluate({ account, blockNumber, blockTimestamp, nowSec, publicClient, getRate }: IPlatformEvalParams): Promise<IPlatformValuation> {
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
      const [state, sends, landings] = await Promise.all([
        readHyperliquidState(account, (blockTimestamp - HYPERLIQUID_BRIDGE_WINDOW_SEC) * 1000),
        Promise.all(
          ranges.map(r =>
            client.getLogs({ address: HYPERLIQUID_DEPOSIT_TOKEN, event: TRANSFER_EVENT, args: { from: account, to: HYPERLIQUID_BRIDGE }, ...r })
          )
        ).then(l => l.flat()),
        Promise.all(
          ranges.map(r => client.getLogs({ address: HYPERLIQUID_BRIDGE, event: FINALIZED_WITHDRAWAL_EVENT, args: { user: account }, ...r }))
        ).then(l => l.flat())
      ])
      const { perp, spot, ledger, vaults, subAccounts } = state

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
      for (const e of ledger) {
        if (e.delta.type !== 'withdraw' || landedByMark.has(BigInt(e.delta.nonce!))) continue
        bridgeUsd += usd(e.delta.usdc!)
        flows.push(`withdrawal-in-flight nonce ${e.delta.nonce} ${e.delta.usdc} at ${e.time}`)
      }

      const books = [
        { tag: '', perp, spot },
        ...subAccounts.map(s => ({ tag: `sub:${s.subAccountUser}`, perp: s.clearinghouseState, spot: s.spotState }))
      ]
      const spotHeld = books.flatMap(b => b.spot.balances.filter(x => usd(x.total) !== 0n).map(x => ({ tag: b.tag, ...x })))
      const idle =
        books.every(b => b.perp.assetPositions.length === 0 && usd(b.perp.marginSummary.accountValue) === 0n) &&
        spotHeld.length === 0 &&
        vaults.length === 0 &&
        flows.length === 0
      if (idle) return { platform: PLATFORM, positions: [], inFlight: [], available: true }

      const basePrice = usdPriceFromRate(await getRate(USD_PROXY, USD_PROXY), TOKEN_META.USDC.decimals)
      const mids = spotHeld.some(b => b.coin !== USD_PROXY) ? await info<Record<string, string>>({ type: 'allMids' }) : {}
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
          row(`${b.tag}:${position.coin}`, margin, pnl, priceAgeSec, {
            coin: position.coin,
            side: usd(position.szi) < 0n ? 'short' : 'long',
            sizeUsd: usd(position.positionValue),
            leverageBps: BigInt(Math.round(position.leverage.value * 10_000)),
            liquidationPx: position.liquidationPx ?? undefined,
            subAccount: b.tag || undefined
          })
        }
        const free = usd(b.perp.marginSummary.accountValue) - committed
        if (free !== 0n) row(`${b.tag}:perp-cash`, free, 0n, priceAgeSec, { kind: 'venue-cash', subAccount: b.tag || undefined })
      }
      for (const balance of spotHeld) {
        const stable = balance.coin === USD_PROXY
        const mid = stable ? '1' : mids[balance.coin]
        if (mid === undefined) {
          return {
            platform: PLATFORM,
            positions: [],
            inFlight: [],
            available: false,
            unavailableReason: `hyperliquid publishes no mid for spot ${balance.coin}`
          }
        }
        const value = (usd(balance.total) * usd(mid)) / 10n ** BigInt(USD_DECIMALS)
        row(`${balance.tag}:spot:${balance.coin}`, value, 0n, Math.max(0, nowSec - Math.floor(perp.time / 1000)), {
          kind: stable ? 'venue-cash' : 'spot',
          coin: balance.coin,
          amount: balance.total,
          subAccount: balance.tag || undefined
        })
      }
      for (const v of vaults) {
        row(`vault:${v.vaultAddress}`, usd(v.equity), 0n, Math.max(0, nowSec - Math.floor(perp.time / 1000)), { kind: 'vault', vault: v.vaultAddress })
      }
      if (flows.length > 0) row('bridge', bridgeUsd, 0n, 0, { kind: 'venue-cash', bridge: flows.join('; ') })
      return { platform: PLATFORM, positions, inFlight: [], available: true }
    } catch (err) {
      return { platform: PLATFORM, positions: [], inFlight: [], available: false, unavailableReason: err instanceof Error ? err.message : String(err) }
    }
  }
}
