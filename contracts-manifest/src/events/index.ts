export const accountCallEvent = {type:"event",name:"AccountCall",inputs:[{name:"account",type:"address",indexed:true,internalType:"address"},{name:"source",type:"address",indexed:true,internalType:"address"},{name:"modulePrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"accountPrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"blockTimestamp",type:"uint256",indexed:false,internalType:"uint256"},{name:"digest",type:"bytes32",indexed:false,internalType:"bytes32"},{name:"signature",type:"bytes",indexed:false,internalType:"bytes"},{name:"executionData",type:"bytes",indexed:false,internalType:"bytes"},{name:"callList",type:"tuple[]",indexed:false,internalType:"struct IAccount.Call[]",components:[{name:"target",type:"address",internalType:"address"},{name:"value",type:"uint256",internalType:"uint256"},{name:"gasLimit",type:"uint256",internalType:"uint256"},{name:"callData",type:"bytes",internalType:"bytes"}]},{name:"resultList",type:"bytes[]",indexed:false,internalType:"bytes[]"},{name:"balanceList",type:"tuple[]",indexed:false,internalType:"struct BalanceLib.Balance[]",components:[{name:"token",type:"address",internalType:"address"},{name:"amount",type:"uint256",internalType:"uint256"}]}],anonymous:false} as const

