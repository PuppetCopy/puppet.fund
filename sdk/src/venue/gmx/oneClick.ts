import { type Address, encodeAbiParameters, getAddress, type Hex, hashTypedData, keccak256, type PublicClient, parseAbi, zeroHash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import {
  GMX_ONE_CLICK_EXPIRY_SEC,
  GMX_ONE_CLICK_MAX_COUNT,
  GMX_RELAY_DOMAIN_NAME,
  GMX_SUBACCOUNT_APPROVAL_TYPES,
  GMX_SUBACCOUNT_ORDER_ACTION,
  GMX_SUBACCOUNT_RELAY_ROUTER,
  GMX_V2_CHAIN_ID
} from './contracts.js'

const CLOCK_SKEW_SEC = 600n
const NONCE_ABI = parseAbi(['function subaccountApprovalNonces(address) view returns (uint256)'])
const SUBACCOUNT_LIST = keccak256(encodeAbiParameters([{ type: 'string' }], ['SUBACCOUNT_LIST']))

export const gmxOneClickDomain = { name: GMX_RELAY_DOMAIN_NAME, version: '1', chainId: GMX_V2_CHAIN_ID, verifyingContract: GMX_SUBACCOUNT_RELAY_ROUTER } as const

export async function resolveGmxOneClickApproval(client: PublicClient, account: Address, digest: Hex, oneClickSignature: Hex | null, nowSec: bigint) {
  const [nonce, registered] = await Promise.all([
    client.readContract({ address: GMX_SUBACCOUNT_RELAY_ROUTER, abi: NONCE_ABI, functionName: 'subaccountApprovalNonces', args: [account] }),
    client.readContract({
      address: GMX_V2_CONTRACT_MAP.GmxDatastore.address,
      abi: GMX_V2_CONTRACT_MAP.GmxDatastore.abi,
      functionName: 'getAddressValuesAt',
      args: [keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [SUBACCOUNT_LIST, account])), 0n, 16n]
    })
  ])
  const subaccounts = [...new Set([...(oneClickSignature === null ? [] : [privateKeyToAccount(keccak256(oneClickSignature)).address]), ...registered].map(a => getAddress(a)))]
  for (const subaccount of subaccounts) {
    for (const shouldAdd of [true, false]) {
      for (let at = nowSec - CLOCK_SKEW_SEC; at <= nowSec + CLOCK_SKEW_SEC; at++) {
        const expiresAt = at + GMX_ONE_CLICK_EXPIRY_SEC
        const typedData = {
          domain: gmxOneClickDomain,
          types: GMX_SUBACCOUNT_APPROVAL_TYPES,
          primaryType: 'SubaccountApproval',
          message: {
            subaccount,
            shouldAdd,
            expiresAt,
            maxAllowedCount: GMX_ONE_CLICK_MAX_COUNT,
            actionType: GMX_SUBACCOUNT_ORDER_ACTION,
            nonce,
            desChainId: BigInt(GMX_V2_CHAIN_ID),
            deadline: expiresAt,
            integrationId: zeroHash
          }
        } as const
        if (hashTypedData(typedData) === digest) return typedData
      }
    }
  }
  return null
}
