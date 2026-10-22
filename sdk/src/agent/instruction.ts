import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import { CHAIN_ID_LIST, chainNameOf } from '../const/index.js'
import { getTokenDescription } from '../core/index.js'
import { VENUES } from '../venue/index.js'
import { linkProof } from './link.js'

export interface IAgentPairing {
  port: number
  secret: string
  account: Address
}

const CHECK_NONCE = '0'.repeat(64)

export function agentConnection(port: number, secret: string, account: Address): string {
  return [
    '## Connect to Puppet (keep this section unchanged)',
    '',
    'You operate the owner’s Puppet fund through the Puppet app open in the owner’s browser. The app holds every key of the fund and screens, simulates and signs each request as it would the owner’s own. The owner sees every request and can remove you.',
    '',
    `- Address: ws://127.0.0.1:${port}. You listen; the app connects to you.`,
    `- Link secret: ${secret}. It is your identity: use it only for the proofs below and keep this file private. Never print, log or send the secret.`,
    `- Fund: ${account}.`,
    '',
    'Build the link in four levels and pass each check before the next. Frames are JSON text messages; hex is lowercase.',
    '',
    'Level 1: listen',
    `- Run a WebSocket server on 127.0.0.1 port ${port}. Accept one connection at a time and close any second one. Keep listening after every close: the app connects on its own while the owner’s wallet page is open, and again after any restart of either side.`,
    `- Check: a WebSocket client connects to ws://127.0.0.1:${port}.`,
    '',
    'Level 2: prove the link',
    '1. When the app connects, send {"type":"challenge","nonce":N}, where N is 32 random bytes as hex.',
    '2. The app sends {"type":"prove","proof":P,"nonce":M}, where M is its own 32 random bytes as hex. Close the connection unless P = hex(HMAC-SHA256(key: the secret as UTF-8 text, message: "puppet-app:" + N)), or when no such frame arrives within 10 seconds.',
    '3. Send {"type":"prove","proof":hex(HMAC-SHA256(key: the secret as UTF-8 text, message: "puppet-agent:" + M))}.',
    `- Check, with Z = ${CHECK_NONCE} (64 zeros): HMAC-SHA256(secret, "puppet-app:" + Z) = ${linkProof(secret, 'app', CHECK_NONCE)}, and HMAC-SHA256(secret, "puppet-agent:" + Z) = ${linkProof(secret, 'agent', CHECK_NONCE)}.`,
    '',
    'Level 3: wait for linked',
    '- After your proof, wait as long as it takes (the owner may first sign a session) for {"type":"linked","user":"0x…","account":"0x…","manual":"…"}: the owner’s wallet, the fund, and the manual of every request, reply and rule. Send nothing before it. Save the manual to MANUAL.md beside this file and read it before your first request: it is the reference for every request.',
    '- Check: account is the fund above; otherwise close the connection.',
    '',
    'Level 4: send requests',
    '- Send {"type":"request","id":n,"kind":…} with the fields the manual gives for that kind, one at a time. Each request gets exactly one reply with the same id; wait for it before sending the next.',
    '- A request whose connection closes before its reply may still land within about 5 minutes; do not resend it before then.',
    '- Check: each reply carries your id and a type of done, signed, submitted or failed.'
  ].join('\n')
}

