import { SYMBOL_MAX_LENGTH } from '@puppet/sdk/account'
import type { ICells } from '@puppet/sdk/ui-components'
import { type IStream, map, merge, op, sample, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, attr, component, type I$Node, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $defaultInputContainer, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $FieldLabeled, $icon, $pen } from '@/ui-components'
import { $fundAvatar } from '../../common/$fundAvatar.js'
import { $AvatarEditor } from './$AvatarEditor.js'

export interface IFundIdentity {
  symbol: string
  cells: ICells
}

export const $FundIdentityEditor = (typed: IStream<string>, chosen: IStream<ICells>, suggested: string, hint: I$Node, closed: IStream<unknown>) =>
  component(
    (
      [changeSymbol, changeSymbolTether]: IBehavior<string>,
      [changeCells, changeCellsTether]: IBehavior<ICells>,
      [changeDraft, changeDraftTether]: IBehavior<ICells>,
      [openEditor, openEditorTether]: IBehavior<INode<HTMLElement>, PointerEvent>
    ) => {
      const preview: IStream<ICells> = op(chosen, saved => merge(changeDraft, sample(chosen, closed), saved), state())

      return [
        $row(spacing.default, style({ alignItems: 'center', flex: '0 1 auto', minWidth: '0' }))(
          $node(
            attr({ role: 'button', tabindex: '0', 'aria-label': 'Edit avatar' }),
            style({
              position: 'relative',
              display: 'flex',
              borderRadius: '50%',
              padding: '5px',
              border: `1px solid ${colorShade(palette.foreground, 40)}`,
              cursor: 'pointer'
            }),
            stylePseudo(':hover', { borderColor: palette.primary }),
            openEditorTether(nodeEvent('click'))
          )(
            switchLatest(map(list => $fundAvatar(list, 64), preview)),
            $node(
              style({
                position: 'absolute',
                right: '0',
                bottom: '0',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                backgroundColor: palette.background,
                border: `1px solid ${colorShade(palette.foreground, 40)}`,
                boxShadow: '0 2px 6px #00000066'
              })
            )($icon({ $content: $pen, width: '14px', fill: palette.message }))
          ),
          $node(style({ flex: '0 1 auto', minWidth: '0' }))(
            $FieldLabeled({
              label: null,
              hint,
              placeholder: suggested,
              maxLength: SYMBOL_MAX_LENGTH,
              $input: $defaultInputContainer(attr({ size: String(SYMBOL_MAX_LENGTH) }), style({ minWidth: '12ch' })),
              value: typed
            })({ change: changeSymbolTether(map(raw => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SYMBOL_MAX_LENGTH))) })
          )
        ),
        {
          changeSymbol,
          changeCells,
          openAvatar: map(() => $AvatarEditor({ cells: chosen })({ changeDraft: changeDraftTether(), changeCells: changeCellsTether() }), openEditor)
        }
      ]
    }
  )
