import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const BRAND_COLOR = '#B02A42'

export default defineConfig({
  headLinkOptions: {
    preset: '2023',
    basePath: '/assets/pwa/'
  },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { fit: 'contain', background: BRAND_COLOR }
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { fit: 'contain', background: BRAND_COLOR }
    },
    assetName: (type, size) => `assets/pwa/${type}-${size.width}x${size.height}.png`
  },
  images: 'public/favicon.svg'
})
