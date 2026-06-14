import { empty, type IStream, just, map, o, start, switchMap, toStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  attrBehavior,
  component,
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
    paddingRight: '4px',
    alignSelf: 'flex-end',
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
  label: string | null
  // Secondary description displayed below the input: a plain string, a stream of
  // strings, or any slottable node (compose your own $Tooltip there if you want one).
  hint?: string | IStream<string> | I$Node
  placeholder?: string | IStream<string>
  maxLength?: number
  $input?: INodeCompose<HTMLInputElement>
  $container?: INodeCompose<HTMLLabelElement>
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
  $container = $defaultTextFieldContainer
}: I$FieldLabeled) =>
  component(([change, sampleValue]: IBehavior<string, string>) => {
    const validationStream: IStream<string | null> = start(null, validation ?? just(null))

    const $hintText = $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))
    const $hintDisplay: I$Node =
      hint === undefined
        ? empty
        : typeof hint === 'string'
          ? $hintText($text(hint))
          : switchMap(v => (typeof v === 'string' ? $hintText($text(v)) : just(v)), hint as IStream<string | INode>)

    // One shared slot below the input: a validation message REPLACES the hint while
    // present (and restores it when cleared), so the field never jumps in height.
    const $below: I$Node =
      hint === undefined && validation === undefined
        ? empty
        : $row(style({ fontSize: text.sm, minHeight: '1rem', width: '100%', whiteSpace: 'pre-wrap' }))(
            switchMap(v => (v ? $node(style({ color: palette.negative }))($text(v)) : $hintDisplay), validationStream)
          )

    const placeholderStream: IStream<string> = placeholder === undefined ? just('') : toStream(placeholder)
    const $styledInput: INodeCompose<HTMLInputElement> = $input(
      attrBehavior(map(p => ({ placeholder: p }), placeholderStream)),
      inputStyles,
      ...(maxLength === undefined ? [] : [attr({ maxlength: String(maxLength) })])
    )

    const $field = $Input({
      value: value ?? empty,
      $container: $styledInput
    })({
      change: sampleValue()
    })

    return [
      $container(
        label === null
          ? $field
          : $row(spacing.small, style({ width: '100%' }))(
              $labelDisplay(style({ width: labelWidth ? `${labelWidth}px` : '' }))($text(label)),
              $field
            ),
        $below
      ),

      { change }
    ]
  })
