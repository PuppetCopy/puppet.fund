import type { TypedDataDefinition } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'> & { gate: 'LiquidityGate' | 'SpokeGate' | 'HubGate' }

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const ACCOUNT_DOMAIN = { name: 'Puppet', version: '1' } as const

export const CHAINLESS_DOMAIN = { name: 'Puppet', version: '1' } as const

export const TYPEHASH = {
  AllocateIntent: '0x24ba3c7c1e3b4cb03c2299bf2ef8094c729e7efedcbf700bdd0d5cb758cdbf0a',
  Asset: '0x0456966e89c1db52320a9e85298e215886da64de929b21bcc711add382dc6e4e',
  Call: '0xfcb48734d824feb977a3628bc46453ca17117be1d2e7bb603fcb246a00104dad',
  Credit: '0x6b174adec53a5605ccd84b260a766fadd688606239667269ca9e9afe8335fac8',
  CreditTotal: '0x794e499a2d6bec6229b753efc52346a9d26a7e8a32e91221b6d7f36953532c33',
  DepositAcrossIntent: '0x0fa755bdd8baa2035f8329e650b6b75fb4ca130ddcbe965b0b4c59169fbaa3d6',
  FundSwapIntent: '0xfffe49af4dd2ec72b433afe11453d5ea5c03fb853b98f32e4b38171fb04fd21c',
  Genesis: '0xca690b65e92cddc39907dafcf47b3fda9b5942417bd51ce35602f668d92745b0',
  IntentHeader: '0x220563108260c7f71e6ed61961c6ad1b1d9a80622aee50ff313ef5994a277e57',
  MandateIntent: '0x9a912730d75d637797b0fbde0e4235a8c38b8ce7f3fcd27fae50cd8b66c84364',
  OperateIntent: '0x3af61d96decc77a84d3e00f13e012de93cc92b4bf624e382aedf9819c4278a70',
  Position: '0xacb1ac5de8e1c782b55ba181a75eb129b86c2ca88077e6375a311e3e4c1f4844',
  Price: '0xb61960c5b7768908a3854c66bd6c0bd4c43ad60b06b7bc4982da3f2fd77076d8',
  RedeemIntent: '0x3f10237bf6d5f14d8069d80eb6d2f9e2e162ba3864b98c9e1b78fabfcf39441e',
  RetireEscrowIntent: '0x3236e5bf5512b8120132df02da61fa780872b9b2a61f3b339156ae596fe8e5ed',
  SellIntent: '0x3bb6845d03c3f93bd63742552e91a468cf4bdba25110370147f029906a653e46',
  Session: '0x64ebdb43b155fa9c2a269ff25219f5d78f96f966858c636c15349ee1b5ed6ccf',
  SwapParams: '0x52c571063c1aaa69398a375e8e2b86139061822ac70ea183a8dd35609e0d4488',
  Valuation: '0x135ac17a528392cc9480250a07a052c3e52dc09c049455ee432ddee746b1cceb',
  WithdrawIntent: '0x5ca1ae96c67e734829aca6dffefe565e26d96b0c25586a5319518e313231db18'
} as const

export const GENESIS_TYPES = {
  Genesis: [
    { name: 'account', type: 'address' },
    { name: 'parent', type: 'address' }
  ]
} as const

export const CREDIT_TOTAL_TYPES = {
  CreditTotal: [
    { name: 'master', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'total', type: 'uint256' },
    { name: 'feeTotal', type: 'uint256' }
  ]
} as const

export const SESSION_TYPES = {
  Session: [
    { name: 'statement', type: 'string' },
    { name: 'user', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'fund', type: 'address' }
  ]
} as const

export const MAX_SESSION_TTL = 2592000n

export const SESSION_REVOKE_DELAY = 600n

export const SESSION_STATEMENT = 'Authorize this signer to act for my https://puppet.fund account. If a fund is named below, it belongs to my account.\n\nVerify the website address.'

export const MAX_SESSION_BYTES = 4096n

export const WALLET_SIGNATURE_TAG = '0xb4484f983b8d978812f1a94144aafc19d98e8fbab9eafd61acbf793f641b40ed'

