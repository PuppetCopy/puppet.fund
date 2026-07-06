import { Renderer } from '@takumi-rs/core'
import { renderToImage } from 'aelea/takumi'
import { $brand, $fund, $leaderboard, $page, HEIGHT, WIDTH } from './$views.js'
import fontAsset from './assets/Geist-Variable.woff2' with { type: 'file' }
import logoAsset from './assets/logo.png' with { type: 'file' }
import { fetchFundCard, fetchTopFunds, short } from './data.js'

const port = Number(Bun.env.PORT)
if (!Number.isInteger(port)) throw new Error('PORT is required')

const [fontData, logoData] = await Promise.all([Bun.file(fontAsset).bytes(), Bun.file(logoAsset).bytes()])

const renderer = new Renderer()
renderer.loadFontSync({ name: 'Geist', data: fontData })
await renderer.putPersistentImage({ src: 'logo', data: logoData })

const isHexAddress = (s: string): s is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(s)

const STATIC_CACHE = 'public, max-age=86400, s-maxage=86400'
const LEADERBOARD_CACHE = 'public, max-age=3600, s-maxage=3600'
const FUND_CACHE = 'public, max-age=300, s-maxage=300'

const png = async (node: Parameters<typeof renderToImage>[0], cacheControl = STATIC_CACHE) => {
  const bytes = await renderToImage(node, { width: WIDTH, height: HEIGHT, format: 'png', renderer })
  return new Response(bytes as BlobPart, {
    headers: {
      'content-type': 'image/png',
      'cache-control': cacheControl
    }
  })
}

const leaderboardCard = async () => {
  try {
    const rows = await fetchTopFunds(5)
    if (rows.length > 0) return $leaderboard(rows)
  } catch (err) {
    console.error('leaderboard og fetch failed', err)
  }
  return $page('Leaderboard', 'Top funds ranked by performance', '/leaderboard')
}

const fundCard = async (address: `0x${string}`) => {
  try {
    const card = await fetchFundCard(address)
    if (card) return $fund(card)
  } catch (err) {
    console.error('fund og fetch failed', err)
  }
  return $page('Fund', short(address), `/fund/${short(address)}`)
}

Bun.serve({
  port,
  routes: {
    '/health': () => new Response('ok'),

    '/og': () => png($brand),

    '/og/leaderboard': async () => png(await leaderboardCard(), LEADERBOARD_CACHE),

    '/og/portfolio': () => png($page('Portfolio', 'Your accounts, balances and allocations', '/portfolio')),

    '/og/fund/:address': async req => {
      const { address } = req.params
      if (!isHexAddress(address)) return new Response('invalid address', { status: 400 })
      return png(await fundCard(address), FUND_CACHE)
    }
  },
  fetch: () => new Response('not found', { status: 404 })
})

console.log(`OG service listening on :${port}`)
