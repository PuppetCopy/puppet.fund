import { type Address, getAddress } from 'viem'
import type { ChainId } from '../../const/index.js'

export const UNISWAP_PLATFORM = 'uniswap'

export interface IUniswapRouter {
  address: Address
  version: '2.0' | '2.1'
}

export interface IUniswapDeployment {
  routerList: readonly IUniswapRouter[]
  permit2: Address
}

export interface IUniswapPools {
  v3Factory: Address
  quoterV2: Address
}

export const UNISWAP_DEPLOYMENTS: Partial<Record<ChainId, IUniswapDeployment>> = {
  [137 as ChainId]: {
    routerList: [
      { address: getAddress('0x1095692a6237d83c6a72f3f5efedb9a670c49223'), version: '2.0' },
      { address: getAddress('0xDc264714F68d84CF29BC605589405E78bDBE7C9f'), version: '2.1' }
    ],
    permit2: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  },
  [42161 as ChainId]: {
    routerList: [
      { address: getAddress('0xa51afafe0263b40edaef0df8781eA9aa03E381a3'), version: '2.0' },
      { address: getAddress('0x2d01411773c8C24805306E89A41F7855C3c4Fe65'), version: '2.1' }
    ],
    permit2: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  },
  [4663 as ChainId]: {
    routerList: [{ address: getAddress('0x204FAca1764B154221e35c0d20aBb3c525710498'), version: '2.1' }],
    permit2: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  }
}

export const UNISWAP_POOLS: Partial<Record<ChainId, IUniswapPools>> = {
  [10 as ChainId]: { v3Factory: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'), quoterV2: getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e') },
  [137 as ChainId]: { v3Factory: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'), quoterV2: getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e') },
  [42161 as ChainId]: { v3Factory: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'), quoterV2: getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e') },
  [4663 as ChainId]: { v3Factory: getAddress('0x1F7D7550B1b028f7571E69A784071F0205FD2EfA'), quoterV2: getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7') }
}

export const PERMIT2_DOMAIN_NAME = 'Permit2'
export const PERMIT2_ALLOWANCE_TYPES: ReadonlySet<string> = new Set(['PermitSingle', 'PermitBatch'])

export const ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' }
    ],
    outputs: []
  }
] as const

export const PERMIT2_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' }
    ],
    outputs: []
  }
] as const

export const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ]
      }
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' }
    ]
  }
] as const

export const V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' }
    ],
    outputs: [{ name: 'pool', type: 'address' }]
  }
] as const

export const V3_POOL_ABI = [
  {
    type: 'function',
    name: 'observe',
    stateMutability: 'view',
    inputs: [{ name: 'secondsAgos', type: 'uint32[]' }],
    outputs: [
      { name: 'tickCumulatives', type: 'int56[]' },
      { name: 'secondsPerLiquidityCumulativeX128s', type: 'uint160[]' }
    ]
  }
] as const
