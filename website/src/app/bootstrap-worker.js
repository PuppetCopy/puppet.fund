const APPROVAL = __RELEASE_APPROVAL__
const POINTER = '/current'
const STATE = '/state'
const SETTLING_MS = 60_000
const ROLLOUT_GRACE_MS = 10 * 60_000
const RETRY_MS = 30_000
const CHECK_MS = 3 * 60_000
const READ_TIMEOUT_MS = 5_000
const FILE_TIMEOUT_MS = 30_000
const SERVED = new Set(['document', 'script', 'style', 'image', 'font', 'manifest', 'worker'])
const PASSED = /^\/(api\/|health$|release\.json$)/
const SECURED = {
  'content-security-policy': "frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()'
}

function inert(response) {
  if (response.type === 'opaqueredirect') return response
  return new Response([204, 205, 304].includes(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: { ...SECURED, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': "sandbox; frame-ancestors 'none'" }
  })
}

function secured(response) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURED)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const sha256 = async bytes =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')

const messageOf = error => (error instanceof Error ? error.message : String(error))

let trusted = null
let retryAt = 0

async function listingFiles(hash) {
  const held = await caches.match('/release.json', { cacheName: `release:${hash}` })
  if (held === undefined) return null
  const bytes = await held.arrayBuffer()
  return (await sha256(bytes)) === hash ? JSON.parse(new TextDecoder().decode(bytes)).files : null
}

async function servedRelease() {
  const served = await fetch('/release.json', { cache: 'no-cache', signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
  if (!served.ok) throw new Error(`${self.location.origin}/release.json answered ${served.status}`)
  return sha256(await served.arrayBuffer())
}

async function pinned() {
  const held = await caches.match(POINTER, { cacheName: 'release' })
  if (held === undefined) return null
  const hash = await held.text()
  return (await caches.match('/release.json', { cacheName: `release:${hash}` })) === undefined ? null : hash
}

const pin = async hash => (await caches.open('release')).put(POINTER, new Response(hash))

async function readState() {
  const held = await caches.match(STATE, { cacheName: 'release' })
  return held === undefined ? { error: null, clients: {} } : held.json()
}

let writes = Promise.resolve()
function update(change) {
  const task = async () => (await caches.open('release')).put(STATE, new Response(JSON.stringify(change(await readState()))))
  writes = writes.then(task, task)
  return writes
}

async function heldIndex(except) {
  const held = new Map()
  for (const name of await caches.keys()) {
    if (!name.startsWith('release:') || name === `release:${except}`) continue
    const kept = await listingFiles(name.slice('release:'.length))
    if (kept === null) continue
    for (const [path, digest] of Object.entries(kept)) if (!held.has(digest)) held.set(digest, { name, path })
  }
  return held
}

async function heldCopy(held, digest) {
  const kept = held.get(digest)
  const hit = kept === undefined ? undefined : await caches.match(kept.path, { cacheName: kept.name })
  const type = hit === undefined ? null : hit.headers.get('content-type')
  if (type === null) return null
  const bytes = await hit.arrayBuffer()
  return (await sha256(bytes)) === digest ? { bytes, type } : null
}

async function download(origin, expected) {
  const fetched = async (path, ms) => {
    const res = await fetch(`${origin}${path}`, { cache: 'no-cache', signal: AbortSignal.timeout(ms) })
    if (!res.ok) throw new Error(`${origin}${path} answered ${res.status}`)
    return res
  }
  const listing = await (await fetched('/release.json', READ_TIMEOUT_MS)).arrayBuffer()
  const hash = await sha256(listing)
  if (expected !== null && hash !== expected) throw Object.assign(new Error(`${origin}/release.json hashes to ${hash}, not ${expected}`), { served: hash })
  const { files } = JSON.parse(new TextDecoder().decode(listing))
  const held = await heldIndex(hash)
  const cache = await caches.open(`release:${hash}`)
  await Promise.all(
    Object.entries(files).map(async ([path, digest]) => {
      const copy = await heldCopy(held, digest)
      if (copy !== null) {
        await cache.put(path, new Response(copy.bytes, { headers: { 'content-type': copy.type } }))
        return
      }
      const res = await fetched(path, FILE_TIMEOUT_MS)
      const type = res.headers.get('content-type')
      if (type === null) throw new Error(`${origin}${path} came without a content type`)
      const bytes = await res.arrayBuffer()
      if ((await sha256(bytes)) !== digest) throw new Error(`${origin}${path} differs from its release.json`)
      await cache.put(path, new Response(bytes, { headers: { 'content-type': type } }))
    })
  )
  await cache.put('/release.json', new Response(listing, { headers: { 'content-type': 'application/json' } }))
  return hash
}

async function readApproval(rpc, approval, floor) {
  const host = new URL(rpc).host
  const call = async (method, params) => {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS)
    }).catch(error => {
      throw new Error(`${host} ${method}: ${messageOf(error)}`)
    })
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
    if (body?.error !== undefined) throw new Error(`${host} ${method} failed: ${body.error.message}`)
    if (!res.ok || body === null) throw new Error(`${host} answered ${res.status}`)
    return body.result
  }
  const head = await call('eth_blockNumber', [])
  if (typeof head !== 'string' || !/^0x[0-9a-fA-F]+$/.test(head)) throw new Error(`${host} eth_blockNumber returned ${String(head)}`)
  const block = Number(head)
  if (block < floor) throw new Error(`${host} is at block ${block}, behind block ${floor} this app has already read`)
  const result = await call('eth_call', [{ to: approval.to, data: approval.data }, head])
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error(`${host} Release.current() returned ${String(result)}`)
  return { host, block, release: /^0x0{64}$/.test(result) ? null : result.slice(2).toLowerCase() }
}

