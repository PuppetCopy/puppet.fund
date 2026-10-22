import TOKEN from '@puppet/contracts/token'
import { device } from '../../app/storage/storage.js'
import { tokenClient } from '../../wallet/wallet.js'

const { Governor, Token } = TOKEN

const SCAN_SPAN = 9_000n
const BOOK_KEY = `governance:2:${Governor.address}:book`

const scanWindow = async (fromBlock: bigint, toBlock: bigint) => {
  const span = { address: Governor.address, abi: Governor.abi, fromBlock, toBlock, strict: true } as const
  const [created, cast, castWithParams, queued, executed, canceled, delegated] = await Promise.all([
    tokenClient.getContractEvents({ ...span, eventName: 'ProposalCreated' }),
    tokenClient.getContractEvents({ ...span, eventName: 'VoteCast' }),
    tokenClient.getContractEvents({ ...span, eventName: 'VoteCastWithParams' }),
    tokenClient.getContractEvents({ ...span, eventName: 'ProposalQueued' }),
    tokenClient.getContractEvents({ ...span, eventName: 'ProposalExecuted' }),
    tokenClient.getContractEvents({ ...span, eventName: 'ProposalCanceled' }),
    tokenClient.getContractEvents({ address: Token.address, abi: Token.abi, eventName: 'DelegateVotesChanged', fromBlock, toBlock, strict: true })
  ])
  return {
    created: created.map(log => ({ ...log.args, block: log.blockNumber, tx: log.transactionHash })),
    votes: [...cast, ...castWithParams].map(log => ({
      id: log.args.proposalId,
      voter: log.args.voter,
      support: log.args.support,
      weight: log.args.weight,
      block: log.blockNumber,
      order: log.blockNumber * 100_000n + BigInt(log.logIndex)
    })),
    queued: queued.map(log => ({ id: log.args.proposalId, block: log.blockNumber, tx: log.transactionHash })),
    executed: executed.map(log => ({ id: log.args.proposalId, block: log.blockNumber, tx: log.transactionHash })),
    canceled: canceled.map(log => ({ id: log.args.proposalId, block: log.blockNumber, tx: log.transactionHash })),
    delegated: delegated.map(log => ({ delegate: log.args.delegate, votes: log.args.newVotes, order: log.blockNumber * 100_000n + BigInt(log.logIndex) }))
  }
}

export type IGovernorBook = Awaited<ReturnType<typeof scanWindow>> & { to: bigint; times: Record<string, number> }

const extendBook = async (held: IGovernorBook | null): Promise<IGovernorBook> => {
  const latest = await tokenClient.getBlockNumber()
  let book: IGovernorBook = held ?? { to: BigInt(Token.block) - 1n, times: {}, created: [], votes: [], queued: [], executed: [], canceled: [], delegated: [] }
  while (book.to < latest) {
    const from = book.to + 1n
    const to = from + SCAN_SPAN - 1n < latest ? from + SCAN_SPAN - 1n : latest
    const next = await scanWindow(from, to)
    const blocks = [...new Set([...next.created, ...next.queued, ...next.executed, ...next.canceled].map(row => row.block))]
    const stamps = await Promise.all(blocks.map(blockNumber => tokenClient.getBlock({ blockNumber }).then(block => [String(blockNumber), Number(block.timestamp)] as const)))
    book = {
      to,
      times: { ...book.times, ...Object.fromEntries(stamps) },
      created: [...book.created, ...next.created],
      votes: [...book.votes, ...next.votes],
      queued: [...book.queued, ...next.queued],
      executed: [...book.executed, ...next.executed],
      canceled: [...book.canceled, ...next.canceled],
      delegated: [...book.delegated, ...next.delegated]
    }
  }
  return book
}

export const readGovernorBook = (): Promise<IGovernorBook> =>
  device
    .read<IGovernorBook>(BOOK_KEY)
    .then(held => extendBook(held === null ? null : held.value))
    .then(async book => {
      await device.write(BOOK_KEY, book)
      return book
    })
