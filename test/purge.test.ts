import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { friendLinks, invites, listMessages, lists, listVisits, notes, purchases, users, wishes } from '../server/db/schema'
import { makeFriendLink } from '../server/domain/friends'
import { createInvite } from '../server/domain/invites'
import { getListView } from '../server/domain/list-view'
import { deleteList } from '../server/domain/lists'
import { sendMessage } from '../server/domain/messages'
import { addNote } from '../server/domain/notes'
import { picturesInUse, purge } from '../server/domain/purge'
import { listGiven, setPurchase } from '../server/domain/purchases'
import { copyWish, linkWish } from '../server/domain/sharing'
import { deleteUser, setPicture } from '../server/domain/users'
import { rememberList } from '../server/domain/visits'
import { deleteWish, setWishImage } from '../server/domain/wishes'
import { countHit, isLimited, sweepHits } from '../server/utils/rate-limit'
import { sweepUploads } from '../server/utils/uploads'
import { KEPT_FOR_BUYERS_DAYS } from '../shared/utils/kept-for-buyers'
import { addList, addOwner, addUser, addWishTo, expectOwnersSettled, makeDb, titles } from './helpers'

const DAY = 24 * 60 * 60 * 1000
/** A moment this many days from now: what the purge takes for "now". */
const inDays = (days: number) => new Date(Date.now() + days * DAY)
const SOON = inDays(KEPT_FOR_BUYERS_DAYS - 1)
const LATER = inDays(KEPT_FOR_BUYERS_DAYS + 1)

/** Art's list with two wishes; Mom is getting the socks and wrote about them, and wrote to Art. */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lotte = addUser(db, 'lotte')
  const mom = addUser(db, 'mom')
  const token = addList(db, art.id)
  const sokken = addWishTo(db, art.id, token, 'Sokken')
  const trui = addWishTo(db, art.id, token, 'Trui')
  setWishImage(db, art.id, token, sokken.id, 'socks.png')
  rememberList(db, mom.id, token)
  setPurchase(db, token, sokken.id, mom.id, 1)
  addNote(db, token, sokken.id, mom.id, 'Maat 43.')
  sendMessage(db, mom.id, token, 'Welke kleur?')
  return { db, art, lotte, mom, token, sokken, trui }
}

/** How many rows a table holds. */
const count = (db: Db, table: SQLiteTable) => db.select().from(table).all().length

describe('erasing what was deleted', () => {
  it('leaves a live list alone, however old', () => {
    const { db, mom, token } = setup()
    expect(purge(db, inDays(3650))).toEqual({ unused: [] })
    expect(titles(getListView(db, token, mom.id))).toEqual(['Sokken', 'Trui'])
    expect(count(db, purchases)).toBe(1)
  })

  it('keeps a deleted list while whoever bought from it still sees it, and erases it after', () => {
    const { db, art, mom, token } = setup()
    deleteList(db, art.id, token)

    expect(purge(db, SOON)).toEqual({ unused: [] })
    expect(getListView(db, token, mom.id)!.wishes).toMatchObject([{ title: 'Sokken', removed: true, mine: 1 }])

    // The picture comes back to be removed from disk, and nothing of the list is left.
    expect(purge(db, LATER)).toEqual({ unused: ['socks.png'] })
    expect(getListView(db, token, mom.id)).toBeUndefined()
    expect(listGiven(db, mom.id)).toEqual([])
    for (const table of [lists, wishes, purchases, notes, listMessages, listVisits]) expect(count(db, table)).toBe(0)
    // The people stay.
    expect(count(db, users)).toBe(3)
  })

  it('erases one deleted wish and leaves the rest of its list', () => {
    const { db, art, mom, token, sokken } = setup()
    deleteWish(db, art.id, token, sokken.id)
    expect(purge(db, SOON)).toEqual({ unused: [] })
    expect(purge(db, LATER)).toEqual({ unused: ['socks.png'] })
    expect(titles(getListView(db, token, mom.id))).toEqual(['Trui'])
    expect(db.select({ title: wishes.title }).from(wishes).all()).toEqual([{ title: 'Trui' }])
    expect(count(db, purchases)).toBe(0)
    expect(count(db, notes)).toBe(0)
    expectOwnersSettled(db)
  })

  it('keeps a wish that another list still shows, and a picture another wish still uses', () => {
    const { db, art, lotte, mom, token, sokken } = setup()
    const hers = addList(db, lotte.id, 'Lotte')
    linkWish(db, lotte.id, token, sokken.id, { list: hers })
    const mine = addList(db, mom.id, 'Mom')
    copyWish(db, mom.id, token, sokken.id, { list: mine })
    deleteList(db, art.id, token)

    // Art's list goes, with the sweater only it had. The socks are Lotte's now, and Mom's copy
    // has the same picture.
    expect(purge(db, LATER)).toEqual({ unused: [] })
    expect(db.select({ title: wishes.title }).from(wishes).orderBy(wishes.id).all().map(wish => wish.title)).toEqual(['Sokken', 'Sokken'])
    expect(titles(getListView(db, hers, mom.id))).toEqual(['Sokken'])
    expect(count(db, purchases)).toBe(1)
    expectOwnersSettled(db)
  })

  it('leaves nothing of a deleted account but what it wrote on other people\'s lists', () => {
    const { db, art, lotte, mom, token } = setup()
    const shared = addList(db, art.id, 'Samen')
    addOwner(db, shared, lotte.id)
    addWishTo(db, art.id, shared, 'Picknickmand')
    const moms = addList(db, mom.id, 'Mom')
    const boek = addWishTo(db, mom.id, moms, 'Boek')
    setPurchase(db, moms, boek.id, art.id, 1)
    addNote(db, moms, boek.id, art.id, 'Ik haal het in de stad.')

    deleteUser(db, art.id)
    expect(getListView(db, token, mom.id)).toMatchObject({ deleted: true })
    expect(purge(db, LATER)).toEqual({ unused: ['socks.png'] })

    expect(db.select({ title: lists.title }).from(lists).orderBy(lists.id).all().map(list => list.title)).toEqual(['Samen', 'Mom'])
    expect(db.select({ title: wishes.title }).from(wishes).orderBy(wishes.id).all().map(wish => wish.title)).toEqual(['Picknickmand', 'Boek'])
    // His note on Mom's wish stays, written by nobody; hers on his wish went with the wish.
    expect(db.select({ body: notes.body, userId: notes.userId }).from(notes).all()).toEqual([{ body: 'Ik haal het in de stad.', userId: null }])
    expect(count(db, purchases)).toBe(0)
    expect(count(db, listMessages)).toBe(0)
    expectOwnersSettled(db)
  })

  it('deletes a live list nobody owns, and erases it once its buyers stopped seeing it', () => {
    const { db, art, mom, token } = setup()
    // An account deleted before its lists went with it: only its row was taken out.
    db.delete(users).where(eq(users.id, art.id)).run()
    expect(getListView(db, token, null)).toMatchObject({ deleted: false, owners: [] })

    expect(purge(db)).toEqual({ unused: [] })
    expect(getListView(db, token, null)?.wishes ?? []).toEqual([])
    expect(getListView(db, token, mom.id)).toMatchObject({ deleted: true, wishes: [{ title: 'Sokken', mine: 1 }] })
    expectOwnersSettled(db)

    expect(purge(db, LATER)).toEqual({ unused: ['socks.png'] })
    expect(count(db, lists)).toBe(0)
    expect(count(db, wishes)).toBe(0)
  })

  it('erases a link a while after it ran out or was used, and keeps one that still works', () => {
    const { db, art, token, sokken } = setup()
    createInvite(db, art.id, token, { kind: 'wishes', mode: 'copy', wishIds: [sokken.id] })
    createInvite(db, art.id, token, { kind: 'wishes', mode: 'linked', wishIds: [sokken.id] })
    makeFriendLink(db, art.id)
    expect(db.select({ mode: invites.mode }).from(invites).orderBy(invites.id).all().map(row => row.mode)).toEqual(['copy', 'linked'])

    // The copy link works for 30 days, the friend link too; the linked one has no end.
    purge(db, inDays(59))
    expect(count(db, invites)).toBe(2)
    expect(count(db, friendLinks)).toBe(1)
    purge(db, inDays(61))
    expect(db.select({ mode: invites.mode }).from(invites).all()).toEqual([{ mode: 'linked' }])
    expect(count(db, friendLinks)).toBe(0)

    // Once used, the linked one is spent, and goes after the same while.
    db.update(invites).set({ usedAt: new Date() }).run()
    purge(db, inDays(29))
    expect(count(db, invites)).toBe(1)
    purge(db, inDays(31))
    expect(count(db, invites)).toBe(0)
  })
})

