import { decodeAbiParameters, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, formatUnits, isAddressEqual, zeroAddress } from 'viem'
import { USD_SYMBOL } from '../../const/common.js'
import { TOKEN_META } from '../../const/network.js'
import { readableUnitAmount } from '../../core/readable.js'
import { CCTP_HYPEREVM_DOMAIN, CCTP_TOKEN_MESSENGER, CCTP_TOKEN_MESSENGER_ABI, hyperCoreRecipientOf } from '../cctp.js'
import type { IVenuePosition, IVenueValueParams } from '../types.js'
import {
  HYPERCORE_SPOT_BALANCE,
  HYPERCORE_USDC_DECIMALS,
  HYPERCORE_USDC_INDEX,
  PAPERTRADE_ACTIVATION_FEE,
  PAPERTRADE_CHAIN_ID,
  PAPERTRADE_CORE_WITHDRAWAL_EVENT,
  PAPERTRADE_EVM_USDC,
  PAPERTRADE_EXCHANGE,
  PAPERTRADE_EXCHANGE_ABI,
  PAPERTRADE_INSTRUMENTS,
  PAPERTRADE_MAX_LEVERAGE,
  PAPERTRADE_ORACLE,
  PAPERTRADE_ORACLE_ABI,
  PAPERTRADE_SWEEP_REQUESTED_EVENT,
  PAPERTRADE_SWEPT_EVENT,
  papertradeProxyOf
} from './contracts.js'

const E = 10n ** 18n
const EXCHANGE_DECIMALS = 18
const DEADBAND = 50_000n
const PIN_SKEW_SEC = 10
const SETTLE_BLOCKS = 600n
const DEPOSIT_WINDOW_BLOCKS = 7_200n
const BURN_WINDOW_BLOCKS = 14_400n
const LOG_CHUNK_BLOCKS = 5_000n
const WITHDRAW_LANDING_SEC = 10
const READ_GAP_BLOCKS = 2n
const CORE_PER_USDC_UNIT = 10n ** BigInt(HYPERCORE_USDC_DECIMALS - TOKEN_META.USDC.decimals)

interface IPapertradeImpact {
  rateMultiplier: bigint
  positionMultiplier: bigint
  baseRate: bigint
  referenceNotional: bigint
}

const rangesOf = (from: bigint, to: bigint): { fromBlock: bigint; toBlock: bigint }[] => {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
  for (let start = from; start <= to; start += LOG_CHUNK_BLOCKS) ranges.push({ fromBlock: start, toBlock: start + LOG_CHUNK_BLOCKS - 1n < to ? start + LOG_CHUNK_BLOCKS - 1n : to })
  return ranges
}

export function papertradePayout(isLong: boolean, entry: bigint, mark: bigint, margin: bigint, leverage: bigint, impact: IPapertradeImpact, winFee: bigint): bigint {
  const band = entry / DEADBAND
  const exit = isLong ? (mark > entry + band ? mark - band : mark > entry ? entry : mark) : mark + band < entry ? mark + band : mark < entry ? entry : mark
  const move = isLong ? exit - entry : entry - exit
  const raw = (margin * leverage * move) / entry
  if (raw <= 0n) return raw < -margin ? -margin : raw
  const distance = (move * E) / entry
  const f = (distance * impact.rateMultiplier) / E
  const q = (1_000_000n * distance * impact.positionMultiplier) / E
  if (f === 0n || q === 0n) return 0n
  const m = (E * E) / f
  const h = (impact.referenceNotional * E) / q
  if (m > E * E || h > E * E) return 0n
  const adjusted = (raw * (((E - impact.baseRate) * E) / (E + m + h))) / E
  return adjusted - (adjusted * winFee) / E
}

export function papertradeBust(isLong: boolean, entry: bigint, leverage: bigint, bustBuffer: bigint): bigint {
  const edge = isLong ? entry - entry / leverage : entry + entry / leverage
  return isLong ? edge + (edge * bustBuffer) / E : edge - (edge * bustBuffer) / E
}

