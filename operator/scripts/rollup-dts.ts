#!/usr/bin/env bun
// Roll every entrypoint's emitted .d.ts into a single self-contained file (inlining the
// workspace packages @puppet/sdk + @puppet/contracts + abitype) so the published package
// carries no bare workspace type specifiers. Entrypoints are the root `dist/index.d.ts`
// plus each venue folder's `dist/<venue>/index.d.ts` — adding a venue folder under src/
// needs no change here, matching the package's `./*` wildcard export.
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function entrypoints(): string[] {
  const entries = ['dist/index.d.ts']
  for (const d of readdirSync('dist', { withFileTypes: true })) {
    if (d.isDirectory()) entries.push(`dist/${d.name}/index.d.ts`)
  }
  return entries
}

function configFor(entry: string) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json',
    projectFolder: '.',
    mainEntryPointFilePath: `<projectFolder>/${entry}`,
    bundledPackages: ['@puppet/sdk', '@puppet/contracts', 'abitype'],
    compiler: { tsconfigFilePath: '<projectFolder>/tsconfig.json' },
    dtsRollup: { enabled: true, untrimmedFilePath: `<projectFolder>/${entry}` },
    apiReport: { enabled: false },
    docModel: { enabled: false },
    tsdocMetadata: { enabled: false },
    messages: {
      compilerMessageReporting: { default: { logLevel: 'none' } },
      extractorMessageReporting: {
        default: { logLevel: 'warning' },
        'ae-missing-release-tag': { logLevel: 'none' },
        'ae-forgotten-export': { logLevel: 'none' },
        // The indexer's @puppet/indexer-graphql/client ships raw .ts; the rolled output
        // verifiably doesn't depend on it, so suppress the spurious wrong-input error.
        'ae-wrong-input-file-type': { logLevel: 'none' }
      },
      tsdocMessageReporting: { default: { logLevel: 'none' } }
    }
  }
}

const TMP = '.api-extractor.tmp.json'
for (const entry of entrypoints()) {
  writeFileSync(TMP, JSON.stringify(configFor(entry), null, 2))
  const { exitCode } = Bun.spawnSync(['bun', 'x', 'api-extractor', 'run', '--local', '-c', TMP], {
    stdout: 'inherit',
    stderr: 'inherit'
  })
  rmSync(TMP, { force: true })
  if (exitCode !== 0) {
    console.error(`api-extractor failed for ${entry}`)
    process.exit(exitCode ?? 1)
  }
}

// Drop the orphan per-file declarations (core/lifecycle/pair) and .d.ts.map files left by
// vite-plugin-dts; the rolled per-entry index.d.ts files are self-contained.
const stack = ['dist']
while (stack.length > 0) {
  const dir = stack.pop()!
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name)
    if (d.isDirectory()) stack.push(p)
    else if (d.name.endsWith('.d.ts.map')) rmSync(p, { force: true })
    else if (d.name.endsWith('.d.ts') && d.name !== 'index.d.ts') rmSync(p, { force: true })
  }
}
