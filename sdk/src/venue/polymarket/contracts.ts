import { type Address, getAddress } from 'viem'
import type { ChainId } from '../../const/index.js'
import { CHAIN_TOKEN_MAP, TOKEN_META } from '../../const/network.js'

export const POLYMARKET_PLATFORM = 'polymarket'
export const POLYMARKET_CHAIN_ID = 137 satisfies ChainId
export const POLYMARKET_COLLATERAL_DECIMALS = 6
export const POLYMARKET_READ_TIMEOUT_MS = 12_000
export const POLYMARKET_COLLATERAL_SYMBOL = TOKEN_META.USDC.symbol

export const POLYMARKET_DEPOSIT_TOKEN = CHAIN_TOKEN_MAP[POLYMARKET_CHAIN_ID].USDC as Address
export const POLYMARKET_DEPOSIT_MIN = 1_000_000n
export const POLYMARKET_DEPOSIT_SLIPPAGE_BPS = 10n
export const POLYMARKET_SWAP_ROUTER = getAddress('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45')
export const POLYMARKET_SWAP_FEE = 100

export const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ]
      }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  }
] as const

export const polymarketDepositFloor = (amountIn: bigint): bigint => amountIn - (amountIn * POLYMARKET_DEPOSIT_SLIPPAGE_BPS) / 10_000n

export const POLYMARKET_EXCHANGE = getAddress('0xE111180000d2663C0091e4f400237545B87B996B')
export const POLYMARKET_NEG_RISK_EXCHANGE = getAddress('0xe2222d279d744050d28e00520010520000310F59')
export const POLYMARKET_NEG_RISK_ADAPTER = getAddress('0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296')
export const POLYMARKET_CONDITIONAL_TOKENS = getAddress('0x4D97DCd97eC945f40cF65F87097ACe5EA0476045')
export const POLYMARKET_COLLATERAL = getAddress('0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB')
export const POLYMARKET_COLLATERAL_VAULT = getAddress('0xC417fD8E9661c0d2120B64a04Bb3278C17E99DB1')
export const POLYMARKET_BRIDGED_USDC = CHAIN_TOKEN_MAP[POLYMARKET_CHAIN_ID].USDCE as Address
export const POLYMARKET_ONRAMP = getAddress('0x93070a847efEf7F70739046A929D47a521F5B8ee')
export const POLYMARKET_OFFRAMP = getAddress('0x2957922Eb93258b93368531d39fAcCA3B4dC5854')
export const POLYMARKET_ADAPTER = getAddress('0xAdA100Db00Ca00073811820692005400218FcE1f')
export const POLYMARKET_NEG_RISK_ADAPTER_V2 = getAddress('0xadA2005600Dec949baf300f4C6120000bDB6eAab')
export const POLYMARKET_ROUTER = getAddress('0x12121212006e4CD160D18e3f00711DA5c3372600')
export const POLYMARKET_POSITION_MANAGER = getAddress('0x006F54F7f9A22e0000CC2AB60031000000ae9fEF')
export const POLYMARKET_COMBOS_EXCHANGE = getAddress('0xe3333700cA9d93003F00f0F71f8515005F6c00Aa')
export const POLYMARKET_BINARY_MODULE = getAddress('0x1000008dD9001B968442c1000017eaE6E0dA00Ba')
export const POLYMARKET_NEG_RISK_MODULE = getAddress('0x200000900045e3B6259600682756002200028933')
export const POLYMARKET_AUTO_REDEEMER = getAddress('0xa1200000d0002264C9a1698e001292D00E1b00af')
export const POLYMARKET_WALLET_FACTORY = getAddress('0x00000000000Fb5C9ADea0298D729A0CB3823Cc07')
export const POLYMARKET_WALLET_BEACON = getAddress('0x7A18EDfe055488A3128f01F563e5B479D92ffc3a')
export const POLYMARKET_WRAPPED_COLLATERAL = getAddress('0x3A3BD7bb9528E159577F7C2e685CC81A765002E2')
export const POLYMARKET_RELAY_PROXY = getAddress('0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE')
export const POLYMARKET_RELAY_ROUTER = getAddress('0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f')
export const POLYMARKET_RELAY_DEPOSITORY = getAddress('0x4cD00E387622C35bDDB9b4c962C136462338BC31')
export const POLYMARKET_TYCHO_ROUTER = getAddress('0xbd4e6011F03355C2A377Fd9Af939322A7d0A1bC1')
export const POLYMARKET_APP_URL = 'https://polymarket.com'
export const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com'
export const POLYMARKET_DATA_URL = 'https://data-api.polymarket.com'
export const POLYMARKET_MAX_SPREAD = 100_000n
export const POLYMARKET_POSITION_WINDOW_BLOCKS = 9_000n
export const POLYMARKET_RELAYER_URL = 'https://relayer-v2.polymarket.com'
export const POLYMARKET_WITHDRAW_DEADLINE_SEC = 900


export const WALLET_NONCE_ABI = [{ type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }] as const

export const POLYMARKET_EXCHANGES: readonly Address[] = [POLYMARKET_EXCHANGE, POLYMARKET_NEG_RISK_EXCHANGE]

export const POLYMARKET_EXCHANGE_COLLATERAL: ReadonlyMap<Address, Address> = new Map([
  [POLYMARKET_EXCHANGE, POLYMARKET_BRIDGED_USDC],
  [POLYMARKET_NEG_RISK_EXCHANGE, POLYMARKET_WRAPPED_COLLATERAL]
])

