#!/usr/bin/env bun
import { Glob } from 'bun'
import { basename } from 'path'
import { keccak256, parseAbiParameters, toHex } from 'viem'

const SRC_PATH = './src'

interface StructDefinition {
  name: string
  fields: Array<{ type: string; name: string }>
}

interface EventParam {
  type: string
  name: string
}

interface EventDefinition {
  name: string
  params: EventParam[]
  contractName: string
  sourceFile: string
}

type TypeMap = Record<string, string>

// Map Solidity contract names to deployment names (for CONTRACT_EVENT_MAP keys)
const CONTRACT_NAME_MAP: Record<string, string> = {}

const SOLIDITY_TO_ABI_TYPE: TypeMap = {
  uint: 'uint256',
  uint8: 'uint8',
  uint16: 'uint16',
  uint32: 'uint32',
  uint64: 'uint64',
  uint128: 'uint128',
  uint256: 'uint256',
  int: 'int256',
  int8: 'int8',
  int16: 'int16',
  int32: 'int32',
  int64: 'int64',
  int128: 'int128',
  int256: 'int256',
  address: 'address',
  bool: 'bool',
  bytes: 'bytes',
  bytes32: 'bytes32',
  bytes4: 'bytes4',
  string: 'string',
  // Custom type aliases
  ConfigId: 'bytes32'
}

const SPECIAL_VARS: TypeMap = {
  'msg.value': 'uint256',
  'msg.sender': 'address',
  'block.timestamp': 'uint256',
  'block.number': 'uint256',
  'block.chainid': 'uint256'
}

const LITERAL_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /^0$/, type: 'uint256' },
  { pattern: /^\d+$/, type: 'uint256' },
  { pattern: /^true$/, type: 'bool' },
  { pattern: /^false$/, type: 'bool' },
  { pattern: /^0x[a-fA-F0-9]{64}$/, type: 'bytes32' },
  { pattern: /^bytes32\(0\)$/, type: 'bytes32' },
  { pattern: /^address\(0\)$/, type: 'address' }
]

async function getAllSolFiles(dir: string, includeInterfaces = false): Promise<string[]> {
  const glob = new Glob('**/*.sol')
  const files: string[] = []

  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    if (file.includes('/test/')) continue
    if (!includeInterfaces && file.includes('/interface/')) continue
    files.push(file)
  }

  return files
}

function parseStructs(content: string): Map<string, StructDefinition> {
  const structs = new Map<string, StructDefinition>()
  const structRegex = /struct\s+(\w+)\s*\{([^}]+)\}/g
  let match: RegExpExecArray | null

  while ((match = structRegex.exec(content)) !== null) {
    const structName = match[1]!
    const body = match[2]!
    const fields: Array<{ type: string; name: string }> = []

    const fieldRegex = /(\w+(?:\[\])?)\s+(\w+)\s*;/g
    let fieldMatch: RegExpExecArray | null

    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.push({
        type: fieldMatch[1]!,
        name: fieldMatch[2]!
      })
    }

    structs.set(structName, { name: structName, fields })
  }

  return structs
}

