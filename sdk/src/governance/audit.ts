import { CHAIN_VERIFIER_MAP, CREATE2_FACTORY, FULL_ACCESS } from '@puppet/contracts/const'
import TOKEN, { TOKEN_CHAIN_ID } from '@puppet/contracts/token'
import {
  type Abi,
  type Address,
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  getContractAddress,
  type Hex,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseAbiParameters,
  size,
  slice,
  toHex
} from 'viem'
import { CHAIN_MAP, type ChainId, chainNameOf } from '../const/chains.js'
import { decodeProposal, type IProposalCall, readCallState } from './index.js'

const [source, flag, artifacts] = Bun.argv.slice(2)
if (source === undefined || (flag !== undefined && (flag !== '--artifacts' || artifacts === undefined))) {
  throw new Error('usage: bun audit.ts <proposal id | forge broadcast json of a propose run> [--artifacts <prod build output dir>]')
}

const clientOf = (chainId: number) => {
  const url = Bun.env[`RPC_${chainId}`]
  if (url === undefined) throw new Error(`set RPC_${chainId} to an RPC URL for chain ${chainId}`)
  return createPublicClient({ transport: http(url) })
}

const governor = TOKEN.Governor
const ethereum = clientOf(TOKEN_CHAIN_ID)
const created = source.endsWith('.json')
  ? null
  : (
      await ethereum.getContractEvents({ address: governor.address, abi: governor.abi, eventName: 'ProposalCreated', fromBlock: BigInt(governor.block), strict: true })
    ).find(log => log.args.proposalId === BigInt(source))
if (created === undefined) throw new Error(`the Governor ${governor.address} never created proposal ${source}`)
const proposed =
  created === null
    ? ((await Bun.file(source).json()) as { transactions: { function?: string | null; transaction: { input: Hex } }[] }).transactions.find(tx =>
        (tx.function ?? '').startsWith('propose(')
      )
    : null
if (proposed === undefined) throw new Error(`${source} holds no Governor propose call`)
const call =
  created === null && proposed !== null
    ? decodeFunctionData({ abi: governor.abi, data: proposed.transaction.input })
    : null
if (call !== null && call.functionName !== 'propose') throw new Error(`${source} holds a ${call.functionName} call, not propose`)
const [targets, values, calldatas, description] =
  created !== null
    ? ([created.args.targets, created.args.values, created.args.calldatas, created.args.description] as const)
    : (call!.args as readonly [readonly Address[], readonly bigint[], readonly Hex[], string])
const id = BigInt(keccak256(encodeAbiParameters(parseAbiParameters('address[], uint256[], bytes[], bytes32'), [targets, values, calldatas, keccak256(toHex(description))])))
const snapshot = await ethereum.readContract({ address: governor.address, abi: governor.abi, functionName: 'proposalSnapshot', args: [id] })
const STATES = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed']
const state =
  snapshot === 0n ? 'not proposed' : STATES[await ethereum.readContract({ address: governor.address, abi: governor.abi, functionName: 'state', args: [id] })]

const actions = decodeProposal(targets, values, calldatas)
const callList = actions.flatMap(action => (action.kind === 'call' ? [action.call] : (action.batch?.callList ?? [])))
const nowList = await Promise.all(callList.map(item => readCallState(clientOf(item.chainId), item)))

const text = (value: unknown): string =>
  typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value : JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))
const argText = (arg: NonNullable<IProposalCall['fn']>['args'][number]) =>
  `${arg.name} = ${text(arg.value)}${
    arg.label !== null ? ` (${arg.label})` : arg.type === 'bytes4' && arg.value === FULL_ACCESS ? ' (FULL_ACCESS: every function)' : arg.type === 'bytes4' && arg.value === '0x00000000' ? ' (no function)' : ''
  }`
const callText = (item: IProposalCall) =>
  item.fn === null
    ? `${item.name ?? 'unknown contract'} ${item.target}: undecoded data ${item.data}`
    : `${item.name ?? 'unknown contract'} ${item.target}: ${item.fn.signature}\n${item.fn.args.map(arg => `      - ${argText(arg)}`).join('\n')}`

