import { AGENT_HANDSHAKE_MS, AGENT_NONCE, type IAgentReply, type IAppFrame, linkProof, randomHex, sameHex } from '@puppet/sdk/agent'
import { disposeNone, disposeWith, type IStream, nullSink, tap } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'

export type IAgentEvent =
  | { kind: 'proven' }
  | { kind: 'request'; id: number; frame: Record<string, unknown> }
  | { kind: 'busy'; frame: Record<string, unknown>; reply: IAgentReply }
  | { kind: 'closed'; code: number; reason: string; phase: 'challenge' | 'prove' | 'granting' | 'linked' | null }

export const agentSocket = (port: number, secret: string, outbound: IStream<IAppFrame>): IStream<IAgentEvent> =>
  stream<IAgentEvent>((sink, scheduler) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    const listening = new AbortController()
    const appNonce = randomHex(32)
    let phase: Extract<IAgentEvent, { kind: 'closed' }>['phase'] = null
    let running: number | null = null
    let sending: Disposable = disposeNone
    let handling: Promise<void> = Promise.resolve()
    const emit = (event: IAgentEvent) => sink.event(scheduler.time(), event)
    const refuse = (reason: string) => {
      let fitted = reason
      while (new TextEncoder().encode(fitted).length > 123) fitted = fitted.slice(0, -1)
      socket.close(4002, fitted)
    }
    const handshake = setTimeout(() => refuse('the agent did not finish the handshake within 10 seconds'), AGENT_HANDSHAKE_MS)

    const handle = async (raw: string): Promise<void> => {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return refuse('the agent sent a frame that is not a JSON object')
      const frame: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
      if (phase === 'challenge') {
        if (frame.type !== 'challenge' || typeof frame.nonce !== 'string' || !AGENT_NONCE.test(frame.nonce)) {
          return refuse('the agent must open with a challenge carrying a hex nonce')
        }
        phase = 'prove'
        socket.send(JSON.stringify({ type: 'prove', proof: linkProof(secret, 'app', frame.nonce), nonce: appNonce }))
        return
      }
      if (phase === 'prove') {
        if (frame.type !== 'prove' || typeof frame.proof !== 'string' || !sameHex(frame.proof, linkProof(secret, 'agent', appNonce))) {
          return refuse('the agent does not hold this link’s secret')
        }
        clearTimeout(handshake)
        phase = 'granting'
        emit({ kind: 'proven' })
        return
      }
      if (phase === 'granting') return refuse('the agent sent a frame before linked')
      if (frame.type !== 'request' || typeof frame.id !== 'number') return refuse('a linked agent sends only requests with a numeric id')
      if (running !== null) {
        const reply: IAgentReply = { type: 'failed', id: frame.id, code: 'BUSY', detail: `request ${running} is still running; send the next one after its reply` }
        socket.send(JSON.stringify(reply))
        emit({ kind: 'busy', frame, reply })
        return
      }
      running = frame.id
      emit({ kind: 'request', id: frame.id, frame })
    }

    socket.addEventListener(
      'open',
      () => {
        phase = 'challenge'
        sending = tap((frame: IAppFrame) => {
          if (frame.type === 'close') return socket.close(4000, frame.reason.slice(0, 120))
          if (frame.type === 'linked') phase = 'linked'
          else if (frame.id === running) running = null
          socket.send(JSON.stringify(frame))
        }, outbound).run(nullSink, scheduler)
      },
      { signal: listening.signal }
    )
    socket.addEventListener(
      'message',
      event => {
        handling = handling
          .then(() => handle(String(event.data)))
          .catch((err: unknown) => refuse(`the app could not read the agent: ${err instanceof Error ? err.message : String(err)}`))
      },
      { signal: listening.signal }
    )
    socket.addEventListener(
      'close',
      event => {
        clearTimeout(handshake)
        sending[Symbol.dispose]()
        emit({ kind: 'closed', code: event.code, reason: event.reason, phase })
        sink.end(scheduler.time())
      },
      { signal: listening.signal }
    )
    return disposeWith(() => {
      clearTimeout(handshake)
      listening.abort()
      sending[Symbol.dispose]()
      socket.close(1000)
    })
  })
