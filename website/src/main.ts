import { applyTheme, readDomTheme } from 'aelea/ui-components-theme-browser'
import { render } from 'aelea/ui-renderer-dom'
import { href, pushUrl, replaceUrl } from 'aelea/ui-router'
import { uiStorage } from '@/ui-storage'
import { markBooted } from './app/release.js'
import { routeSchema, walletPaths } from './app/routeSchema.js'
import { $Main } from './pages/$Main.js'
import { APP_KEY, askPersistentStorage, displayMode, installed, promptInstallApp } from './utils/pwaInstall.js'

void uiStorage.dropStaleDevice().catch(uiStorage.reportFailure)

if (location.pathname === href(routeSchema.portfolio) && new URLSearchParams(location.search).get('tab') === 'master') history.replaceState(null, '', href(routeSchema.wallet))
if (location.pathname === '/agent') history.replaceState(null, '', `${href(routeSchema.wallet.agent)}${location.search}${location.hash}`)

const listed = (pathname: string): boolean => walletPaths.includes(pathname)
const linkOf = (event: MouseEvent): URL | null => {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (anchor === null || !anchor.hasAttribute('href') || anchor.target === '_blank') return null
  const url = new URL(anchor.href)
  return url.origin === location.origin ? url : null
}
const pathOf = (url: URL): string => `${url.pathname}${url.search}${url.hash}`

if (installed()) askPersistentStorage()
if (installed() && !listed(location.pathname)) history.replaceState(null, '', href(routeSchema.wallet))
displayMode.addEventListener('change', () => {
  if (installed() && !listed(location.pathname)) replaceUrl(href(routeSchema.wallet))
})
const launchQueue = (window as Window & { launchQueue?: { setConsumer(consumer: (params: { targetURL?: string }) => void): void } }).launchQueue
launchQueue?.setConsumer(params => {
  const target = params.targetURL === undefined ? null : new URL(params.targetURL)
  if (target !== null && listed(target.pathname) && pathOf(target) !== pathOf(new URL(location.href))) pushUrl(pathOf(target))
})

document.addEventListener(
  'click',
  event => {
    const url = linkOf(event)
    if (url === null) return
    if (installed()) {
      if (listed(url.pathname)) return
      event.preventDefault()
      event.stopPropagation()
      window.open(url.href, '_blank', 'noopener')
      return
    }
    if (!listed(url.pathname) || listed(location.pathname) || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (localStorage.getItem(APP_KEY) === 'browser') {
      window.open(url.href, '_blank', 'noopener')
      return
    }
    void promptInstallApp().then(
      outcome => {
        if (outcome === 'dismissed') pushUrl(pathOf(url))
        else if (outcome === null) window.open(url.href, '_blank', 'noopener')
      },
      () => window.open(url.href, '_blank', 'noopener')
    )
  },
  true
)

const { themeList, theme } = readDomTheme()
applyTheme(themeList, theme)
for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', theme.palette.horizon)
for (const meta of document.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]')) meta.setAttribute('content', theme.name.includes('dark') ? 'black' : 'default')

render({
  rootAttachment: document.querySelector('html')!,
  $rootNode: $Main({})({})
})

markBooted()
