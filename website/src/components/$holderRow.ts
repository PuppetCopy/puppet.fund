import { empty, type IStream, just, map, o, op, skipRepeats, switchLatest } from 'aelea/stream'
import { $node, $text, attr, attrBehavior, type I$Node, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress } from 'viem'
import { $amountDisplay, $anchor, $externalMark, SEPARATOR_COLOR, softNavClick } from '@/ui-components'
import { $badged, $jazzicon, AVATAR_SIZE } from '../common/$avatar.js'
import { $accountLabel } from './$AccountProfile.js'

const percentOf = (shares: bigint, totalShares: bigint): number => (totalShares > 0n ? Number((shares * 10000n) / totalShares) / 100 : 0)

export const $holderRow = (config: {
  hideBalances: IStream<boolean>
  pool: IStream<{
    totalShares: bigint
    owned: bigint
    value: Promise<string> | string
    after: { totalShares: bigint; owned: bigint; value: Promise<string> | string } | null
  }> | null
  wallet: Address
  href: string
  external: boolean
  badge: I$Node | null
  isYou: boolean
  held: bigint
  exiting: bigint | null
  $caption: I$Node | null
  title: string
}): I$Node => {
  const $link = $anchor(
    config.external ? attr({ href: config.href, target: '_blank', rel: 'noopener noreferrer', title: config.title }) : attr({ href: config.href, title: config.title }),
    style({ display: 'flex', alignItems: 'center', minWidth: 0, color: 'inherit', textDecoration: 'none' }),
    stylePseudo(':hover', { opacity: '0.8' }),
    config.external ? o() : softNavClick(config.href)
  )
  const pool = config.pool
  const exiting = config.exiting === null || config.exiting === 0n ? null : config.exiting
  const kept = exiting === null ? config.held : config.held - exiting
  return $column(style({ gap: '6px' }))(
    $row(spacing.small, style({ alignItems: 'center' }))(
      $row(style({ alignItems: 'center', gap: '8px', minWidth: 0 }))(
        $link(
          $badged($jazzicon(getAddress(config.wallet), AVATAR_SIZE), config.badge)
        ),
        $column(style({ minWidth: 0, gap: '2px' }))(
          $link(config.isYou ? $node(style({ color: palette.message }))($text('You')) : $accountLabel({ address: config.wallet }), ...(config.external ? [$externalMark()] : [])),
          ...(config.$caption === null ? [] : [config.$caption])
        )
      ),
      $node(style({ flex: 1 }))(),
      ...(pool === null
        ? []
        : [
            $amountDisplay({
              hideBalances: config.hideBalances,
              usd: map(p => `${percentOf(p.owned, p.totalShares)}%`, pool),
              amount: map(p => p.value, pool),
              change: map(p => (p.after === null ? null : { usd: `${percentOf(p.after.owned, p.after.totalShares)}%`, amount: p.after.value }), pool),
              color: just(palette.negative),
              align: 'flex-end'
            })
          ])
    ),
    ...(pool === null
      ? []
      : [
          switchLatest(
            op(
              pool,
              map(p => p.owned >= p.totalShares && exiting === null),
              skipRepeats,
              map(whole =>
                whole
                  ? empty
                  : $node(style({ display: 'flex' }))(
                      $node(
                        style({ borderTop: `1px solid ${colorShade(palette.foreground, 40)}` }),
                        styleBehavior(map(p => ({ width: `${percentOf(kept, p.totalShares)}%` }), pool))
                      )(),
                      ...(exiting === null
                        ? []
                        : [
                            $node(
                              style({ borderTop: `1px solid ${palette.indeterminate}` }),
                              styleBehavior(map(p => ({ width: `${percentOf(exiting, p.totalShares)}%` }), pool)),
                              attrBehavior(map(p => ({ title: `${percentOf(exiting, p.totalShares)}% sold, paid at the next redemption` }), pool))
                            )()
                          ]),
                      $node(style({ flex: 1, borderTop: `1px solid ${SEPARATOR_COLOR}` }))()
                    )
              )
            )
          )
        ])
  )
}
