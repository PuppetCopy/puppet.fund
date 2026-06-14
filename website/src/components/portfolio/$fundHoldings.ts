import { getMarketDescription, getTokenDescription } from '@puppet/sdk/gmx'
import { type ITokenRegistryMap, liveSelect, select } from '@puppet/sdk/state'
import { fetchPositions } from '@puppet/sdk/venue'
import { combine, fromPromise, type IStream, map, merge, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import { text } from '@/ui-components'
import { $size } from '../../common/$common.js'
import { sqlClient } from '../../io/indexer/sql.js'
import { $SwapEditor } from './$SwapEditor.js'
import type { ISwapDraft } from './draft.js'

const $hint = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, padding: '4px 0' }))($text(label))

const $separator = (): I$Node =>
  $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

const withSeparators = ($rows: I$Node[]): I$Node[] =>
  $rows.flatMap((node, i) => (i === 0 ? [node] : [$separator(), node]))

export const $fundBalances = (
  fundAddress: Address,
  tokenRegistry: ITokenRegistryMap,
  swapDraftList: IStream<ISwapDraft[]>,
  changeSwapDraftTether: IBehavior<ISwapDraft>[1],
  settleTrigger: IStream<unknown>
): I$Node =>
  switchLatest(
    map(
      live => {
        type IBalanceRow = { chainId: number; tokenId: Hex; balance: bigint }
        const rowList: IBalanceRow[] = live.rows
          .filter(r => r.tokenId.length === 66 && r.signedBalance > 0n)
          .map(r => ({ chainId: Number(r.chainId), tokenId: r.tokenId as Hex, balance: r.signedBalance }))
        for (const d of live.drafts) {
          if (d.account !== fundAddress || d.destinationChainId === d.chainId) continue
          if (rowList.some(r => r.chainId === d.destinationChainId && r.tokenId === d.tokenOutId)) continue
          rowList.push({ chainId: d.destinationChainId, tokenId: d.tokenOutId, balance: 0n })
        }
        if (rowList.length === 0) return $hint('No balances yet.')
        const $rows = rowList.map(r =>
          $SwapEditor({
            fundAddress,
            chainId: r.chainId,
            tokenId: r.tokenId,
            balance: r.balance,
            tokenRegistry,
            swapDraftList
          })({ changeDraft: changeSwapDraftTether() })
        )
        return $column(spacing.small)(...withSeparators($rows))
      },
      combine({
        rows: merge(
          fromPromise(
            select(sqlClient, 'AccountBalanceCheckpoint', {
              where: { account: { _eq: fundAddress } },
              distinctOn: ['chainId', 'tokenId'],
              orderBy: [{ chainId: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }]
            })
          ),
          liveSelect(sqlClient, 'AccountBalanceCheckpoint', {
            where: { account: { _eq: fundAddress } },
            distinctOn: ['chainId', 'tokenId'],
            orderBy: [{ chainId: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }]
          }),
          switchLatest(
            map(
              () =>
                fromPromise(
                  select(sqlClient, 'AccountBalanceCheckpoint', {
                    where: { account: { _eq: fundAddress } },
                    distinctOn: ['chainId', 'tokenId'],
                    orderBy: [{ chainId: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }]
                  })
                ),
              settleTrigger
            )
          )
        ),
        drafts: swapDraftList
      })
    )
  )

export const $fundPositions = (fundAddress: Address, settleTrigger: IStream<unknown>): I$Node =>
  switchLatest(
    map(
      positions => {
        const open = positions.filter(pos => pos.sizeInUsd > 0n)
        if (open.length === 0) return $hint('No open positions')
        const $rows = open.map(pos => {
          const symbol = getTokenDescription(getMarketDescription(pos.market).indexToken).symbol
          const directionColor = pos.isLong ? palette.positive : palette.negative
          return $row(spacing.default, style({ alignItems: 'center' }))(
            $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
              $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))($text(symbol)),
              $node(
                style({
                  fontSize: text.xs,
                  fontWeight: '600',
                  padding: '1px 7px',
                  borderRadius: '4px',
                  color: directionColor,
                  backgroundColor: colorShade(directionColor, 12)
                })
              )($text(pos.isLong ? 'Long' : 'Short'))
            ),
            $size(pos.sizeInUsd, pos.collateralInUsd)
          )
        })
        return $column(spacing.small)(...withSeparators($rows))
      },
      switchLatest(map(() => fromPromise(fetchPositions(sqlClient, fundAddress, 'open')), settleTrigger))
    )
  )