export const CTF_ABI = [
  {
    type: 'function',
    name: 'getCollectionId',
    stateMutability: 'view',
    inputs: [
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSet', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'getPositionId',
    stateMutability: 'pure',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collectionId', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  { type: 'function', name: 'getOutcomeSlotCount', stateMutability: 'view', inputs: [{ name: 'conditionId', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'payoutDenominator', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'payoutNumerators',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'bytes32' },
      { name: '', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'balanceOfBatch',
    stateMutability: 'view',
    inputs: [
      { name: 'owners', type: 'address[]' },
      { name: 'ids', type: 'uint256[]' }
    ],
    outputs: [{ name: '', type: 'uint256[]' }]
  },
  {
    type: 'event',
    name: 'TransferSingle',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'value', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'TransferBatch',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'ids', type: 'uint256[]', indexed: false },
      { name: 'values', type: 'uint256[]', indexed: false }
    ]
  }
] as const

export const POLYMARKET_ADMITTED_APPROVALS: ReadonlyMap<Address, readonly Address[]> = new Map([
  [
    POLYMARKET_COLLATERAL,
    [
      POLYMARKET_CONDITIONAL_TOKENS,
      POLYMARKET_EXCHANGE,
      POLYMARKET_NEG_RISK_EXCHANGE,
      POLYMARKET_NEG_RISK_ADAPTER,
      POLYMARKET_ADAPTER,
      POLYMARKET_NEG_RISK_ADAPTER_V2,
      POLYMARKET_ROUTER,
      POLYMARKET_COMBOS_EXCHANGE,
      POLYMARKET_OFFRAMP
    ]
  ],
  [POLYMARKET_BRIDGED_USDC, [POLYMARKET_ONRAMP, POLYMARKET_RELAY_PROXY]]
])

export const POLYMARKET_ADMITTED_OPERATORS: ReadonlyMap<Address, readonly Address[]> = new Map([
  [
    POLYMARKET_CONDITIONAL_TOKENS,
    [
      POLYMARKET_EXCHANGE,
      POLYMARKET_NEG_RISK_EXCHANGE,
      POLYMARKET_NEG_RISK_ADAPTER,
      POLYMARKET_ADAPTER,
      POLYMARKET_NEG_RISK_ADAPTER_V2,
      POLYMARKET_BINARY_MODULE,
      POLYMARKET_NEG_RISK_MODULE,
      POLYMARKET_AUTO_REDEEMER
    ]
  ],
  [POLYMARKET_POSITION_MANAGER, [POLYMARKET_ROUTER, POLYMARKET_COMBOS_EXCHANGE, POLYMARKET_AUTO_REDEEMER]]
])

export const CLOB_AUTH_DOMAIN = { name: 'ClobAuthDomain', version: '1' } as const
export const CLOB_AUTH_MESSAGE = 'This message attests that I control the given wallet'
export const CLOB_AUTH_TYPES = [
  { name: 'address', type: 'address' },
  { name: 'timestamp', type: 'string' },
  { name: 'nonce', type: 'uint256' },
  { name: 'message', type: 'string' }
] as const

export const EXCHANGE_DOMAIN = { name: 'Polymarket CTF Exchange', version: '2' } as const
export const ORDER_TYPES = [
  { name: 'salt', type: 'uint256' },
  { name: 'maker', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'makerAmount', type: 'uint256' },
  { name: 'takerAmount', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'signatureType', type: 'uint8' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'builder', type: 'bytes32' }
] as const
export const TYPED_DATA_SIGN_TYPES = [
  { name: 'contents', type: 'Order' },
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' }
] as const
export const DEPOSIT_WALLET_SIGNATURE_TYPE = 3

export const WALLET_DOMAIN = { name: 'DepositWallet', version: '1' } as const
export const BATCH_TYPES = [
  { name: 'wallet', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'calls', type: 'Call[]' }
] as const
export const CALL_TYPES = [
  { name: 'target', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' }
] as const

export const OFFRAMP_ABI = [
  {
    type: 'function',
    name: 'unwrap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_asset', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' }
    ],
    outputs: []
  }
] as const

export const ONRAMP_ABI = [
  {
    type: 'function',
    name: 'wrap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_asset', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' }
    ],
    outputs: []
  }
] as const

export const RELAY_PROXY_ABI = [
  {
    type: 'function',
    name: 'transferAndMulticall',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' }
        ]
      },
      { name: 'refundTo', type: 'address' },
      { name: 'nftRecipient', type: 'address' },
      { name: 'metadata', type: 'bytes' }
    ],
    outputs: []
  }
] as const

export const RELAY_ROUTER_ABI = [
  {
    type: 'function',
    name: 'cleanupErc20s',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'metadata', type: 'bytes' }
    ],
    outputs: []
  }
] as const

export const TYCHO_ROUTER_ABI = [
  {
    type: 'function',
    name: 'sequentialSwap',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'expectedAmountOut', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      {
        name: 'clientFeeParams',
        type: 'tuple',
        components: [
          { name: 'clientFeeBps', type: 'uint32' },
          { name: 'clientFeeReceiver', type: 'address' },
          { name: 'maxClientContribution', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'clientSignature', type: 'bytes' }
        ]
      },
      { name: 'swaps', type: 'bytes' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const

export const OWNER_ABI = [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }] as const

export const SET_APPROVAL_FOR_ALL_ABI = [
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' }
    ],
    outputs: []
  }
] as const