function parseFunctionSignatures(content: string): Map<string, TypeMap> {
  const functionParams = new Map<string, TypeMap>()

  const multilineFuncRegex = /function\s+(\w+)\s*\(([\s\S]*?)\)\s*[^{]*?(?:returns\s*\(([\s\S]*?)\))?\s*\{/g
  let match: RegExpExecArray | null

  while ((match = multilineFuncRegex.exec(content)) !== null) {
    const funcName = match[1]!
    const params = match[2]!.replace(/\s+/g, ' ').trim()
    const returnParams = match[3]?.replace(/\s+/g, ' ').trim()
    const paramMap: TypeMap = {}

    if (params) {
      const paramParts = params.split(',')
      for (const part of paramParts) {
        const trimmed = part.trim()
        const paramMatch = trimmed.match(/^([\w.]+(?:\[\])?)\s+(?:memory\s+|calldata\s+|storage\s+)?(\w+)$/)
        if (paramMatch) {
          paramMap[paramMatch[2]!] = paramMatch[1]!
        }
      }
    }

    if (returnParams) {
      const returnParts = returnParams.split(',')
      for (const part of returnParts) {
        const trimmed = part.trim()
        const returnMatch = trimmed.match(/^([\w.]+(?:\[\])?)\s+(?:memory\s+)?(\w+)$/)
        if (returnMatch) {
          paramMap[returnMatch[2]!] = returnMatch[1]!
        }
      }
    }

    functionParams.set(funcName, paramMap)
  }

  return functionParams
}

function parseLocalVariables(functionBody: string): TypeMap {
  const vars: TypeMap = {}

  // Match both simple types and qualified types like Position.PositionInfo[]
  const patterns = [
    /([\w.]+(?:\[\])?)\s+(?:memory\s+|storage\s+|calldata\s+)?(\w+)\s*=/g,
    /([\w.]+(?:\[\])?)\s+(\w+)\s*;/g
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(functionBody)) !== null) {
      const type = match[1]!
      const name = match[2]!
      if (!type.match(/^(if|for|while|return|require|emit|delete|memory|storage|calldata)$/)) {
        vars[name] = type
      }
    }
  }

  // Parse tuple destructuring: (type1 var1, type2 var2) = ...
  const tuplePattern = /\(([\s\S]*?)\)\s*=/g
  let tupleMatch: RegExpExecArray | null
  while ((tupleMatch = tuplePattern.exec(functionBody)) !== null) {
    const tupleContent = tupleMatch[1]!
    // Parse each element in the tuple
    const elementPattern = /([\w.]+(?:\[\])?)\s+(?:memory\s+|storage\s+|calldata\s+)?(\w+)/g
    let elemMatch: RegExpExecArray | null
    while ((elemMatch = elementPattern.exec(tupleContent)) !== null) {
      const type = elemMatch[1]!
      const name = elemMatch[2]!
      if (!type.match(/^(if|for|while|return|require|emit|delete|memory|storage|calldata)$/)) {
        vars[name] = type
      }
    }
  }

  return vars
}

function parseStateVariables(content: string): TypeMap {
  const vars: TypeMap = {}
  // Contract-scope declarations are disambiguated from struct fields and locals
  // by a leading visibility/mutability keyword. Captures public getters too.
  const re =
    /^\s*([\w.]+(?:\[\])?)\s+(?:public|internal|private|immutable|constant)(?:\s+(?:public|internal|private|immutable|constant))*\s+(\w+)\s*;/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    vars[match[2]!] = match[1]!
  }
  return vars
}

function parseMappingDeclarations(content: string): TypeMap {
  const mappings: TypeMap = {}

  const mappingRegex = /mapping\s*\([^)]+\s*=>\s*(\w+(?:\[\])?)\)\s*(?:public\s+)?(\w+)/g
  let match: RegExpExecArray | null

  while ((match = mappingRegex.exec(content)) !== null) {
    const valueType = match[1]!
    const name = match[2]!
    mappings[name] = valueType
  }

  return mappings
}

function convertSolidityTypeToAbi(solType: string, structs: Map<string, StructDefinition>): string {
  const isArray = solType.endsWith('[]')
  const baseType = isArray ? solType.slice(0, -2) : solType

  if (SOLIDITY_TO_ABI_TYPE[baseType]) {
    return isArray ? `${SOLIDITY_TO_ABI_TYPE[baseType]}[]` : SOLIDITY_TO_ABI_TYPE[baseType]
  }

  if (
    baseType === 'IERC20' ||
    (baseType.startsWith('I') && baseType.length > 1 && baseType[1] === baseType[1]!.toUpperCase())
  ) {
    return isArray ? 'address[]' : 'address'
  }

  // Handle qualified struct names like "Position.PositionInfo" -> "PositionInfo"
  const unqualifiedType = baseType.includes('.') ? baseType.split('.').pop()! : baseType
  const structDef = structs.get(unqualifiedType)
  if (structDef) {
    const tupleParts = structDef.fields.map(f => `${convertSolidityTypeToAbi(f.type, structs)} ${f.name}`)
    const tuple = `(${tupleParts.join(', ')})`
    return isArray ? `${tuple}[]` : tuple
  }

  // Any PascalCase identifier that isn't a struct or known type is a contract reference (address)
  if (/^[A-Z]/.test(baseType)) {
    return isArray ? 'address[]' : 'address'
  }

  return isArray ? `${baseType}[]` : baseType
}

