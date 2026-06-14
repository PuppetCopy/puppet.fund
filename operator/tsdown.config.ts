import { readdirSync } from 'node:fs'
import { defineConfig } from 'tsdown'

// One entrypoint per operator: the root `index` is the generic core, and every folder
// under src/ is a venue with its own `index.ts` (src/gmx/index.ts -> dist/gmx/index.js,
// surfaced as @puppet.fund/operator/gmx by the package's `./*` wildcard export). Adding a
// venue is just dropping in src/<venue>/index.ts — no build config change.
const entry: Record<string, string> = { index: 'src/index.ts' }
for (const d of readdirSync('src', { withFileTypes: true })) {
  if (d.isDirectory()) entry[`${d.name}/index`] = `src/${d.name}/index.ts`
}

// `dependencies` stay external; the unpublished workspace packages live in devDependencies
// so their JS and their types are both bundled — the published dist carries no bare
// workspace specifiers. `eager` lets the dts emitter compile @puppet/indexer-graphql's
// raw-.ts `./client` export, which sits outside this package's tsconfig project.
export default defineConfig({
  entry,
  target: 'esnext',
  fixedExtension: false,
  dts: { eager: true }
})