async function approvedRelease(approval, floor) {
  if (approval.rpc === null) return { release: await servedRelease(), block: null }
  const reads = await Promise.allSettled([approval.rpc, ...(approval.witness === null ? [] : [approval.witness])].map(rpc => readApproval(rpc, approval, floor)))
  const answers = reads.flatMap(read => (read.status === 'fulfilled' ? [read.value] : []))
  if (answers.length === 0) throw new Error(reads.map(read => messageOf(read.reason)).join('; '))
  if (answers.some(answer => answer.release !== answers[0].release)) {
    throw new Error(`the release RPCs disagree: ${answers.map(answer => `${answer.host} names ${answer.release ?? 'no release'} at block ${answer.block}`).join(', ')}`)
  }
  return { release: answers[0].release, block: Math.min(...answers.map(answer => answer.block)) }
}

async function install(hash, current) {
  if ((await listingFiles(hash)) !== null) return true
  try {
    await download(self.location.origin, hash)
    return true
  } catch (error) {
    if (error.served === current) return false
    throw new Error(`${self.location.origin} does not serve the approved release ${hash}: ${messageOf(error)}`)
  }
}

async function settle() {
  const live = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  await update(state => ({
    ...state,
    clients: Object.fromEntries(Object.entries(state.clients).filter(([id, entry]) => live.some(client => client.id === id) || Date.now() - entry.at < SETTLING_MS))
  }))
  const floorOf = state => (state.floor?.rpc === APPROVAL.rpc ? state.floor.block : 0)
  const approval = await approvedRelease(APPROVAL, floorOf(await readState()))
  if (approval.block !== null) await update(state => ({ ...state, floor: { rpc: APPROVAL.rpc, block: Math.max(floorOf(state), approval.block) } }))
  const approved = approval.release ?? (await servedRelease())
  const held = await pinned()
  if (!(await install(approved, held))) return approved
  if (approved !== held) await pin(approved)
  const files = await listingFiles(approved)
  if (files === null) throw new Error(`the cached release.json of ${approved} does not hash to it`)
  const served = trusted
  trusted = { hash: approved, files, authenticated: true }
  const stale = served !== null && !served.authenticated && served.hash !== approved
  if (!stale && (held === null || held === approved)) return null
  const { clients } = await readState()
  if (held !== null && held !== approved) {
    const kept = new Set([approved, held, ...Object.values(clients).map(client => client.release)])
    for (const name of await caches.keys()) {
      if (name.startsWith('release:') && !kept.has(name.slice('release:'.length))) await caches.delete(name)
    }
  }
  await Promise.allSettled(live.filter(client => stale || clients[client.id]?.booted !== true).map(client => client.navigate(client.url)))
  return null
}

function awaiting(state, release) {
  const since = state.rolling?.release === release ? state.rolling.since : Date.now()
  const late = Date.now() - since >= ROLLOUT_GRACE_MS
  return { ...state, rolling: { release, since }, error: late ? `${self.location.origin} has not served the approved release ${release} for ${ROLLOUT_GRACE_MS / 60_000} minutes` : null }
}

