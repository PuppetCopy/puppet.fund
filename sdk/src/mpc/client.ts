import { randomBytes } from '@noble/hashes/utils.js'
import { type Hex, hexToBytes, keccak256, toHex } from 'viem'
import { publicKeyToAddress } from 'viem/utils'
import { type IBodySignRequest, requestDigest } from '../account/createAccount.js'
import { decode, encode } from '../compact/frame.js'
import { type IKeygenReveal, type IShare, keygenAlice1, keygenAlice2 } from './keygen.js'
import { type IPresignMessage2, type IPresignMessage4, presignAlice1, presignAlice2, presignAlice3 } from './presign.js'
import { signAlice } from './sign.js'

export interface IFundedClaim {
  chainId: number
  token: Address
  user: Address
  signer: Address
  expiry: bigint
  session: Hex
  request: Hex
}

export interface IMpcClient {
  keygen(sid: Hex, sk: bigint, funded: IFundedClaim): Promise<IShare>
  sign(share: IShare, request: IBodySignRequest, funded: IFundedClaim): Promise<Hex>
}

export const randomSid = (): Hex => keccak256(toHex(randomBytes(32)))

export function createMpcClient(mpcUrl: string): IMpcClient {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${mpcUrl}${path}`, { method: 'POST', body: encode(body), headers: { 'content-type': 'application/json' } })
    const text = await res.text()
    if (!res.ok) throw new Error(`mpc service ${path} refused: ${text || res.status}`)
    return decode(text) as T
  }
  return {
    async keygen(sid, sk, funded) {
      const a1 = keygenAlice1(sid, sk)
      const reveal = await post<IKeygenReveal>('/mpc/keygen/1', { sid, funded, msg: a1.msg })
      const a2 = keygenAlice2(a1.state, reveal)
      const { account } = await post<{ account: Address }>('/mpc/keygen/2', { sid, msg: a2.msg })
      if (account.toLowerCase() !== publicKeyToAddress(a2.share.pk).toLowerCase()) {
        throw new Error(`the mpc service derived ${account} for a key this device derives as ${publicKeyToAddress(a2.share.pk)}`)
      }
      return a2.share
    },
    async sign(share, request, funded) {
      const ceremony = { ceremony: randomSid(), sid: share.sid, pk: share.pk }
      const a1 = presignAlice1(share)
      const m2 = await post<IPresignMessage2>('/mpc/sign/1', { ...ceremony, msg: a1.msg, funded })
      const a2 = presignAlice2(a1.state, m2)
      const m4 = await post<IPresignMessage4>('/mpc/sign/2', { ...ceremony, msg: a2.msg })
      const a3 = presignAlice3(a2.state, m4)
      const partial = signAlice(share, a3.presignature, hexToBytes(requestDigest(request)))
      const { signature } = await post<{ signature: Hex }>('/mpc/sign/3', { ...ceremony, msg: a3.msg, partial, request })
      return signature
    }
  }
}

type Address = `0x${string}`
