import { empty } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $element,
  component,
  type I$Node,
  type I$Slottable,
  type INode,
  type INodeCompose,type IStyleCSS, 
  nodeEvent,
  style,
  stylePseudo 
} from 'aelea/ui'
import {
  $ButtonToggle as $AeleaButtonToggle,
  $Button,
  $ButtonIcon,
  $defaultButtonContainer,
  $defaultButtonToggleBtn,
  $defaultButtonToggleContainer,
  type Control,
  type I$Button,
  type I$ButtonToggle
} from 'aelea/ui-components'
import { colorShade, interaction, palette, text } from 'aelea/ui-components-theme'
import { $icon } from '../$common.js'

export const $defaultToggleButton = $defaultButtonToggleBtn(
  style({
    fontSize: text.xs,
    fontWeight: 'bold'
  }),
  stylePseudo('[aria-pressed="true"]', {
    boxShadow: `0px 0px 0 1px color-mix(in srgb, ${palette.foreground} 30%, transparent) inset !important`,
    color: palette.message
  })
)

const $buttonContainer = $defaultButtonToggleContainer(
  style({
    backgroundColor: palette.background
  })
)

export const $ButtonToggle = <T>(config: I$ButtonToggle<T>) =>
  $AeleaButtonToggle({ $button: $defaultToggleButton, $container: $buttonContainer, ...config })

export const $defaultButtonPrimary = $defaultButtonContainer(
  style({
    color: 'white',
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

export const engagedSecondary: IStyleCSS = { borderColor: palette.foreground, borderWidth: '1px', filter: interaction.hoverFilter }

export const $defaultButtonSecondary = $defaultButtonContainer(
  secondaryButtonStyle,
  stylePseudo(':hover', { borderColor: palette.foreground, borderWidth: '1px' }),
  stylePseudo('[aria-expanded="true"]', engagedSecondary)
)

const miniSecondaryStyle = style({
  alignSelf: 'center',
  borderWidth: '1px',
  height: '28px',
  padding: '0 10px',
  fontSize: text.xs,
  borderColor: colorShade(palette.foreground, 35)
})

export const $defaultMiniButtonSecondary = $defaultButtonSecondary(miniSecondaryStyle)

export const $defaultMiniLabelSecondary = $element('label')(
  style({ fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', boxSizing: 'border-box' }),
  secondaryButtonStyle,
  miniSecondaryStyle,
  stylePseudo(':hover', { borderColor: palette.foreground, borderWidth: '1px', filter: interaction.hoverFilter }),
  stylePseudo(':focus-visible', engagedSecondary)
)

export const $defaultButtonPrimaryOutline = $defaultButtonPrimary(
  style({
    backgroundColor: 'transparent',
    border: '1px solid',
    borderColor: palette.message,
    color: palette.message,
    fill: palette.message
  }),
  stylePseudo(':hover', { borderColor: palette.primary }),
  stylePseudo('[aria-expanded="true"]', { borderColor: palette.primary, filter: interaction.hoverFilter })
)

export const $defaultMiniButtonPrimary = $defaultButtonPrimaryOutline(
  style({
    alignSelf: 'center',
    height: '28px',
    padding: '0 10px',
    fontSize: text.xs
  })
)

export const $ButtonPrimary = (config: I$Button) => $keyboardOperableButton($defaultButtonPrimary, config)

export const $ButtonPrimaryOutline = (config: I$Button) => $keyboardOperableButton($defaultButtonPrimaryOutline, config)

export const $ButtonSecondary = (config: I$Button) => $keyboardOperableButton($defaultButtonSecondary, config)

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
  stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 50) }),
  stylePseudo('[aria-expanded="true"]', { borderColor: colorShade(palette.foreground, 50), filter: interaction.hoverFilter })
)

const $clickSurfacingButton = (
  $render: (bindClick: (container: INodeCompose<HTMLButtonElement>) => INodeCompose<HTMLButtonElement>) => I$Slottable
) =>
  component(([click, clickTether]: IBehavior<INode<HTMLButtonElement>, PointerEvent>) => [
    $render((container) => container(clickTether(nodeEvent('click')))),
    { click }
  ])

export const $ButtonCircular = ({
  $iconPath,
  disabled = empty,
  $container = $defaultButtonCircularContainer
}: I$ButtonCircular) =>
  $clickSurfacingButton((bindClick) =>
    $ButtonIcon({
      $container: bindClick($container),
      disabled,
      $content: $icon({ $content: $iconPath, viewBox: '0 0 32 32' })
    })({})
  )

const $keyboardOperableButton = (
  $defaultContainer: INodeCompose<HTMLButtonElement>,
  { $container = $defaultContainer, ...config }: I$Button
) =>
  $clickSurfacingButton((bindClick) =>
    $Button({
      $container: bindClick($container),
      ...config
    })({})
  )