type PathSeg = { kind: 'name' | 'field'; value: string } | { kind: 'index' }

function parseAccessPath(arg: string): PathSeg[] | null {
  const segments: PathSeg[] = []
  let i = 0
  const headMatch = arg.match(/^(\w+)/)
  if (!headMatch) return null
  segments.push({ kind: 'name', value: headMatch[1]! })
  i += headMatch[1]!.length
  while (i < arg.length) {
    if (arg[i] === '.') {
      i++
      const fieldMatch = arg.slice(i).match(/^(\w+)/)
      if (!fieldMatch) return null
      segments.push({ kind: 'field', value: fieldMatch[1]! })
      i += fieldMatch[1]!.length
    } else if (arg[i] === '[') {
      let depth = 1
      let j = i + 1
      while (j < arg.length && depth > 0) {
        if (arg[j] === '[') depth++
        else if (arg[j] === ']') depth--
        if (depth > 0) j++
      }
      if (depth !== 0) return null
      segments.push({ kind: 'index' })
      i = j + 1
    } else {
      return null
    }
  }
  return segments
}

function lookupVarType(varName: string, functionParams: TypeMap, localVars: TypeMap): string | undefined {
  let solType = functionParams[varName] || localVars[varName]
  if (!solType && varName.startsWith('_')) {
    const stripped = varName.slice(1)
    solType = functionParams[stripped] || localVars[stripped]
  }
  return solType
}

function resolveType(
  varName: string,
  structs: Map<string, StructDefinition>,
  functionParams: TypeMap,
  localVars: TypeMap
): string {
  if (SPECIAL_VARS[varName]) {
    return SPECIAL_VARS[varName]!
  }

  // No-arg getter/method call: resolve by the method identifier (`x.foo()` → `foo`).
  const callMatch = varName.match(/^(?:\w+\.)*(\w+)\(\)$/)
  if (callMatch) varName = callMatch[1]!

  for (const { pattern, type } of LITERAL_PATTERNS) {
    if (pattern.test(varName)) {
      return type
    }
  }

  const path = parseAccessPath(varName)
  if (path && path.length >= 1) {
    const head = path[0]!
    if (head.kind === 'name') {
      let solType = lookupVarType(head.value, functionParams, localVars)
      if (solType) {
        for (let k = 1; k < path.length; k++) {
          const seg = path[k]!
          if (seg.kind === 'index') {
            if (!solType!.endsWith('[]')) return 'unknown'
            solType = solType!.slice(0, -2)
          } else if (seg.kind === 'field') {
            const base = solType!.endsWith('[]') ? solType!.slice(0, -2) : solType!
            const unqualified = base.includes('.') ? base.split('.').pop()! : base
            const structDef = structs.get(base) || structs.get(unqualified)
            if (!structDef) return 'unknown'
            const field = structDef.fields.find(f => f.name === seg.value)
            if (!field) return 'unknown'
            solType = field.type
          }
        }
        return convertSolidityTypeToAbi(solType!, structs)
      }
    }
  }

  return 'unknown'
}

