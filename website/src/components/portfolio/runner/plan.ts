import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import { predictUserAccount } from '@puppet/sdk/account'
import { type IDepositDraft, type IDraft, type StepKind, venueIntentOf, venueWithdrawOf } from '@puppet/sdk/client'
import { type ChainId, deploymentAddress, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { providerToken, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { describeOperate, NO_VENUE_FACTS } from '@puppet/sdk/venue'
import { filter, type IStream, just, map, op, start } from 'aelea/stream'
import { PromiseStatus, type PromiseStateDone } from 'aelea/stream-extended'
import { intermediateState } from '@/ui-components'
import { type Address, isAddressEqual } from 'viem'
import { chainName } from '../../../common/$chain.js'
import { ethUsd } from '../../../common/$common.js'
import { formatUsd, priceFor } from '../../../io/price.js'
import { operationSummary } from '../../../common/operation.js'
import type { IConnectedWallet, IFund, IRootState, IWalletKeys } from '../../../wallet/index.js'

export interface IStepShape {
  kind: StepKind
  wallet?: boolean
  scheduled?: boolean
  origin?: { chainId: ChainId; symbol: string }
  destination: { chainId: ChainId; address: Address | null } | null
  label: string | IStream<string>
  sections?: readonly { label: string; chainId: ChainId | null }[]
  description: string
}

const SESSION_SHAPE: IStepShape = {
  kind: 'session',
  wallet: true,
  label: 'Sign session',
  description:
    'Lets this browser act for your account for 7 days, across reloads. Mandates it signs end with it.',
  destination: null
}

const KEY_SHAPE: IStepShape = {
  kind: 'key',
  wallet: true,
  label: 'Derive your fund key',
  description:
    'Creates your fund key in two halves, so neither this browser nor Puppet can act alone.',
  destination: null
}

const RESTORE_SHAPE: IStepShape = {
  kind: 'key',
  wallet: true,
  label: 'Restore your fund key',
  description: "Rebuilds this browser's half of your fund key from your wallet's signature. Nothing moves.",
  destination: null
}

const FUND_GRANT_SHAPE: IStepShape = {
  kind: 'genesis',
  wallet: true,
  label: 'Approve your fund',
  description: "Approves your new fund as yours for good, and is this browser's 7-day session. Comes once its key exists.",
  destination: null
}

type IKeyed = 'granted' | null

function planShape(draft: IDraft, account: Address | null, fund: Address | null, sessions: IPlanSessions, keyed: IKeyed, routed: boolean): IStepShape[] {
  const keys = sessions.granted ? [] : [SESSION_SHAPE]
  if (draft.kind === 'session') return keys
  if (draft.kind === 'mandate') {
    return [
      ...keys,
      {
        kind: 'mandate',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: draft.mandate.expiry === 0n ? 'End mandate' : 'Mandate',
        description:
          draft.mandate.expiry === 0n
            ? 'Signs the end of this mandate and posts it on the hub. If it cannot be relayed, Revoke sessions in Sessions ends every mandate, and every session, from your wallet without a fee.'
            : 'Signs your allocation rules and posts them on the hub. The latest one per fund wins.'
      }
    ]
  }
  if (draft.kind === 'operate') {
    const { actions } = operationSummary(draft.chainId, describeOperate(draft.chainId, fund, draft.callList, false, undefined, NO_VENUE_FACTS), new Map())
    const venueActions = actions.filter(a => a.venueId !== '')
    const shown = venueActions.length > 0 ? venueActions : actions
    return [
      ...keys,
      {
        kind: 'operate',
        destination: null,
        label: shown.map(a => `${a.venue} ${a.label}`).join(', '),
        ...(shown.length > 1 ? { sections: shown.map(a => ({ label: `${a.venue} ${a.label}`, chainId: null })) } : {}),
        description: [
          ...actions.map(a => `${a.venue} ${a.label}${a.fields.length === 0 ? '' : `: ${a.fields.map(f => `${f.label} ${f.value}`).join(', ')}`}`),
          "Spends only your fund's balance."
        ].join('. ')
      }
    ]
  }
  if (draft.kind === 'allocate') {
    const keygenHere = draft.identity !== null && keyed === null && sessions.fundKey !== 'stored'
    const spoke = draft.contribution > 0n && draft.escrowChainId !== HUB_CHAIN_ID
    return [
      ...keys,
      ...(keygenHere && sessions.fundKey === null ? [KEY_SHAPE] : []),
      ...((draft.identity !== null || sessions.selectedUnopened) && sessions.asksFundGrant && keyed !== 'granted' ? [FUND_GRANT_SHAPE] : []),
      ...(spoke && sessions.split.has(draft.escrowChainId)
        ? [
            {
              kind: 'credit' as const,
              wallet: true,
              label: 'Sign the credit',
              description: `Your wallet signs the amount your escrow on ${chainName(draft.escrowChainId)} adds to your fund, since a revoke there or on ${chainName(HUB_CHAIN_ID)} keeps your session from signing it. Nothing moves yet.`,
              destination: null
            }
          ]
        : []),
      ...(spoke
        ? [
            {
              kind: 'fulfil' as const,
              label: `Release on ${chainName(draft.escrowChainId)}`,
              description: `Moves your escrow into your fund on ${chainName(draft.escrowChainId)}. Its gas and your part of the round's relay fee come out of it.`,
              destination: { chainId: draft.escrowChainId, address: fund }
            }
          ]
        : []),
      {
        kind: 'allocate',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: draft.contribution === 0n ? 'Allocate' : `Allocate ${routed ? '~' : ''}${readableTokenAmountLabel(getTokenDescription(draft.escrowChainId, draft.escrowToken), draft.contribution)}`,
        description: spoke
          ? 'Credits the release to your fund. Puppets who mandate you join within their limits, at one checked price.'
          : 'Credits your escrow to your fund. Puppets who mandate you join within their limits, at one checked price.'
      }
    ]
  }
  if (draft.kind === 'sell') {
    return [
      ...keys,
      {
        kind: 'sell',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: op(
          intermediateState(ethUsd(draft.value)),
          filter((s): s is PromiseStateDone<string> => s.status === PromiseStatus.DONE),
          map(s => `Sell ${s.value}`),
          start('Sell')
        ),
        description: "Queues part of your share. The fund's next redemption pays the queue at one price."
      }
    ]
  }
  if (draft.kind === 'redeem') {
    const symbol = getTokenDescription(HUB_CHAIN_ID as ChainId, draft.token).symbol
    const leg = draft.leg
    const plan = draft.plan
    return [
      ...keys,
      ...(leg === null
        ? []
        : [
            {
              kind: 'fundSwap' as const,
              label: `${leg.chainId === HUB_CHAIN_ID ? 'Swap' : 'Crosschain'} ~${readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID as ChainId, draft.token), leg.expectedOutput)}`,
              description: `Moves the fund's ${getTokenDescription(leg.chainId, leg.inputToken).symbol} to ${symbol} on the hub to pay the holders, sized at Submit from the fund's live value. The relay fee comes out of the amount.`,
              origin: { chainId: leg.chainId, symbol: getTokenDescription(leg.chainId, leg.inputToken).symbol },
              destination: { chainId: HUB_CHAIN_ID as ChainId, address: null }
            }
          ]),
      {
        kind: 'redeem',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label:
          plan === null
            ? just('Redeem')
            : op(
                intermediateState(priceFor(HUB_CHAIN_ID as ChainId, draft.token)),
                filter((s): s is PromiseStateDone<bigint | null> => s.status === PromiseStatus.DONE),
                map(s => `Redeem ${formatUsd(plan.redemption.potLeft + plan.redemption.masterPay, s.value)}`),
                start('Redeem')
              ),
        description:
          draft.fraction > 0n
            ? `Pays the exit queue and the same fraction of every stake in ${symbol}, at one checked price. You are paid last.`
            : `Pays the exit queue in ${symbol} at one checked price${draft.join > 0n ? ', your own shares included' : ''}.`
      },
      ...(draft.holders > PROTOCOL.maxCohortSize
        ? [
            {
              kind: 'redeemCohort' as const,
              scheduled: true,
              label: 'Pay the remaining holders',
              description: 'Follows by itself: the remaining holders are paid in groups, largest first, you last. Already paid for.',
              destination: { chainId: HUB_CHAIN_ID, address: null }
            }
          ]
        : [])
    ]
  }
  if (draft.kind === 'fundSwap') {
    const crossChain = draft.chainId !== draft.destinationChainId
    const outToken = getTokenDescription(draft.destinationChainId, draft.outputToken)
    const out = readableTokenAmountLabel(outToken, draft.expectedOutput)
    const least = `At least ${readableTokenAmountLabel(outToken, draft.outputAmount)} arrives.`
    const wrapping = draft.route.kind === 'swap' && isAddressEqual(draft.route.provider, wrappedNativeAddressOf(draft.chainId))
    const unwrap = wrapping && isAddressEqual(draft.inputToken, wrappedNativeAddressOf(draft.chainId))
    const inSymbol = getTokenDescription(draft.chainId, draft.inputToken).symbol
    const outSymbol = getTokenDescription(draft.destinationChainId, draft.outputToken).symbol
    return [
      ...keys,
      {
        kind: 'fundSwap',
        label: crossChain ? `Crosschain ~${out}` : wrapping ? `${unwrap ? 'Unwrap' : 'Wrap'} ~${out}` : `Swap ~${out}`,
        description: crossChain
          ? `Bridges fund holdings to the destination chain, within your fund. The relay fee comes out of the amount. ${least}`
          : wrapping
            ? `${unwrap ? 'Unwraps' : 'Wraps'} the fund's ${inSymbol} into ${outSymbol} 1:1. The relay fee comes out of the amount.`
            : `Swaps fund holdings on this chain. The relay fee comes out of the amount. ${least}`,
        origin: { chainId: draft.chainId, symbol: getTokenDescription(draft.chainId, draft.inputToken).symbol },
        destination: { chainId: draft.destinationChainId, address: null }
      }
    ]
  }
  if (draft.kind === 'operateSwap') {
    if (draft.bridge === null) {
      return [
        ...keys,
        {
          kind: 'operate',
          label: `Swap ~${readableTokenAmountLabel(getTokenDescription(draft.chainId, draft.outputToken), draft.outputAmount)}`,
          description: 'Swaps fund holdings through Uniswap on this chain, at the price checked at Submit and within 0.5% of it. The relay fee comes out of what the swap returns.',
          destination: { chainId: draft.chainId, address: null }
        }
      ]
    }
    const destination = draft.bridge.destinationChainId
    const swapped = `Swap ~${readableTokenAmountLabel(getTokenDescription(draft.chainId, draft.outputToken), draft.outputAmount)}`
    const bridged = `Crosschain ~${readableTokenAmountLabel(getTokenDescription(destination, draft.bridge.outputToken), draft.bridge.outputAmount)}`
    return [
      ...keys,
      {
        kind: 'operate',
        label: `${swapped}, ${bridged}`,
        sections: [
          { label: swapped, chainId: draft.chainId },
          { label: bridged, chainId: destination }
        ],
        description: `Swaps through Uniswap and hands the proceeds to Across, in one transaction on ${chainName(draft.chainId)}; done once Across delivers to your fund on ${chainName(destination)}, usually within a minute. The relay fee comes out of what the swap returns; the amount is checked again at Submit.`,
        destination: { chainId: destination, address: null }
      }
    ]
  }
  if (draft.kind === 'escrowReturn') {
    return [
      ...keys,
      {
        kind: 'escrowReturn',
        wallet: true,
        label: draft.phase === 'request' ? 'Request escrow return' : 'Claim escrow return',
        description:
          draft.phase === 'request'
            ? 'Your wallet sends it and pays the gas. A day later you can claim the escrow no round has used back to your wallet.'
            : 'Your wallet sends it and pays the gas. All escrow no round has used comes back to your wallet.',
        destination: { chainId: draft.chainId, address: null }
      }
    ]
  }
  if (draft.kind === 'venueWithdraw') {
    const venue = venueWithdrawOf(draft.venueId)
    const token = getTokenDescription(venue.withdraw.chainId, venue.withdraw.token)
    return [
      ...keys,
      {
        kind: 'venueWithdraw',
        label: `${venue.name} Withdraw ${readableTokenAmountLabel(token, draft.amount)}`,
        description: `Withdraws from your fund's ${venue.name} account back to your fund. ${venue.withdraw.feeOf(draft.amount) === 0n ? `All ${readableTokenAmountLabel(token, draft.amount)} arrives once ${venue.name} processes it.` : `At least ${readableTokenAmountLabel(token, draft.amount - venue.withdraw.feeOf(draft.amount))} arrives, usually within minutes.`} Done once the payout reaches your fund.`,
        destination: { chainId: venue.withdraw.chainId, address: null }
      }
    ]
  }
  if (draft.kind === 'venueIntent') {
    const { venue, intents, intent } = venueIntentOf(draft.venueId, draft.intent)
    return [
      ...keys,
      {
        kind: 'venueIntent',
        label: `${venue.name} ${intent.summary(draft.params)}`,
        description: `Your fund signs it and ${venue.name} carries it out.${intents.prerequisite === undefined ? '' : ` Any setup ${venue.name} needs runs first.`} Done once ${venue.name} confirms it on chain.`,
        destination: null
      }
    ]
  }
  if (draft.kind === 'revoke') {
    return [
      {
        kind: 'revoke',
        wallet: true,
        label: `Revoke sessions on ${chainName(draft.chainId)}`,
        description: `Your wallet sends it and pays the gas. Ends ${draft.chainId === HUB_CHAIN_ID ? 'every mandate now and ' : ''}every session here within ${Number(SESSION_REVOKE_DELAY) / 60} minutes, then your wallet can withdraw each token here for ${Number(SESSION_REVOKE_DELAY) / 60} minutes.`,
        destination: { chainId: draft.chainId, address: null }
      }
    ]
  }
  if (draft.kind === 'withdraw') {
    return [
      ...keys,
      {
        kind: 'withdraw',
        destination: { chainId: draft.output.chainId, address: draft.output.receiver },
        label: 'Withdraw',
        description: 'Moves funds from your account to your wallet.'
      }
    ]
  }
  if (draft.kind === 'walletWithdraw') {
    return [
      {
        kind: 'walletWithdraw',
        wallet: true,
        label: `Withdraw ${readableTokenAmountLabel(getTokenDescription(draft.chainId, draft.token), draft.amount)}`,
        description: 'Your wallet sends it in the withdraw window and pays the gas. It pays your wallet straight from your account.',
        destination: { chainId: draft.chainId, address: null }
      }
    ]
  }
  if (!draft.toEscrow) return depositShapes(account, keys, draft, sessions)
  if (BigInt(draft.deposit.chainId) === draft.deposit.destinationChainId) return escrowDepositShapes(keys, draft, sessions)
  const escrowChainId = resolveDispatchChainId(Number(draft.deposit.destinationChainId))
  return [
    ...depositShapes(account, keys, draft, sessions),
    {
      kind: 'retireEscrow',
      label: `Escrow ~${readableTokenAmountLabel(getTokenDescription(escrowChainId, draft.deposit.outputToken), draft.expectedOutput)}`,
      description:
        "Follows by itself once the bridge fills: your account there moves it into escrow for your fund's rounds. Its relay fee comes out of the amount. If the fill misses its deadline, Across refunds your account on the origin chain and nothing is escrowed.",
      destination: { chainId: escrowChainId, address: deploymentAddress('EscrowStore', escrowChainId) }
    }
  ]
}

function escrowDepositShapes(keys: readonly IStepShape[], draft: IDepositDraft, sessions: IPlanSessions): IStepShape[] {
  const input = draft.deposit
  const destChainId = resolveDispatchChainId(Number(input.destinationChainId))
  const delivered = input.inputToken
  const keying = draft.identity !== undefined
  const shapes: IStepShape[] = keying ? [...keys] : []
  if (!isAddressEqual(delivered, PROTOCOL.nativeToken)) {
    shapes.push({
      kind: 'approve',
      wallet: true,
      label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
      description:
        'Lets Puppet pull this token from your wallet into escrow. Nothing moves yet.',
      destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
    })
  }
  shapes.push({
    kind: 'fund',
    wallet: true,
    label: `Escrow ${readableTokenAmountLabel(getTokenDescription(input.chainId, delivered), input.inputAmount)}`,
    description:
      "Your wallet pays into escrow on this chain, with no fee. It only joins your fund's rounds or comes back to you.",
    destination: { chainId: destChainId, address: deploymentAddress('EscrowStore', destChainId) }
  })
  if (keying && sessions.fundKey === null) shapes.push(KEY_SHAPE)
  if (keying && sessions.asksFundGrant) shapes.push(FUND_GRANT_SHAPE)
  return shapes
}

function depositShapes(account: Address | null, keys: readonly IStepShape[], draft: IDepositDraft, sessions: IPlanSessions): IStepShape[] {
  const input = draft.deposit
  const delivered = providerToken(input.inputToken, input.chainId)
  const crossChain = BigInt(input.chainId) !== input.destinationChainId
  const plain = !crossChain && input.route === null
  const destChainId = resolveDispatchChainId(Number(input.destinationChainId))
  const out = readableTokenAmountLabel(getTokenDescription(destChainId, input.outputToken), draft.toEscrow ? input.outputAmount : draft.expectedOutput)
  const keying = draft.identity !== undefined
  const shapes: IStepShape[] = !plain || keying ? [...keys] : []
  if (draft.source === 'wallet' && input.inputAmount > draft.nativeValue) {
    shapes.push({
      kind: 'approve',
      wallet: true,
      label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
      description:
        'Lets Puppet pull this token from your wallet into your account. Nothing moves yet.',
      destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
    })
  }
  if (draft.source === 'wallet') {
    shapes.push({
      kind: 'fund',
      wallet: true,
      label: `Deposit ${readableTokenAmountLabel(getTokenDescription(input.chainId, delivered), input.inputAmount)}`,
      description: plain
        ? 'Sends the amount into your account, where it stays yours.'
        : 'Sends the amount into your account first. The swap spends it from there.',
      destination: { chainId: input.chainId, address: account }
    })
  }
  if (keying && sessions.fundKey === null) shapes.push(KEY_SHAPE)
  if (keying && sessions.asksFundGrant) shapes.push(FUND_GRANT_SHAPE)
  if (plain) return shapes
  shapes.push({
    kind: 'swap',
    label: crossChain ? `Crosschain ~${out}` : `Swap ~${out}`,
    description: crossChain
      ? 'Bridges the amount to your account on the destination chain. The relay fee comes out of the amount.'
      : 'Swaps the amount in your account on this chain. The relay fee comes out of the amount.',
    origin: { chainId: input.chainId, symbol: getTokenDescription(input.chainId, input.inputToken).symbol },
    destination: { chainId: destChainId, address: account }
  })
  return shapes
}

interface IPlanSessions {
  granted: boolean
  fundKey: 'stored' | 'signed' | null
  asksFundGrant: boolean
  selectedUnopened: boolean
  split: ReadonlySet<ChainId>
}

const restoreFundOf = (root: IRootState | null, wallet: IConnectedWallet, keys: IWalletKeys | null): IFund | null =>
  root === null || root.fund === null || 'unknown' in root.fund || keys === null || keys.fundSignerOf(wallet.address, root.fund.account) !== null ? null : root.fund

const FUND_KINDS: ReadonlySet<IDraft['kind']> = new Set<IDraft['kind']>(['session', 'operate', 'allocate', 'sell', 'redeem', 'fundSwap', 'venueWithdraw', 'venueIntent'])

export const restoredFundOf = (root: IRootState | null, wallet: IConnectedWallet, keys: IWalletKeys | null, drafts: readonly IDraft[]): IFund | null =>
  drafts.some(draft => FUND_KINDS.has(draft.kind)) ? restoreFundOf(root, wallet, keys) : null

export function planShapes(keys: IWalletKeys | null, wallet: IConnectedWallet | null, root: IRootState | null, drafts: readonly IDraft[], split: ReadonlySet<ChainId>): IStepShape[][] {
  const account = wallet === null ? null : predictUserAccount(wallet.address)
  const fund = root === null || root.fund === null || !('account' in root.fund) ? null : root.fund.account
  const opening = root === null || 'unknown' in root.funds ? null : root.funds.next
  const stored = wallet === null || keys === null || opening === null ? undefined : keys.fundsOf(wallet.address).find(record => record.fund === opening)
  const sessions: IPlanSessions = {
    granted: wallet !== null && keys !== null && keys.grantedChains(wallet.address).length > 0,
    fundKey: stored !== undefined ? 'stored' : wallet !== null && keys !== null && opening !== null && keys.fundKeySigned(wallet.address, opening) ? 'signed' : null,
    asksFundGrant: stored === undefined || keys === null || keys.fundApprovalOf(stored.user, stored.account) === null,
    selectedUnopened: stored !== undefined && fund !== null && isAddressEqual(stored.account, fund),
    split
  }
  let needed = false
  const keyedBy = drafts.find((draft): draft is IDepositDraft => draft.kind === 'deposit' && draft.identity !== undefined)
  const keyed: IKeyed = keyedBy === undefined ? null : 'granted'
  const routed = drafts.some(draft => draft.kind === 'deposit' && draft.deposit.route !== null)
  const grantIsSession = keyed !== null && sessions.asksFundGrant && !routed
  const plan = drafts.map(draft => {
    const shapes = planShape(draft, account, fund, sessions, keyed, routed)
    const opening = (draft.kind === 'deposit' && draft.identity !== undefined) || (draft.kind === 'allocate' && draft.identity !== null)
    needed = needed || (!(grantIsSession && opening) && shapes.some(shape => shape.kind === 'session'))
    return shapes.filter(shape => shape.kind !== 'session')
  })
  const first = plan[0]
  if (first === undefined) return plan
  const restore = wallet !== null && restoredFundOf(root, wallet, keys, drafts) !== null
  const committed = first.findIndex(shape => shape.kind === 'fund' && shape.wallet === true) + 1
  plan[0] = [...(needed ? [SESSION_SHAPE] : []), ...first.slice(0, committed), ...(restore && sessions.fundKey !== 'signed' ? [RESTORE_SHAPE] : []), ...first.slice(committed)]
  return plan
}
