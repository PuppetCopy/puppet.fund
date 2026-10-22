import { type Address, formatUnits, getAddress, type Hex, isAddress, type PublicClient, parseUnits, zeroHash } from 'viem'
import { DEFAULT_EVALUATION_CONFIG } from '../../evaluate/types.js'
import type { IDappScreenReason, IDappTypedData } from '../types.js'
import {
  CTF_ABI,
  POLYMARKET_CHAIN_ID,
  POLYMARKET_CLOB_URL,
  POLYMARKET_COLLATERAL_DECIMALS,
  POLYMARKET_CONDITIONAL_TOKENS,
  POLYMARKET_EXCHANGE_COLLATERAL,
  POLYMARKET_MAX_SPREAD,
  POLYMARKET_NEG_RISK_EXCHANGE,
  POLYMARKET_READ_TIMEOUT_MS
} from './contracts.js'

const PRICE_ONE = 10n ** BigInt(POLYMARKET_COLLATERAL_DECIMALS)
const BPS = 10_000n

interface IBookLevel {
  price: bigint
  size: bigint
}

export interface IClobBook {
  conditionId: Hex
  negRisk: boolean
  tick: bigint
  bids: IBookLevel[]
  asks: IBookLevel[]
}

interface IBookJson {
  market: Hex
  asset_id: string
  neg_risk: boolean
  tick_size: string
  bids: { price: string; size: string }[]
  asks: { price: string; size: string }[]
}

const levelsOf = (levels: IBookJson['bids']): IBookLevel[] =>
  levels.map(l => ({ price: parseUnits(l.price, POLYMARKET_COLLATERAL_DECIMALS), size: parseUnits(l.size, POLYMARKET_COLLATERAL_DECIMALS) }))

export async function readClobBook(tokenId: bigint): Promise<IClobBook> {
  const res = await fetch(`${POLYMARKET_CLOB_URL}/book?token_id=${tokenId}`, { signal: AbortSignal.timeout(POLYMARKET_READ_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Polymarket answered ${res.status} to the book of token ${tokenId}: ${await res.text()}`)
  const book = (await res.json()) as IBookJson
  if (BigInt(book.asset_id) !== tokenId) throw new Error(`Polymarket returned the book of ${book.asset_id} for token ${tokenId}`)
  return {
    conditionId: book.market,
    negRisk: book.neg_risk,
    tick: parseUnits(book.tick_size, POLYMARKET_COLLATERAL_DECIMALS),
    bids: levelsOf(book.bids).sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0)),
    asks: levelsOf(book.asks).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
  }
}

export async function outcomeIndexOf(client: PublicClient, collateral: Address, conditionId: Hex, tokenId: bigint, blockNumber: bigint): Promise<0 | 1 | null> {
  const at = { blockNumber }
  const [slots, first, second] = await Promise.all([
    client.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'getOutcomeSlotCount', args: [conditionId], ...at }),
    client.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'getCollectionId', args: [zeroHash, conditionId, 1n], ...at }),
    client.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'getCollectionId', args: [zeroHash, conditionId, 2n], ...at })
  ])
  if (slots !== 2n) return null
  const [yes, no] = await Promise.all([
    client.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'getPositionId', args: [collateral, first], ...at }),
    client.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'getPositionId', args: [collateral, second], ...at })
  ])
  return tokenId === yes ? 0 : tokenId === no ? 1 : null
}

export async function attestPolymarketOrder(clients: Readonly<Record<number, PublicClient>>, _account: Address, td: IDappTypedData): Promise<IDappScreenReason[]> {
  const client = clients[POLYMARKET_CHAIN_ID]
  if (client === undefined) return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `pricing a Polymarket order needs a client for chain ${POLYMARKET_CHAIN_ID}` }]
  const exchange = td.domain?.verifyingContract
  const collateral = typeof exchange === 'string' && isAddress(exchange) ? POLYMARKET_EXCHANGE_COLLATERAL.get(getAddress(exchange)) : undefined
  if (collateral === undefined) return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: `${String(exchange)} is not a pinned Polymarket exchange` }]
  const order = td.message.contents as Record<string, string | number>
  const tokenId = BigInt(order.tokenId!)
  const side = BigInt(order.side!)
  const makerAmount = BigInt(order.makerAmount!)
  const takerAmount = BigInt(order.takerAmount!)
  const [book, blockNumber] = await Promise.all([readClobBook(tokenId), client.getBlockNumber()])
  if (book.negRisk !== (getAddress(exchange as Address) === POLYMARKET_NEG_RISK_EXCHANGE)) {
    return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: `token ${tokenId} trades on the ${book.negRisk ? 'neg-risk' : 'standard'} exchange, not ${String(exchange)}` }]
  }
  if ((await outcomeIndexOf(client, collateral, book.conditionId, tokenId, blockNumber)) === null) {
    return [{ code: 'ASSET_NOT_PRICEABLE', detail: `token ${tokenId} is not an outcome of the binary condition ${book.conditionId} over ${collateral}` }]
  }
  const bestBid = book.bids[0]
  const bestAsk = book.asks[0]
  if (bestBid === undefined || bestAsk === undefined || bestAsk.price - bestBid.price > POLYMARKET_MAX_SPREAD) {
    return [
      {
        code: 'ORDER_BOOK_THIN',
        detail: `the book of token ${tokenId} (best bid ${bestBid?.price ?? 'none'}, best ask ${bestAsk?.price ?? 'none'}) is too thin to price an order against; the spread limit is ${POLYMARKET_MAX_SPREAD}`
      }
    ]
  }
  if (makerAmount === 0n || takerAmount === 0n) {
    return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `the order trades ${makerAmount} for ${takerAmount}; an order moves a nonzero amount each way` }]
  }
  const buy = side === 0n
  let left = makerAmount
  let notional = 0n
  let shares = 0n
  for (const level of buy ? book.asks : book.bids) {
    if (left === 0n) break
    const room = buy ? (level.size * level.price) / PRICE_ONE : level.size
    const spend = room < left ? room : left
    const take = buy ? (spend * PRICE_ONE) / level.price : spend
    notional += take * level.price
    shares += take
    left -= spend
  }
  if (shares === 0n) return [{ code: 'ORDER_BOOK_THIN', detail: `the ${buy ? 'asks' : 'bids'} of token ${tokenId} fill none of the order` }]
  const fill = notional / shares
  const slippage = DEFAULT_EVALUATION_CONFIG.swapMaxSlippageBps
  const bound = (((fill * (buy ? BPS + slippage : BPS - slippage)) / BPS + book.tick / 2n) / book.tick) * book.tick
  const price = buy ? (makerAmount * PRICE_ONE) / takerAmount : (takerAmount * PRICE_ONE) / makerAmount
  if (buy ? price <= bound : price >= bound) return []
  const at = (value: bigint) => formatUnits(value, POLYMARKET_COLLATERAL_DECIMALS)
  return [
    {
      code: 'ORDER_PRICE_BOUND',
      detail: `the order ${buy ? 'buys' : 'sells'} at ${at(price)}, ${buy ? 'above' : 'below'} ${at(bound)}: the book ${buy ? 'sells' : 'buys'} ${at(shares)} shares at ${at(fill)} now, and an order may ${buy ? 'pay' : 'take'} at most ${slippage / 100n}% ${buy ? 'more' : 'less'}, to the nearest ${at(book.tick)} tick. Set Polymarket's slippage to ${slippage / 100n}% or less, or place a limit order.`
    }
  ]
}
