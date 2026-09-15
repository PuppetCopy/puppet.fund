import type { TypedDataDefinition } from 'viem'

export type IntentTypedData = Pick<TypedDataDefinition, 'primaryType' | 'types'> & { gate: 'CoreGate' | 'HubGate' }

export type IntentActionMap = Readonly<Record<string, IntentTypedData>>

export const ACCOUNT_DOMAIN = { name: 'Puppet', version: '1' } as const

export const CHAINLESS_DOMAIN = { name: 'Puppet', version: '1' } as const

export const TYPEHASH = {
  DepositSwap: '0x86e7adbea174e505f328c785cf2190f4bb4a5e6720bc23826cef42f1f6df7945',
  DrawIntent: '0xf3c7a17ae0f5c1c9dc77d7cd37922a8f73bd88ce8b38ef9a23a3ee2e5f5fcefc',
  Genesis: '0xd3feb412a4a6c96e32455db8e931ca4d26256f6f82329396e89780eb128e23a1',
  IntentHeader: '0x220563108260c7f71e6ed61961c6ad1b1d9a80622aee50ff313ef5994a277e57',
  Mandate: '0xcbfe4260e348cde02d3e315c2fa6ddde6d1dfb51800ddcae3ebebfdbd38e459c',
  MandateIntent: '0x60d5fcf83e5f83049670d1f3118292c7a1323fa126f0540a856df5e8ca241636',
  OperateIntent: '0xe04b0b305ff55655524a7d603e270e85a78498e277a98c2261d9dc7bace4c6fe',
  ScheduledCredit: '0x53eaf194efb9ea659235962ec06cc9630997764af0954897945204388ac687d4',
  Session: '0x2d1c0d71db4f58818198ab3b395453c000f5b27b59781e354b2bd71f01e97dcb',
  SettleIntent: '0x3e5040a313bffcb4408b56df10e1d51485588fb4bcf83073926876c1b9377436',
  SwapParams: '0x52c571063c1aaa69398a375e8e2b86139061822ac70ea183a8dd35609e0d4488',
  UnbondIntent: '0x887a1da3f8f5ae4aea53cb4d8ee27ced9e7d511058e3c0ccb4a88ad0d292c811',
  WithdrawIntent: '0x91dc9556d891fed9f9194ded969a7b6197e90e516ddd6fbec144d886c8b327a0'
} as const

export const GENESIS_TYPES = {
  Genesis: [
    { name: 'account', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'signer', type: 'address' }
  ]
} as const

export const SESSION_TYPES = {
  Session: [
    { name: 'statement', type: 'string' },
    { name: 'user', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'expiry', type: 'uint256' }
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
    { name: 'expiry', type: 'uint256' },
    { name: 'tokenIdList', type: 'bytes32[]' }
  ]
} as const

export const INTENTS = {
  depositAcross: {
    gate: 'CoreGate',
    primaryType: 'DepositSwap',
    types: {
      DepositSwap: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'swap', type: 'SwapParams' },
        { name: 'destinationChainId', type: 'uint256' }
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
    gate: 'CoreGate',
    primaryType: 'WithdrawIntent',
    types: {
      WithdrawIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'swap', type: 'SwapParams' },
        { name: 'destinationChainId', type: 'uint256' }
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
    gate: 'CoreGate',
    primaryType: 'OperateIntent',
    types: {
      OperateIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'creditListHash', type: 'bytes32' },
        { name: 'cycle', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'collateral', type: 'uint256' },
        { name: 'skin', type: 'uint256' },
        { name: 'backed', type: 'uint256' },
        { name: 'backingListHash', type: 'bytes32' },
        { name: 'callListHash', type: 'bytes32' }
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
  settle: {
    gate: 'CoreGate',
    primaryType: 'SettleIntent',
    types: {
      SettleIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'cycle', type: 'uint256' },
        { name: 'token', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gainListHash', type: 'bytes32' }
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
        { name: 'creditListHash', type: 'bytes32' },
        { name: 'bond', type: 'uint256' },
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
  unbond: {
    gate: 'HubGate',
    primaryType: 'UnbondIntent',
    types: {
      UnbondIntent: [
        { name: 'header', type: 'IntentHeader' },
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
  draw: {
    gate: 'HubGate',
    primaryType: 'DrawIntent',
    types: {
      DrawIntent: [
        { name: 'header', type: 'IntentHeader' },
        { name: 'spokeChainId', type: 'uint256' },
        { name: 'cycle', type: 'uint256' },
        { name: 'lossListHash', type: 'bytes32' }
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
  }
} as const satisfies IntentActionMap
