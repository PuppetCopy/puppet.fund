export const CONTRACT_EVENT_MAP = {

} as const

export const accountCallEvent = {type:"event",name:"AccountCall",inputs:[{name:"account",type:"address",indexed:true,internalType:"address"},{name:"source",type:"address",indexed:true,internalType:"address"},{name:"digest",type:"bytes32",indexed:false,internalType:"bytes32"},{name:"modulePrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"accountPrevBlock",type:"uint256",indexed:false,internalType:"uint256"},{name:"blockTimestamp",type:"uint256",indexed:false,internalType:"uint256"},{name:"signature",type:"bytes",indexed:false,internalType:"bytes"},{name:"executionData",type:"bytes",indexed:false,internalType:"bytes"},{name:"callList",type:"tuple[]",indexed:false,internalType:"struct IAccount.Call[]",components:[{name:"target",type:"address",internalType:"address"},{name:"value",type:"uint256",internalType:"uint256"},{name:"gasLimit",type:"uint256",internalType:"uint256"},{name:"callData",type:"bytes",internalType:"bytes"}]},{name:"resultList",type:"bytes[]",indexed:false,internalType:"bytes[]"}],anonymous:false} as const

export const ACCOUNT_CALL_MAP = {
  AccountModule: {
    createAccount: { selector: '0x1bd2a04d', size: 96, args: [{type:"address",name:"user"},{type:"address",name:"signer"}] },
    forcedWithdrawal: { selector: '0xf7b0e76f', size: 128, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"address",name:"to"}] }
  },
  CoreGate: {
    deposit: { selector: '0x8340f549', size: 96, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"}] },
    operateMaster: { selector: '0x3c344ad3', size: null, args: [{type:"address[]",name:"creditList"},{type:"uint256[]",name:"amountList"},{type:"uint256",name:"cycle"},{type:"address",name:"token"},{type:"uint256",name:"value"},{type:"uint256",name:"collateral"},{type:"uint256",name:"skin"},{type:"uint256",name:"backed"}] },
    operatePuppet: { selector: '0x3c344ad3', size: 128, args: [{type:"address",name:"master"},{type:"uint256",name:"cycle"},{type:"uint256",name:"stake"}] },
    settleMaster: { selector: '0x8199f35c', size: 128, args: [{type:"uint256",name:"cycle"},{type:"address",name:"token"},{type:"uint256",name:"value"}] },
    settlePuppet: { selector: '0x8199f35c', size: 192, args: [{type:"address",name:"master"},{type:"uint256",name:"cycle"},{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"amount2"}] },
    withdraw: { selector: '0xd528ac5e', size: 192, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"inputToken"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputAmount"}] }
  },
  Deposit: {
    depositAcross: { selector: '0x8cf164fa', size: 192, args: [{type:"uint256",name:"destinationChainId"},{type:"address",name:"input"},{type:"uint256",name:"inputAmount"},{type:"address",name:"outputToken"},{type:"uint256",name:"outputFloor"}] },
    settleCredit: { selector: '0xa4a1728d', size: 192, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"expiry"},{type:"uint256",name:"fee"},{type:"uint256",name:"arrived"}] }
  },
  HubGate: {
    deposit: { selector: '0x20e8c565', size: 128, args: [{type:"address",name:"token"},{type:"uint256",name:"amount"},{type:"uint256",name:"bond"}] },
    drawMaster: { selector: '0x356faf5c', size: 128, args: [{type:"uint256",name:"spokeChainId"},{type:"uint256",name:"cycle"},{type:"uint256",name:"drawn"}] },
    drawPuppet: { selector: '0x356faf5c', size: 192, args: [{type:"address",name:"master"},{type:"uint256",name:"spokeChainId"},{type:"uint256",name:"cycle"},{type:"uint256",name:"amount"},{type:"uint256",name:"loss"}] },
    mandate: { selector: '0x35386618', size: null, args: [{type:"address[]",name:"creditList"},{type:"uint256[]",name:"amountList"},{type:"uint256",name:"bond"},{type:"tuple[]",name:"mandateList",components:[{type:"address",name:"master"},{type:"uint256",name:"skin"},{type:"uint256",name:"allocationRate"},{type:"uint256",name:"cooldownPeriod"},{type:"uint256",name:"expiry"},{type:"bytes32[]",name:"tokenIdList"}]},{type:"bytes[]",name:"signatureList"}] },
    unbond: { selector: '0xd6a467aa', size: 64, args: [{type:"uint256",name:"amount"}] }
  }
} as const
