import { FULL_ACCESS, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import TOKEN, { TOKEN_CHAIN_ID } from '@puppet/contracts/token'
import type { IConnectedWallet } from '@puppet/sdk/client'
import { formatThrownError } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { formatFixed, getAccountExplorerUrl, getTxExplorerUrl, readableAddress, readableDate, readableUnitAmount } from '@puppet/sdk/core'
import { decodeProposal, type IProposalAction, type IProposalCall } from '@puppet/sdk/governance'
import { combine, constant, empty, filter, filterNull, fromPromise, type IStream, just, map, merge, nowWith, op, periodic, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, type PromiseStateDone, PromiseStatus, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, type I$Slottable, type INode, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href } from 'aelea/ui-router'
import {
  type Address,
  BaseError,
  concat,
  decodeEventLog,
  encodeFunctionData,
  ExecutionRevertedError,
  getAddress,
  type Hex,
  hexToBigInt,
  InsufficientFundsError,
  isAddressEqual,
  keccak256,
  type Log,
  numberToHex,
  pad,
  parseAbi,
  parseAbiItem,
  type PublicClient,
  size,
  slice,
  stringToHex,
  toEventSelector,
  toRlp,
  TransactionReceiptNotFoundError,
  TransactionRejectedRpcError,
  trim,
  type WalletClient,
  zeroAddress,
  zeroHash
} from 'viem'
import { getL2TransactionHashes } from 'viem/op-stack'
import { mainnet } from 'viem/chains'
import {
  $anchor,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonSecondary,
  $detailLine,
  $dot,
  $externalMark,
  $github,
  $icon,
  $infoTooltip,
  $intermediateText,
  $Tooltip,
  $tooltipDropContainer,
  intermediateState,
  SEPARATOR_COLOR,
  softNavClick,
  text,
  $tick
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { device } from '../app/storage/storage.js'
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainName } from '../common/$chain.js'
import { $tokenMark } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $card } from '../common/elements/$common.js'
import { $addressLink } from '../components/$AccountProfile.js'
import { $avatarStack } from '../components/$avatarStack.js'
import { $holderRow } from '../components/$holderRow.js'
import { type IGovernorBook, readGovernorBook } from '../io/chain/governor.js'
import { answerState, localFirst, notLocal } from '../io/datastore/reads.js'
import { priceFor, usdOf } from '../io/price.js'
import { appClientMap, tokenClient as client } from '../wallet/wallet.js'
import { $caption, $section, $sectionHeader, $sectionList, shortDuration } from './common.js'

const { Governor, Release, Token } = TOKEN

const BLOCK_MS = 12_000
const VIEW_KEY = `governance:3:${Governor.address}:view`
const EXPLORER = mainnet.blockExplorers.default.url
const STATES = [
  { label: 'Pending', note: 'Voting has not opened yet' },
  { label: 'Active', note: 'Voting is open' },
  { label: 'Canceled', note: 'Canceled before it could execute' },
  { label: 'Defeated', note: 'Missed quorum or two thirds For' },
  { label: 'Succeeded', note: 'Passed, anyone can execute it' },
  { label: 'Queued', note: 'Waiting to execute' },
  { label: 'Expired', note: 'Passed but was not executed in time' },
  { label: 'Executed', note: 'The Governor ran its actions' }
] as const
const UNSETTLED = new Set([0, 1, 4, 5])


const simulate = (to: Address, value: bigint, data: Hex) =>
  client.call({ account: Governor.address, to, value, data }).then(
    () => ({ kind: 'success' as const }),
    (err: unknown) => {
      const failure =
        err instanceof BaseError
          ? err.walk(cause => cause instanceof ExecutionRevertedError || cause instanceof InsufficientFundsError || cause instanceof TransactionRejectedRpcError)
          : null
      if (!(failure instanceof BaseError)) throw err
      return { kind: 'revert' as const, reason: failure instanceof TransactionRejectedRpcError ? failure.details : failure.shortMessage }
    }
  )

const readView = async (book: IGovernorBook) => {
  const head = await client.getBlock()
  const timeOf = (row: { id: bigint; block: bigint } | undefined): number | null => (row === undefined ? null : (book.times[String(row.block)] ?? null))
  const proposals = await Promise.all(
    book.created.map(async created => {
      const id = created.proposalId
      const snapshotPassed = created.voteStart < head.timestamp
      const [stateIndex, [against, inFavor, abstain], quorum, superQuorum] = await Promise.all([
        client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'state', args: [id] }),
        client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'proposalVotes', args: [id] }),
        snapshotPassed ? client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'quorum', args: [created.voteStart] }) : Promise.resolve(null),
        snapshotPassed ? client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'superQuorum', args: [created.voteStart] }) : Promise.resolve(null)
      ])
      const voters = book.votes.filter(row => row.id === id).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      let settledBlock: bigint | null = null
      if (superQuorum !== null) {
        let inFavorSoFar = 0n
        let againstSoFar = 0n
        for (const row of voters) {
          if (row.support === 1) inFavorSoFar += row.weight
          if (row.support === 0) againstSoFar += row.weight
          if (inFavorSoFar >= superQuorum && 3n * inFavorSoFar >= 2n * (inFavorSoFar + againstSoFar)) {
            settledBlock = row.block
            break
          }
        }
      }
      const settledAt =
        settledBlock === null
          ? null
          : (book.times[String(settledBlock)] ?? Number((await client.getBlock({ blockNumber: settledBlock })).timestamp))
      return {
        ...created,
        id,
        state: stateIndex,
        tally: { against, inFavor, abstain },
        quorum,
        superQuorum,
        settledAt,
        createdAt: book.times[String(created.block)] ?? null,
        queuedAt: timeOf(book.queued.find(row => row.id === id)),
        executedAt: timeOf(book.executed.find(row => row.id === id)),
        canceledAt: timeOf(book.canceled.find(row => row.id === id)),
        executedTx: book.executed.find(row => row.id === id)?.tx ?? null,
        simulation: UNSETTLED.has(stateIndex)
          ? await Promise.all(created.targets.map((target, i) => simulate(target, created.values[i]!, created.calldatas[i]!)))
          : null,
        voters
      }
    })
  )
  const latest = new Map<Address, { votes: bigint; order: bigint }>()
  for (const row of book.delegated) {
    const held = latest.get(row.delegate)
    if (held === undefined || held.order < row.order) latest.set(row.delegate, row)
  }
  const [eth, puppet, decimals, symbol, supply, quorumDenominator, release] = await Promise.all([
    client.getBalance({ address: Governor.address }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'balanceOf', args: [Governor.address] }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'decimals' }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'symbol' }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'totalSupply' }),
    client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'quorumDenominator' }),
    client.readContract({ address: Release.address, abi: Release.abi, functionName: 'current' })
  ])
  return {
    now: Number(head.timestamp),
    proposals: proposals.reverse(),
    delegates: [...latest]
      .filter(([, row]) => row.votes > 0n)
      .map(([delegate, row]) => ({ delegate, votes: row.votes }))
      .sort((a, b) => (b.votes > a.votes ? 1 : b.votes < a.votes ? -1 : 0)),
    treasury: { eth, puppet },
    token: { decimals, symbol, supply },
    quorumDenominator,
    release
  }
}

