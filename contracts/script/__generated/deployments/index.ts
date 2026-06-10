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
    address: '0xE1Fd6291199f80a426881c597365FcA622dc6205',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: dictateAbi
  },
  RegisterModule: {
    address: '0x66Df4460571504569Bd54D6E073BF41f04b47884',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: registermoduleAbi
  },
  PuppetAccount: {
    address: '0x1004D143DCbE13F601634bf2942F23112384eA3E',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: puppetaccountAbi
  },
  FundAccount: {
    address: '0x0126AD8adb6Dfb118911502749cfdb285996d004',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: fundaccountAbi
  },
  PassthroughRoute: {
    address: '0xe00B242161c925b8AF662C6E08C6a5cBe73CE2C1',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: passthroughrouteAbi
  },
  Attest: {
    address: '0x581407dD72a7ab9E989c071956727d8D1271256c',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: attestAbi
  },
  AccountModule: {
    address: '0xB5f1Bb90e9e92864bb3d3255e89E32ABd09b30d0',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: accountmoduleAbi
  },
  WalletDepositModule: {
    address: '0x8269652C3619d94b32cAa6C6A1100Bd6c67D4912',
    chainBlockMap: { 8453: 47158193, 42161: 472074724 },
    abi: walletdepositmoduleAbi
  }
} as const

export const HUB_CONTRACT_MAP = {
  AccountGate: {
    address: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C',
    chainAddresses: { 8453: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C', 42161: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43',
    chainAddresses: { 8453: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43', 42161: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43' },
    abi: mastergateAbi
  },
  ShareToken: {
    address: '0x39B234AA5F7B8A19f52FAF47167973ACaD279C79',
    chainAddresses: { 42161: '0x39B234AA5F7B8A19f52FAF47167973ACaD279C79' },
    abi: sharetokenAbi
  },
  ShareModule: {
    address: '0x1433fDbE7Bc8067b7F5DdaE7f5BBaC1F71184Aa2',
    chainAddresses: { 42161: '0x1433fDbE7Bc8067b7F5DdaE7f5BBaC1F71184Aa2' },
    abi: sharemoduleAbi
  },
  RedeemStore: {
    address: '0xD39E505d21755ff9308250C1C2c3001585d1900f',
    chainAddresses: { 42161: '0xD39E505d21755ff9308250C1C2c3001585d1900f' },
    abi: redeemstoreAbi
  },
  RedeemModule: {
    address: '0x6863c70e16E0F010d21b83B93Bd63Efd85c29b2F',
    chainAddresses: { 42161: '0x6863c70e16E0F010d21b83B93Bd63Efd85c29b2F' },
    abi: redeemmoduleAbi
  },
  AllocateStore: {
    address: '0xEa275D3872b203c2A5c074D947E971f78467c29A',
    chainAddresses: { 42161: '0xEa275D3872b203c2A5c074D947E971f78467c29A' },
    abi: allocatestoreAbi
  },
  SubscribeModule: {
    address: '0xd65d2cA3a48A43ae2DcD3B96b20eeB732f185d6e',
    chainAddresses: { 42161: '0xd65d2cA3a48A43ae2DcD3B96b20eeB732f185d6e' },
    abi: subscribemoduleAbi
  },
  AllocateModule: {
    address: '0x111Ec8f9BdEE7Aca46F979Ccda5022827B2e46c3',
    chainAddresses: { 42161: '0x111Ec8f9BdEE7Aca46F979Ccda5022827B2e46c3' },
    abi: allocatemoduleAbi
  },
  HubGate: {
    address: '0x7242D4538332ECF36b0Aa69a4f91F1370fbBC0B6',
    chainAddresses: { 42161: '0x7242D4538332ECF36b0Aa69a4f91F1370fbBC0B6' },
    abi: hubgateAbi
  }
} as const

export const SPOKE_CONTRACT_MAP = {
  AccountGate: {
    address: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C',
    chainAddresses: { 8453: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C', 42161: '0x188C164eFb1248f6e77317FEc9f39A0D5E62Ca7C' },
    abi: accountgateAbi
  },
  MasterGate: {
    address: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43',
    chainAddresses: { 8453: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43', 42161: '0xd332b13C8C8B7B8E5B00de6Eb5EA91404Ed0fB43' },
    abi: mastergateAbi
  }
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
