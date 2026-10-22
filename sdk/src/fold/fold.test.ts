import { describe, expect, test } from 'bun:test'
import { HUB_CANONICAL_TOKEN, PROTOCOL } from '@puppet/contracts/const'
import { type Address, encodeAbiParameters, encodeEventTopics, getAddress, type Hex, isAddressEqual, pad, zeroHash } from 'viem'
import { ACCOUNT_CALL_MAP, ACCOUNT_CALL_TOPIC, type IReceiptLog } from '../account/index.js'
import { acrossSpokePoolOf } from '../intent/route/acrossDeposit.js'
import { accountTable, escrowTable, flowTable, fundTable, holdingTable, mandateTable, redemptionTable, transitTable } from '../schema/index.js'
import { FUNDS_DEPOSITED, foldAccountEntry, type IAccountEntry } from './fold.js'
import { memoryStore } from './memoryStore.js'

const ORIGIN = 10
const DESTINATION = 42161n
const SPOKE_POOL = acrossSpokePoolOf(ORIGIN)
const MODULE = getAddress('0x00000000000000000000000000000000000000aa')
const GATE = getAddress('0x0000000000000000000000000000000000000007')
const USER = getAddress('0x00000000000000000000000000000000000000a1')
const ACCOUNT = getAddress('0x00000000000000000000000000000000000000a2')
const OTHER = getAddress('0x00000000000000000000000000000000000000b3')
const OP_USDT = getAddress('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58')
const OP_USDC = getAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85')
const ARB_USDC = getAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
const SIGNED_OUTPUT = 990_000_000n

const accountCallLog = (account: Address, logIndex: number): IReceiptLog => ({
  address: MODULE,
  topics: [ACCOUNT_CALL_TOPIC, pad(account), pad(GATE)],
  data: '0x',
  logIndex
})

const depositLog = (logIndex: number, depositId: bigint, inputAmount: bigint, outputAmount: bigint): IReceiptLog => ({
  address: SPOKE_POOL,
  topics: encodeEventTopics({
    abi: [FUNDS_DEPOSITED],
    eventName: 'FundsDeposited',
    args: { destinationChainId: DESTINATION, depositId, depositor: pad(ACCOUNT) }
  }) as Hex[],
  data: encodeAbiParameters(
    FUNDS_DEPOSITED.inputs.filter(input => !('indexed' in input)),
    [pad(OP_USDC), pad(ARB_USDC), inputAmount, outputAmount, 1_700_000_000, 1_700_021_600, 0, pad(ACCOUNT), zeroHash, '0x']
  ),
  logIndex
})

const bridgeEntry = (siblingLogs: IReceiptLog[]): IAccountEntry => ({
  chainId: ORIGIN,
  account: ACCOUNT,
  source: GATE,
  digest: zeroHash,
  executionData: encodeAbiParameters(
    [{ type: 'bytes4' }, ...ACCOUNT_CALL_MAP.Deposit.depositAcross.args],
    [ACCOUNT_CALL_MAP.Deposit.depositAcross.selector, DESTINATION, OP_USDT, 1_000_000_000n, ARB_USDC, SIGNED_OUTPUT, OP_USDT, 1_000_000n]
  ),
  callList: [],
  resultList: [],
  balanceList: [],
  siblingLogs,
  block: { number: 100, timestamp: 1_700_000_100 },
  logIndex: 12,
  transactionHash: `0x${'ab'.repeat(32)}`
})

const openStore = () => {
  const store = memoryStore()
  store.set(accountTable, { chainId: BigInt(ORIGIN), account: ACCOUNT, owner: USER, epoch: 0n, revokedAt: 0, createdAt: 0, lastBlock: 1, lastLogIndex: 0 })
  return store
}

const recordEntry = (record: { selector: Hex; args: readonly unknown[] }, values: readonly unknown[], timestamp: number, tx: number): IAccountEntry => ({
  chainId: ORIGIN,
  account: ACCOUNT,
  source: GATE,
  digest: zeroHash,
  executionData: encodeAbiParameters([{ type: 'bytes4' }, ...record.args] as never, [record.selector, ...values] as never),
  callList: [],
  resultList: [],
  balanceList: [],
  siblingLogs: [],
  block: { number: 400 + tx, timestamp },
  logIndex: 2,
  transactionHash: `0x${tx.toString(16).padStart(64, '0')}`
})

