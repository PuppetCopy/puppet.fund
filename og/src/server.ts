import { readableAddress } from '@puppet/sdk/core'
import { Renderer } from '@takumi-rs/core'
import { renderToImage } from 'aelea/takumi'
import { type Address, getAddress, isAddress } from 'viem'
import { $brand, $master, $masters, $page, $puppet, SIZE } from './$views.js'
import fontAsset from './assets/InterVariable.woff2' with { type: 'file' }
import logoAsset from './assets/logo.png' with { type: 'file' }
import { fetchLeaderboard, fetchMasterCard, fetchPuppetCard, LEADERBOARD_WINDOW, TICK_MS } from './data.js'

const port = Number(Bun.env.PORT)
if (!Number.isInteger(port) || port <= 0) throw new Error('PORT is required')

const [fontData, logoData] = await Promise.all([Bun.file(fontAsset).bytes(), Bun.file(logoAsset).bytes()])

const renderer = new Renderer()
await renderer.registerFont({ name: 'Inter', data: fontData })
const images = [{ src: 'logo', data: logoData }]

const SITE = 'https://puppet.fund'
const CARD_LIMIT = 512
const BUILD_SLOTS = 8
const BUILD_QUEUE = 64
const STATIC_CACHE = 'public, max-age=86400'
const RETRY_MS = 15_000

const FUNDS_ABOUT = 'Masters run funds, puppets allocate to them.'
const FUND_ABOUT = 'A fund on Puppet, run by its master, puppets allocate to it.'
const PUPPET_ABOUT = 'A puppet on Puppet: it allocates to funds under rules it signs once.'

const render = (node: Parameters<typeof renderToImage>[0]): Promise<Uint8Array> => renderToImage(node, { width: SIZE, height: SIZE, format: 'png', renderer, images })

const png = (bytes: Uint8Array, cacheControl: string): Response =>
  new Response(bytes as BlobPart, { headers: { 'content-type': 'image/png', 'cache-control': cacheControl } })

const brand = await render($brand)

type IBuilt = { title: string; description: string; png: Uint8Array; tick: number | null }
type ICard = IBuilt & { until: number }
type IEntry = { card: Promise<ICard>; until: number }

const cards = new Map<string, IEntry>()
const queued: (() => void)[] = []
let building = 0

const cardOf = (key: string, build: () => Promise<IBuilt>): Promise<ICard> => {
  const held = cards.get(key)
  if (held !== undefined) {
    cards.delete(key)
    cards.set(key, held)
    if (Date.now() < held.until) return held.card
  }
  const entry: IEntry = {
    until: Number.POSITIVE_INFINITY,
    card: (async () => {
      if (building < BUILD_SLOTS) building++
      else if (queued.length < BUILD_QUEUE) await new Promise<void>(resolve => queued.push(resolve))
      else throw new Error(`${BUILD_SLOTS} builds running and ${BUILD_QUEUE} queued`)
      try {
        const built = await build()
        const builtAt = Date.now()
        const nextTick = (built.tick === null ? builtAt : built.tick) + TICK_MS
        return { ...built, until: nextTick > builtAt ? nextTick : builtAt + RETRY_MS }
      } finally {
        const turn = queued.shift()
        if (turn === undefined) building--
        else turn()
      }
    })()
  }
  cards.set(key, entry)
  for (const oldest of cards.keys()) {
    if (cards.size <= CARD_LIMIT) break
    cards.delete(oldest)
  }
  entry.card.then(
    card => {
      entry.until = card.until
    },
    (err: unknown) => {
      console.error(`og card ${key} failed`, err)
      if (cards.get(key) === entry) cards.delete(key)
    }
  )
  return entry.card
}

const boardCard = (): Promise<ICard> =>
  cardOf('board', async () => {
    const rows = await fetchLeaderboard(5)
    return rows.length === 0
      ? { title: 'Funds on Puppet', description: FUNDS_ABOUT, png: await render($page('Funds', 'Masters run funds, puppets allocate to them')), tick: null }
      : {
          title: 'Funds on Puppet',
          description: `Top PnL · ${LEADERBOARD_WINDOW}: ${rows.slice(0, 3).map(row => `${row.label} ${row.pnl}`).join(' · ')}`,
          png: await render($masters(rows)),
          tick: Math.max(...rows.map(row => row.tick))
        }
  })

const masterCard = (address: Address): Promise<ICard> =>
  cardOf(`master:${address}`, async () => {
    const card = await fetchMasterCard(address)
    return card === null
      ? { title: `Fund ${readableAddress(address)} on Puppet`, description: FUND_ABOUT, png: await render($page('Fund', readableAddress(address))), tick: null }
      : {
          title: `${card.label} on Puppet`,
          description: `Allocated ${card.allocated} · PnL ${card.window} ${card.pnl} · ${card.puppetCount} puppet${card.puppetCount === 1 ? '' : 's'} · Fund ${card.fundValue}`,
          png: await render($master(card)),
          tick: card.tick
        }
  })

