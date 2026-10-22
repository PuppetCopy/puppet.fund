import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, concat, encodeFunctionData, erc20Abi, getAddress, isAddressEqual, numberToHex, pad, stringToHex, zeroAddress } from 'viem'
import {
  CCTP_HYPERCORE_FORWARDER,
  CCTP_HYPERCORE_MAX_FEE,
  CCTP_HYPEREVM_DOMAIN,
  CCTP_TOKEN_MESSENGER,
  CCTP_TOKEN_MESSENGER_ABI,
  cctpBurn,
  HYPERCORE_SPOT_DEX,
  screenHyperCoreForward
} from '../cctp.js'
import { asBigInt, exactTypes, refuse, sameAddress } from '../typedFields.js'
import type { IDappScreenReason, IDappTypedData, IGuardReason, IOperateStep, IVenue, IVenueDeposit } from '../types.js'
import {
  CANCEL_DOMAIN,
  CANCEL_INTENT_TYPES,
  CLOSE_TYPES,
  OPEN_POSITION_TYPES,
  PAPERTRADE_ACTIVATION_FEE,
  PAPERTRADE_CHAIN_ID,
  PAPERTRADE_DEPOSIT_CHAIN_ID,
  PAPERTRADE_DEPOSIT_DEXES,
  PAPERTRADE_DEPOSIT_MIN,
  PAPERTRADE_DEPOSIT_TOKEN,
  PAPERTRADE_DOMAIN,
  PAPERTRADE_EXCHANGE,
  PAPERTRADE_INSTRUMENTS,
  PAPERTRADE_MAX_DEADLINE_SEC,
  PAPERTRADE_MAX_LEVERAGE,
  PAPERTRADE_MIN_MARGIN,
  PAPERTRADE_SESSION_TTL_SEC,
  PAPERTRADE_UNSIGNED_DOMAINS,
  papertradeProxyOf,
  REGISTER_SESSION_KEY_TYPES,
  WITHDRAW_TO_CORE_TYPES
} from './contracts.js'
import { hyperliquidVenue } from '../hyperliquid/screen.js'
import { attestPapertradeDeposit, attestPapertradeOpen } from './attest.js'
import { papertradePositions } from './evaluate.js'
import { papertradeIntents } from './intents.js'
import { papertradeSubmit } from './submit.js'

const PLATFORM = 'papertrade'
const SESSION_CLOCK_SLACK_SEC = 300n
const CCTP_FAST_FINALITY = 1000

function depositOf(account: Address, call: IIAccount__Call) {
  const burn = cctpBurn(call)
  return burn !== null && burn.forward !== null && isAddressEqual(burn.forward.recipient, papertradeProxyOf(account)) ? burn : null
}

function screenIntent(account: Address, td: IDappTypedData): IDappScreenReason[] {
  if (td.domain?.version !== PAPERTRADE_DOMAIN.version || !sameAddress(td.domain.verifyingContract, PAPERTRADE_EXCHANGE)) {
    return refuse(
      'DAPP_DOMAIN_NOT_ADMITTED',
      `Papertrade intents are signed only under "${PAPERTRADE_DOMAIN.name}" v${PAPERTRADE_DOMAIN.version} on chain ${PAPERTRADE_CHAIN_ID} at the Exchange ${PAPERTRADE_EXCHANGE}, not v${td.domain?.version} at ${String(td.domain?.verifyingContract)}`
    )
  }
  if (!sameAddress(td.message.user, account)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `a Papertrade ${td.primaryType} must name the account itself (${account}), not ${String(td.message.user)}`)
  }
  if (td.primaryType === 'OpenPosition') {
    if (!exactTypes(td, { OpenPosition: OPEN_POSITION_TYPES })) return refuse('DAPP_ACTION_NOT_ADMITTED', 'OpenPosition must carry exactly the fields the Exchange hashes')
    const instrument = asBigInt(td.message.instrumentId)
    const leverage = asBigInt(td.message.leverage)
    const margin = asBigInt(td.message.size)
    if (instrument === null || !PAPERTRADE_INSTRUMENTS.has(instrument)) {
      return refuse('DAPP_ACTION_NOT_ADMITTED', `instrument ${String(td.message.instrumentId)} is not one of ${[...PAPERTRADE_INSTRUMENTS].map(([id, instrument]) => `${instrument.symbol} (${id})`).join(', ')}`)
    }
    if (leverage === null || leverage < 1n || leverage > PAPERTRADE_MAX_LEVERAGE) {
      return refuse('DAPP_ACTION_NOT_ADMITTED', `leverage ${String(td.message.leverage)} is outside 1 to ${PAPERTRADE_MAX_LEVERAGE}`)
    }
    if (margin === null || margin < PAPERTRADE_MIN_MARGIN) {
      return refuse('DAPP_ACTION_NOT_ADMITTED', `margin ${String(td.message.size)} is below Papertrade's 10 USDC minimum (${PAPERTRADE_MIN_MARGIN} in 18 decimals)`)
    }
    if (td.message.useDebt !== false) {
      return refuse('DAPP_ACTION_NOT_ADMITTED', 'an open may not draw margin from queued winnings (useDebt): queued claims are valued at zero until paid')
    }
    return []
  }
  if (td.primaryType === 'Close') {
    if (!exactTypes(td, { Close: CLOSE_TYPES })) return refuse('DAPP_ACTION_NOT_ADMITTED', 'Close must carry exactly the fields the Exchange hashes')
    const ids = td.message.positionIds
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => asBigInt(id) === null)) {
      return refuse('DAPP_ACTION_NOT_ADMITTED', 'a Close names one or more position ids')
    }
    return []
  }
  if (td.primaryType === 'WithdrawToCore') {
    return exactTypes(td, { WithdrawToCore: WITHDRAW_TO_CORE_TYPES })
      ? []
      : refuse('DAPP_ACTION_NOT_ADMITTED', 'WithdrawToCore must carry exactly the fields the Exchange hashes')
  }
  if (td.primaryType === 'RegisterSessionKey') {
    if (!exactTypes(td, { RegisterSessionKey: REGISTER_SESSION_KEY_TYPES })) return refuse('DAPP_ACTION_NOT_ADMITTED', 'RegisterSessionKey must carry exactly the fields the Exchange hashes')
    if (!sameAddress(td.message.key, account)) {
      return refuse(
        'DAPP_ACTION_NOT_ADMITTED',
        `a Papertrade session key other than the fund itself (${String(td.message.key)}) would trade outside the fund's joint key; the fund registers only its own key (${account})`
      )
    }
    return sameAddress(td.message.feeAddress, zeroAddress)
      ? []
      : refuse('DAPP_ACTION_NOT_ADMITTED', `a session key's fee address must be zero, not ${String(td.message.feeAddress)}: no fee share is routed to another party`)
  }
  return refuse('DAPP_ACTION_NOT_ADMITTED', `${td.primaryType} is not an admitted Papertrade intent; the fund signs OpenPosition, Close, WithdrawToCore and its own RegisterSessionKey only`)
}

