import ioptimismportalAbi from './IOptimismPortal.js'
import iinboxAbi from './IInbox.js'
import ifxrootAbi from './IFxRoot.js'
import tokenAbi from './puppetToken.js'
import governorAbi from './puppetGovernor.js'
import releaseAbi from './puppetRelease.js'

export const TOKEN_CHAIN_ID = 1 as const
export const TOKEN_NETWORK = 'ethereum' as const

export const TOKEN_BRIDGES = {
  10: { address: '0xbEb5Fc579115071764c7423A4f12eDde41f106Ed', abi: ioptimismportalAbi },
  42161: { address: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f', abi: iinboxAbi },
  4663: { address: '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D', abi: iinboxAbi },
  137: { address: '0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2', abi: ifxrootAbi }
} as const

export default {
  Token: { address: '0x502a577895Edc7CD71a7f24516517cbD4bb09AC6', block: 26242531, abi: tokenAbi },
  Governor: { address: '0x1150749A7140AE0563f5E8bB6bbE4801B8f8764b', block: 26242532, abi: governorAbi },
  Release: { address: '0xFbbA28689B6C1bF7828451250B003831D3Ba09D4', block: 26246895, abi: releaseAbi }
} as const
