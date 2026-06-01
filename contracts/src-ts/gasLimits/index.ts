// This file is auto-generated from forge test --gas-report. Do not edit manually.

export const router__gasLimit = {
  CoreGate: {
    createPuppetAccount: 267040n,
    signTransientRouteBalance: 204399n,
    walletWithdraw: 187114n,
    walletWithdrawWnt: 200153n
  },
  HubGate: {
    allocate: 396328n,
    bridgeToWallet: 403229n,
    claim: 251366n,
    createMaster: 501658n,
    fulfill: 253359n,
    sell: 253642n,
    subscribe: 218300n
  },
  SpokeGate: {
    bridge: 383127n,
    bridgeHub: 404402n,
    createMasterAccount: 266923n,
    operate: 122765n,
    signRecordedBalance: 178137n
  }
} as const
