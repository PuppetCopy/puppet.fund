import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import type { ChainId } from '../const/index.js'
import { getTokenDescription, type ITokenProfile, readableAddress } from '../core/index.js'
import { tokenMetaByChainToken, tokenMetaKey } from '../state/index.js'
import type { IOperateStep } from '../venue/index.js'

export type ITokenProfiles = ReadonlyMap<Address, ITokenProfile>

export interface ITokenFlowView {
  chainId: ChainId
  token: Address
  profile: ITokenProfile
  amount: bigint
  exact: boolean
  usd: bigint | null
}

export const tokenUnitOf = (chainId: ChainId, token: Address, profiles: ITokenProfiles): ITokenProfile =>
  tokenMetaByChainToken.has(tokenMetaKey(chainId, token))
    ? getTokenDescription(chainId, token)
    : (profiles.get(getAddress(token)) ?? { symbol: `units of ${readableAddress(token)}`, decimals: 0 })

export const unregisteredTokensOf = (chainId: ChainId, steps: readonly IOperateStep[]): Address[] =>
  [
    ...new Set(
      steps.flatMap(step =>
        step.kind === 'venue' ? step.flows.map(flow => getAddress(flow.token)) : step.kind === 'approve' ? [getAddress(step.token)] : step.kind === 'release' && step.token !== null ? [getAddress(step.token)] : []
      )
    )
  ].filter(token => !tokenMetaByChainToken.has(tokenMetaKey(chainId, token)))

export interface ITokenMove {
  token: Address
  amount: bigint
  out: boolean
  exact: boolean
}

export const tokenMovesOf = (steps: readonly IOperateStep[]): ITokenMove[] => {
  const moved = new Map<string, ITokenMove>()
  const flows = steps.flatMap(step => (step.kind === 'venue' ? step.flows : step.kind === 'release' ? [{ token: step.token ?? PROTOCOL.nativeToken, delta: -step.amount, exact: true }] : []))
  for (const flow of flows) {
    const token = getAddress(flow.token)
    const out = flow.delta < 0n
    const key = `${token}:${out}:${flow.exact}`
    moved.set(key, { token, amount: (moved.get(key)?.amount ?? 0n) + (out ? -flow.delta : flow.delta), out, exact: flow.exact })
  }
  return [...moved.values()]
}
