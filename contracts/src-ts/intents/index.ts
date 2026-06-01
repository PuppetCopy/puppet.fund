// This file is auto-generated from router sources in contracts/src/**/*.sol.
// Do not edit manually.

import type { TypedDataDefinition, TypedDataDomain } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'>

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const CORE_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  8453: { name: 'CoreGate', version: '1', chainId: 8453, verifyingContract: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF' },
  42161: { name: 'CoreGate', version: '1', chainId: 42161, verifyingContract: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF' }
}

export const HUB_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  42161: { name: 'HubGate', version: '1', chainId: 42161, verifyingContract: '0xF5c8Ea0d163d05671F05176af3a5380Cc78c7581' }
}

export const SPOKE_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  8453: { name: 'SpokeGate', version: '1', chainId: 8453, verifyingContract: '0xd838467d992E29C76038dA7c678E57Bd31184949' },
  42161: { name: 'SpokeGate', version: '1', chainId: 42161, verifyingContract: '0xd838467d992E29C76038dA7c678E57Bd31184949' }
}

export const CORE_GATE_INTENTS = {
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
  signTransientRouteBalance: {
    primaryType: 'SignTransientRouteBalanceIntent',
    types: {
      SignTransientRouteBalanceIntent: [
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
      { name: 'bridgeFee', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' }
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
  createMaster: {
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

export const SPOKE_GATE_INTENTS = {
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
      { name: 'fromTransientRoute', type: 'bool' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'bridgeFee', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'name', type: 'bytes32' },
      { name: 'baseTokenId', type: 'bytes32' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  bridgeHub: {
    primaryType: 'BridgeHubIntent',
    types: {
      BridgeHubIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'fromTransientRoute', type: 'bool' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'bridgeFee', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' }
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
  signRecordedBalance: {
    primaryType: 'MasterSignRecordedBalanceIntent',
    types: {
      MasterSignRecordedBalanceIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
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
  }
} as const satisfies IntentActionMap
