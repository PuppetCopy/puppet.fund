import { type Hex, parseSignature } from 'viem'
import type { IDappTypedData } from '../types.js'
import { CLOSE_TYPES, OPEN_POSITION_TYPES, REGISTER_SESSION_KEY_TYPES, WITHDRAW_TO_CORE_TYPES } from './contracts.js'

const PAPERTRADE_INTENTS_URL = 'https://exchange.papertrade.xyz/intents'
const PAPERTRADE_SUBMIT_TIMEOUT_MS = 20_000
const PAPERTRADE_TAKEN_STATES: ReadonlySet<string> = new Set(['queued', 'prepared', 'confirmed'])
const PAPERTRADE_INTENTS: ReadonlyMap<string, { action: string; fields: readonly { name: string; type: string }[] }> = new Map([
  ['OpenPosition', { action: 'openPosition', fields: OPEN_POSITION_TYPES }],
  ['Close', { action: 'closePositions', fields: CLOSE_TYPES }],
  ['WithdrawToCore', { action: 'withdrawToCore', fields: WITHDRAW_TO_CORE_TYPES }],
  ['RegisterSessionKey', { action: 'registerSessionKey', fields: REGISTER_SESSION_KEY_TYPES }]
])

export async function papertradeSubmit(typedData: IDappTypedData, signature: Hex): Promise<void> {
  const intent = PAPERTRADE_INTENTS.get(typedData.primaryType)
  if (intent === undefined) throw new Error(`Papertrade's intents service takes ${[...PAPERTRADE_INTENTS.keys()].join(', ')}, not ${typedData.primaryType}`)
  const signed = Object.fromEntries(
    intent.fields.map(({ name, type }) => {
      const value = typedData.message[name]
      if (value === undefined) throw new Error(`the ${typedData.primaryType} message has no ${name}`)
      if (type === 'uint256[]') return [name, (value as readonly (bigint | string)[]).map(item => BigInt(item).toString())]
      if (type.startsWith('uint')) return [name, BigInt(value as bigint | string).toString()]
      if (type === 'address' || type.startsWith('bytes')) return [name, (value as string).toLowerCase()]
      return [name, value]
    })
  )
  const { r, s, yParity } = parseSignature(signature)
  let res: Response
  try {
    res = await fetch(PAPERTRADE_INTENTS_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ action: intent.action, signed: { ...signed, v: String(27 + yParity), r: r.toLowerCase(), s: s.toLowerCase() } }),
      signal: AbortSignal.timeout(PAPERTRADE_SUBMIT_TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`Papertrade did not answer the ${intent.action} intent; it may still execute until its deadline, so read the fund before signing it again`, { cause: error })
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`Papertrade answered ${res.status} to the ${intent.action} intent: ${text}`)
  const reply = JSON.parse(text) as { ok?: boolean; error?: unknown; action?: string; state?: string }
  if (reply.ok === false || reply.error !== undefined) throw new Error(`Papertrade refused the ${intent.action} intent: ${text}`)
  if (reply.action !== intent.action || reply.state === undefined || !PAPERTRADE_TAKEN_STATES.has(reply.state)) {
    throw new Error(`Papertrade did not take the ${intent.action} intent: ${text}`)
  }
}
