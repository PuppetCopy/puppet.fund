import { type Address, type Hex, hexToString, isAddressEqual } from 'viem'
import type { IDappScreenReason, IDappTypedData } from './types.js'
import { VENUES } from './venues.js'

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
    const reasons = venue.typedData(account, typedData)
    if (reasons !== null) return reasons
  }
  return [{ code: 'DAPP_DOMAIN_NOT_ADMITTED', detail: `typed data under domain ${typedData.domain?.name ?? '(none)'} is not an admitted venue action` }]
}

const SIWE_HEADER = /^[^\n]+ wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n/

export function screenDappMessage(account: Address, message: Hex): IDappScreenReason[] {
  let text: string
  try {
    text = hexToString(message)
  } catch {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: 'a personal_sign message must be UTF-8 text' }]
  }
  const siwe = SIWE_HEADER.exec(text)
  if (siwe === null) {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: 'only Sign-In with Ethereum messages are signed for dApps; nothing else can be authorized with a bare message' }]
  }
  if (!isAddressEqual(siwe[1] as Address, account)) {
    return [{ code: 'DAPP_MESSAGE_NOT_ADMITTED', detail: `the sign-in message names ${siwe[1]}, not the account ${account}` }]
  }
  return []
}

export function assertDappSignable(reasons: readonly IDappScreenReason[]): void {
  if (reasons.length > 0) throw new Error(reasons.map(r => `${r.code}: ${r.detail}`).join('; '))
}
