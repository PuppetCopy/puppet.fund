// This file is auto-generated from router sources in contracts/src/**/*.sol.
// Do not edit manually.

import type { TypedDataDefinition, TypedDataDomain } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'>

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const ACCOUNT_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  8453: { name: 'AccountGate', version: '1', chainId: 8453, verifyingContract: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C' },
  42161: { name: 'AccountGate', version: '1', chainId: 42161, verifyingContract: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C' }
}

export const MASTER_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  8453: { name: 'MasterGate', version: '1', chainId: 8453, verifyingContract: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43' },
  42161: { name: 'MasterGate', version: '1', chainId: 42161, verifyingContract: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43' }
}

export const HUB_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  42161: { name: 'HubGate', version: '1', chainId: 42161, verifyingContract: '0x7242D4538332ECF36b0Aa69a4f91F1370fbBC0B6' }
}

export const ACCOUNT_GATE_INTENTS = {
  bridge: {
    primaryType: 'BridgeIntent',
    types: {
      BridgeIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'provider', type: 'address' },
      { name: 'providerCallData', type: 'bytes' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'expires', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  createPuppetAccount: {
    primaryType: 'CreatePuppetAccountIntent',
    types: {
      CreatePuppetAccountIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'initialDepositAmount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  recognize: {
    primaryType: 'RecognizeIntent',
    types: {
      RecognizeIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  }
} as const satisfies IntentActionMap

export const MASTER_GATE_INTENTS = {
  createFundAccount: {
    primaryType: 'CreateFundAccountIntent',
    types: {
      CreateFundAccountIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'sweepAmount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  operate: {
    primaryType: 'OperateIntent',
    types: {
      OperateIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'callListHash', type: 'bytes32' },
      { name: 'transferListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  }
} as const satisfies IntentActionMap

export const HUB_GATE_INTENTS = {
  allocate: {
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'share', type: 'ShareInitParams' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'masterAmount', type: 'uint256' },
      { name: 'puppetListHash', type: 'bytes32' },
      { name: 'matchedAmountListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      ShareInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  claim: {
    primaryType: 'ClaimIntent',
    types: {
      ClaimIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'share', type: 'ShareInitParams' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      ShareInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  redeem: {
    primaryType: 'RedeemIntent',
    types: {
      RedeemIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'share', type: 'ShareInitParams' },
      { name: 'sharesOut', type: 'uint256' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'acceptableShares', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      ShareInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  sell: {
    primaryType: 'SellIntent',
    types: {
      SellIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'share', type: 'ShareInitParams' },
      { name: 'sharesOut', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      ShareInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  subscribe: {
    primaryType: 'SubscribeIntent',
    types: {
      SubscribeIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'rules', type: 'SubscribeRule[]' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      SubscribeRule: [
      { name: 'fund', type: 'address' },
      { name: 'body', type: 'bytes' },
      { name: 'mandate', type: 'bytes' }
      ]
    }
  },
  withdrawToBridge: {
    primaryType: 'WithdrawToBridgeIntent',
    types: {
      WithdrawToBridgeIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'provider', type: 'address' },
      { name: 'providerCallData', type: 'bytes' },
      { name: 'expires', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  withdrawToWallet: {
    primaryType: 'WithdrawToWalletIntent',
    types: {
      WithdrawToWalletIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  }
} as const satisfies IntentActionMap
