import { createCompact, type ICompact } from '@puppet/sdk/compact'
import { ENDPOINTS } from '../../app/endpoints.js'

export const matchmakerUrl = ENDPOINTS.matchmaker

export const compact: ICompact = createCompact({ matchmakerUrl })