describe('wallet exits', () => {
  const AT = 1_700_000_000
  const key = `${ACCOUNT}-${ORIGIN}-${OP_USDC}`

  test('a wallet withdraw books its amount leaving the account', async () => {
    const store = openStore()
    await foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.UserAccount.withdraw, [OP_USDC, 100_000_000n], AT, 1))
    expect(store.rowsOf(flowTable).map(row => [row.account, row.token, row.amount])).toEqual([[ACCOUNT, OP_USDC, -100_000_000n]])
  })

  test('a return request moves nothing, and a return pays out exactly the open escrow or halts', async () => {
    const store = openStore()
    store.set(escrowTable, { owner: ACCOUNT, chainId: BigInt(ORIGIN), token: OP_USDC, escrowed: 300n, released: 100n, returned: 0n })
    await foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.LiquidityGate.requestReturn, [OP_USDC, BigInt(AT) + 86_400n], AT, 1))
    expect(await store.get(escrowTable, key)).toMatchObject({ escrowed: 300n, released: 100n, returned: 0n })
    expect(store.rowsOf(flowTable)).toEqual([])
    await expect(foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.LiquidityGate.returnEscrow, [OP_USDC, 150n], AT + 86_400, 2))).rejects.toThrow('returns to a total of 150')
    await foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.LiquidityGate.returnEscrow, [OP_USDC, 200n], AT + 86_400, 3))
    expect(await store.get(escrowTable, key)).toMatchObject({ returned: 200n })
    expect(store.rowsOf(flowTable).map(row => [row.token, row.amount])).toEqual([[OP_USDC, -200n]])
    await expect(foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.LiquidityGate.returnEscrow, [OP_USDC, 200n], AT + 86_401, 4))).rejects.toThrow('0 open')
  })
})

describe('mandates', () => {
  const terms = { master: OTHER, skin: 0n, allocationRate: 5000n, exitCap: 10_000n, cooldownPeriod: 0n, expiry: 1_800_000_000n }

  test("a mandate signed under another epoch than the account's halts, and one under its epoch stores the terms", async () => {
    const store = openStore()
    await expect(
      foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.HubGate.mandate, [7n, [terms], HUB_CANONICAL_TOKEN.WETH, 1n], 1_700_000_000, 1))
    ).rejects.toThrow('mandates under epoch 7')
    await foldAccountEntry(store, recordEntry(ACCOUNT_CALL_MAP.HubGate.mandate, [0n, [terms], HUB_CANONICAL_TOKEN.WETH, 1n], 1_700_000_000, 2))
    expect(await store.get(mandateTable, `${ACCOUNT}-${OTHER}`)).toMatchObject({ allocationRate: 5000n, expiry: 1_800_000_000n, epoch: 0n })
  })
})

describe('foldTransit', () => {
  test('two Across deposits in the window: the last one is the provider leg and becomes the transit', async () => {
    const store = openStore()
    await foldAccountEntry(
      store,
      bridgeEntry([
        depositLog(0, 1n, 500_000_000n, 495_000_000n),
        accountCallLog(OTHER, 2),
        depositLog(5, 7n, 1n, 1n),
        depositLog(9, 8n, 995_000_000n, 991_000_000n),
        accountCallLog(ACCOUNT, 12)
      ])
    )
    const rows = store.rowsOf(transitTable)
    expect(rows.length).toBe(1)
    expect(rows[0]!.inputToken).toBe(OP_USDC)
    expect(rows[0]!.inputAmount).toBe(995_000_000n)
    expect(rows[0]!.outputToken).toBe(ARB_USDC)
    expect(rows[0]!.outputAmount).toBe(991_000_000n)
  })

  test('a last deposit short of the signed output halts', async () => {
    const entry = bridgeEntry([depositLog(5, 8n, 995_000_000n, 991_000_000n), depositLog(9, 9n, 1n, 1n), accountCallLog(ACCOUNT, 12)])
    await expect(foldAccountEntry(openStore(), entry)).rejects.toThrow(`against the signed ${SIGNED_OUTPUT}`)
  })
})

