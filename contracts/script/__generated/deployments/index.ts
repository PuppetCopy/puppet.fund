// This file is auto-generated from Puppet deployments.toml and forge-artifacts.
// Do not edit manually.

import dictateAbi from '../abi/puppetDictate.js'
import registermoduleAbi from '../abi/puppetRegisterModule.js'
import puppetaccountAbi from '../abi/puppetPuppetAccount.js'
import fundaccountAbi from '../abi/puppetFundAccount.js'
import passthroughrouteAbi from '../abi/puppetPassthroughRoute.js'
import attestAbi from '../abi/puppetAttest.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import walletdepositmoduleAbi from '../abi/puppetWalletDepositModule.js'
import accountgateAbi from '../abi/puppetAccountGate.js'
import mastergateAbi from '../abi/puppetMasterGate.js'
import sharetokenAbi from '../abi/puppetShareToken.js'
import sharemoduleAbi from '../abi/puppetShareModule.js'
import redeemstoreAbi from '../abi/puppetRedeemStore.js'
import redeemmoduleAbi from '../abi/puppetRedeemModule.js'
import allocatestoreAbi from '../abi/puppetAllocateStore.js'
import subscribemoduleAbi from '../abi/puppetSubscribeModule.js'
import allocatemoduleAbi from '../abi/puppetAllocateModule.js'
import hubgateAbi from '../abi/puppetHubGate.js'

export const CORE_CONTRACT_MAP = {
  Dictate: {
    address: '0x6CFFAc40bc3C73846E4f37B1AA1D021b6f7A2b2e',
    chainBlockMap: { 8453: 47119549, 42161: 471766784 },
    abi: dictateAbi
  },
  RegisterModule: {
    address: '0x55844336c9FC50388550d4F6E077dec15cC06238',
    chainBlockMap: { 8453: 47119549, 42161: 471766786 },
    abi: registermoduleAbi
  },
  PuppetAccount: {
    address: '0x79e8087F6D49295603707975B5FB45E6455597Eb',
    chainBlockMap: { 8453: 47119549, 42161: 471766787 },
    abi: puppetaccountAbi
  },
  FundAccount: {
    address: '0x7ec98Eb2c55a2BcA959a998630F73789fa5E56FE',
    chainBlockMap: { 8453: 47119549, 42161: 471766789 },
    abi: fundaccountAbi
  },
  PassthroughRoute: {
    address: '0xbA64f9f71ca52445c351Fc5d743294760326957C',
    chainBlockMap: { 8453: 47119550, 42161: 471766791 },
    abi: passthroughrouteAbi
  },
  Attest: {
    address: '0x9C55998FFCd7ef53240da20E163505F459ce82E0',
    chainBlockMap: { 8453: 47119550, 42161: 471766792 },
    abi: attestAbi
  },
  AccountModule: {
    address: '0xcd7a9B94DD2dC8A48ccC0b1dE7C974280aa8d504',
    chainBlockMap: { 8453: 47119550, 42161: 471766794 },
    abi: accountmoduleAbi
  },
  WalletDepositModule: {
    address: '0x3f229B7afE6acB348B48Fca47484E2C967505eFC',
    chainBlockMap: { 8453: 47119550, 42161: 471766796 },
    abi: walletdepositmoduleAbi
  }
} as const

export const HUB_CONTRACT_MAP = {
  AccountGate: {
    address: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39',
    chainAddresses: { 8453: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39', 42161: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9',
    chainAddresses: { 8453: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9', 42161: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9' },
    abi: mastergateAbi
  },
  ShareToken: {
    address: '0x2DCf6D774A5C0225205a1fA9a078094C73c0B9B7',
    chainAddresses: { 42161: '0x2DCf6D774A5C0225205a1fA9a078094C73c0B9B7' },
    abi: sharetokenAbi
  },
  ShareModule: {
    address: '0xF43eEC8A87E08Bf052Df54E8d2416C451e272ce1',
    chainAddresses: { 42161: '0xF43eEC8A87E08Bf052Df54E8d2416C451e272ce1' },
    abi: sharemoduleAbi
  },
  RedeemStore: {
    address: '0x7b3A012Ff9e23D2600f2DC38e26d25242b9509b9',
    chainAddresses: { 42161: '0x7b3A012Ff9e23D2600f2DC38e26d25242b9509b9' },
    abi: redeemstoreAbi
  },
  RedeemModule: {
    address: '0xCb9b11cbFda164ee99eA4a0FF7BAc49713a8C632',
    chainAddresses: { 42161: '0xCb9b11cbFda164ee99eA4a0FF7BAc49713a8C632' },
    abi: redeemmoduleAbi
  },
  AllocateStore: {
    address: '0xA4811051E6f6Be29Dc7F627020915DaB45319F89',
    chainAddresses: { 42161: '0xA4811051E6f6Be29Dc7F627020915DaB45319F89' },
    abi: allocatestoreAbi
  },
  SubscribeModule: {
    address: '0xadC0E6984B1E008A6A6B258693d1bDdFDe4cA48a',
    chainAddresses: { 42161: '0xadC0E6984B1E008A6A6B258693d1bDdFDe4cA48a' },
    abi: subscribemoduleAbi
  },
  AllocateModule: {
    address: '0x4fC781BEeD39ceEF6454A8B1f145BAEA9cB1F30C',
    chainAddresses: { 42161: '0x4fC781BEeD39ceEF6454A8B1f145BAEA9cB1F30C' },
    abi: allocatemoduleAbi
  },
  HubGate: {
    address: '0x2d9Df68632368A50754836Ecd90157Cdee26aF05',
    chainAddresses: { 42161: '0x2d9Df68632368A50754836Ecd90157Cdee26aF05' },
    abi: hubgateAbi
  }
} as const

export const SPOKE_CONTRACT_MAP = {
  AccountGate: {
    address: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39',
    chainAddresses: { 8453: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39', 42161: '0xe7c107A6a799902a20eB0EBd5F12CFFd5655Fa39' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9',
    chainAddresses: { 8453: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9', 42161: '0x27aB79F4196ABb5FfAB66Bb47a8dD14bA331A4A9' },
    abi: mastergateAbi
  }
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
