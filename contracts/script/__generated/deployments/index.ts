// This file is auto-generated from Puppet deployments.toml and forge-artifacts.
// Do not edit manually.

import dictateAbi from '../abi/puppetDictate.js'
import registermoduleAbi from '../abi/puppetRegisterModule.js'
import puppetaccountAbi from '../abi/puppetPuppetAccount.js'
import transientrouteAbi from '../abi/puppetTransientRoute.js'
import masteraccountAbi from '../abi/puppetMasterAccount.js'
import attestAbi from '../abi/puppetAttest.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import walletdepositmoduleAbi from '../abi/puppetWalletDepositModule.js'
import coregateAbi from '../abi/puppetCoreGate.js'
import sharetokenAbi from '../abi/puppetShareToken.js'
import sharemoduleAbi from '../abi/puppetShareModule.js'
import redeemstoreAbi from '../abi/puppetRedeemStore.js'
import redeemmoduleAbi from '../abi/puppetRedeemModule.js'
import allocatestoreAbi from '../abi/puppetAllocateStore.js'
import subscribemoduleAbi from '../abi/puppetSubscribeModule.js'
import allocatemoduleAbi from '../abi/puppetAllocateModule.js'
import hubgateAbi from '../abi/puppetHubGate.js'
import puppetgateAbi from '../abi/puppetPuppetGate.js'
import mastergateAbi from '../abi/puppetMasterGate.js'

export const CORE_CONTRACT_MAP = {
  Dictate: {
    address: '0x0d6429E7d707c782d65DD7c70E7cbBA93d7924A3',
    chainBlockMap: { 8453: 46928964, 42161: 470248338 },
    abi: dictateAbi
  },
  RegisterModule: {
    address: '0x82613D76444c0510a40BEf070A7e4742e2561917',
    chainBlockMap: { 8453: 46928965, 42161: 470248340 },
    abi: registermoduleAbi
  },
  PuppetAccount: {
    address: '0x7e1b31d8AdE9F1115f03d673798d069C1dB3B054',
    chainBlockMap: { 8453: 46928965, 42161: 470248341 },
    abi: puppetaccountAbi
  },
  TransientRoute: {
    address: '0x6C02Bd5f49fc643B7Cc88BBDAfF65F38a5a91b8d',
    chainBlockMap: { 8453: 46928965, 42161: 470248347 },
    abi: transientrouteAbi
  },
  MasterAccount: {
    address: '0x23874d6b5c74AAba087C2595F1F1c7bb801edCF9',
    chainBlockMap: { 8453: 46928966, 42161: 470248349 },
    abi: masteraccountAbi
  },
  Attest: {
    address: '0x0A88A2260Dd98eeACAad1De22C9562Ed12B58bbe',
    chainBlockMap: { 8453: 46928966, 42161: 470248350 },
    abi: attestAbi
  },
  AccountModule: {
    address: '0x7E518131A4FBE1e03FFa0E7AbD577B451f97622b',
    chainBlockMap: { 8453: 46928966, 42161: 470248352 },
    abi: accountmoduleAbi
  },
  WalletDepositModule: {
    address: '0x590e2DdB1Ca5193584F3a9E2B26C070457cca2eB',
    chainBlockMap: { 8453: 46928967, 42161: 470248354 },
    abi: walletdepositmoduleAbi
  },
  Bridge: {
    address: '0xa7554196D089E4A5edc56b5A5b9c0Eb04dc0C357',
    chainBlockMap: { 8453: 46944971, 42161: 470377598 }
  }
} as const

export const HUB_CONTRACT_MAP = {
  CoreGate: {
    address: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3',
    chainAddresses: { 8453: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3', 42161: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3' },
    abi: coregateAbi
  },
  ShareToken: {
    address: '0x34ab18A93C8f338c2CDa47a8C7c045DCC1F64680',
    chainAddresses: { 42161: '0x34ab18A93C8f338c2CDa47a8C7c045DCC1F64680' },
    abi: sharetokenAbi
  },
  ShareModule: {
    address: '0xC09F85DF0e6C723aC39735E5F3784EDf44f650dc',
    chainAddresses: { 42161: '0xC09F85DF0e6C723aC39735E5F3784EDf44f650dc' },
    abi: sharemoduleAbi
  },
  RedeemStore: {
    address: '0x5AfB58Aa9a446748C6DD9DcF89C17D6DCc1E93B5',
    chainAddresses: { 42161: '0x5AfB58Aa9a446748C6DD9DcF89C17D6DCc1E93B5' },
    abi: redeemstoreAbi
  },
  RedeemModule: {
    address: '0x6cf9De32c9290fb945C3F56EbC2cd6680595d308',
    chainAddresses: { 42161: '0x6cf9De32c9290fb945C3F56EbC2cd6680595d308' },
    abi: redeemmoduleAbi
  },
  AllocateStore: {
    address: '0xA5467952BCd95A2886F40e768F28368716519C71',
    chainAddresses: { 42161: '0xA5467952BCd95A2886F40e768F28368716519C71' },
    abi: allocatestoreAbi
  },
  SubscribeModule: {
    address: '0x44005Ad115504A06be96682e405b74950bfd20db',
    chainAddresses: { 42161: '0x44005Ad115504A06be96682e405b74950bfd20db' },
    abi: subscribemoduleAbi
  },
  AllocateModule: {
    address: '0x7FE3Fcd65d581F342B098D5eE2479aAfe815c934',
    chainAddresses: { 42161: '0x7FE3Fcd65d581F342B098D5eE2479aAfe815c934' },
    abi: allocatemoduleAbi
  },
  HubGate: {
    address: '0x45D8b0FD376234dcE2457E6D258c377B734019DF',
    chainAddresses: { 42161: '0x45D8b0FD376234dcE2457E6D258c377B734019DF' },
    abi: hubgateAbi
  },
  PuppetGate: {
    address: '0xC1498923CF2613472015364665e7b523D7CBb4e3',
    chainAddresses: { 8453: '0xC1498923CF2613472015364665e7b523D7CBb4e3', 42161: '0xC1498923CF2613472015364665e7b523D7CBb4e3' },
    abi: puppetgateAbi
  },
  MasterGate: {
    address: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4',
    chainAddresses: { 8453: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4', 42161: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4' },
    abi: mastergateAbi
  }
} as const

export const SPOKE_CONTRACT_MAP = {
  CoreGate: {
    address: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3',
    chainAddresses: { 8453: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3', 42161: '0xFBFc9643E2b7B21Db28d2d240AFB2266706575d3' },
    abi: coregateAbi
  },
  PuppetGate: {
    address: '0xC1498923CF2613472015364665e7b523D7CBb4e3',
    chainAddresses: { 8453: '0xC1498923CF2613472015364665e7b523D7CBb4e3', 42161: '0xC1498923CF2613472015364665e7b523D7CBb4e3' },
    abi: puppetgateAbi
  },
  MasterGate: {
    address: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4',
    chainAddresses: { 8453: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4', 42161: '0x8F87a0ef025E67A0DDaf7bF4A87FB1807C2fECe4' },
    abi: mastergateAbi
  }
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
