import { SYMBOL_MAX_LENGTH, SYMBOL_MIN_LENGTH, SYMBOL_PATTERN } from '@puppet/sdk/account'
import { type ICells, randomCells, randomSymbol } from '@puppet/sdk/ui-components'
import { combine, empty, type IStream, just, map, merge, op, sample, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $defaultInputContainer, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $FieldLabeled, $icon, $infoTooltip, $pen, text } from '@/ui-components'
import { $fundAvatar } from '../../common/$fundAvatar.js'
import { $AvatarEditor } from './$AvatarEditor.js'

export interface IFundIdentity {
  symbol: string
  cells: ICells
}

export const $FundIdentityEditor = (held: IFundIdentity | null) =>
  component(
    (
      [changeSymbol, changeSymbolTether]: IBehavior<string>,
      [changeCells, changeCellsTether]: IBehavior<ICells>,
      [changeDraft, changeDraftTether]: IBehavior<ICells>,
      [closeEditor, closeEditorTether]: IBehavior<unknown>,
      [openEditor, openEditorTether]: IBehavior<INode<HTMLElement>, PointerEvent>
    ) => {
      const symbol: IStream<string> =
        held === null
          ? state(
              '',
              map(raw => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), changeSymbol)
            )
          : just(held.symbol)
      const cells: IStream<ICells> = held === null ? op(just(randomCells()), derived => merge(changeCells, derived), state()) : just(held.cells)
      const preview: IStream<ICells> = op(cells, saved => merge(changeDraft, sample(cells, closeEditor), saved), state())
      const suggested = randomSymbol()

      const $avatarRing = $node(
        style({
          position: 'relative',
          display: 'flex',
          borderRadius: '50%',
          padding: '3px',
          border: `1px solid ${colorShade(palette.foreground, 40)}`
        })
      )
      const $avatar: I$Node =
        held !== null
          ? $avatarRing($fundAvatar(held.cells, 40))
          : $Popover({
              $open: map(() => $AvatarEditor({ cells })({ changeDraft: changeDraftTether(), changeCells: changeCellsTether() }), openEditor),
              dismiss: changeCells,
              $target: $avatarRing(
                attr({ role: 'button', tabindex: '0', 'aria-label': 'Edit fund avatar' }),
                style({ cursor: 'pointer' }),
                stylePseudo(':hover', { borderColor: palette.primary }),
                openEditorTether(nodeEvent('click'))
              )(
                switchLatest(map(list => $fundAvatar(list, 40), preview)),
                $node(
                  style({
                    position: 'absolute',
                    right: '-4px',
                    bottom: '-4px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    backgroundColor: palette.background,
                    border: `1px solid ${colorShade(palette.foreground, 40)}`
                  })
                )($icon({ $content: $pen, width: '11px', fill: palette.message }))
              )
            })({ dismiss: closeEditorTether() })

      return [
        $column(spacing.default, style({ width: '100%', maxWidth: '460px' }))(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
              $text(held === null ? 'Name and avatar are written on chain with your first round.' : 'Your fund key is created, so its name and avatar are set.')
            ),
            $infoTooltip(
              held === null
                ? 'Your fund trades on its own key, held half in this browser and half by the key service. Nothing is created until you submit your first round, and once it is on chain the name and avatar cannot change.'
                : 'Your fund trades on its own key, held half in this browser and half by the key service. The name and avatar were fixed when the key was created and are written on chain with your first round.'
            )
          ),
          $row(spacing.default, style({ alignItems: 'flex-start', width: '100%' }))(
            $avatar,
            $node(style({ flex: '1', minWidth: '0' }))(
              held !== null
                ? $FieldLabeled({
                    label: 'Name',
                    labelWidth: 52,
                    value: symbol,
                    $input: $defaultInputContainer(attr({ readonly: '' }), style({ cursor: 'default' }))
                  })({})
                : $FieldLabeled({
                    label: 'Name',
                    labelWidth: 52,
                    placeholder: suggested,
                    hint: 'Customize the avatar and name',
                    maxLength: SYMBOL_MAX_LENGTH,
                    value: symbol,
                    validation: map(s => (s === '' || SYMBOL_PATTERN.test(s) ? null : `Use ${SYMBOL_MIN_LENGTH} to ${SYMBOL_MAX_LENGTH} characters of A-Z and 0-9`), symbol)
                  })({ change: changeSymbolTether() })
            )
          )
        ),
        { changeIdentity: held === null ? combine({ symbol: map(typed => (typed === '' ? suggested : typed), symbol), cells }) : empty }
      ]
    }
  )
