import type { IStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import { text } from '@/ui-components'
import { $heading1 } from '../common/$text.js'
import type { IDepositDraft, IEditorDraft } from '../components/portfolio/draft.js'
import type { IOwnState } from '../io/journal/localFold.js'
import type { IRootState, IWalletPair } from '../wallet/index.js'
import { $HelloPage } from './$HelloPage.js'

export interface I$Quickstart {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  draftDepositList: IStream<IDepositDraft[]>
}

export const $Quickstart = (config: I$Quickstart) =>
  component(
    (
      [changeDraft, changeDraftTether]: IBehavior<IEditorDraft>,
      [deriveAccount, deriveAccountTether]: IBehavior<Address>
    ) => [
      $column(spacing.big, style({ width: '100%' }))(
        $column(spacing.small, style({ alignItems: 'center', textAlign: 'center', width: '100%' }))(
          $heading1($text('Start trading with backing')),
          $node(style({ fontSize: text.base, lineHeight: '1.6', color: palette.message, maxWidth: '560px' }))(
            $text('Trade exactly as you do today, and earn more: backer capital rides your trades and pays you performance fees.')
          ),
          $node(style({ fontSize: text.xs, textTransform: 'uppercase', letterSpacing: '0.14em', color: palette.primary }))(
            $text('No seed phrase · You keep your keys · Agents welcome')
          )
        ),
        $HelloPage(config)({
          changeDraft: changeDraftTether(),
          deriveAccount: deriveAccountTether()
        })
      ),
      { changeDraft, deriveAccount }
    ]
  )
