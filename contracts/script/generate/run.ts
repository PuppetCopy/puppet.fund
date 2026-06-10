#!/usr/bin/env bun
import { join } from 'path'
import { parse as parseToml } from 'smol-toml'
import { getAddress, keccak256, stringToHex, toBytes } from 'viem'
import { generateEventParamsCode, parseEventsFromSolidity } from './parse-events.js'

const FORGE_ARTIFACTS_PATH = './forge-artifacts'
const DEPLOYMENTS_PATH = './deployments.toml'
const FOUNDRY_TOML_PATH = './foundry.toml'
const CONST_TOML_PATH = './const.toml'
const BROADCAST_PATH = './broadcast'
const ERROR_SOL_PATH = './src/utils/Error.sol'
const OUTPUT_DIR = './script/__generated'
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

// Chain alias → chainId, sourced from foundry.toml's [rpc_endpoints] so the
// generator picks up new chains the moment they're configured for forge.
async function loadChainIdMap(): Promise<Record<string, number>> {
  const tomlContent = await Bun.file(FOUNDRY_TOML_PATH).text()
  const parsed = parseToml(tomlContent) as { rpc_endpoints?: Record<string, { chain_id?: number | bigint }> }
  const endpoints = parsed.rpc_endpoints ?? {}
  const map: Record<string, number> = {}
  for (const [alias, entry] of Object.entries(endpoints)) {
    if (entry?.chain_id != null) map[alias] = Number(entry.chain_id)
  }
  return map
}

type ContractInfo = {
  name: string
  address: string
  chainBlockMap?: Record<number, number>
  blockNumber?: number
  abi?: unknown[]
}

type BroadcastArtifact = {
  transactions: {
    hash: string
    transactionType: string
    contractName: string
    contractAddress: string
  }[]
  receipts: {
    transactionHash: string
    blockNumber: string
  }[]
}

