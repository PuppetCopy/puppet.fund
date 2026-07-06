// This file is auto-generated from router sources in contracts/src/**/*.sol.
// Do not edit manually.

import type { TypedDataDefinition, TypedDataDomain } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'>

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const PUPPET_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  137: { name: 'PuppetGate', version: '1', chainId: 137, verifyingContract: '0x0A1Ba4F722583614260a67C063d7503394f96743' },
  143: { name: 'PuppetGate', version: '1', chainId: 143, verifyingContract: '0x0A1Ba4F722583614260a67C063d7503394f96743' },
  4326: { name: 'PuppetGate', version: '1', chainId: 4326, verifyingContract: '0x0A1Ba4F722583614260a67C063d7503394f96743' },
  8453: { name: 'PuppetGate', version: '1', chainId: 8453, verifyingContract: '0x0A1Ba4F722583614260a67C063d7503394f96743' },
  42161: { name: 'PuppetGate', version: '1', chainId: 42161, verifyingContract: '0x0A1Ba4F722583614260a67C063d7503394f96743' }
}

export const FUND_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  137: { name: 'FundGate', version: '1', chainId: 137, verifyingContract: '0x12aE5B72eB02220d95A27a8E0205465d15642Ea8' },
  143: { name: 'FundGate', version: '1', chainId: 143, verifyingContract: '0x12aE5B72eB02220d95A27a8E0205465d15642Ea8' },
  4326: { name: 'FundGate', version: '1', chainId: 4326, verifyingContract: '0x12aE5B72eB02220d95A27a8E0205465d15642Ea8' },
  8453: { name: 'FundGate', version: '1', chainId: 8453, verifyingContract: '0x12aE5B72eB02220d95A27a8E0205465d15642Ea8' },
  42161: { name: 'FundGate', version: '1', chainId: 42161, verifyingContract: '0x12aE5B72eB02220d95A27a8E0205465d15642Ea8' }
}

export const HUB_GATE_DOMAIN_MAP: Record<number, TypedDataDomain> = {
  143: { name: 'HubGate', version: '1', chainId: 143, verifyingContract: '0xDA425e09D561a376FdE781b77b2BFf786674ee7D' }
}

export const PUPPET_GATE_INTENTS = {
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
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ]
    }
  },
  swap: {
    primaryType: 'SwapIntent',
    types: {
      SwapIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'swap', type: 'SwapParams' },
      { name: 'destinationChainId', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      SwapParams: [
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'provider', type: 'address' },
      { name: 'providerCallData', type: 'bytes' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' }
      ]
    }
  }
} as const satisfies IntentActionMap

export const FUND_GATE_INTENTS = {
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
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'callListHash', type: 'bytes32' },
      { name: 'transferListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
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
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  swap: {
    primaryType: 'SwapIntent',
    types: {
      SwapIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'swap', type: 'SwapParams' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'fromRoute', type: 'bool' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
      ],
      SwapParams: [
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'provider', type: 'address' },
      { name: 'providerCallData', type: 'bytes' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' }
      ]
    }
  },
  wrap: {
    primaryType: 'WrapIntent',
    types: {
      WrapIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'amount', type: 'uint256' },
      { name: 'unwrap', type: 'bool' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
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
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'acceptableNetAssetValue', type: 'uint256' },
      { name: 'totalShareSupply', type: 'uint256' },
      { name: 'masterAmount', type: 'uint256' },
      { name: 'puppetListHash', type: 'bytes32' },
      { name: 'allocatedAmountListHash', type: 'bytes32' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
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
      { name: 'fundParams', type: 'FundAccountInitParams' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  liquidate: {
    primaryType: 'LiquidateIntent',
    types: {
      LiquidateIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'acceptableNetAssetValue', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  mandate: {
    primaryType: 'MandateIntent',
    types: {
      MandateIntent: [
      { name: 'params', type: 'AccountInitParams' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'acceptableRelayFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'baseToken', type: 'address' },
      { name: 'rules', type: 'FundMandateRule[]' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundMandateRule: [
      { name: 'fund', type: 'address' },
      { name: 'body', type: 'bytes' },
      { name: 'mandate', type: 'bytes' }
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
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'sharesOut', type: 'uint256' },
      { name: 'assetsOut', type: 'uint256' },
      { name: 'acceptableNetAssetValue', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
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
      { name: 'fundParams', type: 'FundAccountInitParams' },
      { name: 'sharesOut', type: 'uint256' }
      ],
      AccountInitParams: [
      { name: 'user', type: 'address' },
      { name: 'signer', type: 'address' }
      ],
      FundAccountInitParams: [
      { name: 'master', type: 'address' },
      { name: 'baseToken', type: 'address' },
      { name: 'name', type: 'bytes32' }
      ]
    }
  },
  withdraw: {
    primaryType: 'WithdrawIntent',
    types: {
      WithdrawIntent: [
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
      { name: 'signer', type: 'address' }
      ]
    }
  }
} as const satisfies IntentActionMap