type IView = Awaited<ReturnType<typeof readView>>
type IProposal = IView['proposals'][number]

const readBallot = async (account: Address, view: IView) => {
  const [votes, delegate, balance, proposals] = await Promise.all([
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'getVotes', args: [account] }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'delegates', args: [account] }),
    client.readContract({ address: Token.address, abi: Token.abi, functionName: 'balanceOf', args: [account] }),
    Promise.all(
      view.proposals.map(async proposal => ({
        id: proposal.id,
        weight:
          Number(proposal.voteStart) < view.now
            ? await client.readContract({ address: Token.address, abi: Token.abi, functionName: 'getPastVotes', args: [account, proposal.voteStart] })
            : null,
        voted: await client.readContract({ address: Governor.address, abi: Governor.abi, functionName: 'hasVoted', args: [proposal.id, account] })
      }))
    )
  ])
  return { account, votes, delegate, balance, proposals }
}

type IBallot = Awaited<ReturnType<typeof readBallot>>

const readFresh = (): Promise<IView> =>
  readGovernorBook().then(async book => {
    const view = await readView(book)
    await device.write(VIEW_KEY, view)
    return view
  })

const readLocal = (): Promise<IView> => device.read<IView>(VIEW_KEY).then(held => (held === null ? notLocal : held.value))

const send = async (pending: Promise<IConnectedWallet | null>, write: (wallet: WalletClient) => Promise<Hex>): Promise<Hex> => {
  const connected = await pending
  if (connected === null) throw new Error('Connect a wallet first')
  const hash = await write(await connected.switchChain(mainnet.id))
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`The transaction reverted (${hash})`)
  return hash
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const amountOf = (view: IView, amount: bigint): string => COMPACT.format(formatFixed(view.token.decimals, amount))
const titleOf = (description: string): string => description.split('\n')[0]!.trim()
const bodyOf = (description: string): string => description.split('\n').slice(1).join('\n').trim()
const dateOf = (at: number): string => `${readableDate(at, { dateStyle: 'medium' })} · ${readableDate(at, { timeStyle: 'short' })}`
const TIMELINE_DIM = `color-mix(in srgb, ${palette.foreground} 35%, transparent)`
const shortId = (id: bigint): string => {
  const digits = id.toString()
  return digits.length > 12 ? `${digits.slice(0, 6)}…${digits.slice(-4)}` : digits
}
const proposalOf = (view: IView, id: bigint): IProposal => {
  const found = view.proposals.find(proposal => proposal.id === id)
  if (found === undefined) throw new Error(`proposal ${id} is not on chain`)
  return found
}
const SIDES = [
  { support: 1, label: 'For', tone: palette.positive },
  { support: 0, label: 'Against', tone: palette.negative },
  { support: 2, label: 'Abstain', tone: palette.foreground }
] as const
const toneOf = (stateIndex: number): string =>
  stateIndex === 1 ? palette.primary : stateIndex === 4 || stateIndex === 5 || stateIndex === 7 ? palette.positive : stateIndex === 0 ? palette.foreground : palette.negative
const passes = (proposal: IProposal): boolean =>
  proposal.tally.inFavor > 0n && 3n * proposal.tally.inFavor >= 2n * (proposal.tally.inFavor + proposal.tally.against)
const quorumMet = (proposal: IProposal): boolean | null =>
  proposal.quorum === null ? null : proposal.tally.inFavor + proposal.tally.abstain >= proposal.quorum
const votersOf = (proposal: IProposal): number => new Set(proposal.voters.map(row => row.voter)).size
const totalOf = (tally: IProposal['tally']): bigint => tally.inFavor + tally.against + tally.abstain

const UNITS: Record<string, Record<string, 'puppet' | 'seconds' | 'quorum'>> = {
  Token: { value: 'puppet', amount: 'puppet' },
  Governor: { newProposalThreshold: 'puppet', newVotingDelay: 'seconds', newVotingPeriod: 'seconds', newQuorumNumerator: 'quorum', newSuperQuorumNumerator: 'quorum' }
}

type IArg = NonNullable<IProposalCall['fn']>['args'][number]

const argText = (view: IView, call: IProposalCall, arg: IArg): string => {
  const unit = call.name === null ? undefined : UNITS[call.name]?.[arg.name]
  if (arg.type === 'bytes4') return arg.label !== null ? arg.label.slice(0, arg.label.indexOf('(')) : arg.value === FULL_ACCESS ? 'FULL_ACCESS' : arg.value === '0x00000000' ? 'none' : String(arg.value)
  if (arg.label !== null) return arg.label
  if (arg.type === 'address' && typeof arg.value === 'string') return readableAddress(arg.value as Address)
  if (unit === 'seconds' && (typeof arg.value === 'bigint' || typeof arg.value === 'number')) return shortDuration(Number(arg.value))
  if (typeof arg.value === 'bigint') {
    if (unit === 'puppet') return `${readableUnitAmount(formatFixed(view.token.decimals, arg.value))} ${view.token.symbol}`
    if (unit === 'quorum') return `${readableUnitAmount(formatFixed(view.token.decimals, (arg.value * view.token.supply) / view.quorumDenominator))} ${view.token.symbol}`
    return arg.value.toLocaleString('en-US')
  }
  if (typeof arg.value === 'string' && arg.value.startsWith('0x')) {
    const bytes = arg.value as Hex
    return size(bytes) > 8 ? `${slice(bytes, 0, 4)}… (${size(bytes)} bytes)` : bytes
  }
  return JSON.stringify(arg.value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))
}

const nativeText = (chainId: number, value: bigint): string =>
  `${readableUnitAmount(formatFixed(chainFor(chainId).nativeCurrency.decimals, value))} ${chainFor(chainId).nativeCurrency.symbol}`

const callText = (view: IView, call: IProposalCall): string => {
  const target = call.name ?? readableAddress(call.target)
  if (size(call.data) === 0) return call.value > 0n ? `${target}.transfer(${nativeText(call.chainId, call.value)})` : `${target}.call()`
  const options = call.value > 0n ? `{value: ${nativeText(call.chainId, call.value)}}` : ''
  if (call.fn === null) return `${target}.${slice(call.data, 0, 4)}${options}(…)`
  return `${target}.${call.fn.name}${options}(${call.fn.args.map(arg => `${arg.name === '' ? '' : `${arg.name}=`}${argText(view, call, arg)}`).join(', ')})`
}

const actionsText = (view: IView, proposal: IProposal): string => {
  let actions: IProposalAction[]
  try {
    actions = decodeProposal(proposal.targets, proposal.values, proposal.calldatas)
  } catch (err) {
    return `Undecodable: ${formatThrownError(err)}`
  }
  return actions
    .map(action =>
      action.kind === 'call'
        ? callText(view, action.call)
        : `${chainName(action.chainId)}: ${action.batch === null ? 'not the GovernorAccount' : `${action.batch.callList.length} ${action.batch.callList.length === 1 ? 'call' : 'calls'}`}`
    )
    .join(' · ')
}

