import { applyTheme, readDomTheme } from 'aelea/ui-components-theme-browser'
import { render } from 'aelea/ui-renderer-dom'
import { $Main } from './pages/$Main.js'

const { themeList, theme } = readDomTheme()
applyTheme(themeList, theme)

render({
  rootAttachment: document.querySelector('html')!,
  $rootNode: $Main({})({})
})
