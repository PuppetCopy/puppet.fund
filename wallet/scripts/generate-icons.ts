import { Resvg } from '@resvg/resvg-js'

const svg = await Bun.file('../website/public/favicon.svg').text()

for (const size of [16, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  await Bun.write(`public/icon-${size}.png`, png)
  console.log(`Generated icon-${size}.png`)
}
