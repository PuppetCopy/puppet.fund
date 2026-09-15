import { readdirSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const entry: Record<string, string> = { index: 'src/index.ts' }
for (const d of readdirSync('src', { withFileTypes: true })) {
  if (d.isDirectory()) entry[`${d.name}/index`] = `src/${d.name}/index.ts`
}

export default defineConfig({
  entry,
  target: 'esnext',
  fixedExtension: false,
  dts: { eager: true }
})
