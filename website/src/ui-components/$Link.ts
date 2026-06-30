import { empty, type IStream, map, nowWith } from 'aelea/stream'
import {
  $element,
  attr,
  effectProp,
  type I$Slottable,
  type INodeCompose,
  type IStyleCSS,
  style,
  styleBehavior
} from 'aelea/ui'
import { palette } from 'aelea/ui-components-theme'
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
  $anchor?: INodeCompose<HTMLAnchorElement>
}

export const $defaultLinkAnchor = $defaultAnchor(
  style({ flexShrink: 0, minWidth: 0, color: palette.message, textDecoration: 'none' })
)

const disabledStyle = (disabled: IStream<boolean>) =>
  styleBehavior(map((d): IStyleCSS | null => (d ? { pointerEvents: 'none', opacity: 0.3 } : null), disabled))

export const $Link = ({ disabled = empty, $content, $anchor = $defaultLinkAnchor, ...rest }: I$Link) =>
  $aeleaLink({ ...rest, $content, $anchor: $anchor(disabledStyle(disabled)) })

export interface I$NavLink<T extends RouteSpec> {
  route: RouteNode<T>
  params?: ParamsOf<T>
  // Optional query string appended to the resolved path (e.g. { action: 'deposit-USDC' } -> ?action=deposit-USDC), for
  // deep links that carry an intent the target page reads on arrival.
  query?: Record<string, string>
  $content: I$Slottable
  $anchor?: INodeCompose<HTMLAnchorElement>
}

const $plainAnchor = $element('a')(style({ color: 'inherit', textDecoration: 'none', cursor: 'pointer', minWidth: 0 }))

export const softNavClick = (url: string, after?: () => void) =>
  effectProp(
    'onclick',
    nowWith(() => (ev: MouseEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
      ev.preventDefault()
      pushUrl(url)
      after?.()
    })
  )

export const $navLink = <T extends RouteSpec>({
  route,
  params,
  query,
  $content,
  $anchor = $plainAnchor
}: I$NavLink<T>): I$Slottable => {
  const url = href(route, params) + (query ? `?${new URLSearchParams(query)}` : '')
  return $anchor(attr({ href: url }), softNavClick(url))($content)
}
