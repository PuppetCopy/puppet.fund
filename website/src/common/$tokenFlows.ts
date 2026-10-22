import type { ITokenFlowView } from '@puppet/sdk/client'
import { readableTokenAmount, readableTokenAmountLabel, readableUsd } from '@puppet/sdk/core'
import { combine, type IStream, just, map, op } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $amountDisplay, $defaultTooltipDropContainer, $gas, $icon, $intermediateLine, $Tooltip, maskBalance, text } from '@/ui-components'
import { $tokenMark, $tokenProfile, $intermediateTokenProfile } from './$common.js'
import { MINUS, signedDollar } from '../io/price.js'

export type ILiveTokenFlow = Omit<ITokenFlowView, 'amount' | 'usd'> & { amount: IStream<bigint>; price: IStream<Promise<bigint | null>> }

const usdLabel = (usd: bigint): string => `$${readableUsd(usd)}`

const unitsOf = (flow: ITokenFlowView): string => `${flow.exact ? '' : '≈'}${readableTokenAmount(flow.profile.decimals, flow.amount)}`

const feeUnitsOf = (fee: ITokenFlowView): string => readableTokenAmountLabel(fee.profile, fee.amount)

const $flowToken = (hideBalances: IStream<boolean>, direction: 'out' | 'in', flow: ITokenFlowView | ILiveTokenFlow, $token: I$Node): I$Node => {
  const sign = direction === 'out' ? MINUS : ''
  const shown: IStream<{ usd: Promise<string> | string; amount: Promise<string> | string }> =
    'price' in flow
      ? op(
          combine({ amount: flow.amount, price: flow.price }),
          map(p => {
            const units = `${flow.exact ? '' : '≈'}${readableTokenAmount(flow.profile.decimals, p.amount)}`
            return {
              usd: p.price.then(known => (known === null ? `${sign}${units}` : `${signedDollar(sign)}${readableUsd(p.amount * known)}`)),
              amount: p.price.then(known => (known === null ? '' : units))
            }
          }),
          state()
        )
      : just(flow.usd === null ? { usd: `${sign}${unitsOf(flow)}`, amount: '' } : { usd: `${signedDollar(sign)}${readableUsd(flow.usd)}`, amount: unitsOf(flow) })
  return $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }))(
    $token,
    $node(style({ whiteSpace: 'nowrap', marginLeft: 'auto' }))($amountDisplay({
      hideBalances,
      usd: map(s => s.usd, shown),
      amount: map(s => s.amount, shown),
      usdColor: just(direction === 'out' ? palette.negative : palette.positive),
      align: 'flex-end'
    }))
  )
}

export const $tokenFlows = (hideBalances: IStream<boolean>, outs: readonly (ITokenFlowView | ILiveTokenFlow)[], ins: readonly (ITokenFlowView | ILiveTokenFlow)[]): I$Node =>
  $column(spacing.small, style({ flex: 1, minWidth: '0' }))(
    ...outs.map(flow => $flowToken(hideBalances, 'out', flow, $tokenProfile(flow.chainId, flow.token, 24, true, null, flow.profile))),
    ...ins.map(flow => $flowToken(hideBalances, 'in', flow, $tokenProfile(flow.chainId, flow.token, 24, true, null, flow.profile)))
  )

const $tokenFlowsGrid = $node(spacing.big, style({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center', flex: 1, minWidth: '0' }))

export const $tokenFlowsHead: I$Node = $tokenFlowsGrid($node($text('Inflow')), $node($text('Outflow')))

export const $tokenFlowsRow = (hideBalances: IStream<boolean>, outs: readonly ITokenFlowView[], ins: readonly ITokenFlowView[]): I$Node =>
  $tokenFlowsGrid(
    $column(spacing.small, style({ alignItems: 'flex-start', minWidth: '0' }))(...ins.map(flow => $flowToken(hideBalances, 'in', flow, $tokenMark(flow.chainId, flow.token, flow.profile, 24, true)))),
    $column(spacing.small, style({ alignItems: 'flex-start', minWidth: '0' }))(...outs.map(flow => $flowToken(hideBalances, 'out', flow, $tokenMark(flow.chainId, flow.token, flow.profile, 24, true))))
  )

const $intermediateFlowToken: I$Node = $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
  $intermediateTokenProfile(24),
  $column(spacing.tiny, style({ alignItems: 'flex-end' }))($intermediateLine('4em'), $intermediateLine('6em', text.xs))
)

export const $intermediateTokenFlows: I$Node = $column(spacing.small)($intermediateFlowToken, $intermediateFlowToken)

const $gasIcon = $icon({ $content: $gas, width: '18px', viewBox: '0 0 32 32', fill: palette.foreground })

export const $relayFeeIcon = $Tooltip({
  $dropContainer: $defaultTooltipDropContainer,
  $content: $node(style({ fontSize: text.xs, maxWidth: '240px', lineHeight: '1.4', color: palette.message }))(
    $text('Relay fee, charged by Puppet to send the request. You sign the exact amount.')
  ),
  $anchor: $node(style({ display: 'flex', cursor: 'help' }))($gasIcon)
})({})

export const $feeAmount = (hideBalances: IStream<boolean>, fee: ITokenFlowView): I$Node =>
  fee.usd === null
    ? $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(maskBalance(feeUnitsOf(fee), hideBalances)))
    : $node(style({ whiteSpace: 'nowrap' }))($amountDisplay({ hideBalances, usd: just(usdLabel(fee.usd)), amount: feeUnitsOf(fee), align: 'flex-end' }))

export const $relayFee = (hideBalances: IStream<boolean>, fee: ITokenFlowView): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))($relayFeeIcon, $feeAmount(hideBalances, fee))

export const $intermediateRelayFee: I$Node = $row(spacing.small, style({ alignItems: 'center' }))(
  $gasIcon,
  $column(spacing.tiny)($intermediateLine('3em'), $intermediateLine('5em', text.xs))
)
