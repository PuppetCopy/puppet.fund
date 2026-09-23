import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, getAddress, isAddress, isAddressEqual, pad, size, slice, toFunctionSelector } from 'viem'
import { readableTokenAmountLabel } from '../../core/readable.js'
import { getTokenDescription } from '../../core/token.js'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IDappScreenReason, IGuardReason, IOperateStep, IScreenContext, IVenue } from '../types.js'
import {
  CCTP_HYPERCORE_DEXES,
  CCTP_HYPERCORE_FORWARDER,
  CCTP_HYPERCORE_MAX_FEE,
  CCTP_HYPEREVM_DOMAIN,
  CCTP_TOKEN_MESSENGER,
  CCTP_TOKEN_MESSENGER_ABI,
  HYPERCORE_USDC,
  HYPERCORE_WITHDRAW_DESTINATIONS,
  HYPERLIQUID_ACTION_DOMAIN,
  HYPERLIQUID_ADMITTED_ACTIONS,
  HYPERLIQUID_BRIDGE,
  HYPERLIQUID_CHAIN_ID,
  HYPERLIQUID_CONTRACTS,
  HYPERLIQUID_DEPOSIT_MIN,
  HYPERLIQUID_DEPOSIT_TOKEN,
  HYPERLIQUID_SEND_TO_EVM,
  HYPERLIQUID_USER_DOMAIN,
  HYPERLIQUID_WITHDRAW,
  hyperCoreRecipientOf
} from './contracts.js'
import { valueHyperliquidAccount } from './evaluate.js'

const PLATFORM = 'hyperliquid'

function bridgeDeposit(call: IIAccount__Call): { amount: bigint } | null {
  const dec = decodeErc20(call.callData)
  if (dec?.functionName !== 'transfer') return null
  const [to, amount] = dec.args as readonly [Address, bigint]
  return isAddressEqual(to, HYPERLIQUID_BRIDGE) ? { amount } : null
}

const BURN_SELECTOR = toFunctionSelector(CCTP_TOKEN_MESSENGER_ABI[0])
const FORWARDER_WORD = pad(CCTP_HYPERCORE_FORWARDER).toLowerCase()

function cctpBurn(call: IIAccount__Call) {
  if (!isAddressEqual(call.target, CCTP_TOKEN_MESSENGER) || size(call.callData) < 4 || slice(call.callData, 0, 4) !== BURN_SELECTOR) return null
  const [amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData] = decodeFunctionData({
    abi: CCTP_TOKEN_MESSENGER_ABI,
    data: call.callData
  }).args
  return { amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData }
}

function approvesCctp(call: IIAccount__Call): boolean {
  const dec = decodeErc20(call.callData)
  return dec?.functionName === 'approve' && isAddressEqual((dec.args as readonly [Address, bigint])[0], CCTP_TOKEN_MESSENGER)
}

function screenCctpBurn(account: Address, burn: NonNullable<ReturnType<typeof cctpBurn>>): IGuardReason[] {
  const reasons: IGuardReason[] = []
  if (!isAddressEqual(burn.burnToken, HYPERLIQUID_DEPOSIT_TOKEN)) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `a Hyperliquid CCTP deposit burns ${HYPERLIQUID_DEPOSIT_TOKEN} only, not ${burn.burnToken}` })
  }
  if (burn.destinationDomain !== CCTP_HYPEREVM_DOMAIN) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_DESTINATION', detail: `CCTP destination domain ${burn.destinationDomain} is not HyperEVM (${CCTP_HYPEREVM_DOMAIN})` })
  }
  if (burn.mintRecipient.toLowerCase() !== FORWARDER_WORD || burn.destinationCaller.toLowerCase() !== FORWARDER_WORD) {
    reasons.push({
      code: 'VENUE_DEPOSIT_BAD_DESTINATION',
      detail: `CCTP mintRecipient ${burn.mintRecipient} and destinationCaller ${burn.destinationCaller} must both be the HyperCore forwarder ${CCTP_HYPERCORE_FORWARDER}`
    })
  }
  if (burn.maxFee > CCTP_HYPERCORE_MAX_FEE) {
    reasons.push({ code: 'VENUE_DEPOSIT_FEE', detail: `CCTP maxFee ${burn.maxFee} exceeds the ${CCTP_HYPERCORE_MAX_FEE} HyperCore forwarding fee` })
  }
  const forward = hyperCoreRecipientOf(burn.hookData)
  if (forward === null) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `CCTP hookData ${burn.hookData} does not forward to a HyperCore recipient` })
  } else {
    if (!isAddressEqual(forward.recipient, account)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `a Hyperliquid deposit may only credit the account itself (${account}), not ${forward.recipient}` })
    }
    if (!CCTP_HYPERCORE_DEXES.has(forward.dex)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_DEX', detail: `HyperCore destination dex ${forward.dex} is neither perps (0) nor spot (${0xffffffff})` })
    }
  }
  return reasons
}

