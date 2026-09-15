import { generatePairingKeypair, type IPairedSession, type ISealedPayload, openPairingPayload } from '@puppet/sdk/account'
import { createCompact, type ICompact } from '@puppet/sdk/compact'
import { type IGetRate, oracleRate } from '@puppet/sdk/evaluate'
import { type ITokenRegistryMap, tokenRegistryFromRows } from '@puppet/sdk/state'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const PAIR_CALLBACK_PORT = 42071

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
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: PAIR_CALLBACK_PORT,
      async fetch(req) {
        if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
        const url = new URL(req.url)
        if (req.headers.get('origin') !== origin || url.searchParams.get('token') !== token) {
          return new Response('forbidden', { status: 403, headers: cors })
        }
        let session: IPairedSession
        try {
          const sealed = (await req.json()) as ISealedPayload
          session = await openPairingPayload<IPairedSession>(privateKey, sealed)
        } catch (err) {
          queueMicrotask(() => {
            server.stop()
            reject(new Error(`pairing payload could not be opened: ${err instanceof Error ? err.message : String(err)}`))
          })
          return new Response('bad payload', { status: 400, headers: cors })
        }
        queueMicrotask(() => {
          server.stop()
          resolve(session)
        })
        return new Response('ok', { headers: cors })
      }
    })
    console.log('[operator] pair this operator with your browser (key stays in memory, never written):')
    console.log(`  ${origin}/hello?pair=${PAIR_CALLBACK_PORT}&token=${token}&epk=${publicKey}`)
  })
}

export interface IConnectorConfig {
  session?: IPairedSession
  pairUrl?: string | URL
  dryRun?: boolean
}

export interface IConnector {
  compact: ICompact
  tokenRegistry: ITokenRegistryMap
  getRate: IGetRate
  user: Address
  account: Address
  dryRun: boolean
  signer: Address
  signIntent: (digest: Hex) => Promise<Hex>
  close: () => void
}

export async function createConnector(config: IConnectorConfig = {}): Promise<IConnector> {
  const session = config.session ?? (await pairOverBrowser(config.pairUrl))
  for (const [name, value] of [
    ['matchmakerUrl', session.matchmakerUrl],
    ['oracleUrl', session.oracleUrl]
  ] as const) {
    if (!/^https?:\/\//.test(value ?? '')) {
      throw new Error(`session ${name} "${value}" is not an absolute http(s) URL: re-pair against a current puppet.fund build`)
    }
  }
  if (!session.signer) {
    throw new Error('paired session carries no signer key: re-pair against a current puppet.fund build')
  }
  if (!session.tokenRegistry) {
    throw new Error('paired session lacks the token registry: re-pair against a current puppet.fund build')
  }
  if (!session.body) {
    throw new Error('paired session names no trading account: re-pair against a current puppet.fund build with a trading account selected')
  }
  Object.defineProperty(session, 'share', { enumerable: false })
  Object.defineProperty(session, 'signer', { enumerable: false })
  const signerAccount = privateKeyToAccount(session.signer)
  const compact = createCompact({ matchmakerUrl: session.matchmakerUrl })
  return {
    compact,
    tokenRegistry: tokenRegistryFromRows(session.tokenRegistry),
    getRate: oracleRate(session.oracleUrl),
    user: session.user,
    account: session.body.account,
    dryRun: config.dryRun ?? false,
    signer: signerAccount.address,
    signIntent: (digest: Hex): Promise<Hex> => signerAccount.sign({ hash: digest }),
    close: (): void => {
      compact.close()
    }
  }
}
