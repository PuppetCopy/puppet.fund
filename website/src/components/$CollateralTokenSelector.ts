import { getTokenDescription } from '@puppet/sdk/gmx'
import { combine, type IStream, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $text, component } from 'aelea/ui'
import { isDesktopScreen } from 'aelea/ui-components'
import type { Address } from 'viem/accounts'
import { $DropMultiSelect, $defaultNoneSelected } from '@/ui-components'
import { $tokenLabeled } from '../common/$common'

interface I$SelectCollateralToken {
  selectedList: IStream<Address[]>
  tokenList: IStream<Address[]>
}

export const $SelectCollateralToken = ({ selectedList, tokenList }: I$SelectCollateralToken) =>
  component(([changeCollateralTokenList, changeCollateralTokenListTether]: IBehavior<Address[]>) => {
    return [
      $DropMultiSelect({
        $noneSelected: $defaultNoneSelected($text(isDesktopScreen ? 'All Collateral' : 'All')),
        $$option: map(tr => {
          return $tokenLabeled(getTokenDescription(tr))
        }),
        $$selectedOption: map(tr => {
          return $tokenLabeled(getTokenDescription(tr))
        }),
        value: selectedList,
        optionList: map(
          p => p.all.filter(item => p.selected.indexOf(item) === -1),
          combine({ all: tokenList, selected: selectedList })
        )
      })({
        select: changeCollateralTokenListTether()
      }),

      {
        changeCollateralTokenList
      }
    ]
  })