export const ACCOUNT_CALL_MAP = {
  AccountModule: {
    createAccount: { selector: '0xfb603535', size: 64, args: [{type:"address",name:"parent"}] },
    createUserAccount: { selector: '0x95fba7f6', size: 64, args: [{type:"address",name:"user"}] }
  },
  Deposit: {
    depositAcross: { selector: '0x5ff54513', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    fundSwap: { selector: '0x167efc36', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    withdraw: { selector: '0x018c3c5a', size: 256, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  Fund: {
    allocateMaster: { selector: '0xe1c82c76', size: null, args: [{type:"uint256",name:"valuation"},{type:"uint256",name:"supply"},{type:"address",name:"token"},{type:"tuple",name:"price",components:[{type:"uint256",name:"amount"},{type:"uint256",name:"value"}]},{type:"tuple",name:"credit",components:[{type:"uint256",name:"chainId"},{type:"address",name:"token"},{type:"uint256",name:"total"},{type:"uint256",name:"feeTotal"}]},{type:"bytes",name:"ownerSignature"},{type:"uint256",name:"minted"},{type:"uint256",name:"slice"},{type:"uint256",name:"billed"},{type:"uint256",name:"masterBilled"}] },
    allocateOwner: { selector: '0xe1c82c76', size: 192, args: [{type:"address",name:"master"},{type:"tuple",name:"credit",components:[{type:"uint256",name:"chainId"},{type:"address",name:"token"},{type:"uint256",name:"total"},{type:"uint256",name:"feeTotal"}]}] },
    allocatePuppet: { selector: '0xe1c82c76', size: 320, args: [{type:"address",name:"master"},{type:"uint256",name:"amount"},{type:"uint256",name:"value"},{type:"uint256",name:"slice"},{type:"uint256",name:"shares"},{type:"tuple",name:"holding",components:[{type:"uint40",name:"allocatedAt"},{type:"uint40",name:"redeemedAt"},{type:"uint96",name:"queued"},{type:"uint80",name:"cost"}]}] }
  },
  HubGate: {
    createFund: { selector: '0xa2697724', size: null, args: [{type:"address",name:"clone"},{type:"bytes32",name:"symbol"},{type:"bytes",name:"pixels"},{type:"uint256",name:"performanceFee"}] },
    mandate: { selector: '0x93638514', size: null, args: [{type:"uint256",name:"epoch"},{type:"tuple[]",name:"mandateList",components:[{type:"address",name:"master"},{type:"uint256",name:"skin"},{type:"uint256",name:"allocationRate"},{type:"uint256",name:"exitCap"},{type:"uint256",name:"cooldownPeriod"},{type:"uint256",name:"expiry"}]},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  LiquidityGate: {
    deposit: { selector: '0x47e7ef24', size: 128, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"msgValue"}] },
    depositEscrow: { selector: '0xb324e80d', size: 160, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"msgValue"},{type:"uint256",name:"escrowed"}] },
    requestReturn: { selector: '0x7ec4a5a6', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"returnAt"}] },
    retireEscrow: { selector: '0xe70025ae', size: 192, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"escrowed"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] },
    returnEscrow: { selector: '0x0e654357', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"returned"}] }
  },
  Redeem: {
    redeem: { selector: '0xa84ac486', size: 544, args: [{type:"uint256",name:"valuation"},{type:"uint256",name:"join"},{type:"uint256",name:"active"},{type:"uint256",name:"masterShares"},{type:"uint256",name:"cash"},{type:"tuple",name:"redemption",components:[{type:"uint64",name:"id"},{type:"uint32",name:"fraction"},{type:"uint64",name:"fee"},{type:"uint96",name:"masterPay"},{type:"uint128",name:"queued"},{type:"uint128",name:"owedLeft"},{type:"uint96",name:"potLeft"},{type:"address",name:"token"},{type:"uint256",name:"price"}]},{type:"tuple",name:"rate",components:[{type:"uint256",name:"amount"},{type:"uint256",name:"value"}]}] },
    redeemCohortHolder: { selector: '0x9ea840f8', size: 544, args: [{type:"address",name:"master"},{type:"uint256",name:"queued"},{type:"uint256",name:"burned"},{type:"uint256",name:"payout"},{type:"uint256",name:"profitFee"},{type:"uint256",name:"protocolCut"},{type:"tuple",name:"redemption",components:[{type:"uint64",name:"id"},{type:"uint32",name:"fraction"},{type:"uint64",name:"fee"},{type:"uint96",name:"masterPay"},{type:"uint128",name:"queued"},{type:"uint128",name:"owedLeft"},{type:"uint96",name:"potLeft"},{type:"address",name:"token"},{type:"uint256",name:"price"}]},{type:"bool",name:"refused"}] },
    redeemCohortMaster: { selector: '0x9ea840f8', size: 416, args: [{type:"uint256",name:"payout"},{type:"uint256",name:"cut"},{type:"tuple",name:"redemption",components:[{type:"uint64",name:"id"},{type:"uint32",name:"fraction"},{type:"uint64",name:"fee"},{type:"uint96",name:"masterPay"},{type:"uint128",name:"queued"},{type:"uint128",name:"owedLeft"},{type:"uint96",name:"potLeft"},{type:"address",name:"token"},{type:"uint256",name:"price"}]},{type:"uint256",name:"unburned"}] },
    redeemCohortOwner: { selector: '0x9ea840f8', size: 128, args: [{type:"address",name:"master"},{type:"address",name:"token"},{type:"uint256",name:"paid"}] },
    sell: { selector: '0xd2795f55', size: 736, args: [{type:"address",name:"master"},{type:"uint256",name:"shares"},{type:"tuple",name:"holding",components:[{type:"uint40",name:"allocatedAt"},{type:"uint40",name:"redeemedAt"},{type:"uint96",name:"queued"},{type:"uint80",name:"cost"}]},{type:"tuple",name:"redemption",components:[{type:"uint64",name:"id"},{type:"uint32",name:"fraction"},{type:"uint64",name:"fee"},{type:"uint96",name:"masterPay"},{type:"uint128",name:"queued"},{type:"uint128",name:"owedLeft"},{type:"uint96",name:"potLeft"},{type:"address",name:"token"},{type:"uint256",name:"price"}]},{type:"uint256",name:"queued"},{type:"uint256",name:"burned"},{type:"uint256",name:"payout"},{type:"uint256",name:"profitFee"},{type:"uint256",name:"protocolCut"},{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  SpokeGate: {
    fulfil: { selector: '0xbf3783e4', size: 128, args: [{type:"address",name:"token"},{type:"uint256",name:"total"},{type:"uint256",name:"feeTotal"}] },
    operate: { selector: '0x06635442', size: 96, args: [{type:"address",name:"feeToken"},{type:"uint256",name:"fee"}] }
  },
  UserAccount: {
    revokeSessions: { selector: '0xac2d5d4b', size: 64, args: [{type:"uint256",name:"epoch"}] },
    withdraw: { selector: '0xf3fef3a3', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"}] }
  }
} as const
