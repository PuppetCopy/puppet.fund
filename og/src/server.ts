import { Renderer } from '@takumi-rs/core'
import { renderToImage } from 'aelea/takumi'
import { $brand, $leaderboard, $page } from './$views.js'
import fontAsset from './assets/Geist-Variable.woff2' with { type: 'file' }
import logoAsset from './assets/logo.png' with { type: 'file' }
import { fetchTopMasters } from './leaderboard.js'

const port = Number(Bun.env.PORT) || 4100

const [fontData, logoData] = await Promise.all([Bun.file(fontAsset).bytes(), Bun.file(logoAsset).bytes()])

const renderer = new Renderer()
renderer.loadFontSync({ name: 'Geist', data: fontData })
await renderer.putPersistentImage({ src: 'logo', data: logoData })

const SIZE = 1200

const isHexAddress = (s: string): s is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(s)
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

const STATIC_CACHE = 'public, max-age=86400, s-maxage=86400'
const LEADERBOARD_CACHE = 'public, max-age=3600, s-maxage=3600'

const png = async (node: Parameters<typeof renderToImage>[0], cacheControl = STATIC_CACHE) => {
  const bytes = await renderToImage(node, { width: SIZE, height: SIZE, format: 'png', renderer })
  return new Response(bytes as BlobPart, {
    headers: {
      'content-type': 'image/png',
      'cache-control': cacheControl
    }
  })
}

const PAGES: Record<string, { title: string; subtitle: string }> = {
  hello: { title: 'Get Started', subtitle: 'Open a wallet, set your funding rules, start trading' },
  leaderboard: { title: 'Leaderboard', subtitle: 'Top traders ranked by co-attested performance' },
  portfolio: { title: 'Portfolio', subtitle: 'Your accounts, balances and allocations' }
}

const leaderboardCard = async () => {
  try {
    const rows = await fetchTopMasters(5)
    if (rows.length > 0) return $leaderboard(rows)
  } catch (err) {
    console.error('leaderboard og fetch failed', err)
  }
  return $page(PAGES.leaderboard.title, PAGES.leaderboard.subtitle, '/leaderboard')
}

Bun.serve({
  port,
  routes: {
    '/health': () => new Response('ok'),

    '/og': () => png($brand),

    '/og/leaderboard': async () => png(await leaderboardCard(), LEADERBOARD_CACHE),

    '/og/:page': req => {
      const page = PAGES[req.params.page]
      if (!page) return new Response('not found', { status: 404 })
      return png($page(page.title, page.subtitle, `/${req.params.page}`))
    },

    '/og/portfolio/:address': req => {
      const { address } = req.params
      if (!isHexAddress(address)) return new Response('invalid address', { status: 400 })
      return png($page('Portfolio', short(address), '/portfolio'))
    },

    '/og/master/:address': req => {
      const { address } = req.params
      if (!isHexAddress(address)) return new Response('invalid address', { status: 400 })
      return png($page('Master', short(address), '/master'))
    }
  },
  fetch: () => new Response('not found', { status: 404 })
})

console.log(`OG service listening on :${port}`)
