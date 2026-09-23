import { GRID, type ICells, PALETTE, randomCells } from '@puppet/sdk/ui-components'
import { awaitPromises, constant, filter, filterNull, type IStream, map, merge, op, reduce, sample, sampleMap, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $ButtonPrimaryOutline,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $defaultMiniLabelSecondary,
  $dice,
  $icon,
  $infoTooltip,
  $upload,
  keyActivate,
  text
} from '@/ui-components'
import { cellsFromImage } from '../../common/avatarCells.js'

export interface I$AvatarEditor {
  cells: IStream<ICells>
  size?: number
}

export const $AvatarEditor = ({ cells, size = 256 }: I$AvatarEditor) =>
  component(
    (
      [paint, paintTether]: IBehavior<INode<HTMLElement>, number>,
      [pickColour, pickColourTether]: IBehavior<INode<HTMLElement>, string>,
      [shuffle, shuffleTether]: IBehavior<PointerEvent>,
      [chooseFile, chooseFileTether]: IBehavior<INode<HTMLInputElement>, File>,
      [clickSave, clickSaveTether]: IBehavior<PointerEvent>
    ) => {
      const brush: IStream<string> = state(PALETTE[1]!, pickColour)

      const settled: IStream<{ cells: string[] } | { failed: string }> = op(
        map(
          (file: File) =>
            cellsFromImage(file).then(
              cells => ({ cells }),
              (err: unknown) => ({ failed: err instanceof Error ? err.message : String(err) })
            ),
          chooseFile
        ),
        awaitPromises,
        multicast
      )
      const uploaded: IStream<string[]> = filterNull(map(s => ('cells' in s ? s.cells : null), settled))
      const failed: IStream<string | null> = state(null, map(s => ('failed' in s ? s.failed : null), settled))

      const edits: IStream<(list: ICells) => ICells> = merge(
        sampleMap((colour, index: number) => (list: ICells) => list.map((c, i) => (i === index ? colour : c)), brush, paint),
        map(() => () => randomCells(), shuffle),
        map((next: ICells) => () => next, uploaded)
      )
      const draft: IStream<ICells> = op(
        cells,
        switchMap(seed => reduce((list: ICells, edit) => edit(list), seed, edits)),
        state()
      )

      const $swatch = (colour: string): I$Node =>
        $node(
          style({ width: '19px', height: '19px', flexShrink: '0', borderRadius: '5px', cursor: 'pointer', backgroundColor: colour, border: `1px solid ${colorShade(palette.foreground, 25)}` }),
          styleBehavior(map(active => (active === colour ? { outline: `2px solid ${palette.primary}`, outlineOffset: '1px' } : null), brush)),
          pickColourTether(nodeEvent('pointerdown'), constant(colour))
        )()

      const $grid = (list: ICells): I$Node =>
        $node(style({ position: 'relative', width: `${size}px`, height: `${size}px`, flexShrink: '0' }))(
          $node(
            style({
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID}, 1fr)`,
              width: '100%',
              height: '100%',
              borderRadius: '6px',
              overflow: 'hidden',
              cursor: 'crosshair'
            })
          )(
            ...list.map((colour, i) =>
              $node(
                style({ backgroundColor: colour }),
                paintTether(nodeEvent('pointerdown'), constant(i)),
                paintTether(nodeEvent('pointerenter'), filter((e: PointerEvent) => e.buttons === 1), constant(i))
              )()
            )
          ),
          $node(
            style({
              position: 'absolute',
              inset: '0',
              pointerEvents: 'none',
              borderRadius: '6px',
              background: 'radial-gradient(circle closest-side, transparent 99.5%, rgba(0,0,0,0.45) 100%)'
            })
          )(
            $node(
              style({
                position: 'absolute',
                inset: '0',
                borderRadius: '50%',
                border: `1px dashed ${palette.message}`,
                opacity: '0.5'
              })
            )()
          )
        )

      const $useImage: I$Node = $defaultMiniLabelSecondary(attr({ role: 'button', tabindex: '0' }), keyActivate())(
        $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $upload, width: '14px' }), $text('Use an image')),
        $element('input')(
          attr({ type: 'file', accept: 'image/*' }),
          style({ display: 'none' }),
          chooseFileTether(
            nodeEvent('change'),
            map((event: Event) => (event.currentTarget as HTMLInputElement).files?.[0] ?? null),
            filterNull
          )
        )()
      )

      return [
        $column(spacing.default, style({ alignItems: 'center' }))(
          $row(spacing.small, style({ alignItems: 'center', justifyContent: 'center' }))(
            $ButtonSecondary({
              $container: $defaultMiniButtonSecondary,
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $dice, width: '14px' }), $text('Shuffle'))
            })({ click: shuffleTether() }),
            $useImage
          ),
          switchLatest(map($grid, draft)),
          $row(style({ alignItems: 'center', justifyContent: 'space-between', width: `${size}px` }))(...PALETTE.map($swatch)),
          $row(spacing.small, style({ alignItems: 'center', width: '100%', maxWidth: `${size}px` }))(
            switchLatest(
              map(
                message =>
                  message === null
                    ? $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0', flex: '1' }))(
                        $node(style({ fontSize: text.xs, color: palette.foreground }))($text('Drag to draw')),
                        $infoTooltip(
                          `Draw with the ${PALETTE.length} colours, or use an image: it is read in this browser only and never uploaded. The avatar is fixed once the fund opens.`
                        )
                      )
                    : $node(style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.4', minWidth: '0', flex: '1' }))($text(message)),
                failed
              )
            ),
            $ButtonPrimaryOutline({ $container: $defaultMiniButtonPrimary, $content: $text('Save') })({ click: clickSaveTether() })
          )
        ),
        { changeDraft: draft, changeCells: sample(draft, clickSave) }
      ]
    }
  )