const lines = [
  `# Proposal ${id}`,
  '',
  `- State: ${state}`,
  `- Governor: ${governor.address} on chain ${TOKEN_CHAIN_ID}`,
  snapshot === 0n ? '- Votes: not opened' : `- Vote snapshot: ${snapshot}`,
  '',
  '## Description',
  '',
  ...description.split('\n').map(line => `> ${line}`),
  '',
  '## Actions'
]
for (const [i, action] of actions.entries()) {
  lines.push('')
  if (action.kind === 'call') {
    lines.push(`### ${i + 1}. On chain ${TOKEN_CHAIN_ID}${action.call.value > 0n ? `, sending ${action.call.value} wei` : ''}`, '', `- ${callText(action.call)}`)
    lines.push(`  - now: ${text(nowList[callList.indexOf(action.call)])}`)
    continue
  }
  lines.push(
    `### ${i + 1}. To ${chainNameOf(action.chainId) ?? 'chain'} ${action.chainId} through its bridge ${action.bridge.target}${action.bridge.value > 0n ? `, paying ${action.bridge.value} wei` : ''}`,
    '',
    `- Bridge call: ${action.bridge.fn.signature}`,
    ...action.bridge.fn.args.map(arg => `  - ${arg.type === 'bytes' ? `${arg.name} = ${(text(arg.value).length - 2) / 2} bytes` : argText(arg)}`)
  )
  if (action.batch === null) {
    lines.push('- The message does not go to the GovernorAccount, so no batch is decoded')
    continue
  }
  lines.push(`- Batch for the GovernorAccount, refused after ${action.batch.deadline} (${new Date(Number(action.batch.deadline) * 1000).toISOString()}):`)
  for (const [j, item] of action.batch.callList.entries()) {
    lines.push(`  ${j + 1}. ${callText(item)}${item.value > 0n ? `\n      - sends ${item.value} wei` : ''}`)
    lines.push(`      - now: ${text(nowList[callList.indexOf(item)])}`)
  }
}