describe('the pictures a row still points at', () => {
  it('are profile pictures and the pictures of wishes, also of a deleted wish', () => {
    const { db, art, token, sokken } = setup()
    setPicture(db, art.id, 'art.jpg')
    deleteWish(db, art.id, token, sokken.id)
    expect([...picturesInUse(db)].sort()).toEqual(['art.jpg', 'socks.png'])
    purge(db, LATER)
    expect([...picturesInUse(db)]).toEqual(['art.jpg'])
  })

  it('include the earlier picture a link keeps for an undo', () => {
    const { db, lotte, token, sokken } = setup()
    const hers = addList(db, lotte.id, 'Lotte')
    linkWish(db, lotte.id, token, sokken.id, { list: hers })
    setWishImage(db, lotte.id, hers, sokken.id, 'new.png')
    expect([...picturesInUse(db)].sort()).toEqual(['new.png', 'socks.png'])
  })
})

describe('sweeping the uploads folder', () => {
  const OLD = 'a'.repeat(32) + '.jpg'
  const USED = 'b'.repeat(32) + '.png'
  const FRESH = 'c'.repeat(32) + '.webp'

  it('removes an old file nothing points at, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pakske-sweep-'))
    for (const name of [OLD, USED, FRESH, 'notes.txt']) writeFileSync(join(dir, name), 'x')
    const twoDaysAgo = new Date(Date.now() - 2 * DAY)
    // A file just uploaded has no row yet; a file this site didn't name isn't its to remove.
    for (const name of [OLD, USED, 'notes.txt']) utimesSync(join(dir, name), twoDaysAgo, twoDaysAgo)

    expect(await sweepUploads(new Set([USED]), dir)).toBe(1)
    expect(readdirSync(dir).sort()).toEqual([USED, FRESH, 'notes.txt'].sort())
  })

  it('does nothing when the folder isn\'t there', async () => {
    expect(await sweepUploads(new Set(), join(tmpdir(), 'pakske-no-such-folder'))).toBe(0)
  })
})

describe('the counters of wrong passwords and new accounts', () => {
  it('are dropped once their window is over, without anyone using the key again', () => {
    const key = `login:account:someone-${Date.now()}@example.test`
    const before = sweepHits()
    countHit(key, 60 * 1000)
    expect(sweepHits()).toBe(before + 1)
    expect(isLimited(key, 1)).toBe(true)
    // An hour on, the address is no longer in the server's memory.
    expect(sweepHits(Date.now() + 60 * 60 * 1000)).toBe(0)
    expect(isLimited(key, 1)).toBe(false)
  })
})
