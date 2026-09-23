export const router__gasLimit = {
  SpokeGate: {
    depositAcross: 264854n,
    escrow: 238915n,
    fulfil: 139357n,
    fundSwap: 256457n,
    operate: 174279n,
    withdraw: 210098n
  },
  HubGate: {
    allocate: 354371n,
    claim: 222866n,
    createFund: 608238n,
    depositAcross: 264854n,
    escrow: 238915n,
    fundSwap: 256457n,
    mandate: 240333n,
    redeem: 371422n,
    sell: 408776n,
    withdraw: 210098n
  }
} as const

export const router__loopGas = {
  allocate: 97002n,
  claim: 53314n,
  createFund: 97002n,
  mandate: 36809n,
  operate: 12522n,
  sell: 80745n
} as const

export const router__accountGenesisGas = 109101n

export const router__userGenesisGas = 135272n

export const router__withdrawProviderGas = 9306n
