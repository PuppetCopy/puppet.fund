import { type Address, type Hex, hexToString, isAddressEqual, type PublicClient, type TypedDataDefinition } from 'viem'
import type { IBodySignRequest } from '../account/createAccount.js'
import { CompactError } from '../compact/error.js'
import { admitHyperliquidAction, submitHyperliquidAction } from './hyperliquid/screen.js'
import type { IDappScreenReason, IDappTypedData, IVenueCredentials } from './types.js'
import { VENUES } from './venues.js'

type IDappRequest = Extract<IBodySignRequest, { kind: 'message' | 'typedData' | 'hyperliquidAction' }>

export function screenDappTypedData(account: Address, typedData: IDappTypedData): IDappScreenReason[] {
  if (typedData.types?.EIP712Domain !== undefined) {
    return [
      {
        code: 'DAPP_DOMAIN_NOT_ADMITTED',
        detail:
          'typed data may not carry its own EIP712Domain type; the domain the screen reads would not be the domain the signature commits to'
      }
    ]
  }
  if (typedData.primaryType === 'EIP712Domain') {
    return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: 'the domain itself is not a signable action' }]
  }
  for (const venue of VENUES) {
    if (venue.typedData === undefined) continue
    const reasons = venue.typedData(account, typedData)
    if (reasons !== null) return reasons
  }
  return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: `typed data under domain ${typedData.domain?.name ?? '(none)'} is not an admitted venue action` }]
}

const SIWE_MESSAGE =
  /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?[^\s/?#]+ wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\n(?:[^\r\n]*\n)?\nURI: \S+\nVersion: 1\nChain ID: [0-9]+\nNonce: [a-zA-Z0-9]{8,}\nIssued At: \S+(?:\nExpiration Time: \S+)?(?:\nNot Before: \S+)?(?:\nRequest ID: \S*)?(?:\nResources:(?:\n- \S+)*)?$/

export function screenDappMessage(account: Address, message: Hex): IDappScreenReason[] {
  let text: string
  try {
    text = hexToString(message)
  } catch {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: 'a personal_sign message must be UTF-8 text' }]
  }
  for (const venue of VENUES) {
    const reasons = venue.message(account, text)
    if (reasons !== null) return reasons
  }
  const siwe = SIWE_MESSAGE.exec(text)
  if (siwe === null) {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: 'only well-formed EIP-4361 Sign-In with Ethereum messages are signed for dApps; nothing else can be authorized with a bare message' }]
  }
  if (!isAddressEqual(siwe[1] as Address, account)) {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: `the sign-in message names ${siwe[1]}, not the account ${account}` }]
  }
  if (text.includes('Resources:')) {
    return [
      {
        code: 'DAPP_MESSAGE_NOT_ADMITTED',
        detail:
          'the sign-in message names Resources, which extends the signature past authentication (EIP-5573 ReCap capability grants ride there, and parsers such as viem read Resources: anywhere in the text); only a plain sign-in is signed'
      }
    ]
  }
  return []
}

export async function signDappTypedData(
  signer: { account: Address; sign: (request: IBodySignRequest) => Promise<Hex>; submit: (request: IBodySignRequest) => Promise<Hex> },
  typedData: TypedDataDefinition
): Promise<{ signature: Hex; presignFailures: unknown[] }> {
  const presignFailures: unknown[] = []
  for (const venue of VENUES) {
    if (venue.presign === undefined) continue
    for (const request of venue.presign(signer.account, typedData as unknown as IDappTypedData)) {
      await signer.submit(request).catch((error: unknown) => {
        if (!(error instanceof CompactError && error.code === 'REFERRAL_BOUND')) presignFailures.push(error)
      })
    }
  }
  return { signature: await signer.sign({ kind: 'typedData', typedData }), presignFailures }
}

export function assertDappSignable(reasons: readonly IDappScreenReason[]): void {
  if (reasons.length > 0) throw new Error(reasons.map(r => `${r.code}: ${r.detail}`).join('; '))
}

export async function admitDappRequest(clients: Readonly<Record<number, PublicClient>>, account: Address, request: IDappRequest, submit: boolean): Promise<IDappScreenReason[]> {
  if (request.kind === 'message') {
    return submit ? [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: 'a signed message goes back to its dApp, never to a venue' }] : screenDappMessage(account, request.message)
  }
  if (request.kind === 'hyperliquidAction') {
    return submit
      ? admitHyperliquidAction(account, request.action, request.nonce)
      : [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: 'a Hyperliquid action is submitted by the attestor itself, never returned unsent' }]
  }
  if ((request as { kind: string }).kind !== 'typedData') {
    return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `unknown signing request kind ${(request as { kind: string }).kind}` }]
  }
  const typedData = request.typedData as unknown as IDappTypedData
  const refused = screenDappTypedData(account, typedData)
  if (refused.length > 0) return refused
  const venue = VENUES.find(v => v.typedData !== undefined && v.typedData(account, typedData) !== null)
  if (venue === undefined) return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: `typed data under domain ${typedData.domain?.name ?? '(none)'} is not an admitted venue action` }]
  if (submit && venue.submit === undefined) {
    return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `${venue.name} typed data goes back to its dApp; only typed data the venue's own service executes is submitted` }]
  }
  return venue.attestTypedData === undefined ? [] : venue.attestTypedData(clients, account, typedData)
}

export async function submitDappRequest(credentials: Readonly<Record<string, IVenueCredentials>>, account: Address, request: IDappRequest, signature: Hex): Promise<void> {
  if (request.kind === 'hyperliquidAction') return submitHyperliquidAction(request.action, request.nonce, signature)
  if (request.kind !== 'typedData') throw new Error(`a ${(request as { kind: string }).kind} signature goes back to its dApp, never to a venue`)
  const typedData = request.typedData as unknown as IDappTypedData
  const venue = VENUES.find(v => v.submit !== undefined && v.typedData !== undefined && v.typedData(account, typedData) !== null)
  if (venue?.submit === undefined) throw new Error(`no venue submits typed data under domain ${typedData.domain?.name ?? '(none)'}`)
  await venue.submit(typedData, signature, credentials[venue.venueId] ?? null)
}