lines.push('', '## Implementations installed', '')
const FACTORY_ABI = parseAbi(['function safeCreate2(bytes32 salt, bytes initializationCode) payable returns (address deploymentAddress)'])
for (const item of callList.filter(entry => entry.fn?.name === 'upgrade' || entry.fn?.name === 'setImplementation')) {
  const implementation = item.fn!.args[0]!.value as Address
  const verifier = CHAIN_VERIFIER_MAP[item.chainId as keyof typeof CHAIN_VERIFIER_MAP]
  if (verifier === undefined) throw new Error(`the manifest names no verifier for chain ${item.chainId}`)
  const record =
    verifier === 'sourcify'
      ? await (async () => {
          const response = await fetch(`https://sourcify.dev/server/v2/contract/${item.chainId}/${implementation}?fields=compilation`)
          if (response.status === 404) return null
          if (!response.ok) throw new Error(`Sourcify answered ${response.status} for ${implementation} on chain ${item.chainId}`)
          const found = (await response.json()) as {
            compilation: { name: string; compilerVersion: string; compilerSettings: { optimizer?: { runs?: number }; viaIR?: boolean; evmVersion?: string } }
          }
          return {
            name: found.compilation.name,
            compiler: found.compilation.compilerVersion,
            runs: found.compilation.compilerSettings.optimizer?.runs ?? null,
            viaIR: found.compilation.compilerSettings.viaIR ?? null,
            evmVersion: found.compilation.compilerSettings.evmVersion ?? null,
            source: `https://sourcify.dev/#/lookup/${implementation}`
          }
        })()
      : await (async () => {
          const key = Bun.env.ETHERSCAN_API_KEY
          if (key === undefined) throw new Error('set ETHERSCAN_API_KEY to read verified sources')
          await Bun.sleep(400)
          const response = await fetch(`https://api.etherscan.io/v2/api?chainid=${item.chainId}&module=contract&action=getsourcecode&address=${implementation}&apikey=${key}`)
          if (!response.ok) throw new Error(`Etherscan answered ${response.status} for ${implementation} on chain ${item.chainId}`)
          const found = (await response.json()) as { status: string; result: { SourceCode: string; ContractName: string; CompilerVersion: string; Runs: string; EVMVersion: string }[] | string }
          if (found.status !== '1' || typeof found.result === 'string' || found.result[0] === undefined) throw new Error(`Etherscan refused ${implementation} on chain ${item.chainId}: ${text(found.result)}`)
          const entry = found.result[0]
          if (entry.SourceCode === '') return null
          const explorer = CHAIN_MAP[item.chainId as ChainId].blockExplorers?.default.url
          if (explorer === undefined) throw new Error(`no explorer is known for chain ${item.chainId}`)
          return {
            name: entry.ContractName,
            compiler: entry.CompilerVersion,
            runs: Number(entry.Runs),
            viaIR: entry.SourceCode.startsWith('{{') ? ((JSON.parse(entry.SourceCode.slice(1, -1)) as { settings?: { viaIR?: boolean } }).settings?.viaIR ?? false) : null,
            evmVersion: entry.EVMVersion,
            source: `${explorer}/address/${implementation}#code`
          }
        })()
  lines.push(
    `### ${item.name ?? 'unknown contract'} on chain ${item.chainId}: ${implementation}`,
    '',
    record === null ? '- Verified: NO. The explorer holds no source for this address' : `- Verified: yes, as ${record.name}: ${record.source}`
  )
  if (record !== null) {
    lines.push(`- Compiler: ${record.compiler}, optimizer runs ${record.runs ?? 'unstated'}, via-IR ${record.viaIR ?? 'unstated'}, EVM ${record.evmVersion ?? 'unstated'}`)
  }
  const client = clientOf(item.chainId)
  if ((await client.getCode({ address: implementation })) === undefined) {
    lines.push('- Creation: no code at this address, so the call installs an empty implementation', '')
    continue
  }
  let low = 0n
  let high = await client.getBlockNumber()
  while (low < high) {
    const mid = (low + high) / 2n
    if ((await client.getCode({ address: implementation, blockNumber: mid })) === undefined) low = mid + 1n
    else high = mid
  }
  const creation = (await client.getBlock({ blockNumber: low, includeTransactions: true })).transactions
    .filter(tx => tx.to !== null && isAddressEqual(tx.to, CREATE2_FACTORY))
    .map(tx => ({ hash: tx.hash, args: decodeFunctionData({ abi: FACTORY_ABI, data: tx.input }).args }))
    .find(tx => isAddressEqual(getContractAddress({ opcode: 'CREATE2', from: CREATE2_FACTORY, salt: tx.args[0], bytecodeHash: keccak256(tx.args[1]) }), implementation))
  if (creation === undefined) {
    lines.push(`- Creation: block ${low} created it inside another call, not by a direct call to the factory ${CREATE2_FACTORY}; rebuild it by hand`, '')
    continue
  }
  const [salt, initCode] = creation.args
  lines.push(
    `- Creation: transaction ${creation.hash} in block ${low} called the factory ${CREATE2_FACTORY} with salt ${salt} and ${size(initCode)} bytes of init code hashing to ${keccak256(initCode)}; CREATE2 of these gives this address`
  )
  const name = record?.name ?? (item.fn!.name === 'upgrade' ? item.name : null)
  if (artifacts === undefined || name === null) {
    lines.push(
      artifacts === undefined
        ? '- Source match and constructor arguments: pass --artifacts <prod build output dir>'
        : '- Source match: no explorer names this contract, so pick its artifact by hand',
      ''
    )
    continue
  }
  const artifact = (await Bun.file(`${artifacts}/${name}.sol/${name}.json`).json()) as { abi: Abi; bytecode: { object: Hex } }
  const creationCode = artifact.bytecode.object
  if (size(initCode) < size(creationCode) || slice(initCode, 0, size(creationCode)) !== creationCode) {
    lines.push(`- Source match: NO. ${artifacts}/${name}.sol does not build the code this init code creates`, '')
    continue
  }
  const constructor = artifact.abi.find((entry): entry is Extract<Abi[number], { type: 'constructor' }> => entry.type === 'constructor')
  const ctorArgs = size(initCode) === size(creationCode) ? '0x' : slice(initCode, size(creationCode))
  const decoded = constructor === undefined ? [] : decodeAbiParameters(constructor.inputs, ctorArgs)
  lines.push(
    `- Source match: yes. ${artifacts}/${name}.sol builds this creation code, and the constructor arguments follow it:`,
    ...(constructor === undefined ? ['  - no constructor'] : constructor.inputs.map((input, k) => `  - ${(input.name ?? '').replace(/^_+/, '')} = ${text(decoded[k])}`)),
    ''
  )
}
console.log(lines.join('\n'))