export function agentManual(): string {
  const chainLabel = (id: number): string => {
    const name = chainNameOf(id)
    return name === undefined ? String(id) : `${name} (${id})`
  }
  const chains = CHAIN_ID_LIST.map(id => (id === HUB_CHAIN_ID ? `${chainLabel(id)}, the hub` : chainLabel(id))).join(', ')
  const venues = VENUES.map(venue => {
    const contracts = [...new Set(venue.contracts.map(contract => contract.chainId))].map(
      chainId =>
        `${chainLabel(chainId)}: ${venue.contracts
          .filter(contract => contract.chainId === chainId)
          .map(contract => `${contract.name} ${contract.address}${contract.standing === true ? ' (standing allowance)' : ''}`)
          .join(', ')}`
    )
    const payout = venue.withdraw === undefined ? null : { ...getTokenDescription(venue.withdraw.chainId, venue.withdraw.token), token: venue.withdraw.token, chainId: venue.withdraw.chainId }
    const deposit = venue.deposit === undefined ? null : { ...getTokenDescription(venue.deposit.chainId, venue.deposit.token), token: venue.deposit.token, chainId: venue.deposit.chainId, min: venue.deposit.min }
    return [
      `- ${venue.name}. ${contracts.length === 0 ? 'No operate contracts.' : `${contracts.join('; ')}.`}`,
      ...(deposit === null ? [] : [`Its deposit takes ${deposit.symbol} ${deposit.token} on ${chainLabel(deposit.chainId)}, at least ${deposit.min} in its smallest unit (${deposit.decimals} decimals); a smaller one is refused.`]),
      ...(payout === null ? [] : [`venueWithdraw "${venue.venueId}" pays ${payout.symbol} ${payout.token} on ${chainLabel(payout.chainId)}; amount in its smallest unit (${payout.decimals} decimals).`]),
      ...(venue.typedData === undefined ? [] : ['sign admits its screened messages.']),
      ...(venue.intents === undefined
        ? []
        : [
            `venueIntent "${venue.venueId}": ${venue.intents.list
              .map(
                action =>
                  `${action.intent} (${action.label}) {${action.inputs
                    .map(input =>
                      input.kind === 'choice'
                        ? `${input.name}: ${input.options.map(option => `"${option.value}" ${option.label}`).join(' or ')}`
                        : input.kind === 'side'
                          ? `${input.name}: "long" or "short"`
                          : input.kind === 'amount'
                            ? `${input.name}: ${input.symbol} in its smallest unit (${input.decimals} decimals), at least ${input.min}`
                            : input.kind === 'leverage'
                              ? `${input.name}: 1 to ${input.max}`
                              : `${input.name}: the venue’s position id`
                    )
                    .join('; ')}}`
              )
              .join('; ')}.`
          ])
    ].join(' ')
  })
  return [
    'Requests (one at a time: send one, wait for its reply, then send the next; id is any number, echoed in the reply)',
    '- operate: {"type":"request","id":1,"kind":"operate","chainId":42161,"calls":[{"to":"0x…","data":"0x…","value":"0x0"}]}. Standard wallet transaction calls; "gas" is optional. Encode them as the venue’s app or SDK would, with the fund as the wallet and as every recipient or receiver, except a venue’s deposit, which pays the venue. The calls run in order in one transaction, all or none, for one relay fee, so put a whole trade in one request with its approvals and any stop order. "value" spends the fund’s native ETH on that chain.',
    '- Approve tokens on chain inside the operate request that spends them, not with signed permits. After the request the app resets approvals to zero, and caps them on contracts marked "standing allowance". On Uniswap, approve Permit2 on the token, then call Permit2’s approve for the router.',
    '- sign: {"type":"request","id":2,"kind":"sign","typedData":{"domain":{…},"types":{…},"primaryType":"…","message":{…}}}. EIP-712 typed data as for eth_signTypedData_v4, without EIP712Domain in types. The app signs as the fund only where a venue below admits it, such as a Polymarket order, a Hyperliquid ApproveAgent for a key the agent generates, or a venue withdrawal back to the fund. Submit the returned signature to the venue yourself.',
    '- venueWithdraw: {"type":"request","id":3,"kind":"venueWithdraw","venue":"…","amount":"…"}. Moves money from the fund’s account at that venue back to the fund, in the payout token listed below. The venue may charge a withdrawal fee.',
    '- venueIntent: {"type":"request","id":7,"kind":"venueIntent","venue":"…","intent":"…","params":{…}}. Runs one of a venue’s own actions listed below, which the app builds and signs for the fund, running the venue’s setup first when it is needed. Every param is a string.',
    `- allocate: {"type":"request","id":4,"kind":"allocate","chainId":${HUB_CHAIN_ID},"token":"${HUB_CANONICAL_TOKEN.WETH}","amount":"0"}. chainId: the chain whose escrow the round credits, any chain the fund runs on; off ${chainNameOf(HUB_CHAIN_ID)} the app releases that chain’s escrow before the round, in the same request. amount: the owner’s own capital to credit, in the token’s smallest unit, as a decimal string; "0" runs a round for puppets only.`,
    `- redeem: {"type":"request","id":5,"kind":"redeem","fill":"all","token":"${HUB_CANONICAL_TOKEN.WETH}"}. Pays every queued exit at once, at one price. fill: "all". token: the ${chainNameOf(HUB_CHAIN_ID)} payout token, WETH, USDC or USDT.`,
    `- retire: {"type":"request","id":6,"kind":"retire","shares":"1000000000000000000","token":"${HUB_CANONICAL_TOKEN.WETH}"}. Pays out that many of the owner’s shares (a decimal string, at most the owner’s balance) and the same fraction of every other stake, on ${chainNameOf(HUB_CHAIN_ID)} in token, the owner’s part to the owner’s Puppet account. The exit queue is paid first. The fraction is in basis points, rounded down, so the whole balance pays every stake in full.`,
    '',
    'Venues (every operate call targets or approves one of these contracts, or makes the venue’s deposit)',
    ...venues,
    '',
    'Replies',
    '- {"type":"done","id":1,"chainId":42161,"block":"…","txHash":"0x…","fees":[{"chainId":42161,"token":"0x…","amount":"…"}]}: settled on chain. chainId, block and txHash name the last transaction; fees lists each transaction’s relay fee in the token that paid it.',
    '- {"type":"signed","id":2,"signature":"0x…"} answers sign.',
    '- {"type":"submitted","id":3} answers venueWithdraw and venueIntent: the venue confirmed it, and money it moves arrives on the venue’s schedule.',
    '- {"type":"failed","id":1,"code":"…","detail":"…"}: refused or failed, with the reason in detail. A contract refusal uses the contract’s error name as code.',
    '- These may still land within about 5 minutes, so do not resend before then and leave deadlines and quotes that margin: DISPATCH_TIMEOUT, RELAY_UNREACHABLE, BAD_ACK, a REQUEST_FAILED whose detail says it was dispatched, and a connection that closes before the reply. After that, check the fund’s records before resending: a request that landed and is sent again runs twice.',
    '- BUSY: another request is running; send the next after its reply.',
    '- SESSION_EXPIRED: the app’s signing session lapsed, and nothing was sent; the owner signs a session in the app. SESSION_KEY_LOST: the browser lost the session’s key, and nothing was sent; the owner signs a session in the app. CHAIN_SESSION_MISSING: the owner makes one trade on that chain in the app. FUND_KEY_MISSING: the browser lost the fund’s key; the owner signs a session in the app, which restores it. After the app restarts it connects again only once the owner opens the fund’s wallet page; until then requests fail as not linked. A session revoked from another device is refused without a reply code: the request fails after its deadline with nothing sent.',
    '- operate, allocate, redeem and retire are simulated from the fund before signing; one that would revert fails with the reason and pays no fee.',
    '',
    'Rules',
    '- Calls reach only the venues above, for the fund; signatures cover only what the venues admit; withdrawals return only to the fund; exits pay only queued puppets and, through retire, the owner. No request can send money to an address the agent chooses.',
    '- A venue trading key the fund approves through sign, such as a Hyperliquid API wallet, trades on that venue directly. Venues admit only keys that cannot withdraw or transfer.',
    `- Chains: ${chains}.`,
    '- Facts are the fund’s own records: balances on each chain, what each call sent into each venue, transits, standing allowances and the exit queue. Positions and PnL are evaluations. The app answers no reads: read balances from each chain and positions from each venue, for the fund address. It only runs requests, and re-reads and simulates each one at submit.',
    '- Requests run only while the app is open on the fund’s wallet page, and each takes seconds to co-sign and relay. Fast strategies do not fit. While the app is closed requests fail, so only a stop order resting at the venue protects a position: place it in the entry’s request, or with a venue trading key the fund approved through sign.',
    '- The fund counts value in ETH; WETH is its neutral position.'
  ].join('\n')
}

export function pairingFromInstruction(text: string): IAgentPairing {
  const port = text.match(/ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]
  const secret = text.match(/Link secret: ([^\s.]+)\./)?.[1]
  const account = text.match(/Fund: (0x[0-9a-fA-F]{40})/)?.[1]
  if (port === undefined || secret === undefined || account === undefined) {
    throw new Error('the text is not an agent template from /wallet/agent, which names the port, the link secret and the fund')
  }
  return { port: Number(port), secret, account: getAddress(account) }
}
