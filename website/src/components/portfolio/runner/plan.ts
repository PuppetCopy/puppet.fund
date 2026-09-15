import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, deploymentAddress, resolveDispatchChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { bondTokenOf, providerToken } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { chainFor } from '../../../common/$contract.js'
import type { IDepositFunding, IDraft, StepKind } from '../draft.js'

export interface IStepShape {
  kind: StepKind
  wallet?: boolean
  origin?: { chainId: ChainId; symbol: string }
  destination: { chainId: ChainId; address: Address | null } | null
  label?: string
  description?: string
}

export function planShape(draft: IDraft, account: Address | null, route: Address | null, deployed: ReadonlySet<ChainId>): IStepShape[] {
  if (draft.kind === 'mandate') {
    return [
      {
        kind: 'mandate',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label:
          draft.mandate === null
            ? `Bond ${readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)), draft.bond)}`
            : draft.mandate.expiry === 0n
              ? 'Revoke mandate'
              : 'Broadcast mandate',
        ...(draft.mandate === null
          ? { description: 'Moves this amount from your balance into the bond pool on the hub. The relay fee is paid from what stays in your balance.' }
          : {})
      }
    ]
  }
  if (draft.kind === 'unbond') {
    return [
      {
        kind: 'unbond',
        destination: { chainId: HUB_CHAIN_ID, address: account },
        label: 'Release bond',
        description: 'Returns bond that is not backing an open cycle to your account on the hub.'
      }
    ]
  }
  if (draft.kind === 'credit') {
    return [
      {
        kind: 'credit',
        label: `Sweep ${draft.creditList.map(t => getTokenDescription(draft.chainId, t).symbol).join(' · ')}`,
        destination: { chainId: draft.chainId, address: account }
      }
    ]
  }
  if (draft.kind === 'operate') return [{ kind: 'operate', destination: null }]
  if (draft.kind === 'settle') {
    return [
      {
        kind: 'settle',
        destination: null,
        label: `Close cycle on ${chainFor(draft.spokeChainId).name}`,
        description:
          'Values the book at flat on the trading chain and pays every backer that gained out of what the account holds there, taking your fee. Backers that lost are drawn from their hub tokens in a second dispatch on the hub, right after.'
      }
    ]
  }
  if (draft.kind === 'withdraw') {
    return [{ kind: 'withdraw', destination: { chainId: draft.output.chainId, address: draft.output.receiver } }]
  }
  return depositShapes(account, route, draft, deployed)
}

function depositShapes(account: Address | null, route: Address | null, funding: IDepositFunding, deployed: ReadonlySet<ChainId>): IStepShape[] {
  const input = funding.deposit
  const delivered = providerToken(input.inputToken, input.chainId)
  const crossChain = BigInt(input.chainId) !== input.destinationChainId
  const plain = !crossChain && input.route === null
  const destChainId = resolveDispatchChainId(Number(input.destinationChainId))
  const out = readableTokenAmountLabel(getTokenDescription(destChainId, input.outputToken), funding.expectedOutput)
  const shapes: IStepShape[] = []
  if (plain && deployed.has(input.chainId)) {
    if (input.inputAmount > funding.nativeValue) {
      shapes.push({
        kind: 'approve',
        wallet: true,
        label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
        description:
          'Lets the Deposit module pull this token from your wallet into your account. Nothing moves on this step; it only sets the allowance.',
        destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
      })
    }
    shapes.push({
      kind: 'deposit',
      wallet: true,
      label: `Deposit ${out}`,
      description: 'Moves the amount from your wallet straight into your account in one transaction of your own. No relay and no relay fee.',
      destination: { chainId: input.chainId, address: account }
    })
    return shapes
  }
  if (input.inputAmount > funding.nativeValue) {
    shapes.push({
      kind: 'approve',
      wallet: true,
      label: `Approve ${getTokenDescription(input.chainId, delivered).symbol}`,
      description:
        'Lets the Deposit module pull this token from your wallet onto your deposit route. Nothing moves on this step; it only sets the allowance, and it is skipped when one already covers the amount.',
      destination: { chainId: input.chainId, address: deploymentAddress('Deposit', input.chainId) }
    })
  }
  shapes.push({
    kind: 'fund',
    wallet: true,
    label: `Fund ${readableTokenAmountLabel(getTokenDescription(input.chainId, delivered), input.inputAmount)}`,
    description: plain
      ? 'Your account is not on this chain yet, so the amount is sent to your deposit route first and swept into the account as it is created. The route address is fixed by your wallet, so it is known before the account exists.'
      : 'Swaps and bridges are spent from your deposit route, so the amount is sent there first. The route address is fixed by your wallet and is the same on every chain.',
    destination: { chainId: input.chainId, address: route }
  })
  if (account === null) {
    shapes.push({
      kind: 'key',
      wallet: true,
      label: 'Sign account key',
      description:
        'Derives your account key from your wallet and stores it in this browser. The signature never leaves this device, and the same wallet always derives the same account, so any device reproduces it.',
      destination: null
    })
    shapes.push({
      kind: 'session',
      wallet: true,
      label: 'Create session',
      description:
        'Authorises a signer to act for this wallet, for 7 days. One chainless signature: it proves to the key service that this funded wallet is asking, and binds the account to you on chain. Signed once and reused on every chain.',
      destination: null
    })
  }
  if (plain) {
    if (funding.arrival === 'credit') {
      shapes.push({
        kind: 'credit',
        label: `Credit ${getTokenDescription(destChainId, input.outputToken).symbol}`,
        description:
          'Your funds are already on your deposit route, so nothing more is pulled from your wallet. This sweeps the route into your account in one relayed call.',
        destination: { chainId: destChainId, address: account }
      })
    } else {
      shapes.push({
        kind: 'mandate',
        label: `Bond ~${readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID, input.outputToken), input.outputAmount)}`,
        description:
          'Moves what arrives into the bond pool on the hub in one broadcast, sweeping your deposit route on the way, so no separate credit is needed. The relay fee comes out of the arrival, so the bonded amount is what lands less that fee.',
        destination: { chainId: HUB_CHAIN_ID, address: account }
      })
    }
    return shapes
  }
  shapes.push({
    kind: 'swap',
    label: crossChain ? `Crosschain ~${out}` : `Swap ~${out}`,
    description: crossChain
      ? 'Bridges the amount from your deposit route to your account on the destination chain. The relay fee comes out of the swapped amount.'
      : 'Converts the amount on your deposit route into another registered token on the same chain. The relay fee comes out of the swapped amount.',
    origin: { chainId: input.chainId, symbol: getTokenDescription(input.chainId, input.inputToken).symbol },
    destination: { chainId: destChainId, address: account }
  })
  if (funding.arrival === 'credit') {
    shapes.push({
      kind: 'credit',
      label: `Credit ${getTokenDescription(destChainId, input.outputToken).symbol}`,
      description:
        'The swap output lands on your deposit route, which is not part of your audited balance yet. The relay sweeps it into your account under the same signature you gave the swap, so nothing more is asked of you.',
      destination: { chainId: destChainId, address: account }
    })
  }
  if (funding.arrival === 'bond') {
    shapes.push({
      kind: 'mandate',
      label: `Bond ~${readableTokenAmountLabel(getTokenDescription(HUB_CHAIN_ID, input.outputToken), input.outputAmount)}`,
      description:
        'Moves what arrived into the bond pool on the hub in one broadcast. The relay fee comes out of the arrival, so the bonded amount is what landed less that fee.',
      destination: { chainId: HUB_CHAIN_ID, address: account }
    })
  }
  return shapes
}
