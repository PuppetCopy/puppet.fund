#!/usr/bin/env bun
import { readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { Glob } from 'bun'

// Scaffold one operator project from scaffolds/<venue>/<variant>. Each variant is a complete,
// single-file starting point (base, copy-trader, trend, llm-basic, …) — drop a new folder in and
// it's offered with no change here.
//   bunx @puppet.fund/templates <dir> [<venue>] [<variant>]
//   bunx @puppet.fund/templates my-op gmx copy-trader      (or: my-op gmx/copy-trader)
const SCAFFOLDS = join(import.meta.dir, '..', 'scaffolds')
const dirsIn = (p: string): string[] =>
  readdirSync(p, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

const targetArg = Bun.argv[2]
// The selector may be "<venue>" or "<venue>/<variant>"; an explicit variant arg also works.
const [venue, variantInSelector] = (Bun.argv[3] ?? 'gmx').toLowerCase().split('/')
const variant = (variantInSelector ?? Bun.argv[4] ?? 'base').toLowerCase()

const venues = dirsIn(SCAFFOLDS)
if (!venues.includes(venue)) {
  console.error(`unknown venue "${venue}" — available: ${venues.join(', ')}`)
  process.exit(1)
}
const variants = dirsIn(join(SCAFFOLDS, venue))
if (!variants.includes(variant)) {
  console.error(`unknown ${venue} variant "${variant}" — available: ${variants.join(', ')}`)
  process.exit(1)
}

const targetDir = targetArg ?? (prompt('project directory:', `my-${variant}`) || `my-${variant}`)
const dest = resolve(process.cwd(), targetDir) // resolve keeps an absolute targetDir, joins a relative one
const scaffoldDir = join(SCAFFOLDS, venue, variant)

if (await Bun.file(join(dest, 'package.json')).exists()) {
  console.error(`${targetDir} already contains a package.json — choose an empty directory`)
  process.exit(1)
}

const glob = new Glob('**/*')
for await (const entry of glob.scan({ cwd: scaffoldDir, dot: true, onlyFiles: true })) {
  if (entry === '.DS_Store') continue
  const out = entry === 'gitignore' ? '.gitignore' : entry
  await Bun.write(join(dest, out), Bun.file(join(scaffoldDir, entry)))
}

const pkgPath = join(dest, 'package.json')
const pkg = await Bun.file(pkgPath).json()
pkg.name = basename(dest)
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

// Surface any REQUIRED env (uncommented VAR= lines in the variant's .env.example).
const envFile = Bun.file(join(scaffoldDir, '.env.example'))
const requiredEnv = (await envFile.exists())
  ? (await envFile.text())
      .split('\n')
      .filter(l => /^[A-Z][A-Z0-9_]*=/.test(l))
      .map(l => l.split('=')[0])
  : []

console.log(`\n  scaffolded ${venue}/${variant} operator in ${relative(process.cwd(), dest) || '.'}\n`)
console.log('  next:')
console.log(`    cd ${targetDir}`)
console.log('    bun install')
if (requiredEnv.length) console.log(`    cp .env.example .env   # then set: ${requiredEnv.join(', ')}`)
console.log('    bun run dev   # prints a pairing link; open it on the site to authorize')
console.log('                  # pairing supplies the endpoints + session key — no .env needed for base/trend')
const others = variants.filter(v => v !== variant)
if (others.length) console.log(`\n  other ${venue} variants: ${others.join(', ')}\n`)
