// Source: GMX deployment files from gmx-io/gmx-synthetics

import readerv2Abi from './abi/gmxReaderV2.js'
import exchangerouterAbi from './abi/gmxExchangeRouter.js'
import routerAbi from './abi/gmxRouter.js'
import ordervaultAbi from './abi/gmxOrderVault.js'
import datastoreAbi from './abi/gmxDatastore.js'

export const GMX_V2_CONTRACT_MAP = {
  GmxReaderV2: {
    address: '0xfA26cBb46e2614609406de08CA1Dc7f70a684184',
    abi: readerv2Abi
  },
  GmxExchangeRouter: {
    address: '0x7dE39FF2e232A2203196788d37e234cF8F1b83f1',
    abi: exchangerouterAbi
  },
  GmxRouter: {
    address: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
    abi: routerAbi
  },
  GmxOrderVault: {
    address: '0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5',
    abi: ordervaultAbi
  },
  GmxDatastore: {
    address: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    abi: datastoreAbi
  }
} as const