describe('redemption cohorts', () => {
  const MASTER = getAddress('0x00000000000000000000000000000000000000c1')
  const HOLDER = getAddress('0x00000000000000000000000000000000000000c2')
  const E17 = 10n ** 17n
  const pre = {
    id: 1n,
    fraction: 0,
    fee: 10n * E17,
    masterPay: 0n,
    queued: 1005n * E17,
    owedLeft: 1005n * E17 * 10_000n,
    potLeft: 1005n * E17,
    token: HUB_CANONICAL_TOKEN.WETH,
    price: 10n ** 12n
  }
  const cut = { ...pre, potLeft: 1000n * E17, owedLeft: 1000n * E17 * 10_000n }
  const entryOf = (account: Address, record: { selector: Hex; args: readonly { type: string }[] }, values: readonly unknown[], logIndex: number): IAccountEntry => ({
    chainId: ORIGIN,
    account,
    source: GATE,
    digest: zeroHash,
    executionData: encodeAbiParameters([{ type: 'bytes4' }, ...record.args] as never, [record.selector, ...values] as never),
    callList: [],
    resultList: [],
    balanceList: [],
    siblingLogs: [],
    block: { number: 200, timestamp: 1_700_000_200 },
    logIndex,
    transactionHash: `0x${'cd'.repeat(32)}`
  })
  const holderEntry = (queued: bigint, post: typeof pre, refused: boolean) =>
    entryOf(HOLDER, ACCOUNT_CALL_MAP.Redeem.redeemCohortHolder, [MASTER, queued, 0n, 5n * E17, 0n, 0n, post, refused], 3)
  const masterEntry = (post: typeof pre, unburned: bigint) => entryOf(MASTER, ACCOUNT_CALL_MAP.Redeem.redeemCohortMaster, [0n, 5n * E17, post, unburned], 4)
  const cohortStore = () => {
    const store = memoryStore()
    for (const account of [MASTER, HOLDER]) {
      store.set(accountTable, { chainId: BigInt(ORIGIN), account, owner: USER, epoch: 0n, revokedAt: 0, createdAt: 0, lastBlock: 1, lastLogIndex: 0 })
    }
    store.set(fundTable, { master: MASTER, shareToken: OTHER, symbol: '0x', pixels: '0x', performanceFee: 1000n, totalShares: 5000n * E17, value: 5000n * E17, averageCost: 0n, transactionHash: zeroHash, lastBlock: 1 })
    store.set(holdingTable, { master: MASTER, holder: HOLDER, shares: 2000n * E17, queued: 5n * E17, allocatedAt: 1n, redeemedAt: 0n, cost: 10n ** 12n })
    store.set(redemptionTable, { master: MASTER, ...pre, rateAmount: 1n, rateValue: 1n })
    return store
  }

  test('a claim worth at most one fee is cut: it keeps its shares and queue and books no flow of its own', async () => {
    const store = cohortStore()
    await foldAccountEntry(store, holderEntry(0n, cut, false))
    expect(await store.get(holdingTable, `${MASTER}-${HOLDER}`)).toMatchObject({ shares: 2000n * E17, queued: 5n * E17, redeemedAt: 1n })
    expect(store.rowsOf(flowTable).filter(row => isAddressEqual(row.account, HOLDER))).toEqual([])
  })

  test('a payout the token refused is cut like dust: the holder keeps its shares and queue, and a refusal on a dust claim halts', async () => {
    const store = cohortStore()
    store.set(holdingTable, { master: MASTER, holder: HOLDER, shares: 2000n * E17, queued: 500n * E17, allocatedAt: 1n, redeemedAt: 0n, cost: 10n ** 12n })
    const post = { ...pre, potLeft: 505n * E17, owedLeft: 505n * E17 * 10_000n }
    const refused = entryOf(HOLDER, ACCOUNT_CALL_MAP.Redeem.redeemCohortHolder, [MASTER, 0n, 0n, 500n * E17, 0n, 0n, post, true], 3)
    await foldAccountEntry(store, refused)
    expect(await store.get(holdingTable, `${MASTER}-${HOLDER}`)).toMatchObject({ shares: 2000n * E17, queued: 500n * E17, redeemedAt: 1n })
    expect(store.rowsOf(flowTable).filter(row => isAddressEqual(row.account, HOLDER))).toEqual([])
    await expect(foldAccountEntry(cohortStore(), holderEntry(0n, cut, true))).rejects.toThrow('with refused true where the fold plans false')
  })

  test('a cut that leaves the redemption open returns its part to the fund on a master record', async () => {
    const store = cohortStore()
    await foldAccountEntry(store, holderEntry(0n, cut, false))
    await foldAccountEntry(store, masterEntry(cut, 0n))
    const fund = await store.get(fundTable, MASTER)
    expect(fund?.value).toBe(5005n * E17)
    expect(fund?.totalShares).toBe(5000n * E17)
    expect(store.rowsOf(flowTable).filter(row => isAddressEqual(row.account, MASTER)).map(row => row.amount)).toEqual([5n * E17])
    await expect(foldAccountEntry(store, masterEntry(cut, 1n))).rejects.toThrow('cuts claims in')
  })
})

describe('escrow', () => {
  test('a native retire is wrapped: the account spends native and the escrow books WETH', async () => {
    const store = openStore()
    const weth = HUB_CANONICAL_TOKEN.WETH
    const record = ACCOUNT_CALL_MAP.LiquidityGate.retireEscrow
    await foldAccountEntry(store, {
      chainId: ORIGIN,
      account: ACCOUNT,
      source: GATE,
      digest: zeroHash,
      executionData: encodeAbiParameters([{ type: 'bytes4' }, ...record.args] as never, [record.selector, weth, 15n * 10n ** 17n, 15n * 10n ** 17n, weth, 0n] as never),
      callList: [{ target: weth, value: 15n * 10n ** 17n, gasLimit: 0n, callData: '0xd0e30db0' }],
      resultList: [],
      balanceList: [],
      siblingLogs: [],
      block: { number: 300, timestamp: 1_700_000_300 },
      logIndex: 5,
      transactionHash: `0x${'ef'.repeat(32)}`
    })
    expect(store.rowsOf(escrowTable)).toMatchObject([{ owner: ACCOUNT, token: weth, escrowed: 15n * 10n ** 17n }])
    expect(store.rowsOf(flowTable).filter(row => isAddressEqual(row.account, ACCOUNT)).map(row => [row.token, row.amount])).toEqual([
      [getAddress(PROTOCOL.nativeToken), -15n * 10n ** 17n]
    ])
  })
})
