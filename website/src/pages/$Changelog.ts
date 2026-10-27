import TOKEN, { TOKEN_CHAIN_ID } from '@puppet/contracts/token'
import { formatThrownError } from '@puppet/sdk/compact'
import { getAccountExplorerUrl, getTxExplorerUrl, readableAddress } from '@puppet/sdk/core'
import { empty, fromPromise, type IStream, just, map, op, switchMap } from 'aelea/stream'
import { $element, $node, $text, attr, component, type I$Node, style } from 'aelea/ui'
import { $column, $intermediatePromise, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $anchor, $externalMark, text } from '@/ui-components'
import { changelogOf, type IChangelogApproval, type IChangelogRelease } from '../app/changelog.js'
import { approvalAnswers, type IReleaseCheck, runningHash } from '../app/release.js'
import { chainFor } from '../common/$contract.js'
import { $card } from '../common/elements/$common.js'

const $explorerLink = (href: string, label: string): I$Node =>
  $anchor(attr({ href, target: '_blank' }), style({ display: 'inline-flex', alignItems: 'center', color: palette.message, fontFamily: 'var(--font-numbers)' }))(
    $text(readableAddress(label)),
    $externalMark()
  )

const $reference = (approval: IChangelogApproval): I$Node => {
  const { contract, chainId, address } = 'address' in approval ? approval : { contract: 'Release', chainId: TOKEN_CHAIN_ID, address: TOKEN.Release.address }
  const chain = chainFor(chainId)
  return $row(spacing.small, style({ flexWrap: 'wrap', alignItems: 'center', rowGap: '6px', fontSize: text.xs, color: palette.foreground }))(
    $node(
      style({ fontFamily: 'var(--font-numbers)', color: palette.message, padding: '2px 8px', borderRadius: '999px', backgroundColor: colorShade(palette.horizon, 25), whiteSpace: 'nowrap' })
    )($text(approval.date)),
    $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($node($text(contract)), $explorerLink(getAccountExplorerUrl(address, chain), address)),
    $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($node($text('approved in')), $explorerLink(getTxExplorerUrl(approval.tx, chain), approval.tx))
  )
}

const $release = (release: IChangelogRelease, running: boolean): I$Node =>
  $card(spacing.default, style({ width: '100%' }))(
    $column(spacing.small)(
      $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }))(
        $node(style({ fontSize: text.xl, fontWeight: '700', color: palette.message, lineHeight: '1.3' }))($text(release.title)),
        ...(running
          ? [
              $node(
                style({ fontSize: text.xs, fontWeight: '600', color: palette.primary, padding: '2px 8px', borderRadius: '999px', border: `1px solid ${palette.primary}`, whiteSpace: 'nowrap' })
              )($text('This version'))
            ]
          : [])
      ),
      ...(release.lead === null ? [] : [$node(style({ fontSize: text.base, color: palette.message, lineHeight: '1.5' }))($text(release.lead))]),
      release.approval !== null
        ? $reference(release.approval)
        : running
          ? $intermediatePromise({
              $loader: empty,
              $$fail: error => $node(style({ fontSize: text.xs, color: palette.negative }))($text(formatThrownError(error))),
              $display: op(
                fromPromise(runningHash()),
                switchMap((hash): IStream<Promise<IReleaseCheck | null>> => (hash === null ? just(Promise.resolve(null)) : approvalAnswers(hash))),
                map(answer =>
                  answer.then(approval =>
                    approval === null
                      ? empty
                      : approval.kind === 'unapproved'
                        ? $node(style({ fontSize: text.xs, color: palette.foreground }))($text('No release is approved on chain yet.'))
                        : approval.kind === 'superseded'
                          ? $node(style({ fontSize: text.xs, color: palette.foreground }))($text('A newer release is approved; reload to update.'))
                          : $reference({ date: new Date(approval.time * 1000).toISOString().slice(0, 10), tx: approval.transactionHash })
                  )
                )
              )
            })
          : empty
    ),
    ...release.groups.map(group =>
      $column(spacing.small)(
        ...(group.title === null
          ? []
          : [$node(style({ fontSize: text.xs, fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.foreground }))($text(group.title))]),
        $column(spacing.tiny)(
          ...group.changes.map(change =>
            $row(spacing.small, style({ alignItems: 'flex-start' }))(
              $node(style({ fontSize: text.sm, lineHeight: '1.5', color: palette.foreground, flexShrink: '0' }))($text('•')),
              $node(style({ fontSize: text.sm, lineHeight: '1.5', color: group.title === 'Fixed' ? palette.foreground : palette.message }))($text(change))
            )
          )
        )
      )
    )
  )

export const $Changelog = () =>
  component(() => [
    $column(style({ width: '100%', gap: isDesktopScreen ? '24px' : '16px' }))(
      $element('h1')(style({ margin: '0', padding: isDesktopScreen ? '0' : '0 12px', fontSize: text.xxl, fontWeight: '800', color: palette.message }))($text('Release log')),
      $intermediatePromise({
        $loader: empty,
        $$fail: error => $node(style({ fontSize: text.sm, color: palette.negative }))($text(formatThrownError(error))),
        $display: op(
          just(null),
          map(() =>
            fetch('/changelog.json')
              .then(response => {
                if (!response.ok) throw new Error(`the release log could not be read (HTTP ${response.status})`)
                return response.json()
              })
              .then(raw =>
                $column(style({ width: '100%', gap: isDesktopScreen ? '24px' : '16px' }))(...changelogOf(raw).map((release, index) => $release(release, index === 0)))
              )
          )
        )
      })
    ),
    {}
  ])
