// This file is auto-generated from Puppet const.toml.
// Do not edit manually.

export const HUB_CHAIN_ID = 42161 as const
export const SPOKE_CHAIN_IDS = [8453] as const
export const CHAIN_IDS = [42161, 8453] as const

export const PROTOCOL_CONFIG = {
  maxBlockDelay: 240n,
  maxRelayFeeBps: 1000n,
  transferGasLimit: 200000n,
  signerDerivationMessage: "Puppet: Authorize session key"
} as const

export const BASIS_POINTS = 10000n
export const FLOAT_PRECISION = 10n ** 30n
export const MAX_QUOTE_AGE_SEC = 600n

export const GMX_REFERRAL_CODE = '0x5055505045540000000000000000000000000000000000000000000000000000' as const

export const CHAIN_TOKEN_MAP = {
  8453: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', WETH: '0x4200000000000000000000000000000000000006' },
  42161: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' }
} as const

export const OIF = {
  inputSettler: '0x000025c3226C00B2Cdc200005a1600509f4e00C0',
  outputSettler: '0x0000000000eC36B683C2E6AC89e9A75989C22a2e',
  oracle: '0x0000003E06000007A224AeE90052fA6bb46d43C9',
} as const

export const CHAIN_NETWORK_MAP = {
  8453: 'base',
  42161: 'arbitrum'
} as const

export const TOKEN_ID = {
  USDC: '0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa',
  WETH: '0x0f8a193ff464434486c0daf7db2a895884365d2bc84ba47a68fcf89c1b14b5b8'
} as const
