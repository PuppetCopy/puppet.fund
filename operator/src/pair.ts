import { deriveSessionKey, generatePairingKeypair, type ISealedPayload, openPairingPayload } from '@puppet/sdk/account'
import type { Address, Hex } from 'viem'

// Connection endpoints the site shares over the tunnel so a paired operator needs
// no URL config of its own. Each is optional; the operator falls back per-URL.
export interface IPairedEndpoints {
  matchmakerUrl?: string
  indexerUrl?: string
  rpcUrl?: string
}

export interface IPairedSession {
  signerKey: Hex
  user: Address
  endpoints: IPairedEndpoints
}

// One-time loopback pairing: the operator opens a 127.0.0.1 listener, prints a URL
// you open on the site, and the browser posts back the bindSig sealed to the
// operator's ephemeral public key (carried in the printed link). The session key is
// derived from bindSig in memory only — nothing is written or logged.
//
// Three gates, all required: origin check authenticates browser senders to the
// configured site (the Origin header is browser-enforced, not script-spoofable);
// the one-time token gates non-browser local processes; the ephemeral seal means
// even a local listener that intercepts the POST (port squat, loopback sniff)
// gets ciphertext it cannot open, because the public key it was sealed to came
// from the operator's own terminal and the matching private key never left memory.
export async function pairOverBrowser(
  siteUrl: string | URL = 'https://puppet.fund',
  port = 42071
): Promise<IPairedSession> {
  const origin = new URL(siteUrl).origin
  const token = crypto.randomUUID()
  const { publicKey, privateKey } = await generatePairingKeypair()
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true'
  } as const
  return new Promise(resolve => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      async fetch(req) {
        if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
        const url = new URL(req.url)
        if (req.headers.get('origin') !== origin || url.searchParams.get('token') !== token) {
          return new Response('forbidden', { status: 403, headers: cors })
        }
        const sealed = (await req.json()) as ISealedPayload
        const { user, bindSig, endpoints } = await openPairingPayload<{
          user: Address
          bindSig: Hex
          endpoints?: IPairedEndpoints
        }>(privateKey, sealed)
        const result: IPairedSession = { signerKey: deriveSessionKey(bindSig), user, endpoints: endpoints ?? {} }
        queueMicrotask(() => {
          server.stop(true)
          resolve(result)
        })
        return new Response('ok', { headers: cors })
      }
    })
    console.log('[operator] pair this operator with your browser (key stays in memory, never written):')
    console.log(`  ${siteUrl}/hello?pair=${port}&token=${token}&epk=${publicKey}`)
  })
}
