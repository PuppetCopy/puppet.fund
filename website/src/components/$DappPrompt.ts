import type { IPendingCall } from '@puppet/sdk/client'
import { CHAIN_ID_LIST, type ChainId } from '@puppet/sdk/const'
import { contractLabelOf } from '@puppet/sdk/state'
import { describeOperate } from '@puppet/sdk/venue'
import { constant, delay, empty, filter, fromPromise, type IStream, just, map, op, periodic, skipRepeatsWith, start, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress } from 'viem'
import { $ButtonPrimary, $ButtonSecondary, $defaultMiniButtonPrimary, $defaultMiniButtonSecondary, $icon, $infoTooltip, $intermediatePromise, $intermediateLine, $unknown, text } from '@/ui-components'
import { $chainIcon, chainName } from '../common/$chain.js'
import { $contractPill } from '../common/$contract.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $walletConnectLogo } from '../common/$icons.js'
import { $venueFields, $venueIcon } from '../common/$operationView.js'
import { $relayFee, $intermediateRelayFee, $tokenFlows, $intermediateTokenFlows } from '../common/$tokenFlows.js'
import { operationSummary } from '../common/operation.js'
import type { IWalletPair } from '../wallet/index.js'
import { deferSigns, dismissRefusal, friendlyDappError, type IPendingSign, type IRefusedSign, prettyUrl, refusedSign, resolveSignApproval, signQueue, SUBMIT_METHODS, venueOfUrl } from '../wallet/walletLink.js'

export interface I$DappPrompt {
  walletPair: IStream<IWalletPair>
}

const REARM_MS = 800

const $panel = $column(spacing.default, style({ overflowWrap: 'anywhere' }))

const $card = (...$children: I$Node[]): I$Node =>
  $column(spacing.small, style({ padding: '8px 10px', borderRadius: '8px', backgroundColor: colorShade(palette.horizon, 15) }))(...$children)

const $title = (label: string): I$Node => $node(style({ fontSize: text.base, fontWeight: '600', color: palette.message }))($text(label))

const kindOf = (method: string): string => (method === 'wc_sessionProposal' ? 'Link' : SUBMIT_METHODS.includes(method) ? 'Transaction' : 'Signature')

const $planVenues = (call: IPendingCall): I$Node => {
  const venues = [...new Set(operationSummary(call.chainId, describeOperate(call.chainId, call.account, call.callList, false, undefined, call.facts), call.profiles).actions.map(action => action.venue))]
  return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    ...venues.flatMap(venue => [$venueIcon(venue, 20), $node(style({ fontSize: text.base, fontWeight: '600', color: palette.message }))($text(venue))])
  )
}

const $plan = (call: IPendingCall): I$Node => {
  const steps = describeOperate(call.chainId, call.account, call.callList, false, undefined, call.facts)
  const summary = operationSummary(call.chainId, steps, call.profiles)
  const approved = steps.flatMap(step => (step.kind === 'approve' ? [getAddress(step.token)] : []))
  const contracts = [...new Set(call.callList.map(c => getAddress(c.target)))].filter(target => !approved.includes(target))
  const $pill = (address: Address): I$Node => {
    const label = contractLabelOf(call.chainId, address)
    return $contractPill({ address, chainId: call.chainId, name: label.name, detail: label.detail })
  }
  return $column(spacing.small)(
    ...(call.outs.length === 0 && call.ins.length === 0 ? [] : [$card($tokenFlows(just(false), call.outs, call.ins))]),
    $card(
      $row(spacing.small, style({ flexWrap: 'wrap', alignItems: 'center' }))(
        ...summary.actions.map(action =>
          $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0' }))(
            $venueIcon(action.venue, 16),
            $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(action.label)),
            ...(action.fields.length === 0 ? [] : [$infoTooltip($column(style({ maxWidth: '280px' }))($venueFields(action.fields)))]),
            ...(action.spender === null ? [] : [$node(style({ fontSize: text.sm, color: palette.foreground }))($text('→')), $pill(action.spender)])
          )
        ),
        ...contracts.map($pill)
      )
    )
  )
}

