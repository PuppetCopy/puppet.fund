import type { Address } from 'viem'
import { agentConnection } from './instruction.js'

export interface IAgentTemplateContext {
  name: string
  port: number
  secret: string
  account: Address
  instructions: string
}

export type IAgentFile = { path: string; content: string }

const bunAgent = (port: number, secret: string, account: Address): string => [
  "import { createHmac, randomBytes } from 'node:crypto'",
  "import { appendFileSync, existsSync, writeFileSync } from 'node:fs'",
  '',
  `const port = ${port}`,
  `const secret = '${secret}'`,
  `const fund = '${account.toLowerCase()}'`,
  '',
  'const DIR = import.meta.dir',
  'const STEP_MS = 60 * 60 * 1000',
  'const REVIEW_MS = 24 * 60 * 60 * 1000',
  'const REPLY_MS = 10 * 60 * 1000',
  "const SYSTEM2 = ['claude', '-p', '--tools', 'Read,Glob,Grep', '--setting-sources', 'project', '--strict-mcp-config', '--no-chrome', '--no-session-persistence']",
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
  "        return ws.send(JSON.stringify({ type: 'prove', proof: proof('agent', frame.nonce) }))",
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
  '    close(ws) {',
  '      if (socket !== ws) return',
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
  "    const reply: Reply = { type: 'failed', id: 0, code: 'NOT_LINKED', detail: 'the app is not linked; it links again once the owner opens the wallet page' }",
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
  'const think = async (task: string): Promise<void> => {',
  '  const run = Bun.spawn(SYSTEM2, {',
  '    cwd: DIR,',
  '    stdin: new TextEncoder().encode(`Follow AGENTS.md in this folder.\\n\\n${task}`),',
  "    stdout: 'pipe',",
  "    stderr: 'pipe'",
  '  })',
  '  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])',
  "  if (code !== 0) throw new Error(`System 2 exited ${code}: ${(err === '' ? out : err).slice(0, 500)}`)",
  '  const strategy = out.match(/<strategy>([\\s\\S]*?)<\\/strategy>/)?.[1]?.trim()',
  '  const lesson = out.match(/<lesson>([\\s\\S]*?)<\\/lesson>/)?.[1]?.trim()',
  '  if (strategy !== undefined) {',
  "    new Bun.Transpiler({ loader: 'ts' }).transformSync(strategy)",
  '    writeFileSync(`${DIR}/strategy.ts`, `${strategy}\\n`)',
  '  }',
  '  if (lesson !== undefined) appendFileSync(`${DIR}/lessons.md`, `- ${new Date().toISOString()}: ${lesson}\\n`)',
  '  journal({ system2: task, strategy: strategy !== undefined, lesson: lesson ?? null })',
  '}',
  '',
  'let due = 0',
  'let reviewed = Date.now()',
  'let busy = false',
  'setInterval(async () => {',
  "  if (busy || socket?.data.phase !== 'linked' || Date.now() < due) return",
  '  busy = true',
  '  due = Date.now() + STEP_MS',
  '  try {',
  "    if (!existsSync(`${DIR}/strategy.ts`)) await think('This is the first link: write strategy.ts, as AGENTS.md describes.')",
  '    const { step } = await import(`${DIR}/strategy.ts?at=${Date.now()}`)',
  '    const concern: string | null = await step(request)',
  '    journal({ step: concern })',
  '    if (concern !== null) await think(`The last step reported: ${concern}. Run a post-mortem, as AGENTS.md describes.`)',
  '    else if (Date.now() - reviewed >= REVIEW_MS) {',
  "      await think('Run the daily review, as AGENTS.md describes.')",
  '      reviewed = Date.now()',
  '    }',
  '  } catch (err) {',
  '    const message = err instanceof Error ? err.message : String(err)',
  '    journal({ error: message })',
  '    await think(`The last step failed: ${message}. Fix strategy.ts, as AGENTS.md describes.`).catch(failure => journal({ error: String(failure) }))',
  '  } finally {',
  '    busy = false',
  '  }',
  '}, 10_000)',
  '',
  'console.log(`waiting for the Puppet app on ws://127.0.0.1:${port}`)',
  ''
].join('\n')

const SYSTEM2_ROLE = [
  '# System 2',
  '',
  'You are the reflective half of this Puppet agent, and the instructions above are the owner’s. agent.ts is System 1: it keeps the link to the Puppet app, runs strategy.ts every hour while linked, journals each request when it is sent and its reply when it arrives under the same id in journal.jsonl, and calls you. You never edit files: you answer with blocks, and agent.ts checks and writes them.',
  '',
  '## When agent.ts calls you',
  '- On the first link, with no strategy.ts yet: write it from the instructions above and MANUAL.md (every request, reply and rule).',
  '- After a step reports a concern or fails: a post-mortem of what happened.',
  '- Once a day: a review of the journal against the instructions above.',
  '',
  '## How to answer',
  '- Read MANUAL.md, journal.jsonl, lessons.md and strategy.ts first.',
  '- To replace strategy.ts, answer with the whole file in <strategy>…</strategy>. Change it only when the journal supports the change; otherwise leave the block out.',
  '- Always answer one lesson in <lesson>…</lesson>: what happened and what it changes.',
  '',
  '## strategy.ts',
  '- It exports `async function step(request)`, called every hour while linked. `request(frame)` sends one request from MANUAL.md and resolves with its reply; a failed reply has a code and a detail. Return null when all is well, or a short concern to be called about.',
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
    files: (context: IAgentTemplateContext): IAgentFile[] => [{ path: 'AGENTS.md', content: `${context.instructions.trim()}\n\n${agentConnection(context.port, context.secret, context.account)}\n` }]
  },
  {
    id: 'claude-skill',
    name: 'Agent skill',
    detail: 'An Agent Skills folder (the open SKILL.md format) named for this agent; put it in your agent’s skills folder, such as .claude/skills for Claude Code',
    files: (context: IAgentTemplateContext): IAgentFile[] => {
      const slug = context.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '')
      const folder = slug === '' ? `puppet-fund-${context.port}` : `puppet-fund-${slug}-${context.port}`
      return [
        {
          path: `${folder}/SKILL.md`,
          content: [
            '---',
            `name: ${folder}`,
            `description: ${JSON.stringify(`Operate the owner’s Puppet fund ${context.account} as the agent ${context.name}, through the Puppet app over a local link. Use it to swap, trade on the fund’s venues, sign venue orders, withdraw from venues or run the fund’s rounds.`)}`,
            '---',
            '',
            context.instructions.trim(),
            '',
            '## Run the link',
            'Write the link below as a small program in this skill’s folder and keep it running in the background, so requests and replies pass while you work. Keep the link secret in a file beside it, never in your replies.',
            '',
            agentConnection(context.port, context.secret, context.account),
            ''
          ].join('\n')
        }
      ]
    }
  },
  {
    id: 'bun-agent',
    name: 'Bun agent',
    detail: 'System 1 and 2: a Bun program keeps the link and runs the strategy, and an LLM command line (Claude Code by default) reviews and rewrites it. Run bun agent.ts in its folder',
    files: (context: IAgentTemplateContext): IAgentFile[] => [
      { path: 'puppet-agent/AGENTS.md', content: `${context.instructions.trim()}\n\n${SYSTEM2_ROLE}` },
      { path: 'puppet-agent/agent.ts', content: bunAgent(context.port, context.secret, context.account) }
    ]
  }
] as const

export type IAgentTemplateId = (typeof AGENT_TEMPLATES)[number]['id']
