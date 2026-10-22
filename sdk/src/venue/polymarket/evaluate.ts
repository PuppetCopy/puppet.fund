import { type Address, erc20Abi, getAbiItem, type Hex, isAddressEqual, type PublicClient, parseUnits } from 'viem'
import { USD_SYMBOL } from '../../const/common.js'
import type { IVenuePosition, IVenueValueParams } from '../types.js'
import {
  CTF_ABI,
  OWNER_ABI,
  POLYMARKET_APP_URL,
  POLYMARKET_BRIDGED_USDC,
  POLYMARKET_CHAIN_ID,
  POLYMARKET_CLOB_URL,
  POLYMARKET_COLLATERAL,
  POLYMARKET_COLLATERAL_DECIMALS,
  POLYMARKET_COLLATERAL_SYMBOL,
  POLYMARKET_CONDITIONAL_TOKENS,
  POLYMARKET_DATA_URL,
  POLYMARKET_POSITION_WINDOW_BLOCKS,
  POLYMARKET_READ_TIMEOUT_MS,
  POLYMARKET_WRAPPED_COLLATERAL
} from './contracts.js'
import { outcomeIndexOf, readClobBook } from './order.js'
import { polymarketWalletOf } from './sign.js'

const PRICE_ONE = 10n ** BigInt(POLYMARKET_COLLATERAL_DECIMALS)

const polygonLabel = (token: Address): string => (isAddressEqual(token, POLYMARKET_COLLATERAL) ? 'pUSD' : 'USDC.e')

export async function polymarketPositions({ chainId, account, blockNumber, blockTimestamp, clients, getRate, freshness }: IVenueValueParams): Promise<IVenuePosition[]> {
  if (chainId !== POLYMARKET_CHAIN_ID) throw new Error(`Polymarket is valued on chain ${POLYMARKET_CHAIN_ID}, where its wallet lives, not ${chainId}`)
  const polygon = clients[POLYMARKET_CHAIN_ID]
  if (polygon === undefined) throw new Error(`valuing the Polymarket wallet needs a client for chain ${POLYMARKET_CHAIN_ID}`)
  const wallet = polymarketWalletOf(account)
  const at = { blockNumber }
  const [code, collateral, bridged] = await Promise.all([
    polygon.getCode({ address: wallet, ...at }),
    polygon.readContract({ address: POLYMARKET_COLLATERAL, abi: erc20Abi, functionName: 'balanceOf', args: [wallet], ...at }),
    polygon.readContract({ address: POLYMARKET_BRIDGED_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet], ...at })
  ])
  if (code === undefined || code === '0x') {
    if (collateral + bridged > 0n) throw new Error(`the Polymarket wallet ${wallet} holds ${collateral + bridged} but is not deployed, so it is not yet the account's`)
    return []
  }
  const [owner, collateralRate] = await Promise.all([
    polygon.readContract({ address: wallet, abi: OWNER_ABI, functionName: 'owner', ...at }),
    getRate(POLYMARKET_COLLATERAL_SYMBOL, USD_SYMBOL, freshness)
  ])
  if (!isAddressEqual(owner, account)) throw new Error(`the Polymarket wallet ${wallet} is owned by ${owner}, not ${account}`)
  if (collateralRate.token1 === 0n) throw new Error(`rate ${POLYMARKET_COLLATERAL_SYMBOL}/${USD_SYMBOL} has a zero denominator`)
  const collateralValue = (amount: bigint): bigint => (amount * collateralRate.token0) / collateralRate.token1
  const markTime = Math.min(blockTimestamp, collateralRate.time)
  const rows: IVenuePosition[] = []
  for (const [token, amount] of [
    [POLYMARKET_COLLATERAL, collateral],
    [POLYMARKET_BRIDGED_USDC, bridged]
  ] as const) {
    if (amount === 0n) continue
    const value = collateralValue(amount)
    rows.push({
      holder: wallet,
      chainId: BigInt(POLYMARKET_CHAIN_ID),
      contract: token,
      key: token,
      kind: 'cash',
      label: `${polygonLabel(token)} cash`,
      size: amount,
      unit: polygonLabel(token),
      decimals: POLYMARKET_COLLATERAL_DECIMALS,
      cost: value,
      value,
      fieldLabelList: [],
      fieldValueList: [],
      time: markTime
    })
  }
  const listed = await listPositions(wallet)
  for (const outcome of await valueOutcomes(polygon, wallet, blockNumber, listed)) {
    if (outcome.resolved && outcome.value === 0n) continue
    const legs = listed.filter(p => outcome.assets.includes(BigInt(p.asset)))
    const title = legs[0]?.title ?? outcome.conditionId
    const costed = legs.length === outcome.assets.length
    rows.push({
      holder: wallet,
      chainId: BigInt(POLYMARKET_CHAIN_ID),
      contract: POLYMARKET_CONDITIONAL_TOKENS,
      key: outcome.conditionId,
      kind: 'outcome',
      label: title,
      url: legs[0] === undefined ? undefined : `${POLYMARKET_APP_URL}/market/${encodeURIComponent(legs[0].slug)}`,
      size: outcome.shares,
      unit: 'shares',
      decimals: POLYMARKET_COLLATERAL_DECIMALS,
      cost: costed ? collateralValue(legs.reduce((total, p) => total + parseUnits(p.initialValue.toFixed(POLYMARKET_COLLATERAL_DECIMALS), POLYMARKET_COLLATERAL_DECIMALS), 0n)) : undefined,
      value: collateralValue(outcome.value),
      fieldLabelList: [...legs.map(p => p.outcome), ...(outcome.resolved ? ['Resolved'] : [])],
      fieldValueList: [...legs.map(p => `${p.size} shares`), ...(outcome.resolved ? ['pays out at the payout numerators'] : [])],
      time: markTime
    })
  }
  return rows
}

