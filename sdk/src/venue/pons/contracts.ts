import { type Address, getAddress } from 'viem'
import type { ChainId } from '../../const/index.js'

export interface IPonsDeployment {
  factory: Address
  memeHook: Address
}

export const PONS_DEPLOYMENTS = {
  4663: {
    factory: getAddress('0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e'),
    memeHook: getAddress('0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044')
  }
} as const satisfies Partial<Record<ChainId, IPonsDeployment>>

export const PONS_GRADUATED_PHASE = 2

export const PONS_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getLaunchedToken',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'token', type: 'address' },
          { name: 'curve', type: 'address' },
          { name: 'deployer', type: 'address' },
          { name: 'creatorFeeRecipient', type: 'address' },
          { name: 'pairToken', type: 'address' },
          { name: 'graduationThreshold', type: 'uint256' },
          { name: 'poolFee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'creatorTaxBps', type: 'uint16' },
          { name: 'buybackEnabled', type: 'bool' },
          { name: 'phase', type: 'uint8' },
          { name: 'sweptQuote', type: 'uint256' },
          { name: 'sweptTokens', type: 'uint256' },
          { name: 'sweptAt', type: 'uint256' },
          { name: 'exists', type: 'bool' }
        ]
      }
    ]
  }
] as const

export const PONS_MEME_HOOK_ABI = [
  {
    type: 'function',
    name: 'launches',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'registered', type: 'bool' },
      { name: 'memecoinIsCurrency0', type: 'bool' },
      { name: 'memecoin', type: 'address' },
      { name: 'quoteToken', type: 'address' },
      { name: 'creator', type: 'address' },
      { name: 'buybackCreatorRecipient', type: 'address' },
      { name: 'protocolFeeRecipient', type: 'address' },
      { name: 'creatorTaxBps', type: 'uint16' },
      { name: 'protocolFeeShareBps', type: 'uint16' },
      { name: 'buybackBurnBps', type: 'uint16' },
      { name: 'hookFeeBps', type: 'uint16' },
      { name: 'maxInternalPriceImpactBps', type: 'uint16' },
      { name: 'buybackEnabled', type: 'bool' }
    ]
  }
] as const
