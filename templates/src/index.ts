#!/usr/bin/env bun
import { basename, join, relative } from 'node:path'
import { Glob } from 'bun'

const VENUES = ['gmx']

const targetArg = Bun.argv[2]
const venueArg = (argFlag('--venue') ?? Bun.argv[3] ?? 'gmx').toLowerCase()

if (!VENUES.includes(venueArg)) {
  console.error(`unknown venue "${venueArg}" — available: ${VENUES.join(', ')}`)
  process.exit(1)
}

const targetDir = targetArg ?? (prompt('project directory:', 'my-operator') || 'my-operator')
const dest = join(process.cwd(), targetDir)
const projectName = basename(dest)
const scaffoldDir = join(import.meta.dir, '..', 'scaffolds', venueArg)

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
pkg.name = projectName
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log(`\n  scaffolded ${venueArg} operator in ${relative(process.cwd(), dest) || '.'}\n`)
console.log('  next:')
console.log(`    cd ${targetDir}`)
console.log('    bun install')
console.log('    bun run dev   # prints a pairing link; open it on the site to authorize')
console.log('                  # pairing supplies the endpoints + session key — no .env needed\n')

function argFlag(flag: string): string | undefined {
  const i = Bun.argv.indexOf(flag)
  return i === -1 ? undefined : Bun.argv[i + 1]
}
