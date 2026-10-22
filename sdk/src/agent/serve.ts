import type { ServerWebSocket } from 'bun'
import { type Address, isAddressEqual } from 'viem'
import type { IAgentPairing } from './instruction.js'
import { AGENT_HANDSHAKE_MS, AGENT_NONCE, type IAgentReply, linkProof, randomHex, sameHex } from './link.js'

type ILinkSocket = ServerWebSocket<{ nonce: string; phase: 'challenge' | 'proven' | 'linked' }>

export type IAgentAnswer = Exclude<IAgentReply, { type: 'failed' }>

export async function serveAgentLink<T>(
  pairing: IAgentPairing,
  work: (request: (frame: Record<string, unknown>) => Promise<IAgentAnswer>, manual: string) => Promise<T>
): Promise<T> {
  const pending = new Map<number, { resolve: (reply: IAgentAnswer) => void; reject: (err: Error) => void }>()
  let socket: ILinkSocket | null = null
  let handling: Promise<void> = Promise.resolve()
  let nextId = 1
  let settle: { resolve: (manual: string) => void; reject: (err: Error) => void } | null = null
  const linked = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
  })

  const read = async (ws: ILinkSocket, frame: Record<string, unknown>): Promise<void> => {
    if (ws.data.phase === 'challenge') {
      if (frame.type !== 'prove' || typeof frame.proof !== 'string' || typeof frame.nonce !== 'string' || !AGENT_NONCE.test(frame.nonce) || !sameHex(frame.proof, linkProof(pairing.secret, 'app', ws.data.nonce))) {
        ws.close(4003, 'the app did not prove the link secret')
        return
      }
      ws.data.phase = 'proven'
      ws.send(JSON.stringify({ type: 'prove', proof: linkProof(pairing.secret, 'agent', frame.nonce) }))
      return
    }
    if (ws.data.phase === 'proven') {
      if (frame.type !== 'linked' || typeof frame.account !== 'string') return
      if (typeof frame.manual !== 'string') {
        settle?.reject(new Error('the app linked without a manual; open the app again so it runs its latest release'))
        ws.close(4005, 'linked without a manual')
        return
      }
      if (!isAddressEqual(frame.account as Address, pairing.account)) {
        settle?.reject(new Error(`the app linked fund ${frame.account}, not the paired fund ${pairing.account}; pair again`))
        ws.close(4004, 'linked to another fund')
        return
      }
      ws.data.phase = 'linked'
      settle?.resolve(frame.manual)
      return
    }
    const waiter = typeof frame.id === 'number' ? pending.get(frame.id) : undefined
    if (waiter === undefined) return
    pending.delete(frame.id as number)
    if (frame.type === 'failed') waiter.reject(new Error(`the app refused request ${frame.id}: ${String(frame.code)}: ${String(frame.detail)}`))
    else waiter.resolve(frame as IAgentAnswer)
  }

  const server = Bun.serve<{ nonce: string; phase: 'challenge' | 'proven' | 'linked' }>({
    hostname: '127.0.0.1',
    port: pairing.port,
    fetch(req, srv) {
      return srv.upgrade(req, { data: { nonce: randomHex(32), phase: 'challenge' } }) ? undefined : new Response('a Puppet agent link: connect with a WebSocket', { status: 426 })
    },
    websocket: {
      open(ws) {
        if (socket !== null) {
          ws.close(4001, 'another app connection is open')
          return
        }
        socket = ws
        setTimeout(() => {
          if (ws.data.phase === 'challenge') ws.close(4000, 'the app did not prove the link secret within 10 seconds')
        }, AGENT_HANDSHAKE_MS)
        ws.send(JSON.stringify({ type: 'challenge', nonce: ws.data.nonce }))
      },
      message(ws, raw) {
        handling = handling
          .then(() => read(ws, JSON.parse(String(raw)) as Record<string, unknown>))
          .catch((err: unknown) => ws.close(4002, `the agent could not read the app: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120)))
      },
      close(ws, code, reason) {
        if (socket !== ws) return
        socket = null
        if (ws.data.phase !== 'linked') return
        for (const waiter of pending.values()) {
          waiter.reject(new Error(`the app closed the link (${code}${reason === '' ? '' : `: ${reason}`}) before replying; the request may still land within about 5 minutes, so do not resend it before then`))
        }
        pending.clear()
      }
    }
  })

  try {
    const manual = await linked
    return await work(
      frame =>
        new Promise((resolve, reject) => {
          if (socket === null || socket.data.phase !== 'linked') {
            reject(new Error('the app is not linked; it links again once the owner opens the fund’s wallet page'))
            return
          }
          const id = nextId++
          pending.set(id, { resolve, reject })
          socket.send(JSON.stringify({ ...frame, type: 'request', id }))
        }),
      manual
    )
  } finally {
    const open = socket as ILinkSocket | null
    if (open !== null) open.close(1000, 'the agent finished')
    server.stop()
  }
}
