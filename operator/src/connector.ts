import type { IAccountLib__AccountInitParams, IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import {
  generatePairingKeypair,
  type IPairedSession,
  type ISealedPayload,
  openPairingPayload,
  predictFundAccount,
  predictPuppetAccount
} from '@puppet/sdk/account'
import { createCompact, type ICompact } from '@puppet/sdk/compact'
import { DEFAULT_MATCHMAKER_URL } from '@puppet/sdk/const'
import { type ITokenRegistry, type ITokenRegistryMap, staticTokenRegistry, tokenRegistryFromRows } from '@puppet/sdk/state'
import { type Address, getAddress, type Hex, type TypedDataDefinition } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const PAIR_CALLBACK_PORT = 42071

function hideSignerKey(session: IPairedSession): void {
  Object.defineProperty(session, 'signerKey', { value: session.signerKey, enumerable: false })
  Object.defineProperty(session, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => ({ ...session, signerKey: '[redacted]' }),
    enumerable: false
  })
}

export function buildSession(input: {
  signerKey: Hex
  user: Address
  baseToken: Address
  name: Hex
  matchmakerUrl?: string
  tokenRegistry?: ITokenRegistry[]
}): IPairedSession {
  const session: IPairedSession = {
    signerKey: input.signerKey,
    user: input.user,
    baseToken: input.baseToken,
    name: input.name,
    matchmakerUrl: input.matchmakerUrl ?? DEFAULT_MATCHMAKER_URL,
    tokenRegistry: input.tokenRegistry
  }
  hideSignerKey(session)
  return session
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
        let session: IPairedSession
        try {
          const sealed = (await req.json()) as ISealedPayload
          session = await openPairingPayload<IPairedSession>(privateKey, sealed)
        } catch {
          return new Response('bad payload', { status: 400, headers: cors })
        }
        hideSignerKey(session)
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
  params: IAccountLib__AccountInitParams
  fundParams: IFundAccountLib__FundAccountInitParams
  user: Address
  signer: Address
  account: Address
  fund: Address
  baseToken: Address
  dryRun: boolean
  sign: (typedData: TypedDataDefinition) => Promise<Hex>
  close: () => void
}

export async function createConnector(config: IConnectorConfig = {}): Promise<IConnector> {
  const session = config.session ?? (await pairOverBrowser(config.pairUrl))
  const matchmakerUrl = session.matchmakerUrl
  if (!/^https?:\/\//.test(matchmakerUrl)) {
    throw new Error(
      `session matchmakerUrl "${matchmakerUrl}" is not an absolute http(s) URL: re-pair against a site that seals an absolute endpoint`
    )
  }
  try {
    await fetch(matchmakerUrl, { method: 'HEAD' })
  } catch (err) {
    throw new Error(`matchmaker ${matchmakerUrl} is unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }

  const sessionSigner = privateKeyToAccount(session.signerKey)
  const params: IAccountLib__AccountInitParams = { user: session.user, signer: sessionSigner.address }
  const account = predictPuppetAccount(params)
  const baseToken = getAddress(session.baseToken)
  const fundParams: IFundAccountLib__FundAccountInitParams = { master: account, baseToken, name: session.name }
  const fund = predictFundAccount(fundParams)
  const tokenRegistry = session.tokenRegistry ? tokenRegistryFromRows(session.tokenRegistry) : staticTokenRegistry()
  const compact = createCompact({ matchmakerUrl })

  return {
    compact,
    tokenRegistry,
    params,
    fundParams,
    user: params.user,
    signer: params.signer,
    account,
    fund,
    baseToken,
    dryRun: config.dryRun ?? false,
    sign: (typedData: TypedDataDefinition): Promise<Hex> => sessionSigner.signTypedData(typedData),
    close: (): void => {
      compact.close()
    }
  }
}
