import type { TypedDataDefinition } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'> & { gate: 'LiquidityGate' | 'SpokeGate' | 'HubGate' }

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const ACCOUNT_DOMAIN = { name: 'Puppet', version: '1' } as const

export const CHAINLESS_DOMAIN = { name: 'Puppet', version: '1' } as const

export const TYPEHASH = {
  AllocateIntent: '0x0b014f03a0102cdd8647e38f2bd2e7efc57ca9a35d32ea5a8562913d3d640c35',
  Credit: '0x544d9fe81c2fab9f5ed6d73d3fdcb8c26a57a71f51408f6494894f2de7ce3798',
  DepositAcrossIntent: '0x0fa755bdd8baa2035f8329e650b6b75fb4ca130ddcbe965b0b4c59169fbaa3d6',
  EscrowIntent: '0x06a26750b89737189586dfad344c5e17701b15e3557334f84be10e15e642ed7f',
  Fulfil: '0xad7769fdb7f176f8aad2ee098d642efab4f98cce82d2cd8586c81c4edd9d22ae',
  FundSwapIntent: '0xfffe49af4dd2ec72b433afe11453d5ea5c03fb853b98f32e4b38171fb04fd21c',
  Genesis: '0xca690b65e92cddc39907dafcf47b3fda9b5942417bd51ce35602f668d92745b0',
  IntentHeader: '0x220563108260c7f71e6ed61961c6ad1b1d9a80622aee50ff313ef5994a277e57',
  Mandate: '0x4101a7bc750d14e04b3d10509207e63dcedf87d53a2c6dbc6b2db896d9acf43b',
  MandateIntent: '0xff7d60b7156b84685d64aef02dd8c076839e883fff2a3c64d787f2dc42abb6b1',
  OperateIntent: '0x8221ac6b04c28fc9c2f364ffb60b844f52328cd8c7b8b203c7e5e6715bd3c91b',
  Price: '0x9078e00e22f2b956a3c15d2ef196d6253a9007b49b80419d821b19e0a1a512e4',
  RedeemIntent: '0xce98159168008db6c916342de595b7d733f272e9906f7f3803062f25ad118452',
  SellIntent: '0x8e857f21751a73772103345d7ba291768d68e2ff5e35f8c6ff7638d99d0fb6b1',
  Session: '0x69ae1defa7b25a81d5b3fb83b2c49b76a6e105d9451e98030320ea77fb5305cb',
  SwapParams: '0x52c571063c1aaa69398a375e8e2b86139061822ac70ea183a8dd35609e0d4488',
  Valuation: '0x69a8da74692592a3b8069b05d46e773d928cc8f266ebd10bbca75c68c613aecb',
  WithdrawIntent: '0x5ca1ae96c67e734829aca6dffefe565e26d96b0c25586a5319518e313231db18'
} as const

export const GENESIS_TYPES = {
  Genesis: [
    { name: 'account', type: 'address' },
    { name: 'parent', type: 'address' }
  ]
} as const

export const SESSION_TYPES = {
  Session: [
    { name: 'statement', type: 'string' },
    { name: 'user', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'epoch', type: 'uint256' }
  ]
} as const

export const MAX_SESSION_TTL = 2592000n

export const SESSION_STATEMENT = 'Authorize this signer to act for my https://puppet.fund account.\n\nVerify the website address.'

export const MANDATE_TYPES = {
  Mandate: [
    { name: 'master', type: 'address' },
    { name: 'skin', type: 'uint256' },
    { name: 'allocationRate', type: 'uint256' },
    { name: 'cooldownPeriod', type: 'uint256' },
    { name: 'expiry', type: 'uint256' }
  ]
} as const

export const VALUATION_TYPES = {
  Valuation: [
    { name: 'value', type: 'uint256' },
    { name: 'assetListHash', type: 'bytes32' },
    { name: 'positionListHash', type: 'bytes32' }
  ]
} as const

