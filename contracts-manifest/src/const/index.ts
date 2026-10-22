export const HUB_CHAIN_ID = 10 as const
export const SPOKE_CHAIN_IDS = [137, 4663, 42161] as const
export const CHAIN_IDS = [10, 137, 4663, 42161] as const

export const PROTOCOL = {
  version: 39n,
  maxRelayFeeBps: 1000n,
  maxSwapRelayFeeBps: 3333n,
  maxIntentTtlSec: 300n,
  performanceFee: 1650n,
  protocolFeeShare: 1000n,
  maxCohortSize: 100n,
  transferGasLimit: 200000n,
  nativeToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  attestor: "0x6099cf647F048571BE259e0dFc6A46240AD75E7E"
} as const

export const HUB_CANONICAL_TOKEN = {
  USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  WETH: '0x4200000000000000000000000000000000000006'
} as const

export const CHAIN_NETWORK_MAP = {
  10: 'optimism',
  137: 'polygon',
  4663: 'robinhood',
  42161: 'arbitrum'
} as const

export const CHAIN_VERIFIER_MAP = {
  10: 'etherscan',
  137: 'etherscan',
  4663: 'sourcify',
  42161: 'etherscan'
} as const

export const CREATE2_FACTORY = '0x0000000000FFe8B47B3e2130213B802212439497' as const
export const FULL_ACCESS = '0xffffffff' as const

export const VIRTUAL_SHARES = 1000000000000n
export const VIRTUAL_VALUE = 1000000000000n
export const PRICE_PRECISION = 1000000000000n
