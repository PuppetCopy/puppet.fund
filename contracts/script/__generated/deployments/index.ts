// This file is auto-generated from Puppet deployments.toml and forge-artifacts.
// Do not edit manually.

import dictateAbi from '../abi/puppetDictate.js'
import registertokenAbi from '../abi/puppetRegisterToken.js'
import puppetaccountAbi from '../abi/puppetPuppetAccount.js'
import fundaccountAbi from '../abi/puppetFundAccount.js'
import routeAbi from '../abi/puppetRoute.js'
import attestAbi from '../abi/puppetAttest.js'
import accountAbi from '../abi/puppetAccount.js'
import depositAbi from '../abi/puppetDeposit.js'
import accountgateAbi from '../abi/puppetAccountGate.js'
import mastergateAbi from '../abi/puppetMasterGate.js'
import sharetokenAbi from '../abi/puppetShareToken.js'
import issueAbi from '../abi/puppetIssue.js'
import redeemstoreAbi from '../abi/puppetRedeemStore.js'
import redeemAbi from '../abi/puppetRedeem.js'
import allocatestoreAbi from '../abi/puppetAllocateStore.js'
import subscribeAbi from '../abi/puppetSubscribe.js'
import allocateAbi from '../abi/puppetAllocate.js'
import hubgateAbi from '../abi/puppetHubGate.js'

export const CORE_CONTRACT_MAP = {
  Dictate: {
    address: '0xa8b6fffD077e5eA715F5ca9bd0994304b1614E96',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: dictateAbi
  },
  RegisterToken: {
    address: '0xbB06f05e77736786AFbC64f1F8Ae5763f43DeE66',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: registertokenAbi
  },
  PuppetAccount: {
    address: '0xfc58e5B51DB89C5DEb3e03f4Ca319c0AdbB0fEc6',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: puppetaccountAbi
  },
  FundAccount: {
    address: '0xf626DE0F920115263eaaD3FeD613a943f8dfd04D',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: fundaccountAbi
  },
  Route: {
    address: '0xB05037d02E11A125E37119754F92591bfb124Bf6',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: routeAbi
  },
  Attest: {
    address: '0x749b225CF6d179b137390B7B3790Ed4c4a8185e3',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: attestAbi
  },
  Account: {
    address: '0x042e142156e25CF60eba55e675c3E50048284F08',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: accountAbi
  },
  Deposit: {
    address: '0xeEF1ad2fFeD2D97FF1e753F3FF1441f4D1AA7d97',
    chainBlockMap: { 8453: 47248825, 42161: 472797635 },
    abi: depositAbi
  }
} as const

export const HUB_CONTRACT_MAP = {
  AccountGate: {
    address: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E',
    chainAddresses: { 8453: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E', 42161: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7',
    chainAddresses: { 8453: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7', 42161: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7' },
    abi: mastergateAbi
  },
  ShareToken: {
    address: '0xDC3413F7fA6107D672ff8Dd3a87F89aAec47d06E',
    chainAddresses: { 42161: '0xDC3413F7fA6107D672ff8Dd3a87F89aAec47d06E' },
    abi: sharetokenAbi
  },
  Issue: {
    address: '0xEAcc38a5FeFf66C5C30Df33a66fF36C7aD553865',
    chainAddresses: { 42161: '0xEAcc38a5FeFf66C5C30Df33a66fF36C7aD553865' },
    abi: issueAbi
  },
  RedeemStore: {
    address: '0x433978fc2798c8F9ee98A4F5F0323C0FE70DD81D',
    chainAddresses: { 42161: '0x433978fc2798c8F9ee98A4F5F0323C0FE70DD81D' },
    abi: redeemstoreAbi
  },
  Redeem: {
    address: '0xcE237E5C9C22c3370e2624Fd534Ef105fb9C232d',
    chainAddresses: { 42161: '0xcE237E5C9C22c3370e2624Fd534Ef105fb9C232d' },
    abi: redeemAbi
  },
  AllocateStore: {
    address: '0x05f9c06513BD41995388e4C95320968a0f421B50',
    chainAddresses: { 42161: '0x05f9c06513BD41995388e4C95320968a0f421B50' },
    abi: allocatestoreAbi
  },
  Subscribe: {
    address: '0x7FDF799A09bcDbA860816fbeDE7c3Deda5b0266D',
    chainAddresses: { 42161: '0x7FDF799A09bcDbA860816fbeDE7c3Deda5b0266D' },
    abi: subscribeAbi
  },
  Allocate: {
    address: '0x154a60B6c5B8DFCdA301F4B272D31c5b7D58Bb83',
    chainAddresses: { 42161: '0x154a60B6c5B8DFCdA301F4B272D31c5b7D58Bb83' },
    abi: allocateAbi
  },
  HubGate: {
    address: '0x2b2389D14504c8C97273Ec4b3D1afC3c9d1563fa',
    chainAddresses: { 42161: '0x2b2389D14504c8C97273Ec4b3D1afC3c9d1563fa' },
    abi: hubgateAbi
  }
} as const

export const SPOKE_CONTRACT_MAP = {
  AccountGate: {
    address: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E',
    chainAddresses: { 8453: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E', 42161: '0x3a6526C26804D7Ad0F116330899FA808fa8dd94E' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7',
    chainAddresses: { 8453: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7', 42161: '0x6a63F80E57f175f10013B918b7aA83a195C4d3a7' },
    abi: mastergateAbi
  }
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
