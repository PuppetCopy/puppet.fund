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
    address: '0xE1Fd6291199f80a426881c597365FcA622dc6205',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: dictateAbi
  },
  RegisterToken: {
    address: '0x66Df4460571504569Bd54D6E073BF41f04b47884',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: registertokenAbi
  },
  PuppetAccount: {
    address: '0x1004D143DCbE13F601634bf2942F23112384eA3E',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: puppetaccountAbi
  },
  FundAccount: {
    address: '0x0126AD8adb6Dfb118911502749cfdb285996d004',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: fundaccountAbi
  },
  Route: {
    address: '0xbA7441d5785bfcaBB1204cE56d8a49BEe987c9a4',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: routeAbi
  },
  Attest: {
    address: '0x581407dD72a7ab9E989c071956727d8D1271256c',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: attestAbi
  },
  Account: {
    address: '0x3516Ef53326c16aaCB9E99C09BD7C1d260c129e2',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: accountAbi
  },
  Deposit: {
    address: '0x2365faAF5e6f51F0CCeDf798Eb611B4E572a96ff',
    chainBlockMap: { 8453: 47167532, 42161: 472149328 },
    abi: depositAbi
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
    address: '0x15Aaf4d66D9ca0730ae160726483D1497d2c58Fb',
    chainAddresses: { 42161: '0x15Aaf4d66D9ca0730ae160726483D1497d2c58Fb' },
    abi: sharetokenAbi
  },
  Issue: {
    address: '0xB15aaA74Baed56d2639867088f24d5Db24AB19EA',
    chainAddresses: { 42161: '0xB15aaA74Baed56d2639867088f24d5Db24AB19EA' },
    abi: issueAbi
  },
  RedeemStore: {
    address: '0xe985998CDDC52a38fBfc3046071DAB807482651b',
    chainAddresses: { 42161: '0xe985998CDDC52a38fBfc3046071DAB807482651b' },
    abi: redeemstoreAbi
  },
  Redeem: {
    address: '0xA86d6aBcF808f5e6cecaF737D01f91b84C1bDeBC',
    chainAddresses: { 42161: '0xA86d6aBcF808f5e6cecaF737D01f91b84C1bDeBC' },
    abi: redeemAbi
  },
  AllocateStore: {
    address: '0xe4aCAd99a1bb3d41f64C9B9220a7d51EA0a52f16',
    chainAddresses: { 42161: '0xe4aCAd99a1bb3d41f64C9B9220a7d51EA0a52f16' },
    abi: allocatestoreAbi
  },
  Subscribe: {
    address: '0xdE60Fb4429a8f8609F4Af7FB910889f87917A944',
    chainAddresses: { 42161: '0xdE60Fb4429a8f8609F4Af7FB910889f87917A944' },
    abi: subscribeAbi
  },
  Allocate: {
    address: '0x92e7258465b2c20F3F45D5a067a432481Af34F46',
    chainAddresses: { 42161: '0x92e7258465b2c20F3F45D5a067a432481Af34F46' },
    abi: allocateAbi
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
