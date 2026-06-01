// This file is auto-generated from Puppet deployments.toml and forge-artifacts.
// Do not edit manually.

import dictateAbi from '../abi/puppetDictate.js'
import accountmoduleAbi from '../abi/puppetAccountModule.js'
import puppetaccountAbi from '../abi/puppetPuppetAccount.js'
import transientrouteAbi from '../abi/puppetTransientRoute.js'
import registermoduleAbi from '../abi/puppetRegisterModule.js'
import walletdepositmoduleAbi from '../abi/puppetWalletDepositModule.js'
import masteraccountAbi from '../abi/puppetMasterAccount.js'
import attestAbi from '../abi/puppetAttest.js'
import sharetokenAbi from '../abi/puppetShareToken.js'
import sharemoduleAbi from '../abi/puppetShareModule.js'
import redeemstoreAbi from '../abi/puppetRedeemStore.js'
import redeemmoduleAbi from '../abi/puppetRedeemModule.js'
import allocatestoreAbi from '../abi/puppetAllocateStore.js'
import subscribemoduleAbi from '../abi/puppetSubscribeModule.js'
import allocatemoduleAbi from '../abi/puppetAllocateModule.js'
import coregateAbi from '../abi/puppetCoreGate.js'
import hubgateAbi from '../abi/puppetHubGate.js'
import spokegateAbi from '../abi/puppetSpokeGate.js'

export const CORE_CONTRACT_MAP = {
  Dictate: {
    address: '0x8639B4483f070794eAe35cb46DdE5Cc7bFb4Cb02',
    chainBlockMap: { 8453: 46638130, 42161: 467927965 },
    abi: dictateAbi
  },
  AccountModule: {
    address: '0x58e9600293F1538533dd327C218AFBB27B718603',
    chainBlockMap: { 8453: 46638132, 42161: 467927982 },
    abi: accountmoduleAbi
  },
  PuppetAccount: {
    address: '0x7CDA7524F9561EDD1F2c48C2c5B33a13bd3Eb159',
    chainBlockMap: { 8453: 46638131, 42161: 467927968 },
    abi: puppetaccountAbi
  },
  TransientRoute: {
    address: '0x3C31528B8447014893F678b233941AC41505476B',
    chainBlockMap: { 8453: 46638131, 42161: 467927974 },
    abi: transientrouteAbi
  },
  RegisterModule: {
    address: '0x7a848aa85473deF75e0BCF26Be67A0C08922Cae7',
    chainBlockMap: { 8453: 46638131, 42161: 467927966 },
    abi: registermoduleAbi
  },
  WalletDepositModule: {
    address: '0xB2a541e7eCFa251295F520d938290Be4e89Dc0D1',
    chainBlockMap: { 8453: 46638132, 42161: 467927984 },
    abi: walletdepositmoduleAbi
  },
  MasterAccount: {
    address: '0x438B0d4eb02A94C5b5A79b1f59ed637bAB74E8A0',
    chainBlockMap: { 8453: 46638131, 42161: 467927974 },
    abi: masteraccountAbi
  },
  Attest: {
    address: '0xD643D37401c75eD5Cace7a20c21B2970ab1D0d7a',
    chainBlockMap: { 8453: 46638131, 42161: 467927981 },
    abi: attestAbi
  }
} as const

export const HUB_CONTRACT_MAP = {
  ShareToken: {
    address: '0x4Bc2933DC8aFF99AB0715a7d3241f690aad8Dd10',
    chainAddresses: { 42161: '0x4Bc2933DC8aFF99AB0715a7d3241f690aad8Dd10' },
    abi: sharetokenAbi
  },
  ShareModule: {
    address: '0xAb453057a84B5D35713e50e08CE9BAfd6Ba7B09e',
    chainAddresses: { 42161: '0xAb453057a84B5D35713e50e08CE9BAfd6Ba7B09e' },
    abi: sharemoduleAbi
  },
  RedeemStore: {
    address: '0xF2d04d7544c85bDa089C37B70247133Bc23e7d36',
    chainAddresses: { 42161: '0xF2d04d7544c85bDa089C37B70247133Bc23e7d36' },
    abi: redeemstoreAbi
  },
  RedeemModule: {
    address: '0x54A93D860B3e8335cf6D091313E311E9c2D44621',
    chainAddresses: { 42161: '0x54A93D860B3e8335cf6D091313E311E9c2D44621' },
    abi: redeemmoduleAbi
  },
  AllocateStore: {
    address: '0xe642cc7c56037C51624Bd70CCbCbfaF7D242dD00',
    chainAddresses: { 42161: '0xe642cc7c56037C51624Bd70CCbCbfaF7D242dD00' },
    abi: allocatestoreAbi
  },
  SubscribeModule: {
    address: '0x7cE9dbbf3c6607051c09D1166fD14871f39b00c5',
    chainAddresses: { 42161: '0x7cE9dbbf3c6607051c09D1166fD14871f39b00c5' },
    abi: subscribemoduleAbi
  },
  AllocateModule: {
    address: '0x1e7313EB93A9c9130eC45F089AcfDD283f998565',
    chainAddresses: { 42161: '0x1e7313EB93A9c9130eC45F089AcfDD283f998565' },
    abi: allocatemoduleAbi
  },
  CoreGate: {
    address: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF',
    chainAddresses: { 8453: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF', 42161: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF' },
    abi: coregateAbi
  },
  HubGate: {
    address: '0xF5c8Ea0d163d05671F05176af3a5380Cc78c7581',
    chainAddresses: { 42161: '0xF5c8Ea0d163d05671F05176af3a5380Cc78c7581' },
    abi: hubgateAbi
  },
  SpokeGate: {
    address: '0xd838467d992E29C76038dA7c678E57Bd31184949',
    chainAddresses: { 8453: '0xd838467d992E29C76038dA7c678E57Bd31184949', 42161: '0xd838467d992E29C76038dA7c678E57Bd31184949' },
    abi: spokegateAbi
  }
} as const

export const SPOKE_CONTRACT_MAP = {
  CoreGate: {
    address: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF',
    chainAddresses: { 8453: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF', 42161: '0x5C71b01F2f6f17B12d53513538c353e42D3b2cFF' },
    abi: coregateAbi
  },
  SpokeGate: {
    address: '0xd838467d992E29C76038dA7c678E57Bd31184949',
    chainAddresses: { 8453: '0xd838467d992E29C76038dA7c678E57Bd31184949', 42161: '0xd838467d992E29C76038dA7c678E57Bd31184949' },
    abi: spokegateAbi
  }
} as const

export const PUPPET_CONTRACT_MAP = { ...CORE_CONTRACT_MAP, ...HUB_CONTRACT_MAP, ...SPOKE_CONTRACT_MAP } as const
