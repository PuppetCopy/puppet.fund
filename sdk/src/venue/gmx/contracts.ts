import { encodeAbiParameters, getAddress, keccak256, parseAbi, stringToHex } from 'viem'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'

export { GMX_V2_CHAIN_ID, GMX_WNT } from './market.js'

export const GMX_ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  StopIncrease: 8
} as const

export const GMX_INCREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_DECREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketDecrease,
  GMX_ORDER_TYPE.LimitDecrease,
  GMX_ORDER_TYPE.StopLossDecrease
])

export const GMX_ORDER_CUSTODY_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.LimitSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_ROUTER = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address
export const GMX_ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
export const GMX_ORDER_VAULT = GMX_V2_CONTRACT_MAP.GmxOrderVault.address
export const GMX_EVENT_EMITTER = getAddress('0xC8ee91A54287DB53897056e12D9819156D3822Fb')
export const GMX_EVENT_EMITTER_BLOCK = 107_737_756n
export const GMX_EVENT_LOG_ABI = parseAbi([
  'event EventLog1(address msgSender, string eventName, string indexed eventNameHash, bytes32 indexed topic1, EventLogData eventData)',
  'event EventLog2(address msgSender, string eventName, string indexed eventNameHash, bytes32 indexed topic1, bytes32 indexed topic2, EventLogData eventData)',
  'struct EventLogData { AddressItems addressItems; UintItems uintItems; IntItems intItems; BoolItems boolItems; Bytes32Items bytes32Items; BytesItems bytesItems; StringItems stringItems; }',
  'struct AddressItems { AddressKeyValue[] items; AddressArrayKeyValue[] arrayItems; }',
  'struct AddressKeyValue { string key; address value; }',
  'struct AddressArrayKeyValue { string key; address[] value; }',
  'struct UintItems { UintKeyValue[] items; UintArrayKeyValue[] arrayItems; }',
  'struct UintKeyValue { string key; uint256 value; }',
  'struct UintArrayKeyValue { string key; uint256[] value; }',
  'struct IntItems { IntKeyValue[] items; IntArrayKeyValue[] arrayItems; }',
  'struct IntKeyValue { string key; int256 value; }',
  'struct IntArrayKeyValue { string key; int256[] value; }',
  'struct BoolItems { BoolKeyValue[] items; BoolArrayKeyValue[] arrayItems; }',
  'struct BoolKeyValue { string key; bool value; }',
  'struct BoolArrayKeyValue { string key; bool[] value; }',
  'struct Bytes32Items { Bytes32KeyValue[] items; Bytes32ArrayKeyValue[] arrayItems; }',
  'struct Bytes32KeyValue { string key; bytes32 value; }',
  'struct Bytes32ArrayKeyValue { string key; bytes32[] value; }',
  'struct BytesItems { BytesKeyValue[] items; BytesArrayKeyValue[] arrayItems; }',
  'struct BytesKeyValue { string key; bytes value; }',
  'struct BytesArrayKeyValue { string key; bytes[] value; }',
  'struct StringItems { StringKeyValue[] items; StringArrayKeyValue[] arrayItems; }',
  'struct StringKeyValue { string key; string value; }',
  'struct StringArrayKeyValue { string key; string[] value; }'
])
export const GMX_REFERRAL_CODE = stringToHex('PUPPET', { size: 32 })
export const GMX_REFERRAL_STORAGE = getAddress('0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d')
export const GMX_REFERRAL_STORAGE_ABI = parseAbi([
  'function traderReferralCodes(address account) view returns (bytes32)',
  'function setTraderReferralCodeByUser(bytes32 code)',
  'function codeOwners(bytes32 code) view returns (address)',
  'function referrerTiers(address referrer) view returns (uint256)',
  'function tiers(uint256 tier) view returns (uint256 totalRebate, uint256 discountShare)',
  'function referrerDiscountShares(address referrer) view returns (uint256)'
])
export const GMX_TOKEN_SPENDER = GMX_V2_CONTRACT_MAP.GmxRouter.address
export const GMX_UI_FEE_RECEIVER = '0xff00000000000000000000000000000000000001'
export const GMX_MAX_SWAP_PATH_LENGTH = 3
export const GMX_ONE_CLICK_MESSAGE = 'Generate a GMX 1CT (One-Click Trading) session. Only sign this message on a trusted website.'
export const GMX_RELAY_DOMAIN_NAME = 'GmxBaseGelatoRelayRouter'
export const GMX_RELAY_ROUTER = getAddress('0x5503b99308dB6923758F9A22d118207D633c4e87')
export const GMX_SUBACCOUNT_RELAY_ROUTER = getAddress('0xfD0596f708d9D950E0eF7b5d191e5F8e55b8a67f')
export const GMX_SUBACCOUNT_ORDER_ACTION = keccak256(encodeAbiParameters([{ type: 'string' }], ['SUBACCOUNT_ORDER_ACTION']))
export const GMX_ONE_CLICK_EXPIRY_SEC = 7n * 86_400n
export const GMX_ONE_CLICK_MAX_COUNT = 90n
export const GMX_SUBACCOUNT_APPROVAL_TYPES = {
  SubaccountApproval: [
    { name: 'subaccount', type: 'address' },
    { name: 'shouldAdd', type: 'bool' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'maxAllowedCount', type: 'uint256' },
    { name: 'actionType', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'desChainId', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'integrationId', type: 'bytes32' }
  ]
} as const

export const GMX_DECREASE_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2
} as const

export const GMX_SWAP_TYPES: ReadonlySet<number> = new Set([GMX_ORDER_TYPE.MarketSwap, GMX_ORDER_TYPE.LimitSwap])
export const GMX_ADMITTED_ORDER_TYPES: ReadonlySet<number> = new Set([...GMX_INCREASE_TYPES, ...GMX_DECREASE_TYPES, ...GMX_SWAP_TYPES])