export async function papertradePositions(params: IVenueValueParams): Promise<IVenuePosition[]> {
  const client = params.clients[PAPERTRADE_CHAIN_ID]
  if (client === undefined) throw new Error(`Papertrade is valued on HyperEVM (chain ${PAPERTRADE_CHAIN_ID}), and no client for it was handed in`)
  const origin = params.clients[params.chainId]
  if (origin === undefined) throw new Error(`Papertrade deposits are burned on chain ${params.chainId}, and no client for it was handed in`)
  const account = params.account
  const proxy = papertradeProxyOf(account)
  const blockNumber = await client.getBlockNumber()
  const exchange = { address: PAPERTRADE_EXCHANGE, abi: PAPERTRADE_EXCHANGE_ABI, blockNumber } as const
  const burnFrom = params.blockNumber > BURN_WINDOW_BLOCKS ? params.blockNumber - BURN_WINDOW_BLOCKS : 0n
  const [block, oracle, cash, ids, parked, parkedEvm, winFee, rate, burnLogs] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({ ...exchange, functionName: 'oracle' }),
    client.readContract({ ...exchange, functionName: 'balances', args: [account] }),
    client.readContract({ ...exchange, functionName: 'getUserOpenPositionIds', args: [account] }),
    client.call({ to: HYPERCORE_SPOT_BALANCE, data: encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [proxy, HYPERCORE_USDC_INDEX]), blockTag: 'latest', batch: false }).then(res => {
      if (res.data === undefined) throw new Error(`HyperCore answered no spot balance for the Papertrade deposit address ${proxy}`)
      return decodeAbiParameters([{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }], res.data)[0]
    }),
    client.readContract({ address: PAPERTRADE_EVM_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [proxy], blockNumber }),
    client.readContract({ ...exchange, functionName: 'winFeeRate' }),
    params.getRate(TOKEN_META.USDC.symbol, USD_SYMBOL, params.freshness),
    Promise.all(
      rangesOf(burnFrom, params.blockNumber).map(range =>
        origin.getLogs({ address: CCTP_TOKEN_MESSENGER, event: CCTP_TOKEN_MESSENGER_ABI[1], args: { depositor: account }, ...range, strict: true })
      )
    ).then(logs =>
      logs.flat().filter(log => log.args.destinationDomain === CCTP_HYPEREVM_DOMAIN && isAddressEqual(hyperCoreRecipientOf(log.args.hookData)?.recipient ?? zeroAddress, proxy))
    )
  ])
  if (!isAddressEqual(oracle, PAPERTRADE_ORACLE)) throw new Error(`Papertrade's Exchange now prices from ${oracle}, not the pinned oracle ${PAPERTRADE_ORACLE}`)
  if (rate.token1 === 0n) throw new Error(`rate ${TOKEN_META.USDC.symbol}/${USD_SYMBOL} has a zero denominator`)
  const skew = Number(block.timestamp) - params.blockTimestamp
  if (skew > PIN_SKEW_SEC || skew < -PIN_SKEW_SEC) {
    throw new Error(
      `HyperEVM's latest block ${blockNumber} is ${skew}s from the valuation's block on chain ${params.chainId}; Papertrade is read only within ${PIN_SKEW_SEC}s of it, since a position at up to ${PAPERTRADE_MAX_LEVERAGE}x moves too far in between`
    )
  }
  const head = await client.getBlockNumber()
  const sweepFrom = head - (burnLogs.length === 0 ? SETTLE_BLOCKS : DEPOSIT_WINDOW_BLOCKS)
  const [requested, swept, withdrawn] = await Promise.all([
    Promise.all(
      rangesOf(sweepFrom, head).map(range =>
        client.getLogs({ address: PAPERTRADE_EXCHANGE, event: PAPERTRADE_SWEEP_REQUESTED_EVENT, args: { user: account }, ...range, strict: true })
      )
    ).then(logs => logs.flat()),
    Promise.all(
      rangesOf(sweepFrom, head).map(range => client.getLogs({ address: PAPERTRADE_EXCHANGE, event: PAPERTRADE_SWEPT_EVENT, args: { user: account }, ...range, strict: true }))
    ).then(logs => logs.flat()),
    client.getLogs({ address: PAPERTRADE_EXCHANGE, event: PAPERTRADE_CORE_WITHDRAWAL_EVENT, args: { user: account }, fromBlock: head - SETTLE_BLOCKS, toBlock: head, strict: true })
  ])
  const during = [...requested, ...swept, ...withdrawn].find(log => log.blockNumber + READ_GAP_BLOCKS >= blockNumber)
  if (during !== undefined) {
    throw new Error(
      `Papertrade moved this fund's money at HyperEVM block ${during.blockNumber}, between its pinned read at ${blockNumber} and its HyperCore read at the head ${head}; value it again`
    )
  }
  const unswept = [...requested.map(log => ({ log, step: 1 })), ...swept.map(log => ({ log, step: -1 }))]
    .sort((a, b) => (a.log.blockNumber === b.log.blockNumber ? a.log.logIndex - b.log.logIndex : a.log.blockNumber < b.log.blockNumber ? -1 : 1))
    .reduce((open, each) => (open + each.step < 0 ? 0 : open + each.step), 0)
  if (unswept > 0) {
    throw new Error(
      `Papertrade is moving a deposit from the deposit address ${proxy} into its exchange (requested at HyperEVM block ${requested[requested.length - 1].blockNumber}); value it again once Papertrade credits it, usually within seconds`
    )
  }
  const withdrawals = await Promise.all(withdrawn.map(async log => ({ log, at: Number((await client.getBlock({ blockNumber: log.blockNumber })).timestamp) })))
  const landing = withdrawals.find(each => each.at >= Number(block.timestamp) - WITHDRAW_LANDING_SEC)
  if (landing !== undefined) {
    throw new Error(
      `a Papertrade withdrawal of ${readableUnitAmount(Number(formatUnits(landing.log.args.amount, EXCHANGE_DECIMALS)))} USDC to the fund's HyperCore account (HyperEVM block ${landing.log.blockNumber}) may not have landed yet; value it again in ${WITHDRAW_LANDING_SEC}s`
    )
  }
  const burns = (
    await Promise.all(
      burnLogs.map(async log => ({ log, at: Number((await origin.getBlock({ blockNumber: log.blockNumber })).timestamp), least: log.args.amount - log.args.maxFee }))
    )
  ).sort((a, b) => a.at - b.at)
  const sweeps = (
    await Promise.all(
      requested
        .filter(log => isAddressEqual(log.args.proxy, proxy))
        .map(async log => ({ at: Number((await client.getBlock({ blockNumber: log.blockNumber })).timestamp), amount: log.args.coreAmount / CORE_PER_USDC_UNIT + log.args.evmAmount }))
    )
  ).sort((a, b) => a.at - b.at)
  let credited = 0
  const cover = (amount: bigint, before: number): void => {
    let used = 0n
    while (credited < burns.length && burns[credited].at <= before && used + burns[credited].least - PAPERTRADE_ACTIVATION_FEE <= amount) {
      used += burns[credited].least - PAPERTRADE_ACTIVATION_FEE
      credited++
    }
  }
  for (const sweep of sweeps) cover(sweep.amount, sweep.at)
  cover(parked / CORE_PER_USDC_UNIT + parkedEvm, Number(block.timestamp))
  const usdOf = (amount: bigint, decimals: number): bigint => (amount * rate.token0) / (rate.token1 * 10n ** BigInt(decimals - TOKEN_META.USDC.decimals))
  const held = await Promise.all(ids.map(async id => ({ id, position: await client.readContract({ ...exchange, functionName: 'positions', args: [id] }) })))
  const markets = new Map(
    await Promise.all(
      [...new Set(held.map(each => each.position[1]))].map(async instrumentId => {
        const instrument = PAPERTRADE_INSTRUMENTS.get(instrumentId)
        if (instrument === undefined) throw new Error(`Papertrade holds a position on instrument ${instrumentId}, which has no pinned symbol or price scale`)
        const [config, pause, mark] = await Promise.all([
          client.readContract({ ...exchange, functionName: 'instruments', args: [Number(instrumentId)] }),
          client.readContract({ ...exchange, functionName: 'marketPause', args: [Number(instrumentId)] }),
          client
            .call({ to: PAPERTRADE_ORACLE, data: encodeFunctionData({ abi: PAPERTRADE_ORACLE_ABI, functionName: 'getExecutionPrice', args: [Number(instrumentId)] }), blockTag: 'latest', batch: false })
            .then(res => {
              if (res.data === undefined) throw new Error(`Papertrade's oracle answered no price for ${instrument.symbol}`)
              return decodeFunctionResult({ abi: PAPERTRADE_ORACLE_ABI, functionName: 'getExecutionPrice', data: res.data })
            })
        ])
        if (pause.some(word => word !== 0n)) throw new Error(`Papertrade ${instrument.symbol} is paused or retired (${pause.join(', ')}), and a frozen market is not valued`)
        const [rateMultiplier, positionMultiplier, , , , bustBuffer, baseRate, referenceNotional] = config
        return [instrumentId, { instrument, mark, bustBuffer, impact: { rateMultiplier, positionMultiplier, baseRate, referenceNotional } }] as const
      })
    )
  )
  const time = Math.min(params.nowSec, Number(block.timestamp), rate.time)
  const priceOf = (price: bigint, scale: bigint): string => `$${readableUnitAmount(Number(price) / Number(scale))}`
  const rows: IVenuePosition[] = []
  if (cash > 0n) {
    const value = usdOf(cash, EXCHANGE_DECIMALS)
    rows.push({ holder: account, chainId: BigInt(PAPERTRADE_CHAIN_ID), contract: PAPERTRADE_EXCHANGE, key: 'cash', kind: 'cash', label: 'Papertrade cash', size: cash, unit: TOKEN_META.USDC.symbol, decimals: EXCHANGE_DECIMALS, cost: value, value, fieldLabelList: [], fieldValueList: [], time })
  }
  for (const { id, position } of held) {
    const [owner, instrumentId, entry, margin, leverage, , isLong, , isOpen] = position
    if (!isAddressEqual(owner, account) || !isOpen) throw new Error(`Papertrade listed position ${id} as open for ${account}, but it reads owner ${owner} and open ${isOpen}`)
    const market = markets.get(instrumentId)!
    const bust = papertradeBust(isLong, entry, leverage, market.bustBuffer)
    const liquidated = isLong ? market.mark <= bust : market.mark >= bust
    const worth = liquidated ? 0n : margin + papertradePayout(isLong, entry, market.mark, margin, leverage, market.impact, winFee)
    rows.push({
      holder: account,
      chainId: BigInt(PAPERTRADE_CHAIN_ID),
      contract: PAPERTRADE_EXCHANGE,
      key: `position:${id}`,
      kind: 'perp',
      label: `${market.instrument.symbol} ${isLong ? 'long' : 'short'}`,
      size: (margin * leverage * market.instrument.priceScale) / entry,
      unit: market.instrument.symbol,
      decimals: EXCHANGE_DECIMALS,
      cost: usdOf(margin, EXCHANGE_DECIMALS),
      value: usdOf(worth, EXCHANGE_DECIMALS),
      fieldLabelList: ['Leverage', 'Margin', 'Entry', 'Bust', 'Priced by'],
      fieldValueList: [
        `${leverage}x`,
        `${readableUnitAmount(Number(formatUnits(margin, EXCHANGE_DECIMALS)))} USDC`,
        priceOf(entry, market.instrument.priceScale),
        priceOf(bust, market.instrument.priceScale),
        liquidated ? 'past its bust price, so it closes for nothing' : `closing now at the Hyperliquid mid ${priceOf(market.mark, market.instrument.priceScale)}, after Papertrade's fees`
      ],
      time
    })
  }
  if (parked > 0n) {
    const value = usdOf(parked, HYPERCORE_USDC_DECIMALS)
    rows.push({
      holder: proxy,
      chainId: BigInt(PAPERTRADE_CHAIN_ID),
      contract: proxy,
      key: `deposit:${proxy}`,
      kind: 'transit',
      label: 'USDC at the Papertrade deposit address on HyperCore',
      size: parked,
      unit: TOKEN_META.USDC.symbol,
      decimals: HYPERCORE_USDC_DECIMALS,
      cost: value,
      value,
      fieldLabelList: ['Status'],
      fieldValueList: ['arrived on HyperCore, waiting for Papertrade to sweep it in'],
      time
    })
  }
  if (parkedEvm > 0n) {
    const value = usdOf(parkedEvm, TOKEN_META.USDC.decimals)
    rows.push({
      holder: proxy,
      chainId: BigInt(PAPERTRADE_CHAIN_ID),
      contract: PAPERTRADE_EVM_USDC,
      key: `deposit-evm:${proxy}`,
      kind: 'transit',
      label: 'USDC at the Papertrade deposit address on HyperEVM',
      size: parkedEvm,
      unit: TOKEN_META.USDC.symbol,
      decimals: TOKEN_META.USDC.decimals,
      cost: value,
      value,
      fieldLabelList: ['Status'],
      fieldValueList: ['arrived on HyperEVM, waiting for Papertrade to sweep it in'],
      time
    })
  }
  for (const burn of burns.slice(credited)) {
    const value = usdOf(burn.least, TOKEN_META.USDC.decimals)
    rows.push({
      holder: account,
      chainId: BigInt(params.chainId),
      contract: CCTP_TOKEN_MESSENGER,
      key: `cctp:${burn.log.transactionHash}`,
      kind: 'transit',
      label: 'Deposit to Papertrade (CCTP)',
      size: burn.least,
      unit: TOKEN_META.USDC.symbol,
      decimals: TOKEN_META.USDC.decimals,
      cost: value,
      value,
      fieldLabelList: ['Status'],
      fieldValueList: [`burned at block ${burn.log.blockNumber}, waiting for Circle to mint it at the Papertrade deposit address on HyperCore`],
      time
    })
  }
  return rows
}
