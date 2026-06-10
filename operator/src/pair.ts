import { generatePairingKeypair, type ISealedPayload, openPairingPayload } from '@puppet/sdk/account'
import type { Address, Hex } from 'viem'

export interface IPairedEndpoints {
  matchmakerUrl?: string
  indexerUrl?: string
}

export interface IPairedSession {
  signerKey: Hex
  user: Address
  endpoints: IPairedEndpoints
}

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
        const { user, signerKey, endpoints } = await openPairingPayload<{
          user: Address
          signerKey: Hex
          endpoints?: IPairedEndpoints
        }>(privateKey, sealed)
        const result: IPairedSession = { signerKey, user, endpoints: endpoints ?? {} }
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
