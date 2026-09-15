import { readableAddress } from '@puppet/sdk/core'
import { Renderer } from '@takumi-rs/core'
import { renderToImage } from 'aelea/takumi'
import { getAddress, isAddress } from 'viem'
import { $brand, $master, $masters, $page, HEIGHT, WIDTH } from './$views.js'
import fontAsset from './assets/InterVariable.woff2' with { type: 'file' }
import logoAsset from './assets/logo.png' with { type: 'file' }
import { fetchMasterCard, fetchTopMasters } from './data.js'

const port = Number(Bun.env.PORT)
if (!Number.isInteger(port) || port <= 0) throw new Error('PORT is required')

const [fontData, logoData] = await Promise.all([Bun.file(fontAsset).bytes(), Bun.file(logoAsset).bytes()])

const renderer = new Renderer()
await renderer.registerFont({ name: 'Inter', data: fontData })
const images = [{ src: 'logo', data: logoData }]

const STATIC_CACHE = 'public, max-age=86400, s-maxage=86400'
const LIST_CACHE = 'public, max-age=3600, s-maxage=3600'
const MASTER_CACHE = 'public, max-age=300, s-maxage=300'

const png = async (node: Parameters<typeof renderToImage>[0], cacheControl: string) => {
  const bytes = await renderToImage(node, { width: WIDTH, height: HEIGHT, format: 'png', renderer, images })
  return new Response(bytes as BlobPart, { headers: { 'content-type': 'image/png', 'cache-control': cacheControl } })
}

const mastersCard = async () => {
  try {
    const rows = await fetchTopMasters(5)
    if (rows.length > 0) return $masters(rows)
  } catch (err) {
    console.error('masters og fetch failed', err)
  }
  return $page('Masters', 'Masters trade their own book, puppets back it', '/masters')
}

const masterCard = async (address: `0x${string}`) => {
  try {
    const card = await fetchMasterCard(address)
    if (card) return $master(card)
  } catch (err) {
    console.error('master og fetch failed', err)
  }
  return $page('Master', readableAddress(address), `/masters/${readableAddress(address)}`)
}

const server = Bun.serve({
  port,
  idleTimeout: 30,
  routes: {
    '/health': new Response('ok'),
    '/og': await png($brand, STATIC_CACHE),
    '/og/masters': async () => png(await mastersCard(), LIST_CACHE),
    '/og/portfolio': await png($page('Portfolio', 'Your account, balances, backing and books', '/portfolio'), STATIC_CACHE),
    '/og/masters/:master': async req => {
      const { master } = req.params
      if (!isAddress(master)) return new Response('invalid master', { status: 400 })
      return png(await masterCard(getAddress(master)), MASTER_CACHE)
    }
  }
})

process.on('SIGTERM', () => server.stop().then(() => process.exit(0)))

console.log(`OG service listening on :${server.port}`)
