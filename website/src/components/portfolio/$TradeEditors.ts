import type { ChainId } from '@puppet/sdk/const'
import { map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { getAddress } from 'viem'
import { $ButtonSecondary, $defaultMiniButtonSecondary, text } from '@/ui-components'
import { chainFor } from '../../common/$contract.js'
import type { ITradeView } from '../../io/datastore/trading.js'
import type { ITradeDraft } from './draft.js'

export const OPEN_CYCLE_SKIN = 5_000n

export interface I$CycleEditor {
  view: ITradeView
}

export const $CycleEditor = ({ view }: I$CycleEditor) =>
  component(([clickClose, clickCloseTether]: IBehavior<PointerEvent>) => {
    const chainId = Number(view.book.chainId) as ChainId
    const open = view.book.cycle > view.settledCycle
    const settleDraft: ITradeDraft = {
      kind: 'settle',
      id: `settle:${view.book.id}`,
      spokeChainId: chainId,
      token: getAddress(view.book.token)
    }
    return [
      open
        ? $row(spacing.small, style({ alignItems: 'center', justifyContent: 'flex-end' }))(
            $node(style({ fontSize: text.sm, color: palette.foreground }))(
              $text('Close every position first; settlement values the book at flat and pays or draws each backer on the hub.')
            ),
            $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Close cycle') })({ click: clickCloseTether() })
          )
        : $node(style({ fontSize: text.sm, color: palette.foreground }))(
            $text(`Cycle ${view.book.cycle} is settled. Your next order through a linked dApp opens cycle ${view.book.cycle + 1n} on what the account holds on ${chainFor(chainId).name}.`)
          ),
      { changeTradeDraft: map((): ITradeDraft => settleDraft, clickClose) }
    ]
  })
