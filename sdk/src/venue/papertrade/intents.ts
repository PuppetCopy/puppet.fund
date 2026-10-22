import { formatUnits, zeroAddress } from 'viem'
import { readableUnitAmount } from '../../core/readable.js'
import type { IVenueIntent, IVenueIntentParams, IVenueIntents } from '../types.js'
import {
  CLOSE_TYPES,
  OPEN_POSITION_TYPES,
  PAPERTRADE_CHAIN_ID,
  PAPERTRADE_CORE_WITHDRAWAL_EVENT,
  PAPERTRADE_DOMAIN,
  PAPERTRADE_EXCHANGE,
  PAPERTRADE_INSTRUMENTS,
  PAPERTRADE_MAX_LEVERAGE,
  PAPERTRADE_MIN_MARGIN,
  PAPERTRADE_POSITION_CLOSED_EVENT,
  PAPERTRADE_POSITION_OPENED_EVENT,
  PAPERTRADE_SESSION_KEY_MANAGER,
  PAPERTRADE_SESSION_KEY_MANAGER_ABI,
  PAPERTRADE_SESSION_KEY_REGISTERED_EVENT,
  PAPERTRADE_SESSION_TTL_SEC,
  PAPERTRADE_WITHDRAW_MIN,
  REGISTER_SESSION_KEY_TYPES,
  WITHDRAW_TO_CORE_TYPES
} from './contracts.js'

const DEADLINE_SEC = 90n
const LANDING_GRACE_SEC = 60n
const SESSION_RENEW_SEC = 24n * 60n * 60n
const MARGIN_DECIMALS = 18
const WITHDRAW_DECIMALS = 6
const CORE_DECIMALS = 8

const secondsOf = (time: number): bigint => BigInt(Math.floor(time / 1000))
const nonceOf = (): bigint => crypto.getRandomValues(new BigUint64Array(1))[0]
const pastDeadline = (deadline: unknown): boolean => secondsOf(Date.now()) > BigInt(deadline as bigint) + LANDING_GRACE_SEC

const instrumentOf = (params: IVenueIntentParams) => {
  const instrument = PAPERTRADE_INSTRUMENTS.get(BigInt(params.instrument))
  if (instrument === undefined) throw new Error(`Papertrade trades ${[...PAPERTRADE_INSTRUMENTS.values()].map(each => each.symbol).join(' and ')}, not instrument ${params.instrument}`)
  return instrument
}

const open: IVenueIntent = {
  intent: 'open',
  label: 'Open position',
  inputs: [
    { kind: 'choice', name: 'instrument', label: 'Market', options: [...PAPERTRADE_INSTRUMENTS].map(([id, instrument]) => ({ value: String(id), label: instrument.symbol })) },
    { kind: 'side', name: 'side', label: 'Side' },
    { kind: 'amount', name: 'margin', label: 'Margin', symbol: 'USDC', decimals: MARGIN_DECIMALS, min: PAPERTRADE_MIN_MARGIN },
    { kind: 'leverage', name: 'leverage', label: 'Leverage', max: Number(PAPERTRADE_MAX_LEVERAGE) }
  ],
  summary: params =>
    `Open ${instrumentOf(params).symbol} ${params.side} with ${readableUnitAmount(Number(formatUnits(BigInt(params.margin), MARGIN_DECIMALS)))} USDC at ${params.leverage}x`,
  async typedData(_ctx, account, params, time) {
    instrumentOf(params)
    const margin = BigInt(params.margin)
    const leverage = BigInt(params.leverage)
    if (params.side !== 'long' && params.side !== 'short') throw new Error(`a Papertrade position is long or short, not ${params.side}`)
    if (margin < PAPERTRADE_MIN_MARGIN) throw new Error(`Papertrade takes at least ${formatUnits(PAPERTRADE_MIN_MARGIN, MARGIN_DECIMALS)} USDC of margin`)
    if (leverage < 1n || leverage > PAPERTRADE_MAX_LEVERAGE) throw new Error(`Papertrade leverage runs from 1x to ${PAPERTRADE_MAX_LEVERAGE}x, not ${leverage}x`)
    return {
      domain: PAPERTRADE_DOMAIN,
      types: { OpenPosition: OPEN_POSITION_TYPES },
      primaryType: 'OpenPosition',
      message: {
        user: account,
        instrumentId: Number(params.instrument),
        isLong: params.side === 'long',
        size: margin,
        leverage: Number(leverage),
        useDebt: false,
        nonce: nonceOf(),
        deadline: secondsOf(time) + DEADLINE_SEC
      }
    }
  },
  async landing(client, account, typedData, fromBlock) {
    const message = typedData.message as { instrumentId: number; isLong: boolean; size: bigint; leverage: number; deadline: bigint }
    const logs = await client.getLogs({ address: PAPERTRADE_EXCHANGE, event: PAPERTRADE_POSITION_OPENED_EVENT, args: { user: account }, fromBlock, strict: true })
    const opened = logs.find(
      log => log.args.instrumentId === message.instrumentId && log.args.isLong === message.isLong && log.args.margin === message.size && log.args.leverage === message.leverage
    )
    if (opened !== undefined) return { block: opened.blockNumber, txHash: opened.transactionHash }
    return pastDeadline(message.deadline) ? { expired: 'Papertrade did not open the position before its deadline, so nothing was placed' } : null
  }
}

