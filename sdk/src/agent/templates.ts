import { AGENT_LINK_ENV, agentConnection } from './instruction.js'

export interface IAgentTemplateContext {
  instructions: string
}

export type IAgentFile = { path: string; content: string }

const BUN_AGENT = [
  "import { createHmac, randomBytes } from 'node:crypto'",
  "import { appendFileSync, existsSync, writeFileSync } from 'node:fs'",
  '',
  `const link = Bun.env.${AGENT_LINK_ENV}`,
  `if (link === undefined || link === '') throw new Error('no ${AGENT_LINK_ENV}: paste the line from Sessions, New agent in your Puppet wallet into .env, quotes included, then run bun agent.ts in this folder')`,
  'const url = new URL(link.trim())',
  'const port = Number(url.port)',
  'const fund = url.pathname.slice(1).toLowerCase()',
  'const secret = url.hash.slice(1)',
  `if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port <= 0 || !/^0x[0-9a-f]{40}$/.test(fund) || !/^[0-9a-f]+$/.test(secret)) throw new Error('${AGENT_LINK_ENV} is not ws://127.0.0.1:<port>/<fund>#<secret>; copy the line again from Sessions, New agent in your Puppet wallet, with its double quotes: unquoted, a .env file reads the # as a comment and drops the secret')`,
  '',
  'const DIR = import.meta.dir',
  'const STEP_MS = 60 * 60 * 1000',
  'const REPLY_MS = 10 * 60 * 1000',
  '',
  "type Reply = { type: 'done' | 'signed' | 'submitted' | 'failed'; id: number; [field: string]: unknown }",
  "type Link = { nonce: string; phase: 'challenge' | 'proven' | 'linked' }",
  '',
  "const proof = (side: 'app' | 'agent', nonce: string) => createHmac('sha256', secret).update(`puppet-${side}:${nonce}`).digest('hex')",
  'const journal = (entry: object) => {',
  '  const line = JSON.stringify({ at: new Date().toISOString(), ...entry })',
  '  appendFileSync(`${DIR}/journal.jsonl`, `${line}\\n`)',
  '  console.log(line)',
  '}',
  '',
  'let socket: Bun.ServerWebSocket<Link> | null = null',
  'let nextId = Date.now()',
  'const pending = new Map<number, (reply: Reply) => void>()',
  '',
  'Bun.serve<Link>({',
  "  hostname: '127.0.0.1',",
  '  port,',
  "  fetch: (req, server) => (server.upgrade(req, { data: { nonce: randomBytes(32).toString('hex'), phase: 'challenge' } }) ? undefined : new Response('a Puppet agent link', { status: 426 })),",
  '  websocket: {',
  '    open(ws) {',
  "      if (socket !== null) return ws.close(4001, 'one connection at a time')",
  '      socket = ws',
  "      ws.send(JSON.stringify({ type: 'challenge', nonce: ws.data.nonce }))",
  "      setTimeout(() => ws.data.phase === 'challenge' && ws.close(4000, 'no proof within 10 seconds'), 10_000)",
  '    },',
  '    message(ws, raw) {',
  '      const frame = JSON.parse(String(raw))',
  "      if (ws.data.phase === 'challenge') {",
  "        if (frame.type !== 'prove' || frame.proof !== proof('app', ws.data.nonce)) return ws.close(4003, 'bad proof')",
  "        ws.data.phase = 'proven'",
  "        ws.send(JSON.stringify({ type: 'prove', proof: proof('agent', frame.nonce) }))",
  '        return',
  '      }',
  "      if (ws.data.phase === 'proven') {",
  "        if (frame.type !== 'linked') return",
  "        if (String(frame.account).toLowerCase() !== fund) return ws.close(4004, 'linked to another fund')",
  "        ws.data.phase = 'linked'",
  '        writeFileSync(`${DIR}/MANUAL.md`, frame.manual)',
  '        return journal({ linked: frame.account })',
  '      }',
  '      const settle = pending.get(frame.id)',
  '      if (settle === undefined) return journal({ id: frame.id, late: frame })',
  '      pending.delete(frame.id)',
  '      settle(frame)',
  '    },',
  '    close(ws, code, reason) {',
  '      if (socket !== ws) return',
  "      if (ws.data.phase === 'linked') journal({ unlinked: code, reason })",
  '      socket = null',
  "      for (const [id, settle] of pending) settle({ type: 'failed', id, code: 'LINK_CLOSED', detail: 'the link closed before the reply; it may still land within about 5 minutes, so do not resend it before then' })",
  '      pending.clear()',
  '    }',
  '  }',
  '})',
  '',
  'const request = async (frame: Record<string, unknown>): Promise<Reply> => {',
  '  const open = socket',
  "  if (open === null || open.data.phase !== 'linked') {",
  "    const reply: Reply = { type: 'failed', id: 0, code: 'NOT_LINKED', detail: 'the app is not linked; it links again once the owner opens their wallet' }",
  '    journal({ request: frame, reply })',
  '    return reply',
  '  }',
  '  const id = nextId++',
  '  journal({ id, request: frame })',
  '  const reply = await new Promise<Reply>(resolve => {',
  '    pending.set(id, resolve)',
  "    setTimeout(() => pending.delete(id) && resolve({ type: 'failed', id, code: 'NO_REPLY', detail: 'no reply within 10 minutes; it may still land, so check the venue before sending it again' }), REPLY_MS)",
  "    open.send(JSON.stringify({ ...frame, type: 'request', id }))",
  '  })',
  '  journal({ id, reply })',
  '  return reply',
  '}',
  '',
  'let due = 0',
  'let busy = false',
  'setInterval(async () => {',
  "  if (busy || socket?.data.phase !== 'linked' || Date.now() < due || !existsSync(`${DIR}/strategy.ts`)) return",
  '  busy = true',
  '  due = Date.now() + STEP_MS',
  '  try {',
  '    const { step } = await import(`${DIR}/strategy.ts?at=${Date.now()}`)',
  '    journal({ step: await step(request) })',
  '  } catch (err) {',
  '    journal({ error: err instanceof Error ? err.message : String(err) })',
  '  } finally {',
  '    busy = false',
  '  }',
  '}, 10_000)',
  '',
  'console.log(`waiting for the Puppet app on ws://127.0.0.1:${port}`)',
  "if (!existsSync(`${DIR}/strategy.ts`)) console.log('no strategy.ts yet: write it with your coding agent from AGENTS.md and MANUAL.md, which the first link writes')",
  ''
].join('\n')

