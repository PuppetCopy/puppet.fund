import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi, getAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { acrossVenue } from './across/screen.js'
import { decodeErc20 } from './erc20.js'
import { gmxVenue } from './gmx/screen.js'
import { hyperliquidVenue } from './hyperliquid/screen.js'
import { papertradeVenue } from './papertrade/screen.js'
import { polymarketVenue } from './polymarket/screen.js'
import type { IVenue, IVenueGrant } from './types.js'
import { PERMIT2_ABI } from './uniswap/contracts.js'
import { uniswapVenue } from './uniswap/screen.js'

export const VENUES: readonly IVenue[] = [gmxVenue, hyperliquidVenue, uniswapVenue, polymarketVenue, papertradeVenue, acrossVenue]

export const SAMPLEABLE_ALLOWANCE = 2n ** 96n - 2n
const RESET_GAS = 100_000n

export function operateGrants(chainId: ChainId, callList: readonly IIAccount__Call[]): IVenueGrant[] {
  return callList.flatMap(call => {
    const dec = decodeErc20(call.callData)
    const approved =
      dec?.functionName === 'approve'
        ? [{ ledger: getAddress(call.target), token: getAddress(call.target), spender: getAddress(dec.args[0] as Address), amount: dec.args[1] as bigint }]
        : []
    return [...approved, ...VENUES.flatMap(venue => venue.grants?.(chainId, call) ?? [])]
  })
}

export function leftGrantsOf(chainId: ChainId, callList: readonly IIAccount__Call[]): IVenueGrant[] {
  const last = new Map<string, IVenueGrant>()
  for (const grant of operateGrants(chainId, callList)) last.set(`${grant.ledger}-${grant.token}-${grant.spender}`, grant)
  return [...last.values()].filter(grant => grant.amount > 0n)
}

export const isStandingSpender = (chainId: ChainId, spender: Address): boolean =>
  VENUES.some(venue => venue.contracts.some(contract => contract.standing === true && contract.chainId === chainId && isAddressEqual(contract.address, spender)))

export const mayStand = (chainId: ChainId, grant: IVenueGrant): boolean =>
  isAddressEqual(grant.ledger, grant.token) && grant.amount <= SAMPLEABLE_ALLOWANCE && isStandingSpender(chainId, grant.spender)

export function withAllowancePolicy(chainId: ChainId, callList: readonly IIAccount__Call[]): IIAccount__Call[] {
  const capped = callList.map(call => {
    const dec = decodeErc20(call.callData)
    if (dec?.functionName !== 'approve') return call
    const [spender, amount] = dec.args as readonly [Address, bigint]
    if (amount <= SAMPLEABLE_ALLOWANCE || !isStandingSpender(chainId, spender)) return call
    return { ...call, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, SAMPLEABLE_ALLOWANCE] }) }
  })
  const resets = leftGrantsOf(chainId, capped)
    .filter(grant => !mayStand(chainId, grant))
    .map(grant =>
      isAddressEqual(grant.ledger, grant.token)
        ? { target: grant.token, value: 0n, gasLimit: RESET_GAS, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [grant.spender, 0n] }) }
        : { target: grant.ledger, value: 0n, gasLimit: RESET_GAS, callData: encodeFunctionData({ abi: PERMIT2_ABI, functionName: 'approve', args: [grant.token, grant.spender, 0n, 0] }) }
    )
  return [...capped, ...resets]
}

export interface IStandingMove {
  venueId: string
  token: Address
  spender: Address
  granted: bigint | null
  pulled: bigint
}

export function standingMovesOf(chainId: ChainId, account: Address, callList: readonly IIAccount__Call[]): IStandingMove[] {
  const standing = VENUES.flatMap(venue =>
    venue.contracts.filter(contract => contract.standing === true && contract.chainId === chainId).map(contract => ({ venue, spender: getAddress(contract.address) }))
  )
  const moves = new Map<string, IStandingMove>()
  for (const call of callList) {
    for (const grant of operateGrants(chainId, [call])) {
      const owner = standing.find(entry => isAddressEqual(entry.spender, grant.spender))
      if (owner === undefined || !isAddressEqual(grant.ledger, grant.token)) continue
      moves.set(`${grant.token}-${grant.spender}`, { venueId: owner.venue.venueId, token: grant.token, spender: grant.spender, granted: grant.amount, pulled: 0n })
    }
    for (const { venue, spender } of standing) {
      for (const flow of venue.outflows(account, call)) {
        const token = getAddress(flow.token)
        const key = `${token}-${spender}`
        const held = moves.get(key) ?? { venueId: venue.venueId, token, spender, granted: null, pulled: 0n }
        moves.set(key, { ...held, pulled: held.pulled + flow.amount })
      }
    }
  }
  return [...moves.values()]
}
