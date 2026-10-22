import { type Address, encodeAbiParameters, encodePacked, getAddress, getContractAddress, type Hex, keccak256, parseAbi, parseAbiItem } from 'viem'
import type { ChainId } from '../../const/index.js'
import { CHAIN_TOKEN_MAP } from '../../const/network.js'
import { HYPERCORE_SPOT_DEX } from '../cctp.js'

export const PAPERTRADE_CHAIN_ID = 999
export const PAPERTRADE_DEPOSIT_CHAIN_ID = 42161 satisfies ChainId
export const PAPERTRADE_DEPOSIT_TOKEN = CHAIN_TOKEN_MAP[PAPERTRADE_DEPOSIT_CHAIN_ID].USDC as Address
export const PAPERTRADE_DEPOSIT_DEXES: ReadonlySet<number> = new Set([HYPERCORE_SPOT_DEX])
export const PAPERTRADE_DEPOSIT_MIN = 10_000_000n
export const PAPERTRADE_ACTIVATION_FEE = 1_000_000n
export const PAPERTRADE_WITHDRAW_MIN = 10_000_000n

export const PAPERTRADE_EXCHANGE = getAddress('0x6cd5661646289fb6e65ea5c032310fded797d0a2')
export const PAPERTRADE_EXECUTOR = getAddress('0x233ff29b239abc1d7748605da9b205c3e008626e')
export const PAPERTRADE_SESSION_KEY_MANAGER = getAddress('0x8326eb8896e358717f10502ec73ce8d28e37b108')
export const PAPERTRADE_ORACLE = getAddress('0xa9b4c7b7ca5835652d81e25739c870d49f39cc2e')
export const PAPERTRADE_DEPOSIT_PROXY_FACTORY = getAddress('0x1629b7d46bef6e13ff754174fc9f32dea309b38f')

export const PAPERTRADE_PINNED_IMPLEMENTATIONS: ReadonlyMap<Address, Address> = new Map([
  [PAPERTRADE_EXCHANGE, getAddress('0x0f3febfc94876b0c895f7acecdc8f5c863b549ee')],
  [PAPERTRADE_EXECUTOR, getAddress('0xe0bc9cc7b067060aafccbaa3e250700c9cdd7262')],
  [PAPERTRADE_SESSION_KEY_MANAGER, getAddress('0x8a5069fe303e8f81e91825436e956d595032e558')],
  [PAPERTRADE_ORACLE, getAddress('0x3997ffc8cbd281d4fc8d0548e505ae2fbbbd985a')],
  [PAPERTRADE_DEPOSIT_PROXY_FACTORY, getAddress('0x8f22a73a23a2de0dbfdf6729f4d8c07dbdc69cf0')]
])
export const PAPERTRADE_FEE_CAP = 2n * 10n ** 16n
export const PAPERTRADE_PINNED_INSTRUMENTS: ReadonlyMap<bigint, { assetIndex: bigint; rateMultiplier: bigint; positionMultiplier: bigint; bustBuffer: bigint; baseRate: bigint; referenceNotional: bigint }> = new Map([
  [0n, { assetIndex: 0n, rateMultiplier: 15_000n * 10n ** 18n, positionMultiplier: 814_598n * 10n ** 15n, bustBuffer: 476_041_580_087_574n, baseRate: 10n ** 17n, referenceNotional: 10n ** 23n }],
  [1n, { assetIndex: 1n, rateMultiplier: 15_000n * 10n ** 18n, positionMultiplier: 483_979n * 10n ** 15n, bustBuffer: 481_304_050_180_130n, baseRate: 10n ** 17n, referenceNotional: 10n ** 23n }]
])
export const HYPERCORE_SPOT_BALANCE = getAddress('0x0000000000000000000000000000000000000801')
export const HYPERCORE_USDC_INDEX = 0n
export const HYPERCORE_USDC_DECIMALS = 8
export const PAPERTRADE_EVM_USDC = getAddress('0xb88339cb7199b77e23db6e890353e22632ba630f')
export const PAPERTRADE_SWEEP_REQUESTED_EVENT = parseAbiItem('event SweepRequested(address indexed user, address indexed proxy, uint64 coreAmount, uint64 evmAmount, uint32 requestBlock)')
export const PAPERTRADE_SWEPT_EVENT = parseAbiItem('event Swept(address indexed user, uint256 amount)')
export const PAPERTRADE_CORE_WITHDRAWAL_EVENT = parseAbiItem('event CoreWithdrawal(address indexed user, uint256 amount, uint256 coreAmount)')
export const PAPERTRADE_POSITION_OPENED_EVENT = parseAbiItem(
  'event PositionOpened(uint256 indexed positionId, address indexed user, uint32 instrumentId, bool isLong, bool useDebt, uint64 entryPrice, uint128 margin, uint32 leverage)'
)
export const PAPERTRADE_POSITION_CLOSED_EVENT = parseAbiItem(
  'event PositionClosed(uint256 indexed positionId, address indexed user, uint64 exitPrice, int256 rawPnl, int256 haircutPnl, bool liquidated, uint256 fee)'
)
export const PAPERTRADE_SESSION_KEY_REGISTERED_EVENT = parseAbiItem('event SessionKeyRegistered(address indexed user, address indexed key, uint64 expiry)')
export const PAPERTRADE_SESSION_KEY_MANAGER_ABI = parseAbi(['function sessionKeys(address user, address key) view returns (uint64 expiry, address feeAddress)'])
export const PAPERTRADE_SESSION_KEY_MANAGER_CALLER_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000003'
export const PAPERTRADE_SESSION_TTL_SEC = 30n * 24n * 60n * 60n

