#!/usr/bin/env bun
import { Glob } from 'bun'
import { parse as parseToml } from 'smol-toml'

const FOUNDRY_TOML = './foundry.toml'
const SCAN_ROOTS = ['src', 'test', 'script']

const foundry = parseToml(await Bun.file(FOUNDRY_TOML).text()) as {
  profile: { default: { solc_version?: string } }
}
const target = foundry.profile?.default?.solc_version
if (!target) throw new Error(`profile.default.solc_version missing from ${FOUNDRY_TOML}`)

const pragmaRegex = /^(\s*pragma\s+solidity\s+)([\^~>=<\s\d.]+)(;)/m
const desired = `^${target}`

const updates: { file: string; from: string }[] = []
const skipped: { file: string; reason: string }[] = []

for (const root of SCAN_ROOTS) {
  const glob = new Glob('**/*.sol')
  for await (const rel of glob.scan({ cwd: root })) {
    const file = `${root}/${rel}`
    const content = await Bun.file(file).text()
    const match = content.match(pragmaRegex)
    if (!match) {
      skipped.push({ file, reason: 'no pragma directive' })
      continue
    }
    const current = match[2]!.trim()
    if (current === desired) continue
    const next = content.replace(pragmaRegex, `$1${desired}$3`)
    await Bun.write(file, next)
    updates.push({ file, from: current })
  }
}

console.log(`Target: pragma solidity ${desired}`)
console.log(`Updated ${updates.length} file(s):`)
for (const u of updates) console.log(`  ${u.from.padEnd(10)} → ${u.file}`)
if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length} file(s):`)
  for (const s of skipped) console.log(`  ${s.file}  (${s.reason})`)
}
