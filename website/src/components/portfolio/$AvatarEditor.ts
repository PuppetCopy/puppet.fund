import { GRID, type ICells, PALETTE, randomCells } from '@puppet/sdk/ui-components'
import { awaitPromises, constant, empty, filter, filterNull, type IStream, map, merge, op, reduce, sample, sampleMap, skipRepeats, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
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

const SWATCH = 40
const SWATCH_STEP = 30
const ARC_SPREAD = (80 * Math.PI) / 180
const ARC_RADIUS = ((PALETTE.length - 1) * SWATCH_STEP) / (2 * ARC_SPREAD)
const ARC_WIDTH = 2 * ARC_RADIUS * Math.sin(ARC_SPREAD) + SWATCH
const ARC_DEPTH = ARC_RADIUS * (1 - Math.cos(ARC_SPREAD))
const ARC_SLOTS = PALETTE.map((_, i) => {
  const angle = Math.PI / 2 + ARC_SPREAD - (2 * ARC_SPREAD * i) / (PALETTE.length - 1)
  return { left: ARC_WIDTH / 2 + ARC_RADIUS * Math.cos(angle) - SWATCH / 2, top: ARC_RADIUS * (Math.sin(angle) - Math.cos(ARC_SPREAD)) }
})

export interface I$AvatarEditor {
  cells: IStream<ICells>
  size?: number
}

type IStroke = { kind: 'press' | 'enter' | 'release'; index: number }

interface ICanvas {
  cells: ICells
  history: readonly (readonly string[])[]
  gesture: { index: number; painted: boolean; moved: boolean } | null
}

const blankCanvas = (cells: ICells): ICanvas => ({ cells, history: cells.map(() => []), gesture: null })

const applyStroke = (canvas: ICanvas, stroke: IStroke & { colour: string }): ICanvas => {
  const at = stroke.index
  if (stroke.kind === 'release') {
    const gesture = canvas.gesture
    const stack = canvas.history[at]!
    if (gesture === null || gesture.index !== at || gesture.moved || gesture.painted || canvas.cells[at] !== stroke.colour || stack.length === 0) {
      return { ...canvas, gesture: null }
    }
    return {
      cells: canvas.cells.map((c, i) => (i === at ? stack[stack.length - 1]! : c)),
      history: canvas.history.map((s, i) => (i === at ? s.slice(0, -1) : s)),
      gesture: null
    }
  }
  const painted = canvas.cells[at] !== stroke.colour
  const cells = painted ? canvas.cells.map((c, i) => (i === at ? stroke.colour : c)) : canvas.cells
  const history = painted ? canvas.history.map((s, i) => (i === at ? [...s, canvas.cells[at]!] : s)) : canvas.history
  if (stroke.kind === 'press') return { cells, history, gesture: { index: at, painted, moved: false } }
  return { cells, history, gesture: canvas.gesture === null ? null : { ...canvas.gesture, moved: canvas.gesture.moved || at !== canvas.gesture.index } }
}

export const $AvatarEditor = ({ cells, size = 256 }: I$AvatarEditor) =>
  component(
    (
      [stroke, strokeTether]: IBehavior<INode<HTMLElement>, IStroke>,
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

      const edits: IStream<(canvas: ICanvas) => ICanvas> = merge(
        sampleMap((colour, each: IStroke) => (canvas: ICanvas) => applyStroke(canvas, { ...each, colour }), brush, stroke),
        map(() => () => blankCanvas(randomCells()), shuffle),
        map((next: ICells) => () => blankCanvas(next), uploaded)
      )
      const draft: IStream<ICells> = op(
        cells,
        switchMap(seed => reduce((canvas: ICanvas, edit) => edit(canvas), blankCanvas(seed), edits)),
        map(canvas => canvas.cells),
        skipRepeats,
        state()
      )

      const $swatch = (colour: string, i: number): I$Node =>
        $node(
          style({
            position: 'absolute',
            left: `${ARC_SLOTS[i]!.left}px`,
            top: `${ARC_SLOTS[i]!.top}px`,
            width: `${SWATCH}px`,
            height: `${SWATCH}px`,
            padding: '6px',
            boxSizing: 'border-box',
            flexShrink: '0',
            borderRadius: '50%',
            backgroundColor: palette.middleground,
            pointerEvents: 'none',
            transition: 'transform 120ms ease-out, box-shadow 120ms ease-out'
          }),
          stylePseudo(':hover', { transform: 'scale(1.08)', zIndex: '2' }),
          styleBehavior(map(active => (active === colour ? { transform: 'scale(1.12)', zIndex: '1', boxShadow: `0 0 12px 2px ${colorShade(palette.message, 45)}` } : null), brush))
        )(
          $node(
            style({
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              backgroundColor: colour,
              boxShadow: `inset 0 0 0 1px ${colorShade(palette.foreground, 25)}`,
              cursor: 'pointer',
              pointerEvents: 'auto'
            }),
            pickColourTether(nodeEvent('pointerdown'), constant(colour))
          )()
        )

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
                strokeTether(nodeEvent('pointerdown'), constant<IStroke>({ kind: 'press', index: i })),
                strokeTether(nodeEvent('pointerenter'), filter((e: PointerEvent) => e.buttons === 1), constant<IStroke>({ kind: 'enter', index: i })),
                strokeTether(nodeEvent('pointerup'), constant<IStroke>({ kind: 'release', index: i }))
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
        $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $upload, width: '14px' }), $text('Image')),
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
          switchLatest(map($grid, draft)),
          $node(style({ position: 'relative', width: `${ARC_WIDTH}px`, height: `${ARC_DEPTH + SWATCH}px`, flexShrink: '0' }))(
            $column(spacing.small, style({ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', alignItems: 'center', whiteSpace: 'nowrap' }))(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $dice, width: '14px' }), $text('Shuffle'))
                })({ click: shuffleTether() }),
                $useImage
              ),
              $row(spacing.small, style({ alignItems: 'center' }))(
                $infoTooltip(
                  'Draw on the grid or use an image, which never leaves this browser. The avatar is fixed once the fund opens.'
                ),
                $ButtonPrimaryOutline({ $container: $defaultMiniButtonPrimary, $content: $text('Save') })({ click: clickSaveTether() })
              )
            ),
            ...PALETTE.map($swatch)
          ),
          switchLatest(
            map(
              message =>
                message === null
                  ? empty
                  : $node(style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.4', maxWidth: `${size}px` }))($text(message)),
              failed
            )
          )
        ),
        { changeDraft: draft, changeCells: sample(draft, clickSave) }
      ]
    }
  )
