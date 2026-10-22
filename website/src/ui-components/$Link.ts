import { empty, type IStream, map, nowWith } from 'aelea/stream'
import { effectProp, type I$Slottable, type INodeCompose, type IStyleCSS, style, styleBehavior } from 'aelea/ui'
import { palette } from 'aelea/ui-components-theme'
import { $Link as $aeleaLink, $defaultAnchor, type I$Link as I$AeleaLink, pushUrl } from 'aelea/ui-router'

export interface I$Link extends Omit<I$AeleaLink, '$anchor' | '$content'> {
  $content: I$Slottable
  disabled?: IStream<boolean>
  $anchor?: INodeCompose<HTMLAnchorElement>
}

export const $defaultLinkAnchor = $defaultAnchor(
  style({ flexShrink: 0, minWidth: 0, color: palette.message })
)

const disabledStyle = (disabled: IStream<boolean>) =>
  styleBehavior(map((d): IStyleCSS | null => (d ? { pointerEvents: 'none', opacity: 0.3 } : null), disabled))

export const $Link = ({ disabled = empty, $content, $anchor = $defaultLinkAnchor, ...rest }: I$Link) =>
  $aeleaLink({ ...rest, $content, $anchor: $anchor(disabledStyle(disabled)) })

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
