import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const EXTERNAL = ['@noble/curves', '@noble/hashes', 'aelea', 'graphql-ws', 'viem']

export default defineConfig({
  build: {
    target: 'esnext',
    lib: {
      entry: { index: 'src/index.ts', gmx: 'src/gmx.ts' },
      formats: ['es']
    },
    rollupOptions: {
      external: id => EXTERNAL.some(dep => id === dep || id.startsWith(`${dep}/`))
    }
  },
  plugins: [dts({ include: ['src'], entryRoot: 'src' })]
})