const close: IVenueIntent = {
  intent: 'close',
  label: 'Close',
  inputs: [{ kind: 'position', name: 'position', label: 'Position' }],
  summary: params => `Close position ${params.position}`,
  async typedData(_ctx, account, params, time) {
    return {
      domain: PAPERTRADE_DOMAIN,
      types: { Close: CLOSE_TYPES },
      primaryType: 'Close',
      message: { user: account, positionIds: [BigInt(params.position)], nonce: nonceOf(), deadline: secondsOf(time) + DEADLINE_SEC }
    }
  },
  async landing(client, account, typedData, fromBlock) {
    const message = typedData.message as { positionIds: readonly bigint[]; deadline: bigint }
    const logs = await client.getLogs({
      address: PAPERTRADE_EXCHANGE,
      event: PAPERTRADE_POSITION_CLOSED_EVENT,
      args: { positionId: message.positionIds[0], user: account },
      fromBlock,
      strict: true
    })
    if (logs.length > 0) return { block: logs[0].blockNumber, txHash: logs[0].transactionHash }
    return pastDeadline(message.deadline) ? { expired: 'Papertrade did not close the position before its deadline, so it is still open' } : null
  }
}

const withdraw: IVenueIntent = {
  intent: 'withdraw',
  label: 'Withdraw to Hyperliquid',
  inputs: [{ kind: 'amount', name: 'amount', label: 'Amount', symbol: 'USDC', decimals: WITHDRAW_DECIMALS, min: PAPERTRADE_WITHDRAW_MIN }],
  summary: params => `Withdraw ${readableUnitAmount(Number(formatUnits(BigInt(params.amount), WITHDRAW_DECIMALS)))} USDC to the fund's Hyperliquid account`,
  async typedData(_ctx, account, params, time) {
    const amount = BigInt(params.amount)
    if (amount < PAPERTRADE_WITHDRAW_MIN) throw new Error(`Papertrade withdraws at least ${formatUnits(PAPERTRADE_WITHDRAW_MIN, WITHDRAW_DECIMALS)} USDC`)
    return {
      domain: PAPERTRADE_DOMAIN,
      types: { WithdrawToCore: WITHDRAW_TO_CORE_TYPES },
      primaryType: 'WithdrawToCore',
      message: { user: account, amount, nonce: nonceOf(), deadline: secondsOf(time) + DEADLINE_SEC }
    }
  },
  async landing(client, account, typedData, fromBlock) {
    const message = typedData.message as { amount: bigint; deadline: bigint }
    const logs = await client.getLogs({ address: PAPERTRADE_EXCHANGE, event: PAPERTRADE_CORE_WITHDRAWAL_EVENT, args: { user: account }, fromBlock, strict: true })
    const landed = logs.find(log => log.args.coreAmount === message.amount * 10n ** BigInt(CORE_DECIMALS - WITHDRAW_DECIMALS))
    if (landed !== undefined) return { block: landed.blockNumber, txHash: landed.transactionHash }
    return pastDeadline(message.deadline) ? { expired: 'Papertrade did not withdraw before its deadline, so the USDC is still at Papertrade' } : null
  }
}

const register: IVenueIntent = {
  intent: 'register',
  label: 'Register session key',
  inputs: [],
  summary: () => `Register the fund's own key with Papertrade for ${PAPERTRADE_SESSION_TTL_SEC / 86_400n} days`,
  async typedData(_ctx, account, _params, time) {
    return {
      domain: PAPERTRADE_DOMAIN,
      types: { RegisterSessionKey: REGISTER_SESSION_KEY_TYPES },
      primaryType: 'RegisterSessionKey',
      message: { user: account, key: account, expiry: secondsOf(time) + PAPERTRADE_SESSION_TTL_SEC, feeAddress: zeroAddress, nonce: nonceOf(), deadline: secondsOf(time) + DEADLINE_SEC }
    }
  },
  async landing(client, account, typedData, fromBlock) {
    const message = typedData.message as { expiry: bigint; deadline: bigint }
    const logs = await client.getLogs({
      address: PAPERTRADE_SESSION_KEY_MANAGER,
      event: PAPERTRADE_SESSION_KEY_REGISTERED_EVENT,
      args: { user: account, key: account },
      fromBlock,
      strict: true
    })
    const registered = logs.find(log => log.args.expiry === message.expiry)
    if (registered !== undefined) return { block: registered.blockNumber, txHash: registered.transactionHash }
    return pastDeadline(message.deadline) ? { expired: "Papertrade did not register the fund's key before its deadline" } : null
  }
}

export const papertradeIntents: IVenueIntents = {
  chainId: PAPERTRADE_CHAIN_ID,
  list: [withdraw, open, close, register],
  async prerequisite(ctx, account, time) {
    const client = ctx.clients[PAPERTRADE_CHAIN_ID]
    if (client === undefined) throw new Error(`Papertrade's session key is read on HyperEVM (chain ${PAPERTRADE_CHAIN_ID}), and no client for it was handed in`)
    const [expiry] = await client.readContract({ address: PAPERTRADE_SESSION_KEY_MANAGER, abi: PAPERTRADE_SESSION_KEY_MANAGER_ABI, functionName: 'sessionKeys', args: [account, account] })
    return expiry > secondsOf(time) + SESSION_RENEW_SEC ? null : { intent: register.intent, params: {} }
  }
}
