import { empty, type IStream, just, map, o, start, switchMap, toStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  attrBehavior,
  component,
  effectRun,
  type I$Node,
  type INode,
  type INodeCompose,
  style,
  stylePseudo
} from 'aelea/ui'
import { $defaultInputContainer, $Input, $row, type Input, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
export const $defaultTextFieldContainer = $element('label')(
  spacing.small,
  style({
    width: '100%',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    color: palette.foreground
  })
)

export const $labelDisplay = $node(
  style({
    color: palette.foreground,
    paddingRight: '4px',
    alignSelf: 'flex-end',
    minWidth: '92px',
    cursor: 'pointer',
    lineHeight: '48px',
    borderBottom: `2px solid ${colorShade(palette.message, 10)}`
  })
)

const inputStyles = o(
  style({
    backgroundColor: palette.background,
    color: palette.message,
    lineHeight: '48px',
    height: '48px',
    padding: '0 10px'
  }),
  stylePseudo('::placeholder', {
    color: colorShade(palette.foreground, 80)
  })
)

export interface I$FieldLabeled extends Partial<Input<string>> {
  label: string | I$Node | null
  hint?: string | IStream<string> | I$Node
  placeholder?: string | IStream<string>
  maxLength?: number
  $input?: INodeCompose<HTMLInputElement>
  $container?: INodeCompose<HTMLLabelElement>
  $$field?: ($field: I$Node) => I$Node
  labelWidth?: number
}

export const $FieldLabeled = ({
  label,
  placeholder,
  hint,
  labelWidth,
  value,
  maxLength,
  $input = $defaultInputContainer,
  validation,
  $container = $defaultTextFieldContainer,
  $$field
}: I$FieldLabeled) =>
  component(([change, sampleValue]: IBehavior<string, string>) => {
    const validationStream: IStream<string | null> = start(null, validation ?? just(null))

    const $clampLine = (color: string, value: string): I$Node =>
      $node(
        style({
          fontSize: text.xs,
          color,
          lineHeight: '1.5',
          maxWidth: '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }),
        effectRun(el => {
          const node = el as HTMLElement
          const sync = (): void => {
            node.title = node.scrollWidth > node.clientWidth ? value : ''
          }
          sync()
          const observer = new ResizeObserver(sync)
          observer.observe(node)
          return {
            [Symbol.dispose]() {
              observer.disconnect()
            }
          }
        })
      )($text(value))

    const $hintDisplay: I$Node =
      hint === undefined
        ? empty
        : typeof hint === 'string'
          ? $clampLine(palette.foreground, hint)
          : switchMap(
              v => (typeof v === 'string' ? $clampLine(palette.foreground, v) : just(v)),
              hint as IStream<string | INode>
            )

    const $below: I$Node =
      hint === undefined && validation === undefined
        ? empty
        : $node(style({ fontSize: text.xs, lineHeight: '1.5', height: '1.5em', width: '100%', overflow: 'hidden' }))(
            switchMap(v => (v ? $clampLine(palette.negative, v) : $hintDisplay), validationStream)
          )

    const placeholderStream: IStream<string> = placeholder === undefined ? just('') : toStream(placeholder)
    const $styledInput: INodeCompose<HTMLInputElement> = $input(
      attrBehavior(map(p => ({ placeholder: p }), placeholderStream)),
      inputStyles,
      ...(maxLength === undefined ? [] : [attr({ maxlength: String(maxLength) })])
    )

    const $inputField = $Input({
      value: value ?? empty,
      $container: $styledInput
    })({
      change: sampleValue()
    })
    const $field =
      $$field === undefined
        ? $inputField
        : $node(
            style({ display: 'flex', flex: 1, minWidth: '0' }),
            effectRun(el => {
              const node = el as HTMLElement
              const keepLabelIdle = (ev: Event): void => {
                if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault()
              }
              node.addEventListener('click', keepLabelIdle, true)
              return {
                [Symbol.dispose]() {
                  node.removeEventListener('click', keepLabelIdle, true)
                }
              }
            })
          )($$field($inputField))

    return [
      $container(
        label === null
          ? $field
          : $row(spacing.small, style({ width: '100%' }))(
              $labelDisplay(style(labelWidth ? { width: `${labelWidth}px`, minWidth: `${labelWidth}px` } : {}))(
                typeof label === 'string' ? $text(label) : label
              ),
              $field
            ),
        $below
      ),

      { change }
    ]
  })
