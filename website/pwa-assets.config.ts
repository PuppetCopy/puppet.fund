import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: {
    preset: '2023',
    basePath: '/assets/pwa/'
  },
  preset: {
    ...minimal2023Preset,
    assetName: (type, size) => `assets/pwa/${type}-${size.width}x${size.height}.png`
  },
  images: 'public/favicon.svg'
})
