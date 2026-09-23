import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { type ChainId, deploymentAddress, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { chainTokenOfKey, providerToken } from '@puppet/sdk/state'
import { type Address, isAddressEqual } from 'viem'
import type { IDepositDraft, IDraft, StepKind } from '../draft.js'

export interface IStepShape {
  kind: StepKind
  wallet?: boolean
  scheduled?: boolean
  origin?: { chainId: ChainId; symbol: string }
  destination: { chainId: ChainId; address: Address | null } | null
  label: string
  description: string
}

const SESSION_SHAPE: IStepShape = {
  kind: 'session',
  wallet: true,
  label: 'Sign Session',
  description:
    'Signs a session for this browser to act for your wallet, for 7 days. One signature; your wallet stays in control and can revoke it at any time.',
  destination: null
}

const KEY_SHAPE: IStepShape = {
  kind: 'key',
  wallet: true,
  label: 'Derive your fund key',
  description:
    'Runs a two-party key generation with the key service, splitting your fund key so neither half alone can act as your fund. It gives your fund the address your escrow is recorded under.',
  destination: null
}

const valueLabel = (value: bigint): string => readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)), value)

function planShape(draft: IDraft, account: Address | null, sessions: IPlanSessions, keyed: boolean, routed: boolean): IStepShape[] {
  const keys = sessions.granted ? [] : [SESSION_SHAPE]
  if (draft.kind === 'mandate') {
    return [
      ...keys,
      {
        kind: 'mandate',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: draft.mandate.expiry === 0n ? 'Revoke mandate' : 'Broadcast mandate',
        description: 'Signs the backing rules you set with your account key and broadcasts them once on the hub. The latest broadcast per master wins, and leaving is the same broadcast with an expiry of zero.'
      }
    ]
  }
  if (draft.kind === 'operate') {
    return [...keys, { kind: 'operate', destination: null, label: 'Operate', description: 'Runs a venue action through your fund. It spends the fund\'s own balance only; what sits in your account stays out of reach of the call.' }]
  }
  if (draft.kind === 'allocate') {
    const key = draft.identity === null || keyed ? [] : [KEY_SHAPE]
    return [
      ...keys,
      ...key,
      {
        kind: 'allocate',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: draft.contribution === 0n ? 'Fund a round' : `Fund a round with ${routed ? '~' : ''}${readableTokenAmountLabel(getTokenDescription(draft.escrowChainId, draft.escrowToken), draft.contribution)}`,
        description:
          'Credits what sits in your escrow into your fund and lets the puppets who mandate you join pro-rata. The attestor values the fund and composes the round when you submit.'
      },
      ...(draft.contribution === 0n || draft.escrowChainId === HUB_CHAIN_ID
        ? []
        : [
            {
              kind: 'fulfil' as const,
              scheduled: true,
              label: `Fulfil ${routed ? '~' : ''}${readableTokenAmountLabel(getTokenDescription(draft.escrowChainId, draft.escrowToken), draft.contribution)}`,
              description:
                'Follows by itself once the round lands, nothing to sign: the matchmaker releases your credited escrow on this chain into your fund, less your share of the round fee taken in the same token. It names the round it releases, so the two records can be matched on chain.',
              destination: { chainId: draft.escrowChainId, address: null }
            }
          ])
    ]
  }
  if (draft.kind === 'sell') {
    return [
      ...keys,
      {
        kind: 'sell',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: `Sell ${valueLabel(draft.value)} of ${readableAddress(draft.master)}`,
        description: 'Queues part of your share in this trader for redemption. It pays out on the hub as the trader drains the queue, less the performance fee on any gain.'
      }
    ]
  }
  if (draft.kind === 'redeem') {
    return [
      ...keys,
      {
        kind: 'redeem',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: `Redeem ${valueLabel(draft.value)}`,
        description: 'Values your fund through the attestor, queues the share you retire, and drains the queue on the hub: backers are paid pro-rata and your share returns to your account.'
      }
    ]
  }
  if (draft.kind === 'fundSwap') {
    const crossChain = draft.chainId !== draft.destinationChainId
    const out = readableTokenAmountLabel(getTokenDescription(draft.destinationChainId, draft.outputToken), draft.outputAmount)
    return [
      ...keys,
      {
        kind: 'fundSwap',
        label: crossChain ? `Crosschain ~${out}` : `Swap ~${out}`,
        description: crossChain
          ? 'Bridges funds your fund holds to the destination chain, where they land in the same fund. Redemptions are paid from what the fund holds on the hub. The relay fee comes out of the swapped amount.'
          : 'Swaps funds your fund holds into another registered token on the same chain. The relay fee comes out of the swapped amount.',
        origin: { chainId: draft.chainId, symbol: getTokenDescription(draft.chainId, draft.inputToken).symbol },
        destination: { chainId: draft.destinationChainId, address: null }
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
  return draft.toEscrow ? escrowDepositShapes(account, keys, draft) : depositShapes(account, keys, draft, draft.identity !== undefined)
}

function escrowDepositShapes(account: Address | null, keys: readonly IStepShape[], draft: IDepositDraft): IStepShape[] {
  const input = draft.deposit
  const destChainId = resolveDispatchChainId(Number(input.destinationChainId))
  const escrowed = readableTokenAmountLabel(getTokenDescription(destChainId, input.outputToken), draft.expectedOutput)
  if (input.route !== null) {
    return [
      ...depositShapes(account, keys, draft, draft.identity !== undefined),
      {
        kind: 'escrow',
        label: `Escrow ~${escrowed}`,
        description:
          'Moves what landed in your account into escrow for your fund, on the chain where it sits. Escrow has one way out: the round on the hub credits it into your fund.',
        destination: { chainId: destChainId, address: deploymentAddress('EscrowStore', destChainId) }
      }
    ]
  }
  const delivered = providerToken(input.inputToken, input.chainId)
  const shapes: IStepShape[] = [...keys]
  if (draft.identity !== undefined) shapes.push(KEY_SHAPE)
  if (!isAddressEqual(delivered, PROTOCOL.nativeToken)) {
    shapes.push({
      kind: 'approve',
      wallet: true,
      label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
      description:
        'Lets the Deposit module pull this token from your wallet into escrow. Nothing moves on this step; it only sets the allowance, and it is skipped when one already covers the amount.',
      destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
    })
  }
  shapes.push({
    kind: 'fund',
    wallet: true,
    label: `Escrow ${readableTokenAmountLabel(getTokenDescription(input.chainId, delivered), input.inputAmount)}`,
    description:
      'Your wallet pays straight into escrow for your fund, with no relayer and no fee. Escrow has one way out: the round on the hub credits it into your fund.',
    destination: { chainId: input.chainId, address: deploymentAddress('EscrowStore', input.chainId) }
  })
  return shapes
}

function depositShapes(account: Address | null, keys: readonly IStepShape[], draft: IDepositDraft, opensFund: boolean): IStepShape[] {
  const input = draft.deposit
  const delivered = providerToken(input.inputToken, input.chainId)
  const crossChain = BigInt(input.chainId) !== input.destinationChainId
  const plain = !crossChain && input.route === null
  const destChainId = resolveDispatchChainId(Number(input.destinationChainId))
  const out = readableTokenAmountLabel(getTokenDescription(destChainId, input.outputToken), draft.expectedOutput)
  const shapes: IStepShape[] = []
  if (draft.source === 'wallet' && input.inputAmount > draft.nativeValue) {
    shapes.push({
      kind: 'approve',
      wallet: true,
      label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
      description:
        'Lets the Deposit module pull this token from your wallet into your account. Nothing moves on this step; it only sets the allowance, and it is skipped when one already covers the amount.',
      destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
    })
  }
  if (draft.source === 'wallet') {
    shapes.push({
      kind: 'fund',
      wallet: true,
      label: `Deposit ${readableTokenAmountLabel(getTokenDescription(input.chainId, delivered), input.inputAmount)}`,
      description: plain
        ? 'Sends the amount into your account, where it stays yours. Your account address is fixed by your wallet, so it is known before it exists on chain.'
        : 'Swaps and bridges are spent from your account, so the amount is sent there first. Your account address is fixed by your wallet and is the same on every chain.',
      destination: { chainId: input.chainId, address: account }
    })
  }
  if (!plain) shapes.push(...keys)
  if (opensFund) shapes.push(KEY_SHAPE)
  if (plain) return shapes
  shapes.push({
    kind: 'swap',
    label: crossChain ? `Crosschain ~${out}` : `Swap ~${out}`,
    description: crossChain
      ? 'Bridges the amount to your account on the destination chain. The relay fee comes out of the swapped amount.'
      : 'Converts the amount in your account into another registered token on the same chain. The relay fee comes out of the swapped amount.',
    origin: { chainId: input.chainId, symbol: getTokenDescription(input.chainId, input.inputToken).symbol },
    destination: { chainId: destChainId, address: account }
  })
  return shapes
}

export interface IPlanSessions {
  granted: boolean
  restoreKey: boolean
}

const FUND_KINDS: ReadonlySet<IDraft['kind']> = new Set<IDraft['kind']>(['operate', 'allocate', 'sell', 'redeem', 'fundSwap'])

export function planShapes(drafts: readonly IDraft[], account: Address | null, sessions: IPlanSessions): IStepShape[][] {
  let needed = false
  const keyed = drafts.some(draft => draft.kind === 'deposit' && draft.identity !== undefined)
  const routed = drafts.some(draft => draft.kind === 'deposit' && draft.toEscrow && draft.deposit.route !== null)
  const plan = drafts.map(draft => {
    const shapes = planShape(draft, account, sessions, keyed, routed)
    needed = needed || shapes.some(shape => shape.kind === 'session')
    return shapes.filter(shape => shape.kind !== 'session')
  })
  const first = plan[0]
  if (first === undefined) return plan
  const restore = sessions.restoreKey && drafts.some(draft => FUND_KINDS.has(draft.kind))
  plan[0] = [...(needed ? [SESSION_SHAPE] : []), ...(restore ? [KEY_SHAPE] : []), ...first]
  return plan
}
