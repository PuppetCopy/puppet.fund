export const router__gasLimit = {
  SpokeGate: {
    depositAcross: 266028n,
    fulfil: 203376n,
    fundSwap: 251517n,
    operate: 170125n,
    retireEscrow: 339532n,
    withdraw: 356900n
  },
  HubGate: {
    allocate: 432049n,
    createFund: 758013n,
    depositAcross: 266028n,
    fundSwap: 251517n,
    mandate: 197242n,
    redeem: 565382n,
    redeemCohort: 313644n,
    retireEscrow: 339532n,
    sell: 302705n,
    withdraw: 356900n
  }
} as const

export const router__loopGas = {
  allocate: 107168n,
  createFund: 107168n,
  mandate: 17406n,
  operate: 12934n,
  redeem: 130080n,
  redeemCohort: 111328n
} as const

export const router__accountGenesisGas = 105829n

export const router__userGenesisGas = 132774n

export const router__withdrawProviderGas = 0n