function screenCancel(account: Address, td: IDappTypedData): IDappScreenReason[] {
  if (td.domain?.version !== CANCEL_DOMAIN.version || !sameAddress(td.domain.verifyingContract, PAPERTRADE_EXCHANGE)) {
    return refuse('DAPP_DOMAIN_NOT_ADMITTED', `Papertrade cancels are signed only under "${CANCEL_DOMAIN.name}" v${CANCEL_DOMAIN.version} at the Exchange ${PAPERTRADE_EXCHANGE}`)
  }
  if (td.primaryType !== 'CancelIntent' || !exactTypes(td, { CancelIntent: CANCEL_INTENT_TYPES })) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `${td.primaryType} is not a Papertrade CancelIntent`)
  }
  return sameAddress(td.message.user, account) ? [] : refuse('DAPP_ACTION_NOT_ADMITTED', `a cancel must name the account itself (${account}), not ${String(td.message.user)}`)
}

export const papertradeDeposit: IVenueDeposit = {
  chainId: PAPERTRADE_DEPOSIT_CHAIN_ID,
  token: PAPERTRADE_DEPOSIT_TOKEN,
  min: PAPERTRADE_DEPOSIT_MIN + CCTP_HYPERCORE_MAX_FEE,
  creditSec: 0,
  callsOf: (account, amount) => [
    {
      target: PAPERTRADE_DEPOSIT_TOKEN,
      value: 0n,
      gasLimit: 100_000n,
      callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CCTP_TOKEN_MESSENGER, amount] })
    },
    {
      target: CCTP_TOKEN_MESSENGER,
      value: 0n,
      gasLimit: 200_000n,
      callData: encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurnWithHook',
        args: [
          amount,
          CCTP_HYPEREVM_DOMAIN,
          pad(CCTP_HYPERCORE_FORWARDER),
          PAPERTRADE_DEPOSIT_TOKEN,
          pad(CCTP_HYPERCORE_FORWARDER),
          CCTP_HYPERCORE_MAX_FEE,
          CCTP_FAST_FINALITY,
          concat([stringToHex('cctp-forward', { size: 24 }), numberToHex(0, { size: 4 }), numberToHex(24, { size: 4 }), papertradeProxyOf(account), numberToHex(HYPERCORE_SPOT_DEX, { size: 4 })])
        ]
      })
    }
  ]
}