const $origin = (p: IPendingSign | IRefusedSign): I$Node => {
  const venue = p.verified.validation === 'VALID' ? venueOfUrl(p.verified.origin) : null
  return $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', minWidth: '0' }))(
    'outcome' in p || p.call === null
      ? venue === null
        ? $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
            $icon({ $content: $unknown, viewBox: '0 0 32 32', size: '20px', fill: palette.foreground }),
            $title('Unrecognised dApp'),
            $infoTooltip('Not a verified venue app. Puppet still screens every request it signs.')
          )
        : $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))($venueIcon(venue.venueId, 20), $title(venue.name))
      : $intermediatePromise({
          $loader: $intermediateLine('6em', text.base),
          $$fail: () => $title(p.name),
          $display: just(p.call.then($planVenues))
        }),
    $node(style({ fontSize: text.xs, color: palette.foreground, minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(
      $text(p.verified.validation === 'VALID' ? prettyUrl(p.verified.origin) : `${prettyUrl(p.url)} · unverified`)
    )
  )
}

const countdownOf = (expiresAt: number): IStream<string> =>
  map(
    () => {
      const left = Math.max(0, Math.ceil(expiresAt - Date.now() / 1000))
      return left === 0 ? 'Expiring' : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    },
    start(null, periodic(1000))
  )

export const $DappPrompt = ({ walletPair }: I$DappPrompt) =>
  component(
    (
      [signDecision, signDecisionTether]: IBehavior<PointerEvent, { id: number; approved: boolean }>,
      [dismissRefused, dismissRefusedTether]: IBehavior<PointerEvent, number>,
      [later, laterTether]: IBehavior<PointerEvent>
    ) => {
      const head: IStream<IPendingSign | null> = op(
        signQueue,
        map(queue => (queue.length === 0 ? null : queue[0]!)),
        skipRepeatsWith((a, b) => (a === null ? null : a.id) === (b === null ? null : b.id)),
        state()
      )
      const $fundChip = switchLatest(
        map(
          pair =>
            $intermediatePromise({
              $loader: $intermediateLine('4em'),
              $$fail: () => empty,
              $display: just(
                pair.root.then(root =>
                  root === null || root.fund === null || 'unknown' in root.fund
                    ? empty
                    : $row(spacing.small, style({ alignItems: 'center' }))(
                        $fundAvatar(root.fund.cells, 20),
                        $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(root.fund.symbol))
                      )
                )
              )
            }),
          walletPair
        )
      )

      const $refusal = (p: IRefusedSign): I$Node => {
        const reason = friendlyDappError(p.error)
        const detail = p.error instanceof Error ? p.error.message : String(p.error)
        return $panel(
          $origin(p),
          $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.negative }))($text(`${kindOf(p.method)} ${p.outcome}`)),
          $row(spacing.tiny, style({ alignItems: 'center' }))(
            $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.4' }))($text(reason)),
            ...(reason === detail ? [] : [$infoTooltip($column(style({ maxWidth: '280px', wordBreak: 'break-word' }))($text(`${p.method}: ${detail}`)))])
          ),
          $row(style({ justifyContent: 'flex-end' }))(
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $text('Dismiss')
            })({ click: dismissRefusedTether(map(() => p.id)) })
          )
        )
      }

      const $prompt = (p: IPendingSign): I$Node => {
        const venue = p.verified.validation === 'VALID' ? venueOfUrl(p.verified.origin) : null
        const linked = p.chains === null ? [] : p.chains.linked
        const refused = p.chains === null ? [] : p.chains.refused
        const shown = linked.filter(id => (CHAIN_ID_LIST as readonly number[]).includes(id) || venue?.dapp?.chains.includes(id as ChainId) === true)
        const folded = linked.filter(id => !shown.includes(id))
        const armed: IStream<boolean> = start(
          false,
          op(
            fromPromise(p.call === null ? Promise.resolve(true) : p.call.then(() => true, () => false)),
            filter(planned => planned),
            delay(REARM_MS),
            constant(true)
          )
        )
        return $panel(
          $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
            $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground }))(
              $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: '14px', fill: palette.primary }),
              $text(`${kindOf(p.method)} request`),
              $node(style({ color: palette.indeterminate }))($text(map(queue => (queue.length > 1 ? `· ${queue.length - 1} more waiting` : ''), signQueue)))
            ),
            $row(spacing.small, style({ alignItems: 'center' }))(
              ...(p.expiresAt === null ? [] : [$node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(countdownOf(p.expiresAt)))]),
              $ButtonSecondary({
                $container: $defaultMiniButtonSecondary,
                $content: $text('Later')
              })({ click: laterTether() })
            )
          ),
          $origin(p),
          ...(p.verified.isScam || p.verified.validation === 'INVALID'
            ? [
                $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.negative, lineHeight: '1.4' }))(
                  $text(
                    p.verified.isScam
                      ? 'WalletConnect flags this dApp as a known scam. Do not approve.'
                      : `This dApp claims ${prettyUrl(p.url)} but runs on ${prettyUrl(p.verified.origin)}. Do not approve.`
                  )
                )
              ]
            : []),
          ...(p.chains === null
            ? []
            : [
                $card(
                  $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                    $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))($node(style({ fontSize: text.sm, color: palette.foreground }))($text('Link')), $fundChip),
                    $row(spacing.tiny, style({ alignItems: 'center' }))(
                      ...shown.map(id => $chainIcon(id, 18)),
                      ...(folded.length + refused.length === 0
                        ? []
                        : [
                            $node(style({ fontSize: text.xs, color: palette.foreground }))($text(`${folded.length + refused.length}`)),
                            $infoTooltip(
                              [
                                ...(folded.length === 0 ? [] : [`Also linked: ${folded.map(chainName).join(', ')}.`]),
                                ...(refused.length === 0 ? [] : [`Requested but not linked: ${refused.map(chainName).join(', ')}.`])
                              ].join(' ')
                            )
                          ])
                    )
                  )
                )
              ]),
          ...(p.call === null
            ? []
            : [
                $intermediatePromise({
                  $loader: $column(spacing.small)($card($intermediateTokenFlows), $card($intermediateLine('10em'))),
                  $$fail: err =>
                    $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $node(style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.4' }))($text(friendlyDappError(err))),
                      ...(friendlyDappError(err) === (err instanceof Error ? err.message : String(err)) ? [] : [$infoTooltip(err instanceof Error ? err.message : String(err))])
                    ),
                  $display: just(p.call.then($plan))
                })
              ]),
          ...(p.restore
            ? [$node(style({ fontSize: text.xs, color: palette.indeterminate, lineHeight: '1.4' }))($text('Your fund key is not on this device. Approving first asks your wallet to restore it.'))]
            : []),
          ...(p.call !== null || p.chains !== null
            ? []
            : [
                $node(
                  style({
                    fontSize: text.xs,
                    color: palette.foreground,
                    fontFamily: 'monospace',
                    wordBreak: 'break-word',
                    maxHeight: '120px',
                    overflowY: 'auto',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: colorShade(palette.horizon, 15)
                  })
                )($text(p.payload))
              ]),
          $row(spacing.small, style({ justifyContent: 'space-between', alignItems: 'center' }))(
            p.call === null
              ? $node()
              : $intermediatePromise({
                  $loader: $intermediateRelayFee,
                  $$fail: () => $node(),
                  $display: just(p.call.then(call => $relayFee(just(false), call.fee)))
                }),
            $row(spacing.small, style({ alignItems: 'center' }))(
              $ButtonSecondary({
                $container: $defaultMiniButtonSecondary,
                $content: $text('Decline')
              })({ click: signDecisionTether(map(() => ({ id: p.id, approved: false }))) }),
              $ButtonPrimary({
                $container: $defaultMiniButtonPrimary,
                $content: $text('Approve'),
                disabled: map(ready => !ready, armed)
              })({ click: signDecisionTether(map(() => ({ id: p.id, approved: true }))) })
            )
          )
        )
      }

      return [
        $column(spacing.default)(
          switchLatest(
            map(d => {
              resolveSignApproval(d.id, d.approved)
              return empty
            }, signDecision)
          ),
          switchLatest(
            map(id => {
              dismissRefusal(id)
              return empty
            }, dismissRefused)
          ),
          switchLatest(
            map(() => {
              deferSigns()
              return empty
            }, later)
          ),
          switchLatest(map(p => (p === null ? empty : $refusal(p)), refusedSign)),
          switchLatest(map(p => (p === null ? empty : $prompt(p)), head))
        ),
        { later }
      ]
    }
  )