function extractLogEventCalls(content: string): Array<{ eventName: string; encodeArgs: string; lineNumber: number }> {
  const events: Array<{ eventName: string; encodeArgs: string; lineNumber: number }> = []

  const normalized = content.replace(/\r\n/g, '\n')

  // Match both _logEvent(...) and eventEmitter.logEvent(...)
  const logEventRegex = /(?:_logEvent|eventEmitter\.logEvent)\s*\(\s*"(\w+)"\s*,\s*abi\.encode\s*\(/g
  let match: RegExpExecArray | null

  while ((match = logEventRegex.exec(normalized)) !== null) {
    const eventName = match[1]!
    const startIdx = match.index + match[0].length
    const lineNumber = normalized.slice(0, match.index).split('\n').length

    let depth = 1
    let endIdx = startIdx

    for (let i = startIdx; i < normalized.length && depth > 0; i++) {
      if (normalized[i] === '(') depth++
      if (normalized[i] === ')') depth--
      endIdx = i
    }

    let encodeArgs = normalized.slice(startIdx, endIdx).trim()
    encodeArgs = encodeArgs.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    encodeArgs = encodeArgs.replace(/\s+/g, ' ').trim()

    events.push({ eventName, encodeArgs, lineNumber })
  }

  return events
}

function parseEncodeArgs(encodeArgs: string): string[] {
  const args: string[] = []
  let current = ''
  let depth = 0

  for (const char of encodeArgs) {
    if (char === '(' || char === '[') {
      depth++
      current += char
    } else if (char === ')' || char === ']') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) args.push(trimmed)
      current = ''
    } else {
      current += char
    }
  }

  const trimmed = current.trim()
  if (trimmed) args.push(trimmed)

  return args
}

function extractVariableName(arg: string): string {
  const cast = arg.match(/^[A-Za-z_][\w]*\(\s*([^)]+)\s*\)$/)
  if (cast) return extractVariableName(cast[1]!.trim())
  return arg
}

const SOLIDITY_KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'address',
  'bool',
  'string',
  'bytes',
  'uint',
  'int',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'uint128',
  'uint256',
  'int8',
  'int16',
  'int32',
  'int64',
  'int128',
  'int256',
  'bytes1',
  'bytes2',
  'bytes4',
  'bytes8',
  'bytes16',
  'bytes32',
  'if',
  'else',
  'for',
  'while',
  'do',
  'break',
  'continue',
  'return',
  'function',
  'modifier',
  'event',
  'struct',
  'enum',
  'mapping',
  'public',
  'private',
  'internal',
  'external',
  'pure',
  'view',
  'payable',
  'memory',
  'storage',
  'calldata',
  'constant',
  'immutable',
  'contract',
  'interface',
  'library',
  'abstract',
  'virtual',
  'override',
  'constructor',
  'receive',
  'fallback',
  'error',
  'revert',
  'require',
  'assert'
])

function extractParamName(arg: string): string {
  let name: string

  if (arg === 'msg.sender') {
    name = 'sender'
  } else if (arg === 'msg.value') {
    name = 'msgValue'
  } else if (arg === 'block.timestamp') {
    name = 'timestamp'
  } else if (arg === 'block.number') {
    name = 'blockNumber'
  } else if (arg === 'block.chainid') {
    name = 'chainId'
  } else if (arg.match(/^(?:\w+\.)*(\w+)\(\)$/)) {
    name = arg
      .match(/^(?:\w+\.)*(\w+)\(\)$/)![1]!
      .replace(/^_+/, '')
      .replace(/_+$/, '')
  } else if (arg.match(/^[A-Za-z_][\w]*\(\s*([^)]+)\s*\)$/)) {
    const inner = arg.match(/^[A-Za-z_][\w]*\(\s*([^)]+)\s*\)$/)![1]!
    name = extractParamName(inner.trim())
  } else if (/[.[]/.test(arg)) {
    const path = parseAccessPath(arg)
    if (path) {
      const lastField = [...path].reverse().find(s => s.kind === 'field' || s.kind === 'name')
      if (lastField && lastField.kind !== 'index') name = lastField.value.replace(/^_+/, '').replace(/_+$/, '')
      else name = 'param'
    } else {
      name = 'param'
    }
  }
  // Literals — checked before simple-var so `true`/`false` don't fall into the
  // identifier branch and end up renamed `trueValue`/`falseValue`.
  else if (arg === 'true' || arg === 'false') {
    name = 'flag'
  } else if (/^\d+$/.test(arg)) {
    name = 'amount'
  } else if (/^0x[a-fA-F0-9]+$/.test(arg)) {
    name = 'data'
  } else if (/^bytes32\(0\)$/.test(arg)) {
    name = 'data'
  } else if (/^address\(0\)$/.test(arg)) {
    name = 'addr'
  }
  // Simple variable, strip leading and trailing underscores: "_foo_" -> "foo"
  else if (arg.match(/^_?(\w+)$/)) {
    name = arg.match(/^_?(\w+)$/)![1]!.replace(/_+$/, '')
  } else {
    name = 'param'
  }

  // Ensure name is not a Solidity keyword
  if (SOLIDITY_KEYWORDS.has(name)) {
    name = `${name}Value`
  }

  // Ensure name doesn't start with a number
  if (/^\d/.test(name)) {
    name = `param${name}`
  }

  return name
}