export const papertradeVenue: IVenue = {
  venueId: PLATFORM,
  name: 'Papertrade',
  chains: [PAPERTRADE_DEPOSIT_CHAIN_ID],
  contracts: [],
  positions: papertradePositions,
  exitsInto: [hyperliquidVenue.venueId],
  claims(ctx, call) {
    return ctx.chainId === PAPERTRADE_DEPOSIT_CHAIN_ID && depositOf(ctx.account, call) !== null
  },
  screen(ctx, call) {
    const burn = depositOf(ctx.account, call)
    if (burn === null) return []
    const reasons: IGuardReason[] = []
    if (call.value !== 0n) reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${call.target} forwards native value ${call.value}` })
    if (burn.amount - burn.maxFee < PAPERTRADE_DEPOSIT_MIN) {
      reasons.push({
        code: 'VENUE_DEPOSIT_BELOW_MIN',
        detail: `Papertrade credits a deposit address only from ${PAPERTRADE_DEPOSIT_MIN} USDC units, and ${burn.amount} less the ${burn.maxFee} CCTP fee falls short`
      })
    }
    return [...reasons, ...screenHyperCoreForward(burn, PAPERTRADE_DEPOSIT_TOKEN, PAPERTRADE_DEPOSIT_DEXES)]
  },
  outflows(account, call) {
    const burn = depositOf(account, call)
    return burn === null ? [] : [{ token: getAddress(burn.burnToken), amount: burn.amount }]
  },
  exchange: () => ({ spent: [], received: [] }),
  describe(chainId, account, callList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== PAPERTRADE_DEPOSIT_CHAIN_ID) return out
    callList.forEach((call, i) => {
      const burn = account === null ? null : depositOf(account, call)
      if (account === null || burn === null) return
      const token = getAddress(burn.burnToken)
      out.set(i, [
        {
          kind: 'venue',
          venueId: PLATFORM,
          key: null,
          call: 'depositForBurnWithHook',
          label: 'Deposit',
          fields: [{ label: 'credits', value: `your Papertrade deposit address ${papertradeProxyOf(account)} on HyperCore` }],
          flows: [{ token, delta: -burn.amount, exact: true }],
          fees: [
            ...(burn.maxFee === 0n ? [] : [{ payee: 'route' as const, token, amount: burn.maxFee, expected: null }]),
            { payee: 'venue' as const, token, amount: PAPERTRADE_ACTIVATION_FEE, expected: null }
          ]
        }
      ])
    })
    return out
  },
  typedData(account, td) {
    const name = td.domain?.name
    if (asBigInt(td.domain?.chainId) !== BigInt(PAPERTRADE_CHAIN_ID) || name === undefined) return null
    if (name === PAPERTRADE_DOMAIN.name) return screenIntent(account, td)
    if (name === CANCEL_DOMAIN.name) return screenCancel(account, td)
    const unsigned = PAPERTRADE_UNSIGNED_DOMAINS.get(name)
    return unsigned === undefined ? null : refuse('DAPP_DOMAIN_NOT_ADMITTED', unsigned)
  },
  attestTypedData(clients, _account, td) {
    if (asBigInt(td.domain?.chainId) !== BigInt(PAPERTRADE_CHAIN_ID) || td.domain?.name !== PAPERTRADE_DOMAIN.name) return Promise.resolve([])
    if (td.primaryType === 'RegisterSessionKey') {
      const expiry = asBigInt(td.message.expiry)
      const longest = BigInt(Math.floor(Date.now() / 1000)) + PAPERTRADE_SESSION_TTL_SEC + SESSION_CLOCK_SLACK_SEC
      return Promise.resolve(
        expiry === null || expiry > longest
          ? refuse('DAPP_ACTION_NOT_ADMITTED', `the fund's Papertrade session key lasts at most ${PAPERTRADE_SESSION_TTL_SEC / 86_400n} days, as Papertrade's own app sets it, not until ${String(td.message.expiry)}`)
          : []
      )
    }
    if (td.primaryType !== 'OpenPosition' && td.primaryType !== 'Close') return Promise.resolve([])
    const deadline = asBigInt(td.message.deadline)
    const latest = BigInt(Math.floor(Date.now() / 1000)) + PAPERTRADE_MAX_DEADLINE_SEC
    if (deadline === null || deadline > latest) {
      return Promise.resolve(
        refuse(
          'ORDER_PRICE_BOUND',
          `Papertrade fills at the Hyperliquid mid whenever its relayer submits, so the deadline is the only price bound: at most ${PAPERTRADE_MAX_DEADLINE_SEC} s ahead (${latest}), not ${String(td.message.deadline)}`
        )
      )
    }
    return td.primaryType === 'OpenPosition' ? attestPapertradeOpen(clients[PAPERTRADE_CHAIN_ID], td) : Promise.resolve([])
  },
  submit: papertradeSubmit,
  attestOperate(clients, chainId, account, callList) {
    if (chainId !== PAPERTRADE_DEPOSIT_CHAIN_ID || !callList.some(call => depositOf(account, call) !== null)) return Promise.resolve([])
    return attestPapertradeDeposit(clients[PAPERTRADE_CHAIN_ID], account)
  },
  message() {
    return null
  },
  intents: papertradeIntents
}