export const INTENTS = {
  escrow: {
    gate: 'LiquidityGate',
    primaryType: 'EscrowIntent',
    types: {
      EscrowIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'master', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ]
    }
  },
  depositAcross: {
    gate: 'LiquidityGate',
    primaryType: 'DepositAcrossIntent',
    types: {
      DepositAcrossIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'destinationChainId', type: 'uint256' },
        { name: 'swap', type: 'SwapParams' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      SwapParams: [
        { name: 'inputToken', type: 'address' },
        { name: 'inputAmount', type: 'uint256' },
        { name: 'outputToken', type: 'address' },
        { name: 'outputAmount', type: 'uint256' },
        { name: 'provider', type: 'address' },
        { name: 'providerCallData', type: 'bytes' }
      ]
    }
  },
  fundSwap: {
    gate: 'LiquidityGate',
    primaryType: 'FundSwapIntent',
    types: {
      FundSwapIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'destinationChainId', type: 'uint256' },
        { name: 'swap', type: 'SwapParams' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      SwapParams: [
        { name: 'inputToken', type: 'address' },
        { name: 'inputAmount', type: 'uint256' },
        { name: 'outputToken', type: 'address' },
        { name: 'outputAmount', type: 'uint256' },
        { name: 'provider', type: 'address' },
        { name: 'providerCallData', type: 'bytes' }
      ]
    }
  },
  withdraw: {
    gate: 'LiquidityGate',
    primaryType: 'WithdrawIntent',
    types: {
      WithdrawIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'destinationChainId', type: 'uint256' },
        { name: 'swap', type: 'SwapParams' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      SwapParams: [
        { name: 'inputToken', type: 'address' },
        { name: 'inputAmount', type: 'uint256' },
        { name: 'outputToken', type: 'address' },
        { name: 'outputAmount', type: 'uint256' },
        { name: 'provider', type: 'address' },
        { name: 'providerCallData', type: 'bytes' }
      ]
    }
  },
  operate: {
    gate: 'SpokeGate',
    primaryType: 'OperateIntent',
    types: {
      OperateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'callListHash', type: 'bytes32' },
        { name: 'tokenList', type: 'address[]' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ]
    }
  },
  mandate: {
    gate: 'HubGate',
    primaryType: 'MandateIntent',
    types: {
      MandateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'mandateListHash', type: 'bytes32' },
        { name: 'tokenList', type: 'address[]' },
        { name: 'arm', type: 'bool' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ]
    }
  },
  createFund: {
    gate: 'HubGate',
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'share', type: 'address' },
        { name: 'valuationHash', type: 'bytes32' },
        { name: 'price', type: 'Price' },
        { name: 'credit', type: 'Credit' },
        { name: 'allocationListHash', type: 'bytes32' }
      ],
      Credit: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Price: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ]
    }
  },
  allocate: {
    gate: 'HubGate',
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'share', type: 'address' },
        { name: 'valuationHash', type: 'bytes32' },
        { name: 'price', type: 'Price' },
        { name: 'credit', type: 'Credit' },
        { name: 'allocationListHash', type: 'bytes32' }
      ],
      Credit: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Price: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ]
    }
  },
  sell: {
    gate: 'HubGate',
    primaryType: 'SellIntent',
    types: {
      SellIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'master', type: 'address' },
        { name: 'share', type: 'address' },
        { name: 'units', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ]
    }
  },
  redeem: {
    gate: 'HubGate',
    primaryType: 'RedeemIntent',
    types: {
      RedeemIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'share', type: 'address' },
        { name: 'valuationHash', type: 'bytes32' },
        { name: 'price', type: 'Price' },
        { name: 'retire', type: 'uint256' },
        { name: 'drain', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Price: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ]
    }
  }
} as const satisfies IntentActionMap

export const SCHEDULED = {
  fulfil: {
    gate: 'SpokeGate',
    primaryType: 'Fulfil',
    types: {
      Fulfil: [
        { name: 'store', type: 'address' },
        { name: 'parent', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'round', type: 'bytes32' },
        { name: 'fromTotal', type: 'uint256' },
        { name: 'fulfilledTotal', type: 'uint256' },
        { name: 'fee', type: 'uint256' }
      ]
    }
  }
} as const satisfies IntentActionMap
