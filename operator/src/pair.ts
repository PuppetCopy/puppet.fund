import {
  generatePairingKeypair,
  type IPairedSession,
  type ISealedPayload,
  openPairingPayload
} from '@puppet/sdk/account'
import { DEFAULT_MATCHMAKER_URL } from '@puppet/sdk/const'
import type { ITokenRegistry } from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'

const PAIR_CALLBACK_PORT = 42071

function hideSignerKey(session: IPairedSession): IPairedSession {
  Object.defineProperty(session, 'signerKey', { value: session.signerKey, enumerable: false })
  Object.defineProperty(session, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => ({ ...session, signerKey: '[redacted]' }),
    enumerable: false
  })
  return session
}

export function buildSession(input: {
  signerKey: Hex
  user: Address
  baseToken: Address
  name: Hex
  matchmakerUrl?: string
  tokenRegistry?: ITokenRegistry[]
}): IPairedSession {
  return hideSignerKey({
    signerKey: input.signerKey,
    user: input.user,
    baseToken: input.baseToken,
    name: input.name,
    matchmakerUrl: input.matchmakerUrl ?? DEFAULT_MATCHMAKER_URL,
    tokenRegistry: input.tokenRegistry
  })
}

export async function pairOverBrowser(pairUrl: string | URL = 'https://puppet.fund'): Promise<IPairedSession> {
  const origin = new URL(pairUrl).origin
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
      port: PAIR_CALLBACK_PORT,
      async fetch(req) {
        if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
        const url = new URL(req.url)
        if (req.headers.get('origin') !== origin || url.searchParams.get('token') !== token) {
          return new Response('forbidden', { status: 403, headers: cors })
        }
        const sealed = (await req.json()) as ISealedPayload
        const session = await openPairingPayload<IPairedSession>(privateKey, sealed)
        queueMicrotask(() => {
          server.stop(true)
          resolve(hideSignerKey(session))
        })
        return new Response('ok', { headers: cors })
      }
    })
    console.log('[operator] pair this operator with your browser (key stays in memory, never written):')
    console.log(`  ${origin}/hello?pair=${PAIR_CALLBACK_PORT}&token=${token}&epk=${publicKey}`)
  })
}
