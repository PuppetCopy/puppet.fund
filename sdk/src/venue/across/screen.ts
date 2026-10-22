import { CHAIN_IDS } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, getAddress, type Hex, isAddressEqual, slice } from 'viem'
import { type ChainId, chainNameOf } from '../../const/index.js'
import { DEFAULT_EVALUATION_CONFIG } from '../../evaluate/types.js'
import { ACROSS_DEPOSIT_ABI, acrossSpokePoolOf } from '../../intent/route/acrossDeposit.js'
import { symbolOf, tokenMetaByChainToken, tokenMetaKey } from '../../state/tokenRegistry.js'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IGuardReason, IOperateStep, IVenue } from '../types.js'

export const ACROSS_VENUE_ID = 'across'

const ACROSS_VENUE_CHAINS: readonly ChainId[] = [137 as ChainId, 4663 as ChainId, 42161 as ChainId]

const addressOf = (word: Hex): Address => getAddress(slice(word, 12))

const depositOf = (chainId: ChainId, call: IIAccount__Call) => {
  if (!ACROSS_VENUE_CHAINS.includes(chainId) || !isAddressEqual(call.target, acrossSpokePoolOf(chainId))) return null
  try {
    const { args } = decodeFunctionData({ abi: ACROSS_DEPOSIT_ABI, data: call.callData })
    const [depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, exclusiveRelayer, , , , message] = args
    return {
      depositor: addressOf(depositor),
      recipient: addressOf(recipient),
      inputToken: addressOf(inputToken),
      outputToken: addressOf(outputToken),
      inputAmount,
      outputAmount,
      destinationChainId,
      exclusiveRelayer: addressOf(exclusiveRelayer),
      message
    }
  } catch {
    return null
  }
}

const spokePoolApproval = (chainId: ChainId, call: IIAccount__Call): boolean => {
  const dec = decodeErc20(call.callData)
  return dec?.functionName === 'approve' && isAddressEqual((dec.args as readonly [Address, bigint])[0], acrossSpokePoolOf(chainId))
}

