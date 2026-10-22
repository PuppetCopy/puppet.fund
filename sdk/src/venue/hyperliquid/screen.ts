import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi, formatUnits, getAddress, type Hex, isAddress, isAddressEqual, parseSignature, parseUnits, toHex, zeroAddress } from 'viem'
import { USD_DECIMALS } from '../../const/common.js'
import { getTokenDescription } from '../../core/token.js'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IDappScreenReason, IGuardReason, IOperateStep, IScreenContext, IVenue } from '../types.js'
import { approvesCctp, CCTP_HYPERCORE_DEXES, cctpBurn, HYPERCORE_PERPS_DEX, screenHyperCoreForward } from '../cctp.js'
import { HYPERLIQUID_ACTION_DOMAIN, HYPERLIQUID_ADMITTED_ACTIONS, HYPERLIQUID_APPROVE_AGENT, HYPERLIQUID_BRIDGE, HYPERLIQUID_CHAIN_ID, HYPERLIQUID_CONTRACTS, HYPERLIQUID_DEPOSIT_MIN, HYPERLIQUID_DEPOSIT_TOKEN, HYPERLIQUID_EXCHANGE_URL, HYPERLIQUID_REFERRAL_ACTION, HYPERLIQUID_SEND_TO_EVM, HYPERLIQUID_USER_DOMAIN, HYPERLIQUID_WITHDRAW, HYPERLIQUID_WITHDRAW_FEE } from './contracts.js'
import { hyperliquidInfo, hyperliquidPositions, hyperliquidWithdrawLanding, readHyperliquidBalance } from './evaluate.js'

const PLATFORM = 'hyperliquid'

export async function submitHyperliquidAction(action: { type: 'setReferrer'; code: string }, nonce: number, signature: Hex): Promise<void> {
  const { r, s, yParity } = parseSignature(signature)
  const res = await fetch(HYPERLIQUID_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature: { r, s, v: yParity + 27 }, vaultAddress: null })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Hyperliquid answered ${res.status} to ${action.type}: ${text}`)
  const reply = JSON.parse(text) as { status: string; response: unknown }
  if (reply.status !== 'ok') throw new Error(`Hyperliquid refused ${action.type}: ${typeof reply.response === 'string' ? reply.response : text}`)
}

export async function admitHyperliquidAction(account: Address, action: { type: 'setReferrer'; code: string }, nonce: number): Promise<IDappScreenReason[]> {
  if (action?.type !== HYPERLIQUID_REFERRAL_ACTION.type || action.code !== HYPERLIQUID_REFERRAL_ACTION.code || !Number.isSafeInteger(nonce) || nonce <= 0) {
    return [
      {
        code: 'DAPP_ACTION_NOT_ADMITTED',
        detail: `the account key signs no Hyperliquid action but ${HYPERLIQUID_REFERRAL_ACTION.type} with Puppet's code ${HYPERLIQUID_REFERRAL_ACTION.code} under a timestamp nonce`
      }
    ]
  }
  const { referredBy } = await hyperliquidInfo<{ referredBy: { referrer: Address; code: string } | null }>({ type: 'referral', user: account })
  return referredBy === null ? [] : [{ code: 'REFERRAL_BOUND', detail: `Hyperliquid already lists ${account} as referred by code ${referredBy.code}; a referral binds once` }]
}

const WITHDRAW_DECIMALS = getTokenDescription(HYPERLIQUID_CHAIN_ID, HYPERLIQUID_DEPOSIT_TOKEN).decimals

function bridgeDeposit(call: IIAccount__Call): { amount: bigint } | null {
  const dec = decodeErc20(call.callData)
  if (dec?.functionName !== 'transfer') return null
  const [to, amount] = dec.args as readonly [Address, bigint]
  return isAddressEqual(to, HYPERLIQUID_BRIDGE) ? { amount } : null
}