function getFunctionContaining(content: string, lineNumber: number): string | null {
  const lines = content.split('\n')
  let braceDepth = 0
  let funcStart = -1
  let funcStartDepth = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (funcStart === -1 && line.match(/function\s+\w+/)) {
      funcStart = i
      funcStartDepth = braceDepth
    }

    for (const char of line) {
      if (char === '{') braceDepth++
      if (char === '}') {
        braceDepth--
        if (funcStart !== -1 && braceDepth === funcStartDepth) {
          if (lineNumber >= funcStart && lineNumber <= i) {
            return lines.slice(funcStart, i + 1).join('\n')
          }
          funcStart = -1
          funcStartDepth = -1
        }
      }
    }
  }

  return null
}

function extractContractName(content: string): string | null {
  // Match "contract ContractName is ..." or "contract ContractName {"
  const match = content.match(/\bcontract\s+(\w+)\s*(?:is|{)/)
  return match ? match[1]! : null
}

// Returns Map<contractName, EventDefinition[]>
export async function parseEventsFromSolidity(): Promise<Map<string, EventDefinition[]>> {
  const contractEvents = new Map<string, EventDefinition[]>()
  const allStructs = new Map<string, StructDefinition>()
  const globalStateVars: TypeMap = {}

  // Include interface files for struct definitions and public getter types.
  const allFiles = await getAllSolFiles(SRC_PATH, true)
  for (const file of allFiles) {
    const content = await Bun.file(file).text()
    const fileStructs = parseStructs(content)

    for (const [name, struct] of fileStructs) {
      allStructs.set(name, struct)
    }
    Object.assign(globalStateVars, parseStateVariables(content))
  }

  // Exclude interface files for event parsing
  const solFiles = await getAllSolFiles(SRC_PATH, false)
  for (const file of solFiles) {
    const content = await Bun.file(file).text()
    const contractName = extractContractName(content)
    if (!contractName) continue

    const logEvents = extractLogEventCalls(content)
    const functionSignatures = parseFunctionSignatures(content)
    const mappings = parseMappingDeclarations(content)
    const fileStateVars = parseStateVariables(content)

    // Merge global structs with file-local structs (local takes precedence for same-name structs like Intent)
    const fileStructs = parseStructs(content)
    const mergedStructs = new Map(allStructs)
    for (const [name, struct] of fileStructs) {
      mergedStructs.set(name, struct)
    }

    for (const { eventName, encodeArgs, lineNumber } of logEvents) {
      const args = parseEncodeArgs(encodeArgs)
      const funcBody = getFunctionContaining(content, lineNumber)
      const localVars = funcBody ? parseLocalVariables(funcBody) : {}
      // Scope params to the containing function only — merging all functions in a file causes
      // same-named params (e.g. `_params`) to clobber each other and resolve to the wrong type.
      const containingFunc = funcBody?.match(/function\s+(\w+)/)?.[1]
      const funcParamsForEvent: TypeMap = {
        ...mappings,
        ...globalStateVars,
        ...fileStateVars,
        ...(containingFunc ? (functionSignatures.get(containingFunc) ?? {}) : {})
      }

      const eventParams: EventParam[] = []
      const usedNames = new Set<string>()

      for (const arg of args) {
        const varName = extractVariableName(arg)
        const resolvedType = resolveType(varName, mergedStructs, funcParamsForEvent, localVars)
        let paramName = extractParamName(arg)

        // Ensure unique names by appending index if needed
        if (usedNames.has(paramName)) {
          let i = 2
          while (usedNames.has(`${paramName}${i}`)) i++
          paramName = `${paramName}${i}`
        }
        usedNames.add(paramName)

        eventParams.push({ type: resolvedType, name: paramName })
      }

      const eventDef: EventDefinition = {
        name: eventName,
        params: eventParams,
        contractName,
        sourceFile: basename(file)
      }

      const existingEvents = contractEvents.get(contractName) || []

      // Check for duplicate event name within same contract
      const existingIdx = existingEvents.findIndex(e => e.name === eventName)
      if (existingIdx !== -1) {
        // Keep the one with fewer unknowns
        const existing = existingEvents[existingIdx]!
        const existingUnknowns = existing.params.filter(p => p.type === 'unknown').length
        const newUnknowns = eventParams.filter(p => p.type === 'unknown').length
        if (newUnknowns < existingUnknowns) {
          existingEvents[existingIdx] = eventDef
        }
      } else {
        existingEvents.push(eventDef)
      }

      contractEvents.set(contractName, existingEvents)
    }
  }

  return contractEvents
}

export function generateEventParamsCode(contractEvents: Map<string, EventDefinition[]>): string {
  // Generate CONTRACT_EVENT_MAP organized by contract with hashes included
  const sortedContracts = Array.from(contractEvents.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  const contractLines = sortedContracts
    .map(([solidityName, events]) => {
      // Use mapped name if available (e.g., SubscribeModule -> Rule)
      const contractName = CONTRACT_NAME_MAP[solidityName] || solidityName
      const sortedEvents = events.sort((a, b) => a.name.localeCompare(b.name))
      const eventLines = sortedEvents
        .map(event => {
          const hash = keccak256(toHex(event.name))
          // Replace 'unknown' types with 'uint256' as fallback (common for nested mappings)
          const paramStr = event.params.map(p => `${p.type === 'unknown' ? 'uint256' : p.type} ${p.name}`).join(', ')
          const parsed = parseAbiParameters(paramStr)
          const argsStr = JSON.stringify(parsed).replace(/"(\w+)":/g, '$1:')
          return `    ${event.name}: {\n      hash: '${hash}',\n      args: ${argsStr}\n    }`
        })
        .join(',\n')

      return `  ${contractName}: {\n${eventLines}\n  }`
    })
    .join(',\n')

  return `// This file is auto-generated from Solidity source files. Do not edit manually.
// Generated by: bun run script/parse-events.ts

export const CONTRACT_EVENT_MAP = {
${contractLines}
} as const
`
}

if (import.meta.main) {
  console.log('Parsing Solidity files for _logEvent calls...')

  const contractEvents = await parseEventsFromSolidity()

  let totalEvents = 0
  for (const [contractName, events] of contractEvents) {
    console.log(`\n${contractName}:`)
    for (const event of events) {
      const paramsStr = event.params.map(p => `${p.type} ${p.name}`).join(', ')
      console.log(`  ${event.name}: (${paramsStr})`)
      totalEvents++
    }
  }
  console.log(`\nTotal: ${totalEvents} events across ${contractEvents.size} contracts`)

  const code = generateEventParamsCode(contractEvents)

  // Write to file
  const outputPath = './script/__generated/events.ts'
  await Bun.write(outputPath, code)
  console.log(`\nWritten to ${outputPath}`)
}
