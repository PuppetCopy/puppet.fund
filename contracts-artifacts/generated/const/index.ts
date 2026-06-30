// This file is auto-generated from Puppet const.toml.
// Do not edit manually.

export const HUB_CHAIN_ID = 143 as const
export const SPOKE_CHAIN_IDS = [137, 4326, 8453, 42161] as const
export const CHAIN_IDS = [143, 137, 4326, 8453, 42161] as const

// Per-chain meta keyed by chainId: id + staleness window (blocks) + wrapped-native symbol + native
// gas symbol. Mirror of const.toml [CHAIN_META]. blockDelay is the per-chain intent-staleness window
// (read it via this map, not a global PROTOCOL.maxBlockDelay); nativeSymbol prices the native gas asset.
export const CHAIN_META = {
  137: { id: 137, blockDelay: 600n, wnt: 'WPOL', nativeSymbol: 'POL' },
  143: { id: 143, blockDelay: 1500n, wnt: 'WMON', nativeSymbol: 'MON' },
  4326: { id: 4326, blockDelay: 600n, wnt: 'WETH', nativeSymbol: 'ETH' },
  8453: { id: 8453, blockDelay: 300n, wnt: 'WETH', nativeSymbol: 'ETH' },
  42161: { id: 42161, blockDelay: 2400n, wnt: 'WETH', nativeSymbol: 'ETH' }
} as const

export const PROTOCOL = {
  maxRelayFeeBps: 1000n,
  transferGasLimit: 200000n,
  signerDerivationMessage: "Puppet: Authorize session key",
  nativeToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
} as const

export const PRECISION = {
  basisPoints: 10000n,
  floatPrecisionExp: 10n ** 30n,
  sharePrecisionExp: 10n ** 12n,
  shareTokenDecimals: 18,
  maxQuoteAgeSec: 600n
} as const

export const GMX = {
  referralCode: '0x5055505045540000000000000000000000000000000000000000000000000000'
} as const

export const CHAIN_TOKEN_MAP = {
  1: { ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  137: { POL: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', WPOL: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
  143: { MON: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', WETH: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242', USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', USDT: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D' },
  4326: { ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', USDT: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', WETH: '0x4200000000000000000000000000000000000006' },
  8453: { ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', WETH: '0x4200000000000000000000000000000000000006' },
  42161: { ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' }
} as const

export const SWAP_PROVIDER = {
  1: { lifiDiamond: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' },
  137: { lifiDiamond: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' },
  143: { lifiDiamond: '0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' },
  4326: { lifiDiamond: '0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' },
  8453: { lifiDiamond: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' },
  42161: { lifiDiamond: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', acrossPeriphery: '0x10D8b8DaA26d307489803e10477De69C0492B610' }
} as const

export const CHAIN_NETWORK_MAP = {
  1: 'ethereum',
  137: 'polygon',
  143: 'monad-mainnet',
  4326: 'megaeth',
  8453: 'base',
  42161: 'arbitrum'
} as const

export const TOKEN_ID = {
  ETH: '0xaaaebeba3810b1e6b70781f14b2d72c1cb89c0b2b320c43bb67ff79f562f5ff4',
  MON: '0xa83b79a2d1ac062104a3ba6844475b254e6a04f5e90a75ef63ed332f7e0bda83',
  POL: '0x5611acaae5e6f2d151766dae4f93d18a904ae6f9265184ffea692c2e6e52b7fe',
  USDC: '0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa',
  USDT: '0x8b1a1d9c2b109e527c9134b25b1a1833b16b6594f92daa9f6d9b7a6024bce9d0',
  WETH: '0x0f8a193ff464434486c0daf7db2a895884365d2bc84ba47a68fcf89c1b14b5b8',
  WMON: '0x66c95aea0fa8dbfa226f98155527e478942706d504c94cf159d9231416a711b9',
  WPOL: '0x5ca6f0cd1df34946d1ad8bf027951ac275d9659f84a379f473c0228412fd8046'
} as const

export const TOKEN_META = {
  ETH: { symbol: 'ETH', decimals: 18, isFiat: false },
  MON: { symbol: 'MON', decimals: 18, isFiat: false },
  POL: { symbol: 'POL', decimals: 18, isFiat: false },
  USDC: { symbol: 'USDC', decimals: 6, isFiat: true },
  USDT: { symbol: 'USDT', decimals: 6, isFiat: true },
  WETH: { symbol: 'ETH', decimals: 18, isFiat: false },
  WMON: { symbol: 'MON', decimals: 18, isFiat: false },
  WPOL: { symbol: 'POL', decimals: 18, isFiat: false }
} as const