export const hyperliquidVenue: IVenue = {
  venueId: PLATFORM,
  name: 'Hyperliquid',
  chains: [HYPERLIQUID_CHAIN_ID],
  contracts: HYPERLIQUID_CONTRACTS,
  positions: hyperliquidPositions,
  deposit: {
    chainId: HYPERLIQUID_CHAIN_ID,
    token: HYPERLIQUID_DEPOSIT_TOKEN,
    min: HYPERLIQUID_DEPOSIT_MIN,
    creditSec: 0,
    callsOf: (_account, amount) => [
      {
        target: HYPERLIQUID_DEPOSIT_TOKEN,
        value: 0n,
        gasLimit: PROTOCOL.transferGasLimit,
        callData: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [HYPERLIQUID_BRIDGE, amount] })
      }
    ]
  },
  withdraw: {
    chainId: HYPERLIQUID_CHAIN_ID,
    token: HYPERLIQUID_DEPOSIT_TOKEN,
    balance: async (_ctx, account) => {
      const { total, free } = await readHyperliquidBalance(account)
      return { total: (total * 10n ** BigInt(WITHDRAW_DECIMALS)) / 10n ** BigInt(USD_DECIMALS), free: (free * 10n ** BigInt(WITHDRAW_DECIMALS)) / 10n ** BigInt(USD_DECIMALS) }
    },
    feeOf: () => HYPERLIQUID_WITHDRAW_FEE,
    typedData: async (_ctx, account, amount, time) => ({
      domain: { name: HYPERLIQUID_USER_DOMAIN, version: '1', chainId: HYPERLIQUID_CHAIN_ID, verifyingContract: zeroAddress },
      types: {
        [HYPERLIQUID_WITHDRAW]: [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'destination', type: 'string' },
          { name: 'amount', type: 'string' },
          { name: 'time', type: 'uint64' }
        ]
      },
      primaryType: HYPERLIQUID_WITHDRAW,
      message: {
        hyperliquidChain: 'Mainnet',
        destination: account.toLowerCase(),
        amount: formatUnits(amount, WITHDRAW_DECIMALS),
        time: BigInt(time)
      }
    }),
    landing: hyperliquidWithdrawLanding
  },
  async submit(typedData, signature) {
    if (typedData.domain?.name !== HYPERLIQUID_USER_DOMAIN || typedData.primaryType !== HYPERLIQUID_WITHDRAW || typedData.domain.chainId === undefined) {
      throw new Error(`only a Hyperliquid ${HYPERLIQUID_WITHDRAW} is submitted to the venue, not ${typedData.domain?.name} ${typedData.primaryType}`)
    }
    const { hyperliquidChain, destination, amount, time } = typedData.message
    const { r, s, yParity } = parseSignature(signature)
    const res = await fetch(HYPERLIQUID_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: { type: 'withdraw3', hyperliquidChain, signatureChainId: toHex(BigInt(typedData.domain.chainId)), destination, amount, time: Number(time) },
        nonce: Number(time),
        signature: { r, s, v: yParity + 27 }
      })
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Hyperliquid answered ${res.status} to the withdrawal: ${text}`)
    const reply = JSON.parse(text) as { status: string; response: unknown }
    if (reply.status !== 'ok') throw new Error(`Hyperliquid refused the withdrawal: ${typeof reply.response === 'string' ? reply.response : text}`)
  },
  dapp: { hosts: ['hyperliquid.xyz'], chains: [HYPERLIQUID_CHAIN_ID] },
  claims(ctx: IScreenContext, call) {
    if (ctx.chainId !== HYPERLIQUID_CHAIN_ID) return false
    const burn = cctpBurn(call)
    if (burn !== null) return burn.forward !== null && isAddressEqual(burn.forward.recipient, ctx.account)
    return isRegisteredToken(ctx, call.target) && (bridgeDeposit(call) !== null || approvesCctp(call))
  },
  screen(_ctx, call) {
    const reasons: IGuardReason[] = []
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${call.target} forwards native value ${call.value}` })
    }
    const burn = cctpBurn(call)
    if (burn !== null) return [...reasons, ...screenHyperCoreForward(burn, HYPERLIQUID_DEPOSIT_TOKEN, CCTP_HYPERCORE_DEXES)]
    if (approvesCctp(call)) {
      if (!isAddressEqual(call.target, HYPERLIQUID_DEPOSIT_TOKEN)) {
        reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `Circle CCTP deposits to HyperCore take ${HYPERLIQUID_DEPOSIT_TOKEN} only, not ${call.target}` })
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
  outflows(account, call) {
    const burn = cctpBurn(call)
    if (burn !== null) return burn.forward !== null && isAddressEqual(burn.forward.recipient, account) ? [{ token: getAddress(burn.burnToken), amount: burn.amount }] : []
    const deposit = bridgeDeposit(call)
    return deposit === null ? [] : [{ token: getAddress(call.target), amount: deposit.amount }]
  },
  exchange: () => ({ spent: [], received: [] }),
  describe(chainId, account, callList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== HYPERLIQUID_CHAIN_ID) return out
    callList.forEach((call, i) => {
      const burn = cctpBurn(call)
      if (burn !== null) {
        if (account === null || burn.forward === null || !isAddressEqual(burn.forward.recipient, account)) return
        const token = getAddress(burn.burnToken)
        out.set(i, [
          {
            kind: 'venue',
            venueId: PLATFORM,
            key: null,
            call: 'depositForBurnWithHook',
            label: 'Deposit',
            fields: [{ label: 'credits', value: `your Hyperliquid ${burn.forward.dex === HYPERCORE_PERPS_DEX ? 'perps' : 'spot'} balance` }],
            flows: [{ token, delta: -burn.amount, exact: true }],
            fees: burn.maxFee === 0n ? [] : [{ payee: 'route', token, amount: burn.maxFee, expected: null }]
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
          fields: [],
          flows: [{ token, delta: -deposit.amount, exact: true }],
          fees: []
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
      return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: 'transfers out of Hyperliquid go through its Withdraw to Arbitrum for now, so every outflow settles on the bridge' }]
    }
    if (HYPERLIQUID_ADMITTED_ACTIONS.has(typedData.primaryType)) return []
    return [
      {
        code: 'DAPP_ACTION_NOT_ADMITTED',
        detail: `${typedData.primaryType} (${Object.keys(typedData.message).join(', ')}) is not an admitted Hyperliquid action; anything unlisted may move value or control out of the gated account`
      }
    ]
  },
  async attestTypedData(_clients, account, typedData) {
    if (typedData.domain?.name !== HYPERLIQUID_USER_DOMAIN || typedData.primaryType !== HYPERLIQUID_WITHDRAW) return []
    const { free } = await readHyperliquidBalance(account)
    if (parseUnits(String(typedData.message.amount), USD_DECIMALS) <= free) return []
    const available = formatUnits(free, USD_DECIMALS)
    return [
      {
        code: 'DAPP_EXIT_ABOVE_AVAILABLE',
        detail: `Hyperliquid can release ${available} USDC now, not ${String(typedData.message.amount)}; the rest backs open orders or positions. Withdraw ${available} USDC or less, or cancel open orders first.`
      }
    ]
  },
  presign(_account, typedData) {
    return typedData.domain?.name === HYPERLIQUID_USER_DOMAIN && typedData.primaryType === HYPERLIQUID_APPROVE_AGENT
      ? [{ kind: 'hyperliquidAction', action: HYPERLIQUID_REFERRAL_ACTION, nonce: Date.now() }]
      : []
  },
  message() {
    return null
  }
}