const $actionsSummary = (view: IView, proposal: IProposal): I$Node => {
  let actions: IProposalAction[]
  try {
    actions = decodeProposal(proposal.targets, proposal.values, proposal.calldatas)
  } catch (err) {
    return $node($text(`Undecodable: ${formatThrownError(err)}`))
  }
  const $clipped = (label: string): I$Node => $node(style({ minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(label))
  return $row(spacing.small, style({ alignItems: 'center', minWidth: '0', overflow: 'hidden' }))(
    ...actions.map(action => {
      if (action.kind === 'call') return $clipped(callText(view, action.call))
      const [only, ...more] = action.batch === null ? [] : action.batch.callList
      const label = action.batch === null ? 'not the GovernorAccount' : only !== undefined && more.length === 0 ? callText(view, only) : `${action.batch.callList.length} calls`
      return $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0' }))($chainIcon(action.chainId, 14), $clipped(label))
    })
  )
}

const SOURCE_PARAGRAPH = /^Source:\s*(https:\/\/github\.com\/\S+?\/tree\/([0-9a-f]{7,40})\S*)$/

const $descriptionBody = (body: string): I$Node =>
  $column(spacing.small, style({ fontSize: text.sm, lineHeight: '1.6' }))(
    ...body.split(/\n{2,}/).map(paragraph => {
      const source = SOURCE_PARAGRAPH.exec(paragraph.trim())
      const url = source?.[1]
      const commit = source?.[2]
      if (url === undefined || commit === undefined) return $node(style({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }))($text(paragraph))
      return $anchor(
        attr({ href: url, target: '_blank', rel: 'noopener noreferrer' }),
        style({ display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content', padding: '4px 10px', borderRadius: '999px', border: `1px solid ${SEPARATOR_COLOR}`, color: palette.message, fontSize: text.xs, textDecoration: 'none' })
      )(
        $icon({ $content: $github, width: '14px', viewBox: '0 0 32 32' }),
        $node($text('Source')),
        $node(style({ fontFamily: 'var(--font-numbers)' }))($text(commit.slice(0, 7))),
        $externalMark()
      )
    })
  )

const $title = (label: string): I$Node => $node(style({ fontSize: text.base, color: palette.message }))($text(label))

const $explorerLink = (path: string, $label: I$Node): I$Node =>
  $anchor(attr({ href: `${EXPLORER}/${path}`, target: '_blank' }), style({ display: 'inline-flex', alignItems: 'center', gap: '4px', color: palette.message, minWidth: '0' }))($label, $externalMark())

const $addressMark = (chainId: number, address: Address, name: string | null): I$Node =>
  $anchor(
    attr({ href: getAccountExplorerUrl(address, chainFor(chainId)), target: '_blank' }),
    style({ display: 'inline-flex', alignItems: 'center', gap: '4px', color: palette.message, minWidth: '0' })
  )(
    $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0' }))(
      $jazzicon(address, 20),
      $node(style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(name ?? readableAddress(address)))
    ),
    $externalMark()
  )

const $codeLink = (chainId: number, address: Address, label: string): I$Node =>
  $element('a')(
    attr({ href: getAccountExplorerUrl(address, chainFor(chainId)), target: '_blank', rel: 'noopener noreferrer' }),
    style({ color: palette.message }),
    stylePseudo(':hover', { color: palette.primary })
  )($text(label))

const $codeDim = (label: string): I$Node => $element('span')(style({ color: palette.foreground }))($text(label))

const $codeComment = (color: string, ...$parts: I$Slottable[]): I$Node =>
  $element('span')($text(' '), $element('span')(style({ color, whiteSpace: 'nowrap' }))($text('// '), ...$parts))

const $callNote = (call: IProposalCall): I$Node => {
  if (size(call.data) === 0) return call.value > 0n ? empty : $codeComment(palette.foreground, $text('no on-chain effect'))
  return call.fn === null ? $codeComment(palette.foreground, $text(`${size(call.data)} bytes, not decoded`)) : empty
}

const $callLine = (view: IView, call: IProposalCall): I$Node => {
  const $method = (name: string): I$Node => $element('span')(style({ color: palette.primary }))($text(name))
  const $value = (label: string, title: string | null): I$Node => $element('span')(attr({ title }), style({ color: palette.message }))($text(label))
  const options = call.value > 0n && size(call.data) > 0 ? [$codeDim('{value: '), $value(nativeText(call.chainId, call.value), null), $codeDim('}')] : []
  const invocation =
    size(call.data) === 0
      ? call.value > 0n
        ? [$method('transfer'), $codeDim('('), $value(nativeText(call.chainId, call.value), null), $codeDim(')')]
        : [$method('call'), $codeDim('()')]
      : call.fn === null
        ? [$method(slice(call.data, 0, 4)), ...options, $codeDim('(…)')]
        : [
            $method(call.fn.name),
            ...options,
            $codeDim('('),
            ...call.fn.args.flatMap((arg, i) => [
              ...(i === 0 ? [] : [$codeDim(', ')]),
              ...(arg.name === '' ? [] : [$codeDim(`${arg.name}=`)]),
              arg.type === 'address' && typeof arg.value === 'string'
                ? $codeLink(call.chainId, arg.value as Address, arg.label ?? readableAddress(arg.value as Address))
                : $value(argText(view, call, arg), arg.type === 'bytes4' ? arg.label : null)
            ]),
            $codeDim(')')
          ]
  return $node(style({ fontFamily: 'monospace', fontSize: text.sm, lineHeight: '1.6', color: palette.message, overflowWrap: 'anywhere' }))(
    $codeLink(call.chainId, call.target, call.name ?? readableAddress(call.target)),
    $codeDim('.'),
    ...invocation,
    $callNote(call)
  )
}

type ILanding = { kind: 'executed' | 'failed'; tx: Hex | null } | { kind: 'pending' }

const INBOX_DELIVERED = parseAbiItem('event InboxMessageDelivered(uint256 indexed messageNum, bytes data)')
const MESSAGE_DELIVERED = parseAbiItem(
  'event MessageDelivered(uint256 indexed messageIndex, bytes32 indexed beforeInboxAcc, address inbox, uint8 kind, address sender, bytes32 messageDataHash, uint256 baseFeeL1, uint64 timestamp)'
)
const REDEEM_SCHEDULED = parseAbiItem(
  'event RedeemScheduled(bytes32 indexed ticketId, bytes32 indexed retryTxHash, uint64 indexed sequenceNum, uint64 donatedGas, address gasDonor, uint256 maxRefund, uint256 submissionFeeRefund)'
)
const STATE_SYNCED = parseAbiItem('event StateSynced(uint256 indexed id, address indexed contractAddress, bytes data)')
const STATE_RECEIVER = '0x0000000000000000000000000000000000001001'
const STATE_RECEIVER_ABI = parseAbi(['function lastStateId() view returns (uint256)', 'function failedStateSyncs(uint256) view returns (bytes)'])

const receiptOrNull = (reader: PublicClient, hash: Hex) =>
  reader.getTransactionReceipt({ hash }).catch((err: unknown) => {
    if (err instanceof TransactionReceiptNotFoundError) return null
    throw err
  })

const minimalHex = (value: bigint): Hex => (value === 0n ? '0x' : trim(numberToHex(value, { size: 32 })))

const retryableTicketOf = (chainId: number, inbox: Address, logs: readonly Log[], k: number): Hex => {
  const delivered = logs.filter(log => isAddressEqual(log.address, inbox) && log.topics[0] === toEventSelector(INBOX_DELIVERED))[k]
  if (delivered === undefined) throw new Error(`the execution tx sends no retryable ${k + 1} to chain ${chainId}`)
  const message = decodeEventLog({ abi: [INBOX_DELIVERED], data: delivered.data, topics: delivered.topics }).args
  const meta = logs
    .filter(log => log.topics[0] === toEventSelector(MESSAGE_DELIVERED))
    .map(log => decodeEventLog({ abi: [MESSAGE_DELIVERED], data: log.data, topics: log.topics }).args)
    .find(args => args.messageIndex === message.messageNum && isAddressEqual(args.inbox, inbox))
  if (meta === undefined) throw new Error(`the execution tx delivers retryable ${message.messageNum} to chain ${chainId} with no bridge record`)
  const data = message.data
  const word = (i: number): bigint => hexToBigInt(slice(data, i * 32, (i + 1) * 32))
  const address = (i: number): Address => getAddress(slice(data, i * 32 + 12, (i + 1) * 32))
  const length = Number(word(8))
  return keccak256(
    concat([
      '0x69',
      toRlp([
        minimalHex(BigInt(chainId)),
        pad(numberToHex(message.messageNum), { size: 32 }),
        meta.sender,
        minimalHex(meta.baseFeeL1),
        minimalHex(word(2)),
        minimalHex(word(7)),
        minimalHex(word(6)),
        isAddressEqual(address(0), zeroAddress) ? '0x' : address(0),
        minimalHex(word(1)),
        address(5),
        minimalHex(word(3)),
        address(4),
        length === 0 ? '0x' : slice(data, 9 * 32, 9 * 32 + length)
      ])
    ])
  )
}

const landingsOf = async (executedTx: Hex, proposal: Pick<IProposal, 'targets' | 'values' | 'calldatas'>): Promise<(ILanding | null)[]> => {
  const actions = decodeProposal(proposal.targets, proposal.values, proposal.calldatas)
  const { logs } = await client.getTransactionReceipt({ hash: executedTx })
  const sent = new Map<Address, number>()
  return Promise.all(
    actions.map(async (action): Promise<ILanding | null> => {
      if (action.kind !== 'bridged' || action.batch === null) return null
      const bridge = getAddress(action.bridge.target)
      const k = sent.get(bridge) ?? 0
      sent.set(bridge, k + 1)
      const reader = appClientMap[action.chainId as ChainId]
      if (action.bridge.fn.name === 'depositTransaction') {
        const hash = getL2TransactionHashes({ logs: logs.filter(log => isAddressEqual(log.address, bridge)) })[k]
        if (hash === undefined) throw new Error(`the execution tx sends no deposit ${k + 1} to chain ${action.chainId}`)
        const landed = await receiptOrNull(reader, hash)
        return landed === null ? { kind: 'pending' } : { kind: landed.status === 'success' ? 'executed' : 'failed', tx: hash }
      }
      if (action.bridge.fn.name === 'createRetryableTicket') {
        const ticket = retryableTicketOf(action.chainId, bridge, logs, k)
        const submitted = await receiptOrNull(reader, ticket)
        if (submitted === null) return { kind: 'pending' }
        const scheduled = submitted.logs.find(log => log.topics[0] === toEventSelector(REDEEM_SCHEDULED))
        if (scheduled === undefined) return { kind: 'failed', tx: ticket }
        const retry = decodeEventLog({ abi: [REDEEM_SCHEDULED], data: scheduled.data, topics: scheduled.topics }).args.retryTxHash
        const redeemed = await receiptOrNull(reader, retry)
        return redeemed === null ? { kind: 'pending' } : { kind: redeemed.status === 'success' ? 'executed' : 'failed', tx: retry }
      }
      if (action.bridge.fn.name === 'sendMessageToChild') {
        const synced = logs.filter(log => log.topics[0] === toEventSelector(STATE_SYNCED))[k]
        if (synced === undefined) throw new Error(`the execution tx syncs no state ${k + 1} to chain ${action.chainId}`)
        const id = decodeEventLog({ abi: [STATE_SYNCED], data: synced.data, topics: synced.topics }).args.id
        const last = await reader.readContract({ address: STATE_RECEIVER, abi: STATE_RECEIVER_ABI, functionName: 'lastStateId' })
        if (last < id) return { kind: 'pending' }
        const failed = await reader.readContract({ address: STATE_RECEIVER, abi: STATE_RECEIVER_ABI, functionName: 'failedStateSyncs', args: [id] })
        return { kind: failed === '0x' ? 'executed' : 'failed', tx: null }
      }
      return null
    })
  )
}

const $landing = (chainId: number, landing: ILanding | null, deadline: bigint, account: Address | null): I$Node => {
  if (landing === null) return empty
  if (landing.kind === 'pending') return $caption(BigInt(Math.floor(Date.now() / 1000)) > deadline ? 'Expired' : 'Not landed yet')
  const $label = $row(spacing.small, style({ alignItems: 'center' }))(
    $dot(landing.kind === 'executed' ? palette.positive : palette.negative),
    $node($text(landing.kind === 'executed' ? 'Executed' : 'Failed'))
  )
  const href = landing.tx !== null ? getTxExplorerUrl(landing.tx, chainFor(chainId)) : account === null ? null : getAccountExplorerUrl(account, chainFor(chainId))
  return href === null
    ? $label
    : $anchor(attr({ href, target: '_blank', rel: 'noopener noreferrer' }), style({ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: text.sm, color: palette.message }))(
        $label,
        $externalMark()
      )
}

const $badge = (stateIndex: number): I$Node =>
  $node(
    style({
      fontSize: text.xs,
      fontWeight: '600',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      borderRadius: '6px',
      whiteSpace: 'nowrap',
      color: toneOf(stateIndex),
      backgroundColor: `color-mix(in srgb, ${toneOf(stateIndex)} 14%, transparent)`
    })
  )($text(STATES[stateIndex]?.label ?? 'Unknown'))

const $tallyBar = (tally: IProposal['tally']): I$Node => {
  const total = totalOf(tally)
  const share = (part: bigint): string => (total === 0n ? '0%' : `${Number((part * 10_000n) / total) / 100}%`)
  return $row(style({ height: '2px', borderRadius: '1px', overflow: 'hidden', backgroundColor: SEPARATOR_COLOR, width: '100%' }))(
    $node(style({ width: share(tally.inFavor), backgroundColor: palette.positive }))(),
    $node(style({ width: share(tally.against), backgroundColor: palette.negative }))(),
    $node(style({ width: share(tally.abstain), backgroundColor: palette.foreground }))()
  )
}

const $tallyLine = (view: IView, tally: IProposal['tally']): I$Node =>
  $row(spacing.tiny, style({ fontSize: text.sm, fontFamily: 'var(--font-numbers)', whiteSpace: 'nowrap' }))(
    $node(style({ color: palette.positive }))($text(amountOf(view, tally.inFavor))),
    $node(style({ color: palette.foreground }))($text('·')),
    $node(style({ color: palette.negative }))($text(amountOf(view, tally.against))),
    $node(style({ color: palette.foreground }))($text('·')),
    $node(style({ color: palette.foreground }))($text(amountOf(view, tally.abstain)))
  )

const $tile = (label: string, $value: I$Node, $note: I$Node, tooltip: string, ...$lines: I$Node[]): I$Node =>
  $card(spacing.tiny)(
    $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))($node($text(label)), $infoTooltip(tooltip)),
    $node(style({ fontSize: '1.6em', fontWeight: '700', fontFamily: 'var(--font-numbers)', color: palette.message }))($value),
    ...[$note, ...$lines].map($line => $node(style({ fontSize: text.xs, color: palette.foreground }))($line))
  )

const $panel = (label: string, ...$children: I$Node[]): I$Node => $card(spacing.default)($title(label), ...$children)

const $metaField = (label: string, $value: I$Node): I$Node =>
  $column(spacing.tiny, style({ minWidth: '0' }))($node(style({ fontSize: text.xs, color: palette.foreground }))($text(label)), $value)

export interface I$Governance {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  selected: IStream<bigint | null>
}

export const $Governance = ({ walletQuery, selected }: I$Governance) =>
  component(
    (
      [unsettled, unsettledTether]: IBehavior<INode, boolean>,
      [act, actTether]: IBehavior<PointerEvent, (wallet: Promise<IConnectedWallet | null>) => Promise<Hex>>
    ) => {
      const acting: IStream<Promise<Hex>> = op(
        act,
        sampleMap((wallet: Promise<IConnectedWallet | null>, run: (wallet: Promise<IConnectedWallet | null>) => Promise<Hex>) => run(wallet), walletQuery),
        state()
      )
      const landed = op(
        acting,
        switchMap(pending => fromPromise(pending.then(() => true, () => true)))
      )
      const tick = op(
        unsettled,
        skipRepeats,
        switchMap(open => (open ? op(periodic(BLOCK_MS), filter(() => document.visibilityState === 'visible')) : empty))
      )
      const view: IStream<Promise<IView>> = answerState(merge(localFirst(readLocal, readFresh), op(merge(tick, landed), map(() => readFresh()))))
      const settledView: IStream<IView> = op(
        intermediateState(view),
        filter((s): s is PromiseStateDone<IView> => s.status === PromiseStatus.DONE),
        map(s => s.value),
        state()
      )
      const ballot: IStream<Promise<IBallot | null>> = answerState(
        op(
          merge(view, op(walletQuery, sampleMap((current: Promise<IView>) => current, view))),
          sampleMap((wallet: Promise<IConnectedWallet | null>, current: Promise<IView>) => wallet.then(connected => (connected === null ? null : current.then(v => readBallot(connected.address, v)))), walletQuery)
        )
      )
      const settledBallot: IStream<IBallot | null> = op(
        intermediateState(ballot),
        filter((s): s is PromiseStateDone<IBallot | null> => s.status === PromiseStatus.DONE),
        map(s => s.value),
        state()
      )
      const clock: IStream<number> = op(periodic(1000), map(() => Math.floor(Date.now() / 1000)))
      const figure = (pick: (v: IView) => string): I$Node => $intermediateText(map(p => p.then(pick), view))
      const settledRender = ($placeholder: I$Node, render: (v: IView) => I$Node): I$Node => switchLatest(start($placeholder, map(render, settledView)))

      const $watch = $node(
        style({ display: 'none' }),
        unsettledTether(() => op(view, switchMap(p => fromPromise(p.then(v => v.proposals.some(proposal => UNSETTLED.has(proposal.state)), () => true)))))
      )()

      const $delegateBoard = (v: IView, ballot: IBallot | null): I$Node => {
        const total = v.delegates.reduce((sum, row) => sum + row.votes, 0n)
        const $delegate = (account: Address, votes: bigint, isYou: boolean, $caption: I$Node | null): I$Node =>
          $holderRow({
            hideBalances: just(false),
            pool: just({ totalShares: total, owned: votes, value: `${amountOf(v, votes)} ${v.token.symbol}`, after: null }),
            wallet: account,
            href: getAccountExplorerUrl(account, mainnet),
            external: true,
            badge: null,
            isYou,
            held: votes,
            exiting: null,
            $caption,
            title: 'Open on Etherscan'
          })
        const others = v.delegates.filter(row => ballot === null || !isAddressEqual(row.delegate, ballot.account)).slice(0, 10)
        if (ballot === null && others.length === 0) return $caption('No delegated votes yet')
        const $you = (b: IBallot): I$Node => {
          const toSelf = isAddressEqual(b.delegate, b.account)
          const delegation = toSelf ? 'delegated to yourself' : isAddressEqual(b.delegate, zeroAddress) ? 'not delegated' : `delegated to ${readableAddress(b.delegate)}`
          return $delegate(
            b.account,
            b.votes,
            true,
            $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.xs, color: palette.foreground }))(
              $node($text(`${amountOf(v, b.balance)} ${v.token.symbol} held, ${delegation}`)),
              b.balance > 0n && !toSelf
                ? $actButton('Delegate to yourself', wallet =>
                    send(wallet, w => w.writeContract({ address: Token.address, abi: Token.abi, functionName: 'delegate', args: [b.account], chain: mainnet, account: w.account! }))
                  )
                : empty
            )
          )
        }
        return $column(spacing.default)(...(ballot === null ? [] : [$you(ballot)]), ...others.map(row => $delegate(row.delegate, row.votes, false, null)))
      }

      const $actButton = (label: string, run: (wallet: Promise<IConnectedWallet | null>) => Promise<Hex>): I$Node =>
        $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text(label) })({ click: actTether(constant(run)) })

      const proposalIds = op(
        settledView,
        map(v => v.proposals.map(proposal => proposal.id)),
        skipRepeatsWith((a, b) => a.length === b.length && a.every((id, i) => id === b[i]))
      )

      const $proposalRow = (id: bigint): I$Node =>
        $defaultAnchor(
          attr({ href: `${href(routeSchema.governance)}/${id}` }),
          softNavClick(`${href(routeSchema.governance)}/${id}`),
          style({
            display: 'grid',
            gridTemplateColumns: isDesktopScreen ? 'minmax(0, 1fr) 100px' : 'minmax(0, 1fr)',
            alignItems: 'center',
            gap: isDesktopScreen ? '24px' : '8px',
            padding: '14px 0',
            color: 'inherit',
            textDecoration: 'none',
            borderBottom: `1px solid ${SEPARATOR_COLOR}`
          })
        )(
          $column(spacing.tiny, style({ minWidth: '0' }))(
            $node(style({ fontWeight: '600', color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(figure(v => titleOf(proposalOf(v, id).description))),
            $row(spacing.small, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, minWidth: '0' }))(
              settledRender($badge(0), v => $badge(proposalOf(v, id).state)),
              $node(style({ whiteSpace: 'nowrap' }))(
                figure(v => {
                  const at = proposalOf(v, id).createdAt
                  return at === null ? '-' : readableDate(at, { dateStyle: 'medium' })
                })
              ),
              settledRender(empty, v =>
                $node(attr({ title: actionsText(v, proposalOf(v, id)) }), style({ minWidth: '0', overflow: 'hidden', color: palette.message }))($actionsSummary(v, proposalOf(v, id)))
              )
            )
          ),
          settledRender($column(spacing.tiny)($caption('-'), $tallyBar({ inFavor: 0n, against: 0n, abstain: 0n })), v => {
            const proposal = proposalOf(v, id)
            const met = quorumMet(proposal)
            const counted = proposal.tally.inFavor + proposal.tally.against
            const share = counted === 0n ? 0 : Number((proposal.tally.inFavor * 10_000n) / counted) / 100
            return $Tooltip({
              $dropContainer: $tooltipDropContainer,
              $content: $column(spacing.tiny)(
                $detailLine(
                  'Quorum',
                  `${amountOf(v, proposal.tally.inFavor + proposal.tally.abstain)} of ${proposal.quorum === null ? '-' : amountOf(v, proposal.quorum)}`,
                  met === null ? palette.message : met ? palette.positive : palette.negative
                ),
                $detailLine('Two thirds For', `${share}%`, passes(proposal) ? palette.positive : palette.negative),
                ...SIDES.map(sideOption =>
                  $detailLine(
                    sideOption.label,
                    amountOf(v, sideOption.support === 1 ? proposal.tally.inFavor : sideOption.support === 0 ? proposal.tally.against : proposal.tally.abstain),
                    sideOption.tone
                  )
                ),
                $detailLine('Voters', `${votersOf(proposal)}`)
              ),
              $anchor: $column(spacing.tiny, style({ width: '100%', cursor: 'help' }))(
                $tallyLine(v, proposal.tally),
                $tallyBar(proposal.tally),
                $node(style({ display: 'flex', fontSize: text.xs, color: palette.foreground }))(
                  $avatarStack(
                    proposal.voters
                      .filter(row => row.support === 1)
                      .sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0))
                      .map(row => $jazzicon(row.voter, 18)),
                    null
                  )
                )
              )
            })({})
          })
        )

      const $releaseLine = (v: IView): I$Node => {
        if (v.release === zeroHash) return $caption('No website release approved yet')
        const approving = encodeFunctionData({ abi: Release.abi, functionName: 'approve', args: [v.release] })
        const proposal = v.proposals.findLast(each => each.executedAt !== null && each.targets.some((target, i) => isAddressEqual(target, Release.address) && each.calldatas[i]?.toLowerCase() === approving))
        return $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.xs, color: palette.foreground }))(
          $node($text('Website release')),
          $node(style({ fontFamily: 'var(--font-numbers)', color: palette.message }))($text(`${v.release.slice(0, 10)}…${v.release.slice(-6)}`)),
          ...(proposal === undefined || proposal.executedAt === null
            ? []
            : [
                $defaultAnchor(
                  attr({ href: `${href(routeSchema.governance)}/${proposal.id}` }),
                  softNavClick(`${href(routeSchema.governance)}/${proposal.id}`),
                  style({ color: palette.message })
                )($text(`approved ${readableDate(proposal.executedAt, { dateStyle: 'medium' })}`))
              ]),
          $defaultAnchor(attr({ href: href(routeSchema.changelog) }), softNavClick(href(routeSchema.changelog)), style({ color: palette.message }))($text('Release log'))
        )
      }

      const $overview = $sectionList(
        $section(
          $sectionHeader($title('Governance'), 'PUPPET holders who delegate their votes decide what the treasury pays and what each chain deploys. Votes count only once delegated.'),
          settledRender(empty, $releaseLine),
          $node(style({ display: 'grid', gridTemplateColumns: isDesktopScreen ? 'repeat(3, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: '12px' }))(
            $tile(
              'Delegates',
              figure(v => String(v.delegates.length)),
              figure(v => `${amountOf(v, v.delegates.reduce((sum, row) => sum + row.votes, 0n))} ${v.token.symbol} delegated`),
              'Addresses holding delegated votes. Votes count only once delegated.'
            ),
            $tile(
              'Proposals',
              figure(v => String(v.proposals.length)),
              figure(v => `${v.proposals.filter(proposal => proposal.state === 0 || proposal.state === 1).length} voting now`),
              'Every proposal made on the governor.'
            ),
            $tile(
              'Treasury',
              $intermediateText(
                op(
                  combine({ view, price: priceFor(HUB_CHAIN_ID as ChainId, PROTOCOL.nativeToken) }),
                  map(p => p.view.then(v => usdOf(v.treasury.eth, p.price)))
                )
              ),
              settledRender($caption('-'), v =>
                $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                  $row(spacing.tiny, style({ alignItems: 'center' }))(
                    $tokenMark(TOKEN_CHAIN_ID, PROTOCOL.nativeToken, { symbol: 'ETH', decimals: 18 }, 14, false),
                    $node($text(`${readableUnitAmount(formatFixed(18, v.treasury.eth))} ETH`))
                  ),
                  $row(spacing.tiny, style({ alignItems: 'center' }))(
                    $tokenMark(TOKEN_CHAIN_ID, Token.address, { symbol: v.token.symbol, decimals: v.token.decimals }, 14, false),
                    $node($text(`${amountOf(v, v.treasury.puppet)} ${v.token.symbol}`))
                  )
                )
              ),
              'What the Governor holds and pays out by vote. PUPPET has no market price, so the headline counts the ETH.',
              $addressLink(Governor.address, 14)
            )
          )
        ),
        $section(
          $sectionHeader($title('Proposals'), null),
          switchLatest(start($caption('-'), map(ids => (ids.length === 0 ? $caption('No proposals yet') : $column(...ids.map($proposalRow))), proposalIds)))
        ),
        $section(
          $sectionHeader($title('Delegates'), 'Ranked by the votes delegated to each address. A proposal counts the votes delegated at its snapshot, so delegate before a proposal opens.'),
          switchLatest(start($caption('-'), map(p => $delegateBoard(p.view, p.ballot), combine({ view: settledView, ballot: start(null, settledBallot) }))))
        )
      )

      const $detail = (id: bigint): I$Node => {
        const landings: IStream<Promise<readonly (ILanding | null)[]>> = op(
          settledView,
          map(v => proposalOf(v, id)),
          map(proposal => (proposal.executedTx === null ? null : { tx: proposal.executedTx, proposal })),
          filterNull,
          skipRepeatsWith((a, b) => a.tx === b.tx),
          switchMap(p =>
            localFirst(
              () => device.read<readonly (ILanding | null)[]>(`governance:landing:${p.tx}`).then(held => (held === null ? notLocal : held.value)),
              () =>
                landingsOf(p.tx, p.proposal).then(list => {
                  if (list.every(landing => landing === null || landing.kind !== 'pending')) void device.write(`governance:landing:${p.tx}`, list)
                  return list
                })
            )
          ),
          answerState
        )
        const $landingOf = (i: number, chainId: number, deadline: bigint, account: Address | null): I$Node =>
          switchLatest(
            start(
              $caption('-'),
              map(
                (query: Promise<readonly (ILanding | null)[]>) =>
                  switchLatest(
                    fromPromise(
                      query.then(
                        list => $landing(chainId, list[i] ?? null, deadline, account),
                        (err: unknown) => $node(style({ fontSize: text.xs, color: palette.negative }))($text(`Landing unreadable: ${formatThrownError(err)}`))
                      )
                    )
                  ),
                landings
              )
            )
          )
        const $voteAction = switchLatest(
          start(
            empty,
            map(p => {
              const v = p.view
              const proposal = proposalOf(v, id)
              const b = p.ballot
              if (proposal.state === 4) {
                return $actButton('Execute', wallet =>
                  send(wallet, w =>
                    w.writeContract({ address: Governor.address, abi: Governor.abi, functionName: 'execute', args: [proposal.targets, proposal.values, proposal.calldatas, keccak256(stringToHex(proposal.description))], chain: mainnet, account: w.account! })
                  )
                )
              }
              if (proposal.state !== 1) return empty
              if (b === null) return $caption('Connect a wallet to vote')
              const mine = b.proposals.find(row => row.id === id)
              if (mine?.voted) return $caption('You voted')
              if (mine === undefined || mine.weight === null || mine.weight === 0n) return $caption('No delegated votes at this snapshot')
              return $column(spacing.tiny, style({ alignItems: isDesktopScreen ? 'flex-end' : 'flex-start' }))(
                $row(spacing.small)(
                  ...SIDES.map(sideOption =>
                    $actButton(sideOption.label, wallet =>
                      send(wallet, w =>
                        w.writeContract({ address: Governor.address, abi: Governor.abi, functionName: 'castVote', args: [id, sideOption.support], chain: mainnet, account: w.account! })
                      )
                    )
                  )
                ),
                $caption(`Your vote counts ${amountOf(v, mine.weight)} ${v.token.symbol}`)
              )
            }, combine({ view: settledView, ballot: settledBallot }))
          )
        )

        return $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
            $defaultAnchor(attr({ href: href(routeSchema.governance) }), softNavClick(href(routeSchema.governance)), style({ color: palette.foreground }))($text('Governance')),
            $node($text('/')),
            $node(style({ color: palette.message }))($text('Proposal'))
          ),
          $card(spacing.default)(
            $row(spacing.default, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: '8px' }))(
              settledRender($caption('-'), v => {
                const proposal = proposalOf(v, id)
                const met = quorumMet(proposal)
                const counted = proposal.tally.inFavor + proposal.tally.against
                const share = counted === 0n ? 0 : Number((proposal.tally.inFavor * 10_000n) / counted) / 100
                const voteStart = Number(proposal.voteStart)
                const voteEnd = Number(proposal.voteEnd)
                const steps = [
                  { label: 'Created', at: proposal.createdAt },
                  { label: voteStart <= v.now ? 'Voting opened' : 'Voting opens', at: voteStart },
                  ...(proposal.state === 2
                    ? [{ label: 'Canceled', at: proposal.canceledAt }]
                    : proposal.state === 3
                      ? [{ label: 'Defeated', at: voteEnd }]
                      : [
                          proposal.settledAt === null
                            ? { label: voteEnd <= v.now ? 'Voting closed' : 'Voting closes', at: voteEnd }
                            : { label: 'Settled', at: proposal.settledAt },
                          { label: 'Executed', at: proposal.executedAt }
                        ])
                ]
                return $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap', rowGap: '8px', fontSize: text.sm }))(
                  $row(spacing.small, style({ alignItems: 'center' }))(
                    $badge(proposal.state),
                    $infoTooltip(
                      $column(spacing.default)(
                        $node($text(STATES[proposal.state]?.note ?? 'Unknown state')),
                        $node(style({ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, minmax(0, 128px))` }))(
                          ...steps.map((step, i) => {
                            const next = steps[i + 1]
                            const reached = step.at !== null && step.at <= v.now
                            const current = reached && next !== undefined && (next.at === null || next.at > v.now)
                            const filled =
                              next === undefined || step.at === null || !reached || next.at === null
                                ? 0
                                : next.at <= v.now
                                  ? 100
                                  : Math.round(((v.now - step.at) / (next.at - step.at)) * 100)
                            return $column(style({ position: 'relative', alignItems: 'center', gap: '8px' }))(
                              ...(next === undefined
                                ? []
                                : [
                                    $node(
                                      style({
                                        position: 'absolute',
                                        top: '8px',
                                        left: 'calc(50% + 13px)',
                                        width: 'calc(100% - 26px)',
                                        height: '2px',
                                        background: `linear-gradient(90deg, ${palette.message} ${filled}%, ${TIMELINE_DIM} ${filled}%)`
                                      })
                                    )()
                                  ]),
                              $node(
                                style({
                                  width: '18px',
                                  height: '18px',
                                  boxSizing: 'border-box',
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  ...(reached ? { backgroundColor: palette.message } : { border: `2px solid ${TIMELINE_DIM}` })
                                })
                              )(
                                ...(current
                                  ? [$node(style({ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: palette.background }))()]
                                  : reached
                                    ? [$icon({ $content: $tick, viewBox: '0 0 24 24', width: '12px', fill: palette.background })]
                                    : [])
                              ),
                              $column(style({ alignItems: 'center', gap: '2px', textAlign: 'center', padding: '0 4px' }))(
                                $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(step.label)),
                                $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'pre-line' }))(
                                  $text(step.at === null ? '-' : `${readableDate(step.at, { dateStyle: 'medium' })}\n${readableDate(step.at, { timeStyle: 'short' })}`)
                                )
                              )
                            )
                          })
                        )
                      )
                    ),
                    ...(proposal.state === 0
                      ? [$node(style({ fontSize: text.xs, color: palette.foreground }))($text(op(clock, map(now => `Voting starts in ${shortDuration(Math.max(0, voteStart - now))}`))))]
                      : proposal.state === 1
                        ? [$node(style({ fontSize: text.xs, color: palette.primary }))($text(op(clock, map(now => `Voting ends in ${shortDuration(Math.max(0, voteEnd - now))}`))))]
                        : [])
                  ),
                  $row(spacing.small, style({ alignItems: 'center' }))(
                    $dot(met === null ? palette.foreground : met ? palette.positive : palette.negative),
                    $node(style({ color: palette.foreground }))($text('Quorum')),
                    $infoTooltip(
                      proposal.quorum === null || proposal.superQuorum === null
                        ? 'The quorum is read at the snapshot.'
                        : `For plus Abstain must reach ${amountOf(v, proposal.quorum)} ${v.token.symbol}. For reaching ${amountOf(v, proposal.superQuorum)} ${v.token.symbol} with two thirds of the votes settles it at once.`
                    ),
                    $node(style({ fontFamily: 'var(--font-numbers)', color: palette.message }))(
                      $text(`${amountOf(v, proposal.tally.inFavor + proposal.tally.abstain)} of ${proposal.quorum === null ? '-' : amountOf(v, proposal.quorum)}`)
                    )
                  ),
                  $row(spacing.small, style({ alignItems: 'center' }))(
                    $dot(passes(proposal) ? palette.positive : palette.negative),
                    $node(style({ color: palette.foreground }))($text('Two thirds For')),
                    $infoTooltip('For must be above zero and at least two thirds of For plus Against. Abstain counts only toward quorum.'),
                    $node(style({ fontFamily: 'var(--font-numbers)', color: palette.message }))($text(`${share}%`))
                  )
                )
              }),
              $voteAction
            ),
            settledRender($tallyBar({ inFavor: 0n, against: 0n, abstain: 0n }), v => {
              const proposal = proposalOf(v, id)
              return $Tooltip({
                $dropContainer: $tooltipDropContainer,
                $content: $column(spacing.tiny)(
                  ...SIDES.map(sideOption =>
                    $detailLine(
                      sideOption.label,
                      amountOf(v, sideOption.support === 1 ? proposal.tally.inFavor : sideOption.support === 0 ? proposal.tally.against : proposal.tally.abstain),
                      sideOption.tone
                    )
                  )
                ),
                $anchor: $node(style({ display: 'flex', width: '100%', padding: '4px 0', cursor: 'help' }))($tallyBar(proposal.tally))
              })({})
            }),
            $node(style({ fontSize: '1.5em', fontWeight: '700', lineHeight: '1.25', color: palette.message, overflowWrap: 'anywhere' }))(figure(v => titleOf(proposalOf(v, id).description))),
            $node(style({ display: 'grid', gridTemplateColumns: isDesktopScreen ? 'repeat(4, max-content)' : 'minmax(0, 1fr)', columnGap: '40px', rowGap: '12px', paddingTop: '12px', borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
              $metaField('Proposed by', settledRender($caption('-'), v => $addressMark(TOKEN_CHAIN_ID, proposalOf(v, id).proposer, null))),
              $metaField(
                'Proposal ID',
                $row(spacing.tiny, style({ alignItems: 'center', fontFamily: 'var(--font-numbers)' }))(
                  $node(attr({ title: id.toString() }))($text(shortId(id))),
                  $element('button')(
                    attr({ title: 'Copy the proposal ID' }),
                    style({ display: 'inline-flex', background: 'none', border: 'none', padding: '0', cursor: 'pointer', color: palette.foreground, fill: palette.foreground }),
                    effectProp('onclick', nowWith(() => () => navigator.clipboard.writeText(id.toString())))
                  )($icon({ $content: $copy, viewBox: '0 0 24 24', width: '13px' }))
                )
              ),
              $metaField('Proposed', $node(figure(v => {
                const at = proposalOf(v, id).createdAt
                return at === null ? '-' : dateOf(at)
              }))),
              $metaField(
                'Votes',
                settledRender($caption('-'), v => {
                  const proposal = proposalOf(v, id)
                  const voters = [...proposal.voters].sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : 0))
                  return voters.length === 0
                    ? $node($text(proposal.state === 0 || proposal.state === 1 ? 'No votes yet' : 'No votes'))
                    : $row(spacing.small, style({ alignItems: 'center' }))(
                        $avatarStack(
                          voters.map(row => $jazzicon(row.voter, 18)),
                          $column(
                            ...voters.map(row => {
                              const sideOption = SIDES.find(each => each.support === row.support)!
                              return $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: `1px solid ${SEPARATOR_COLOR}` }))(
                                $addressMark(TOKEN_CHAIN_ID, row.voter, null),
                                $row(spacing.small, style({ alignItems: 'baseline', whiteSpace: 'nowrap' }))(
                                  $node(style({ fontSize: text.xs, color: sideOption.tone }))($text(sideOption.label)),
                                  $node(style({ fontFamily: 'var(--font-numbers)', color: palette.message }))($text(amountOf(v, row.weight)))
                                )
                              )
                            })
                          )
                        ),
                        $node(style({ fontFamily: 'var(--font-numbers)' }))($text(amountOf(v, totalOf(proposal.tally))))
                      )
                })
              )
            ),
            switchLatest(op(acting, take(1), map(() => $node(style({ fontSize: text.xs }))($intermediateText(map(p => p.then(hash => `Confirmed in ${hash.slice(0, 10)}…`, err => Promise.reject(new Error(formatThrownError(err)))), acting))))))
          ),
          $card(spacing.default)(
            $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }))(
              $title('Actions'),
              settledRender(empty, v => {
                const proposal = proposalOf(v, id)
                if (proposal.state === 7) {
                  const $executed = $node($text(proposal.executedAt === null ? 'Executed' : `Executed ${dateOf(proposal.executedAt)}`))
                  return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
                    $dot(palette.positive),
                    proposal.executedTx === null ? $executed : $explorerLink(`tx/${proposal.executedTx}`, $executed)
                  )
                }
                return proposal.state === 4
                  ? $caption('Not executed yet')
                  : proposal.state === 2 || proposal.state === 3 || proposal.state === 6
                    ? $caption('Not executed')
                    : empty
              })
            ),
            settledRender($caption('-'), v => {
              const proposal = proposalOf(v, id)
              let actions: IProposalAction[]
              try {
                actions = decodeProposal(proposal.targets, proposal.values, proposal.calldatas)
              } catch (err) {
                return $node(style({ fontSize: text.sm, color: palette.negative, overflowWrap: 'anywhere' }))($text(`Could not decode this proposal: ${formatThrownError(err)}`))
              }
              return $column(
                ...actions.map((action, i) => {
                  const outcome = proposal.simulation === null ? null : proposal.simulation[i]!
                  const $outcome =
                    outcome === null
                      ? []
                      : [
                          $row(spacing.small, style({ alignItems: 'center', fontSize: text.xs, color: outcome.kind === 'success' ? palette.foreground : palette.negative }))(
                            $dot(outcome.kind === 'success' ? palette.positive : palette.negative),
                            $node($text(outcome.kind === 'success' ? 'Would succeed now' : `Would fail now: ${outcome.reason}`))
                          )
                        ]
                  if (action.kind === 'call') {
                    return $column(spacing.small, style({ padding: '10px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))($callLine(v, action.call), ...$outcome)
                  }
                  const receiver = action.bridge.fn.args.find(arg => arg.name === 'to' || arg.name === 'receiver')
                  return $column(spacing.small, style({ padding: '12px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}`, fontSize: text.sm }))(
                    $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }))(
                      $row(spacing.small, style({ alignItems: 'center' }))(
                        $chainIcon(action.chainId, 18),
                        $node(style({ fontWeight: '600', color: palette.message }))($text(`To ${chainName(action.chainId)}`)),
                        $caption(`via ${action.bridge.fn.name}`)
                      ),
                      action.batch === null
                        ? empty
                        : proposal.executedTx === null
                          ? $caption(`Valid until ${dateOf(Number(action.batch.deadline))}`)
                          : $landingOf(i, action.chainId, action.batch.deadline, receiver === undefined ? null : (receiver.value as Address))
                    ),
                    ...(action.batch === null
                      ? [
                          $node(style({ color: palette.negative, overflowWrap: 'anywhere' }))(
                            $text(
                              `This message goes to ${receiver === undefined ? 'an unnamed receiver' : (receiver.label ?? readableAddress(receiver.value as Address))}, not the GovernorAccount`
                            )
                          )
                        ]
                      : [$column(spacing.tiny, style({ paddingLeft: '12px', borderLeft: `2px solid ${SEPARATOR_COLOR}` }))(...action.batch.callList.map(call => $callLine(v, call)))]),
                    ...$outcome
                  )
                })
              )
            })
          ),
          settledRender(empty, v => {
            const body = bodyOf(proposalOf(v, id).description)
            return body === '' ? empty : $panel('Description', $descriptionBody(body))
          })
        )
      }

      return [$column(spacing.default)($watch, switchLatest(map(id => (id === null ? $overview : $detail(id)), selected))), {}]
    }
  )