async function loadBlockNumbersFromBroadcasts(chainId: number): Promise<Map<string, number>> {
  const blockNumbers = new Map<string, number>()

  // Fresh checkouts have no broadcast/ until forge script --broadcast runs.
  // Skip the scan rather than crashing the whole generator.
  const broadcastDirExists = await Bun.file(BROADCAST_PATH)
    .stat()
    .then(
      s => s.isDirectory(),
      () => false
    )
  if (!broadcastDirExists) return blockNumbers

  // Scan all registry directories for this chain
  const broadcastGlob = new Bun.Glob(`*/${chainId}/run-latest.json`)

  for await (const file of broadcastGlob.scan({ cwd: BROADCAST_PATH })) {
    try {
      const broadcastFile = Bun.file(join(BROADCAST_PATH, file))
      const broadcast: BroadcastArtifact = await broadcastFile.json()

      // Build txHash -> blockNumber map from receipts
      const receiptMap = new Map<string, number>()
      for (const receipt of broadcast.receipts) {
        receiptMap.set(receipt.transactionHash, Number(receipt.blockNumber))
      }

      // Extract block numbers for CREATE transactions
      for (const tx of broadcast.transactions) {
        if (tx.transactionType === 'CREATE' && tx.contractAddress) {
          const blockNumber = receiptMap.get(tx.hash)
          if (blockNumber) {
            // Normalize address to lowercase for comparison
            blockNumbers.set(tx.contractAddress.toLowerCase(), blockNumber)
          }
        }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return blockNumbers
}

async function findAbiFile(contractName: string): Promise<unknown[] | undefined> {
  try {
    const artifactPath = join(FORGE_ARTIFACTS_PATH, `${contractName}.sol`, `${contractName}.json`)
    const artifactFile = Bun.file(artifactPath)

    if (await artifactFile.exists()) {
      const artifact = await artifactFile.json()
      return artifact.abi
    }

    console.warn(`  No ABI found for ${contractName}`)
    return undefined
  } catch (error) {
    console.error(`  Error loading ABI for ${contractName}:`, error)
    return undefined
  }
}

async function generateErrorAbi(): Promise<void> {
  console.log('Generating Error ABI from Error.sol...')

  const errorSolContent = await Bun.file(ERROR_SOL_PATH).text()
  const errorRegex = /error\s+(\w+)\s*\((.*?)\)\s*;/g
  type ErrorParam = { name: string; internalType: string; type: string }
  type ErrorDef = { name: string; inputs: ErrorParam[] }
  const errors: ErrorDef[] = []

  let match: RegExpExecArray | null
  while ((match = errorRegex.exec(errorSolContent)) !== null) {
    const errorName = match[1]!
    const params = match[2]!.trim()
    const inputs: ErrorParam[] = []

    if (params) {
      const paramList = params.split(',').map(p => p.trim())
      for (const param of paramList) {
        const paramMatch = param.match(/^(.+?)\s+(\w+)$/)
        if (paramMatch) {
          let [, type, name] = paramMatch as unknown as [string, string, string]
          if (type === 'uint') type = 'uint256'
          if (type === 'IERC20') type = 'address'
          let internalType = type
          if (type === 'address' && param.includes('IERC20')) internalType = 'contract IERC20'
          inputs.push({ name, internalType, type })
        }
      }
    }

    errors.push({ name: errorName, inputs })
  }

  const abiBlock = JSON.stringify(
    errors.map(e => ({ type: 'error', name: e.name, inputs: e.inputs })),
    null,
    2
  ).replace(/"(\w+)":/g, '$1:')

  const output = `// This file is auto-generated from contracts/src/utils/Error.sol
// Do not edit manually.

export const puppetErrorAbi = ${abiBlock} as const
`

  await Bun.write(`${OUTPUT_DIR}/errors/index.ts`, output)
  console.log(`  Generated error ABI (${errors.length} errors)`)
}

// Puppet contracts use PascalCase; external aliases (usdc, weth, gmx_*) use
// lowercase or snake_case and are filtered out of generation.
function isPuppetContract(name: string): boolean {
  return /^[A-Z]/.test(name)
}

async function generateContracts(chainIdMap: Record<string, number>): Promise<void> {
  console.log('Loading Puppet contract deployments from TOML...')

  const deploymentsFile = Bun.file(DEPLOYMENTS_PATH)
  const tomlContent = await deploymentsFile.text()
  const deployments = parseToml(tomlContent) as Record<string, Record<string, unknown>>

  const contracts: ContractInfo[] = []
  const chainSection = (deployments.chain ?? deployments.hub ?? {}) as Record<string, Record<string, string>>
  const gateChainAddresses = new Map<string, Map<number, string>>()

  // Load core contracts (same address across all deployed chains, via CREATE2)
  // Structure: [core.Name] with { address, blockNumber? }
  const coreSection = deployments.core as
    | Record<
        string,
        { address: string; blockNumber?: number | bigint; chainBlockMap?: Record<string, number | bigint> }
      >
    | undefined

  if (coreSection) {
    for (const [name, entry] of Object.entries(coreSection)) {
      if (!entry || typeof entry !== 'object') continue
      const address = entry.address
      if (!address) continue
      const chainBlockMap: Record<number, number> = {}
      if (entry.chainBlockMap) {
        for (const [cid, block] of Object.entries(entry.chainBlockMap)) {
          chainBlockMap[Number(cid)] = Number(block)
        }
      }
      const abi = await findAbiFile(name)
      // EIP-55 checksum so consumers can compare/lookup without lowercasing.
      contracts.push({ name, address: getAddress(address), chainBlockMap, abi })
    }
    console.log(`  Found ${Object.keys(coreSection).length} core contracts`)
  }

  for (const [chainAlias, addresses] of Object.entries(chainSection)) {
    if (!addresses || typeof addresses !== 'object') continue

    // Resolve chain ID from alias or numeric string
    const chainId = chainIdMap[chainAlias] ?? Number(chainAlias)
    if (Number.isNaN(chainId)) continue

    // Load block numbers from registry files for this chain
    const blockNumbers = await loadBlockNumbersFromBroadcasts(chainId)

    // Extract chain-specific Puppet contracts (PascalCase names only, skip external like usdc, weth, gmx_*)
    const puppetContracts = Object.entries(addresses).filter(([name]) => isPuppetContract(name))
    console.log(`  Found ${puppetContracts.length} chain-specific contracts on ${chainAlias} (${chainId})`)

    for (const [name, address] of puppetContracts) {
      const abi = await findAbiFile(name)
      const isZeroAddress = address === ADDRESS_ZERO
      const blockNumber = isZeroAddress ? undefined : blockNumbers.get(address.toLowerCase())
      const checksumAddress = isZeroAddress ? address : getAddress(address)
      contracts.push({ name, address: checksumAddress, blockNumber, abi })
      let chainMap = gateChainAddresses.get(name)
      if (!chainMap) {
        chainMap = new Map()
        gateChainAddresses.set(name, chainMap)
      }
      chainMap.set(chainId, checksumAddress)
    }
  }

  console.log(`  Loaded ${contracts.length} contracts across ${Object.keys(chainSection).length} chain(s)`)

  // Generate individual ABI files
  for (const contract of contracts) {
    if (contract.abi) {
      const abiFileName = `puppet${contract.name}`
      const abiFilePath = `${OUTPUT_DIR}/abi/${abiFileName}.ts`
      const abiContent = `// This file is auto-generated from forge-artifacts/${contract.name}.sol/${contract.name}.json
// Do not edit manually.

export default ${JSON.stringify(contract.abi, null, 2)} as const
`
      await Bun.write(abiFilePath, abiContent)
    }
  }

  // Generate ABI index file
  const abiIndexContent = `// This file is auto-generated. Do not edit manually.

${[...new Map(contracts.filter(c => c.abi).map(c => [c.name, c] as const)).values()]
  .map(c => `export { default as ${c.name.toLowerCase()}Abi } from './puppet${c.name}.js'`)
  .join('\n')}
`
  await Bun.write(`${OUTPUT_DIR}/abi/index.ts`, abiIndexContent)

  // Split contracts into core and chain-based on TOML section membership
  const coreNames = new Set(Object.keys(coreSection ?? {}))
  const coreContracts = contracts.filter(c => coreNames.has(c.name))
  // Chain contracts are per-chain proxies (universal gates share an address across chains via
  // Dictate's name-salt CREATE2). Collapse duplicate name entries into one. *Impl entries are
  // deploy-internal (verify only), never consumer-facing.
  const chainContracts = [
    ...new Map(
      contracts.filter(c => !coreNames.has(c.name) && !c.name.endsWith('Impl')).map(c => [c.name, c] as const)
    ).values()
  ]

  let hubChainId: number | undefined
  for (const [chainAlias, addresses] of Object.entries(chainSection)) {
    if (!addresses || typeof addresses !== 'object') continue
    if (!('HubGate' in addresses)) continue
    hubChainId = chainIdMap[chainAlias] ?? Number(chainAlias)
    break
  }
  if (hubChainId == null || Number.isNaN(hubChainId)) {
    throw new Error('HubGate chainId not resolvable from deployments.chain.*')
  }

  // Cross-check: deployments.toml's observed HubGate chain must match const.toml's declared hub.
  // Catches manual drift between intent (const.toml) and deployment artifacts (deployments.toml).
  const declaredHubChainId = Number(
    (parseToml(await Bun.file(CONST_TOML_PATH).text()) as { protocol?: { hubChainId?: number | bigint } }).protocol
      ?.hubChainId ?? Number.NaN
  )
  if (declaredHubChainId !== hubChainId) {
    throw new Error(
      `Hub chainId drift: const.toml [protocol].hubChainId=${declaredHubChainId} but deployments.toml places HubGate on chain ${hubChainId}`
    )
  }
  const bridgeChainIds = Object.keys(chainSection)
    .map(alias => chainIdMap[alias] ?? Number(alias))
    .filter(n => !Number.isNaN(n) && n !== hubChainId)
    .sort((a, b) => a - b)

  // Hub/spoke split based on which chains a contract is deployed to.
  // Universal gates (PuppetGate/MasterGate) appear in both since they're deployed everywhere.
  const hubContracts = chainContracts.filter(c => gateChainAddresses.get(c.name)?.has(hubChainId!) ?? false)
  const spokeContracts = chainContracts.filter(c => {
    const m = gateChainAddresses.get(c.name)
    if (!m) return false
    return bridgeChainIds.some(id => m.has(id))
  })

  function formatCoreEntry(contract: ContractInfo): string {
    const chainBlockMapBody = Object.entries(contract.chainBlockMap ?? {})
      .map(([cid, block]) => `${cid}: ${block}`)
      .join(', ')
    const lines: string[] = [`    address: '${contract.address}'`, `    chainBlockMap: { ${chainBlockMapBody} }`]
    if (contract.abi != null) lines.push(`    abi: ${contract.name.toLowerCase()}Abi`)
    return `  ${contract.name}: {\n${lines.join(',\n')}\n  }`
  }

  function formatHubEntry(contract: ContractInfo): string {
    const chainMap = gateChainAddresses.get(contract.name) ?? new Map<number, string>()
    const chainEntries = [...chainMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([cid, addr]) => `${cid}: '${addr}'`)
      .join(', ')
    const uniqueAddresses = new Set(chainMap.values())
    const lines: string[] = []
    if (uniqueAddresses.size === 1) {
      const [only] = uniqueAddresses
      lines.push(`    address: '${only}'`)
    }
    lines.push(`    chainAddresses: { ${chainEntries} }`)
    if (contract.blockNumber != null) lines.push(`    blockNumber: ${contract.blockNumber}`)
    if (contract.abi != null) lines.push(`    abi: ${contract.name.toLowerCase()}Abi`)
    return `  ${contract.name}: {\n${lines.join(',\n')}\n  }`
  }

  // Load const.toml for per-chain token + universal OIF settler addresses + protocol config
  const constContent = await Bun.file(CONST_TOML_PATH).text()
  const constParsed = parseToml(constContent) as Record<string, unknown>

  const chainTokenEntries: string[] = []
  const chainNetworkEntries: string[] = []
  const tokenSymbols = new Set<string>()
  for (const [alias, chainId] of Object.entries(chainIdMap).sort(([, a], [, b]) => a - b)) {
    const chainEntry = constParsed[alias] as Record<string, Record<string, string>> | undefined
    if (!chainEntry) continue
    chainNetworkEntries.push(`  ${chainId}: '${alias}'`)
    const tokens = chainEntry.token
    if (tokens && Object.keys(tokens).length > 0) {
      const tokenBody = Object.entries(tokens)
        .map(([sym, addr]) => {
          tokenSymbols.add(sym)
          return `${sym}: '${getAddress(addr)}'`
        })
        .join(', ')
      chainTokenEntries.push(`  ${chainId}: { ${tokenBody} }`)
    }
  }

  const oifSection = (constParsed.oif ?? {}) as Record<string, string>
  const oifInputSettler = getAddress(oifSection.inputSettler)
  const oifOutputSettler = getAddress(oifSection.outputSettler)
  const oifOracle = getAddress(oifSection.oracle)

  // [protocol] block — runtime gate-config knobs mirrored as SDK preflight context
  const protocol = (constParsed.protocol ?? {}) as Record<string, number | bigint | string>
  function readProtocol(key: string): bigint {
    const v = protocol[key]
    if (v == null) throw new Error(`const.toml [protocol].${key} is missing`)
    return BigInt(v as number | bigint)
  }
  function readProtocolString(key: string): string {
    const v = protocol[key]
    if (typeof v !== 'string') throw new Error(`const.toml [protocol].${key} is missing or not a string`)
    return v
  }
  // hubChainId is exported separately as HUB_CHAIN_ID; don't duplicate it inside PROTOCOL_CONFIG.
  void readProtocol('hubChainId')
  const signerDerivationMessage = readProtocolString('signerDerivationMessage')
  const protocolConfigBody = [
    `  maxBlockDelay: ${readProtocol('maxBlockDelay')}n`,
    `  maxRelayFeeBps: ${readProtocol('maxRelayFeeBps')}n`,
    `  transferGasLimit: ${readProtocol('transferGasLimit')}n`,
    `  signerDerivationMessage: ${JSON.stringify(signerDerivationMessage)}`
  ].join(',\n')

  // [precision] block — math/policy primitives mirrored as SDK constants.
  // Solidity literals in IntentLib.sol / Precision.sol must match these values
  // (asserted by a check below so the toml stays the single source of truth).
  const precision = (constParsed.precision ?? {}) as Record<string, number | bigint>
  function readPrecision(key: string): bigint {
    const v = precision[key]
    if (v == null) throw new Error(`const.toml [precision].${key} is missing`)
    return BigInt(v)
  }
  const basisPoints = readPrecision('basisPoints')
  const floatPrecisionExp = Number(readPrecision('floatPrecisionExp'))
  const maxQuoteAgeSec = readPrecision('maxQuoteAgeSec')

  // [gmx] block — the referral code is a human-readable string in the toml; emit
  // it right-padded to the bytes32 GMX ReferralStorage stores it under.
  const gmx = (constParsed.gmx ?? {}) as Record<string, string>
  if (typeof gmx.referralCode !== 'string') {
    throw new Error('const.toml [gmx].referralCode is missing or not a string')
  }
  const gmxReferralCodeHex = stringToHex(gmx.referralCode, { size: 32 })

  // Drift check: Solidity must match const.toml literals
  const intentLibSrc = await Bun.file('./src/utils/IntentLib.sol').text()
  const precisionSrc = await Bun.file('./src/utils/Precision.sol').text()
  const accountLibSrc = await Bun.file('./src/core/AccountLib.sol').text()
  const basisPointsMatch = intentLibSrc.match(/BASIS_POINTS\s*=\s*([\d_]+)/)
  const floatPrecisionMatch = precisionSrc.match(/FLOAT_PRECISION\s*=\s*1e(\d+)/)
  const deployAuthMatch = accountLibSrc.match(/DEPLOY_AUTH_MESSAGE\s*=\s*"([^"]*)"/)
  if (!basisPointsMatch || BigInt(basisPointsMatch[1]!.replace(/_/g, '')) !== basisPoints) {
    throw new Error(`Solidity BASIS_POINTS != const.toml basisPoints (${basisPoints})`)
  }
  if (!floatPrecisionMatch || Number(floatPrecisionMatch[1]) !== floatPrecisionExp) {
    throw new Error(`Solidity FLOAT_PRECISION exponent != const.toml floatPrecisionExp (${floatPrecisionExp})`)
  }
  if (!deployAuthMatch || deployAuthMatch[1] !== signerDerivationMessage) {
    throw new Error(
      `Solidity AccountLib.DEPLOY_AUTH_MESSAGE (${deployAuthMatch?.[1] ?? 'missing'}) != const.toml [protocol].signerDerivationMessage (${signerDerivationMessage})`
    )
  }

  // Per-symbol baseTokenId pre-derived from keccak256(symbol) so SDK doesn't re-hash at runtime.
  const tokenIdEntries = [...tokenSymbols]
    .sort()
    .map(sym => `  ${sym}: '${keccak256(toBytes(sym))}'`)
    .join(',\n')

  // Split into two files:
  //  - const.ts  : everything sourced from const.toml + math primitives. Importable as @puppet/contracts/const.
  //  - deployments.ts : contract address maps + ABIs. Re-exports HUB_CHAIN_ID from const for backward compat.

  const constContentOut = `// This file is auto-generated from Puppet const.toml.
// Do not edit manually.

export const HUB_CHAIN_ID = ${hubChainId} as const
export const SPOKE_CHAIN_IDS = [${bridgeChainIds.join(', ')}] as const
export const CHAIN_IDS = [${[hubChainId, ...bridgeChainIds].join(', ')}] as const

export const PROTOCOL_CONFIG = {
${protocolConfigBody}
} as const

export const BASIS_POINTS = ${basisPoints}n
export const FLOAT_PRECISION = 10n ** ${floatPrecisionExp}n
export const MAX_QUOTE_AGE_SEC = ${maxQuoteAgeSec}n

export const GMX_REFERRAL_CODE = '${gmxReferralCodeHex}' as const

export const CHAIN_TOKEN_MAP = {
${chainTokenEntries.join(',\n')}
} as const

export const OIF = {
  inputSettler: '${oifInputSettler}',
  outputSettler: '${oifOutputSettler}',
  oracle: '${oifOracle}',
} as const

export const CHAIN_NETWORK_MAP = {
${chainNetworkEntries.join(',\n')}
} as const

export const TOKEN_ID = {
${tokenIdEntries}
} as const
`
  await Bun.write(`${OUTPUT_DIR}/const/index.ts`, constContentOut)

  const contractsContent = `// This file is auto-generated from Puppet deployments.toml and forge-artifacts.
// Do not edit manually.

${[...coreContracts, ...chainContracts]
  .filter(c => c.abi)
  .map(c => `import ${c.name.toLowerCase()}Abi from '../abi/puppet${c.name}.js'`)
  .join('\n')}

export const CORE_CONTRACT_MAP = {
${coreContracts.map(formatCoreEntry).join(',\n')}
} as const

export const HUB_CONTRACT_MAP = {
${hubContracts.map(formatHubEntry).join(',\n')}
} as const

export const SPOKE_CONTRACT_MAP = {
${spokeContracts.map(formatHubEntry).join(',\n')}
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
`

  await Bun.write(`${OUTPUT_DIR}/deployments/index.ts`, contractsContent)
  console.log(
    `  Generated const + deployments maps (${coreContracts.length} core, ${hubContracts.length} hub, ${spokeContracts.length} spoke, ${chainTokenEntries.length} chain-token)`
  )
}

async function generateEvents(): Promise<void> {
  console.log('Parsing Solidity for event definitions...')

  const contractEvents = await parseEventsFromSolidity()
  const code = generateEventParamsCode(contractEvents)

  await Bun.write(`${OUTPUT_DIR}/events/index.ts`, code)

  let totalEvents = 0
  let unknownCount = 0
  for (const [contractName, events] of contractEvents) {
    for (const event of events) {
      totalEvents++
      const unknowns = event.params.filter(p => p.type === 'unknown').length
      if (unknowns > 0) {
        console.warn(`    Warning: ${contractName}.${event.name} has ${unknowns} unknown param type(s)`)
        unknownCount += unknowns
      }
    }
  }

  console.log(`  Generated ${totalEvents} event definitions across ${contractEvents.size} contracts`)
  if (unknownCount > 0) {
    console.warn(`  Total unknown types: ${unknownCount} (may need manual fixes)`)
  }
}

async function generateTypes(): Promise<void> {
  console.log('Generating TypeScript types from Solidity structs...')

  const SRC_PATH = './src'
  const glob = new Bun.Glob('**/*.sol')
  const contractStructs = new Map<string, Map<string, Array<{ type: string; name: string }>>>()
  const standaloneStructs = new Map<string, Array<{ type: string; name: string }>>()

  function parseFields(body: string): Array<{ type: string; name: string }> {
    const fields: Array<{ type: string; name: string }> = []
    const fieldRegex = /([\w.]+(?:\[\])?)\s+(\w+)\s*;/g
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.push({ type: fieldMatch[1]!, name: fieldMatch[2]! })
    }
    return fields
  }

  for await (const file of glob.scan({ cwd: SRC_PATH, absolute: false })) {
    if (file.includes('/test/')) continue

    const content = await Bun.file(join(SRC_PATH, file)).text()
    const contractMatch = content.match(/\b(?:contract|library|interface)\s+(\w+)\s*(?:is|{)/)

    if (!contractMatch) {
      // File-level struct file (e.g. IntentPolicy.sol)
      const structRegex = /struct\s+(\w+)\s*\{([^}]+)\}/g
      let match: RegExpExecArray | null
      while ((match = structRegex.exec(content)) !== null) {
        standaloneStructs.set(match[1]!, parseFields(match[2]!))
      }
      continue
    }
    const contractName = contractMatch[1]!

    const structRegex = /struct\s+(\w+)\s*\{([^}]+)\}/g
    let match: RegExpExecArray | null

    while ((match = structRegex.exec(content)) !== null) {
      const structName = match[1]!
      if (!contractStructs.has(contractName)) {
        contractStructs.set(contractName, new Map())
      }
      contractStructs.get(contractName)!.set(structName, parseFields(match[2]!))
    }
  }

  function solToTs(solType: string): string {
    const isArray = solType.endsWith('[]')
    const base = isArray ? solType.slice(0, -2) : solType

    // Qualified struct reference: Contract.Struct → IContract__Struct
    if (base.includes('.')) {
      const [contract, struct] = base.split('.')
      const tsType = `I${contract}__${struct}`
      return isArray ? `${tsType}[]` : tsType
    }

    // Known ABI types
    const typeMap: Record<string, string> = {
      address: 'Address',
      bool: 'boolean',
      string: 'string',
      bytes: 'Hex',
      bytes4: 'Hex',
      bytes32: 'Hex',
      uint: 'bigint',
      uint8: 'number',
      uint16: 'number',
      uint32: 'number',
      uint48: 'number',
      uint64: 'bigint',
      uint128: 'bigint',
      uint256: 'bigint',
      int: 'bigint',
      int8: 'number',
      int16: 'number',
      int32: 'number',
      int48: 'number',
      int64: 'bigint',
      int128: 'bigint',
      int256: 'bigint'
    }

    if (typeMap[base]) {
      const tsType = typeMap[base]!
      return isArray ? `${tsType}[]` : tsType
    }

    // Standalone (file-level) struct
    if (standaloneStructs.has(base)) {
      const tsType = `I${base}`
      return isArray ? `${tsType}[]` : tsType
    }

    // Check if it's a known struct in our parsed set
    for (const [contract, structs] of contractStructs) {
      if (structs.has(base)) {
        const tsType = `I${contract}__${base}`
        return isArray ? `${tsType}[]` : tsType
      }
    }

    // Contract types (PascalCase) and interface types (IERC20, etc.) → Address
    if (/^[A-Z]/.test(base)) {
      return isArray ? 'Address[]' : 'Address'
    }

    return isArray ? `${base}[]` : base
  }

  const interfaceList: string[] = []
  const sortedStandalone = [...standaloneStructs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [structName, fields] of sortedStandalone) {
    const fieldLines = fields.map(f => `  ${f.name}: ${solToTs(f.type)}`).join('\n')
    interfaceList.push(`export interface I${structName} {\n${fieldLines}\n}`)
  }

  const sortedContracts = [...contractStructs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [contractName, structs] of sortedContracts) {
    const sortedStructs = [...structs.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    for (const [structName, fields] of sortedStructs) {
      const fieldLines = fields.map(f => `  ${f.name}: ${solToTs(f.type)}`).join('\n')
      interfaceList.push(`export interface I${contractName}__${structName} {\n${fieldLines}\n}`)
    }
  }

  const output = `// This file is auto-generated from Solidity struct definitions. Do not edit manually.

import type { Address, Hex } from 'viem'

${interfaceList.join('\n\n')}
`

  await Bun.write(`${OUTPUT_DIR}/types/index.ts`, output)
  console.log(`  Generated ${interfaceList.length} struct types`)
}

async function generateIndex(): Promise<void> {
  const indexContent = `// This file is auto-generated. Do not edit manually.

export * from './const/index.js'
export * from './deployments/index.js'
export * from './events/index.js'
export * from './errors/index.js'
export * from './types/index.js'
export * from './intents/index.js'
export * from './gasLimits/index.js'
`
  await Bun.write(`${OUTPUT_DIR}/index.ts`, indexContent)
}

// EIP-712 typed-data descriptors extracted from the routers. The generator
// scans each router file for `_hashTypedDataV4(keccak256(abi.encode(TYPEHASH,
// ...)))` inside external functions — that gives us (action = function name,
// typehash name, router). The TYPEHASH string literal (parsed from wherever
// in src/ it's defined) is the authoritative EIP-712 signed shape. No
// product-specific action list hardcoded in the generator.
const ROUTER_FILES: { path: string; router: string }[] = [
  { path: 'src/AccountGate.sol', router: 'AccountGate' },
  { path: 'src/MasterGate.sol', router: 'MasterGate' },
  { path: 'src/HubGate.sol', router: 'HubGate' }
]

type Eip712Types = Record<string, { name: string; type: string }[]>

function parseTypeString(literal: string): { primaryType: string; types: Eip712Types } {
  // EIP-712 type encoding: `PrimaryStruct(field list)NestedA(field list)NestedB(field list)...`.
  // Each `\w+\(...\)` block is one struct; the first is primary.
  const structRegex = /(\w+)\(([^)]*)\)/g
  const types: Eip712Types = {}
  let primaryType: string | undefined
  let match: RegExpExecArray | null
  while ((match = structRegex.exec(literal)) !== null) {
    const structName = match[1]!
    const fieldsRaw = match[2]!
    const fields = fieldsRaw
      .split(',')
      .filter(f => f.trim().length > 0)
      .map(f => {
        const [type, name] = f.trim().split(/\s+/)
        if (!type || !name) throw new Error(`Malformed field "${f}" in type string "${literal}"`)
        return { name, type }
      })
    types[structName] = fields
    if (!primaryType) primaryType = structName
  }
  if (!primaryType) throw new Error(`No struct parsed from "${literal}"`)
  return { primaryType, types }
}

