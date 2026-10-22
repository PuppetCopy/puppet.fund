import type { ICells } from '@puppet/sdk/ui-components'
import { filter, type IStream, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style, stylePseudo } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $check, $defaultDropSelectAnchor, $DropSelect, $icon, text } from '@/ui-components'
import { $fundAvatar } from '../common/$fundAvatar.js'
import type { IFund, IRootState } from '../wallet/index.js'

export interface I$FundMenu {
  identity: IStream<{ symbol: string; cells: ICells }>
  activeAccount: Address | null
  funds: IRootState['funds']
}

type IFundChoice = IFund | 'create' | { unknown: string }

export const $FundMenu = ({ identity, activeAccount, funds }: I$FundMenu) =>
  component(([choose, chooseTether]: IBehavior<IFundChoice>) => [
    $DropSelect<IFundChoice, { symbol: string; cells: ICells }>({
      value: identity,
      optionList: [...('unknown' in funds ? [{ unknown: funds.unknown }] : funds.list), 'create'],
      $anchor: $defaultDropSelectAnchor(
        style({ padding: '4px 12px 4px 4px', gap: '8px', borderRadius: '17px', whiteSpace: 'nowrap' }),
        stylePseudo('[aria-expanded="true"]', { borderRadius: '17px 17px 0 0' })
      ),
      $valueLabel: map(shown =>
        $row(style({ alignItems: 'center', gap: '8px' }))(
          $fundAvatar(shown.cells, 24),
          $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(shown.symbol))
        )
      ),
      $$option: map(choice =>
        choice === 'create'
          ? $row(spacing.small, style({ alignItems: 'center', padding: '8px 10px', fontSize: text.sm, color: palette.foreground }))(
              $node(style({ width: '20px', textAlign: 'center', fontSize: text.base }))($text('+')),
              $text('Create fund')
            )
          : 'unknown' in choice
            ? $node(style({ padding: '8px 10px', maxWidth: '260px', fontSize: text.sm, color: palette.foreground, whiteSpace: 'normal' }))($text(choice.unknown))
            : $row(spacing.small, style({ alignItems: 'center', padding: '8px 10px', fontSize: text.sm, color: palette.message }))(
                $fundAvatar(choice.cells, 20),
                $text(choice.symbol),
                ...(activeAccount !== null && isAddressEqual(choice.account, activeAccount) ? [$icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.positive, size: '14px' })] : [])
              )
      )
    })({ select: chooseTether() }),
    {
      pick: filter((choice: IFundChoice): choice is IFund => choice !== 'create' && !('unknown' in choice), choose),
      create: filter((choice: IFundChoice) => choice === 'create', choose)
    }
  ])
