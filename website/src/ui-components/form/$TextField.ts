import { empty, type IStream, just, map, o, start, switchMap, toStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $element, $node, $text, attr, attrBehavior, component, type INodeCompose, style, stylePseudo } from 'aelea/ui'
import { $defaultInputContainer, $Input, $row, type Input, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $icon, $info, $Tooltip, text } from '@/ui-components'
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
  hint?: string | IStream<string>
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
    const hintStream: IStream<string> = hint === undefined ? just('') : toStream(hint)

    const $message = switchMap(v => (v ? $node(style({ color: palette.negative }))($text(v)) : empty), validationStream)

    const $hintTooltip =
      hint === undefined
        ? empty
        : $Tooltip({
            $content: $node(
              style({ maxWidth: '260px', whiteSpace: 'pre-wrap', fontSize: text.sm, color: palette.message })
            )($text(hintStream)),
            $anchor: $icon({
              $content: $info,
              viewBox: '0 0 32 32',
              width: '13px',
              fill: palette.foreground,
              svgOps: style({ cursor: 'help' })
            })
          })({})

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
              $labelDisplay(style({ width: labelWidth ? `${labelWidth}px` : '' }))(
                $row(spacing.small, style({ alignItems: 'center' }))($text(label), $hintTooltip)
              ),
              $field
            ),
        label === null
          ? empty
          : $row(
              style({
                fontSize: text.sm,
                minHeight: '1rem',
                width: '100%',
                whiteSpace: 'pre-wrap',
                position: 'relative'
              })
            )($message)
      ),

      { change }
    ]
  })
