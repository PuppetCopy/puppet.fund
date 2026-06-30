import { HUB_CHAIN_ID, PROTOCOL, TOKEN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS, { hub } from '@puppet/contracts/deployments'
import type { IAccountLib__AccountInitParams, IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import type { Address, Hex } from 'viem'
import { encodeAbiParameters, encodePacked, getCreate2Address, hashMessage, keccak256, pad, toBytes } from 'viem'

const ATTEST = DEPLOYMENTS[`Attest:${HUB_CHAIN_ID}`].address
const ACCOUNT = DEPLOYMENTS[`Account:${HUB_CHAIN_ID}`].address
const PUPPET_ACCOUNT = DEPLOYMENTS[`PuppetAccount:${HUB_CHAIN_ID}`].address
const ROUTE = DEPLOYMENTS[`Route:${HUB_CHAIN_ID}`].address
const FUND_ACCOUNT = DEPLOYMENTS[`FundAccount:${HUB_CHAIN_ID}`].address
const ISSUE = hub.Issue.address
const SHARE_TOKEN = hub.ShareToken.address

function cloneInitCodeHashWithArgs(impl: Address, args: Hex): Hex {
  const argBytes = (args.length - 2) / 2
  const runSize = 0x2d + argBytes
  if (runSize > 0xffff) throw new Error(`args too long: ${argBytes}`)
  const runSizeHex = runSize.toString(16).padStart(4, '0')
  const creation = `0x61${runSizeHex}3d81600a3d39f3` as Hex
  const runtimeHead = '0x363d3d373d3d3d363d73' as Hex
  const runtimeTail = '0x5af43d82803e903d91602b57fd5bf3' as Hex
  return keccak256(
    encodePacked(['bytes', 'bytes', 'address', 'bytes', 'bytes'], [creation, runtimeHead, impl, runtimeTail, args])
  )
}

function packAccountArgs(params: IAccountLib__AccountInitParams): Hex {
  return encodePacked(['address', 'address', 'address'], [ATTEST, params.signer, params.user])
}

export function predictPuppetAccount(params: IAccountLib__AccountInitParams): Address {
  const args = packAccountArgs(params)
  return getCreate2Address({
    from: ACCOUNT,
    salt: keccak256(args),
    bytecodeHash: cloneInitCodeHashWithArgs(PUPPET_ACCOUNT, args)
  })
}

export function predictRoute(account: Address): Address {
  const args = encodePacked(['address'], [account])
  return getCreate2Address({
    from: ACCOUNT,
    salt: pad(account, { size: 32 }),
    bytecodeHash: cloneInitCodeHashWithArgs(ROUTE, args)
  })
}

export function predictDepositRoute(account: Address): Address {
  return predictRoute(account)
}

export function predictFundAccount(fundParams: IFundAccountLib__FundAccountInitParams): Address {
  const args = encodePacked(
    ['address', 'address', 'address', 'bytes32'],
    [ATTEST, fundParams.master, fundParams.baseToken, fundParams.name]
  )
  return getCreate2Address({
    from: ACCOUNT,
    salt: keccak256(args),
    bytecodeHash: cloneInitCodeHashWithArgs(FUND_ACCOUNT, args)
  })
}

export function predictShareToken(fundParams: IFundAccountLib__FundAccountInitParams): Address {
  const fund = predictFundAccount(fundParams)
  const args = encodePacked(
    ['address', 'address', 'address', 'bytes32'],
    [fund, ISSUE, fundParams.baseToken, fundParams.name]
  )
  return getCreate2Address({
    from: ISSUE,
    salt: pad(fund, { size: 32 }),
    bytecodeHash: cloneInitCodeHashWithArgs(SHARE_TOKEN, args)
  })
}

export const DEPLOY_AUTH_DIGEST: Hex = hashMessage(PROTOCOL.signerDerivationMessage)

export function deriveSessionKey(signature: Hex): Hex {
  return keccak256(toBytes(signature))
}

export function signerProofDigest(user: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }], [user]))
}

const SYMBOL_BY_TOKEN_ID: Record<string, keyof typeof TOKEN_ID> = Object.fromEntries(
  (Object.keys(TOKEN_ID) as (keyof typeof TOKEN_ID)[]).map(sym => [TOKEN_ID[sym].toLowerCase(), sym])
)

export function symbolForBaseTokenId(baseToken: Hex): keyof typeof TOKEN_ID | null {
  return SYMBOL_BY_TOKEN_ID[baseToken.toLowerCase()] ?? null
}
