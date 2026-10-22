import { type Address, type Hex, isAddress, isHex } from 'viem'

export interface IChangelogApproval {
  date: string
  contract: string
  chainId: number
  address: Address
  tx: Hex
}

export interface IChangelogRelease {
  title: string
  lead: string | null
  groups: { title: string | null; changes: string[] }[]
  approval: IChangelogApproval | null
}

const APPROVAL_DATE = /^\d{4}-\d{2}-\d{2}$/

export function changelogOf(raw: unknown): IChangelogRelease[] {
  if (!Array.isArray(raw)) throw new Error('changelog.json holds an array of releases, newest first')
  return raw.map((entry: unknown, index): IChangelogRelease => {
    const where = `changelog.json release ${index + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${where} is not an object`)
    const { title, lead, groups, approval, ...rest } = entry as Record<string, unknown>
    if (Object.keys(rest).length > 0) throw new Error(`${where} carries unknown fields: ${Object.keys(rest).join(', ')}`)
    if (typeof title !== 'string' || title.trim() === '') throw new Error(`${where} needs a title`)
    if (lead !== null && typeof lead !== 'string') throw new Error(`"${title}" has a lead that is neither text nor null`)
    if (!Array.isArray(groups) || groups.length === 0) throw new Error(`"${title}" lists no groups`)
    const checkedGroups = groups.map((group: unknown) => {
      if (typeof group !== 'object' || group === null || Array.isArray(group)) throw new Error(`"${title}" has a group that is not an object`)
      const { title: groupTitle, changes, ...groupRest } = group as Record<string, unknown>
      if (Object.keys(groupRest).length > 0) throw new Error(`"${title}" has a group with unknown fields: ${Object.keys(groupRest).join(', ')}`)
      if (groupTitle !== null && (typeof groupTitle !== 'string' || groupTitle.trim() === '')) throw new Error(`"${title}" has a group title that is neither text nor null`)
      if (!Array.isArray(changes) || changes.length === 0 || changes.some(change => typeof change !== 'string' || change.trim() === '')) {
        throw new Error(`"${title}" has a group${groupTitle === null ? '' : ` "${groupTitle}"`} whose changes are not a list of lines`)
      }
      return { title: groupTitle, changes: changes as string[] }
    })
    if (approval === null) {
      if (index > 0) throw new Error(`"${title}" shipped without an approval; only the top release is the unapproved draft`)
      return { title, lead, groups: checkedGroups, approval: null }
    }
    if (typeof approval !== 'object' || Array.isArray(approval)) throw new Error(`"${title}" has an approval that is neither an object nor null`)
    const { date, contract, chainId, address, tx, ...approvalRest } = approval as Record<string, unknown>
    if (Object.keys(approvalRest).length > 0) throw new Error(`"${title}" has an approval with unknown fields: ${Object.keys(approvalRest).join(', ')}`)
    if (typeof date !== 'string' || !APPROVAL_DATE.test(date)) throw new Error(`"${title}" has an approval date that is not YYYY-MM-DD`)
    if (typeof contract !== 'string' || contract.trim() === '') throw new Error(`"${title}" has an approval that names no contract`)
    if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) throw new Error(`"${title}" has an approval chainId that is not a chain id`)
    if (typeof address !== 'string' || !isAddress(address, { strict: false })) throw new Error(`"${title}" has an approval address that is not an address`)
    if (typeof tx !== 'string' || !isHex(tx) || tx.length !== 66) throw new Error(`"${title}" has an approval tx that is not a transaction hash`)
    return { title, lead, groups: checkedGroups, approval: { date, contract, chainId, address, tx } }
  })
}