const puppetCard = (address: Address): Promise<ICard> =>
  cardOf(`puppet:${address}`, async () => {
    const card = await fetchPuppetCard(address)
    return card === null
      ? { title: `Puppet ${readableAddress(address)} on Puppet`, description: PUPPET_ABOUT, png: await render($page('Puppet', readableAddress(address))), tick: null }
      : {
          title: `${readableAddress(card.account)} on Puppet`,
          description: `In funds ${card.inFunds} · allocates to ${card.fundCount} fund${card.fundCount === 1 ? '' : 's'}${card.masterOf === null ? '' : ` · Master of ${card.masterOf}`}`,
          png: await render($puppet(card)),
          tick: card.tick
        }
  })

const image = async (card: Promise<ICard>): Promise<Response> => {
  try {
    const held = await card
    return png(held.png, `public, max-age=${Math.max(1, Math.ceil((held.until - Date.now()) / 1000))}`)
  } catch {
    return png(brand, 'no-store')
  }
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

const hourBucket = (): string => new Date().toISOString().slice(0, 13).replace('T', '-')

const preview = (page: { path: string; title: string; description: string; image: string }): Response => {
  const url = `${SITE}${page.path}`
  const meta = (key: 'name' | 'property', name: string, content: string): string => `<meta ${key}="${name}" content="${escapeHtml(content)}">`
  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(page.title)}</title>`,
    meta('name', 'description', page.description),
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Puppet'),
    meta('property', 'og:url', url),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:image', page.image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', String(SIZE)),
    meta('property', 'og:image:height', String(SIZE)),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:site', '@PuppetCopy'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    meta('name', 'twitter:image', page.image),
    `</head><body><a href="${escapeHtml(url)}">${escapeHtml(page.title)}</a></body></html>`
  ].join('\n')
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

const server = Bun.serve({
  port,
  idleTimeout: 30,
  routes: {
    '/health': new Response('ok'),
    '/og': png(brand, STATIC_CACHE),
    '/og/portfolio': png(await render($page('Portfolio', 'Your account, balances and allocations')), STATIC_CACHE),
    '/og/masters': () => image(boardCard()),
    '/og/masters/:master': req => {
      const { master } = req.params
      if (!isAddress(master)) return new Response('invalid master', { status: 400 })
      return image(masterCard(getAddress(master)))
    },
    '/og/puppets/:account': req => {
      const { account } = req.params
      if (!isAddress(account)) return new Response('invalid account', { status: 400 })
      return image(puppetCard(getAddress(account)))
    },
    '/og/html/traders': async () => {
      const page = { path: '/traders', image: `${SITE}/api/og/masters?d=${hourBucket()}` }
      try {
        const { title, description } = await boardCard()
        return preview({ ...page, title, description })
      } catch {
        return preview({ ...page, title: 'Funds on Puppet', description: FUNDS_ABOUT })
      }
    },
    '/og/html/traders/:master': async req => {
      const { master } = req.params
      if (!isAddress(master)) return new Response('not a fund page', { status: 404 })
      const address = getAddress(master)
      const share = new URL(req.url).searchParams.get('s')
      const page = { path: `/traders/${address}`, image: `${SITE}/api/og/masters/${address}?${share === null ? `d=${hourBucket()}` : `s=${encodeURIComponent(share)}`}` }
      try {
        const { title, description } = await masterCard(address)
        return preview({ ...page, title, description })
      } catch {
        return preview({ ...page, title: `Fund ${readableAddress(address)} on Puppet`, description: FUND_ABOUT })
      }
    },
    '/og/html/puppets/:account': async req => {
      const { account } = req.params
      if (!isAddress(account)) return new Response('not a puppet page', { status: 404 })
      const address = getAddress(account)
      const share = new URL(req.url).searchParams.get('s')
      const page = { path: `/puppets/${address}`, image: `${SITE}/api/og/puppets/${address}?${share === null ? `d=${hourBucket()}` : `s=${encodeURIComponent(share)}`}` }
      try {
        const { title, description } = await puppetCard(address)
        return preview({ ...page, title, description })
      } catch {
        return preview({ ...page, title: `Puppet ${readableAddress(address)} on Puppet`, description: PUPPET_ABOUT })
      }
    }
  }
})

process.on('SIGTERM', () => server.stop().then(() => process.exit(0)))

console.log(`OG service listening on :${server.port}`)
