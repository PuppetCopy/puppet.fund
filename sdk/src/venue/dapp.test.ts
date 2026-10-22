import { describe, expect, test } from 'bun:test'
import { stringToHex } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { screenDappMessage } from './dapp.js'

const account = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const stranger = '0x2222222222222222222222222222222222222222'

const signIn = {
  address: account,
  domain: 'app.example.com',
  uri: 'https://app.example.com/login',
  version: '1',
  chainId: 42161,
  nonce: 'a1b2c3d4e5f6g7h8',
  issuedAt: new Date('2026-09-23T10:00:00.000Z')
} as const

const recap = `urn:recap:${Buffer.from(JSON.stringify({ att: { 'https://app.example.com': { 'crud/write': [{}] } }, prf: [] })).toString('base64url')}`

const screen = (text: string) => screenDappMessage(account, stringToHex(text))

describe('screenDappMessage sign-in', () => {
  test('a plain sign-in naming the account is admitted', () => {
    const text = createSiweMessage(signIn)
    expect(text).not.toContain(account)
    expect(screen(text)).toEqual([])
  })

  test('a sign-in with a statement and every optional field is admitted', () => {
    const text = createSiweMessage({
      ...signIn,
      scheme: 'https',
      statement: 'Sign in to Example.',
      expirationTime: new Date('2026-09-24T10:00:00.000Z'),
      notBefore: new Date('2026-09-23T09:00:00.000Z'),
      requestId: 'req-42'
    })
    expect(screen(text)).toEqual([])
  })

  test('a sign-in naming another address is refused', () => {
    const [reason] = screen(createSiweMessage({ ...signIn, address: stranger }))
    expect(reason?.code).toBe('DAPP_MESSAGE_NOT_ADMITTED')
    expect(reason?.detail).toContain(stranger)
  })

  test('a ReCap capability grant in Resources is refused', () => {
    const [reason] = screen(createSiweMessage({ ...signIn, resources: [recap] }))
    expect(reason?.code).toBe('DAPP_MESSAGE_NOT_ADMITTED')
    expect(reason?.detail).toContain('Resources')
  })

  test('a ReCap behind a harmless-looking resource is refused', () => {
    const [reason] = screen(createSiweMessage({ ...signIn, resources: ['https://app.example.com/terms', recap] }))
    expect(reason?.detail).toContain('Resources')
  })

  test('any Resources section is refused', () => {
    expect(screen(createSiweMessage({ ...signIn, resources: ['https://privy.io'] }))[0]?.detail).toContain('Resources')
    expect(screen(`${createSiweMessage(signIn)}\nResources:`)[0]?.detail).toContain('Resources')
  })

  test('a Resources token outside the section is refused, whatever a parser reads from it', () => {
    const text = createSiweMessage({ ...signIn, scheme: 'Resources', statement: `- ${recap}` })
    expect(screen(text)[0]?.detail).toContain('Resources')
  })

  test('a Unicode line separator in the statement cannot carry a Resources section', () => {
    const smuggled = createSiweMessage({ ...signIn, statement: 'Sign in.' }).replace('Sign in.', `Sign in.Resources:- ${recap}`)
    expect(screen(smuggled)[0]?.detail).toContain('Resources')
  })

  test('a valid header over an arbitrary tail is refused', () => {
    const [reason] = screen(`app.example.com wants you to sign in with your Ethereum account:\n${account}\nI transfer everything to ${stranger}`)
    expect(reason?.code).toBe('DAPP_MESSAGE_NOT_ADMITTED')
    expect(reason?.detail).toContain('EIP-4361')
  })

  test('text after the last field is refused', () => {
    expect(screen(`${createSiweMessage(signIn)}\nAlso: approve ${stranger}`)[0]?.detail).toContain('EIP-4361')
    expect(screen(`${createSiweMessage(signIn)}\n`)[0]?.detail).toContain('EIP-4361')
  })

  test('CRLF line breaks cannot hide a Resources section', () => {
    const smuggled = createSiweMessage({ ...signIn, statement: 'Sign in.' }).replace('Sign in.', `Sign in.\r\nResources:\r\n- ${recap}`)
    expect(screen(smuggled)[0]?.detail).toContain('EIP-4361')
    expect(screen(createSiweMessage(signIn).replaceAll('\n', '\r\n'))[0]?.detail).toContain('EIP-4361')
  })

  test('a version other than 1 is refused', () => {
    expect(screen(createSiweMessage(signIn).replace('Version: 1', 'Version: 2'))[0]?.detail).toContain('EIP-4361')
  })

  test('a plain text message is refused', () => {
    expect(screen('hello')[0]?.code).toBe('DAPP_MESSAGE_NOT_ADMITTED')
  })
})