const SYSTEM1_ROLE = [
  '# System 1',
  '',
  'agent.ts and strategy.ts are System 1. agent.ts keeps the link to the Puppet app, runs strategy.ts every hour while linked, and journals in journal.jsonl each request when it is sent and its reply when it arrives under the same id, and each step. The owner and their coding agent read the journal together and decide how to improve System 1.',
  '',
  '## How to work',
  '- Read MANUAL.md, journal.jsonl, lessons.md and strategy.ts first. Never read or print .env: it holds the link secret.',
  '- With no strategy.ts yet, write it from the instructions above and MANUAL.md (every request, reply and rule), which the first link writes.',
  '- Agree each change to strategy.ts with the owner before writing it, and change it only when the journal supports the change.',
  '- After each change, append one lesson to lessons.md as `- <ISO time>: <what happened and what it changes>`.',
  '',
  '## strategy.ts',
  '- It exports `async function step(request)`, called every hour while linked. `request(frame)` sends one request from MANUAL.md and resolves with its reply; a failed reply has a code and a detail. Return null when all is well, or a short concern, which agent.ts journals.',
  '- Keep every limit in the instructions above in code.',
  '- Import packages by name and Bun installs them on first use, such as @noble/curves and @noble/hashes to sign with a venue trading key.',
  '- Read prices and positions from the venues and balances from each chain, for the fund’s address; journal.jsonl holds only this agent’s requests and replies.',
  '- A request answered LINK_CLOSED or NO_REPLY may still land, and a reply that comes later is journaled as late under its id; check the venue before sending it again.',
  ''
].join('\n')

export const AGENT_TEMPLATES = [
  {
    id: 'instruction',
    name: 'Instruction',
    detail: 'One AGENTS.md, the open standard coding agents read; your agent builds the link from its four levels. Claude Code reads it unless a CLAUDE.md sits above it; then add @AGENTS.md to that CLAUDE.md',
    files: (context: IAgentTemplateContext): IAgentFile[] => [{ path: 'AGENTS.md', content: `${context.instructions.trim()}\n\n${agentConnection()}\n` }]
  },
  {
    id: 'claude-skill',
    name: 'Agent skill',
    detail: 'An Agent Skills folder (the open SKILL.md format); put it in your agent’s skills folder, such as .claude/skills for Claude Code',
    files: (context: IAgentTemplateContext): IAgentFile[] => [
      {
        path: 'puppet-fund/SKILL.md',
        content: [
          '---',
          'name: puppet-fund',
          `description: ${JSON.stringify('Operate the owner’s Puppet fund through the Puppet app over a local link. Use it to swap, trade on the fund’s venues, sign venue orders, withdraw from venues or run the fund’s rounds.')}`,
          '---',
          '',
          context.instructions.trim(),
          '',
          '## Run the link',
          `Write the link below as a small program in this skill’s folder and keep it running in the background, so requests and replies pass while you work. Keep ${AGENT_LINK_ENV} in a .env file beside it, never in your replies.`,
          '',
          agentConnection(),
          ''
        ].join('\n')
      }
    ]
  },
  {
    id: 'bun-agent',
    name: 'Bun agent',
    detail: `A Bun program keeps the link and runs strategy.ts every hour; you and your coding agent write and improve the strategy from its journal. Paste your agent’s ${AGENT_LINK_ENV} line into its .env; then, in its folder, run bun install once for editor types, then bun agent.ts`,
    files: (context: IAgentTemplateContext): IAgentFile[] => [
      { path: 'puppet-agent/AGENTS.md', content: `${context.instructions.trim()}\n\n${SYSTEM1_ROLE}` },
      { path: 'puppet-agent/agent.ts', content: BUN_AGENT },
      { path: 'puppet-agent/.env', content: '# Paste the line from Sessions, New agent in your Puppet wallet below, quotes included: unquoted, the # before its secret starts a comment\n' },
      { path: 'puppet-agent/package.json', content: `${JSON.stringify({ private: true, devDependencies: { '@types/bun': 'latest' } }, null, 2)}\n` },
      {
        path: 'puppet-agent/tsconfig.json',
        content: `${JSON.stringify({ compilerOptions: { lib: ['ESNext'], target: 'ESNext', module: 'Preserve', moduleResolution: 'bundler', types: ['bun'], strict: true, noEmit: true, skipLibCheck: true } }, null, 2)}\n`
      },
      { path: 'puppet-agent/bunfig.toml', content: '[install]\nauto = "fallback"\n' }
    ]
  }
] as const

export type IAgentTemplateId = (typeof AGENT_TEMPLATES)[number]['id']
