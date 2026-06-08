import { empty, type IStream, map, nowWith } from 'aelea/stream'
import {
  $element,
  attr,
  effectProp,
  type I$Slottable,
  type INodeCompose,
  type IStyleCSS,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $Link as $aeleaLink,
  $defaultAnchor,
  href,
  type I$Link as I$AeleaLink,
  type ParamsOf,
  pushUrl,
  type RouteNode,
  type RouteSpec
} from 'aelea/ui-router'

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

export interface I$NavLink<T extends RouteSpec> {
  route: RouteNode<T>
  params?: ParamsOf<T>
  $content: I$Slottable
  $anchor?: INodeCompose<HTMLAnchorElement>
}

const $plainAnchor = $element('a')(style({ color: 'inherit', textDecoration: 'none', cursor: 'pointer', minWidth: 0 }))

export const $navLink = <T extends RouteSpec>({
  route,
  params,
  $content,
  $anchor = $plainAnchor
}: I$NavLink<T>): I$Slottable => {
  const url = href(route, params)
  return $anchor(
    attr({ href: url }),
    effectProp(
      'onclick',
      nowWith(() => (ev: MouseEvent) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
        ev.preventDefault()
        pushUrl(url)
      })
    )
  )($content)
}