export const PAPERTRADE_EXCHANGE_ABI = parseAbi([
  'function oracle() view returns (address)',
  'function authorizedExecutor() view returns (address)',
  'function proxyFactory() view returns (address)',
  'function sessionKeyManager() view returns (address)',
  'function winFeeRate() view returns (uint256)',
  'function lossFeeRate() view returns (uint256)',
  'function liquidationFeeRate() view returns (uint256)',
  'function instruments(uint32) view returns (uint256 rateMultiplier, uint256 positionMultiplier, uint256 assetIndex, uint256 maxLeverage, uint256 maxPositionNotional, uint256 bustBuffer, uint256 baseRate, uint256 referenceNotional)',
  'function marketPause(uint32) view returns (uint256, uint256, uint256, uint256)',
  'function balances(address) view returns (uint256)',
  'function getUserOpenPositionIds(address) view returns (uint256[])',
  'function positions(uint256) view returns (address owner, uint256 instrumentId, uint256 entryPrice, uint256 margin, uint256 leverage, uint256 openedAt, bool isLong, bool useDebt, bool isOpen)'
])
export const PAPERTRADE_FACTORY_ABI = parseAbi(['function computeProxyAddress(address) view returns (address)'])
export const PAPERTRADE_ORACLE_ABI = parseAbi(['function getExecutionPrice(uint32) view returns (uint256)'])

export const PAPERTRADE_DOMAIN = { name: 'String', version: '1', chainId: PAPERTRADE_CHAIN_ID, verifyingContract: PAPERTRADE_EXCHANGE } as const

export const CANCEL_DOMAIN = { name: 'PaperTrade Intent Cancel', version: '2', chainId: PAPERTRADE_CHAIN_ID, verifyingContract: PAPERTRADE_EXCHANGE } as const

export const PAPERTRADE_UNSIGNED_DOMAINS: ReadonlyMap<string, string> = new Map([
  ['PaperStaking', 'the fund does not stake, unstake or claim PAPER: PAPER cannot be sold or redeemed, so it is held at no value and never moved'],
  ['PaperTrade Session Key Encryption', 'this signature wraps a browser session key; the fund holds no Papertrade session key and co-signs each open and close instead']
])