async function loadTypehashLiterals(): Promise<Map<string, string>> {
  const literals = new Map<string, string>()
  const typehashRegex = /bytes32\s+constant\s+(\w+_TYPEHASH)\s*=\s*keccak256\(\s*"([^"]+)"\s*\)/g
  const solGlob = new Bun.Glob('src/**/*.sol')
  for await (const file of solGlob.scan({ cwd: '.' })) {
    const content = await Bun.file(file).text()
    let match: RegExpExecArray | null
    while ((match = typehashRegex.exec(content)) !== null) {
      literals.set(match[1]!, match[2]!)
    }
  }
  return literals
}

// Scan a router file for external functions that construct an EIP-712 digest.
// Two-pass so each function's body is bounded by the next function start —
// keeps `_hashTypedDataV4` references from leaking across neighbours.
function scanRouterActions(source: string): { action: string; typehashName: string }[] {
  const fnRegex = /function\s+(\w+)\s*\([^)]*\)\s*(external|public|internal|private)/g
  const fns: { name: string; visibility: string; start: number }[] = []
  let m: RegExpExecArray | null
  while ((m = fnRegex.exec(source)) !== null) {
    fns.push({ name: m[1]!, visibility: m[2]!, start: m.index })
  }
  const bodyOf = (i: number): string =>
    source.slice(fns[i]!.start, i + 1 < fns.length ? fns[i + 1]!.start : source.length)
  const typehashCall = /_hashTypedDataV4\(\s*keccak256\(\s*abi\.encode\(\s*(\w+_TYPEHASH)\s*,/

  // A function inlines a digest, or delegates to an internal helper that does.
  const inlineTypehash = new Map<string, string>()
  fns.forEach((fn, i) => {
    const hit = typehashCall.exec(bodyOf(i))
    if (hit) inlineTypehash.set(fn.name, hit[1]!)
  })

  const found: { action: string; typehashName: string }[] = []
  fns.forEach((fn, i) => {
    if (fn.visibility !== 'external') return
    let typehashName = inlineTypehash.get(fn.name)
    if (!typehashName) {
      const body = bodyOf(i)
      for (const [helper, th] of inlineTypehash) {
        if (helper !== fn.name && new RegExp(`\\b${helper}\\s*\\(`).test(body)) {
          typehashName = th
          break
        }
      }
    }
    if (typehashName) found.push({ action: fn.name, typehashName })
  })
  return found
}

function parseEip712Domain(source: string): { name: string; version: string } | undefined {
  // Match `EIP712("Name", "Version")` from the contract's constructor initializer list.
  const m = /EIP712\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(source)
  return m ? { name: m[1]!, version: m[2]! } : undefined
}

async function generateIntentTypedData(): Promise<void> {
  console.log('Parsing routers for intent typed-data...')

  const literals = await loadTypehashLiterals()

  type RouterEntry = {
    router: string
    exportName: string
    eip712: { name: string; version: string }
    actions: { action: string; primaryType: string; types: Eip712Types }[]
  }
  const perRouter: RouterEntry[] = []

  for (const { path, router } of ROUTER_FILES) {
    if (!(await Bun.file(path).exists())) continue
    const source = await Bun.file(path).text()
    const eip712 = parseEip712Domain(source)
    if (!eip712) throw new Error(`${router} missing EIP712("name","version") constructor call`)

    const actions: { action: string; primaryType: string; types: Eip712Types }[] = []
    for (const { action, typehashName } of scanRouterActions(source)) {
      const literal = literals.get(typehashName)
      if (!literal) throw new Error(`${router}.${action} references unknown ${typehashName}`)
      actions.push({ action, ...parseTypeString(literal) })
    }
    actions.sort((a, b) => a.action.localeCompare(b.action))
    const exportName = `${router
      .replace(/([A-Z])/g, '_$1')
      .replace(/^_/, '')
      .toUpperCase()}_INTENTS`
    perRouter.push({ router, exportName, eip712, actions })
  }

  const chainIdMap = await loadChainIdMap()
  const allChainIds = [...new Set(Object.values(chainIdMap))].filter(n => !Number.isNaN(n)).sort((a, b) => a - b)
  const deployments = parseToml(await Bun.file(DEPLOYMENTS_PATH).text()) as Record<string, Record<string, unknown>>

  const findRouterEntry = (router: string): { address: string; chainIds: number[] } => {
    for (const section of Object.values(deployments)) {
      if (!section || typeof section !== 'object') continue
      const direct = (section as Record<string, { address?: string; chainBlockMap?: Record<string, unknown> }>)[router]
      if (direct?.address && direct.address !== ADDRESS_ZERO) {
        const chainIds = direct.chainBlockMap
          ? Object.keys(direct.chainBlockMap)
              .map(Number)
              .filter(n => !Number.isNaN(n))
          : []
        return { address: getAddress(direct.address), chainIds }
      }
      // Chain-keyed section: a universal gate (PuppetGate/MasterGate) lives at the same address
      // under every [chain.<alias>] block, so accumulate all chains rather than returning the first.
      const matched: number[] = []
      let matchedAddr: string | undefined
      for (const [alias, addresses] of Object.entries(section as Record<string, Record<string, string>>)) {
        const chainId = chainIdMap[alias] ?? Number(alias)
        if (Number.isNaN(chainId) || !addresses || typeof addresses !== 'object') continue
        const addr = addresses[router]
        if (addr && addr !== ADDRESS_ZERO) {
          matched.push(chainId)
          matchedAddr = getAddress(addr)
        }
      }
      if (matchedAddr) return { address: matchedAddr, chainIds: matched.sort((a, b) => a - b) }
    }
    return { address: ADDRESS_ZERO, chainIds: [] }
  }

  const renderAction = (a: { action: string; primaryType: string; types: Eip712Types }): string => {
    const typeEntries = Object.entries(a.types)
      .map(([name, fields]) => {
        const fieldLines = fields.map(f => `      { name: '${f.name}', type: '${f.type}' }`).join(',\n')
        return `      ${name}: [\n${fieldLines}\n      ]`
      })
      .join(',\n')
    return `  ${a.action}: {\n    primaryType: '${a.primaryType}',\n    types: {\n${typeEntries}\n    }\n  }`
  }

  const exportedConsts = perRouter
    .map(r => {
      const actionsBody = r.actions.map(renderAction).join(',\n')
      return `export const ${r.exportName} = {\n${actionsBody}\n} as const satisfies IntentActionMap`
    })
    .join('\n\n')

  const hubChainId = findRouterEntry('HubGate').chainIds[0] ?? chainIdMap.arbitrum ?? 42161

  const domainBlocks = perRouter
    .map(r => {
      const resolved = findRouterEntry(r.router)
      const chainIds =
        resolved.chainIds.length > 0 ? resolved.chainIds : r.router.includes('Hub') ? [hubChainId] : allChainIds
      const mapName = `${r.exportName.replace('_INTENTS', '')}_DOMAIN_MAP`
      const entries = [...chainIds]
        .sort((a, b) => a - b)
        .map(
          cid =>
            `  ${cid}: { name: '${r.eip712.name}', version: '${r.eip712.version}', chainId: ${cid}, verifyingContract: '${resolved.address}' }`
        )
        .join(',\n')
      return `export const ${mapName}: Record<number, TypedDataDomain> = {\n${entries}\n}`
    })
    .join('\n\n')

  const output = `// This file is auto-generated from router sources in contracts/src/**/*.sol.
// Do not edit manually.

import type { TypedDataDefinition, TypedDataDomain } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'>

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

${domainBlocks}

${exportedConsts}
`

  await Bun.write(`${OUTPUT_DIR}/intents/index.ts`, output)
  const totals = perRouter.map(r => `${r.exportName} (${r.actions.length})`).join(', ')
  console.log(`  Generated intent typed-data: ${totals}`)
}

type ForgeGasReport = {
  contract: string
  functions: Record<string, { calls: number; min: number; mean: number; median: number; max: number }>
}

async function generateGasLimits(): Promise<void> {
  console.log('Capturing gas-report data from forge tests...')

  const outPath = `${OUTPUT_DIR}/gasLimits/index.ts`

  // Reuse the artifacts compiled by the preceding `forge build` (build = `forge build && generate`),
  // so this is test execution only, not a second compile. Fuzz iterations add nothing to a
  // deterministic call-gas scrape, so pin them to 1.
  const proc = await Bun.$`forge test --gas-report --json`
    .env({ ...process.env, FOUNDRY_FUZZ_RUNS: '1' })
    .quiet()
    .nothrow()

  let reports: ForgeGasReport[] = []
  try {
    reports = JSON.parse(proc.stdout.toString())
  } catch {
    reports = []
  }

  if (reports.length === 0) {
    console.warn('  forge test produced no gas report — emitting placeholder gas values per action')
  }

  type RouterEntry = { router: string; entries: { action: string; max: number }[] }
  const perRouter: RouterEntry[] = []

  for (const { path, router } of ROUTER_FILES) {
    if (!(await Bun.file(path).exists())) continue
    const report = reports.find(r => r.contract.endsWith(`:${router}`))
    const source = await Bun.file(path).text()
    const actions = scanRouterActions(source)

    const entries: { action: string; max: number }[] = []
    const PLACEHOLDER_GAS = 1_500_000
    // No gas report at all (e.g. tests not yet rehabbed mid-overhaul) → placeholders are the only
    // option, matching the empty-report notice above. A NON-empty report missing a specific action
    // is a genuine coverage gap and still throws (unless explicitly overridden).
    const allowPlaceholder = process.env.ALLOW_PLACEHOLDER_GAS === '1' || reports.length === 0
    for (const { action } of actions) {
      const sig = report ? Object.keys(report.functions).find(s => s.startsWith(`${action}(`)) : undefined
      if (!sig || !report) {
        if (!allowPlaceholder) {
          throw new Error(
            `No gas-report coverage for ${router}.${action} — add a test that calls it, or run with ALLOW_PLACEHOLDER_GAS=1 to emit ${PLACEHOLDER_GAS} as a placeholder. Placeholders ship inflated relay-fee quotes and should never reach production.`
          )
        }
        console.warn(`  No gas-report coverage for ${router}.${action} — emitting placeholder ${PLACEHOLDER_GAS}`)
        entries.push({ action, max: PLACEHOLDER_GAS })
        continue
      }
      entries.push({ action, max: report.functions[sig]!.max })
    }

    entries.sort((a, b) => a.action.localeCompare(b.action))
    perRouter.push({ router, entries })
  }

  const body = perRouter
    .map(r => {
      const lines = r.entries.map(e => `    ${e.action}: ${e.max}n`).join(',\n')
      return `  ${r.router}: {${lines ? `\n${lines}\n  ` : ''}}`
    })
    .join(',\n')

  const output = `// This file is auto-generated from forge test --gas-report. Do not edit manually.

export const router__gasLimit = {
${body}
} as const
`

  await Bun.write(outPath, output)
  const totals = perRouter.map(r => `${r.router} (${r.entries.length})`).join(', ')
  console.log(`  Generated gas limits: ${totals}`)
}

async function generateGmx(): Promise<void> {
  console.log('Generating GMX contracts and data...')

  // Ensure GMX output directories exist
  await Bun.$`mkdir -p ${OUTPUT_DIR}/gmx/abi`

  // Run GMX generation scripts
  await Bun.$`bun run script/generate/gmx-contract-list.ts`
  await Bun.$`bun run script/generate/gmx-market-list.ts`
  await Bun.$`bun run script/generate/gmx-token-list.ts`
}

async function generateGmxIndex(): Promise<void> {
  const gmxIndexContent = `// This file is auto-generated. Do not edit manually.

export * from './gmxContracts.js'
export * from './marketList.js'
export * from './tokenList.js'
export { gmxErrorAbi } from './abi/gmxErrors.js'
`
  await Bun.write(`${OUTPUT_DIR}/gmx/index.ts`, gmxIndexContent)
}

async function cleanGeneratedFiles(): Promise<void> {
  console.log('Cleaning old generated files...')

  const abiDir = `${OUTPUT_DIR}/abi`
  try {
    const files = await Array.fromAsync(new Bun.Glob('*.ts').scan({ cwd: abiDir }))
    for (const file of files) {
      await Bun.$`rm -f ${abiDir}/${file}`
    }
  } catch {
    // Directory may not exist yet
  }

  // Each generated concept lives at `<concept>/index.ts`; gmx/ is hand-maintained, abi/ is regenerated above.
  for (const folder of ['const', 'deployments', 'events', 'errors', 'types', 'intents', 'gasLimits']) {
    await Bun.$`rm -rf ${OUTPUT_DIR}/${folder}`
  }
  await Bun.$`rm -f ${OUTPUT_DIR}/index.ts`
  // Stale flat files from the pre-folder layout
  for (const file of [
    'const.ts',
    'deployments.ts',
    'events.ts',
    'errors.ts',
    'types.ts',
    'intents.ts',
    'gasLimits.ts'
  ]) {
    await Bun.$`rm -f ${OUTPUT_DIR}/${file}`
  }
}

async function main(): Promise<void> {
  console.log('=== Puppet Contracts TypeScript Generator ===\n')

  // Clean old generated files
  await cleanGeneratedFiles()

  // Ensure output directories exist
  await Bun.$`mkdir -p ${OUTPUT_DIR}/abi`

  const chainIdMap = await loadChainIdMap()

  await generateContracts(chainIdMap)
  await generateErrorAbi()
  await generateEvents()
  await generateTypes()
  await generateIntentTypedData()
  if (Bun.env.SKIP_GAS !== '1' && Bun.env.SKIP_GAS !== 'true') {
    await generateGasLimits()
  } else if (await Bun.file(`${OUTPUT_DIR}/gasLimits/index.ts`).exists()) {
    console.log('Skipping gas-limit generation (SKIP_GAS); keeping existing gasLimits.ts.')
  } else {
    console.log('Skipping gas-limit generation (SKIP_GAS); emitting empty maps.')
    await Bun.write(
      `${OUTPUT_DIR}/gasLimits/index.ts`,
      '// SKIP_GAS placeholder. Do not edit manually.\n' +
        'export const router__gasLimit = { AccountGate: {}, MasterGate: {}, HubGate: {} } as const\n'
    )
  }
  await generateIndex()

  const skipGmx =
    Bun.env.SKIP_GMX === '1' ||
    Bun.env.SKIP_GMX === 'true' ||
    Bun.env.SKIP_NETWORK === '1' ||
    Bun.env.SKIP_NETWORK === 'true'
  if (!skipGmx) {
    await generateGmx()
    await generateGmxIndex()
  }

  console.log('\n=== Generation complete ===')
  console.log(`Output: ${OUTPUT_DIR}/`)
}

main().catch(error => {
  console.error('Generation failed:', error)
  process.exit(1)
})