let syncing = null
function sync(force) {
  syncing ??= readState()
    .then(state =>
      !force && trusted !== null && trusted.authenticated && state.checkedAt !== undefined && Date.now() - state.checkedAt < CHECK_MS
        ? false
        : settle()
            .then(
              rolling => update(state => (rolling === null ? { ...state, error: null, rolling: null, checkedAt: Date.now() } : awaiting(state, rolling))),
              error => update(state => ({ ...state, error: messageOf(error), rolling: null }))
            )
            .then(() => true)
    )
    .then(checked => {
      if (trusted === null || !trusted.authenticated) retryAt = Date.now() + RETRY_MS
      if (checked) return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list.forEach(client => client.postMessage('release')))
    })
    .finally(() => {
      syncing = null
    })
  return syncing
}

async function verified(hash, path, digest) {
  const hit = await caches.match(path, { cacheName: `release:${hash}` })
  const held = hit === undefined ? null : await hit.arrayBuffer()
  if (held !== null && (await sha256(held)) === digest) return secured(new Response(held, { headers: hit.headers }))
  const copy = await heldCopy(await heldIndex(hash), digest)
  const got =
    copy !== null
      ? copy
      : await fetch(path, { cache: 'no-cache', signal: AbortSignal.timeout(FILE_TIMEOUT_MS) }).then(
          async res => {
            const type = res.headers.get('content-type')
            const bytes = await res.arrayBuffer()
            if (!res.ok || type === null || (await sha256(bytes)) !== digest) return { failure: `${self.location.origin} answered ${res.status}${res.ok ? ' with other bytes' : ''}` }
            return { bytes, type }
          },
          error => ({ failure: messageOf(error) })
        )
  if ('failure' in got) {
    return new Response(`Puppet could not verify ${path} of release ${hash}: the cached copy and the network copy (${got.failure}) both differ from its release.json`, {
      status: 502,
      headers: { 'content-type': 'text/plain' }
    })
  }
  try {
    await (await caches.open(`release:${hash}`)).put(path, new Response(got.bytes, { headers: { 'content-type': got.type } }))
  } catch (error) {
    void update(state => ({ ...state, cacheFailure: { path, release: hash, message: messageOf(error), at: Date.now() } }))
  }
  return secured(new Response(got.bytes, { headers: { 'content-type': got.type } }))
}

async function restore() {
  const hash = await pinned()
  if (hash === null) return null
  const files = await listingFiles(hash)
  return files === null ? null : { hash, files, authenticated: false }
}

async function respond(request, path) {
  if ((trusted === null || !trusted.authenticated) && self.navigator.onLine && Date.now() >= retryAt) await Promise.allSettled([sync(true)])
  if (trusted !== null && trusted.authenticated) return serveFrom(trusted, request, path)
  const reached = self.navigator.onLine ? await fetch(request).then(response => response, () => null) : null
  if (reached !== null) return reached
  const restored = await restore()
  trusted ??= restored
  return trusted === null ? fetch(request) : serveFrom(trusted, request, path)
}

async function serveFrom(trust, request, path) {
  const wanted = Object.hasOwn(trust.files, path) ? path : request.mode === 'navigate' ? '/index.html' : null
  if (wanted !== null) return verified(trust.hash, wanted, trust.files[wanted])
  for (const name of await caches.keys()) {
    if (!name.startsWith('release:') || name === `release:${trust.hash}`) continue
    const files = await listingFiles(name.slice('release:'.length))
    if (files === null || !Object.hasOwn(files, path)) continue
    const hit = await caches.match(path, { cacheName: name })
    if (hit === undefined) continue
    const bytes = await hit.arrayBuffer()
    if ((await sha256(bytes)) === files[path]) return secured(new Response(bytes, { headers: hit.headers }))
  }
  return new Response(null, { status: 404 })
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    if (request.method !== 'GET') return event.respondWith(secured(new Response(null, { status: 405 })))
    if (PASSED.test(url.pathname)) return event.respondWith(fetch(request).then(inert))
  } else if (request.method !== 'GET' || !SERVED.has(request.destination)) return
  event.respondWith(respond(request, url.pathname))
  if (request.mode !== 'navigate') return
  const id = event.resultingClientId
  event.waitUntil(
    pinned()
      .then(release => update(state => ({ ...state, clients: { ...state.clients, [id]: { release, booted: false, at: Date.now() } } })))
      .then(() => sync(false))
  )
})

self.addEventListener('message', event => {
  if (event.data === 'sync') event.waitUntil(sync(false))
  if (event.data !== 'booted') return
  const id = event.source.id
  event.waitUntil(update(state => ({ ...state, clients: { ...state.clients, [id]: { release: state.clients[id]?.release ?? null, booted: true, at: state.clients[id]?.at ?? Date.now() } } })))
})