export const CANCEL_INTENT_TYPES = [
  { name: 'user', type: 'address' },
  { name: 'intentId', type: 'bytes32' },
  { name: 'deadline', type: 'uint256' }
] as const
export const OPEN_POSITION_TYPES = [
  { name: 'user', type: 'address' },
  { name: 'instrumentId', type: 'uint32' },
  { name: 'isLong', type: 'bool' },
  { name: 'size', type: 'uint128' },
  { name: 'leverage', type: 'uint32' },
  { name: 'useDebt', type: 'bool' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' }
] as const
export const CLOSE_TYPES = [
  { name: 'user', type: 'address' },
  { name: 'positionIds', type: 'uint256[]' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' }
] as const
export const REGISTER_SESSION_KEY_TYPES = [
  { name: 'user', type: 'address' },
  { name: 'key', type: 'address' },
  { name: 'expiry', type: 'uint64' },
  { name: 'feeAddress', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' }
] as const
export const WITHDRAW_TO_CORE_TYPES = [
  { name: 'user', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' }
] as const

export const PAPERTRADE_INSTRUMENTS: ReadonlyMap<bigint, { symbol: string; priceScale: bigint }> = new Map([
  [0n, { symbol: 'BTC', priceScale: 10n }],
  [1n, { symbol: 'ETH', priceScale: 100n }]
])
export const PAPERTRADE_MAX_LEVERAGE = 1000n
export const PAPERTRADE_MIN_MARGIN = 10n * 10n ** 18n
export const PAPERTRADE_MAX_DEADLINE_SEC = 120n

const PROXY_CREATION_CODE: Hex = '0x60c03461008657601f61072138819003918201601f19168301916001600160401b0383118484101761008a57808492604094855283398101031261008657610052602061004b8361009e565b920161009e565b9060805260a05260405161066e90816100b382396080518181816061015260de015260a05181818161037b01526103da0152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036100865756fe6080604081815260049182361015610015575f80fd5b5f925f3560e01c9182630c506e96146103aa575081634f8632ba14610367578163925b3aad14610094575063d2f7265a1461004e575f80fd5b34610090578160031936011261009057517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b5080fd5b839150346102eb5760603660031901126102eb576001600160401b038135818116949192908590036102eb5760248035908482168092036102eb576044358581168091036102eb577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690338290036103355760648102811590828104606414821715610323578501809511610311578785116103015715610222575b5096869783610146578780f35b610197966101a69487519360208501938452888501521660608301526060825261016f826105ad565b8551600160f81b6020820152600360e91b6021820152915191968792918290858501906105eb565b810103838101865201846105c8565b73333333333333333333333333333333333333333392833b1561021e576101e39385928385518097819582946317938e1360e01b8452830161060c565b03925af190811561021557506101fe575b8080808080808780f35b61020790610586565b6102125780826101f4565b80fd5b513d84823e3d90fd5b8480fd5b8551602081019182525f878201528681526060810191818310898411176102ef57610280918591848a52600160f81b6080830152600760e81b60818301526102718251809260848501906105eb565b810103878101845201826105c8565b733333333333333333333333333333333333333333803b156102eb5786516317938e1360e01b8152915f9183918290849082906102bf908c830161060c565b03925af180156102e15715610139576102d9919750610586565b5f9588610139565b86513d5f823e3d90fd5b5f80fd5b84604188634e487b7160e01b5f52525ffd5b865163fadaa87160e01b81528690fd5b83601187634e487b7160e01b5f52525ffd5b84601188634e487b7160e01b5f52525ffd5b855162461bcd60e51b8152602081870152600d818501526c6f6e6c792065786368616e676560981b6044820152606490fd5b82346102eb575f3660031901126102eb57517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b83346102eb57806003193601126102eb576001600160a01b038335818116949092908584036102eb5760248035937f0000000000000000000000000000000000000000000000000000000000000000169586330361055b5750831561052c575f80845196602097828982019163a9059cbb60e01b83528b8782015289604482015260448152610438816105ad565b51925af13d15610525573d6001600160401b03811161051357845190610467601f8201601f19168901836105c8565b81523d5f8883013e5b816104da575b50156104a8575050519081527f3d95e1dd133840fdfe95e9a3b6c9fc44f85019531359313e278c6e358ef5b1e09190a3005b600f9085606494519362461bcd60e51b85528401528201526e1d1c985b9cd9995c8819985a5b1959608a1b6044820152fd5b809150518681159182156104f3575b5050905088610476565b83809293500103126102eb5785015180151581036102eb5780868a6104e9565b82604185634e487b7160e01b5f52525ffd5b6060610470565b600b906020606494519362461bcd60e51b85528401528201526a1e995c9bc8185b5bdd5b9d60aa1b6044820152fd5b600960649260208562461bcd60e51b85528401528201526837b7363c903ab9b2b960b91b6044820152fd5b6001600160401b03811161059957604052565b634e487b7160e01b5f52604160045260245ffd5b608081019081106001600160401b0382111761059957604052565b601f909101601f19168101906001600160401b0382119082101761059957604052565b5f5b8381106105fc5750505f910152565b81810151838201526020016105ed565b6040916020825261062c81518092816020860152602086860191016105eb565b601f01601f191601019056fea2646970667358221220bebcee6112b90ff7ae57e528ab0fbf52857e276c1ee729fc6447ffc1f66ffd1c64736f6c63430008180033'

export const papertradeProxyOf = (account: Address): Address =>
  getContractAddress({
    opcode: 'CREATE2',
    from: PAPERTRADE_DEPOSIT_PROXY_FACTORY,
    salt: keccak256(encodePacked(['address'], [account])),
    bytecodeHash: keccak256(`${PROXY_CREATION_CODE}${encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [PAPERTRADE_EXCHANGE, account]).slice(2)}`)
  })
