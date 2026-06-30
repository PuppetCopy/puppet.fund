import { createCompact, type ICompact } from '@puppet/sdk/compact'

// HTTP(S) base of the attest-only relay; the compact client posts intents to `${matchmakerUrl}/attest` and resolves at
// the dispatch ACK. No head stream / reads here. A relative base (same-origin via the edge proxy) works in the browser.
export const matchmakerUrl = (import.meta.env.VITE_MATCHMAKER_URL as string | undefined) ?? '/api/matchmaker'

export const compact: ICompact = createCompact({ matchmakerUrl })