export const acrossVenue: IVenue = {
  venueId: ACROSS_VENUE_ID,
  name: 'Across',
  chains: ACROSS_VENUE_CHAINS,
  contracts: ACROSS_VENUE_CHAINS.map(chainId => ({
    chainId,
    address: acrossSpokePoolOf(chainId),
    name: 'Across SpokePool',
    detail: "Across's bridge: moves a fund's token to the same fund on another chain",
    pullsTokens: true
  })),
  claims(ctx, call) {
    if (!ACROSS_VENUE_CHAINS.includes(ctx.chainId)) return false
    return isAddressEqual(call.target, acrossSpokePoolOf(ctx.chainId)) || (isRegisteredToken(ctx, call.target) && spokePoolApproval(ctx.chainId, call))
  },
  screen(ctx, call) {
    if (!isAddressEqual(call.target, acrossSpokePoolOf(ctx.chainId))) {
      return call.value === 0n ? [] : [{ code: 'NATIVE_VALUE_FORBIDDEN', detail: `approve call to ${call.target} forwards native value ${call.value}` }]
    }
    const deposit = depositOf(ctx.chainId, call)
    if (deposit === null) return [{ code: 'UNDECODABLE_ROUTER_CALL', detail: 'the SpokePool call is not the Across deposit Puppet screens' }]
    const reasons: IGuardReason[] = []
    const destination = Number(deposit.destinationChainId)
    if (call.value !== 0n) reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `the deposit forwards native value ${call.value}; a fund bridges a registered token` })
    if (!isAddressEqual(deposit.depositor, ctx.account)) reasons.push({ code: 'RECIPIENT_NOT_ACCOUNT', detail: `the deposit refunds ${deposit.depositor}, not the fund ${ctx.account}` })
    if (!isAddressEqual(deposit.recipient, ctx.account)) reasons.push({ code: 'RECIPIENT_NOT_ACCOUNT', detail: `the deposit delivers to ${deposit.recipient}, not the fund ${ctx.account} on the destination chain` })
    if (isAddressEqual(deposit.exclusiveRelayer, ctx.account)) {
      reasons.push({ code: 'RELAYER_IS_PARTY', detail: 'the deposit names the fund itself as its exclusive relayer, the counterparty to its own bridge' })
    }
    if (deposit.message !== '0x') reasons.push({ code: 'DATALIST_FORBIDDEN', detail: 'the deposit carries a destination program; a fund bridges plain tokens to itself' })
    if (destination === ctx.chainId || !(CHAIN_IDS as readonly number[]).includes(destination)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_DESTINATION', detail: `the deposit bridges to chain ${destination}, which is not another chain Puppet runs on` })
      return reasons
    }
    if (!isRegisteredToken(ctx, deposit.inputToken)) reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `the deposit bridges ${deposit.inputToken}, which is not registered on chain ${ctx.chainId}` })
    else if (
      !tokenMetaByChainToken.has(tokenMetaKey(destination as ChainId, deposit.outputToken)) ||
      symbolOf(ctx.chainId, deposit.inputToken) !== symbolOf(destination as ChainId, deposit.outputToken)
    ) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `the deposit bridges ${deposit.inputToken} but delivers ${deposit.outputToken}; a fund bridges a registered token like-for-like` })
    }
    if (deposit.outputAmount === 0n) reasons.push({ code: 'MIN_OUT_ZERO', detail: 'the deposit delivers nothing' })
    else if (deposit.outputAmount * 10_000n < deposit.inputAmount * (10_000n - DEFAULT_EVALUATION_CONFIG.bridgeMaxSlippageBps)) {
      reasons.push({
        code: 'VENUE_DEPOSIT_FEE',
        detail: `the deposit delivers ${deposit.outputAmount} of ${deposit.inputAmount}, past the ${DEFAULT_EVALUATION_CONFIG.bridgeMaxSlippageBps} bps a bridge may keep`
      })
    }
    return reasons
  },
  outflows(_account, call) {
    for (const chainId of ACROSS_VENUE_CHAINS) {
      const deposit = depositOf(chainId, call)
      if (deposit !== null) return [{ token: deposit.inputToken, amount: deposit.inputAmount }]
    }
    return []
  },
  transit(chainId, _account, call) {
    const deposit = depositOf(chainId, call)
    if (deposit === null) return null
    return {
      destinationChainId: deposit.destinationChainId,
      inputToken: deposit.inputToken,
      inputAmount: deposit.inputAmount,
      outputToken: deposit.outputToken,
      outputAmount: deposit.outputAmount
    }
  },
  exchange: () => ({ spent: [], received: [] }),
  describe(chainId, _account, callList) {
    const out = new Map<number, IOperateStep[]>()
    callList.forEach((call, i) => {
      const deposit = depositOf(chainId, call)
      if (deposit === null) return
      const destination = Number(deposit.destinationChainId)
      out.set(i, [
        {
          kind: 'venue',
          venueId: ACROSS_VENUE_ID,
          key: null,
          call: 'deposit',
          label: `Bridge to ${chainNameOf(destination) ?? `chain ${destination}`}`,
          fields: [],
          flows: [{ token: deposit.inputToken, delta: -deposit.inputAmount, exact: true }],
          fees: deposit.inputAmount > deposit.outputAmount ? [{ payee: 'venue', token: deposit.inputToken, amount: deposit.inputAmount - deposit.outputAmount, expected: null }] : []
        }
      ])
    })
    return out
  },
  async attestOperate(_clients, chainId, _account, callList) {
    const deposits = callList.filter(call => depositOf(chainId, call) !== null).length
    return deposits > 1 ? [{ code: 'BRIDGE_MORE_THAN_ONCE', detail: `this operate bridges ${deposits} times; an operate bridges at most once, so its arrival can be followed` }] : []
  },
  message: () => null
}
