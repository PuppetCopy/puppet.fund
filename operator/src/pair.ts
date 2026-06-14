import {
  generatePairingKeypair,
  type IPairedSession,
  type ISealedPayload,
  openPairingPayload,
  predictPuppetAccount
} from '@puppet/sdk/account'
import { DEFAULT_MATCHMAKER_URL } from '@puppet/sdk/const'
import type { ITokenInfo } from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const PAIR_CALLBACK_PORT = 42071

export function buildSession(input: {
  signerKey: Hex
  user: Address
  baseTokenId: Hex
  name: Hex
  matchmakerUrl?: string
  tokenRegistry?: ITokenInfo[]
}): IPairedSession {
  const params = { user: input.user, signer: privateKeyToAccount(input.signerKey).address }
  return {
    signerKey: input.signerKey,
    params,
    share: { master: predictPuppetAccount(params), baseTokenId: input.baseTokenId, name: input.name },
    matchmakerUrl: input.matchmakerUrl ?? DEFAULT_MATCHMAKER_URL,
    tokenRegistry: input.tokenRegistry
  }
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
          resolve(session)
        })
        return new Response('ok', { headers: cors })
      }
    })
    console.log('[operator] pair this operator with your browser (key stays in memory, never written):')
    console.log(`  ${origin}/hello?pair=${PAIR_CALLBACK_PORT}&token=${token}&epk=${publicKey}`)
  })
}
