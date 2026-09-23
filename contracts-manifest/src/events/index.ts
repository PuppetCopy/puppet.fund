export const CONTRACT_EVENT_MAP = {

} as const

export const accountCallEvent = {type:"event",name:"AccountCall",inputs:[{name:"account",type:"address",indexed:true,internalType:"address"},{name:"source",type:"address",indexed:true,internalType:"address"},{name:"modulePrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"accountPrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"blockTimestamp",type:"uint256",indexed:false,internalType:"uint256"},{name:"digest",type:"bytes32",indexed:false,internalType:"bytes32"},{name:"signature",type:"bytes",indexed:false,internalType:"bytes"},{name:"executionData",type:"bytes",indexed:false,internalType:"bytes"},{name:"callList",type:"tuple[]",indexed:false,internalType:"struct IAccount.Call[]",components:[{name:"target",type:"address",internalType:"address"},{name:"value",type:"uint256",internalType:"uint256"},{name:"gasLimit",type:"uint256",internalType:"uint256"},{name:"callData",type:"bytes",internalType:"bytes"}]},{name:"resultList",type:"bytes[]",indexed:false,internalType:"bytes[]"},{name:"balanceList",type:"tuple[]",indexed:false,internalType:"struct BalanceLib.Balance[]",components:[{name:"token",type:"address",internalType:"address"},{name:"amount",type:"uint256",internalType:"uint256"}]}],anonymous:false} as const

export const ACCOUNT_CALL_MAP = {
  AccountModule: {
    createAccount: { selector: '0xfb603535', size: 64, args: [{type:"address",name:"parent"}] },
    createUserAccount: { selector: '0x95fba7f6', size: 64, args: [{type:"address",name:"user"}] }
  },
  Deposit: {
    deposit: { selector: '0x1e831bdc', size: 160, args: [{type:"address",name:"user"},{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"msgValue"}] },
    depositAcross: { selector: '0x20fa0073', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    depositEscrow: { selector: '0xe3c2a826', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"token"},{type:"uint256",name:"amount"}] },
    fundSwap: { selector: '0x1de2ca56', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    withdraw: { selector: '0xead1ce83', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  Fund: {
    allocateMaster: { selector: '0x4a021968', size: 448, args: [{type:"uint256",name:"value"},{type:"tuple",name:"price",components:[{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"value"}]},{type:"tuple",name:"credit",components:[{type:"uint256",name:"chainId"},{type:"address",name:"token"},{type:"uint256",name:"amount"}]},{type:"uint256",name:"creditedTotal"},{type:"uint256",name:"minted"},{type:"uint256",name:"skin"},{type:"uint256",name:"slice"},{type:"uint256",name:"billed"},{type:"uint256",name:"masterBilled"}] },
    allocatePuppet: { selector: '0x4a021968', size: 256, args: [{type:"address",name:"master"},{type:"uint256",name:"amount"},{type:"uint256",name:"value"},{type:"uint256",name:"slice"},{type:"uint256",name:"units"},{type:"tuple",name:"holding",components:[{type:"uint192",name:"basis"},{type:"uint64",name:"allocatedAt"}]}] },
    claimHolder: { selector: '0x8a72c442', size: 288, args: [{type:"address",name:"master"},{type:"uint256",name:"payoutValue"},{type:"uint256",name:"feeValue"},{type:"tuple",name:"position",components:[{type:"uint256",name:"epoch"},{type:"uint256",name:"cursor"},{type:"uint256",name:"weight"},{type:"uint256",name:"basis"},{type:"uint256",name:"shortfall"}]}] },
    claimOwner: { selector: '0x8a72c442', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"holder"},{type:"uint256",name:"feeValue"}] },
    redeemMaster: { selector: '0x396d37c6', size: 480, args: [{type:"uint256",name:"value"},{type:"tuple",name:"price",components:[{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"value"}]},{type:"uint256",name:"retire"},{type:"bool",name:"fromPool"},{type:"uint256",name:"drained"},{type:"uint256",name:"cashValue"},{type:"uint256",name:"feeValue"},{type:"tuple",name:"queue",components:[{type:"uint256",name:"epoch"},{type:"uint256",name:"weight"}]},{type:"uint256",name:"retired"},{type:"uint256",name:"accrued"},{type:"uint256",name:"tokenAccrued"}] },
    redeemOwner: { selector: '0x396d37c6', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"token"},{type:"uint256",name:"net"}] },
    sellMaster: { selector: '0xf8d3c9a6', size: 160, args: [{type:"address",name:"puppet"},{type:"tuple",name:"queue",components:[{type:"uint256",name:"epoch"},{type:"uint256",name:"weight"}]},{type:"uint256",name:"pool"}] },
    sellOwner: { selector: '0xf8d3c9a6', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"puppet"},{type:"uint256",name:"feeValue"}] },
    sellPuppet: { selector: '0xf8d3c9a6', size: 480, args: [{type:"address",name:"master"},{type:"uint256",name:"units"},{type:"uint256",name:"basis"},{type:"uint256",name:"payoutValue"},{type:"uint256",name:"feeValue"},{type:"tuple",name:"holding",components:[{type:"uint192",name:"basis"},{type:"uint64",name:"allocatedAt"}]},{type:"tuple",name:"position",components:[{type:"uint256",name:"epoch"},{type:"uint256",name:"cursor"},{type:"uint256",name:"weight"},{type:"uint256",name:"basis"},{type:"uint256",name:"shortfall"}]},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  HubGate: {
    createFund: { selector: '0x9108fff3', size: null, args: [{type:"address",name:"clone"},{type:"bytes32",name:"symbol"},{type:"bytes",name:"pixels"},{type:"uint256",name:"performanceFee"}] },
    mandate: { selector: '0x5dd72fb6', size: null, args: [{type:"tuple[]",name:"mandateList",components:[{type:"address",name:"master"},{type:"uint256",name:"skin"},{type:"uint256",name:"allocationRate"},{type:"uint256",name:"cooldownPeriod"},{type:"uint256",name:"expiry"}]},{type:"bytes[]",name:"signatureList"},{type:"address[]",name:"tokenList"},{type:"bool",name:"arm"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    payOwed: { selector: '0x21b3e4ee', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"}] },
    refund: { selector: '0x82ad6f35', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"token"},{type:"uint256",name:"amount"}] }
  },
  LiquidityGate: {
    escrow: { selector: '0x818d17ac', size: 192, args: [{type:"address",name:"master"},{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  SpokeGate: {
    fulfil: { selector: '0x64600a32', size: 224, args: [{type:"address",name:"parent"},{type:"address",name:"token"},{type:"bytes32",name:"round"},{type:"uint256",name:"fromTotal"},{type:"uint256",name:"fulfilledTotal"},{type:"uint256",name:"fee"}] },
    operate: { selector: '0x06635442', size: 96, args: [{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  UserAccount: {
    requestWithdraw: { selector: '0xb3423eec', size: 64, args: [{type:"uint256",name:"requestedAt"}] },
    revokeSessions: { selector: '0xac2d5d4b', size: 64, args: [{type:"uint256",name:"epoch"}] },
    withdraw: { selector: '0xb5c5f672', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"}] }
  }
} as const
