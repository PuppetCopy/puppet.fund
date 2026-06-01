#!/usr/bin/env bun

const RAW_BASE = 'https://raw.githubusercontent.com/gmx-io/gmx-synthetics/main'
const OUT_DIR = './src-ts/gmx'

const CONTRACT_MAPPINGS = {
  Reader: 'GmxReaderV2',
  ExchangeRouter: 'GmxExchangeRouter',
  OrderVault: 'GmxOrderVault',
  DataStore: 'GmxDatastore',
  EventEmitter: 'GmxEventEmitter'
} as const

type Deployment = { address: string; abi: unknown[] }

async function writeIfChanged(filePath: string, newContent: string): Promise<boolean> {
  const file = Bun.file(filePath)
  if (await file.exists()) {
    const existing = await file.text()
    if (existing === newContent) return false
  }
  await Bun.write(filePath, newContent)
  return true
}

async function fetchDeployment(name: string): Promise<Deployment> {
  const res = await fetch(`${RAW_BASE}/deployments/arbitrum/${name}.json`)
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<Deployment>
}

async function fetchErrorsSource(): Promise<string> {
  const res = await fetch(`${RAW_BASE}/contracts/error/Errors.sol`)
  if (!res.ok) throw new Error(`Failed to fetch Errors.sol: ${res.status} ${res.statusText}`)
  return res.text()
}

function parseErrors(source: string): Array<{ type: 'error'; name: string; inputs: unknown[] }> {
  const errors: Array<{ type: 'error'; name: string; inputs: unknown[] }> = []
  const errorPattern = /error\s+(\w+)\s*\(([^)]*)\)\s*;/g
  let match: RegExpExecArray | null
  while ((match = errorPattern.exec(source)) !== null) {
    const name = match[1]
    const paramsStr = match[2].trim()
    const inputs: Array<{ internalType: string; type: string; name: string }> = []
    if (paramsStr) {
      for (const param of paramsStr
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)) {
        const paramMatch = param.match(/^(.+?)(?:\s+(\w+))?$/)
        if (!paramMatch) continue
        const [, rawType, paramName] = paramMatch
        let abiType = rawType.trim()
        if (abiType === 'uint') abiType = 'uint256'
        if (abiType === 'int') abiType = 'int256'
        inputs.push({
          internalType: abiType,
          type: abiType,
          name: paramName ?? `param${inputs.length}`
        })
      }
    }
    errors.push({ type: 'error', name, inputs })
  }
  errors.sort((a, b) => a.name.localeCompare(b.name))
  return errors
}

const deploymentEntries = await Promise.all(
  Object.entries(CONTRACT_MAPPINGS).map(
    async ([deploymentName, contractName]) => [contractName, await fetchDeployment(deploymentName)] as const
  )
)
console.log(`Fetched ${deploymentEntries.length} deployments`)

let abiFilesUpdated = 0
await Promise.all(
  deploymentEntries.map(async ([contractName, { abi }]) => {
    const fileName = `gmx${contractName.replace('Gmx', '')}`
    const content = `// This file is auto-generated. Do not edit manually.
// Source: GMX deployment files from gmx-io/gmx-synthetics

export default ${JSON.stringify(abi, null, 2)} as const
`
    if (await writeIfChanged(`${OUT_DIR}/abi/${fileName}.ts`, content)) abiFilesUpdated++
  })
)

const importLines = deploymentEntries
  .map(([name]) => `import ${name.replace('Gmx', '').toLowerCase()}Abi from './abi/gmx${name.replace('Gmx', '')}.js'`)
  .join('\n')

const mapEntries = deploymentEntries
  .map(
    ([name, { address }]) => `  ${name}: {
    address: '${address}',
    abi: ${name.replace('Gmx', '').toLowerCase()}Abi
  }`
  )
  .join(',\n')

const contractListContent = `// This file is auto-generated. Do not edit manually.
// Source: GMX deployment files from gmx-io/gmx-synthetics

${importLines}

export const GMX_V2_CONTRACT_MAP = {
${mapEntries}
} as const
`

const contractListUpdated = await writeIfChanged(`${OUT_DIR}/gmxContracts.ts`, contractListContent)

const errors = parseErrors(await fetchErrorsSource())
const errorsContent = `// This file is auto-generated. Do not edit manually.
// Source: gmx-io/gmx-synthetics contracts/error/Errors.sol

export const gmxErrorAbi = ${JSON.stringify(errors, null, 2)} as const
`
const errorsUpdated = await writeIfChanged(`${OUT_DIR}/abi/gmxErrors.ts`, errorsContent)

console.log(
  `GMX generation done: ${abiFilesUpdated} ABI(s) updated, contract map ${contractListUpdated ? 'updated' : 'unchanged'}, errors ${errorsUpdated ? 'updated' : 'unchanged'} (${errors.length} entries)`
)
