import { getAddress } from 'viem'

const INTERFACE_TOKENS_URL = 'https://raw.githubusercontent.com/gmx-io/gmx-interface/master/sdk/src/configs/tokens.ts'
const SYNTHETICS_TOKENS_URL = 'https://raw.githubusercontent.com/gmx-io/gmx-synthetics/main/config/tokens.ts'

type TokenData = {
  symbol: string
  baseSymbol?: string
  decimals: number
  address: string
  name?: string
  isFiat?: boolean
  synthetic?: boolean
  dataStreamFeedId?: string
  dataStreamFeedDecimals?: number
  priceFeedAddress?: string
}

type SyntheticsTokenData = {
  [symbol: string]: {
    address?: string
    decimals?: number
    synthetic?: boolean
    dataStreamFeedId?: string
    dataStreamFeedDecimals?: number
    priceFeed?: {
      address?: string
    }
  }
}

try {
  console.log('📥 Fetching token data from GMX Interface (primary source)...')

  // Fetch the interface tokens file content
  const interfaceResponse = await fetch(INTERFACE_TOKENS_URL)
  if (!interfaceResponse.ok) {
    throw new Error(`Failed to fetch interface tokens: ${interfaceResponse.status} ${interfaceResponse.statusText}`)
  }

  const interfaceContent = await interfaceResponse.text()

  console.log('📥 Fetching additional data from GMX Synthetics...')

  // Fetch the synthetics tokens file content
  const syntheticsResponse = await fetch(SYNTHETICS_TOKENS_URL)
  if (!syntheticsResponse.ok) {
    throw new Error(`Failed to fetch synthetics tokens: ${syntheticsResponse.status} ${syntheticsResponse.statusText}`)
  }

  const syntheticsContent = await syntheticsResponse.text()

  // Parse synthetics tokens to get additional data
  const syntheticsTokens: SyntheticsTokenData = {}

  // Find the arbitrum tokens section in synthetics
  const arbitrumPattern = /arbitrum:\s*\{([\s\S]*?)\n\s*\},?\s*\n\s*(?:avalanche|$)/
  const arbitrumMatch = syntheticsContent.match(arbitrumPattern)

  if (arbitrumMatch) {
    const arbitrumContent = arbitrumMatch[1]

    // Match token entries like: SYMBOL: { ... } or "SYMBOL": { ... }
    const tokenEntryPattern = /(?:"([^"]+)"|(\w+)):\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
    let match: RegExpExecArray | null

    while ((match = tokenEntryPattern.exec(arbitrumContent)) !== null) {
      const symbol = match[1] || match[2]
      const tokenContent = match[3]

      // Skip special entries
      if (symbol === 'default' || symbol === 'test' || symbol === 'priceFeed') continue

      // Extract properties
      const addressMatch = tokenContent.match(/address:\s*"(0x[a-fA-F0-9]{40})"/)
      const decimalsMatch = tokenContent.match(/decimals:\s*(\d+)/)
      const syntheticMatch = tokenContent.match(/synthetic:\s*true/)
      const dataStreamMatch = tokenContent.match(/dataStreamFeedId:\s*"(0x[a-fA-F0-9]+)"/)
      const dataStreamDecimalsMatch = tokenContent.match(/dataStreamFeedDecimals:\s*(\d+)/)
      const priceFeedMatch = tokenContent.match(/priceFeed:\s*\{[^}]*address:\s*"(0x[a-fA-F0-9]{40})"[^}]*\}/)

      syntheticsTokens[symbol] = {
        ...(addressMatch && { address: addressMatch[1] }),
        ...(decimalsMatch && { decimals: Number.parseInt(decimalsMatch[1], 10) }),
        ...(syntheticMatch && { synthetic: true }),
        ...(dataStreamMatch && { dataStreamFeedId: dataStreamMatch[1] }),
        ...(dataStreamDecimalsMatch && { dataStreamFeedDecimals: Number.parseInt(dataStreamDecimalsMatch[1], 10) }),
        ...(priceFeedMatch && { priceFeed: { address: priceFeedMatch[1] } })
      }
    }
  }

  // Extract tokens from interface
  const tokens: TokenData[] = []
  const seenAddresses = new Set<string>()

  // Find ARBITRUM tokens array in interface
  const arbitrumTokensPattern = /\[ARBITRUM\]:\s*\[([\s\S]*?)\],?\s*\n\s*\[(?:AVALANCHE|BOTANIX)/
  const arbitrumTokensMatch = interfaceContent.match(arbitrumTokensPattern)

  if (!arbitrumTokensMatch) {
    throw new Error('Could not find Arbitrum tokens in interface')
  }

  // Match individual token objects in the array
  const tokenObjectPattern = /\{([^}]+)\}/g
  let tokenMatch: RegExpExecArray | null

  while ((tokenMatch = tokenObjectPattern.exec(arbitrumTokensMatch[1])) !== null) {
    const tokenContent = tokenMatch[1]

    // Extract properties from interface
    const nameMatch = tokenContent.match(/name:\s*"([^"]+)"/)
    const symbolMatch = tokenContent.match(/symbol:\s*"([^"]+)"/)
    const assetSymbolMatch = tokenContent.match(/assetSymbol:\s*"([^"]+)"/)
    const baseSymbolMatch = tokenContent.match(/baseSymbol:\s*"([^"]+)"/)
    const addressMatch = tokenContent.match(/address:\s*"(0x[a-fA-F0-9]{40})"/)
    const decimalsMatch = tokenContent.match(/decimals:\s*(\d+)/)
    const isFiatMatch = tokenContent.match(/isStable:\s*true/)

    if (!symbolMatch || !addressMatch || !decimalsMatch) continue

    // Use assetSymbol if available, otherwise use symbol
    const originalSymbol = symbolMatch[1]
    const symbol = assetSymbolMatch ? assetSymbolMatch[1] : originalSymbol
    let baseSymbol = baseSymbolMatch ? baseSymbolMatch[1] : undefined

    // Extract base symbol from wrapped tokens with modifiers (e.g., "WAVAX (Wormhole)" -> "AVAX")
    if (!baseSymbol && symbol.startsWith('W') && symbol.includes(' (')) {
      const baseMatch = symbol.match(/^W(\w+)\s+\(/)
      if (baseMatch) {
        baseSymbol = baseMatch[1]
      }
    }

    const address = getAddress(addressMatch[1])
    const decimals = Number.parseInt(decimalsMatch[1], 10)
    const name = nameMatch ? nameMatch[1] : symbol

    // Skip duplicate addresses
    if (seenAddresses.has(address.toLowerCase())) continue
    seenAddresses.add(address.toLowerCase())

    // Get additional data from synthetics if available
    // Try both the modified symbol and original symbol for synthetics lookup
    const syntheticsData = syntheticsTokens[symbol] || syntheticsTokens[originalSymbol] || {}

    tokens.push({
      symbol,
      ...(baseSymbol && { baseSymbol }),
      decimals,
      address,
      name,
      ...(isFiatMatch && { isFiat: true }),
      ...(syntheticsData.synthetic && { synthetic: true }),
      ...(syntheticsData.dataStreamFeedId && { dataStreamFeedId: syntheticsData.dataStreamFeedId }),
      ...(syntheticsData.dataStreamFeedDecimals !== undefined && {
        dataStreamFeedDecimals: syntheticsData.dataStreamFeedDecimals
      }),
      ...(syntheticsData.priceFeed?.address && { priceFeedAddress: getAddress(syntheticsData.priceFeed.address) })
    })
  }

  // Sort tokens alphabetically by symbol
  tokens.sort((a, b) => a.symbol.localeCompare(b.symbol))

  console.log(`\n✅ Generated ${tokens.length} tokens from GMX Interface`)
  console.log(`✅ Enhanced ${Object.keys(syntheticsTokens).length} tokens with data from GMX Synthetics`)

  // Helper function to check if file content has changed
  async function writeIfChanged(filePath: string, newContent: string): Promise<boolean> {
    try {
      const existingFile = Bun.file(filePath)
      if (await existingFile.exists()) {
        const existingContent = await existingFile.text()

        if (existingContent === newContent) {
          return false // Content unchanged, no write needed
        }
      }
    } catch {
      // File doesn't exist or can't be read, proceed with write
    }

    // Either file doesn't exist or content has changed - write new content
    await Bun.write(filePath, newContent)
    return true // Content was written
  }

  // Write the file only if content has changed
  const tokenListContent = `// This file is auto-generated. Do not edit manually.
// Primary source: ${INTERFACE_TOKENS_URL}
// Enhanced with data from: ${SYNTHETICS_TOKENS_URL}
// Note: Token addresses correspond to indexToken addresses in GMX V2 markets

export const ARBITRUM_TOKEN_LIST = [
${tokens
  .map(
    token => `  {
    symbol: '${token.symbol}',${token.baseSymbol ? `\n    baseSymbol: '${token.baseSymbol}',` : ''}
    decimals: ${token.decimals},
    address: '${token.address}',
    name: '${token.name}'${token.isFiat ? ',\n    isFiat: true' : ''}${token.synthetic ? ',\n    synthetic: true' : ''}${token.dataStreamFeedId ? `,\n    dataStreamFeedId: '${token.dataStreamFeedId}'` : ''}${token.dataStreamFeedDecimals !== undefined ? `,\n    dataStreamFeedDecimals: ${token.dataStreamFeedDecimals}` : ''}${token.priceFeedAddress ? `,\n    priceFeedAddress: '${token.priceFeedAddress}'` : ''}
  }`
  )
  .join(',\n')}
] as const
`

  const wasUpdated = await writeIfChanged('./src-ts/gmx/tokenList.ts', tokenListContent)

  if (wasUpdated) {
    console.log(`✅ Successfully updated token list with ${tokens.length} tokens`)
  } else {
    console.log(`✅ Token list unchanged (${tokens.length} tokens)`)
  }

  // Only show detailed list if content was updated
  if (wasUpdated) {
    console.log('\nGenerated tokens:')
    tokens.forEach(token => {
      console.log(
        `- ${token.symbol} (${token.decimals} decimals)${token.name ? ` - ${token.name}` : ''}${token.synthetic ? ' [synthetic]' : ''}${token.dataStreamFeedId ? ' [has Chainlink stream]' : ''}`
      )
    })
  }
} catch (error) {
  console.error('❌ Error generating token descriptions:', error)
  process.exit(1)
}
