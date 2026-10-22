import { type IStream, sampleMap } from 'aelea/stream'
import { $text, component, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette, type Theme, themeList } from 'aelea/ui-components-theme'
import { setTheme } from 'aelea/ui-components-theme-browser'
import { $icon, $sun } from '@/ui-components'

export const $ThemePicker = (theme: IStream<Theme>) =>
  component(([changeTheme, changeThemeTether]: any) => {
    return [
      $row(
        spacing.small,
        style({ cursor: 'pointer', alignItems: 'center' }),
        stylePseudo(':hover', { fill: palette.primary, color: palette.primary }),
        changeThemeTether(
          nodeEvent('click'),
          sampleMap(current => {
            const toIdx = (themeList.findIndex(t => t.name === current.name) + 1) % themeList.length
            const toTheme = themeList[toIdx]

            setTheme(themeList, toTheme)

            window.location.reload()
            return toTheme
          }, theme)
        )
      )(
        $icon({
          svgOps: style({ fill: palette.message }),
          $content: $sun
        }),
        $text('Switch Theme')
      ),

      {
        changeTheme
      }
    ]
  })
