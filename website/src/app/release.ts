import TOKEN from '@puppet/contracts/token'
import { encodeFunctionData, type Hex, isAddressEqual, zeroHash } from 'viem'
import type { IStream } from 'aelea/stream'
import { uiStorage } from '@/ui-storage'
import { readGovernorBook } from '../io/chain/governor.js'
import { localFirst, notLocal } from '../io/datastore/reads.js'
import { tokenClient } from '../wallet/wallet.js'
import { changelogOf, type IChangelogRelease } from './changelog.js'

export interface IReleaseState {
  update: { hash: string; checked: boolean; title: string | null; lead: string | null; sections: { title: string | null; changes: string[] }[] } | null
  error: string | null
}

declare const __RELEASE_CHECKED__: boolean

interface IListing {
  files: Record<string, string>
}

const sectionsOf = (notes: readonly IChangelogRelease[], unseen: string[]): { title: string | null; changes: string[] }[] => {
  const groups = notes.flatMap(note => note.groups.flatMap(group => (group.title === null ? [] : [{ title: group.title, changes: group.changes.filter(change => unseen.includes(change)) }])))
  const loose = unseen.filter(change => !groups.some(group => group.changes.includes(change)))
  return [...groups.filter(group => group.changes.length > 0), ...(loose.length === 0 ? [] : [{ title: null, changes: loose }])]
}

const listingOf = async (hash: string): Promise<IListing | null> => {
  const held = await caches.match('/release.json', { cacheName: `release:${hash}` })
  return held === undefined ? null : ((await held.json()) as IListing)
}

const changesOf = (notes: readonly IChangelogRelease[]): string[] => notes.flatMap(note => note.groups.flatMap(group => group.changes))

const changelogIn = async (hash: string, listing: IListing): Promise<IChangelogRelease[]> => {
  const listed = listing.files['/changelog.json']
  const held = await caches.match('/changelog.json', { cacheName: `release:${hash}` })
  if (listed === undefined || held === undefined) throw new Error(`release ${hash} holds no changelog.json`)
  const bytes = await held.arrayBuffer()
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== listed) throw new Error(`the changelog.json cached for release ${hash} does not match the sha256 its release.json lists`)
  return changelogOf(JSON.parse(new TextDecoder().decode(bytes)))
}

export function markBooted(): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready.then(registration => registration.active?.postMessage('booted'))
}

export async function readRelease(): Promise<IReleaseState | null> {
  if (typeof caches === 'undefined') return null
  const [pointer, state] = await Promise.all([caches.match('/current', { cacheName: 'release' }), caches.match('/state', { cacheName: 'release' })])
  const error = state === undefined ? null : ((await state.json()) as { error: string | null }).error
  const hash = pointer === undefined ? null : await pointer.text()
  const pinned = hash === null ? null : await listingOf(hash)
  const running = new URL(import.meta.url).pathname
  if (hash === null || pinned === null || pinned.files[running] !== undefined) return { update: null, error }
  const notes = await changelogIn(hash, pinned)
  const draft = notes[0]
  if (draft === undefined) throw new Error(`release ${hash} ships a changelog with no release in it`)
  const checked = __RELEASE_CHECKED__
  const changes = changesOf(notes)
  for (const name of await caches.keys()) {
    const other = name.slice('release:'.length)
    const listing = name.startsWith('release:') ? await listingOf(other) : null
    if (listing !== null && listing.files[running] !== undefined) {
      const seen = changesOf(await changelogIn(other, listing))
      return { update: { hash, checked, title: draft.title, lead: draft.lead, sections: sectionsOf(notes, changes.filter(change => !seen.includes(change))) }, error }
    }
  }
  return { update: { hash, checked, title: draft.title, lead: draft.lead, sections: sectionsOf(notes, changes) }, error }
}

const { Release } = TOKEN

export async function runningHash(): Promise<string | null> {
  if (typeof caches === 'undefined') return null
  const running = new URL(import.meta.url).pathname
  const installed = await Promise.all(
    (await caches.keys()).filter(name => name.startsWith('release:')).map(async name => ({ hash: name.slice('release:'.length), listing: await listingOf(name.slice('release:'.length)) }))
  )
  const own = installed.find(entry => entry.listing !== null && entry.listing.files[running] !== undefined)
  return own === undefined ? null : own.hash
}

export type IReleaseApproval = { kind: 'approved'; transactionHash: Hex; time: number }
export type IReleaseCheck = IReleaseApproval | { kind: 'superseded' } | { kind: 'unapproved' }

const storedApprovalOf = async (hash: string): Promise<IReleaseApproval | null> => (await uiStorage.device.read<IReleaseApproval>(`releaseApproval:${hash}`))?.value ?? null

export async function approvalOf(hash: string): Promise<IReleaseCheck> {
  const approved = await tokenClient.readContract({ address: Release.address, abi: Release.abi, functionName: 'current' })
  if (approved === zeroHash) return { kind: 'unapproved' }
  if (approved.slice(2).toLowerCase() !== hash) return { kind: 'superseded' }
  const stored = await storedApprovalOf(hash)
  if (stored !== null) return stored
  const approving = encodeFunctionData({ abi: Release.abi, functionName: 'approve', args: [approved] })
  const book = await readGovernorBook()
  const proposal = book.created.findLast(created => created.targets.some((target, i) => isAddressEqual(target, Release.address) && created.calldatas[i]?.toLowerCase() === approving))
  const executed = proposal === undefined ? undefined : book.executed.find(row => row.id === proposal.proposalId)
  const time = executed === undefined ? undefined : book.times[String(executed.block)]
  if (executed === undefined || time === undefined) {
    throw new Error(`release ${hash} is current on the Release registry ${Release.address}, but the Governor's log holds no executed proposal approving it`)
  }
  const approval: IReleaseApproval = { kind: 'approved', transactionHash: executed.tx, time }
  void uiStorage.device.write(`releaseApproval:${hash}`, approval)
  return approval
}

export const approvalAnswers = (hash: string): IStream<Promise<IReleaseCheck>> =>
  localFirst<IReleaseCheck>(
    () => storedApprovalOf(hash).then(stored => (stored === null ? notLocal : stored)),
    () => approvalOf(hash)
  )
