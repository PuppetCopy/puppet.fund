import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute, predictPuppetAccount } from '@puppet/sdk/account'
import type { IDepositRoute, ISwapInput } from '@puppet/sdk/attestation'
import { ADDRESS_ZERO, type ChainId } from '@puppet/sdk/const'
import { type ITokenRegistryMap, nativeSymbolOf, symbolByAddress } from '@puppet/sdk/state'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { chainName } from '../../../common/$chain.js'
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

export function planShape(
  draft: IDraft,
  registry: ITokenRegistryMap,
  recognize: boolean,
  liveSigner: Address | null = null
): IStepShape[] {
  // The DISPLAYED route must mirror what the runner will EXECUTE against: it rebinds the draft's params to the live
  // session at submit, so the draft's baked signer (a pre-session zero-address placeholder, or a stale prior session)
  // must never be the one shown. Prefer the live signer; with none known yet the address is simply withheld — the
  // real route appears the moment the session is signed.
  const routeOf = (params: IAccountLib__AccountInitParams, chainId: number): IStepShape['recipient'] => {
    const signer =
      liveSigner ?? (isAddressEqual(getAddress(params.signer), ADDRESS_ZERO) ? null : getAddress(params.signer))
    if (signer === null) return null
    return { address: predictDepositRoute(predictPuppetAccount({ user: params.user, signer })), chainId }
  }
  const walletLeg = (wallet: IDepositRoute, erc20Symbol: string): IStepShape => ({
    kind: 'walletTransfer',
    nonce: null,
    label: `Deposit ${wallet.mode === 'native' ? nativeSymbolOf(wallet.chainId as ChainId) : erc20Symbol}`,
    recipient: routeOf(wallet.params, wallet.chainId)
  })
  const swapLeg = (swap: ISwapInput, destSymbol: string): IStepShape => ({
    kind: 'swap',
    nonce: swap.nonce,
    label: swap.chainId !== swap.destinationChainId ? `Crosschain ${destSymbol}` : `Swap ${destSymbol}`,
    // The linked contract is where the funds ARRIVE: the deposit route on the DESTINATION chain (same CREATE2
    // address on every chain, so only the explorer chain differs for a cross-chain leg).
    recipient: routeOf(swap.params, Number(swap.destinationChainId))
  })

  if (draft.kind === 'allocate') {
    const depositTokenId = draft.swap ? draft.swap.inputToken : draft.baseToken
    const shapes: IStepShape[] = []
    if (draft.wallet) shapes.push(walletLeg(draft.wallet, symbolByAddress(depositTokenId)))
    if (draft.swap) shapes.push(swapLeg(draft.swap, symbolByAddress(draft.baseToken)))
    shapes.push({ kind: 'allocate' as StepKind, nonce: null, recipient: null })
    return shapes
  }

  if (draft.kind === 'deposit') {
    const base = draft.inputAmount.baseToken
    const destSymbol = symbolByAddress(base)
    const shapes: IStepShape[] = []
    if (draft.wallet) shapes.push(walletLeg(draft.wallet, destSymbol))
    if (draft.swap) shapes.push(swapLeg(draft.swap, destSymbol))
    // Composed delivery: the bridged hub-side twin converts to the base in a second, locally-signed swap; a local
    // PA swap credits the signed balance directly, so no recognize step follows it.
    if (draft.hubSwap) {
      shapes.push({
        kind: 'swap',
        nonce: null,
        label: `Swap ${symbolByAddress(draft.output.baseToken)}`,
        recipient: routeOf(draft.params, HUB_CHAIN_ID)
      })
    }
    if (recognize && !draft.hubSwap) {
      shapes.push({
        kind: 'recognize',
        nonce: null,
        recipient: routeOf(draft.params, HUB_CHAIN_ID)
      })
    }
    return shapes
  }

  if (draft.kind === 'claimRoute') {
    return [
      {
        kind: 'recognize',
        nonce: null,
        recipient: { address: predictDepositRoute(draft.account), chainId: draft.chainId },
        label: 'Claim'
      }
    ]
  }

  if (draft.kind === 'fundSwap') {
    const destChainId = draft.destinationChainId ?? draft.chainId
    const isLocal = destChainId === draft.chainId
    const destSymbol = symbolByAddress(draft.tokenOut)
    const shapes: IStepShape[] = []
    // Native input is wrapped (native -> WMON, a FundGate.operate) before the DEX can swap it; surface that leg.
    const wrapNative = isAddressEqual(getAddress(draft.tokenIn), getAddress(PROTOCOL.nativeToken))
    const unwrapNative =
      destChainId === draft.chainId && isAddressEqual(getAddress(draft.tokenOut), getAddress(PROTOCOL.nativeToken))
    if (unwrapNative) {
      return [
        {
          kind: 'swap',
          nonce: null,
          recipient: { address: draft.account, chainId: draft.chainId },
          label: `Unwrap ${nativeSymbolOf(draft.chainId as ChainId)}`
        }
      ]
    }
    if (wrapNative) {
      shapes.push({
        kind: 'swap',
        nonce: null,
        recipient: { address: draft.account, chainId: draft.chainId },
        label: `Wrap ${nativeSymbolOf(draft.chainId as ChainId)}`
      })
    }
    if (isLocal) {
      shapes.push({
        kind: 'swap',
        nonce: null,
        recipient: { address: draft.account, chainId: draft.chainId },
        label: `Swap ${destSymbol}`
      })
      return shapes
    }
    // Cross-chain: same-asset is a single bridge; cross-token composes through an intermediate X (the baked bridgeToken)
    // — a local swap to X on the origin (unless the input already IS X), the X bridge, then a local swap X -> output on
    // the destination (unless the bridge already delivered the output asset).
    const route = predictDepositRoute(draft.account)
    const inSymbol = wrapNative ? nativeSymbolOf(draft.chainId as ChainId) : symbolByAddress(draft.tokenIn)
    const xSymbol = draft.bridgeToken ? symbolByAddress(draft.bridgeToken) : destSymbol
    if (inSymbol !== xSymbol) {
      shapes.push({
        kind: 'swap',
        nonce: null,
        recipient: { address: draft.account, chainId: draft.chainId },
        label: `Swap ${xSymbol}`
      })
    }
    shapes.push({ kind: 'swap', nonce: null, recipient: { address: route, chainId: destChainId }, label: `Crosschain ${xSymbol}` })
    // The dest-chain recognize carries the fund's deploy proofs, so on a chain the fund hasn't touched it CREATES the
    // fund account (and master PA) and credits the bridged balance in one tx — that IS the onboarding step. Label it as
    // account creation rather than a bare "Credit"; the create is a no-op when the account already exists.
    shapes.push({
      kind: 'recognize',
      nonce: null,
      recipient: { address: route, chainId: destChainId },
      label: `Open ${chainName(destChainId)} account`
    })
    if (xSymbol !== destSymbol) {
      shapes.push({
        kind: 'swap',
        nonce: null,
        recipient: { address: draft.account, chainId: destChainId },
        label: `Swap ${destSymbol}`
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
      recipient: { address: draft.output.receiver, chainId: draft.output.chainId }
    }
  ]
}
