import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { predictDepositRoute, predictPuppetAccount } from '@puppet/sdk/account'
import { nativeSymbolOf, symbolByAddress, type ITokenRegistryMap } from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'
import type { IDraft, ISubscribeDraft, StepKind } from '../draft.js'

export type PlannedStep = { kind: 'bind' } | { kind: 'draft'; draft: IDraft }

export type PlanEntry = { kind: 'bind' } | { kind: 'exec'; draft: IDraft; lead: boolean; batch: IDraft[] }

export interface IStepShape {
  kind: StepKind
  nonce: bigint | null
  recipient: { address: Address; chainId: number } | null
  label?: string
}

const isMandate = (d: IDraft): d is ISubscribeDraft => d.kind === 'mandate'

// Whether a deposit needs its own recognize (credit) step, decided from the WHOLE cart (never stored on the draft). Fold
// it when a same-base ALLOCATE or MANDATE follows, because both sweep the deposit route into the puppet on-chain so the
// separate credit is redundant:
//   - ALLOCATE sweeps the route to seed the fund (and deploys the PA when absent).
//   - MANDATE auto-recognizes: HubGate._mandate reads _recognize = base.balanceOf(route), credits the signed balance,
//     and pays the relay fee from signedBalanceOf + recognize. So a deposit-then-subscribe needs no separate credit.
// This holds for a cross-chain/swap deposit too — when folded the runner still waits for the bridge fill (runDraft polls
// the hub route after the swap), so the funds are at the route by the time the allocate/mandate sweeps it.
export function shouldRecognize(draft: IDraft, list: IDraft[]): boolean {
  if (draft.kind !== 'deposit') return true
  const i = list.findIndex(d => d.id === draft.id)
  const base = draft.output.baseToken
  return !list.some(
    (x, j) => j > i && (x.kind === 'allocate' || x.kind === 'mandate') && x.baseToken === base
  )
}

export function planExecution(planned: PlannedStep[]): PlanEntry[] {
  const byBase = new Map<Hex, ISubscribeDraft[]>()
  for (const ps of planned) {
    if (ps.kind === 'draft' && isMandate(ps.draft)) {
      const tid = ps.draft.baseToken
      byBase.set(tid, [...(byBase.get(tid) ?? []), ps.draft])
    }
  }

  const ledBase = new Set<Hex>()
  return planned.map((ps): PlanEntry => {
    if (ps.kind === 'bind') return { kind: 'bind' }
    const draft = ps.draft
    if (isMandate(draft)) {
      const tid = draft.baseToken
      const lead = !ledBase.has(tid)
      if (lead) ledBase.add(tid)
      return { kind: 'exec', draft, lead, batch: lead ? (byBase.get(tid) ?? [draft]) : [] }
    }
    return { kind: 'exec', draft, lead: true, batch: [draft] }
  })
}

export function planShape(draft: IDraft, registry: ITokenRegistryMap, recognize: boolean): IStepShape[] {
  const symbolFor = (token: Hex): string =>
    symbolByAddress(token)

  if (draft.kind === 'allocate') {
    const depositTokenId = draft.swap ? draft.swap.inputToken : draft.baseToken
    const shapes: IStepShape[] = []
    if (draft.wallet) {
      const symbol =
        draft.wallet.mode === 'native' ? nativeSymbolOf(draft.wallet.chainId as ChainId) : symbolFor(depositTokenId)
      shapes.push({
        kind: 'walletTransfer',
        nonce: null,
        label: `Deposit ${symbol}`,
        recipient: { address: predictDepositRoute(predictPuppetAccount(draft.wallet.params)), chainId: draft.wallet.chainId }
      })
    }
    if (draft.swap) {
      const destSymbol = symbolFor(draft.baseToken)
      shapes.push({
        kind: 'swap',
        nonce: draft.swap.nonce,
        label:
          draft.swap.chainId !== draft.swap.destinationChainId ? `Crosschain ${destSymbol}` : `Swap ${destSymbol}`,
        recipient: { address: predictDepositRoute(predictPuppetAccount(draft.swap.params)), chainId: Number(draft.swap.chainId) }
      })
    }
    shapes.push({ kind: 'allocate' as StepKind, nonce: null, recipient: null })
    return shapes
  }

  if (draft.kind === 'deposit') {
    const base = draft.inputAmount.baseToken
    const destSymbol = symbolFor(base)
    const shapes: IStepShape[] = []
    if (draft.wallet) {
      shapes.push({
        kind: 'walletTransfer',
        nonce: null,
        recipient: {
          address: predictDepositRoute(predictPuppetAccount(draft.wallet.params)),
          chainId: Number(draft.wallet.chainId)
        },
        label:
          draft.wallet.mode === 'native'
            ? `Deposit ${nativeSymbolOf(Number(draft.wallet.chainId) as ChainId)}`
            : `Deposit ${symbolFor(base)}`
      })
    }
    if (draft.swap) {
      shapes.push({
        kind: 'swap',
        nonce: draft.swap.nonce,
        recipient: {
          address: predictDepositRoute(predictPuppetAccount(draft.swap.params)),
          chainId: Number(draft.swap.chainId)
        },
        label: draft.swap.chainId !== draft.swap.destinationChainId ? `Crosschain ${destSymbol}` : `Swap ${destSymbol}`
      })
    }
    if (recognize) {
      shapes.push({
        kind: 'recognize',
        nonce: null,
        recipient: { address: predictDepositRoute(predictPuppetAccount(draft.params)), chainId: HUB_CHAIN_ID }
      })
    }
    return shapes
  }

  if (draft.kind === 'fundSwap') {
    const destChainId = draft.destinationChainId ?? draft.chainId
    const isLocal = destChainId === draft.chainId
    const destSymbol = symbolFor(draft.tokenOut)
    const shapes: IStepShape[] = [
      {
        kind: 'swap',
        nonce: null,
        recipient: { address: predictDepositRoute(draft.account), chainId: draft.chainId },
        label: isLocal ? `Swap ${destSymbol}` : `Crosschain ${destSymbol}`
      }
    ]
    if (!isLocal) {
      shapes.push({
        kind: 'recognize',
        nonce: null,
        recipient: { address: predictDepositRoute(draft.account), chainId: destChainId }
      })
    }
    return shapes
  }

  if (draft.kind !== 'withdraw') {
    const kind: StepKind =
      draft.kind === 'redeem' && draft.liquidate ? 'liquidate' : draft.kind
    const label = draft.kind === 'mandate' && draft.allocationRate === 0n ? 'Stop funding' : undefined
    return [{ kind, nonce: null, recipient: null, label }]
  }

  return [
    {
      kind: 'withdraw',
      nonce: draft.input.nonce,
      recipient: {
        address: predictDepositRoute(predictPuppetAccount(draft.input.params)),
        chainId: Number(draft.input.chainId)
      }
    }
  ]
}
