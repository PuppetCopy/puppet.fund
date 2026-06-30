import { expect, test } from 'bun:test'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { Address, Hex } from 'viem'
import type { IDepositDraft, IDraft, ISubscribeDraft } from '../draft.js'
import { type PlannedStep, planExecution, shouldRecognize } from './plan.js'

const USER = `0x${'11'.repeat(20)}` as Address
const SIGNER = `0x${'22'.repeat(20)}` as Address
const ACCT = `0x${'33'.repeat(20)}` as Address
const USDC = `0x${'aa'.repeat(32)}` as Hex
const WETH = `0x${'bb'.repeat(32)}` as Hex

const route = (chainId: number) => ({
  chainId,
  params: { user: USER, signer: SIGNER },
  mode: 'erc20Gate' as const,
  token: USDC,
  amount: 100n,
  walletBalance: 1000n,
  walletAllowance: 1000n
})

const deposit = (over: Partial<IDepositDraft> & { base?: Hex } = {}): IDepositDraft => {
  const base = over.base ?? USDC
  return {
    kind: 'deposit',
    id: over.id ?? `deposit:${base}`,
    account: ACCT,
    params: { user: USER, signer: SIGNER },
    title: 'Deposit',
    alert: null,
    inputAmount: { amount: 100n, baseToken: base },
    output: { receiver: ACCT, chainId: HUB_CHAIN_ID, amount: 100n, baseToken: base, approx: false },
    wallet: over.wallet !== undefined ? over.wallet : route(HUB_CHAIN_ID),
    swap: over.swap !== undefined ? over.swap : null,
    surplus: over.surplus ?? 0n
  }
}

const mandate = (base: Hex): ISubscribeDraft =>
  ({ kind: 'mandate', id: `mandate:${base}`, account: ACCT, title: 'Follow', alert: null, baseToken: base }) as ISubscribeDraft

const allocate = (base: Hex): IDraft =>
  ({ kind: 'allocate', id: `allocate:${base}`, account: ACCT, title: 'Fund', alert: null, baseToken: base }) as unknown as IDraft

test('home deposit alone → recognizes', () => {
  const d = deposit()
  expect(shouldRecognize(d, [d])).toBe(true)
})

test('home deposit + same-base allocate after → folds (allocate sweeps the route + seeds the fund)', () => {
  const d = deposit()
  expect(shouldRecognize(d, [d, allocate(USDC)])).toBe(false)
})

test('cross-chain deposit + same-base allocate after → folds (allocate sweeps the bridge-filled route; runner holds the fill wait)', () => {
  const swap = { ...route(10), destinationChainId: BigInt(HUB_CHAIN_ID), chainId: 10n } as unknown as IDepositDraft['swap']
  const d = deposit({ swap })
  expect(shouldRecognize(d, [d, allocate(USDC)])).toBe(false)
})

test('deposit + same-base MANDATE → folds (the gate auto-recognizes the route, paying the fee from signed + route)', () => {
  const d = deposit()
  expect(shouldRecognize(d, [d, mandate(USDC)])).toBe(false)
})

test('cross-chain deposit + same-base mandate → folds (runner waits for the bridge fill; the mandate then sweeps the route)', () => {
  const swap = { ...route(10), destinationChainId: BigInt(HUB_CHAIN_ID), chainId: 10n } as unknown as IDepositDraft['swap']
  const d = deposit({ swap })
  expect(shouldRecognize(d, [d, mandate(USDC)])).toBe(false)
})

test('deposit + DIFFERENT-base mandate → recognizes (the mandate sweeps only its own base route)', () => {
  const d = deposit({ base: USDC })
  expect(shouldRecognize(d, [d, mandate(WETH)])).toBe(true)
})

test('cross-chain deposit alone → recognizes (no follow-up to sweep)', () => {
  const swap = { ...route(10), destinationChainId: BigInt(HUB_CHAIN_ID), chainId: 10n } as unknown as IDepositDraft['swap']
  const d = deposit({ swap })
  expect(shouldRecognize(d, [d])).toBe(true)
})

test('deposit + DIFFERENT-base allocate → recognizes', () => {
  const d = deposit({ base: USDC })
  expect(shouldRecognize(d, [d, allocate(WETH)])).toBe(true)
})

test('allocate BEFORE deposit → recognizes (settler must come after)', () => {
  const d = deposit()
  expect(shouldRecognize(d, [allocate(USDC), d])).toBe(true)
})

test('pure-sweep home deposit (no wallet) + allocate → folds', () => {
  const d = deposit({ wallet: null, surplus: 50n })
  expect(shouldRecognize(d, [d, allocate(USDC)])).toBe(false)
})

test('planExecution: bind + deposit + two same-base mandates → one batch led by first mandate', () => {
  const planned: PlannedStep[] = [
    { kind: 'bind' },
    { kind: 'draft', draft: deposit() },
    { kind: 'draft', draft: mandate(USDC) },
    { kind: 'draft', draft: mandate(USDC) }
  ]
  const entries = planExecution(planned)
  expect(entries[0].kind).toBe('bind')
  const execs = entries.filter(e => e.kind === 'exec')
  const leads = execs.filter(e => e.kind === 'exec' && e.lead)
  expect(leads.length).toBe(2)
  const mandateLead = execs.find(e => e.kind === 'exec' && e.draft.kind === 'mandate' && e.lead)
  expect(mandateLead && mandateLead.kind === 'exec' ? mandateLead.batch.length : 0).toBe(2)
})
