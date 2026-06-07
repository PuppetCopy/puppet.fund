// This file is auto-generated from router sources in contracts/src/**/*.sol.
// Do not edit manually.

import type { TypedDataDefinition, TypedDataDomain } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'>

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const CORE_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  8453: { name: 'CoreGate', version: '1', chainId: 8453, verifyingContract: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3' },
  42161: { name: 'CoreGate', version: '1', chainId: 42161, verifyingContract: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3' }
}

export const HUB_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  42161: { name: 'HubGate', version: '1', chainId: 42161, verifyingContract: '0x45D8b0FD376234dcE2457E6D258c377B734019DF' }
}

export const CORE_GATE_INTENTS = {
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
      { name: 'isMaster', type: 'bool' },
      { name: 'fromTransientRoute', type: 'bool' },
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
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  createMasterAccount: {
    primaryType: 'CreateMasterAccountIntent',
    types: {
      CreateMasterAccountIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'initialDepositAmount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
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
      { name: 'initialDepositAmount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
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
      { name: 'baseToken', type: 'address' },
      { name: 'callListHash', type: 'bytes32' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
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
      { name: 'isMaster', type: 'bool' },
      { name: 'fromTransientRoute', type: 'bool' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  walletWithdraw: {
    primaryType: 'WithdrawIntent',
    types: {
      WithdrawIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  walletWithdrawWnt: {
    primaryType: 'WithdrawIntent',
    types: {
      WithdrawIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
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
      { name: 'baseToken', type: 'address' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'masterAmount', type: 'uint256' },
      { name: 'puppetListHash', type: 'bytes32' },
      { name: 'matchedAmountListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  bridgeToWallet: {
    primaryType: 'BridgeToWalletIntent',
    types: {
      BridgeToWalletIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
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
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
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
      { name: 'masterParams', type: 'AccountInitParams' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  fulfill: {
    primaryType: 'FulfillIntent',
    types: {
      FulfillIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'acceptableShares', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  seedMasterAccount: {
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'baseToken', type: 'address' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'masterAmount', type: 'uint256' },
      { name: 'puppetListHash', type: 'bytes32' },
      { name: 'matchedAmountListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
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
      { name: 'masterParams', type: 'AccountInitParams' },
      { name: 'sharesOut', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
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
      { name: 'baseToken', type: 'address' },
      { name: 'rules', type: 'SubscribeRule[]' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ],
      SubscribeRule: [
      { name: 'masterParams', type: 'AccountInitParams' },
      { name: 'body', type: 'bytes' },
      { name: 'mandate', type: 'bytes' }
      ]
    }
  }
} as const satisfies IntentActionMap
