import { type Address, createPublicClient, getAddress, http } from 'viem'
import { arbitrum } from 'viem/chains'
import { GMX_V2_CONTRACT_MAP } from '../../src-ts/gmx/gmxContracts.js'

// Contract addresses on Arbitrum
const READER_ADDRESS = GMX_V2_CONTRACT_MAP.GmxReaderV2.address
const DATASTORE_ADDRESS = GMX_V2_CONTRACT_MAP.GmxDatastore.address

// Create viem client
const client = createPublicClient({
  chain: arbitrum,
  transport: http('https://arb1.arbitrum.io/rpc')
})

// Reader contract ABI
const readerAbi = [
  {
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    name: 'getMarkets',
    outputs: [
      {
        components: [
          { name: 'marketToken', type: 'address' },
          { name: 'indexToken', type: 'address' },
          { name: 'longToken', type: 'address' },
          { name: 'shortToken', type: 'address' }
        ],
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const

type Market = {
  marketToken: Address
  indexToken: Address
  longToken: Address
  shortToken: Address
}

try {
  // Get all markets
  const markets = (await client.readContract({
    address: READER_ADDRESS,
    abi: readerAbi,
    functionName: 'getMarkets',
    args: [DATASTORE_ADDRESS, 0n, 200n]
  })) as Market[]

  // Build the market list with checksummed addresses
  const marketList = markets.map(market => {
    const isSpotMarket = market.indexToken === '0x0000000000000000000000000000000000000000'

    return {
      marketToken: getAddress(market.marketToken),
      indexToken: getAddress(market.indexToken),
      longToken: getAddress(market.longToken),
      shortToken: getAddress(market.shortToken),
      marketType: isSpotMarket ? ('SWAP' as const) : ('PERP' as const)
    }
  })

  // Generate the TypeScript file content
  const fileContent = `// This file is auto-generated. Do not edit manually.
// Source: GMX V2 Reader Contract (${READER_ADDRESS}) on Arbitrum

export const ARBITRUM_MARKET_LIST = [
${marketList
  .map(
    market => `  {
    marketToken: "${market.marketToken}",
    indexToken: "${market.indexToken}",
    longToken: "${market.longToken}",
    shortToken: "${market.shortToken}",
    marketType: "${market.marketType}"
  }`
  )
  .join(',\n')}
] as const
`

  // Write the file
  await Bun.write('./src-ts/gmx/marketList.ts', fileContent)

  console.log(`✅ Successfully generated market list with ${marketList.length} markets`)
  console.log('\nMarket summary:')
  console.log(`- PERP markets: ${marketList.filter(m => m.marketType === 'PERP').length}`)
  console.log(`- SWAP markets: ${marketList.filter(m => m.marketType === 'SWAP').length}`)
} catch (error) {
  console.error('❌ Error generating market list:', error)
  process.exit(1)
}
