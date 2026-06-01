import { ARBITRUM_TOKEN_LIST as TOKEN_DESCRIPTION_LIST } from '@puppet/contracts/gmx'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type IStream, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $text, component } from 'aelea/ui'
import { isDesktopScreen } from 'aelea/ui-components'
import type { Address } from 'viem/accounts'
import { $DropMultiSelect, $defaultNoneSelected } from '@/ui-components'
import { $tokenIcon, $tokenLabeled } from '../common/$common'

interface I$SelectIndexToken {
  selectedList: IStream<Address[]>
}

export const $SelectIndexToken = ({ selectedList }: I$SelectIndexToken) =>
  component(([changeIndexTokenList, changeIndexTokenListTether]: IBehavior<Address[]>) => {
    return [
      $DropMultiSelect({
        $noneSelected: $defaultNoneSelected($text(isDesktopScreen ? 'All Markets' : 'All')),
        $$option: map(address => {
          const token = getTokenDescription(address)
          return token ? $tokenLabeled(token) : $text(address)
        }),
        $$selectedOption: map(address => {
          const token = getTokenDescription(address)
          return token ? $tokenIcon(token) : $text('')
        }),
        value: selectedList,
        optionList: map(selected => {
          return TOKEN_DESCRIPTION_LIST.map(t => t.address as Address).filter(addr => selected.indexOf(addr) === -1)
        }, selectedList)
      })({
        select: changeIndexTokenListTether()
      }),

      { changeIndexTokenList }
    ]
  })