export const SESSION_ENVELOPE = [
  { name: 'signer', type: 'address' },
  { name: 'issuedAt', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'epoch', type: 'uint256' },
  { name: 'fund', type: 'address' },
  { name: 'grant', type: 'bytes' },
  { name: 'inner', type: 'bytes' }
] as const

export const FUND_APPROVAL = [
  { name: 'signer', type: 'address' },
  { name: 'issuedAt', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'epoch', type: 'uint256' },
  { name: 'grant', type: 'bytes' }
] as const

export const INTENTS = {
  retireEscrow: {
    gate: 'LiquidityGate',
    primaryType: 'RetireEscrowIntent',
    types: {
      RetireEscrowIntent: [
        { name: 'header', type: 'IntentHeader' },
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
        { name: 'callList', type: 'Call[]' },
        { name: 'tokenList', type: 'address[]' }
      ],
      Call: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gasLimit', type: 'uint256' },
        { name: 'callData', type: 'bytes' }
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
        { name: 'epoch', type: 'uint256' },
        { name: 'mandateListHash', type: 'bytes32' }
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
  sell: {
    gate: 'HubGate',
    primaryType: 'SellIntent',
    types: {
      SellIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'shareToken', type: 'address' },
        { name: 'shares', type: 'uint256' }
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
        { name: 'shareToken', type: 'address' },
        { name: 'valuation', type: 'Valuation' },
        { name: 'token', type: 'address' },
        { name: 'fraction', type: 'uint256' },
        { name: 'join', type: 'uint256' }
      ],
      Asset: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'id', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Position: [
        { name: 'chainId', type: 'uint256' },
        { name: 'venue', type: 'bytes32' },
        { name: 'id', type: 'bytes32' },
        { name: 'value', type: 'uint256' }
      ],
      Valuation: [
        { name: 'assetList', type: 'Asset[]' },
        { name: 'positionList', type: 'Position[]' }
      ]
    }
  },
  createFund: {
    gate: 'HubGate',
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'shareToken', type: 'address' },
        { name: 'valuation', type: 'Valuation' },
        { name: 'token', type: 'address' },
        { name: 'price', type: 'Price' },
        { name: 'credit', type: 'Credit' },
        { name: 'allocationListHash', type: 'bytes32' }
      ],
      Asset: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'id', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ],
      Credit: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'total', type: 'uint256' },
        { name: 'feeTotal', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Position: [
        { name: 'chainId', type: 'uint256' },
        { name: 'venue', type: 'bytes32' },
        { name: 'id', type: 'bytes32' },
        { name: 'value', type: 'uint256' }
      ],
      Price: [
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ],
      Valuation: [
        { name: 'assetList', type: 'Asset[]' },
        { name: 'positionList', type: 'Position[]' }
      ]
    }
  },
  allocate: {
    gate: 'HubGate',
    primaryType: 'AllocateIntent',
    types: {
      AllocateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'shareToken', type: 'address' },
        { name: 'valuation', type: 'Valuation' },
        { name: 'token', type: 'address' },
        { name: 'price', type: 'Price' },
        { name: 'credit', type: 'Credit' },
        { name: 'allocationListHash', type: 'bytes32' }
      ],
      Asset: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'id', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ],
      Credit: [
        { name: 'chainId', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'total', type: 'uint256' },
        { name: 'feeTotal', type: 'uint256' }
      ],
      IntentHeader: [
        { name: 'account', type: 'address' },
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'feeToken', type: 'address' },
        { name: 'fee', type: 'uint256' }
      ],
      Position: [
        { name: 'chainId', type: 'uint256' },
        { name: 'venue', type: 'bytes32' },
        { name: 'id', type: 'bytes32' },
        { name: 'value', type: 'uint256' }
      ],
      Price: [
        { name: 'amount', type: 'uint256' },
        { name: 'value', type: 'uint256' }
      ],
      Valuation: [
        { name: 'assetList', type: 'Asset[]' },
        { name: 'positionList', type: 'Position[]' }
      ]
    }
  }
} as const satisfies IntentActionMap

export const SCHEDULED = {

} as const satisfies IntentActionMap

export const OWN = {

} as const satisfies IntentActionMap
