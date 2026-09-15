import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableAddress, readableHash, readableTokenAmountLabel, readableUsd } from '@puppet/sdk/core'
import { getGmxTokenDescription, getMarketDescription } from '@puppet/sdk/gmx'
import { GMX_INCREASE_TYPES, GMX_ORDER_TYPE, type IOperateStep } from '@puppet/sdk/venue'
import type { Address, Hex } from 'viem'

export interface ITokenFlow {
  token: { symbol: string; decimals: number }
  delta: bigint
}

export interface IVenueAction {
  venue: string
  label: string
  call: string
  title: string
  details: string[]
  orderKey: Hex | null
}

export interface IOperationSummary {
  actions: IVenueAction[]
  flows: ITokenFlow[]
}

export const readableFlow = (f: ITokenFlow): string => `${f.delta > 0n ? '+' : ''}${readableTokenAmountLabel(f.token, f.delta)}`

const ORDER_STYLE: Record<number, string> = {
  [GMX_ORDER_TYPE.LimitIncrease]: 'limit',
  [GMX_ORDER_TYPE.StopIncrease]: 'stop',
  [GMX_ORDER_TYPE.LimitDecrease]: 'take profit',
  [GMX_ORDER_TYPE.StopLossDecrease]: 'stop loss'
}

const indexOf = (market: Address): { symbol: string; decimals: number } => {
  try {
    const desc = getGmxTokenDescription(getMarketDescription(market).indexToken)
    return { symbol: desc.baseSymbol ?? desc.symbol, decimals: desc.decimals }
  } catch {
    return { symbol: readableAddress(market), decimals: 18 }
  }
}

const gmxToken = (token: Address): { symbol: string; decimals: number } => {
  try {
    return getGmxTokenDescription(token)
  } catch {
    return { symbol: readableAddress(token), decimals: 18 }
  }
}

export function operationSummary(chainId: ChainId, steps: readonly IOperateStep[]): IOperationSummary {
  const actions: IVenueAction[] = []
  const flows: ITokenFlow[] = []
  for (const s of steps) {
    switch (s.kind) {
      case 'gmx-order': {
        const index = indexOf(s.market)
        const increase = GMX_INCREASE_TYPES.has(s.orderType)
        const style = ORDER_STYLE[s.orderType]
        const side = s.isLong ? 'long' : 'short'
        actions.push({
          venue: 'GMX',
          label: `${style === undefined ? (increase ? 'Increase' : 'Decrease') : style[0].toUpperCase() + style.slice(1)} ${side} ${index.symbol}`,
          call: 'createOrder',
          title: `${s.isLong ? 'Long' : 'Short'} ${index.symbol} ${increase ? '+' : '−'}$${readableUsd(s.sizeDeltaUsd)}`,
          details: [
            ...(style === undefined ? [] : [`${style} @ $${readableUsd(s.triggerPrice * 10n ** BigInt(index.decimals))}`]),
            ...(s.positionCollateralToken !== undefined && s.positionCollateralToken !== s.collateralToken
              ? [`swapped to ${gmxToken(s.positionCollateralToken).symbol}`]
              : [])
          ],
          orderKey: s.key
        })
        if (s.collateralDelta > 0n) {
          flows.push({ token: gmxToken(s.collateralToken), delta: increase ? -s.collateralDelta : s.collateralDelta })
        }
        flows.push({ token: getTokenDescription(chainId, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'), delta: -s.executionFee })
        break
      }
      case 'gmx-cancel':
        actions.push({ venue: 'GMX', label: 'Cancel order', call: 'cancelOrder', title: `Cancel order ${readableHash(s.key)}`, details: [], orderKey: s.key })
        break
      case 'gmx-update':
        actions.push({
          venue: 'GMX',
          label: 'Update order',
          call: 'updateOrder',
          title: `Update order ${readableHash(s.key)}`,
          details: [`size $${readableUsd(s.sizeDeltaUsd)}`],
          orderKey: s.key
        })
        break
      case 'gmx-claim':
        actions.push({
          venue: 'GMX',
          label: s.claim === 'funding' ? 'Claim funding fees' : 'Claim collateral',
          call: s.claim === 'funding' ? 'claimFundingFees' : 'claimCollateral',
          title: s.claim === 'funding' ? 'Claim funding fees' : 'Claim collateral',
          details: [`${s.markets.length} market${s.markets.length === 1 ? '' : 's'}`],
          orderKey: null
        })
        break
      case 'venue-deposit':
        actions.push({ venue: 'Hyperliquid', label: 'Deposit', call: 'transfer', title: 'Deposit to Hyperliquid', details: [], orderKey: null })
        flows.push({ token: getTokenDescription(chainId, s.token), delta: -s.amount })
        break
      case 'release':
        actions.push({
          venue: readableAddress(s.to),
          label: 'Release',
          call: s.token === null ? 'send' : 'transfer',
          title: `Release to ${readableAddress(s.to)}`,
          details: [],
          orderKey: null
        })
        flows.push({ token: getTokenDescription(chainId, s.token ?? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'), delta: -s.amount })
        break
      case 'fee':
        break
      case 'call':
        actions.push({
          venue: readableAddress(s.target),
          label: 'Call',
          call: s.selector,
          title: `Call ${readableAddress(s.target)} ${s.selector}`,
          details: [],
          orderKey: null
        })
        break
    }
  }
  return { actions, flows }
}