const bidWalk = (bids: { price: bigint; size: bigint }[], shares: bigint, feeRate: bigint, feeExponent: bigint): bigint => {
  let left = shares
  let total = 0n
  for (const level of bids) {
    if (left === 0n) break
    const take = level.size < left ? level.size : left
    total += (take * level.price) / PRICE_ONE - (take * feeRate * (level.price * (PRICE_ONE - level.price)) ** feeExponent) / PRICE_ONE ** (2n * feeExponent + 1n)
    left -= take
  }
  return total
}

export interface IListedPosition {
  asset: string
  conditionId: Hex
  title: string
  slug: string
  outcome: string
  size: number
  initialValue: number
}

export async function listPositions(wallet: Address): Promise<IListedPosition[]> {
  const res = await fetch(`${POLYMARKET_DATA_URL}/positions?user=${wallet}&sizeThreshold=0&limit=500`, { signal: AbortSignal.timeout(POLYMARKET_READ_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Polymarket answered ${res.status} to the positions of ${wallet}: ${await res.text()}`)
  return (await res.json()) as IListedPosition[]
}

export async function valueOutcomes(polygon: PublicClient, wallet: Address, blockNumber: bigint, listed: readonly IListedPosition[]) {
  const from = blockNumber > POLYMARKET_POSITION_WINDOW_BLOCKS ? blockNumber - POLYMARKET_POSITION_WINDOW_BLOCKS : 0n
  const window = { address: POLYMARKET_CONDITIONAL_TOKENS, args: { to: wallet }, fromBlock: from, toBlock: blockNumber }
  const [singles, batches] = await Promise.all([
    polygon.getLogs({ ...window, event: getAbiItem({ abi: CTF_ABI, name: 'TransferSingle' }) }),
    polygon.getLogs({ ...window, event: getAbiItem({ abi: CTF_ABI, name: 'TransferBatch' }) })
  ])
  const tokenIds = [...new Set([...listed.map(p => BigInt(p.asset)), ...singles.map(l => l.args.id!), ...batches.flatMap(l => [...l.args.ids!])])]
  if (tokenIds.length === 0) return []
  const balances = await polygon.readContract({
    address: POLYMARKET_CONDITIONAL_TOKENS,
    abi: CTF_ABI,
    functionName: 'balanceOfBatch',
    args: [tokenIds.map(() => wallet), tokenIds],
    blockNumber
  })
  const held = tokenIds.map((tokenId, i) => ({ tokenId, shares: balances[i]! })).filter(h => h.shares > 0n)
  const legs = await Promise.all(
    held.map(async h => {
      const res = await fetch(`${POLYMARKET_CLOB_URL}/markets-by-token/${h.tokenId}`, { signal: AbortSignal.timeout(POLYMARKET_READ_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`Polymarket answered ${res.status} to the market of token ${h.tokenId}: ${await res.text()}`)
      return { ...h, conditionId: ((await res.json()) as { condition_id: Hex }).condition_id }
    })
  )
  const conditions = [...new Set(legs.map(leg => leg.conditionId))]
  return Promise.all(
    conditions.map(async conditionId => {
      const res = await fetch(`${POLYMARKET_CLOB_URL}/clob-markets/${conditionId}`, { signal: AbortSignal.timeout(POLYMARKET_READ_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`Polymarket answered ${res.status} to the market of condition ${conditionId}: ${await res.text()}`)
      const market = (await res.json()) as { c: Hex; nr?: boolean; fd?: { r: number; e: number } }
      if (market.c.toLowerCase() !== conditionId.toLowerCase()) throw new Error(`Polymarket returned the market of ${market.c} for condition ${conditionId}`)
      const pair = await Promise.all(
        legs
          .filter(leg => leg.conditionId === conditionId)
          .map(async leg => {
            const index = await outcomeIndexOf(polygon, market.nr ? POLYMARKET_WRAPPED_COLLATERAL : POLYMARKET_BRIDGED_USDC, conditionId, leg.tokenId, blockNumber)
            if (index === null) throw new Error(`the wallet holds token ${leg.tokenId}, which is not an outcome of the binary condition ${conditionId}`)
            return { ...leg, index }
          })
      )
      const shares = pair.reduce((total, leg) => total + leg.shares, 0n)
      const denominator = await polygon.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'payoutDenominator', args: [conditionId], blockNumber })
      if (denominator > 0n) {
        const paid = await Promise.all(
          pair.map(async leg =>
            (leg.shares *
              (await polygon.readContract({ address: POLYMARKET_CONDITIONAL_TOKENS, abi: CTF_ABI, functionName: 'payoutNumerators', args: [conditionId, BigInt(leg.index)], blockNumber }))) /
            denominator
          )
        )
        return { conditionId, assets: pair.map(leg => leg.tokenId), shares, resolved: true, value: paid.reduce((total, v) => total + v, 0n) }
      }
      if (market.fd !== undefined && !Number.isInteger(market.fd.e)) throw new Error(`Polymarket condition ${conditionId} has the fee exponent ${market.fd.e}, which no exit value can be computed with exactly`)
      const feeRate = market.fd === undefined ? 0n : parseUnits(String(market.fd.r), POLYMARKET_COLLATERAL_DECIMALS)
      const feeExponent = market.fd === undefined ? 0n : BigInt(market.fd.e)
      const merged = pair.length === 2 ? (pair[0]!.shares < pair[1]!.shares ? pair[0]!.shares : pair[1]!.shares) : 0n
      const walked = await Promise.all(
        pair.map(async leg => (leg.shares === merged ? 0n : bidWalk((await readClobBook(leg.tokenId)).bids, leg.shares - merged, feeRate, feeExponent)))
      )
      return { conditionId, assets: pair.map(leg => leg.tokenId), shares, resolved: false, value: walked.reduce((total, v) => total + v, merged) }
    })
  )
}
