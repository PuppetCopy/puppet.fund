// This file is auto-generated. Do not edit manually.
// Source: GMX deployment files from gmx-io/gmx-synthetics

import readerv2Abi from './abi/gmxReaderV2.js'
import exchangerouterAbi from './abi/gmxExchangeRouter.js'
import ordervaultAbi from './abi/gmxOrderVault.js'
import datastoreAbi from './abi/gmxDatastore.js'
import eventemitterAbi from './abi/gmxEventEmitter.js'

export const GMX_V2_CONTRACT_MAP = {
  GmxReaderV2: {
    address: '0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789',
    abi: readerv2Abi
  },
  GmxExchangeRouter: {
    address: '0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41',
    abi: exchangerouterAbi
  },
  GmxOrderVault: {
    address: '0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5',
    abi: ordervaultAbi
  },
  GmxDatastore: {
    address: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    abi: datastoreAbi
  },
  GmxEventEmitter: {
    address: '0xC8ee91A54287DB53897056e12D9819156D3822Fb',
    abi: eventemitterAbi
  }
} as const
