import { readdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const EXTERNAL = ['@noble/curves', '@noble/hashes', 'aelea', 'graphql-ws', 'viem']

// One entrypoint per operator: the root `index` is the generic core, and every folder
// under src/ is a venue with its own `index.ts` (src/gmx/index.ts -> dist/gmx/index.js,
// surfaced as @puppet.fund/operator/gmx by the package's `./*` wildcard export). Adding a
// venue is just dropping in src/<venue>/index.ts — no build config change.
const entry: Record<string, string> = { index: 'src/index.ts' }
for (const d of readdirSync('src', { withFileTypes: true })) {
  if (d.isDirectory()) entry[`${d.name}/index`] = `src/${d.name}/index.ts`
}

export default defineConfig({
  build: {
    target: 'esnext',
    lib: { entry, formats: ['es'] },
    rollupOptions: {
      external: id => EXTERNAL.some(dep => id === dep || id.startsWith(`${dep}/`))
    }
  },
  plugins: [dts({ include: ['src'], entryRoot: 'src' })]
})
