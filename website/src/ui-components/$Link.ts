import { empty, type IStream, map } from 'aelea/stream'
import { type I$Slottable, type IStyleCSS, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Link as $aeleaLink, $defaultAnchor, type I$Link as I$AeleaLink } from 'aelea/ui-router'

export interface I$Link extends Omit<I$AeleaLink, '$anchor' | '$content'> {
  $content: I$Slottable
  disabled?: IStream<boolean>
}

const $defaultLinkAnchor = $defaultAnchor(
  style({ flexShrink: 0, minWidth: 0, color: palette.message, textDecoration: 'none' })
)

const disabledStyle = (disabled: IStream<boolean>) =>
  styleBehavior(map((d): IStyleCSS | null => (d ? { pointerEvents: 'none', opacity: 0.3 } : null), disabled))

export const $Link = ({ disabled = empty, $content, ...rest }: I$Link) =>
  $aeleaLink({ ...rest, $content, $anchor: $defaultLinkAnchor(disabledStyle(disabled)) })

const $underlineAnchor = $defaultLinkAnchor(
  style({ color: palette.message, textDecoration: 'underline', minWidth: 0, textDecorationColor: palette.primary }),
  stylePseudo(':hover', { color: colorShade(palette.primary, 50) })
)

export const $anchorLink = ({ disabled = empty, $content, ...rest }: I$Link) =>
  $aeleaLink({ ...rest, $content, $anchor: $underlineAnchor(disabledStyle(disabled)) })({})