export const hyperliquidVenue: IVenue = {
  venueId: PLATFORM,
  name: 'Hyperliquid',
  chains: [HYPERLIQUID_CHAIN_ID],
  contracts: HYPERLIQUID_CONTRACTS,
  value: valueHyperliquidAccount,
  claims(ctx: IScreenContext, call) {
    if (ctx.chainId !== HYPERLIQUID_CHAIN_ID) return false
    if (cctpBurn(call) !== null) return true
    return isRegisteredToken(ctx, call.target) && (bridgeDeposit(call) !== null || approvesCctp(call))
  },
  screen(ctx, call) {
    const reasons: IGuardReason[] = []
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${call.target} forwards native value ${call.value}` })
    }
    const burn = cctpBurn(call)
    if (burn !== null) return [...reasons, ...screenCctpBurn(ctx.account, burn)]
    if (approvesCctp(call)) {
      if (!isAddressEqual(call.target, HYPERLIQUID_DEPOSIT_TOKEN)) {
        reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `Circle CCTP deposits into Hyperliquid take ${HYPERLIQUID_DEPOSIT_TOKEN} only, not ${call.target}` })
      }
      return reasons
    }
    const deposit = bridgeDeposit(call)
    if (deposit === null) return reasons
    if (!isAddressEqual(call.target, HYPERLIQUID_DEPOSIT_TOKEN)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `the Hyperliquid bridge takes ${HYPERLIQUID_DEPOSIT_TOKEN} only, not ${call.target}` })
    } else if (deposit.amount < HYPERLIQUID_DEPOSIT_MIN) {
      reasons.push({ code: 'VENUE_DEPOSIT_BELOW_MIN', detail: `Hyperliquid forfeits bridge deposits below ${HYPERLIQUID_DEPOSIT_MIN}; ${deposit.amount} would be lost` })
    }
    return reasons
  },
  outflows(call) {
    const burn = cctpBurn(call)
    if (burn !== null) return [{ token: getAddress(burn.burnToken), amount: burn.amount }]
    const deposit = bridgeDeposit(call)
    return deposit === null ? [] : [{ token: getAddress(call.target), amount: deposit.amount }]
  },
  describe(chainId, callList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== HYPERLIQUID_CHAIN_ID) return out
    callList.forEach((call, i) => {
      const burn = cctpBurn(call)
      if (burn !== null) {
        const token = getAddress(burn.burnToken)
        const description = getTokenDescription(HYPERLIQUID_CHAIN_ID, token)
        const forward = hyperCoreRecipientOf(burn.hookData)
        out.set(i, [
          {
            kind: 'venue',
            venueId: PLATFORM,
            key: null,
            call: 'depositForBurnWithHook',
            label: 'Deposit',
            fields: [
              { label: 'amount', value: readableTokenAmountLabel(description, burn.amount) },
              { label: 'bridge fee', value: `up to ${readableTokenAmountLabel(description, burn.maxFee)}` },
              ...(forward === null ? [] : [{ label: 'credits', value: `your Hyperliquid ${forward.dex === 0 ? 'perps' : 'spot'} balance` }])
            ],
            flows: [{ token, delta: -burn.amount }]
          }
        ])
        return
      }
      const deposit = bridgeDeposit(call)
      if (deposit === null) return
      const token = getAddress(call.target)
      out.set(i, [
        {
          kind: 'venue',
          venueId: PLATFORM,
          key: null,
          call: 'transfer',
          label: 'Deposit',
          fields: [{ label: 'amount', value: readableTokenAmountLabel(getTokenDescription(HYPERLIQUID_CHAIN_ID, token), deposit.amount) }],
          flows: [{ token, delta: -deposit.amount }]
        }
      ])
    })
    return out
  },
  typedData(account, typedData) {
    const name = typedData.domain?.name
    if (name === HYPERLIQUID_ACTION_DOMAIN) {
      return [
        {
          code: 'DAPP_ACTION_NOT_ADMITTED',
          detail: `Hyperliquid ${typedData.primaryType} commits only to a hash of the action, so the account key never signs it blind; trade through an approved agent`
        }
      ]
    }
    if (name !== HYPERLIQUID_USER_DOMAIN) return null
    if (typedData.primaryType === HYPERLIQUID_WITHDRAW) {
      const destination = typedData.message.destination
      if (typeof destination !== 'string' || !isAddress(destination) || !isAddressEqual(destination, account)) {
        return [{ code: 'DAPP_EXIT_DESTINATION', detail: `a Hyperliquid withdrawal may only return to the account itself (${account}), not to ${String(destination)}` }]
      }
      return []
    }
    if (typedData.primaryType === HYPERLIQUID_SEND_TO_EVM) {
      const m = typedData.message
      const recipient = typeof m.destinationRecipient === 'string' ? m.destinationRecipient.toLowerCase() : ''
      const own = account.toLowerCase().slice(2)
      const toSelf = recipient === `0x${own}` || recipient === `0x${own.padStart(64, '0')}`
      const reasons: IDappScreenReason[] = []
      if (typeof m.token !== 'string' || !HYPERCORE_USDC.has(m.token)) {
        reasons.push({ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `a Hyperliquid transfer out may only move USDC, not ${String(m.token)}` })
      }
      if (m.addressEncoding !== 'hex' || !toSelf) {
        reasons.push({ code: 'DAPP_EXIT_DESTINATION', detail: `a Hyperliquid transfer out may only return to the account itself (${account}), not to ${String(m.destinationRecipient)} (${String(m.addressEncoding)})` })
      }
      if (!HYPERCORE_WITHDRAW_DESTINATIONS.has(Number(m.destinationChainId))) {
        reasons.push({ code: 'DAPP_EXIT_DESTINATION', detail: `a Hyperliquid transfer out may only land on Arbitrum or Optimism, not destination ${String(m.destinationChainId)}` })
      }
      return reasons
    }
    if (HYPERLIQUID_ADMITTED_ACTIONS.has(typedData.primaryType)) return []
    return [
      {
        code: 'DAPP_ACTION_NOT_ADMITTED',
        detail: `${typedData.primaryType} (${Object.keys(typedData.message).join(', ')}) is not an admitted Hyperliquid action; anything unlisted may move value or control out of the gated account`
      }
    ]
  },
  message() {
    return null
  }
}
