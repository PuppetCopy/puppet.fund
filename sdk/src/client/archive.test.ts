import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { encode } from '../compact/index.js'
import { syncCalls } from './archive.js'

const ACCOUNT = getAddress('0x00000000000000000000000000000000000000a2')

function fakeChronicle(page: { slices: { chainId: number; account: string; calls: unknown[] }[]; complete: boolean }) {
  let asked = 0
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      asked += 1
      return new Response(encode(page))
    }
  })
  return { url: `http://127.0.0.1:${server.port}`, server, asked: () => asked }
}

describe('served calls', () => {
  test('an incomplete page that moves no account forward ends the paging instead of asking forever', async () => {
    const chronicle = fakeChronicle({ slices: [{ chainId: 10, account: ACCOUNT, calls: [] }], complete: false })
    const answer = await syncCalls({ chronicleUrl: chronicle.url } as never, null, [], [ACCOUNT], 'all')
    chronicle.server.stop(true)
    expect(answer.unreachable).toContain('moved no account forward')
    expect(chronicle.asked()).toBe(1)
  })

  test('a complete page with an empty slice is served without reading past its end', async () => {
    const chronicle = fakeChronicle({ slices: [{ chainId: 10, account: ACCOUNT, calls: [] }], complete: true })
    const answer = await syncCalls({ chronicleUrl: chronicle.url } as never, null, [], [ACCOUNT], 'all')
    chronicle.server.stop(true)
    expect(answer.unreachable).toBeNull()
  })
})
