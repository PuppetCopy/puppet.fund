import { empty } from 'aelea/stream'
import { type I$Node, type INodeCompose, style, stylePseudo } from 'aelea/ui'
import {
  $ButtonToggle as $aeleaButtonToggle,
  $Button,
  $ButtonIcon,
  $defaultButtonContainer,
  $defaultButtonToggleBtn,
  type Control,
  type I$Button,
  type I$ButtonToggle
} from 'aelea/ui-components'
import { colorShade, palette, text } from 'aelea/ui-components-theme'
import { $icon } from '../$common.js'

const $buttonToggleBtn = $defaultButtonToggleBtn(
  stylePseudo(':hover', { color: palette.message, backgroundColor: colorShade(palette.foreground, 12) })
)

export const $ButtonToggle = <T>(config: I$ButtonToggle<T>) =>
  $aeleaButtonToggle({ $button: $buttonToggleBtn, ...config })
export const $defaultButtonPrimary = $defaultButtonContainer(
  style({
    color: palette.message,
    whiteSpace: 'nowrap',
    fill: 'white',
    borderRadius: '30px',
    alignSelf: 'flex-end',
    fontSize: text.base,
    height: '48px',
    padding: '0 24px',
    fontWeight: 'bold',
    border: 'none',
    backgroundColor: palette.primary
  })
)

const secondaryButtonStyle = style({
  color: palette.message,
  whiteSpace: 'nowrap',
  fill: 'white',
  borderRadius: '30px',
  borderStyle: 'solid',
  alignSelf: 'flex-start',
  height: '48px',
  fontSize: text.base,
  backgroundColor: palette.background,
  padding: '0 24px',
  fontWeight: 'bold',
  border: '1px solid',
  borderColor: palette.message
})

export const $defaultButtonSecondary = $defaultButtonContainer(
  secondaryButtonStyle,
  stylePseudo(':hover', { borderColor: palette.foreground, borderWidth: '1px' })
)

export const $defaultMiniButtonSecondary = $defaultButtonSecondary(
  style({
    alignSelf: 'center',
    borderWidth: '1px',
    height: '28px',
    padding: '0 10px',
    fontSize: text.xs,
    borderColor: colorShade(palette.foreground, 35)
  })
)

export const $ButtonPrimary = (config: I$Button) => {
  return $Button({
    $container: $defaultButtonPrimary,
    ...config
  })
}

export const $ButtonSecondary = (config: I$Button) => {
  return $Button({
    $container: $defaultButtonSecondary,
    ...config
  })
}

interface I$ButtonCircular extends Control {
  $iconPath: I$Node<SVGPathElement>
  $container?: INodeCompose<HTMLButtonElement>
}

export const $defaultButtonCircularContainer = $defaultButtonContainer(
  style({
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '50%',
    border: `1px solid ${colorShade(palette.foreground, 25)}`,
    width: '32px',
    height: '32px',
    background: 'transparent',
    color: palette.message,
    fill: palette.message,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0'
  }),
  stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 50) })
)

export const $ButtonCircular = ({
  $iconPath,
  disabled = empty,
  $container = $defaultButtonCircularContainer
}: I$ButtonCircular) =>
  $ButtonIcon({
    $container,
    disabled,
    $content: $icon({ $content: $iconPath, viewBox: '0 0 32 32' })
  })
